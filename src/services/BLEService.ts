/**
 * BLEService — advertisement-based mesh messaging.
 *
 * Why not GATT writes?
 * Both phones run react-native-ble-plx as BLE CENTRALS. Neither hosts a GATT
 * server, so writeCharacteristicWithResponseForService has nothing to write to.
 *
 * Solution: encode messages into BLE advertisement manufacturer data (20 bytes).
 * Every scan cycle each phone reads the manufacturer data of all nearby MeshAlert
 * devices and decodes any new messages from them. No connection needed.
 *
 * Encoding (20 bytes):
 *   [0]     messageType  1=SOS, 2=HEARTBEAT
 *   [1]     emergencyType  0=none, 1=MEDICAL, 2=TRAPPED, 3=SAFE
 *   [2-5]   senderId    first 4 bytes of deviceId hex
 *   [6-9]   latitude    int32 = lat*1e5, big-endian
 *   [10-13] longitude   int32 = lng*1e5, big-endian
 *   [14]    TTL
 *   [15-18] messageId   first 4 bytes of messageId hex (dedup key)
 *   [19]    hops count
 */
import { BleManager, Device, State } from 'react-native-ble-plx';
import { decode as b64Decode, encode as b64Encode } from 'base-64';
import {
  MESH_SERVICE_UUID, MESH_DEVICE_PREFIX,
  BLE_COMPANY_ID, BLE_SCAN_DURATION_MS, BLE_SCAN_PAUSE_MS,
  TX_POWER_AT_1M, PATH_LOSS_N,
} from '../utils/constants';
import { MeshMessage, PeerDevice } from '../types';

let BLEAdvertiser: any = null;
try {
  const mod = require('react-native-ble-advertiser');
  BLEAdvertiser = mod?.default ?? mod;
  if (!BLEAdvertiser || typeof BLEAdvertiser.broadcast !== 'function') {
    console.warn('[BLE] BLEAdvertiser not linked — this device cannot advertise');
    BLEAdvertiser = null;
  } else {
    console.log('[BLE] BLEAdvertiser loaded OK');
  }
} catch (e: any) {
  console.warn('[BLE] BLEAdvertiser require failed:', e?.message);
}

type MessageHandler = (msg: MeshMessage, fromDeviceId: string) => void;
type PeerHandler    = (peers: PeerDevice[]) => void;

// ── Encoding helpers ──────────────────────────────────────────────────────────

const MSG_TYPE   = { SOS: 1, HEARTBEAT: 2 } as const;
const ET_MAP     = { MEDICAL: 1, TRAPPED: 2, SAFE: 3 } as const;
const INV_TYPE   = { 1: 'SOS', 2: 'HEARTBEAT' } as Record<number, string>;
const INV_ET     = { 1: 'MEDICAL', 2: 'TRAPPED', 3: 'SAFE' } as Record<number, string>;

function int32ToBytes(n: number): number[] {
  const v = n | 0; // signed 32-bit
  return [(v >>> 24) & 0xFF, (v >>> 16) & 0xFF, (v >>> 8) & 0xFF, v & 0xFF];
}

function bytesToInt32(b: number[]): number {
  const u = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
  return u > 0x7FFFFFFF ? u - 0x100000000 : u;
}

function hexToBytes(hex: string, count: number): number[] {
  const clean = hex.replace(/-/g, '').slice(0, count * 2).padEnd(count * 2, '0');
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(parseInt(clean.slice(i * 2, i * 2 + 2), 16) || 0);
  return out;
}

function bytesToHex(bytes: number[]): string {
  return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
}

function encodeMessage(msg: MeshMessage): number[] {
  const bytes = new Array(20).fill(0);
  bytes[0] = MSG_TYPE[msg.type] ?? 0;
  bytes[1] = msg.emergencyType ? (ET_MAP[msg.emergencyType] ?? 0) : 0;
  const senderBytes = hexToBytes(msg.senderId.replace(/-/g, ''), 4);
  bytes[2] = senderBytes[0]; bytes[3] = senderBytes[1];
  bytes[4] = senderBytes[2]; bytes[5] = senderBytes[3];
  const latBytes = int32ToBytes(Math.round((msg.payload.latitude ?? 0) * 1e5));
  bytes[6]=latBytes[0]; bytes[7]=latBytes[1]; bytes[8]=latBytes[2]; bytes[9]=latBytes[3];
  const lngBytes = int32ToBytes(Math.round((msg.payload.longitude ?? 0) * 1e5));
  bytes[10]=lngBytes[0]; bytes[11]=lngBytes[1]; bytes[12]=lngBytes[2]; bytes[13]=lngBytes[3];
  bytes[14] = Math.max(0, Math.min(255, msg.ttl));
  const msgIdBytes = hexToBytes(msg.messageId.replace(/-/g, ''), 4);
  bytes[15]=msgIdBytes[0]; bytes[16]=msgIdBytes[1]; bytes[17]=msgIdBytes[2]; bytes[18]=msgIdBytes[3];
  bytes[19] = Math.min(255, msg.hops.length);
  return bytes;
}

function decodeMessage(data: string, senderName: string, fromDeviceId: string): MeshMessage | null {
  try {
    // Manufacturer data from ble-plx is base64. First 2 bytes are company ID.
    const raw = b64Decode(data).split('').map(c => c.charCodeAt(0));
    // Skip the 2-byte company ID prefix added by Android
    const bytes = raw.length >= 22 ? raw.slice(2) : raw;
    if (bytes.length < 20) return null;

    const type = INV_TYPE[bytes[0]];
    if (!type) return null;

    const senderId = bytesToHex(bytes.slice(2, 6));
    const lat = bytesToInt32(bytes.slice(6, 10)) / 1e5;
    const lng = bytesToInt32(bytes.slice(10, 14)) / 1e5;
    const ttl = bytes[14];
    const msgId = bytesToHex(bytes.slice(15, 19)) + '-adv';
    const hopsCount = bytes[19];

    if (ttl <= 0) return null;
    // Sanity check coordinates
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

    return {
      messageId: msgId,
      senderId,
      senderName,
      type: type as any,
      emergencyType: INV_ET[bytes[1]] as any ?? undefined,
      payload: { latitude: lat, longitude: lng },
      ttl,
      timestamp: Date.now(),
      hops: Array.from({ length: hopsCount }, (_, i) => i === hopsCount - 1 ? fromDeviceId : '?'),
      synced: false,
    };
  } catch { return null; }
}

// ── Distance helper ───────────────────────────────────────────────────────────
function rssiToMetres(rssi: number): number {
  return Math.pow(10, (TX_POWER_AT_1M - rssi) / (10 * PATH_LOSS_N));
}

// ── Service class ─────────────────────────────────────────────────────────────
class BLEService {
  private manager = new BleManager();
  private peers: Map<string, PeerDevice> = new Map();
  private isScanning = false;
  private isAdvertising = false;
  private scanTimer: ReturnType<typeof setTimeout> | null = null;
  private pauseTimer: ReturnType<typeof setTimeout> | null = null;
  private msgHandlers: MessageHandler[] = [];
  private peerHandlers: PeerHandler[] = [];
  private localDeviceId = '';
  private currentAdPayload: number[] | null = null;

  setLocalDeviceId(id: string) { this.localDeviceId = id; }

  // ── Init ───────────────────────────────────────────────────────────────────
  async initialize(): Promise<boolean> {
    return new Promise(resolve => {
      const sub = this.manager.onStateChange(state => {
        console.log('[BLE] Adapter state:', state);
        if (state === State.PoweredOn) {
          sub.remove();
          console.log('[BLE] ✅ Bluetooth powered on');
          resolve(true);
        } else if (state === State.PoweredOff || state === State.Unsupported) {
          sub.remove();
          console.warn('[BLE] ❌ Bluetooth unavailable:', state);
          resolve(false);
        }
      }, true);
    });
  }

  // ── Advertising ────────────────────────────────────────────────────────────
  startAdvertising(): void {
    if (!BLEAdvertiser) {
      console.warn('[BLE] Skipping advertise — BLEAdvertiser not available');
      return;
    }
    try {
      BLEAdvertiser.setCompanyId(BLE_COMPANY_ID);
      const payload = this.currentAdPayload ?? [];
      BLEAdvertiser.broadcast(MESH_SERVICE_UUID, payload, { includeDeviceName: true })
        .then(() => { this.isAdvertising = true; console.log('[BLE] ✅ Advertising started'); })
        .catch((e: Error) => console.warn('[BLE] Advertise failed:', e.message));
    } catch (e: any) { console.warn('[BLE] Advertise error:', e?.message); }
  }

  stopAdvertising(): void {
    if (!BLEAdvertiser) return;
    try { BLEAdvertiser.stopBroadcast().catch(() => {}); this.isAdvertising = false; } catch {}
  }

  // Update advertisement payload with a new message and restart advertising
  async advertiseMessage(msg: MeshMessage): Promise<void> {
    if (!BLEAdvertiser) return;
    this.currentAdPayload = encodeMessage(msg);
    try {
      BLEAdvertiser.setCompanyId(BLE_COMPANY_ID);
      if (this.isAdvertising) {
        await BLEAdvertiser.stopBroadcast().catch(() => {});
        await new Promise(r => setTimeout(r, 150));
      }
      await BLEAdvertiser.broadcast(MESH_SERVICE_UUID, this.currentAdPayload, { includeDeviceName: true });
      this.isAdvertising = true;
      console.log('[BLE] 📢 Advertising message:', msg.type, msg.emergencyType ?? '', 'TTL:', msg.ttl);
    } catch (e: any) { console.warn('[BLE] advertiseMessage error:', e?.message); }
  }

  // ── Scanning ───────────────────────────────────────────────────────────────
  startPeriodicScan(): void {
    console.log('[BLE] Starting periodic scan');
    this.doScan();
  }

  stopPeriodicScan(): void {
    if (this.scanTimer) clearTimeout(this.scanTimer);
    if (this.pauseTimer) clearTimeout(this.pauseTimer);
    this.manager.stopDeviceScan();
    this.isScanning = false;
  }

  private doScan(): void {
    if (this.isScanning) return;
    this.isScanning = true;

    // Phase 1: UUID-filtered (finds devices advertising our service UUID)
    console.log('[BLE] Phase 1: UUID scan');
    this.manager.startDeviceScan(
      [MESH_SERVICE_UUID],
      { allowDuplicates: false },
      (err, device) => {
        if (err) { console.warn('[BLE] UUID scan error:', err.message); return; }
        if (device) this.handleDevice(device, 'uuid');
      },
    );

    // Phase 2: Name-based fallback halfway through the window
    const switchTimer = setTimeout(() => {
      this.manager.stopDeviceScan();
      console.log('[BLE] Phase 2: Name scan');
      this.manager.startDeviceScan(null, { allowDuplicates: false }, (err, device) => {
        if (err) return;
        if (!device) return;
        const name = device.name ?? device.localName ?? '';
        if (name.startsWith(MESH_DEVICE_PREFIX)) this.handleDevice(device, 'name');
      });
    }, Math.floor(BLE_SCAN_DURATION_MS / 2));

    this.pauseTimer = setTimeout(() => {
      clearTimeout(switchTimer);
      this.manager.stopDeviceScan();
      this.isScanning = false;
      this.pruneStale();
      console.log('[BLE] Scan done. Peers:', this.peers.size, '— next in', BLE_SCAN_PAUSE_MS / 1000 + 's');
      this.scanTimer = setTimeout(() => this.doScan(), BLE_SCAN_PAUSE_MS);
    }, BLE_SCAN_DURATION_MS);
  }

  private handleDevice(device: Device, via: string): void {
    const name = device.name ?? device.localName ?? `${MESH_DEVICE_PREFIX}${device.id.slice(-6)}`;
    const dist = rssiToMetres(device.rssi ?? -100);

    // Update peer map
    const existing = this.peers.get(device.id);
    if (existing) {
      existing.lastSeen = Date.now();
      existing.rssi = device.rssi ?? existing.rssi;
      existing.distanceMetres = dist;
    } else {
      this.peers.set(device.id, {
        deviceId: device.id, name, rssi: device.rssi ?? -100,
        lastSeen: Date.now(), distanceMetres: dist,
      });
      this.notifyPeers();
      console.log('[BLE] New peer via', via + ':', name, 'RSSI:', device.rssi, `~${dist.toFixed(0)}m`);
    }

    // Decode message from manufacturer data (no GATT connection needed)
    if (device.manufacturerData) {
      const msg = decodeMessage(device.manufacturerData, name, device.id);
      if (msg && msg.senderId !== this.localDeviceId.replace(/-/g, '').slice(0, 8)) {
        console.log('[BLE] 📨 Message in advert from', name, ':', msg.type, msg.emergencyType ?? '', 'TTL:', msg.ttl);
        this.msgHandlers.forEach(h => h(msg, device.id));
      }
    }
  }

  // ── Broadcast ─────────────────────────────────────────────────────────────
  // Encodes message into advertisement manufacturer data so nearby phones pick it up during scan
  async broadcastMessage(msg: MeshMessage): Promise<number> {
    await this.advertiseMessage(msg);
    // Return peer count as "sent count" for logging — actual delivery is via scan
    return this.peers.size;
  }

  updatePeerLocation(deviceId: string, lat: number, lng: number): void {
    const peer = this.peers.get(deviceId);
    if (peer) { peer.latitude = lat; peer.longitude = lng; }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  private pruneStale(): void {
    const threshold = BLE_SCAN_DURATION_MS + BLE_SCAN_PAUSE_MS + 5_000;
    const now = Date.now();
    for (const [id, peer] of this.peers) {
      if (now - peer.lastSeen > threshold) this.peers.delete(id);
    }
    this.notifyPeers();
  }

  private notifyPeers(): void {
    const list = Array.from(this.peers.values());
    this.peerHandlers.forEach(h => h(list));
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

  destroy(): void {
    this.stopPeriodicScan();
    this.stopAdvertising();
    this.manager.destroy();
  }
}

export const bleService = new BLEService();
