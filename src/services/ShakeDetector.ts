import { accelerometer, setUpdateIntervalForType, SensorTypes } from 'react-native-sensors';
import { Vibration } from 'react-native';
import { SHAKE_THRESHOLD, SHAKE_COUNT_REQUIRED, SHAKE_WINDOW_MS } from '../utils/constants';

type ShakeHandler = () => void;

class ShakeDetector {
  private sub: { unsubscribe: () => void } | null = null;
  private shakeTimes: number[] = [];
  private handlers: ShakeHandler[] = [];
  private cooldownUntil = 0;
  private lastMagnitude = 0;
  private firstReading = true;

  start(): void {
    setUpdateIntervalForType(SensorTypes.accelerometer, 100); // 10 Hz
    console.log('[Shake] Starting accelerometer (threshold:', SHAKE_THRESHOLD, 'need', SHAKE_COUNT_REQUIRED, 'in', SHAKE_WINDOW_MS / 1000 + 's)');

    this.sub = accelerometer.subscribe(
      ({ x, y, z }: { x: number; y: number; z: number }) => {
        if (this.firstReading) {
          console.log('[Shake] ✅ Accelerometer active:', x.toFixed(2), y.toFixed(2), z.toFixed(2));
          this.firstReading = false;
        }
        const magnitude = Math.sqrt(x * x + y * y + z * z);
        const delta = Math.abs(magnitude - this.lastMagnitude);
        this.lastMagnitude = magnitude;
        if (delta > SHAKE_THRESHOLD) this.record();
      },
      (err: Error) => console.warn('[Shake] ❌ Accelerometer unavailable:', err.message),
    );
  }

  private record(): void {
    const now = Date.now();
    if (now < this.cooldownUntil) return;
    this.shakeTimes = this.shakeTimes.filter(t => now - t < SHAKE_WINDOW_MS);
    this.shakeTimes.push(now);
    console.log('[Shake] Shake detected! count:', this.shakeTimes.length);
    if (this.shakeTimes.length >= SHAKE_COUNT_REQUIRED) {
      this.shakeTimes = [];
      this.cooldownUntil = now + 5_000;
      console.log('[Shake] 🚨 SOS triggered!');
      Vibration.vibrate([0, 200, 100, 200, 100, 200]);
      this.handlers.forEach(h => h());
    }
  }

  onShake(h: ShakeHandler): () => void {
    this.handlers.push(h);
    return () => { this.handlers = this.handlers.filter(x => x !== h); };
  }

  stop(): void {
    if (this.sub) { this.sub.unsubscribe(); this.sub = null; }
    this.firstReading = true;
  }
}

export const shakeDetector = new ShakeDetector();
