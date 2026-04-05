package com.meshalert

import android.bluetooth.*
import android.bluetooth.le.*
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Pure-Android BLE mesh transport — zero Google Play Services, zero internet dependency.
 *
 * Both phones advertise a custom service UUID + scan for it simultaneously.
 * When Phone A finds Phone B via scan → A opens a GATT client connection to B.
 * B's GATT server accepts → both sides can exchange messages.
 * Because both phones scan, they both initiate GATT connections to each other,
 * giving full bidirectional messaging.
 *
 * Emits the same events as the old NearbyModule so NearbyService.ts is unchanged:
 *   NearbyPeerConnected    { endpointId, endpointName, connectedCount }
 *   NearbyPeerDisconnected { endpointId, connectedCount }
 *   NearbyMessageReceived  { endpointId, message }
 */
class NearbyModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "NearbyConnections"

    companion object {
        // Unique UUIDs for MeshAlert — will not match any other BLE device
        val SVC_UUID   = UUID.fromString("ba5e1337-cafe-babe-dead-c0ffee123456")
        val MSG_UUID   = UUID.fromString("ba5e1337-cafe-babe-dead-c0ffee123457") // write → server receives message
        val NAME_UUID  = UUID.fromString("ba5e1337-cafe-babe-dead-c0ffee123458") // write → server learns peer name
        val NOTIFY_UUID= UUID.fromString("ba5e1337-cafe-babe-dead-c0ffee123459") // notify → server pushes to client
        val CCCD_UUID  = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
    }

    private val btMgr  by lazy { reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager }
    private val btAdap get()   = btMgr.adapter
    private val uiHandler      = Handler(Looper.getMainLooper())

    private var localName  = "Survivor"
    private var gattServer: BluetoothGattServer? = null
    private var advCb: AdvertiseCallback?        = null
    private var bleScan: BluetoothLeScanner?     = null

    // outgoing connections we opened (as GATT client), keyed by device address
    private val outConns   = ConcurrentHashMap<String, BluetoothGatt>()
    // incoming connections to our GATT server (as server), keyed by device address
    private val inConns    = ConcurrentHashMap<String, BluetoothDevice>()
    // server-side: addresses that have sent at least one message (confirmed MeshAlert peers)
    private val inValidated = ConcurrentHashMap.newKeySet<String>()
    // cached peer display names
    private val peerNames  = ConcurrentHashMap<String, String>()
    // addresses currently being connected (prevent duplicate connect)
    private val connecting = ConcurrentHashMap.newKeySet<String>()
    // BT state receiver — clears peers when BT is turned off
    private var btStateReceiver: BroadcastReceiver? = null

    private val allPeerAddrs get() = (outConns.keys.toSet() + inValidated.toSet())
    private val peerCount    get() = allPeerAddrs.size

    // ─── GATT Server callbacks (other devices connect TO us) ──────────────────

    private val serverCb = object : BluetoothGattServerCallback() {
        override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
            val addr = device.address
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                inConns[addr] = device
                // Don't emit NearbyPeerConnected yet — wait for first write to confirm
                // this is actually a MeshAlert peer (not a system BT service)
                android.util.Log.d("BleModule", "Server: device connected $addr (awaiting MeshAlert confirmation)")
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                val wasValidated = inValidated.remove(addr)
                inConns.remove(addr)
                if (wasValidated && !outConns.containsKey(addr)) {
                    peerNames.remove(addr)
                    android.util.Log.d("BleModule", "Server: MeshAlert peer disconnected $addr")
                    emitDisconnected(addr)
                }
            }
        }

        override fun onCharacteristicWriteRequest(
            device: BluetoothDevice, requestId: Int,
            characteristic: BluetoothGattCharacteristic,
            preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray
        ) {
            if (responseNeeded) {
                gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
            }
            val addr = device.address
            val text = String(value, Charsets.UTF_8)
            // First write from this device → confirm it's a MeshAlert peer
            if (!inValidated.contains(addr)) {
                inValidated.add(addr)
                // Extract name from the write itself if this is a NAME write (first thing client sends)
                val nameFromWrite = if (characteristic.uuid == NAME_UUID) text else null
                val name = nameFromWrite ?: peerNames[addr] ?: addr.takeLast(8)
                // Dedup: address randomization can make the same physical device appear with two MACs.
                // If we already have an outgoing connection whose cached name matches this name, suppress.
                val alreadyTracked = outConns.containsKey(addr) ||
                    peerNames.entries.any { (k, v) -> v == name && outConns.containsKey(k) }
                if (!alreadyTracked) {
                    peerNames[addr] = name   // cache before emit so notifyPeers has it
                    android.util.Log.d("BleModule", "Server: MeshAlert peer confirmed $name ($addr)")
                    emitConnected(addr, name)
                } else {
                    android.util.Log.d("BleModule", "Server: $addr ($name) dup suppressed (addr randomization)")
                }
            }
            when (characteristic.uuid) {
                NAME_UUID -> {
                    peerNames[addr] = text
                    android.util.Log.d("BleModule", "Learned peer name: $text")
                }
                MSG_UUID -> {
                    android.util.Log.d("BleModule", "Server received message from ${addr.takeLast(5)}")
                    emit("NearbyMessageReceived", Arguments.createMap().apply {
                        putString("endpointId", addr)
                        putString("message", text)
                    })
                }
            }
        }

        override fun onDescriptorWriteRequest(
            device: BluetoothDevice, requestId: Int,
            descriptor: BluetoothGattDescriptor,
            preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray
        ) {
            if (responseNeeded) {
                gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
            }
        }
    }

    // ─── GATT Client callbacks (we connect TO other devices) ──────────────────

    private inner class ClientCb(private val addr: String) : BluetoothGattCallback() {
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            connecting.remove(addr)
            if (status == BluetoothGatt.GATT_SUCCESS && newState == BluetoothProfile.STATE_CONNECTED) {
                outConns[addr] = gatt
                android.util.Log.d("BleModule", "Client: connected to $addr — requesting MTU")
                gatt.requestMtu(512)
            } else {
                android.util.Log.w("BleModule", "Client: connect failed to $addr status=$status")
                outConns.remove(addr)?.close()
                gatt.close()
                if (!inConns.containsKey(addr)) {
                    peerNames.remove(addr)
                }
            }
        }

        override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) {
            android.util.Log.d("BleModule", "MTU = $mtu, discovering services")
            gatt.discoverServices()
        }

        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            if (status != BluetoothGatt.GATT_SUCCESS) {
                android.util.Log.w("BleModule", "Service discovery failed on $addr: $status")
                return
            }
            val svc = gatt.getService(SVC_UUID)
            if (svc == null) {
                android.util.Log.w("BleModule", "MeshAlert service not found on $addr")
                return
            }

            // Enable notifications on NOTIFY_UUID so server can push to us
            svc.getCharacteristic(NOTIFY_UUID)?.let { notifyChar ->
                gatt.setCharacteristicNotification(notifyChar, true)
                notifyChar.getDescriptor(CCCD_UUID)?.let { cccd ->
                    cccd.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                    gatt.writeDescriptor(cccd)
                }
            }

            // Write our display name to the NAME characteristic
            svc.getCharacteristic(NAME_UUID)?.let { nameChar ->
                nameChar.value = localName.toByteArray(Charsets.UTF_8)
                nameChar.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
                gatt.writeCharacteristic(nameChar)
            }

            val name = peerNames[addr] ?: addr.takeLast(8)
            android.util.Log.d("BleModule", "Client: services ready for $name ($addr)")
            emitConnected(addr, name)
        }

        override fun onCharacteristicChanged(
            gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic
        ) {
            // Receive message pushed via NOTIFY from the server side
            val msg = String(characteristic.value ?: return, Charsets.UTF_8)
            android.util.Log.d("BleModule", "Client: notification/message from $addr")
            emit("NearbyMessageReceived", Arguments.createMap().apply {
                putString("endpointId", addr)
                putString("message", msg)
            })
        }

        override fun onCharacteristicWrite(
            gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int
        ) {
            // Completed a write — nothing to do here
        }
    }

    // ─── BLE Scanner callback ─────────────────────────────────────────────────

    private val scanCb = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            val addr = result.device.address
            if (outConns.containsKey(addr) || inConns.containsKey(addr) || connecting.contains(addr)) return

            val name = result.scanRecord?.deviceName
                ?: result.device.name
                ?: addr.takeLast(8)
            peerNames[addr] = name
            connecting.add(addr)

            android.util.Log.d("BleModule", "Scan: found peer $name ($addr) — connecting")
            uiHandler.post {
                try {
                    result.device.connectGatt(reactContext, false, ClientCb(addr), BluetoothDevice.TRANSPORT_LE)
                } catch (e: Exception) {
                    connecting.remove(addr)
                    android.util.Log.e("BleModule", "connectGatt failed: ${e.message}")
                }
            }
        }

        override fun onScanFailed(errorCode: Int) {
            android.util.Log.e("BleModule", "Scan failed: $errorCode")
        }
    }

    // ─── ReactMethods ─────────────────────────────────────────────────────────

    @ReactMethod
    fun start(deviceName: String, promise: Promise) {
        localName = deviceName
        if (!btAdap.isEnabled) {
            android.util.Log.w("BleModule", "start() called but Bluetooth is off — aborting")
            promise.reject("BT_DISABLED", "Bluetooth is disabled")
            return
        }
        try {
            openGattServer()
            startAdvertising()
            startScanning()
            registerBtStateReceiver()
            android.util.Log.d("BleModule", "✅ Pure-BLE transport started as: $deviceName")
            promise.resolve(true)
        } catch (e: Exception) {
            android.util.Log.e("BleModule", "start() failed: ${e.message}")
            promise.reject("START_FAILED", e.message)
        }
    }

    @ReactMethod
    fun sendMessage(message: String, promise: Promise) {
        val bytes = message.toByteArray(Charsets.UTF_8)
        if (bytes.size > 500) {
            android.util.Log.w("BleModule", "Message too large (${bytes.size} bytes) — truncation risk")
        }
        var sent = 0

        // Send via outgoing GATT connections (we are the client, write to their MSG char)
        outConns.forEach { (addr, gatt) ->
            val svc  = gatt.getService(SVC_UUID) ?: return@forEach
            val char = svc.getCharacteristic(MSG_UUID) ?: return@forEach
            char.value     = bytes
            char.writeType = BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
            if (gatt.writeCharacteristic(char)) {
                sent++
            } else {
                android.util.Log.w("BleModule", "writeCharacteristic failed for $addr")
            }
        }

        // Send via server NOTIFY to devices connected to us (they enabled notifications)
        val notifyChar = gattServer?.getService(SVC_UUID)?.getCharacteristic(NOTIFY_UUID)
        if (notifyChar != null && inConns.isNotEmpty()) {
            notifyChar.value = bytes
            inConns.values.forEach { device ->
                val ok = gattServer?.notifyCharacteristicChanged(device, notifyChar, false) ?: false
                if (ok == true) sent++
            }
        }

        android.util.Log.d("BleModule", "sendMessage: dispatched to $sent peers")
        promise.resolve(sent)
    }

    @ReactMethod
    fun stop(promise: Promise) {
        try {
            unregisterBtStateReceiver()
            advCb?.let { btAdap.bluetoothLeAdvertiser?.stopAdvertising(it) }
            bleScan?.stopScan(scanCb)
            outConns.values.forEach { it.disconnect(); it.close() }
            outConns.clear()
            inConns.clear()
            inValidated.clear()
            peerNames.clear()
            connecting.clear()
            gattServer?.close()
            gattServer = null
            promise.resolve(true)
        } catch (e: Exception) {
            promise.resolve(true) // best-effort stop
        }
    }

    @ReactMethod
    fun getConnectedCount(promise: Promise) = promise.resolve(peerCount)

    @ReactMethod fun addListener(eventName: String) {}
    @ReactMethod fun removeListeners(count: Int) {}

    // ─── Private helpers ──────────────────────────────────────────────────────

    private fun openGattServer() {
        gattServer = btMgr.openGattServer(reactContext, serverCb)
        val svc = BluetoothGattService(SVC_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY)

        // Writable characteristic: remote clients write messages/name to us
        svc.addCharacteristic(BluetoothGattCharacteristic(
            MSG_UUID,
            BluetoothGattCharacteristic.PROPERTY_WRITE or
                BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE,
            BluetoothGattCharacteristic.PERMISSION_WRITE
        ))
        svc.addCharacteristic(BluetoothGattCharacteristic(
            NAME_UUID,
            BluetoothGattCharacteristic.PROPERTY_WRITE,
            BluetoothGattCharacteristic.PERMISSION_WRITE
        ))

        // Notifiable characteristic: we push messages to subscribed clients
        val notifyChar = BluetoothGattCharacteristic(
            NOTIFY_UUID,
            BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_READ
        )
        notifyChar.addDescriptor(BluetoothGattDescriptor(
            CCCD_UUID,
            BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE
        ))
        svc.addCharacteristic(notifyChar)

        gattServer?.addService(svc)
        android.util.Log.d("BleModule", "GATT server opened")
    }

    private fun startAdvertising() {
        val advertiser = btAdap.bluetoothLeAdvertiser
        if (advertiser == null) {
            android.util.Log.w("BleModule", "BLE advertising not supported on this device")
            return
        }
        val cb = object : AdvertiseCallback() {
            override fun onStartSuccess(s: AdvertiseSettings) {
                android.util.Log.d("BleModule", "✅ BLE advertising started")
            }
            override fun onStartFailure(errorCode: Int) {
                android.util.Log.e("BleModule", "BLE advertising failed: $errorCode")
            }
        }
        advCb = cb

        // Primary advertisement: service UUID only (21 bytes — within 31-byte BLE limit)
        // Device name goes in scan response to avoid ADVERTISE_FAILED_DATA_TOO_LARGE (error 1)
        val primaryData = AdvertiseData.Builder()
            .addServiceUuid(ParcelUuid(SVC_UUID))
            .setIncludeDeviceName(false)
            .setIncludeTxPowerLevel(false)
            .build()

        // Scan response: device name (scanner receives this on active scan)
        val scanResponse = AdvertiseData.Builder()
            .setIncludeDeviceName(true)
            .setIncludeTxPowerLevel(false)
            .build()

        advertiser.startAdvertising(
            AdvertiseSettings.Builder()
                .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
                .setConnectable(true)
                .setTimeout(0)
                .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
                .build(),
            primaryData,
            scanResponse,
            cb
        )
    }

    private fun startScanning() {
        val scanner = btAdap.bluetoothLeScanner
        if (scanner == null) {
            android.util.Log.w("BleModule", "BLE scanner not available")
            return
        }
        bleScan = scanner
        scanner.startScan(
            listOf(ScanFilter.Builder().setServiceUuid(ParcelUuid(SVC_UUID)).build()),
            ScanSettings.Builder()
                .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
                .setMatchMode(ScanSettings.MATCH_MODE_AGGRESSIVE)
                .setNumOfMatches(ScanSettings.MATCH_NUM_MAX_ADVERTISEMENT)
                .setCallbackType(ScanSettings.CALLBACK_TYPE_ALL_MATCHES)
                .build(),
            scanCb
        )
        android.util.Log.d("BleModule", "✅ BLE scanning started")
    }

    private fun registerBtStateReceiver() {
        if (btStateReceiver != null) return // already registered
        btStateReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                val state = intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR)
                if (state == BluetoothAdapter.STATE_TURNING_OFF || state == BluetoothAdapter.STATE_OFF) {
                    android.util.Log.w("BleModule", "Bluetooth turning off — clearing all peers")
                    // Snapshot current peers before clearing
                    val peersToNotify = allPeerAddrs.toSet()
                    // Close all outgoing GATT connections
                    outConns.values.forEach { try { it.disconnect(); it.close() } catch (_: Exception) {} }
                    outConns.clear()
                    inConns.clear()
                    inValidated.clear()
                    connecting.clear()
                    // Emit disconnect for each peer so JS count drops to 0
                    peersToNotify.forEach { addr ->
                        android.util.Log.d("BleModule", "BT off — evicting peer $addr")
                        emitDisconnected(addr)
                    }
                    peerNames.clear()
                }
            }
        }
        reactContext.registerReceiver(
            btStateReceiver,
            IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED)
        )
        android.util.Log.d("BleModule", "BT state receiver registered")
    }

    private fun unregisterBtStateReceiver() {
        btStateReceiver?.let {
            try { reactContext.unregisterReceiver(it) } catch (_: Exception) {}
            btStateReceiver = null
            android.util.Log.d("BleModule", "BT state receiver unregistered")
        }
    }

    private fun emitConnected(addr: String, name: String) =
        emit("NearbyPeerConnected", Arguments.createMap().apply {
            putString("endpointId",   addr)
            putString("endpointName", name)
            putInt("connectedCount",  peerCount)
        })

    private fun emitDisconnected(addr: String) =
        emit("NearbyPeerDisconnected", Arguments.createMap().apply {
            putString("endpointId",  addr)
            putInt("connectedCount", peerCount)
        })

    private fun emit(event: String, map: WritableMap) =
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(event, map)
}
