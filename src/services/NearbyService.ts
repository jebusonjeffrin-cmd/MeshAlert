/**
 * NearbyService — Google Nearby Connections API wrapper.
 *
 * Uses Strategy.P2P_CLUSTER: every device can connect to every other device
 * simultaneously (true mesh, not star topology).
 *
 * Transport: Nearby Connections automatically picks the best available
 * transport — WiFi Direct (~200m), Hotspot, BLE (~50m), or Bluetooth Classic.
 * No internet required.
 *
 * Messages are full JSON — no 20-byte limit.
 */
import { NativeEventEmitter, NativeModules } from 'react-native';
import { MeshMessage, PeerDevice } from '../types';

const { NearbyConnections } = NativeModules;
const emitter = new NativeEventEmitter(NearbyConnections);

type MessageHandler = (msg: MeshMessage, fromEndpointId: string) => void;
type PeerHandler    = (peers: PeerDevice[]) => void;

class NearbyService {
  private peers: Map<string, PeerDevice> = new Map();
  private msgHandlers: MessageHandler[] = [];
  private peerHandlers: PeerHandler[] = [];
  private localDeviceId = '';
  private localName = 'Survivor';
  private subs: (() => void)[] = [];
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;

  setLocalDeviceId(id: string) { this.localDeviceId = id; }

  async initialize(deviceId: string, name: string): Promise<boolean> {
    this.localDeviceId = deviceId;
    this.localName     = name;

    if (!NearbyConnections) {
      console.error('[Nearby] NativeModule not found — did you rebuild the APK?');
      return false;
    }

    // Listen for peer connections (endpointName now included from native)
    const s1 = emitter.addListener('NearbyPeerConnected', ({ endpointId, endpointName, connectedCount }) => {
      const displayName = endpointName ?? endpointId.slice(-8);
      console.log('[Nearby] ✅ Peer connected:', displayName, '— total:', connectedCount);
      this.peers.set(endpointId, {
        deviceId: endpointId,
        name: displayName,
        rssi: -70,
        lastSeen: Date.now(),
      });
      this.notifyPeers();
    });

    const s2 = emitter.addListener('NearbyPeerDisconnected', ({ endpointId }) => {
      const peer = this.peers.get(endpointId);
      console.log('[Nearby] Peer disconnected:', peer?.name ?? endpointId.slice(-8));
      this.peers.delete(endpointId);
      this.notifyPeers();
    });

    const s3 = emitter.addListener('NearbyMessageReceived', ({ endpointId, message }) => {
      try {
        const msg: MeshMessage = JSON.parse(message);
        const peerName = this.peers.get(endpointId)?.name ?? endpointId.slice(-8);
        console.log('[Nearby] 📨 Message from', peerName, ':', msg.type, msg.emergencyType ?? '');
        const peer = this.peers.get(endpointId);
        if (peer) { peer.lastSeen = Date.now(); peer.name = msg.senderName ?? peer.name; }
        this.msgHandlers.forEach(h => h(msg, endpointId));
      } catch (e) {
        console.warn('[Nearby] Failed to parse message:', e);
      }
    });

    this.subs = [
      () => s1.remove(),
      () => s2.remove(),
      () => s3.remove(),
    ];

    try {
      await NearbyConnections.start(name);
      console.log('[Nearby] ✅ Started — advertising + discovering as:', name);

      // Watchdog: if 0 peers for 90s, restart advertising+discovery
      this.watchdogTimer = setInterval(async () => {
        if (this.peers.size === 0) {
          console.log('[Nearby] Watchdog: 0 peers — restarting advertising+discovery');
          try { await NearbyConnections.start(this.localName); } catch { /* retry next cycle */ }
        }
      }, 30_000);

      return true;
    } catch (e: any) {
      console.error('[Nearby] Start failed:', e.message ?? e);
      return false;
    }
  }

  async broadcastMessage(msg: MeshMessage): Promise<number> {
    try {
      const count = await NearbyConnections.sendMessage(JSON.stringify(msg));
      console.log('[Nearby] 📤 Sent', msg.type, 'to', count, 'peers');
      return count;
    } catch (e: any) {
      console.warn('[Nearby] Send failed:', e.message);
      return 0;
    }
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
    const list = Array.from(this.peers.values());
    this.peerHandlers.forEach(h => h(list));
  }

  destroy(): void {
    if (this.watchdogTimer) { clearInterval(this.watchdogTimer); this.watchdogTimer = null; }
    this.subs.forEach(unsub => unsub());
    NearbyConnections?.stop().catch(() => {});
  }
}

export const nearbyService = new NearbyService();
