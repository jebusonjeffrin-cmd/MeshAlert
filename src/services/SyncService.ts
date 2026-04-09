import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { storageService } from './StorageService';
import { MeshMessage } from '../types';

const DASHBOARD_URL_KEY = '@meshalert_dashboard_url';
const LOCAL_PORT = 3001;

class SyncService {
  private isOnline = false;
  private unsubNet: (() => void) | null = null;
  private syncInterval: ReturnType<typeof setInterval> | null = null;
  private inProgress = false;
  private dashboardURL = '';  // full base URL, e.g. https://abc.loca.lt or http://192.168.1.5:3001

  async initialize(): Promise<void> {
    const saved = await AsyncStorage.getItem(DASHBOARD_URL_KEY);
    if (saved) this.dashboardURL = saved;

    this.unsubNet = NetInfo.addEventListener((state: NetInfoState) => {
      const wasOffline = !this.isOnline;
      this.isOnline = !!(state.isConnected && state.isInternetReachable !== false);
      if (wasOffline && this.isOnline) {
        console.log('[Sync] Internet restored — flushing pending messages');
        this.syncPending();
      }
    });

    // Periodic sync every 30s — catches messages that queued while already online
    this.syncInterval = setInterval(() => {
      if (this.isOnline && this.dashboardURL) this.syncPending();
    }, 30_000);
  }

  async setDashboardURL(input: string): Promise<void> {
    let url = input.trim().replace(/\/$/, '');
    // If user entered a bare IP (no scheme), add http:// and port
    if (url && !url.includes('://')) {
      // Only add port if the user didn't already specify one (e.g. 192.168.1.5:8080)
      const hasPort = /:\d+$/.test(url);
      url = `http://${url}${hasPort ? '' : `:${LOCAL_PORT}`}`;
    }
    this.dashboardURL = url;
    await AsyncStorage.setItem(DASHBOARD_URL_KEY, url);
    console.log('[Sync] Dashboard URL saved:', url);
  }

  getDashboardURL(): string { return this.dashboardURL; }

  // Legacy alias kept for SettingsScreen compatibility
  getDashboardIP(): string { return this.dashboardURL; }

  async triggerSync(): Promise<{ synced: number; failed: number }> {
    return this.syncPending();
  }

  private async syncPending(): Promise<{ synced: number; failed: number }> {
    if (this.inProgress || !this.dashboardURL) return { synced: 0, failed: 0 };
    this.inProgress = true;
    let synced = 0; let failed = 0;
    try {
      const pending = await storageService.getUnsyncedMessages();
      for (const msg of pending) {
        if (msg.type !== 'SOS') { await storageService.markSynced(msg.messageId); synced++; continue; }
        try {
          const ok = await this.postSOS(msg);
          if (ok) { await storageService.markSynced(msg.messageId); synced++; console.log('[Sync] ✅ Uploaded SOS', msg.messageId); }
          else failed++;
        } catch { failed++; }
      }
    } finally { this.inProgress = false; }
    return { synced, failed };
  }

  private async postSOS(msg: MeshMessage): Promise<boolean> {
    try {
      const res = await fetch(`${this.dashboardURL}/api/sos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(msg),
      });
      return res.ok;
    } catch { return false; }
  }

  destroy(): void {
    if (this.unsubNet) { this.unsubNet(); this.unsubNet = null; }
    if (this.syncInterval) { clearInterval(this.syncInterval); this.syncInterval = null; }
  }
}

export const syncService = new SyncService();
