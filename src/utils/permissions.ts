/**
 * permissions.ts — Request ALL app permissions in one shot before any service starts.
 * This prevents race conditions where services initialize before permissions are granted.
 */
import { Platform, PermissionsAndroid } from 'react-native';

export async function requestAllPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;

  const apiLevel = parseInt(Platform.Version.toString(), 10);
  const toRequest: string[] = [
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
  ];

  if (apiLevel >= 31) {
    toRequest.push(
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
    );
  }

  if (apiLevel >= 33) {
    // Nearby Connections / WiFi Direct requires this on Android 13+
    toRequest.push('android.permission.NEARBY_WIFI_DEVICES' as any);
    // Android 13+: required to show foreground service notification
    toRequest.push('android.permission.POST_NOTIFICATIONS' as any);
  }

  try {
    const results = await PermissionsAndroid.requestMultiple(toRequest as any);
    const granted = Object.values(results).every(
      r => r === PermissionsAndroid.RESULTS.GRANTED,
    );
    console.log('[Permissions] Result:', JSON.stringify(results));
    return granted;
  } catch (e: any) {
    console.warn('[Permissions] Request failed:', e?.message);
    return false;
  }
}
