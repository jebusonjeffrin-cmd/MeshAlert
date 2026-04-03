/**
 * HeartbeatService — standalone singleton, initialized once from App.tsx.
 * Sends a BLE heartbeat every 5 minutes (15 min on low battery).
 * Tracks lastBeatTime so UI can show "Last ping: Xm ago".
 */
import BackgroundTimer from 'react-native-background-timer';
import { HEARTBEAT_INTERVAL_MS } from '../utils/constants';

type BeatHandler = (time: number) => void;

class HeartbeatService {
  private timer: number | null = null;
  private lastBeatTime: number | null = null;
  private handlers: BeatHandler[] = [];
  // Reference to meshService.sendHeartbeat — injected to avoid circular deps
  private sendFn: (() => Promise<void>) | null = null;

  setSendFn(fn: () => Promise<void>): void {
    this.sendFn = fn;
  }

  start(): void {
    if (this.timer !== null) return;
    console.log('[Heartbeat] Starting — interval:', HEARTBEAT_INTERVAL_MS / 1000 + 's');
    this.beat();
    this.timer = BackgroundTimer.setInterval(() => this.beat(), HEARTBEAT_INTERVAL_MS);
  }

  private async beat(): Promise<void> {
    try {
      if (this.sendFn) await this.sendFn();
      this.lastBeatTime = Date.now();
      console.log('[Heartbeat] 💓 Beat sent at', new Date(this.lastBeatTime).toLocaleTimeString());
      this.handlers.forEach(h => h(this.lastBeatTime!));
    } catch (e: any) {
      console.warn('[Heartbeat] Beat failed:', e?.message);
    }
  }

  getLastBeatTime(): number | null { return this.lastBeatTime; }

  onBeat(h: BeatHandler): () => void {
    this.handlers.push(h);
    return () => { this.handlers = this.handlers.filter(x => x !== h); };
  }

  stop(): void {
    if (this.timer !== null) {
      BackgroundTimer.clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export const heartbeatService = new HeartbeatService();
