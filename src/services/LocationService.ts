import Geolocation, { GeoPosition, GeoError } from 'react-native-geolocation-service';
import { Location } from '../types';

class LocationService {
  private lastLocation: Location | null = null;
  private watchId: number | null = null;
  private handlers: Array<(loc: Location) => void> = [];
  private initialized = false;

  async initialize(): Promise<void> {
    // Permissions must already be granted before calling this (via requestAllPermissions)
    if (this.initialized) return;
    this.initialized = true;
    await this.fetchOnce();
    this.startWatch();
  }

  private fetchOnce(): Promise<void> {
    return new Promise(resolve => {
      Geolocation.getCurrentPosition(
        (pos: GeoPosition) => {
          this.setLocation(pos);
          console.log('[Location] Initial fix:', pos.coords.latitude.toFixed(5), pos.coords.longitude.toFixed(5));
          resolve();
        },
        (err: GeoError) => {
          console.warn('[Location] Initial fix failed:', err.code, err.message);
          resolve();
        },
        { enableHighAccuracy: true, timeout: 30_000, maximumAge: 60_000 },
      );
    });
  }

  private startWatch(): void {
    this.watchId = Geolocation.watchPosition(
      (pos: GeoPosition) => {
        this.setLocation(pos);
        console.log('[Location] Updated:', pos.coords.latitude.toFixed(5), pos.coords.longitude.toFixed(5), 'acc:', pos.coords.accuracy.toFixed(0) + 'm');
      },
      (err: GeoError) => console.warn('[Location] Watch error:', err.code, err.message),
      { enableHighAccuracy: true, distanceFilter: 10, interval: 30_000 },
    );
  }

  private setLocation(pos: GeoPosition): void {
    this.lastLocation = {
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
      timestamp: pos.timestamp,
    };
    this.handlers.forEach(h => h(this.lastLocation!));
  }

  getCurrentLocation(): Promise<Location | null> {
    if (this.lastLocation && Date.now() - this.lastLocation.timestamp < 30_000) {
      return Promise.resolve(this.lastLocation);
    }
    return new Promise(resolve => {
      Geolocation.getCurrentPosition(
        (pos: GeoPosition) => { this.setLocation(pos); resolve(this.lastLocation); },
        () => resolve(this.lastLocation),
        { enableHighAccuracy: true, timeout: 30_000, maximumAge: 60_000 },
      );
    });
  }

  getLastLocation(): Location | null { return this.lastLocation; }

  onUpdate(handler: (loc: Location) => void): () => void {
    this.handlers.push(handler);
    return () => { this.handlers = this.handlers.filter(h => h !== handler); };
  }

  destroy(): void {
    if (this.watchId !== null) { Geolocation.clearWatch(this.watchId); this.watchId = null; }
    this.initialized = false;
  }
}

export const locationService = new LocationService();
