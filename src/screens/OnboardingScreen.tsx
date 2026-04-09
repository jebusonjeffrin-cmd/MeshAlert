import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  Animated, ScrollView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { storageService } from '../services/StorageService';
import { requestAllPermissions } from '../utils/permissions';
import { COLORS } from '../utils/constants';
import DeviceInfo from 'react-native-device-info';

const ROLES = ['Survivor', 'Responder', 'Medical', 'Volunteer'];
const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

interface Props { onComplete: () => void }

const STEPS = [
  { icon: '📡', title: 'MeshAlert', sub: 'Offline disaster relief mesh' },
  { icon: '👤', title: 'Your Identity', sub: 'Shown in SOS alerts to rescuers' },
  { icon: '🔐', title: 'Permissions', sub: 'Required for BLE mesh to work' },
];

export const OnboardingScreen: React.FC<Props> = ({ onComplete }) => {
  const [step, setStep]           = useState(0);
  const [name, setName]           = useState('');
  const [role, setRole]           = useState('Survivor');
  const [bloodGroup, setBloodGroup] = useState('');
  const [permsDone, setPermsDone] = useState(false);
  const [loading, setLoading]     = useState(false);

  const fadeAnim  = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;

  const goNext = () => {
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 0, duration: 120, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: -20, duration: 120, useNativeDriver: true }),
    ]).start(() => {
      setStep(s => s + 1);
      slideAnim.setValue(24);
      Animated.parallel([
        Animated.timing(fadeAnim,  { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start();
    });
  };

  const handlePermissions = async () => {
    setLoading(true);
    await requestAllPermissions();
    setPermsDone(true);
    setLoading(false);
  };

  const handleFinish = async () => {
    setLoading(true);
    try {
      await storageService.initialize();
      const deviceId = await DeviceInfo.getUniqueId();
      await storageService.saveProfile({
        deviceId,
        name: name.trim() || role,
        bloodGroup: bloodGroup || undefined,
      });
      await AsyncStorage.setItem('onboarding_done', 'true');
      onComplete();
    } catch {
      onComplete();
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.screen}>
      {/* Background mesh lines (decorative) */}
      <View style={styles.bgDecor} pointerEvents="none">
        {[0,1,2,3,4].map(i => (
          <View key={i} style={[styles.bgLine, { top: i * 80 + 40, opacity: 0.04 + i * 0.008 }]} />
        ))}
      </View>

      {/* Step indicators */}
      <View style={styles.stepBar}>
        {STEPS.map((s, i) => (
          <View key={i} style={styles.stepBarItem}>
            <View style={[styles.stepBarDot,
              i < step && styles.stepBarDotDone,
              i === step && styles.stepBarDotActive,
            ]}>
              {i < step ? <Text style={styles.stepBarCheck}>✓</Text> : null}
            </View>
            {i < STEPS.length - 1 && (
              <View style={[styles.stepBarLine, i < step && styles.stepBarLineDone]} />
            )}
          </View>
        ))}
      </View>

      <Animated.View style={[styles.body, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>

        {/* ── Step 0: Welcome ── */}
        {step === 0 && (
          <View style={styles.stepWrap}>
            <View style={styles.heroIconWrap}>
              <Text style={styles.heroIcon}>🆘</Text>
            </View>
            <Text style={styles.title}>MeshAlert</Text>
            <Text style={styles.subtitle}>Offline disaster relief mesh network</Text>

            <Text style={styles.bodyText}>
              Communicate with nearby devices using Bluetooth — no internet, no cell service required.
              SOS broadcasts hop through multiple phones to reach help.
            </Text>

            <View style={styles.featureGrid}>
              {[
                { icon: '📡', label: 'BLE Mesh', desc: 'Works offline' },
                { icon: '🔴', label: 'One-tap SOS', desc: 'Instant broadcast' },
                { icon: '📍', label: 'GPS Sharing', desc: 'Location in every alert' },
                { icon: '🎙', label: 'Voice Notes', desc: 'Audio in SOS messages' },
                { icon: '💓', label: 'Heartbeat', desc: 'Auto-ping every 5 min' },
                { icon: '✅', label: 'ACK System', desc: '"I\'m coming" replies' },
              ].map(f => (
                <View key={f.label} style={styles.featureCard}>
                  <Text style={styles.featureCardIcon}>{f.icon}</Text>
                  <Text style={styles.featureCardLabel}>{f.label}</Text>
                  <Text style={styles.featureCardDesc}>{f.desc}</Text>
                </View>
              ))}
            </View>

            <TouchableOpacity style={styles.primaryBtn} onPress={goNext} activeOpacity={0.85}>
              <Text style={styles.primaryBtnText}>Get Started</Text>
              <Text style={styles.primaryBtnArrow}>→</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Step 1: Profile ── */}
        {step === 1 && (
          <ScrollView contentContainerStyle={styles.stepWrap} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <View style={styles.heroIconWrap}>
              <Text style={styles.heroIcon}>👤</Text>
            </View>
            <Text style={styles.title}>Your Identity</Text>
            <Text style={styles.subtitle}>Shown in SOS alerts to help rescuers identify you</Text>

            <Text style={styles.label}>Display Name *</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Enter your name"
              placeholderTextColor={COLORS.textMuted}
              maxLength={40}
              autoFocus
            />

            <Text style={styles.label}>Your Role</Text>
            <View style={styles.chipRow}>
              {ROLES.map(r => (
                <TouchableOpacity
                  key={r}
                  style={[styles.chip, role === r && styles.chipActive]}
                  onPress={() => setRole(r)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.chipText, role === r && styles.chipTextActive]}>{r}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Blood Group <Text style={styles.labelOptional}>(optional — shared in SOS)</Text></Text>
            <View style={styles.chipRow}>
              {BLOOD_GROUPS.map(bg => (
                <TouchableOpacity
                  key={bg}
                  style={[styles.chip, bloodGroup === bg && styles.chipBloodActive]}
                  onPress={() => setBloodGroup(bloodGroup === bg ? '' : bg)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.chipText, bloodGroup === bg && styles.chipTextActive]}>{bg}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={[styles.primaryBtn, !name.trim() && styles.primaryBtnDisabled]}
              onPress={() => { if (name.trim()) goNext(); }}
              disabled={!name.trim()}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryBtnText}>Continue</Text>
              <Text style={styles.primaryBtnArrow}>→</Text>
            </TouchableOpacity>
          </ScrollView>
        )}

        {/* ── Step 2: Permissions ── */}
        {step === 2 && (
          <View style={styles.stepWrap}>
            <View style={styles.heroIconWrap}>
              <Text style={styles.heroIcon}>🔐</Text>
            </View>
            <Text style={styles.title}>Permissions</Text>
            <Text style={styles.subtitle}>Required for BLE mesh and SOS features</Text>

            <View style={styles.permList}>
              {[
                ['📍', 'Location', 'Required for BLE scanning on Android'],
                ['📡', 'Bluetooth', 'For BLE advertising and scanning'],
                ['🎙', 'Microphone', 'For voice SOS notes'],
                ['🔔', 'Notifications', 'For foreground service alert'],
              ].map(([icon, pName, desc]) => (
                <View key={pName} style={[styles.permRow, permsDone && styles.permRowDone]}>
                  <Text style={styles.permIcon}>{icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.permName}>{pName}</Text>
                    <Text style={styles.permDesc}>{desc}</Text>
                  </View>
                  <Text style={styles.permCheck}>{permsDone ? '✅' : '○'}</Text>
                </View>
              ))}
            </View>

            {!permsDone ? (
              <TouchableOpacity
                style={[styles.primaryBtn, loading && styles.primaryBtnDisabled]}
                onPress={handlePermissions}
                disabled={loading}
                activeOpacity={0.85}
              >
                <Text style={styles.primaryBtnText}>{loading ? 'Requesting...' : 'Grant Permissions'}</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.primaryBtn, styles.primaryBtnGreen, loading && styles.primaryBtnDisabled]}
                onPress={handleFinish}
                disabled={loading}
                activeOpacity={0.85}
              >
                <Text style={styles.primaryBtnText}>{loading ? 'Setting up...' : 'Launch MeshAlert'}</Text>
                <Text style={styles.primaryBtnArrow}>🚀</Text>
              </TouchableOpacity>
            )}

            {!permsDone && (
              <TouchableOpacity style={styles.skipBtn} onPress={handleFinish}>
                <Text style={styles.skipText}>Skip for now</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  bgDecor: { ...StyleSheet.absoluteFillObject, overflow: 'hidden' },
  bgLine: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: COLORS.peer },

  stepBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingTop: 52, paddingHorizontal: 60, paddingBottom: 8,
  },
  stepBarItem: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  stepBarDot: {
    width: 28, height: 28, borderRadius: 14, flexShrink: 0,
    backgroundColor: COLORS.surfaceLight, borderWidth: 2, borderColor: COLORS.border,
    alignItems: 'center', justifyContent: 'center',
  },
  stepBarDotActive: { borderColor: COLORS.sos, backgroundColor: 'rgba(255,59,48,0.12)' },
  stepBarDotDone:   { borderColor: COLORS.safe, backgroundColor: COLORS.safe },
  stepBarCheck: { fontSize: 13, color: '#fff', fontWeight: '900' },
  stepBarLine: { flex: 1, height: 2, backgroundColor: COLORS.border, marginHorizontal: 4 },
  stepBarLineDone: { backgroundColor: COLORS.safe },

  body: { flex: 1 },
  stepWrap: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 32, alignItems: 'center' },

  heroIconWrap: {
    width: 80, height: 80, borderRadius: 24,
    backgroundColor: 'rgba(255,59,48,0.1)',
    borderWidth: 2, borderColor: 'rgba(255,59,48,0.25)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 20,
  },
  heroIcon: { fontSize: 38 },

  title: { fontSize: 28, fontWeight: '900', color: COLORS.text, textAlign: 'center', marginBottom: 6, letterSpacing: -0.5 },
  subtitle: { fontSize: 14, color: COLORS.textMuted, textAlign: 'center', marginBottom: 20, lineHeight: 20 },
  bodyText: { fontSize: 14, color: COLORS.text, textAlign: 'center', lineHeight: 22, marginBottom: 24, opacity: 0.85 },

  featureGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10,
    alignSelf: 'stretch', marginBottom: 28,
  },
  featureCard: {
    flex: 1, minWidth: '28%',
    backgroundColor: COLORS.surface, borderRadius: 12,
    padding: 12, borderWidth: 1, borderColor: COLORS.border,
    alignItems: 'center',
  },
  featureCardIcon: { fontSize: 22, marginBottom: 4 },
  featureCardLabel: { fontSize: 12, fontWeight: '800', color: COLORS.text, textAlign: 'center' },
  featureCardDesc: { fontSize: 10, color: COLORS.textMuted, textAlign: 'center', marginTop: 2 },

  label: { alignSelf: 'flex-start', fontSize: 13, fontWeight: '700', color: COLORS.textMuted, marginBottom: 8, marginTop: 16 },
  labelOptional: { fontWeight: '400', fontSize: 11 },
  input: {
    alignSelf: 'stretch', backgroundColor: COLORS.surface, borderRadius: 12,
    padding: 14, color: COLORS.text, fontSize: 16, borderWidth: 1, borderColor: COLORS.border,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignSelf: 'flex-start', marginBottom: 4 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 8,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
  },
  chipActive: { backgroundColor: COLORS.sos, borderColor: COLORS.sos },
  chipBloodActive: { backgroundColor: COLORS.medical, borderColor: COLORS.medical },
  chipText: { fontSize: 13, fontWeight: '700', color: COLORS.textMuted },
  chipTextActive: { color: '#fff' },

  permList: { alignSelf: 'stretch', gap: 10, marginBottom: 24 },
  permRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: COLORS.surface, padding: 14, borderRadius: 12,
    borderWidth: 1, borderColor: COLORS.border,
  },
  permRowDone: { borderColor: 'rgba(67,160,71,0.3)', backgroundColor: 'rgba(67,160,71,0.06)' },
  permIcon: { fontSize: 22 },
  permName: { fontSize: 14, fontWeight: '700', color: COLORS.text },
  permDesc: { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
  permCheck: { fontSize: 18 },

  primaryBtn: {
    alignSelf: 'stretch', backgroundColor: COLORS.sos, borderRadius: 14,
    paddingVertical: 16, paddingHorizontal: 24,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    marginTop: 8,
    elevation: 8, shadowColor: COLORS.sos, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12,
  },
  primaryBtnGreen: {
    backgroundColor: COLORS.safe,
    shadowColor: COLORS.safe,
  },
  primaryBtnDisabled: { opacity: 0.45, elevation: 0 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  primaryBtnArrow: { color: 'rgba(255,255,255,0.8)', fontSize: 18, fontWeight: '900' },

  skipBtn: { marginTop: 14, padding: 10 },
  skipText: { fontSize: 13, color: COLORS.textMuted, fontWeight: '600' },
});
