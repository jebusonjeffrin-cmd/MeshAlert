// BLE UUIDs — unique to MeshAlert
export const MESH_SERVICE_UUID = 'A3F7B2C1-4D8E-4F9A-B1C2-D3E4F5A6B7C8';
export const MESH_MESSAGE_CHAR_UUID = 'B4A8C3D2-5E9F-4A0B-C2D3-E4F5A6B7C8D9';
export const MESH_DEVICE_PREFIX = 'MeshAlert_';
export const BLE_COMPANY_ID = 0x00FF;

// Scan timing
export const BLE_SCAN_DURATION_MS = 10_000;   // 10s scan
export const BLE_SCAN_PAUSE_MS = 20_000;       // 20s pause between scans

// Message relay
export const MESH_TTL_START = 10;
export const MAX_MESSAGE_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
export const MAX_SEEN_IDS = 1_000;

// Heartbeat
export const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;        // 5 minutes
export const HEARTBEAT_LOW_BATTERY_MS = 15 * 60 * 1000;    // 15 minutes
export const LOW_BATTERY_THRESHOLD = 20;

// Shake detection
export const SHAKE_THRESHOLD = 12;       // m/s² delta between 10Hz readings
export const SHAKE_COUNT_REQUIRED = 3;
export const SHAKE_WINDOW_MS = 2_000;

// RSSI path-loss model
export const TX_POWER_AT_1M = -59;
export const PATH_LOSS_N = 2.5;

// SQLite
export const DB_NAME = 'meshalert.db';

// Dashboard
export const DASHBOARD_PORT = 3001;

// Colors
export const COLORS = {
  medical: '#E53935',
  trapped: '#FB8C00',
  safe: '#43A047',
  self: '#7B1FA2',
  peer: '#1E88E5',
  background: '#0D1117',
  surface: '#161B22',
  surfaceLight: '#21262D',
  text: '#E6EDF3',
  textMuted: '#8B949E',
  border: '#30363D',
  sos: '#FF3B30',
  sosGlow: 'rgba(255,59,48,0.3)',
};
