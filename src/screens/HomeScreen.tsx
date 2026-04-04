import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Alert, TextInput, Animated,
} from 'react-native';
import { SOSButton } from '../components/SOSButton';
import { EmergencyTypeSelector } from '../components/EmergencyTypeSelector';
import { EmergencyType, Location, UserProfile } from '../types';
import { nearbyService } from '../services/NearbyService';
import { meshService } from '../services/MeshService';
import { locationService } from '../services/LocationService';
import { heartbeatService } from '../services/HeartbeatService';
import { shakeDetector } from '../services/ShakeDetector';
import { storageService } from '../services/StorageService';
import { syncService } from '../services/SyncService';
import { COLORS, MESH_TTL_START } from '../utils/constants';
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
  const [statusOk, setStatusOk] = useState(false);
  const [lastHeartbeat, setLastHeartbeat] = useState<number | null>(null);
  const [relayedCount, setRelayedCount] = useState(0);
  const profile = useRef<UserProfile | null>(null);
  const sosRef = useRef<(fromShake?: boolean) => void>(() => {});

  // Animation values
  const fadeAnim   = useRef(new Animated.Value(0)).current;
  const slideAnim  = useRef(new Animated.Value(24)).current;
  const counterScale = useRef(new Animated.Value(1)).current;
  const peerRing   = useRef(new Animated.Value(1)).current;
  const peerRingOp = useRef(new Animated.Value(0)).current;
  const prevCount  = useRef(0);

  useEffect(() => {
    // Staggered fade-in on mount
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start();
    init();
    return () => {
      shakeDetector.stop();
      locationService.destroy();
      syncService.destroy();
      meshService.destroy();
    };
  }, []);

  // Animate counter when nearbyCount changes
  useEffect(() => {
    if (nearbyCount !== prevCount.current) {
      Animated.sequence([
        Animated.timing(counterScale, { toValue: 1.3, duration: 150, useNativeDriver: true }),
        Animated.timing(counterScale, { toValue: 1, duration: 150, useNativeDriver: true }),
      ]).start();
      prevCount.current = nearbyCount;
    }
    // Pulse ring when peers connected
    if (nearbyCount > 0) {
      const anim = Animated.loop(Animated.sequence([
        Animated.parallel([
          Animated.timing(peerRing, { toValue: 1.5, duration: 1500, useNativeDriver: true }),
          Animated.timing(peerRingOp, { toValue: 0, duration: 1500, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(peerRing, { toValue: 1, duration: 0, useNativeDriver: true }),
          Animated.timing(peerRingOp, { toValue: 0.3, duration: 0, useNativeDriver: true }),
        ]),
      ]));
      peerRingOp.setValue(0.3);
      anim.start();
      return () => anim.stop();
    } else {
      peerRing.setValue(1);
      peerRingOp.setValue(0);
    }
  }, [nearbyCount]);

  const init = async () => {
    try {
      setStatusText('Requesting permissions...');
      await requestAllPermissions();

      await storageService.initialize();
      const savedProfile = await storageService.getProfile();
      profile.current = savedProfile;
      const deviceId = savedProfile?.deviceId ?? await DeviceInfo.getUniqueId();

      await locationService.initialize();
      locationService.onUpdate(loc => setLocation(loc));
      setLocation(locationService.getLastLocation());

      shakeDetector.start();
      shakeDetector.onShake(() => sosRef.current(true));

      await meshService.initialize(deviceId, savedProfile?.name ?? 'Survivor');

      heartbeatService.setSendFn(() => meshService.sendHeartbeat({ bloodGroup: savedProfile?.bloodGroup }));
      heartbeatService.onBeat(t => setLastHeartbeat(t));
      heartbeatService.start();

      await syncService.initialize();

      nearbyService.onPeerUpdate(peers => setNearbyCount(peers.length));
      meshService.onSOS(() => setRelayedCount(meshService.getRelayedCount()));

      setStatusText('Mesh active');
      setStatusOk(true);
      console.log('[Home] ✅ All services running');
    } catch (e: any) {
      console.error('[Home] Init error:', e);
      setStatusText('Init error — check logs');
      setStatusOk(false);
    }
  };

  const handleSOS = useCallback(async (fromShake = false) => {
    if (isSending) return;
    if (fromShake) { doSend(selectedType); }
    // Button now handles its own countdown, this is called after countdown completes
    else { doSend(selectedType); }
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
      const peers = nearbyService.getPeerCount();
      setStatusText(peers > 0 ? `SOS sent to ${peers} peer(s)` : 'SOS stored — syncing when online');
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

  // Coverage estimate: each hop covers ~100m, TTL hops, peer count as multiplier
  const coverageM = nearbyCount > 0 ? nearbyCount * MESH_TTL_START * 100 : 0;
  const coverageText = nearbyCount > 0
    ? `~${coverageM >= 1000 ? (coverageM / 1000).toFixed(1) + 'km' : coverageM + 'm'} coverage · ${MESH_TTL_START} hops`
    : 'No mesh coverage yet';

  const statusColor = sosActive ? COLORS.sos : statusOk ? COLORS.safe : COLORS.textMuted;

  return (
    <Animated.ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <Animated.View style={[styles.header, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.appName}>MeshAlert</Text>
            <Text style={styles.tagline}>Offline disaster relief mesh</Text>
          </View>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
        </View>
      </Animated.View>

      {/* Status bar */}
      <Animated.View style={[
        styles.statusBar,
        sosActive && styles.statusBarSOS,
        { opacity: fadeAnim },
      ]}>
        <View style={[styles.dot, { backgroundColor: statusColor }]} />
        <Text style={styles.statusText}>{statusText}</Text>
        {relayedCount > 0 && <Text style={styles.badge}>{relayedCount} relayed</Text>}
      </Animated.View>

      {/* Nearby counter with animated ring */}
      <Animated.View style={[styles.counterSection, { opacity: fadeAnim }]}>
        <View style={styles.counterWrapper}>
          <Animated.View style={[styles.counterRing, { transform: [{ scale: peerRing }], opacity: peerRingOp }]} />
          <Animated.View style={[styles.counterBadge, { transform: [{ scale: counterScale }] }]}>
            <Text style={styles.counterNum}>{nearbyCount}</Text>
            <Text style={styles.counterLabel}>{nearbyCount === 1 ? 'device' : 'devices'} nearby</Text>
          </Animated.View>
        </View>
        <Text style={styles.coverageText}>
          {nearbyCount > 0 ? '📡 ' : '⚪ '}{coverageText}
        </Text>
      </Animated.View>

      {/* SOS Button */}
      <Animated.View style={[styles.centered, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
        <SOSButton
          onPress={() => handleSOS(false)}
          onLongPress={() => doSend(selectedType)}
          isActive={sosActive}
          disabled={isSending}
        />
      </Animated.View>

      <Animated.View style={{ opacity: fadeAnim }}>
        <EmergencyTypeSelector selected={selectedType} onSelect={setSelectedType} />
      </Animated.View>

      {/* Info cards */}
      <Animated.View style={[styles.card, { opacity: fadeAnim }]}>
        <Text style={styles.cardLabel}>📍 Your Location</Text>
        <Text style={styles.cardValue}>{coordsText}</Text>
      </Animated.View>

      <Animated.View style={[styles.card, { opacity: fadeAnim }]}>
        <Text style={styles.cardLabel}>💓 Heartbeat</Text>
        <Text style={styles.cardValue}>{heartbeatText}</Text>
      </Animated.View>

      {/* Message input */}
      <Animated.View style={[styles.section, { opacity: fadeAnim }]}>
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
      </Animated.View>

      {/* Hint */}
      <Animated.View style={[styles.hint, { opacity: fadeAnim }]}>
        <Text style={styles.hintText}>📳 Shake 3× for instant SOS</Text>
        <Text style={styles.hintText}>⚡ Long-press button to skip countdown</Text>
        <Text style={styles.hintText}>📶 Turn WiFi ON for 200m+ range</Text>
      </Animated.View>
    </Animated.ScrollView>
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
  content: { padding: 20, paddingBottom: 48 },
  header: { marginBottom: 16, marginTop: 8 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  appName: { fontSize: 30, fontWeight: '900', color: COLORS.text, letterSpacing: -0.5 },
  tagline: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginTop: 6 },
  statusBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: COLORS.surface, borderRadius: 12, padding: 12,
    marginBottom: 20, borderWidth: 1, borderColor: COLORS.border,
  },
  statusBarSOS: { borderColor: COLORS.sos, backgroundColor: 'rgba(255,59,48,0.08)' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { flex: 1, fontSize: 13, color: COLORS.text },
  badge: {
    fontSize: 11, color: COLORS.peer, backgroundColor: 'rgba(30,136,229,0.15)',
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10,
  },
  counterSection: { alignItems: 'center', marginBottom: 24 },
  counterWrapper: { alignItems: 'center', justifyContent: 'center', width: 120, height: 120 },
  counterRing: {
    position: 'absolute',
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: COLORS.safe,
  },
  counterBadge: {
    width: 90, height: 90, borderRadius: 45,
    backgroundColor: COLORS.surface, borderWidth: 2, borderColor: COLORS.border,
    alignItems: 'center', justifyContent: 'center',
    elevation: 4,
  },
  counterNum: { fontSize: 28, fontWeight: '900', color: COLORS.text },
  counterLabel: { fontSize: 10, color: COLORS.textMuted, marginTop: 2, textAlign: 'center' },
  coverageText: { fontSize: 12, color: COLORS.textMuted, marginTop: 8, textAlign: 'center' },
  centered: { alignItems: 'center', marginBottom: 24 },
  card: {
    backgroundColor: COLORS.surface, borderRadius: 12, padding: 14,
    marginBottom: 10, borderWidth: 1, borderColor: COLORS.border,
  },
  cardLabel: { fontSize: 11, color: COLORS.textMuted, marginBottom: 4, fontWeight: '600', letterSpacing: 0.5 },
  cardValue: { fontSize: 14, color: COLORS.text, fontFamily: 'monospace' },
  section: { marginBottom: 10 },
  sectionLabel: { fontSize: 13, color: COLORS.textMuted, marginBottom: 6, fontWeight: '600' },
  input: {
    backgroundColor: COLORS.surfaceLight, borderRadius: 12, padding: 14,
    color: COLORS.text, fontSize: 14, minHeight: 80, borderWidth: 1, borderColor: COLORS.border,
  },
  hint: {
    marginTop: 16, padding: 14, backgroundColor: COLORS.surfaceLight,
    borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, borderStyle: 'dashed', gap: 6,
  },
  hintText: { fontSize: 12, color: COLORS.textMuted, textAlign: 'center' },
});
