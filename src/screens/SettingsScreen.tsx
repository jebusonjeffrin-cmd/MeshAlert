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
    const normalized = syncService.getDashboardURL();
    setSavedURL(normalized);
    Alert.alert('Saved', normalized || 'Dashboard cleared — offline mode.');
  };

  const handleTest = async () => {
    if (!savedURL) { Alert.alert('Nothing saved', 'Enter a URL or IP first.'); return; }
    setTesting(true);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(`${savedURL}/api/health`, { method: 'GET', signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        const json = await res.json();
        Alert.alert('Connected ✅', `Dashboard is reachable.\n${json.messages ?? 0} alerts stored.`);
      } else {
        Alert.alert('Error', `HTTP ${res.status}`);
      }
    } catch (e: any) {
      clearTimeout(timer);
      Alert.alert('Connection failed', e.name === 'AbortError' ? 'Timed out after 8s' : (e.message ?? 'Could not reach dashboard.'));
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
            } finally { setClearingData(false); }
          },
        },
      ],
    );
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

      {/* Dashboard Sync section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={[styles.sectionAccent, { backgroundColor: COLORS.peer }]} />
          <Text style={styles.sectionTitle}>Dashboard Sync</Text>
        </View>
        <Text style={styles.hint}>
          Enter a public tunnel URL (e.g. https://abc.loca.lt) or a local IP (e.g. 192.168.1.100)
          if on the same Wi-Fi. Any phone that gets internet will automatically upload all relayed SOS messages.
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
          <TouchableOpacity style={styles.btnSave} onPress={handleSave}>
            <Text style={styles.btnSaveText}>Save</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btnTest, testing && styles.btnDisabled]}
            onPress={handleTest}
            disabled={testing}
          >
            <Text style={styles.btnTestText}>{testing ? 'Testing...' : 'Test Connection'}</Text>
          </TouchableOpacity>
        </View>
        {savedURL ? (
          <View style={styles.activeUrlRow}>
            <View style={styles.activeUrlDot} />
            <Text style={styles.activeUrl} numberOfLines={1}>{savedURL}</Text>
          </View>
        ) : (
          <Text style={styles.offlineNote}>Offline mode — no dashboard configured</Text>
        )}
      </View>

      {/* Mesh info section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={[styles.sectionAccent, { backgroundColor: COLORS.safe }]} />
          <Text style={styles.sectionTitle}>Mesh Network</Text>
        </View>
        <View style={styles.infoTable}>
          {[
            ['Protocol',       'BLE 4.0+ GATT custom service'],
            ['Message TTL',    '10 hops max relay depth'],
            ['Scan interval',  'Every 30s (10s window)'],
            ['Heartbeat',      'Every 5 min (15 min low battery)'],
            ['Shake trigger',  '3× in 2s window'],
            ['Audio',          'Stored locally, synced via internet'],
          ].map(([label, value]) => (
            <InfoRow key={label} label={label} value={value} />
          ))}
        </View>
      </View>

      {/* Data section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={[styles.sectionAccent, { backgroundColor: COLORS.sos }]} />
          <Text style={styles.sectionTitle}>Data</Text>
        </View>
        <TouchableOpacity
          style={[styles.btnDanger, clearingData && styles.btnDisabled]}
          onPress={handleClearData}
          disabled={clearingData}
        >
          <Text style={styles.btnDangerText}>
            {clearingData ? 'Clearing...' : '🗑  Clear All Stored Messages'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* About */}
      <View style={styles.about}>
        <View style={styles.aboutBadge}>
          <Text style={styles.aboutBadgeText}>🆘</Text>
        </View>
        <Text style={styles.aboutTitle}>MeshAlert</Text>
        <Text style={styles.aboutSub}>Offline disaster relief mesh network</Text>
        <View style={styles.aboutTechRow}>
          {['BLE Mesh', 'SQLite', 'React Native', 'No Internet Required'].map(t => (
            <View key={t} style={styles.techChip}>
              <Text style={styles.techChipText}>{t}</Text>
            </View>
          ))}
        </View>
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
  content: { padding: 20, paddingBottom: 48 },

  section: { marginBottom: 28 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  sectionAccent: { width: 3, height: 16, borderRadius: 2 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: COLORS.text },
  hint: { fontSize: 12, color: COLORS.textMuted, marginBottom: 14, lineHeight: 18 },

  label: { fontSize: 12, color: COLORS.textMuted, fontWeight: '700', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    backgroundColor: COLORS.surface, borderRadius: 12, padding: 14,
    color: COLORS.text, fontSize: 13, borderWidth: 1, borderColor: COLORS.border,
    marginBottom: 10,
  },
  btnRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  btnSave: {
    flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center',
    backgroundColor: COLORS.peer,
  },
  btnSaveText: { fontSize: 14, fontWeight: '800', color: '#fff' },
  btnTest: {
    flex: 2, paddingVertical: 12, borderRadius: 10, alignItems: 'center',
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
  },
  btnTestText: { fontSize: 14, fontWeight: '700', color: COLORS.text },
  btnDisabled: { opacity: 0.5 },

  activeUrlRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  activeUrlDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.safe, flexShrink: 0 },
  activeUrl: { fontSize: 11, color: COLORS.textMuted, fontFamily: 'monospace', flex: 1 },
  offlineNote: { fontSize: 11, color: COLORS.textMuted },

  infoTable: {
    backgroundColor: COLORS.surface, borderRadius: 12,
    borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden',
  },
  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    paddingVertical: 12, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  infoLabel: { fontSize: 13, color: COLORS.textMuted, flex: 1 },
  infoValue: { fontSize: 13, color: COLORS.text, fontWeight: '600', flex: 2, textAlign: 'right' },

  btnDanger: {
    backgroundColor: 'rgba(183,28,28,0.08)', borderRadius: 12, paddingVertical: 14,
    alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,59,48,0.3)',
  },
  btnDangerText: { fontSize: 14, fontWeight: '700', color: COLORS.sos },

  about: { alignItems: 'center', paddingTop: 16, gap: 8 },
  aboutBadge: {
    width: 52, height: 52, borderRadius: 16,
    backgroundColor: 'rgba(255,59,48,0.1)', borderWidth: 2, borderColor: 'rgba(255,59,48,0.2)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  aboutBadgeText: { fontSize: 26 },
  aboutTitle: { fontSize: 20, fontWeight: '900', color: COLORS.text },
  aboutSub: { fontSize: 12, color: COLORS.textMuted, textAlign: 'center' },
  aboutTechRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginTop: 4 },
  techChip: {
    backgroundColor: COLORS.surfaceLight, borderRadius: 100,
    paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: COLORS.border,
  },
  techChipText: { fontSize: 11, color: COLORS.textMuted, fontWeight: '600' },
});
