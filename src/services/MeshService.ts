import { MESH_TTL_START, MAX_MESSAGE_AGE_MS, MAX_SEEN_IDS } from '../utils/constants';
import { MeshMessage, EmergencyType, BloodGroup } from '../types';
import { nearbyService } from './NearbyService';
import { storageService } from './StorageService';
import { locationService } from './LocationService';
import { syncService } from './SyncService';

type SOSHandler = (msg: MeshMessage) => void;

class MeshService {
  private seenIds: Set<string> = new Set();
  private seenQueue: string[] = [];
  private localDeviceId = '';
  private localName = 'Unknown';
  private sosHandlers: SOSHandler[] = [];
  private bleUnsub: (() => void) | null = null;
  private relayedCount = 0;

  async initialize(deviceId: string, name: string): Promise<void> {
    this.localDeviceId = deviceId;
    this.localName = name;
    nearbyService.setLocalDeviceId(deviceId);

    const stored = await storageService.getSeenIds();
    stored.forEach(id => this.markSeen(id));

    this.bleUnsub = nearbyService.onMessage((msg, fromId) => this.handleIncoming(msg, fromId));
    const started = await nearbyService.initialize(deviceId, name);
    if (!started) console.warn('[Mesh] NearbyService failed to start');
    console.log('[Mesh] Initialized as', deviceId.slice(-8), '/', name);
  }

  private async handleIncoming(msg: MeshMessage, fromId: string): Promise<void> {
    if (msg.senderId === this.localDeviceId) return;
    if (this.seenIds.has(msg.messageId)) return;
    if (Date.now() - msg.timestamp > MAX_MESSAGE_AGE_MS) return;
    if (msg.ttl <= 0) return;

    this.markSeen(msg.messageId);
    await storageService.saveSeenId(msg.messageId);
    await storageService.saveReceived(msg);

    // Queue relayed SOS for dashboard upload — any phone with internet will sync it
    if (msg.type === 'SOS') {
      await storageService.savePending(msg);
      syncService.triggerSync().catch(() => {});  // immediate non-blocking upload attempt
      this.sosHandlers.forEach(h => h(msg));
    }

    const relay: MeshMessage = { ...msg, ttl: msg.ttl - 1, hops: [...msg.hops, this.localDeviceId] };
    const n = await nearbyService.broadcastMessage(relay);
    this.relayedCount += n;
  }

  async sendSOS(
    emergencyType: EmergencyType,
    textMessage?: string,
    profile?: { bloodGroup?: BloodGroup; emergencyContacts?: string[]; medicalConditions?: string; allergies?: string },
    audioBase64?: string,
  ): Promise<boolean> {
    const loc = await locationService.getCurrentLocation();
    if (!loc) console.warn('[Mesh] No location for SOS');

    const msg: MeshMessage = {
      messageId: this.uuid(),
      senderId: this.localDeviceId,
      senderName: this.localName,
      type: 'SOS',
      emergencyType,
      payload: {
        latitude: loc?.latitude ?? 0,
        longitude: loc?.longitude ?? 0,
        message: textMessage,
        bloodGroup: profile?.bloodGroup,
        emergencyContacts: profile?.emergencyContacts,
        medicalConditions: profile?.medicalConditions,
        allergies: profile?.allergies,
        audioBase64,
      },
      ttl: MESH_TTL_START,
      timestamp: Date.now(),
      hops: [this.localDeviceId],
    };

    this.markSeen(msg.messageId);
    await storageService.savePending(msg);
    await storageService.saveReceived(msg);

    const n = await nearbyService.broadcastMessage(msg);
    console.log('[Mesh] SOS sent to', n, 'peers');
    return n > 0;
  }

  async sendHeartbeat(profile?: { bloodGroup?: BloodGroup }): Promise<void> {
    const loc = await locationService.getCurrentLocation();
    const msg: MeshMessage = {
      messageId: this.uuid(),
      senderId: this.localDeviceId,
      senderName: this.localName,
      type: 'HEARTBEAT',
      payload: {
        latitude: loc?.latitude ?? 0,
        longitude: loc?.longitude ?? 0,
        bloodGroup: profile?.bloodGroup,
      },
      ttl: MESH_TTL_START,
      timestamp: Date.now(),
      hops: [this.localDeviceId],
    };
    this.markSeen(msg.messageId);
    await nearbyService.broadcastMessage(msg);
  }

  private markSeen(id: string): void {
    if (this.seenIds.has(id)) return;
    this.seenIds.add(id);
    this.seenQueue.push(id);
    if (this.seenQueue.length > MAX_SEEN_IDS) {
      const evicted = this.seenQueue.shift()!;
      this.seenIds.delete(evicted);
    }
  }

  private uuid(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  getRelayedCount(): number { return this.relayedCount; }

  onSOS(h: SOSHandler): () => void {
    this.sosHandlers.push(h);
    return () => { this.sosHandlers = this.sosHandlers.filter(x => x !== h); };
  }

  getPeerCount(): number { return nearbyService.getPeerCount(); }

  destroy(): void {
    if (this.bleUnsub) this.bleUnsub();
    nearbyService.destroy();
  }
}

export const meshService = new MeshService();
