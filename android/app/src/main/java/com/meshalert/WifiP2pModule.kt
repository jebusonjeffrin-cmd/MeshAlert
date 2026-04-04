package com.meshalert

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiNetworkSpecifier
import android.net.wifi.WpsInfo
import android.net.wifi.p2p.*
import android.os.Build
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.*
import java.net.*
import java.util.concurrent.*

/**
 * WifiP2pModule — Dual-transport WiFi peer discovery.
 *
 * Transport A — NSD / mDNS (same WiFi AP or any shared subnet):
 *   Registers "_meshalert._tcp." service + discovers peers on the same subnet.
 *   Works whenever two phones are on the same LAN (home WiFi, office WiFi, etc.)
 *
 * Transport B — WiFi Direct Autonomous Group (completely offline):
 *   API 29+: creates a P2P group with a FIXED well-known SSID "DIRECT-MA" and
 *   passphrase "meshalert2024" — no dialog, no negotiation.
 *   The first device to succeed becomes the Group Owner (192.168.49.1).
 *   Other devices detect the group exists and join it directly via
 *   WifiNetworkSpecifier — also dialog-free on API 29+.
 *   Once on the 192.168.49.x subnet, NSD (Transport A) discovers the TCP server.
 *
 *   API < 29 fallback: standard discoverPeers() + connect() (may show a dialog
 *   on the receiving device, but is still functional).
 *
 * TCP server (port 8765) binds to 0.0.0.0 — accepts connections from
 * both the AP subnet and the P2P subnet simultaneously.
 * Group Owner relays every message to all other connected clients.
 *
 * Emits the same events as NearbyModule so NearbyService.ts only needs
 * the module-name changed to adopt this transport.
 */
class WifiP2pModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "WifiP2p"

    private companion object {
        const val PORT      = 8765
        const val SVC_TYPE  = "_meshalert._tcp."
        const val P2P_SSID  = "DIRECT-MA"          // fixed SSID every device knows
        const val P2P_PSK   = "meshalert2024"       // fixed passphrase
        const val TAG       = "WifiP2p"
    }

    // ── System services ───────────────────────────────────────────────────────
    private val wm: WifiP2pManager by lazy {
        reactContext.getSystemService(Context.WIFI_P2P_SERVICE) as WifiP2pManager
    }
    private val nsd: NsdManager by lazy {
        reactContext.getSystemService(Context.NSD_SERVICE) as NsdManager
    }
    private val cm: ConnectivityManager by lazy {
        reactContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    }

    // ── State ─────────────────────────────────────────────────────────────────
    private var p2pChannel: WifiP2pManager.Channel? = null
    private var serverSock: ServerSocket? = null
    private var serverThread: Thread? = null
    private val tcpSockets   = CopyOnWriteArrayList<Socket>()
    private val connectedIPs = CopyOnWriteArraySet<String>()
    private val exec         = Executors.newCachedThreadPool()
    private var schedExec: ScheduledExecutorService? = null
    private var myName       = "MeshAlert"
    private var running      = false
    private var p2pRxReg     = false
    private var nsdSvcReg    = false
    private var nsdDiscovering = false
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    // ── WiFi P2P BroadcastReceiver ────────────────────────────────────────────

    private val p2pReceiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context, intent: Intent) {
            when (intent.action) {

                WifiP2pManager.WIFI_P2P_STATE_CHANGED_ACTION -> {
                    val s = intent.getIntExtra(WifiP2pManager.EXTRA_WIFI_STATE, -1)
                    log("P2P state: ${if (s == WifiP2pManager.WIFI_P2P_STATE_ENABLED) "ON" else "OFF"}")
                    if (s == WifiP2pManager.WIFI_P2P_STATE_ENABLED && running) {
                        p2pChannel?.let { launchP2pGroup(it) }
                    }
                }

                // ── KEY FIX: auto-connect to every discovered peer ─────────────
                WifiP2pManager.WIFI_P2P_PEERS_CHANGED_ACTION -> {
                    val c = p2pChannel ?: return
                    wm.requestPeers(c) { list ->
                        log("P2P peers visible: ${list.deviceList.size}")
                        list.deviceList.forEach { dev ->
                            log("  Peer: ${dev.deviceName} GO=${dev.isGroupOwner}")
                            connectP2p(c, dev)
                        }
                    }
                }

                WifiP2pManager.WIFI_P2P_CONNECTION_CHANGED_ACTION -> {
                    val c = p2pChannel ?: return
                    val info: WifiP2pInfo? = parcelable(intent,
                        WifiP2pManager.EXTRA_WIFI_P2P_INFO, WifiP2pInfo::class.java)
                    val net: android.net.NetworkInfo? = parcelable(intent,
                        WifiP2pManager.EXTRA_NETWORK_INFO, android.net.NetworkInfo::class.java)
                    log("P2P connection: connected=${net?.isConnected} GO=${info?.isGroupOwner} groupFormed=${info?.groupFormed}")
                    if (net?.isConnected == true && info?.groupFormed == true) {
                        if (info.isGroupOwner) {
                            // Already have server running; log only
                            log("Confirmed Group Owner — TCP server on :$PORT")
                        } else {
                            val ip = info.groupOwnerAddress?.hostAddress ?: "192.168.49.1"
                            log("P2P client — GO at $ip")
                            connectTCP(ip)
                        }
                    } else if (net?.isConnected == false && running) {
                        log("P2P group dissolved — relaunching")
                        connectedIPs.clear()
                        p2pChannel?.let { launchP2pGroup(it) }
                    }
                }

                WifiP2pManager.WIFI_P2P_DISCOVERY_CHANGED_ACTION -> {
                    val s = intent.getIntExtra(WifiP2pManager.EXTRA_DISCOVERY_STATE, -1)
                    log("P2P discovery: ${if (s == WifiP2pManager.WIFI_P2P_DISCOVERY_STARTED) "started" else "stopped"}")
                    // Restart if stopped unexpectedly
                    if (s == WifiP2pManager.WIFI_P2P_DISCOVERY_STOPPED && running) {
                        exec.submit { Thread.sleep(3000); p2pChannel?.let { c -> wm.discoverPeers(c, al {}) } }
                    }
                }
            }
        }
    }

    // ── @ReactMethod API ──────────────────────────────────────────────────────

    @ReactMethod
    fun start(deviceName: String, promise: Promise) {
        myName  = deviceName
        running = true
        connectedIPs.clear()

        // Fresh P2P channel every time (prevents stale state after screen-off)
        p2pChannel?.let { old ->
            try { wm.stopPeerDiscovery(old, null); wm.removeGroup(old, null) } catch (_: Exception) {}
        }
        p2pChannel = wm.initialize(reactContext, reactContext.mainLooper, null)

        if (!p2pRxReg) {
            val f = IntentFilter().apply {
                addAction(WifiP2pManager.WIFI_P2P_STATE_CHANGED_ACTION)
                addAction(WifiP2pManager.WIFI_P2P_PEERS_CHANGED_ACTION)
                addAction(WifiP2pManager.WIFI_P2P_CONNECTION_CHANGED_ACTION)
                addAction(WifiP2pManager.WIFI_P2P_DISCOVERY_CHANGED_ACTION)
            }
            reactContext.registerReceiver(p2pReceiver, f)
            p2pRxReg = true
        }

        // 1. TCP server binds to all interfaces (AP subnet + P2P subnet)
        startTCPServer()

        // 2. NSD — advertise + discover on any shared subnet (handles same-AP case)
        registerNsdService()
        startNsdDiscovery()

        // 3. WiFi Direct — autonomous group (handles offline/no-AP case)
        p2pChannel?.let { launchP2pGroup(it) }

        // 4. Periodic rediscovery
        scheduleRediscovery()

        promise.resolve(true)
        log("Started as: $deviceName")
    }

    @ReactMethod
    fun sendMessage(message: String, promise: Promise) {
        val bytes = (message + "\n").toByteArray()
        val dead  = mutableListOf<Socket>()
        var sent  = 0
        tcpSockets.filter { !it.isClosed }.forEach { s ->
            try { s.getOutputStream().apply { write(bytes); flush() }; sent++ }
            catch (e: Exception) { dead.add(s) }
        }
        dead.forEach { tcpSockets.remove(it); connectedIPs.remove(it.inetAddress?.hostAddress) }
        promise.resolve(sent)
    }

    @ReactMethod
    fun stop(promise: Promise) {
        running = false
        schedExec?.shutdown(); schedExec = null
        stopNsd()
        networkCallback?.let { try { cm.unregisterNetworkCallback(it) } catch (_: Exception) {} }
        networkCallback = null
        if (p2pRxReg) {
            try { reactContext.unregisterReceiver(p2pReceiver) } catch (_: Exception) {}
            p2pRxReg = false
        }
        serverThread?.interrupt()
        silentClose(serverSock); serverSock = null
        tcpSockets.forEach { silentClose(it) }; tcpSockets.clear()
        connectedIPs.clear()
        p2pChannel?.let { c ->
            try { wm.removeGroup(c, null) } catch (_: Exception) {}
            try { wm.stopPeerDiscovery(c, null) } catch (_: Exception) {}
            try { wm.clearLocalServices(c, null) } catch (_: Exception) {}
        }
        exec.shutdown()
        promise.resolve(true)
    }

    @ReactMethod
    fun getConnectedCount(promise: Promise) = promise.resolve(tcpSockets.count { !it.isClosed })

    @ReactMethod fun addListener(e: String) {}
    @ReactMethod fun removeListeners(n: Int) {}

    // ── WiFi Direct: Autonomous Group ─────────────────────────────────────────

    private fun launchP2pGroup(c: WifiP2pManager.Channel) {
        // Check if already in a group
        wm.requestGroupInfo(c) { group ->
            when {
                group != null && group.isGroupOwner -> {
                    log("Already P2P Group Owner: ${group.networkName}")
                    // Ensure TCP server is running
                    startTCPServer()
                }
                group != null && !group.isGroupOwner -> {
                    log("Already P2P client in group: ${group.networkName}")
                    // Request connection info to get GO IP
                    wm.requestConnectionInfo(c) { info ->
                        info.groupOwnerAddress?.hostAddress?.let { ip -> connectTCP(ip) }
                    }
                }
                else -> {
                    // No group — try to create one autonomously (no dialog!)
                    createAutonomousGroup(c)
                }
            }
        }
    }

    private fun createAutonomousGroup(c: WifiP2pManager.Channel) {
        if (Build.VERSION.SDK_INT >= 29) {
            // API 29+: create group with FIXED SSID + PSK so ALL devices know the credentials
            val config = WifiP2pConfig.Builder()
                .setNetworkName(P2P_SSID)
                .setPassphrase(P2P_PSK)
                .build()
            wm.createGroup(c, config, al { ok ->
                if (ok) {
                    log("Autonomous group created — I am GO ($P2P_SSID)")
                    startTCPServer()
                } else {
                    log("createGroup failed — group may already exist, trying to join")
                    joinKnownGroup()
                }
            })
        } else {
            // API < 29: create random group (others can't join without dialog)
            wm.createGroup(c, al { ok ->
                if (ok) {
                    log("Legacy group created — I am GO")
                    startTCPServer()
                } else {
                    log("Legacy createGroup failed — falling back to discoverPeers")
                    wm.discoverPeers(c, al { ok2 -> log("discoverPeers: $ok2") })
                }
            })
        }
    }

    /**
     * API 29+: Join the well-known "DIRECT-MA" group via WifiNetworkSpecifier.
     * This approach is completely dialog-free and binds our sockets to the P2P network.
     */
    private fun joinKnownGroup() {
        if (Build.VERSION.SDK_INT < 29) {
            // Fallback: use discoverPeers (may show dialog on receiving end)
            p2pChannel?.let { c -> wm.discoverPeers(c, al { ok -> log("discoverPeers fallback: $ok") }) }
            return
        }

        val spec = WifiNetworkSpecifier.Builder()
            .setSsid(P2P_SSID)
            .setWpa2Passphrase(P2P_PSK)
            .build()

        val req = NetworkRequest.Builder()
            .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
            .setNetworkSpecifier(spec)
            .build()

        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                log("Joined P2P group via WifiNetworkSpecifier — binding to network")
                // Bind our process sockets to this network
                cm.bindProcessToNetwork(network)
                // GO is always 192.168.49.1 in WiFi Direct
                connectTCP("192.168.49.1")
            }
            override fun onLost(network: Network) {
                log("P2P network lost — relaunching")
                cm.bindProcessToNetwork(null)
                if (running) p2pChannel?.let { launchP2pGroup(it) }
            }
            override fun onUnavailable() {
                log("P2P group unavailable — retry in 10s")
                exec.submit {
                    Thread.sleep(10_000)
                    if (running) p2pChannel?.let { launchP2pGroup(it) }
                }
            }
        }

        // Unregister previous callback if any
        networkCallback?.let { try { cm.unregisterNetworkCallback(it) } catch (_: Exception) {} }
        networkCallback = cb
        cm.requestNetwork(req, cb)
        log("WifiNetworkSpecifier request sent for $P2P_SSID")
    }

    // ── WiFi Direct: peer-level connect (used when peers appear in scan) ──────

    private fun connectP2p(c: WifiP2pManager.Channel, device: WifiP2pDevice) {
        val cfg = WifiP2pConfig().apply {
            deviceAddress    = device.deviceAddress
            wps.setup        = WpsInfo.PBC
            groupOwnerIntent = 0  // prefer to be client (GO is already running)
        }
        wm.connect(c, cfg, al { ok ->
            log("P2P connect(${device.deviceName}): ${if (ok) "initiated" else "failed"}")
        })
    }

    // ── NSD (mDNS) ───────────────────────────────────────────────────────────

    private val nsdRegListener = object : NsdManager.RegistrationListener {
        override fun onServiceRegistered(i: NsdServiceInfo) { log("NSD registered: ${i.serviceName}"); nsdSvcReg = true }
        override fun onRegistrationFailed(i: NsdServiceInfo, c: Int) { log("NSD reg failed: $c") }
        override fun onServiceUnregistered(i: NsdServiceInfo) { nsdSvcReg = false }
        override fun onUnregistrationFailed(i: NsdServiceInfo, c: Int) {}
    }

    private val nsdDiscListener = object : NsdManager.DiscoveryListener {
        override fun onDiscoveryStarted(t: String) { log("NSD discovery started"); nsdDiscovering = true }
        override fun onDiscoveryStopped(t: String) { log("NSD discovery stopped"); nsdDiscovering = false }
        override fun onStartDiscoveryFailed(t: String, c: Int) { log("NSD start failed: $c"); nsdDiscovering = false }
        override fun onStopDiscoveryFailed(t: String, c: Int) {}
        override fun onServiceFound(info: NsdServiceInfo) {
            if (info.serviceType.contains("meshalert", ignoreCase = true) ||
                info.serviceName.contains("MeshAlert", ignoreCase = true)) {
                log("NSD found: ${info.serviceName}")
                try {
                    nsd.resolveService(info, object : NsdManager.ResolveListener {
                        override fun onResolveFailed(i: NsdServiceInfo, c: Int) { log("NSD resolve failed: $c") }
                        override fun onServiceResolved(i: NsdServiceInfo) {
                            val ip = i.host?.hostAddress ?: return
                            log("NSD resolved: $ip:${i.port}")
                            connectTCP(ip)
                        }
                    })
                } catch (e: Exception) { log("NSD resolve err: ${e.message}") }
            }
        }
        override fun onServiceLost(info: NsdServiceInfo) { log("NSD lost: ${info.serviceName}") }
    }

    private fun registerNsdService() {
        if (nsdSvcReg) return
        try {
            nsd.registerService(NsdServiceInfo().apply {
                serviceName = "MeshAlert-$myName"
                serviceType = SVC_TYPE
                port = PORT
            }, NsdManager.PROTOCOL_DNS_SD, nsdRegListener)
        } catch (e: Exception) { log("NSD register err: ${e.message}") }
    }

    private fun startNsdDiscovery() {
        if (nsdDiscovering) return
        try {
            nsd.discoverServices(SVC_TYPE, NsdManager.PROTOCOL_DNS_SD, nsdDiscListener)
        } catch (e: Exception) { log("NSD discover err: ${e.message}") }
    }

    private fun stopNsd() {
        if (nsdDiscovering) try { nsd.stopServiceDiscovery(nsdDiscListener) } catch (_: Exception) {}
        if (nsdSvcReg) try { nsd.unregisterService(nsdRegListener) } catch (_: Exception) {}
        nsdDiscovering = false; nsdSvcReg = false
    }

    // ── TCP Server ────────────────────────────────────────────────────────────

    private fun startTCPServer() {
        if (serverSock?.isClosed == false && serverSock?.isBound == true) return
        silentClose(serverSock)
        serverThread = Thread {
            try {
                val ss = ServerSocket(PORT)
                serverSock = ss
                log("TCP server listening on :$PORT (all interfaces)")
                while (running && !ss.isClosed) {
                    val client = ss.accept()
                    val ip = client.inetAddress.hostAddress ?: continue
                    if (connectedIPs.add(ip)) {
                        tcpSockets.add(client)
                        log("TCP accepted: $ip  (peers: ${tcpSockets.count { !it.isClosed }})")
                        emitConnected(ip)
                        exec.submit { readLoop(client) }
                    } else {
                        silentClose(client)  // duplicate
                    }
                }
            } catch (e: Exception) {
                if (running) log("TCP server error: ${e.message}")
            }
        }.also { it.isDaemon = true; it.start() }
    }

    // ── TCP Client ────────────────────────────────────────────────────────────

    private fun connectTCP(ip: String) {
        if (!connectedIPs.add(ip)) { log("Already connected/connecting to $ip"); return }
        exec.submit {
            var attempt = 0
            while (running && attempt < 6) {
                try {
                    val s = Socket()
                    s.connect(InetSocketAddress(ip, PORT), 4000)
                    tcpSockets.add(s)
                    log("TCP connected to $ip (attempt ${attempt + 1})")
                    emitConnected(ip)
                    readLoop(s)
                    return@submit
                } catch (e: Exception) {
                    log("TCP to $ip attempt ${attempt + 1}/6: ${e.message}")
                    attempt++
                    Thread.sleep(2000L * attempt)
                }
            }
            connectedIPs.remove(ip)  // allow retry after full failure
            log("TCP to $ip failed after 6 attempts")
        }
    }

    // ── Read Loop (relay hub) ─────────────────────────────────────────────────

    private fun readLoop(socket: Socket) {
        val ip = socket.inetAddress.hostAddress ?: "?"
        try {
            val reader = BufferedReader(InputStreamReader(socket.getInputStream()))
            var line: String?
            while (reader.readLine().also { line = it } != null) {
                val msg = line ?: continue
                // Relay to all OTHER connected sockets (hub topology)
                tcpSockets.filter { it !== socket && !it.isClosed }.forEach { other ->
                    try { other.getOutputStream().apply { write((msg + "\n").toByteArray()); flush() } }
                    catch (e: Exception) { /* cleaned up by their own readLoop */ }
                }
                emitMessage(ip, msg)
            }
        } catch (e: Exception) {
            if (running) log("readLoop $ip: ${e.message}")
        } finally {
            tcpSockets.remove(socket)
            connectedIPs.remove(ip)
            silentClose(socket)
            emitDisconnected(ip)
        }
    }

    // ── Periodic rediscovery ──────────────────────────────────────────────────

    private fun scheduleRediscovery() {
        schedExec?.shutdown()
        schedExec = Executors.newSingleThreadScheduledExecutor().also { svc ->
            svc.scheduleAtFixedRate({
                if (!running) return@scheduleAtFixedRate
                val active = tcpSockets.count { !it.isClosed }
                log("Heartbeat — TCP peers: $active")
                if (active == 0) {
                    connectedIPs.clear()
                    // Re-attempt group creation or join
                    p2pChannel?.let { launchP2pGroup(it) }
                    // Restart NSD if stopped
                    if (!nsdDiscovering) startNsdDiscovery()
                }
            }, 15, 15, TimeUnit.SECONDS)
        }
    }

    // ── Events ────────────────────────────────────────────────────────────────

    private fun emitConnected(ip: String) = emit("NearbyPeerConnected", Arguments.createMap().apply {
        putString("endpointId",   ip)
        putString("endpointName", "WiFi-${ip.takeLast(5)}")
        putInt("connectedCount",  tcpSockets.count { !it.isClosed })
    })

    private fun emitDisconnected(ip: String) = emit("NearbyPeerDisconnected", Arguments.createMap().apply {
        putString("endpointId",  ip)
        putInt("connectedCount", tcpSockets.count { !it.isClosed })
    })

    private fun emitMessage(ip: String, msg: String) = emit("NearbyMessageReceived", Arguments.createMap().apply {
        putString("endpointId", ip)
        putString("message",    msg)
    })

    private fun emit(event: String, map: WritableMap) {
        if (!reactContext.hasActiveReactInstance()) return
        reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(event, map)
    }

    // ── Utilities ─────────────────────────────────────────────────────────────

    private fun log(msg: String) = android.util.Log.d(TAG, msg)

    private fun al(block: (Boolean) -> Unit) = object : WifiP2pManager.ActionListener {
        override fun onSuccess()          = block(true)
        override fun onFailure(r: Int) { log("AL fail=$r"); block(false) }
    }

    private fun silentClose(c: Closeable?) { try { c?.close() } catch (_: Exception) {} }

    @Suppress("DEPRECATION")
    private fun <T> parcelable(intent: Intent, key: String, clazz: Class<T>): T? =
        if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(key, clazz)
        else intent.getParcelableExtra(key)
}
