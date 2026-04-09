import { MESH_TTL_START, MAX_MESSAGE_AGE_MS, MAX_SEEN_IDS } from '../utils/constants';
import { MeshMessage, EmergencyType, BloodGroup } from '../types';
import { nearbyService } from './NearbyService';
import { storageService } from './StorageService';
import { locationService } from './LocationService';
import { syncService } from './SyncService';

type SOSHandler = (msg: MeshMessage) => void;
type ACKHandler = (msg: MeshMessage) => void;

class MeshService {
  private seenIds: Set<string> = new Set();
  private seenQueue: string[] = [];
  private localDeviceId = '';
  private localName = 'Unknown';
  private sosHandlers: SOSHandler[] = [];
  private ackHandlers: ACKHandler[] = [];
  private sentMessageIds: Set<string> = new Set();
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

    if (msg.type === 'SOS') {
      // Queue relayed SOS for dashboard upload — any phone with internet will sync it
      await storageService.savePending(msg);
      syncService.triggerSync().catch(() => {});  // immediate non-blocking upload attempt
      this.sosHandlers.forEach(h => h(msg));
    } else if (msg.type === 'ACK') {
      // Fire ACK handlers if this ACK targets one of our own sent SOS messages
      if (msg.targetMessageId && this.sentMessageIds.has(msg.targetMessageId)) {
        this.ackHandlers.forEach(h => h(msg));
      }
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

    // Base payload for BLE mesh — no audio (BLE MTU is 512 bytes; audio is kilobytes)
    const basePayload = {
      latitude: loc?.latitude ?? 0,
      longitude: loc?.longitude ?? 0,
      message: textMessage,
      bloodGroup: profile?.bloodGroup,
      emergencyContacts: profile?.emergencyContacts,
      medicalConditions: profile?.medicalConditions,
      allergies: profile?.allergies,
    };

    const msg: MeshMessage = {
      messageId: this.uuid(),
      senderId: this.localDeviceId,
      senderName: this.localName,
      type: 'SOS',
      emergencyType,
      payload: basePayload,
      ttl: MESH_TTL_START,
      timestamp: Date.now(),
      hops: [this.localDeviceId],
    };

    // Full message with audio — saved locally and uploaded to dashboard via internet sync
    const fullMsg: MeshMessage = { ...msg, payload: { ...basePayload, audioBase64 } };

    this.markSeen(msg.messageId);
    this.sentMessageIds.add(msg.messageId);
    await storageService.savePending(fullMsg);   // dashboard sync includes audio
    await storageService.saveReceived(fullMsg);  // local history includes audio

    const n = await nearbyService.broadcastMessage(msg);  // mesh relay without audio
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

  async sendACK(targetMessageId: string, targetSenderName: string): Promise<void> {
    const msg: MeshMessage = {
      messageId: this.uuid(),
      senderId: this.localDeviceId,
      senderName: this.localName,
      type: 'ACK',
      targetMessageId,
      payload: { latitude: 0, longitude: 0 },
      ttl: MESH_TTL_START,
      timestamp: Date.now(),
      hops: [this.localDeviceId],
    };
    this.markSeen(msg.messageId);
    await nearbyService.broadcastMessage(msg);
    console.log('[Mesh] ACK sent for', targetSenderName, '→', targetMessageId.slice(-8));
  }

  getRelayedCount(): number { return this.relayedCount; }

  onSOS(h: SOSHandler): () => void {
    this.sosHandlers.push(h);
    return () => { this.sosHandlers = this.sosHandlers.filter(x => x !== h); };
  }

  onACK(h: ACKHandler): () => void {
    this.ackHandlers.push(h);
    return () => { this.ackHandlers = this.ackHandlers.filter(x => x !== h); };
  }

  getPeerCount(): number { return nearbyService.getPeerCount(); }

  destroy(): void {
    if (this.bleUnsub) this.bleUnsub();
    nearbyService.destroy();
  }
}

export const meshService = new MeshService();
