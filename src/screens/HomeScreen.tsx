import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Alert, TextInput, TouchableOpacity,
} from 'react-native';
import { SOSButton } from '../components/SOSButton';
import { EmergencyTypeSelector } from '../components/EmergencyTypeSelector';
import { NearbyCounter } from '../components/NearbyCounter';
import { EmergencyType, Location, UserProfile } from '../types';
import { nearbyService } from '../services/NearbyService';
import { meshService } from '../services/MeshService';
import { locationService } from '../services/LocationService';
import { heartbeatService } from '../services/HeartbeatService';
import { shakeDetector } from '../services/ShakeDetector';
import { storageService } from '../services/StorageService';
import { syncService } from '../services/SyncService';
import { COLORS } from '../utils/constants';
import { requestAllPermissions } from '../utils/permissions';
import DeviceInfo from 'react-native-device-info';

export const HomeScreen: React.FC = () => {
  const [selectedType, setSelectedType] = useState<EmergencyType>('MEDICAL');
  const [isSending, setIsSending] = useState(false);
  const [sosActive, setSosActive] = useState(false);
  const [nearbyCount, setNearbyCount] = useState(0);
  const [location, setLocation] = useState<Location | null>(null);
  const [message, setMessage] = useState('');
  const [statusText, setStatusText] = useState('Initializing...');
  const [lastHeartbeat, setLastHeartbeat] = useState<number | null>(null);
  const [relayedCount, setRelayedCount] = useState(0);
  const profile = useRef<UserProfile | null>(null);
  const sosRef = useRef<(fromShake?: boolean) => void>(() => {});

  useEffect(() => {
    init();
    return () => {
      shakeDetector.stop();
      locationService.destroy();
      syncService.destroy();
      meshService.destroy();
    };
  }, []);

  const init = async () => {
    try {
      // Request all permissions first — must happen before any service init
      setStatusText('Requesting permissions...');
      await requestAllPermissions();

      await storageService.initialize();
      const savedProfile = await storageService.getProfile();
      profile.current = savedProfile;

      const deviceId = savedProfile?.deviceId ?? await DeviceInfo.getUniqueId();

      // ── Phase 1: Initialize everything that doesn't need BLE ──────────────────
      await locationService.initialize();
      locationService.onUpdate(loc => setLocation(loc));
      setLocation(locationService.getLastLocation());

      shakeDetector.start();
      shakeDetector.onShake(() => sosRef.current(true));

      await meshService.initialize(deviceId, savedProfile?.name ?? 'Survivor');

      // Wire heartbeat service to mesh
      heartbeatService.setSendFn(() => meshService.sendHeartbeat({ bloodGroup: savedProfile?.bloodGroup }));
      heartbeatService.onBeat(t => setLastHeartbeat(t));
      heartbeatService.start();

      await syncService.initialize();
      setStatusText('Ready');

      // ── Phase 2: Nearby mesh — initialized inside meshService.initialize() ──
      nearbyService.onPeerUpdate(peers => setNearbyCount(peers.length));
      meshService.onSOS(() => setRelayedCount(meshService.getRelayedCount()));
      setStatusText('Mesh active');
      console.log('[Home] ✅ All services running');
    } catch (e: any) {
      console.error('[Home] Init error:', e);
      setStatusText('Init error — check logs');
    }
  };

  const handleSOS = useCallback(async (fromShake = false) => {
    if (isSending) return;
    if (!fromShake) {
      Alert.alert(`Send ${selectedType} SOS?`, 'This broadcasts your location to all nearby devices.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'SEND SOS', style: 'destructive', onPress: () => doSend(selectedType) },
      ]);
    } else {
      doSend(selectedType);
    }
  }, [isSending, selectedType, message]);

  useEffect(() => { sosRef.current = handleSOS; }, [handleSOS]);

  const doSend = async (type: EmergencyType) => {
    setIsSending(true); setSosActive(true); setStatusText('Broadcasting SOS...');
    try {
      const p = profile.current;
      await meshService.sendSOS(type, message || undefined, {
        bloodGroup: p?.bloodGroup, emergencyContacts: p?.emergencyContacts,
        medicalConditions: p?.medicalConditions, allergies: p?.allergies,
      });
      setStatusText(`SOS sent to ${nearbyService.getPeerCount()} device(s)`);
      const { synced } = await syncService.triggerSync();
      if (synced > 0) setStatusText('✅ SOS uploaded to dashboard');
    } catch (e: any) {
      console.error('[SOS] Error:', e);
      setStatusText('Failed — stored locally');
    } finally {
      setIsSending(false);
    }
  };

  const coordsText = location
    ? `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`
    : 'Acquiring GPS...';

  const heartbeatText = lastHeartbeat
    ? `Last ping: ${fmtTime(Date.now() - lastHeartbeat)} ago`
    : 'Heartbeat pending...';

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.appName}>MeshAlert</Text>
        <Text style={styles.tagline}>Offline disaster relief mesh network</Text>
      </View>

      <View style={[styles.statusBar, sosActive && styles.statusBarActive]}>
        <View style={[styles.dot, { backgroundColor: sosActive ? COLORS.sos : COLORS.safe }]} />
        <Text style={styles.statusText}>{statusText}</Text>
        {relayedCount > 0 && <Text style={styles.badge}>{relayedCount} relayed</Text>}
      </View>

      <View style={styles.centered}><NearbyCounter count={nearbyCount} /></View>

      <View style={styles.centered}>
        <SOSButton
          onPress={() => handleSOS(false)}
          onLongPress={() => doSend(selectedType)}
          isActive={sosActive}
          disabled={isSending}
        />
      </View>

      <EmergencyTypeSelector selected={selectedType} onSelect={setSelectedType} />

      <View style={styles.card}>
        <Text style={styles.cardLabel}>📍 Location</Text>
        <Text style={styles.cardValue}>{coordsText}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>💓 {heartbeatText}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Message (optional)</Text>
        <TextInput
          style={styles.input}
          value={message}
          onChangeText={setMessage}
          placeholder="Describe your situation..."
          placeholderTextColor={COLORS.textMuted}
          multiline
          maxLength={300}
        />
      </View>

      <View style={styles.hint}>
        <Text style={styles.hintText}>📳 Shake your phone 3× to trigger SOS automatically</Text>
        <Text style={styles.hintText}>📡 Long-press SOS button for instant send (no confirmation)</Text>
      </View>
    </ScrollView>
  );
};

function fmtTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: 20, paddingBottom: 40 },
  header: { marginBottom: 20, marginTop: 10 },
  appName: { fontSize: 28, fontWeight: '800', color: COLORS.text },
  tagline: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  statusBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: COLORS.surface, borderRadius: 10, padding: 12,
    marginBottom: 16, borderWidth: 1, borderColor: COLORS.border,
  },
  statusBarActive: { borderColor: COLORS.sos },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { flex: 1, fontSize: 13, color: COLORS.text },
  badge: {
    fontSize: 11, color: COLORS.peer, backgroundColor: 'rgba(30,136,229,0.15)',
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10,
  },
  centered: { alignItems: 'center', marginBottom: 20 },
  card: {
    backgroundColor: COLORS.surface, borderRadius: 10, padding: 14,
    marginBottom: 10, borderWidth: 1, borderColor: COLORS.border,
  },
  cardLabel: { fontSize: 12, color: COLORS.textMuted, marginBottom: 4 },
  cardValue: { fontSize: 14, color: COLORS.text, fontFamily: 'monospace' },
  section: { marginBottom: 10 },
  sectionLabel: { fontSize: 13, color: COLORS.textMuted, marginBottom: 6, fontWeight: '600' },
  input: {
    backgroundColor: COLORS.surfaceLight, borderRadius: 10, padding: 14,
    color: COLORS.text, fontSize: 14, minHeight: 80, borderWidth: 1, borderColor: COLORS.border,
  },
  hint: {
    marginTop: 16, padding: 12, backgroundColor: COLORS.surfaceLight,
    borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, borderStyle: 'dashed', gap: 6,
  },
  hintText: { fontSize: 12, color: COLORS.textMuted, textAlign: 'center' },
});
