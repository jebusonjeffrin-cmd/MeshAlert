package com.meshalert

import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.google.android.gms.nearby.Nearby
import com.google.android.gms.nearby.connection.*

class NearbyModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "NearbyConnections"

    private val client by lazy { Nearby.getConnectionsClient(reactContext) }
    private val connected = mutableSetOf<String>()
    private val endpointNames = mutableMapOf<String, String>()
    private val SERVICE_ID = "com.meshalert.mesh"

    private val connectionCallback = object : ConnectionLifecycleCallback() {
        override fun onConnectionInitiated(endpointId: String, info: ConnectionInfo) {
            // Cache the human-readable name for use in the connected event
            endpointNames[endpointId] = info.endpointName
            // Auto-accept every incoming connection from a MeshAlert peer
            client.acceptConnection(endpointId, payloadCallback)
        }

        override fun onConnectionResult(endpointId: String, result: ConnectionResolution) {
            android.util.Log.d("NearbyModule", "ConnectionResult $endpointId: code=${result.status.statusCode} msg=${result.status.statusMessage} success=${result.status.isSuccess}")
            if (result.status.isSuccess) {
                connected.add(endpointId)
                emit("NearbyPeerConnected", Arguments.createMap().apply {
                    putString("endpointId", endpointId)
                    putString("endpointName", endpointNames[endpointId] ?: endpointId.takeLast(8))
                    putInt("connectedCount", connected.size)
                })
            } else {
                android.util.Log.w("NearbyModule", "Connection to $endpointId rejected: ${result.status.statusMessage}")
            }
        }

        override fun onDisconnected(endpointId: String) {
            connected.remove(endpointId)
            endpointNames.remove(endpointId)
            emit("NearbyPeerDisconnected", Arguments.createMap().apply {
                putString("endpointId", endpointId)
                putInt("connectedCount", connected.size)
            })
        }
    }

    private val discoveryCallback = object : EndpointDiscoveryCallback() {
        override fun onEndpointFound(endpointId: String, info: DiscoveredEndpointInfo) {
            // Only connect to other MeshAlert devices
            if (info.serviceId == SERVICE_ID) {
                client.requestConnection(
                    android.os.Build.MODEL,
                    endpointId,
                    connectionCallback
                ).addOnFailureListener { /* already connected or rejected — ignore */ }
            }
        }

        override fun onEndpointLost(endpointId: String) {
            connected.remove(endpointId)
        }
    }

    private val payloadCallback = object : PayloadCallback() {
        override fun onPayloadReceived(endpointId: String, payload: Payload) {
            payload.asBytes()?.let { bytes ->
                emit("NearbyMessageReceived", Arguments.createMap().apply {
                    putString("endpointId", endpointId)
                    putString("message", String(bytes, Charsets.UTF_8))
                })
            }
        }

        override fun onPayloadTransferUpdate(endpointId: String, update: PayloadTransferUpdate) {}
    }

    @ReactMethod
    fun start(deviceName: String, promise: Promise) {
        // Default options → BLE transport. Works fully offline (no WiFi/internet needed).
        // Do NOT setLowPower(false) — that triggers WiFi Aware (NAN) on Samsung Android 12+
        // which requires internet for cluster auth → causes 0 peers offline.
        val advOptions = AdvertisingOptions.Builder()
            .setStrategy(Strategy.P2P_CLUSTER)
            .build()
        val discOptions = DiscoveryOptions.Builder()
            .setStrategy(Strategy.P2P_CLUSTER)
            .build()

        var resolved = false
        fun tryResolve() {
            if (!resolved) { resolved = true; promise.resolve(true) }
        }

        // Advertising is best-effort — if it fails (some devices), log and continue.
        // Discovery-only mode can still find peers that ARE advertising.
        client.startAdvertising(deviceName, SERVICE_ID, connectionCallback, advOptions)
            .addOnSuccessListener {
                android.util.Log.d("NearbyModule", "Advertising started as: $deviceName")
            }
            .addOnFailureListener { e ->
                android.util.Log.w("NearbyModule", "Advertising failed (discovery-only): ${e.message}")
                // Don't reject — discovery still works
            }

        // Start discovery unconditionally in parallel with advertising
        client.startDiscovery(SERVICE_ID, discoveryCallback, discOptions)
            .addOnSuccessListener {
                android.util.Log.d("NearbyModule", "Discovery started")
                tryResolve()
            }
            .addOnFailureListener { e ->
                promise.reject("DISCOVERY_FAILED", e.message)
            }
    }

    @ReactMethod
    fun sendMessage(message: String, promise: Promise) {
        if (connected.isEmpty()) {
            promise.resolve(0)
            return
        }
        val bytes = message.toByteArray(Charsets.UTF_8)
        connected.forEach { endpointId ->
            client.sendPayload(endpointId, Payload.fromBytes(bytes))
        }
        promise.resolve(connected.size)
    }

    @ReactMethod
    fun stop(promise: Promise) {
        client.stopAllEndpoints()
        client.stopAdvertising()
        client.stopDiscovery()
        connected.clear()
        endpointNames.clear()
        promise.resolve(true)
    }

    @ReactMethod
    fun getConnectedCount(promise: Promise) {
        promise.resolve(connected.size)
    }

    // Required for NativeEventEmitter
    @ReactMethod fun addListener(eventName: String) {}
    @ReactMethod fun removeListeners(count: Int) {}

    private fun emit(event: String, params: WritableMap) {
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(event, params)
    }
}
