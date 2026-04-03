import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity, Alert,
} from 'react-native';
import { syncService } from '../services/SyncService';
import { storageService } from '../services/StorageService';
import { COLORS } from '../utils/constants';

export const SettingsScreen: React.FC = () => {
  const [savedURL, setSavedURL] = useState('');
  const [inputURL, setInputURL] = useState('');
  const [testing, setTesting] = useState(false);
  const [clearingData, setClearingData] = useState(false);

  useEffect(() => {
    const saved = syncService.getDashboardURL();
    setSavedURL(saved);
    setInputURL(saved);
  }, []);

  const handleSave = async () => {
    const val = inputURL.trim();
    await syncService.setDashboardURL(val);
    // getDashboardURL returns the normalised full URL
    const normalized = syncService.getDashboardURL();
    setSavedURL(normalized);
    Alert.alert('Saved', normalized || 'Dashboard cleared — offline mode.');
  };

  const handleTest = async () => {
    if (!savedURL) {
      Alert.alert('Nothing saved', 'Enter a URL or IP first.');
      return;
    }
    setTesting(true);
    try {
      const res = await fetch(`${savedURL}/api/health`, { method: 'GET' });
      if (res.ok) {
        const json = await res.json();
        Alert.alert('Connected ✅', `Dashboard is reachable.\n${json.messages ?? 0} alerts stored.`);
      } else {
        Alert.alert('Error', `HTTP ${res.status}`);
      }
    } catch (e: any) {
      Alert.alert('Connection failed', e.message ?? 'Could not reach dashboard.');
    } finally {
      setTesting(false);
    }
  };

  const handleClearData = () => {
    Alert.alert(
      'Clear All Data?',
      'This will delete all stored SOS messages. Your profile will be preserved.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear', style: 'destructive',
          onPress: async () => {
            setClearingData(true);
            try {
              await storageService.clearMessages();
              Alert.alert('Done', 'All messages cleared.');
            } catch {
              Alert.alert('Error', 'Could not clear data.');
            } finally {
              setClearingData(false);
            }
          },
        },
      ],
    );
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Dashboard Sync</Text>
        <Text style={styles.hint}>
          Enter a public tunnel URL (e.g. https://abc.loca.lt) OR a local IP
          (e.g. 192.168.1.100) if on the same Wi-Fi. Any phone that gets
          internet will automatically upload all relayed SOS messages.
          Leave blank for offline-only mode.
        </Text>

        <Text style={styles.label}>Dashboard URL or IP</Text>
        <TextInput
          style={styles.input}
          value={inputURL}
          onChangeText={setInputURL}
          placeholder="https://abc.loca.lt  or  192.168.1.100"
          placeholderTextColor={COLORS.textMuted}
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <View style={styles.btnRow}>
          <TouchableOpacity style={styles.btnSecondary} onPress={handleSave}>
            <Text style={styles.btnSecondaryText}>Save</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btnSecondary, testing && styles.btnDisabled]}
            onPress={handleTest}
            disabled={testing}
          >
            <Text style={styles.btnSecondaryText}>{testing ? 'Testing...' : 'Test'}</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.currentUrl} numberOfLines={1}>
          {savedURL ? `Active: ${savedURL}` : 'Offline mode — no dashboard configured'}
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Mesh Network Info</Text>
        <InfoRow label="Protocol" value="BLE 4.0+ GATT" />
        <InfoRow label="Message TTL" value="10 hops" />
        <InfoRow label="Scan interval" value="Every 30s" />
        <InfoRow label="Scan window" value="10s (UUID + name fallback)" />
        <InfoRow label="Heartbeat" value="Every 60s" />
        <InfoRow label="Shake trigger" value="3× in 2s window" />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Data</Text>
        <TouchableOpacity
          style={[styles.btnDanger, clearingData && styles.btnDisabled]}
          onPress={handleClearData}
          disabled={clearingData}
        >
          <Text style={styles.btnDangerText}>
            {clearingData ? 'Clearing...' : 'Clear All Stored Messages'}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.about}>
        <Text style={styles.aboutTitle}>MeshAlert</Text>
        <Text style={styles.aboutSub}>Offline disaster relief mesh network</Text>
        <Text style={styles.aboutSub}>React Native · BLE Mesh · SQLite · No internet required</Text>
      </View>
    </ScrollView>
  );
};

const InfoRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <View style={styles.infoRow}>
    <Text style={styles.infoLabel}>{label}</Text>
    <Text style={styles.infoValue}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: 20, paddingBottom: 40 },
  section: { marginBottom: 28 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: COLORS.text, marginBottom: 4 },
  hint: { fontSize: 12, color: COLORS.textMuted, marginBottom: 12, lineHeight: 18 },
  label: { fontSize: 13, color: COLORS.textMuted, fontWeight: '600', marginBottom: 6 },
  input: {
    backgroundColor: COLORS.surface, borderRadius: 10, padding: 14,
    color: COLORS.text, fontSize: 13, borderWidth: 1, borderColor: COLORS.border,
    marginBottom: 10,
  },
  btnRow: { flexDirection: 'row', gap: 10 },
  btnSecondary: {
    flex: 1, paddingVertical: 12, borderRadius: 10,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    alignItems: 'center',
  },
  btnSecondaryText: { fontSize: 14, fontWeight: '700', color: COLORS.text },
  btnDisabled: { opacity: 0.5 },
  currentUrl: { fontSize: 11, color: COLORS.textMuted, marginTop: 8, fontFamily: 'monospace' },
  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  infoLabel: { fontSize: 13, color: COLORS.textMuted },
  infoValue: { fontSize: 13, color: COLORS.text, fontWeight: '600' },
  btnDanger: {
    backgroundColor: 'rgba(183,28,28,0.12)', borderRadius: 10, paddingVertical: 14,
    alignItems: 'center', borderWidth: 1, borderColor: COLORS.sos,
  },
  btnDangerText: { fontSize: 14, fontWeight: '700', color: COLORS.sos },
  about: { alignItems: 'center', paddingTop: 20, gap: 4 },
  aboutTitle: { fontSize: 18, fontWeight: '900', color: COLORS.text },
  aboutSub: { fontSize: 12, color: COLORS.textMuted, textAlign: 'center' },
});
