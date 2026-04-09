import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity, Alert,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { storageService } from '../services/StorageService';
import { UserProfile } from '../types';
import { COLORS } from '../utils/constants';
import DeviceInfo from 'react-native-device-info';

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

class QRErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { err: boolean }
> {
  constructor(p: any) { super(p); this.state = { err: false }; }
  static getDerivedStateFromError() { return { err: true }; }
  render() {
    if (this.state.err) {
      return (
        <Text style={{ fontSize: 12, color: COLORS.textMuted, textAlign: 'center', marginTop: 12 }}>
          QR code unavailable on this device
        </Text>
      );
    }
    return this.props.children;
  }
}

export const ProfileScreen: React.FC = () => {
  const [name, setName]                   = useState('');
  const [bloodGroup, setBloodGroup]       = useState('');
  const [medicalConditions, setMedicalConditions] = useState('');
  const [allergies, setAllergies]         = useState('');
  const [emergencyContacts, setEmergencyContacts] = useState('');
  const [deviceId, setDeviceId]           = useState('');
  const [saving, setSaving]               = useState(false);

  const loadProfile = useCallback(async () => {
    try {
      await storageService.initialize();
      const profile = await storageService.getProfile();
      if (profile) {
        setName(profile.name ?? '');
        setBloodGroup(profile.bloodGroup ?? '');
        setMedicalConditions(profile.medicalConditions ?? '');
        setAllergies(profile.allergies ?? '');
        setEmergencyContacts(profile.emergencyContacts ?? '');
      }
      const uid = await DeviceInfo.getUniqueId();
      setDeviceId(uid);
    } catch (e) {
      console.warn('[Profile] loadProfile error:', e);
    }
  }, []);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Name required', 'Please enter your name so others can identify you in emergencies.');
      return;
    }
    setSaving(true);
    try {
      const profile: UserProfile = {
        deviceId,
        name: name.trim(),
        bloodGroup: bloodGroup || undefined,
        medicalConditions: medicalConditions.trim() || undefined,
        allergies: allergies.trim() || undefined,
        emergencyContacts: emergencyContacts.trim() || undefined,
      };
      await storageService.saveProfile(profile);
      Alert.alert('Saved', 'Your profile has been saved. It will be included in SOS broadcasts.');
    } catch {
      Alert.alert('Error', 'Could not save profile.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

      {/* Identity section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={[styles.sectionAccent, { backgroundColor: COLORS.peer }]} />
          <Text style={styles.sectionTitle}>Identity</Text>
        </View>

        <Text style={styles.label}>Display Name *</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="Your name (shown in SOS alerts)"
          placeholderTextColor={COLORS.textMuted}
          maxLength={40}
        />
        <View style={styles.deviceIdRow}>
          <Text style={styles.deviceIdLabel}>Device ID</Text>
          <Text style={styles.deviceIdValue}>{deviceId ? deviceId.slice(-12) : '...'}</Text>
        </View>

        {/* QR Identity Card */}
        {name.trim().length > 0 && deviceId.length > 0 && (
          <View style={styles.qrSection}>
            <View style={styles.qrHeader}>
              <Text style={styles.qrTitle}>QR Identity Card</Text>
              <Text style={styles.qrSub}>Show to first responders</Text>
            </View>
            <View style={styles.qrWrapper}>
              <QRErrorBoundary>
                <QRCode
                  value={JSON.stringify({
                    deviceId, name: name.trim(),
                    bloodGroup: bloodGroup || undefined,
                    medicalConditions: medicalConditions.trim() || undefined,
                    allergies: allergies.trim() || undefined,
                  })}
                  size={180}
                  backgroundColor={COLORS.surface}
                  color={COLORS.text}
                />
              </QRErrorBoundary>
            </View>
          </View>
        )}
      </View>

      {/* Medical section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={[styles.sectionAccent, { backgroundColor: COLORS.medical }]} />
          <Text style={styles.sectionTitle}>Medical Info</Text>
          <Text style={styles.sectionBadge}>Included in SOS broadcasts</Text>
        </View>

        <Text style={styles.label}>Blood Group</Text>
        <View style={styles.bloodRow}>
          {BLOOD_GROUPS.map(bg => (
            <TouchableOpacity
              key={bg}
              style={[styles.bgChip, bloodGroup === bg && styles.bgChipActive]}
              onPress={() => setBloodGroup(bloodGroup === bg ? '' : bg)}
              activeOpacity={0.8}
            >
              <Text style={[styles.bgText, bloodGroup === bg && styles.bgTextActive]}>{bg}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Medical Conditions</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={medicalConditions}
          onChangeText={setMedicalConditions}
          placeholder="e.g. Diabetes, Heart condition..."
          placeholderTextColor={COLORS.textMuted}
          multiline
          maxLength={200}
        />

        <Text style={styles.label}>Allergies</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={allergies}
          onChangeText={setAllergies}
          placeholder="e.g. Penicillin, Peanuts..."
          placeholderTextColor={COLORS.textMuted}
          multiline
          maxLength={200}
        />
      </View>

      {/* Emergency contacts section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={[styles.sectionAccent, { backgroundColor: COLORS.sos }]} />
          <Text style={styles.sectionTitle}>Emergency Contacts</Text>
        </View>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={emergencyContacts}
          onChangeText={setEmergencyContacts}
          placeholder={'Name: Phone\ne.g. Jane Doe: +1-555-0100'}
          placeholderTextColor={COLORS.textMuted}
          multiline
          maxLength={300}
        />
      </View>

      {/* Save button */}
      <TouchableOpacity
        style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
        onPress={handleSave}
        disabled={saving}
        activeOpacity={0.85}
      >
        <Text style={styles.saveBtnText}>{saving ? 'Saving...' : 'Save Profile'}</Text>
      </TouchableOpacity>

      {/* Privacy note */}
      <View style={styles.privacyNote}>
        <Text style={styles.privacyIcon}>🔒</Text>
        <Text style={styles.privacyText}>
          Profile data is stored locally. It is only transmitted during an active SOS broadcast.
        </Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: 20, paddingBottom: 48 },

  section: {
    marginBottom: 24, paddingBottom: 24,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  sectionAccent: { width: 3, height: 16, borderRadius: 2 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: COLORS.text, flex: 1 },
  sectionBadge: {
    fontSize: 10, color: COLORS.textMuted, fontWeight: '700',
    backgroundColor: COLORS.surfaceLight, borderRadius: 100,
    paddingHorizontal: 8, paddingVertical: 3, letterSpacing: 0.3,
    borderWidth: 1, borderColor: COLORS.border,
  },

  label: { fontSize: 12, color: COLORS.textMuted, fontWeight: '700', marginBottom: 8, marginTop: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    backgroundColor: COLORS.surface, borderRadius: 12, padding: 14,
    color: COLORS.text, fontSize: 14, borderWidth: 1, borderColor: COLORS.border,
  },
  multiline: { minHeight: 72, textAlignVertical: 'top' },

  deviceIdRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 8, paddingHorizontal: 4,
  },
  deviceIdLabel: { fontSize: 11, color: COLORS.textMuted },
  deviceIdValue: { fontSize: 11, color: COLORS.textMuted, fontFamily: 'monospace' },

  qrSection: { marginTop: 20, alignItems: 'center' },
  qrHeader: { alignItems: 'center', marginBottom: 14 },
  qrTitle: { fontSize: 14, fontWeight: '800', color: COLORS.text },
  qrSub: { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
  qrWrapper: {
    padding: 20, backgroundColor: COLORS.surface,
    borderRadius: 16, borderWidth: 1, borderColor: COLORS.border,
    elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8,
  },

  bloodRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  bgChip: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
  },
  bgChipActive: {
    backgroundColor: COLORS.medical, borderColor: COLORS.medical,
    elevation: 4, shadowColor: COLORS.medical, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.4, shadowRadius: 6,
  },
  bgText: { fontSize: 13, fontWeight: '700', color: COLORS.textMuted },
  bgTextActive: { color: '#fff' },

  saveBtn: {
    backgroundColor: COLORS.sos, borderRadius: 14, paddingVertical: 17,
    alignItems: 'center', marginBottom: 14,
    elevation: 6, shadowColor: COLORS.sos, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12,
  },
  saveBtnDisabled: { opacity: 0.55, elevation: 0 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '900', letterSpacing: 0.3 },

  privacyNote: {
    flexDirection: 'row', gap: 10, alignItems: 'flex-start',
    padding: 14, backgroundColor: COLORS.surfaceLight,
    borderRadius: 12, borderWidth: 1, borderColor: COLORS.border,
  },
  privacyIcon: { fontSize: 16, marginTop: 1 },
  privacyText: { flex: 1, fontSize: 12, color: COLORS.textMuted, lineHeight: 18 },
});
