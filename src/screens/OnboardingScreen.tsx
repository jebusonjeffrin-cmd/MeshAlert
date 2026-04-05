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

export const OnboardingScreen: React.FC<Props> = ({ onComplete }) => {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [role, setRole] = useState('Survivor');
  const [bloodGroup, setBloodGroup] = useState('');
  const [permsDone, setPermsDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const slideAnim = useRef(new Animated.Value(0)).current;

  const goNext = () => {
    Animated.sequence([
      Animated.timing(slideAnim, { toValue: -20, duration: 150, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start();
    setStep(s => s + 1);
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
    } catch (e) {
      console.warn('[Onboarding] finish error:', e);
      onComplete(); // don't block user
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.screen}>
      <Animated.View style={[styles.container, { transform: [{ translateY: slideAnim }] }]}>

        {/* ── Step 0: Welcome ──────────────────────────────────────── */}
        {step === 0 && (
          <View style={styles.stepWrap}>
            <Text style={styles.bigIcon}>🆘</Text>
            <Text style={styles.title}>MeshAlert</Text>
            <Text style={styles.subtitle}>Offline disaster relief mesh network</Text>
            <Text style={styles.body}>
              Communicate with nearby devices using Bluetooth — no internet, no cell service required.
              Works up to 50m per hop. SOS broadcasts relay through multiple devices.
            </Text>
            <View style={styles.featureList}>
              {['📡 BLE mesh — works offline', '🔴 1-tap SOS broadcast', '📍 GPS location sharing', '💓 Heartbeat ping every 5 min'].map(f => (
                <Text key={f} style={styles.feature}>{f}</Text>
              ))}
            </View>
            <TouchableOpacity style={styles.primaryBtn} onPress={goNext}>
              <Text style={styles.primaryBtnText}>Get Started →</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Step 1: Profile ──────────────────────────────────────── */}
        {step === 1 && (
          <ScrollView contentContainerStyle={styles.stepWrap} keyboardShouldPersistTaps="handled">
            <Text style={styles.bigIcon}>👤</Text>
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
                >
                  <Text style={[styles.chipText, role === r && styles.chipTextActive]}>{r}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Blood Group (optional)</Text>
            <View style={styles.chipRow}>
              {BLOOD_GROUPS.map(bg => (
                <TouchableOpacity
                  key={bg}
                  style={[styles.chip, bloodGroup === bg && styles.chipActive]}
                  onPress={() => setBloodGroup(bloodGroup === bg ? '' : bg)}
                >
                  <Text style={[styles.chipText, bloodGroup === bg && styles.chipTextActive]}>{bg}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={[styles.primaryBtn, !name.trim() && styles.primaryBtnDisabled]}
              onPress={() => { if (name.trim()) goNext(); }}
              disabled={!name.trim()}
            >
              <Text style={styles.primaryBtnText}>Next →</Text>
            </TouchableOpacity>
          </ScrollView>
        )}

        {/* ── Step 2: Permissions ──────────────────────────────────── */}
        {step === 2 && (
          <View style={styles.stepWrap}>
            <Text style={styles.bigIcon}>🔒</Text>
            <Text style={styles.title}>Permissions</Text>
            <Text style={styles.subtitle}>Required for BLE mesh to work</Text>

            <View style={styles.permList}>
              {[
                ['📍', 'Location', 'Required for BLE scanning on Android'],
                ['📡', 'Bluetooth', 'For BLE advertising and scanning'],
                ['🎙', 'Microphone', 'For voice SOS notes'],
                ['🔔', 'Notifications', 'For foreground service alert'],
              ].map(([icon, name, desc]) => (
                <View key={name} style={styles.permRow}>
                  <Text style={styles.permIcon}>{icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.permName}>{name}</Text>
                    <Text style={styles.permDesc}>{desc}</Text>
                  </View>
                  <Text style={styles.permCheck}>{permsDone ? '✅' : '○'}</Text>
                </View>
              ))}
            </View>

            {!permsDone && (
              <TouchableOpacity
                style={[styles.primaryBtn, loading && styles.primaryBtnDisabled]}
                onPress={handlePermissions}
                disabled={loading}
              >
                <Text style={styles.primaryBtnText}>{loading ? 'Requesting...' : 'Grant Permissions'}</Text>
              </TouchableOpacity>
            )}

            {permsDone && (
              <TouchableOpacity
                style={[styles.primaryBtn, loading && styles.primaryBtnDisabled]}
                onPress={handleFinish}
                disabled={loading}
              >
                <Text style={styles.primaryBtnText}>{loading ? 'Setting up...' : 'Launch MeshAlert →'}</Text>
              </TouchableOpacity>
            )}

            {!permsDone && (
              <TouchableOpacity style={styles.skipBtn} onPress={handleFinish}>
                <Text style={styles.skipText}>Skip for now</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Progress dots */}
        <View style={styles.dots}>
          {[0, 1, 2].map(i => (
            <View key={i} style={[styles.dot, step === i && styles.dotActive]} />
          ))}
        </View>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  container: { flex: 1 },
  stepWrap: {
    flex: 1, padding: 28, paddingTop: 60, paddingBottom: 32,
    alignItems: 'center',
  },
  bigIcon: { fontSize: 56, marginBottom: 16 },
  title: { fontSize: 28, fontWeight: '900', color: COLORS.text, textAlign: 'center', marginBottom: 6 },
  subtitle: { fontSize: 14, color: COLORS.textMuted, textAlign: 'center', marginBottom: 20 },
  body: { fontSize: 14, color: COLORS.text, textAlign: 'center', lineHeight: 22, marginBottom: 20 },
  featureList: { alignSelf: 'stretch', gap: 8, marginBottom: 32 },
  feature: { fontSize: 14, color: COLORS.text, paddingVertical: 8, paddingHorizontal: 16, backgroundColor: COLORS.surface, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border },
  label: { alignSelf: 'flex-start', fontSize: 13, fontWeight: '700', color: COLORS.textMuted, marginBottom: 8, marginTop: 16 },
  input: {
    alignSelf: 'stretch', backgroundColor: COLORS.surface, borderRadius: 12,
    padding: 14, color: COLORS.text, fontSize: 16, borderWidth: 1, borderColor: COLORS.border,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignSelf: 'flex-start', marginBottom: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  chipActive: { backgroundColor: COLORS.sos, borderColor: COLORS.sos },
  chipText: { fontSize: 13, fontWeight: '700', color: COLORS.textMuted },
  chipTextActive: { color: '#fff' },
  permList: { alignSelf: 'stretch', gap: 12, marginBottom: 28 },
  permRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: COLORS.surface, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border },
  permIcon: { fontSize: 22 },
  permName: { fontSize: 14, fontWeight: '700', color: COLORS.text },
  permDesc: { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
  permCheck: { fontSize: 18 },
  primaryBtn: {
    alignSelf: 'stretch', backgroundColor: COLORS.sos, borderRadius: 14,
    paddingVertical: 16, alignItems: 'center', marginTop: 8,
  },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  skipBtn: { marginTop: 12, padding: 10 },
  skipText: { fontSize: 13, color: COLORS.textMuted },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8, paddingBottom: 28 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.border },
  dotActive: { backgroundColor: COLORS.sos, width: 24 },
});
