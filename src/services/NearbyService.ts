/**
 * NearbyService — BLE mesh layer.
 * Wraps NearbyModule (NearbyConnections native module) with JS-side peer tracking.
 */
import { NativeEventEmitter, NativeModules } from 'react-native';
import { MeshMessage, PeerDevice } from '../types';

const { NearbyConnections } = NativeModules;

const bleEmitter = NearbyConnections ? new NativeEventEmitter(NearbyConnections) : null;

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
  private isInitialized = false; // FIX: guard against multiple initialize() calls

  setLocalDeviceId(id: string) { this.localDeviceId = id; }

  async initialize(deviceId: string, name: string): Promise<boolean> {
    this.localDeviceId = deviceId;
    this.localName     = name;

    // FIX: if already initialized, just update name and return — do NOT re-register listeners
    if (this.isInitialized) {
      console.log('[Nearby] Already initialized — skipping duplicate init');
      return true;
    }

    const hasBLE = !!NearbyConnections;
    if (!hasBLE) {
      console.error('[Nearby] No native transport modules found — rebuild APK');
      return false;
    }

    const onConnected = ({ endpointId, endpointName }: any) => {
      const display = endpointName ?? endpointId.slice(-8);
      console.log('[Nearby] Peer connected:', display, '(', endpointId, ')');

      // FIX: MAC address randomization — the same physical device may reconnect with a
      // different random MAC address. If we find an existing peer by name, re-key the map
      // so disconnect events (using new ID) correctly remove the peer.
      const existingEntry = endpointName
        ? Array.from(this.peers.entries()).find(([, p]) => p.name === endpointName)
        : null;

      if (existingEntry) {
        const [oldKey, existingPeer] = existingEntry;
        existingPeer.lastSeen = Date.now();
        if (oldKey !== endpointId) {
          // Re-key: remove old MAC, add under new MAC so future disconnect hits correctly
          this.peers.delete(oldKey);
          this.peers.set(endpointId, existingPeer);
          console.log('[Nearby] Re-keyed peer', display, 'from', oldKey.slice(-8), '→', endpointId.slice(-8));
        }
      } else {
        this.peers.set(endpointId, {
          deviceId: endpointId, name: display,
          rssi: -70, lastSeen: Date.now(),
        });
      }
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
        console.log('[Nearby] Message from', peerName, ':', msg.type, msg.emergencyType ?? '');
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

    this.isInitialized = true; // FIX: mark initialized BEFORE await so concurrent calls are blocked

    let bleOk = false;
    try {
      await NearbyConnections.start(name);
      bleOk = true;
      console.log('[Nearby] BLE transport started');
    } catch (e: any) {
      console.warn('[Nearby] BLE start failed:', e?.message);
      this.isInitialized = false; // allow retry if start failed
    }

    this.watchdogTimer = setInterval(async () => {
      if (this.peers.size === 0) {
        console.log('[Nearby] Watchdog: 0 peers — restarting BLE');
        try { await NearbyConnections.start(this.localName); } catch {}
      }
    }, 30_000);

    return bleOk;
  }

  async broadcastMessage(msg: MeshMessage): Promise<number> {
    const json  = JSON.stringify(msg);
    let   total = 0;
    if (NearbyConnections) { try { total += await NearbyConnections.sendMessage(json); } catch {} }
    if (total > 0) console.log('[Nearby] Sent', msg.type, 'to', total, 'peers');
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
    this.subs = [];
    this.isInitialized = false;
    this.peers.clear();
    NearbyConnections?.stop().catch(() => {});
  }
}

export const nearbyService = new NearbyService();
