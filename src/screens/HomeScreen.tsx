import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Alert, TextInput, Animated, NativeModules,
  TouchableOpacity, Vibration,
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
import AudioRecorderPlayer from 'react-native-audio-recorder-player';
import RNFS from 'react-native-fs';

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
  const [isRecording, setIsRecording] = useState(false);
  const [audioBase64, setAudioBase64] = useState<string | undefined>(undefined);
  const audioBase64Ref = useRef<string | undefined>(undefined);
  const [recordSecs, setRecordSecs] = useState(0);
  const profile = useRef<UserProfile | null>(null);
  const sosRef = useRef<(fromShake?: boolean) => void>(() => {});
  const audioRecorder = useRef(new AudioRecorderPlayer()).current;

  const fadeAnim    = useRef(new Animated.Value(0)).current;
  const slideAnim   = useRef(new Animated.Value(30)).current;
  const counterScale = useRef(new Animated.Value(1)).current;
  const peerRing    = useRef(new Animated.Value(1)).current;
  const peerRingOp  = useRef(new Animated.Value(0)).current;
  const prevCount   = useRef(0);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]).start();
    init();
    return () => {
      shakeDetector.stop();
      locationService.destroy();
      syncService.destroy();
      meshService.destroy();
    };
  }, []);

  useEffect(() => {
    if (nearbyCount !== prevCount.current) {
      Animated.sequence([
        Animated.timing(counterScale, { toValue: 1.35, duration: 160, useNativeDriver: true }),
        Animated.spring(counterScale,  { toValue: 1, useNativeDriver: true, friction: 4 }),
      ]).start();
      prevCount.current = nearbyCount;
    }
    if (nearbyCount > 0) {
      const anim = Animated.loop(Animated.sequence([
        Animated.parallel([
          Animated.timing(peerRing,  { toValue: 1.6, duration: 2000, useNativeDriver: true }),
          Animated.timing(peerRingOp,{ toValue: 0,   duration: 2000, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(peerRing,  { toValue: 1, duration: 0, useNativeDriver: true }),
          Animated.timing(peerRingOp,{ toValue: 0.25, duration: 0, useNativeDriver: true }),
        ]),
      ]));
      peerRingOp.setValue(0.25);
      anim.start();
      return () => anim.stop();
    } else {
      peerRing.setValue(1); peerRingOp.setValue(0);
    }
  }, [nearbyCount]);

  const init = async () => {
    try {
      setStatusText('Requesting permissions...');
      await requestAllPermissions();
      try {
        NativeModules.ServiceModule?.startService();
        NativeModules.ServiceModule?.requestBatteryExemption();
      } catch {}
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
      meshService.onACK(ack => {
        Vibration.vibrate([0, 200, 100, 200]);
        Alert.alert(
          '✅ Help is coming!',
          `${ack.senderName} saw your SOS and is on the way.`,
          [{ text: 'OK' }],
        );
      });

      setStatusText('Mesh active');
      setStatusOk(true);
    } catch (e: any) {
      console.error('[Home] Init error:', e);
      setStatusText('Init error — check logs');
      setStatusOk(false);
    }
  };

  const handleSOS = useCallback(async (fromShake = false) => {
    if (isSending) return;
    doSend(selectedType);
  }, [isSending, selectedType]);

  useEffect(() => { sosRef.current = handleSOS; }, [handleSOS]);

  const startRecording = async () => {
    try {
      setAudioBase64(undefined);
      setRecordSecs(0);
      audioRecorder.addRecordBackListener(e => setRecordSecs(Math.floor(e.currentPosition / 1000)));
      await audioRecorder.startRecorder();
      setIsRecording(true);
    } catch (e) { console.warn('[Voice] Start record failed:', e); }
  };

  const stopRecording = async () => {
    try {
      const filePath = await audioRecorder.stopRecorder();
      audioRecorder.removeRecordBackListener();
      setIsRecording(false);
      setRecordSecs(0);
      const cleanPath = filePath.startsWith('file://') ? filePath.slice(7) : filePath;
      const b64 = await RNFS.readFile(cleanPath, 'base64');
      audioBase64Ref.current = b64;
      setAudioBase64(b64);
    } catch (e) {
      console.warn('[Voice] Stop record failed:', e);
      setIsRecording(false);
    }
  };

  const clearRecording = () => { audioBase64Ref.current = undefined; setAudioBase64(undefined); setRecordSecs(0); };

  const doSend = async (type: EmergencyType) => {
    setIsSending(true); setSosActive(true); setStatusText('Broadcasting SOS...');
    try {
      const p = profile.current;
      await meshService.sendSOS(type, message || undefined, {
        bloodGroup: p?.bloodGroup,
        emergencyContacts: p?.emergencyContacts
          ? String(p.emergencyContacts).split('\n').map(s => s.trim()).filter(Boolean)
          : undefined,
        medicalConditions: p?.medicalConditions, allergies: p?.allergies,
      }, audioBase64Ref.current);
      const peers = nearbyService.getPeerCount();
      setStatusText(peers > 0 ? `SOS sent to ${peers} peer${peers === 1 ? '' : 's'}` : 'SOS stored — syncing when online');
      const { synced } = await syncService.triggerSync();
      if (synced > 0) setStatusText('SOS uploaded to dashboard');
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

  const coverageM = nearbyCount > 0 ? nearbyCount * MESH_TTL_START * 100 : 0;
  const coverageText = nearbyCount > 0
    ? `~${coverageM >= 1000 ? (coverageM / 1000).toFixed(1) + 'km' : coverageM + 'm'} est. coverage · ${MESH_TTL_START} hops`
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
            <Text style={styles.tagline}>Offline · BLE Mesh · Disaster Relief</Text>
          </View>
          <View style={styles.headerRight}>
            {relayedCount > 0 && (
              <View style={styles.relayBadge}>
                <Text style={styles.relayBadgeText}>{relayedCount} relayed</Text>
              </View>
            )}
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          </View>
        </View>
      </Animated.View>

      {/* Status bar */}
      <Animated.View style={[
        styles.statusBar,
        sosActive && styles.statusBarSOS,
        statusOk && !sosActive && styles.statusBarOk,
        { opacity: fadeAnim },
      ]}>
        <View style={[styles.statusIndicator, { backgroundColor: statusColor }]} />
        <Text style={[styles.statusText, { color: statusOk ? COLORS.text : COLORS.textMuted }]}>{statusText}</Text>
      </Animated.View>

      {/* Nearby counter */}
      <Animated.View style={[styles.counterSection, { opacity: fadeAnim }]}>
        <View style={styles.counterOuter}>
          <Animated.View style={[styles.counterRing, {
            transform: [{ scale: peerRing }],
            opacity: peerRingOp,
          }]} />
          <Animated.View style={[styles.counterBadge, { transform: [{ scale: counterScale }] },
            nearbyCount > 0 && styles.counterBadgeActive,
          ]}>
            <Text style={styles.counterNum}>{nearbyCount}</Text>
            <Text style={styles.counterLabel}>{nearbyCount === 1 ? 'device' : 'devices'}</Text>
            <Text style={styles.counterSub}>nearby</Text>
          </Animated.View>
        </View>
        <Text style={[styles.coverageText, nearbyCount > 0 && styles.coverageTextActive]}>
          {nearbyCount > 0 ? '📡 ' : '○  '}{coverageText}
        </Text>
      </Animated.View>

      {/* SOS Button */}
      <Animated.View style={[styles.sosSection, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
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
      <Animated.View style={[styles.infoRow, { opacity: fadeAnim }]}>
        <View style={[styles.infoCard, styles.infoCardLocation]}>
          <Text style={styles.infoCardIcon}>📍</Text>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.infoCardLabel}>Location</Text>
            <Text style={styles.infoCardValue} numberOfLines={1}>{coordsText}</Text>
          </View>
        </View>
        <View style={[styles.infoCard, styles.infoCardHeartbeat]}>
          <Text style={styles.infoCardIcon}>💓</Text>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.infoCardLabel}>Heartbeat</Text>
            <Text style={styles.infoCardValue} numberOfLines={1}>{heartbeatText}</Text>
          </View>
        </View>
      </Animated.View>

      {/* Message input */}
      <Animated.View style={[styles.section, { opacity: fadeAnim }]}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionAccent} />
          <Text style={styles.sectionTitle}>Message</Text>
          <Text style={[styles.charCount, message.length > 240 && styles.charCountWarn]}>
            {message.length}/300
          </Text>
        </View>
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

      {/* Voice SOS */}
      <Animated.View style={[styles.section, { opacity: fadeAnim }]}>
        <View style={styles.sectionHeader}>
          <View style={[styles.sectionAccent, { backgroundColor: COLORS.peer }]} />
          <Text style={styles.sectionTitle}>Voice Note</Text>
          <Text style={styles.sectionOptional}>optional</Text>
        </View>
        <TouchableOpacity
          style={[styles.micBtn, isRecording && styles.micBtnActive]}
          onPressIn={startRecording}
          onPressOut={stopRecording}
          activeOpacity={0.8}
        >
          <View style={[styles.micIconWrap, isRecording && styles.micIconWrapActive]}>
            <Text style={styles.micIcon}>{isRecording ? '🔴' : '🎙'}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.micLabel, isRecording && styles.micLabelActive]}>
              {isRecording ? `Recording — ${recordSecs}s` : audioBase64 ? 'Hold to re-record' : 'Hold to record'}
            </Text>
            <Text style={styles.micHint}>
              {isRecording ? 'Release when done' : 'Voice note included in SOS broadcast'}
            </Text>
          </View>
        </TouchableOpacity>
        {audioBase64 && !isRecording && (
          <View style={styles.voiceAttached}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={styles.voiceDot} />
              <Text style={styles.voiceAttachedText}>Voice note attached</Text>
            </View>
            <TouchableOpacity onPress={clearRecording} style={styles.removeVoiceBtn}>
              <Text style={styles.removeVoiceText}>Remove</Text>
            </TouchableOpacity>
          </View>
        )}
      </Animated.View>

      {/* Hints */}
      <Animated.View style={[styles.hintBox, { opacity: fadeAnim }]}>
        <Text style={styles.hintItem}>📳  Shake phone 3× for instant SOS</Text>
        <View style={styles.hintDivider} />
        <Text style={styles.hintItem}>⚡  Long-press button to skip countdown</Text>
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

  header: { marginBottom: 14, marginTop: 6 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  appName: { fontSize: 32, fontWeight: '900', color: COLORS.text, letterSpacing: -0.8 },
  tagline: { fontSize: 11, color: COLORS.textMuted, marginTop: 3, letterSpacing: 0.3 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  relayBadge: {
    backgroundColor: 'rgba(30,136,229,0.12)',
    borderRadius: 100, paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: 'rgba(30,136,229,0.25)',
  },
  relayBadgeText: { fontSize: 11, color: COLORS.peer, fontWeight: '700' },
  statusDot: { width: 10, height: 10, borderRadius: 5 },

  statusBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: COLORS.surfaceLight, borderRadius: 12, padding: 12,
    marginBottom: 20, borderWidth: 1, borderColor: COLORS.border,
  },
  statusBarOk: { borderColor: 'rgba(67,160,71,0.3)', backgroundColor: 'rgba(67,160,71,0.06)' },
  statusBarSOS: { borderColor: 'rgba(255,59,48,0.4)', backgroundColor: 'rgba(255,59,48,0.08)' },
  statusIndicator: { width: 7, height: 7, borderRadius: 4, flexShrink: 0 },
  statusText: { flex: 1, fontSize: 13, fontWeight: '600' },

  counterSection: { alignItems: 'center', marginBottom: 22 },
  counterOuter: { width: 130, height: 130, alignItems: 'center', justifyContent: 'center' },
  counterRing: {
    position: 'absolute', width: 120, height: 120, borderRadius: 60,
    backgroundColor: COLORS.safe,
  },
  counterBadge: {
    width: 108, height: 108, borderRadius: 54,
    backgroundColor: COLORS.surface,
    borderWidth: 2, borderColor: COLORS.border,
    alignItems: 'center', justifyContent: 'center',
    elevation: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8,
  },
  counterBadgeActive: {
    borderColor: COLORS.safe, backgroundColor: 'rgba(67,160,71,0.08)',
    shadowColor: COLORS.safe, shadowOpacity: 0.4,
  },
  counterNum: { fontSize: 34, fontWeight: '900', color: COLORS.text, lineHeight: 36 },
  counterLabel: { fontSize: 10, color: COLORS.textMuted, fontWeight: '700', letterSpacing: 0.5 },
  counterSub: { fontSize: 10, color: COLORS.textMuted },
  coverageText: { fontSize: 12, color: COLORS.textMuted, marginTop: 10, textAlign: 'center', fontWeight: '600' },
  coverageTextActive: { color: COLORS.safe },

  sosSection: { alignItems: 'center', marginBottom: 20 },

  infoRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  infoCard: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: COLORS.surface, borderRadius: 12,
    padding: 12, borderWidth: 1, borderColor: COLORS.border,
  },
  infoCardLocation: { borderLeftWidth: 3, borderLeftColor: COLORS.peer },
  infoCardHeartbeat: { borderLeftWidth: 3, borderLeftColor: COLORS.sos },
  infoCardIcon: { fontSize: 20 },
  infoCardLabel: { fontSize: 10, color: COLORS.textMuted, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  infoCardValue: { fontSize: 12, color: COLORS.text, fontFamily: 'monospace', fontWeight: '600', marginTop: 2 },

  section: { marginBottom: 10 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  sectionAccent: { width: 3, height: 14, borderRadius: 2, backgroundColor: COLORS.sos },
  sectionTitle: { fontSize: 13, color: COLORS.text, fontWeight: '700', flex: 1 },
  sectionOptional: { fontSize: 11, color: COLORS.textMuted },
  charCount: { fontSize: 11, color: COLORS.textMuted },
  charCountWarn: { color: COLORS.sos },
  input: {
    backgroundColor: COLORS.surfaceLight, borderRadius: 12, padding: 14,
    color: COLORS.text, fontSize: 14, minHeight: 80,
    borderWidth: 1, borderColor: COLORS.border,
    textAlignVertical: 'top',
  },

  micBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: COLORS.surface, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: COLORS.border,
  },
  micBtnActive: {
    borderColor: COLORS.sos, backgroundColor: 'rgba(255,59,48,0.08)',
  },
  micIconWrap: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: COLORS.surfaceLight, borderWidth: 1, borderColor: COLORS.border,
    alignItems: 'center', justifyContent: 'center',
  },
  micIconWrapActive: {
    backgroundColor: 'rgba(255,59,48,0.12)', borderColor: COLORS.sos,
  },
  micIcon: { fontSize: 22 },
  micLabel: { fontSize: 14, color: COLORS.text, fontWeight: '700' },
  micLabelActive: { color: COLORS.sos },
  micHint: { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
  voiceAttached: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 8, padding: 12,
    backgroundColor: 'rgba(67,160,71,0.08)',
    borderRadius: 10, borderWidth: 1, borderColor: 'rgba(67,160,71,0.3)',
  },
  voiceDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.safe },
  voiceAttachedText: { fontSize: 13, color: COLORS.safe, fontWeight: '700' },
  removeVoiceBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, backgroundColor: 'rgba(67,160,71,0.15)' },
  removeVoiceText: { fontSize: 12, color: COLORS.safe, fontWeight: '600' },

  hintBox: {
    marginTop: 14, padding: 16,
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 12, borderWidth: 1, borderColor: COLORS.border,
  },
  hintItem: { fontSize: 12, color: COLORS.textMuted, lineHeight: 20, fontWeight: '500' },
  hintDivider: { height: 1, backgroundColor: COLORS.border, marginVertical: 8 },
});
