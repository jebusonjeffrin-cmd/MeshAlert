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

  const sosMsgs = messages.filter(m => m.type === 'SOS');
  const heartbeats = messages.filter(m => m.type === 'HEARTBEAT');

  return (
    <View style={styles.screen}>
      {/* Stats row */}
      <View style={styles.statsRow}>
        <StatChip label="Relayed" value={relayedCount} color={COLORS.peer} icon="↗" />
        <View style={styles.statDivider} />
        <StatChip label="Peers" value={peers.length} color={COLORS.safe} icon="📡" />
        <View style={styles.statDivider} />
        <StatChip label="SOS" value={sosMsgs.length} color={COLORS.sos} icon="🆘" />
        <View style={styles.statDivider} />
        <StatChip label="Heartbeats" value={heartbeats.length} color={COLORS.textMuted} icon="💓" />
      </View>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, tab === 'messages' && styles.tabActive]}
          onPress={() => setTab('messages')}
        >
          <Text style={[styles.tabText, tab === 'messages' && styles.tabTextActive]}>
            Messages {messages.length > 0 ? `(${messages.length})` : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'peers' && styles.tabActive]}
          onPress={() => setTab('peers')}
        >
          <Text style={[styles.tabText, tab === 'peers' && styles.tabTextActive]}>
            Live Peers {peers.length > 0 ? `(${peers.length})` : ''}
          </Text>
        </TouchableOpacity>
      </View>

      {tab === 'messages' ? (
        <ScrollView
          style={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.peer} />}
        >
          {messages.length === 0 ? (
            <EmptyState icon="📭" text="No messages yet" hint="Messages appear when SOS or heartbeat packets are relayed through this device" />
          ) : (
            messages.map(msg => <MessageRow key={msg.messageId} msg={msg} />)
          )}
        </ScrollView>
      ) : (
        <ScrollView style={styles.list}>
          {peers.length === 0 ? (
            <EmptyState icon="📡" text="No active peers" hint="Peers appear when other MeshAlert devices are in BLE range" />
          ) : (
            peers.map(peer => <PeerRow key={peer.deviceId} peer={peer} />)
          )}
        </ScrollView>
      )}
    </View>
  );
};

const StatChip: React.FC<{ label: string; value: number; color: string; icon: string }> = ({ label, value, color, icon }) => (
  <View style={styles.statChip}>
    <Text style={[styles.statValue, { color }]}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

const MessageRow: React.FC<{ msg: MeshMessage }> = ({ msg }) => {
  const typeColor = msg.emergencyType === 'MEDICAL' ? COLORS.medical
    : msg.emergencyType === 'TRAPPED' ? COLORS.trapped
    : msg.type === 'HEARTBEAT' ? COLORS.peer
    : msg.type === 'ACK' ? COLORS.safe
    : COLORS.sos;
  const age = Date.now() - msg.timestamp;
  const typeLabel = msg.type === 'HEARTBEAT' ? '💓 HEARTBEAT'
    : msg.type === 'ACK' ? '✅ ACK'
    : `🆘 ${msg.emergencyType ?? 'SOS'}`;

  return (
    <View style={[styles.row, { borderLeftColor: typeColor }]}>
      <View style={styles.rowHeader}>
        <View style={[styles.rowTypeBadge, { backgroundColor: typeColor + '18', borderColor: typeColor + '40' }]}>
          <Text style={[styles.rowType, { color: typeColor }]}>{typeLabel}</Text>
        </View>
        <Text style={styles.rowAge}>{fmtAge(age)}</Text>
      </View>
      <Text style={styles.rowSender}>{msg.senderName}
        <Text style={styles.rowSenderId}> ·{msg.senderId.slice(-6)}</Text>
      </Text>
      {msg.payload.message ? (
        <Text style={styles.rowMsg}>"{msg.payload.message}"</Text>
      ) : null}
      {msg.payload.audioBase64 ? (
        <Text style={styles.rowAudio}>🎙 Voice note attached</Text>
      ) : null}
      <View style={styles.rowFooter}>
        <Text style={styles.rowMeta}>{msg.hops.length} hop{msg.hops.length !== 1 ? 's' : ''}</Text>
        <Text style={styles.rowMeta}>TTL {msg.ttl}</Text>
        {msg.synced && <Text style={[styles.rowMeta, { color: COLORS.safe }]}>✅ synced</Text>}
      </View>
    </View>
  );
};

const PeerRow: React.FC<{ peer: PeerDevice }> = ({ peer }) => {
  const age = Date.now() - peer.lastSeen;
  const rssiPct = Math.max(0, Math.min(100, ((peer.rssi + 100) / 60) * 100));
  const signalColor = peer.rssi > -60 ? COLORS.safe : peer.rssi > -80 ? COLORS.trapped : COLORS.sos;

  return (
    <View style={styles.row}>
      <View style={styles.rowHeader}>
        <View style={styles.peerNameRow}>
          <View style={[styles.peerOnline, { backgroundColor: signalColor }]} />
          <Text style={styles.rowSender}>{peer.name}</Text>
        </View>
        <Text style={[styles.rowType, { color: signalColor }]}>{peer.rssi} dBm</Text>
      </View>
      <View style={styles.rssiBarBg}>
        <View style={[styles.rssiBarFill, { width: `${rssiPct}%`, backgroundColor: signalColor }]} />
      </View>
      <View style={styles.rowFooter}>
        {peer.distanceMetres != null && (
          <Text style={styles.rowMeta}>~{Math.round(peer.distanceMetres)}m away</Text>
        )}
        <Text style={styles.rowMeta}>seen {fmtAge(age)}</Text>
      </View>
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
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },

  statsRow: {
    flexDirection: 'row', backgroundColor: COLORS.surface,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
    paddingVertical: 4,
  },
  statChip: { flex: 1, alignItems: 'center', paddingVertical: 10 },
  statValue: { fontSize: 22, fontWeight: '900' },
  statLabel: { fontSize: 10, color: COLORS.textMuted, marginTop: 2, fontWeight: '700', letterSpacing: 0.3 },
  statDivider: { width: 1, backgroundColor: COLORS.border, marginVertical: 8 },

  tabBar: {
    flexDirection: 'row', backgroundColor: COLORS.surface,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: COLORS.peer },
  tabText: { fontSize: 13, fontWeight: '600', color: COLORS.textMuted },
  tabTextActive: { color: COLORS.text },

  list: { flex: 1 },

  row: {
    backgroundColor: COLORS.surface, marginHorizontal: 14, marginTop: 10,
    borderRadius: 12, padding: 14, borderWidth: 1, borderColor: COLORS.border,
    borderLeftWidth: 3, gap: 6,
  },
  rowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowTypeBadge: {
    borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1,
  },
  rowType: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  rowAge: { fontSize: 11, color: COLORS.textMuted },
  rowSender: { fontSize: 14, color: COLORS.text, fontWeight: '700' },
  rowSenderId: { fontSize: 12, color: COLORS.textMuted, fontWeight: '400', fontFamily: 'monospace' },
  rowMsg: { fontSize: 12, color: COLORS.textMuted, fontStyle: 'italic', lineHeight: 18 },
  rowAudio: { fontSize: 11, color: COLORS.peer, fontWeight: '600' },
  rowFooter: { flexDirection: 'row', gap: 10 },
  rowMeta: { fontSize: 11, color: COLORS.textMuted },

  peerNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  peerOnline: { width: 8, height: 8, borderRadius: 4 },
  rssiBarBg: { height: 4, backgroundColor: COLORS.border, borderRadius: 2 },
  rssiBarFill: { height: 4, borderRadius: 2 },

  empty: { alignItems: 'center', paddingTop: 80, gap: 12, paddingHorizontal: 40 },
  emptyIcon: { fontSize: 52 },
  emptyText: { fontSize: 16, color: COLORS.text, fontWeight: '800', textAlign: 'center' },
  emptyHint: { fontSize: 13, color: COLORS.textMuted, textAlign: 'center', lineHeight: 20 },
});
