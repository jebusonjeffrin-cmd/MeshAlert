import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl,
} from 'react-native';
import { storageService } from '../services/StorageService';
import { meshService } from '../services/MeshService';
import { nearbyService } from '../services/NearbyService';
import { MeshMessage, PeerDevice } from '../types';
import { COLORS } from '../utils/constants';

type Tab = 'messages' | 'peers';

export const MeshScreen: React.FC = () => {
  const [tab, setTab] = useState<Tab>('messages');
  const [messages, setMessages] = useState<MeshMessage[]>([]);
  const [peers, setPeers] = useState<PeerDevice[]>([]);
  const [relayedCount, setRelayedCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const loadMessages = useCallback(async () => {
    try {
      const all = await storageService.getAllMessages();
      setMessages(all.slice().reverse());
    } catch (e) {
      console.warn('[Mesh] loadMessages error:', e);
    }
  }, []);

  useEffect(() => {
    loadMessages();
    const unsub = nearbyService.onPeerUpdate(p => setPeers([...p]));
    setPeers(nearbyService.getPeers());
    setRelayedCount(meshService.getRelayedCount());
    meshService.onSOS(() => {
      setRelayedCount(meshService.getRelayedCount());
      loadMessages();
    });
    return unsub;
  }, [loadMessages]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadMessages();
    setRefreshing(false);
  }, [loadMessages]);

  return (
    <View style={styles.screen}>
      {/* Stats row */}
      <View style={styles.statsRow}>
        <StatChip label="Relayed" value={relayedCount} color={COLORS.peer} />
        <StatChip label="Peers" value={peers.length} color={COLORS.safe} />
        <StatChip label="Stored" value={messages.length} color={COLORS.textMuted} />
      </View>

      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, tab === 'messages' && styles.tabActive]}
          onPress={() => setTab('messages')}
        >
          <Text style={[styles.tabText, tab === 'messages' && styles.tabTextActive]}>
            Messages
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'peers' && styles.tabActive]}
          onPress={() => setTab('peers')}
        >
          <Text style={[styles.tabText, tab === 'peers' && styles.tabTextActive]}>
            Live Peers
          </Text>
        </TouchableOpacity>
      </View>

      {tab === 'messages' ? (
        <ScrollView
          style={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.peer} />}
        >
          {messages.length === 0 ? (
            <EmptyState icon="📭" text="No messages yet" hint="Messages appear when SOS/heartbeat packets are relayed" />
          ) : (
            messages.map(msg => <MessageRow key={msg.messageId} msg={msg} />)
          )}
        </ScrollView>
      ) : (
        <ScrollView style={styles.list}>
          {peers.length === 0 ? (
            <EmptyState icon="📡" text="No active peers" hint="Peers appear during BLE scan" />
          ) : (
            peers.map(peer => <PeerRow key={peer.deviceId} peer={peer} />)
          )}
        </ScrollView>
      )}
    </View>
  );
};

const StatChip: React.FC<{ label: string; value: number; color: string }> = ({ label, value, color }) => (
  <View style={styles.statChip}>
    <Text style={[styles.statValue, { color }]}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

const MessageRow: React.FC<{ msg: MeshMessage }> = ({ msg }) => {
  const typeColor = msg.emergencyType === 'MEDICAL' ? COLORS.medical
    : msg.emergencyType === 'TRAPPED' ? COLORS.trapped
    : msg.type === 'HEARTBEAT' ? COLORS.peer
    : COLORS.safe;
  const age = Date.now() - msg.timestamp;

  return (
    <View style={[styles.row, { borderLeftColor: typeColor, borderLeftWidth: 3 }]}>
      <View style={styles.rowHeader}>
        <Text style={[styles.rowType, { color: typeColor }]}>
          {msg.type === 'HEARTBEAT' ? '💓 HEARTBEAT' : `🆘 ${msg.emergencyType ?? 'SOS'}`}
        </Text>
        <Text style={styles.rowAge}>{fmtAge(age)}</Text>
      </View>
      <Text style={styles.rowSender}>{msg.senderName} · {msg.senderId.slice(-6)}</Text>
      {msg.payload.message ? <Text style={styles.rowMsg}>"{msg.payload.message}"</Text> : null}
      <Text style={styles.rowMeta}>{msg.hops.length} hops · TTL {msg.ttl}{msg.synced ? ' · ✅ synced' : ''}</Text>
    </View>
  );
};

const PeerRow: React.FC<{ peer: PeerDevice }> = ({ peer }) => {
  const age = Date.now() - peer.lastSeen;
  const rssiBar = Math.max(0, Math.min(100, ((peer.rssi + 100) / 60) * 100));

  return (
    <View style={styles.row}>
      <View style={styles.rowHeader}>
        <Text style={styles.rowSender}>{peer.name}</Text>
        <Text style={styles.rowAge}>{peer.rssi} dBm</Text>
      </View>
      <View style={styles.rssiBarBg}>
        <View style={[styles.rssiBarFill, { width: `${rssiBar}%` }]} />
      </View>
      {peer.distanceMetres != null && (
        <Text style={styles.rowMeta}>~{Math.round(peer.distanceMetres)}m · seen {fmtAge(age)}</Text>
      )}
    </View>
  );
};

const EmptyState: React.FC<{ icon: string; text: string; hint: string }> = ({ icon, text, hint }) => (
  <View style={styles.empty}>
    <Text style={styles.emptyIcon}>{icon}</Text>
    <Text style={styles.emptyText}>{text}</Text>
    <Text style={styles.emptyHint}>{hint}</Text>
  </View>
);

function fmtAge(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  statsRow: {
    flexDirection: 'row', backgroundColor: COLORS.surface,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  statChip: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  statValue: { fontSize: 20, fontWeight: '800' },
  statLabel: { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
  tabBar: { flexDirection: 'row', backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: COLORS.peer },
  tabText: { fontSize: 13, fontWeight: '600', color: COLORS.textMuted },
  tabTextActive: { color: COLORS.text },
  list: { flex: 1 },
  row: {
    backgroundColor: COLORS.surface, marginHorizontal: 16, marginTop: 10,
    borderRadius: 8, padding: 12, borderWidth: 1, borderColor: COLORS.border, gap: 3,
  },
  rowHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  rowType: { fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  rowAge: { fontSize: 11, color: COLORS.textMuted },
  rowSender: { fontSize: 13, color: COLORS.text, fontWeight: '600' },
  rowMsg: { fontSize: 12, color: COLORS.textMuted, fontStyle: 'italic' },
  rowMeta: { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
  rssiBarBg: { height: 4, backgroundColor: COLORS.border, borderRadius: 2, marginVertical: 4 },
  rssiBarFill: { height: 4, backgroundColor: COLORS.peer, borderRadius: 2 },
  empty: { alignItems: 'center', paddingTop: 80, gap: 8 },
  emptyIcon: { fontSize: 40 },
  emptyText: { fontSize: 15, color: COLORS.text, fontWeight: '600' },
  emptyHint: { fontSize: 12, color: COLORS.textMuted, textAlign: 'center', paddingHorizontal: 40 },
});
