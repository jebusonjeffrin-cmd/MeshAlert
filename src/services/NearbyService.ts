/**
 * NearbyService — dual-transport mesh layer.
 *
 * Transport A: Google Nearby Connections (BLE)
 *   - Works fully offline, Bluetooth only, ~30-50 m
 *   - Module: NearbyConnections
 *
 * Transport B: WifiP2p (WiFi Direct + NSD/mDNS)
 *   - Works on same AP (LAN) and offline via autonomous P2P group
 *   - ~100-200 m range, WiFi must be ON
 *   - Module: WifiP2p
 *
 * Both transports emit the same event names. Peers and messages from
 * either transport are merged into a single pool. MeshService deduplicates
 * messages by messageId, so relaying over both transports is safe.
 */
import { NativeEventEmitter, NativeModules } from 'react-native';
import { MeshMessage, PeerDevice } from '../types';

const { NearbyConnections, WifiP2p } = NativeModules;

const bleEmitter  = NearbyConnections ? new NativeEventEmitter(NearbyConnections) : null;
const wifiEmitter = WifiP2p           ? new NativeEventEmitter(WifiP2p)           : null;

type MessageHandler = (msg: MeshMessage, fromEndpointId: string) => void;
type PeerHandler    = (peers: PeerDevice[]) => void;

class NearbyService {
  private peers: Map<string, PeerDevice> = new Map();
  private msgHandlers:  MessageHandler[] = [];
  private peerHandlers: PeerHandler[]    = [];
  private localDeviceId = '';
  private localName     = 'Survivor';
  private subs: (() => void)[]           = [];
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;

  setLocalDeviceId(id: string) { this.localDeviceId = id; }

  async initialize(deviceId: string, name: string): Promise<boolean> {
    this.localDeviceId = deviceId;
    this.localName     = name;

    const hasBLE  = !!NearbyConnections;
    const hasWiFi = !!WifiP2p;

    if (!hasBLE && !hasWiFi) {
      console.error('[Nearby] No native transport modules found — rebuild APK');
      return false;
    }

    const onConnected = ({ endpointId, endpointName, connectedCount }: any) => {
      const display = endpointName ?? endpointId.slice(-8);
      console.log('[Nearby] ✅ Peer connected:', display, '— total:', connectedCount);
      this.peers.set(endpointId, {
        deviceId: endpointId, name: display,
        rssi: -70, lastSeen: Date.now(),
      });
      this.notifyPeers();
    };

    const onDisconnected = ({ endpointId }: any) => {
      const peer = this.peers.get(endpointId);
      console.log('[Nearby] Peer disconnected:', peer?.name ?? endpointId.slice(-8));
      this.peers.delete(endpointId);
      this.notifyPeers();
    };

    const onMessage = ({ endpointId, message }: any) => {
      try {
        const msg: MeshMessage = JSON.parse(message);
        const peerName = this.peers.get(endpointId)?.name ?? endpointId.slice(-8);
        console.log('[Nearby] 📨 Message from', peerName, ':', msg.type, msg.emergencyType ?? '');
        const peer = this.peers.get(endpointId);
        if (peer) { peer.lastSeen = Date.now(); peer.name = msg.senderName ?? peer.name; }
        this.msgHandlers.forEach(h => h(msg, endpointId));
      } catch (e) {
        console.warn('[Nearby] Parse error:', e);
      }
    };

    if (bleEmitter) {
      const s1 = bleEmitter.addListener('NearbyPeerConnected',    onConnected);
      const s2 = bleEmitter.addListener('NearbyPeerDisconnected', onDisconnected);
      const s3 = bleEmitter.addListener('NearbyMessageReceived',  onMessage);
      this.subs.push(() => s1.remove(), () => s2.remove(), () => s3.remove());
    }

    if (wifiEmitter) {
      const s4 = wifiEmitter.addListener('NearbyPeerConnected',    onConnected);
      const s5 = wifiEmitter.addListener('NearbyPeerDisconnected', onDisconnected);
      const s6 = wifiEmitter.addListener('NearbyMessageReceived',  onMessage);
      this.subs.push(() => s4.remove(), () => s5.remove(), () => s6.remove());
    }

    let bleOk = false, wifiOk = false;

    if (hasBLE) {
      try {
        await NearbyConnections.start(name);
        bleOk = true;
        console.log('[Nearby] ✅ BLE transport started');
      } catch (e: any) {
        console.warn('[Nearby] BLE start failed:', e?.message);
      }
    }

    if (hasWiFi) {
      try {
        await WifiP2p.start(name);
        wifiOk = true;
        console.log('[Nearby] ✅ WiFi transport started');
      } catch (e: any) {
        console.warn('[Nearby] WiFi start failed:', e?.message);
      }
    }

    this.watchdogTimer = setInterval(async () => {
      if (this.peers.size === 0) {
        console.log('[Nearby] Watchdog: 0 peers — restarting transports');
        if (hasBLE)  { try { await NearbyConnections.start(this.localName); } catch {} }
        if (hasWiFi) { try { await WifiP2p.start(this.localName);           } catch {} }
      }
    }, 30_000);

    return bleOk || wifiOk;
  }

  async broadcastMessage(msg: MeshMessage): Promise<number> {
    const json  = JSON.stringify(msg);
    let   total = 0;
    if (NearbyConnections) { try { total += await NearbyConnections.sendMessage(json); } catch {} }
    if (WifiP2p)           { try { total += await WifiP2p.sendMessage(json);           } catch {} }
    if (total > 0) console.log('[Nearby] 📤 Sent', msg.type, 'to', total, 'peers total');
    return total;
  }

  getPeers(): PeerDevice[]  { return Array.from(this.peers.values()); }
  getPeerCount(): number    { return this.peers.size; }

  onMessage(h: MessageHandler): () => void {
    this.msgHandlers.push(h);
    return () => { this.msgHandlers = this.msgHandlers.filter(x => x !== h); };
  }

  onPeerUpdate(h: PeerHandler): () => void {
    this.peerHandlers.push(h);
    return () => { this.peerHandlers = this.peerHandlers.filter(x => x !== h); };
  }

  private notifyPeers(): void {
    this.peerHandlers.forEach(h => h(Array.from(this.peers.values())));
  }

  destroy(): void {
    if (this.watchdogTimer) { clearInterval(this.watchdogTimer); this.watchdogTimer = null; }
    this.subs.forEach(unsub => unsub());
    NearbyConnections?.stop().catch(() => {});
    WifiP2p?.stop().catch(() => {});
  }
}

export const nearbyService = new NearbyService();
