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

// Catches native crashes from react-native-svg / react-native-qrcode-svg
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
  const [name, setName] = useState('');
  const [bloodGroup, setBloodGroup] = useState('');
  const [medicalConditions, setMedicalConditions] = useState('');
  const [allergies, setAllergies] = useState('');
  const [emergencyContacts, setEmergencyContacts] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [saving, setSaving] = useState(false);

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
    } catch (e) {
      console.warn('[Profile] save error:', e);
      Alert.alert('Error', 'Could not save profile.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Identity</Text>
        <Text style={styles.label}>Display Name *</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="Your name (shown in SOS alerts)"
          placeholderTextColor={COLORS.textMuted}
          maxLength={40}
        />
        <Text style={styles.deviceId}>Device ID: {deviceId ? deviceId.slice(-12) : '...'}</Text>

        {/* QR Code — scan to share identity with first responders */}
        {name.trim().length > 0 && deviceId.length > 0 && (
          <View style={styles.qrContainer}>
            <Text style={styles.qrLabel}>QR Identity Card</Text>
            <Text style={styles.qrHint}>Show this to first responders</Text>
            <View style={styles.qrWrapper}>
              <QRErrorBoundary>
                <QRCode
                  value={JSON.stringify({
                    deviceId,
                    name: name.trim(),
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

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Medical Info</Text>
        <Text style={styles.hint}>Included in SOS broadcasts — helps responders</Text>

        <Text style={styles.label}>Blood Group</Text>
        <View style={styles.bloodRow}>
          {BLOOD_GROUPS.map(bg => (
            <TouchableOpacity
              key={bg}
              style={[styles.bgChip, bloodGroup === bg && styles.bgChipActive]}
              onPress={() => setBloodGroup(bloodGroup === bg ? '' : bg)}
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

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Emergency Contacts</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={emergencyContacts}
          onChangeText={setEmergencyContacts}
          placeholder="Name: Phone&#10;e.g. Jane Doe: +1-555-0100"
          placeholderTextColor={COLORS.textMuted}
          multiline
          maxLength={300}
        />
      </View>

      <TouchableOpacity
        style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
        onPress={handleSave}
        disabled={saving}
      >
        <Text style={styles.saveBtnText}>{saving ? 'Saving...' : 'Save Profile'}</Text>
      </TouchableOpacity>

      <View style={styles.privacyNote}>
        <Text style={styles.privacyText}>
          🔒 Profile data is stored locally on this device only. It is only transmitted during an active SOS broadcast.
        </Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: 20, paddingBottom: 40 },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: COLORS.text, marginBottom: 4 },
  hint: { fontSize: 12, color: COLORS.textMuted, marginBottom: 12 },
  label: { fontSize: 13, color: COLORS.textMuted, fontWeight: '600', marginBottom: 6, marginTop: 12 },
  input: {
    backgroundColor: COLORS.surface, borderRadius: 10, padding: 14,
    color: COLORS.text, fontSize: 14, borderWidth: 1, borderColor: COLORS.border,
  },
  multiline: { minHeight: 70, textAlignVertical: 'top' },
  deviceId: { fontSize: 11, color: COLORS.textMuted, marginTop: 6, fontFamily: 'monospace' },
  qrContainer: { marginTop: 20, alignItems: 'center' },
  qrLabel: { fontSize: 13, fontWeight: '800', color: COLORS.text, marginBottom: 2 },
  qrHint: { fontSize: 11, color: COLORS.textMuted, marginBottom: 12 },
  qrWrapper: {
    padding: 16, backgroundColor: COLORS.surface,
    borderRadius: 12, borderWidth: 1, borderColor: COLORS.border,
  },
  bloodRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  bgChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
  },
  bgChipActive: { backgroundColor: COLORS.medical, borderColor: COLORS.medical },
  bgText: { fontSize: 13, fontWeight: '700', color: COLORS.textMuted },
  bgTextActive: { color: '#fff' },
  saveBtn: {
    backgroundColor: COLORS.sos, borderRadius: 12, paddingVertical: 16,
    alignItems: 'center', marginBottom: 16,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  privacyNote: {
    padding: 12, backgroundColor: COLORS.surfaceLight,
    borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, borderStyle: 'dashed',
  },
  privacyText: { fontSize: 12, color: COLORS.textMuted, textAlign: 'center' },
});
