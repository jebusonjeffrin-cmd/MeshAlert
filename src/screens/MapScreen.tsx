import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl,
} from 'react-native';
import { storageService } from '../services/StorageService';
import { nearbyService } from '../services/NearbyService';
import { MeshMessage, PeerDevice } from '../types';
import { COLORS } from '../utils/constants';

type Tab = 'alerts' | 'peers';

export const MapScreen: React.FC = () => {
  const [tab, setTab] = useState<Tab>('alerts');
  const [messages, setMessages] = useState<MeshMessage[]>([]);
  const [peers, setPeers] = useState<PeerDevice[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const msgs = await storageService.getSOSMessages();
      setMessages(msgs.slice().reverse()); // newest first
    } catch (e) {
      console.warn('[Map] loadData error:', e);
    }
  }, []);

  useEffect(() => {
    loadData();
    const unsub = nearbyService.onPeerUpdate(p => setPeers([...p]));
    setPeers(nearbyService.getPeers());
    return unsub;
  }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  return (
    <View style={styles.screen}>
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, tab === 'alerts' && styles.tabActive]}
          onPress={() => setTab('alerts')}
        >
          <Text style={[styles.tabText, tab === 'alerts' && styles.tabTextActive]}>
            🆘 Alerts ({messages.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'peers' && styles.tabActive]}
          onPress={() => setTab('peers')}
        >
          <Text style={[styles.tabText, tab === 'peers' && styles.tabTextActive]}>
            📡 Peers ({peers.length})
          </Text>
        </TouchableOpacity>
      </View>

      {tab === 'alerts' ? (
        <ScrollView
          style={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.sos} />}
        >
          {messages.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>📭</Text>
              <Text style={styles.emptyText}>No SOS alerts received yet</Text>
              <Text style={styles.emptyHint}>Pull to refresh</Text>
            </View>
          ) : (
            messages.map(msg => <AlertCard key={msg.messageId} msg={msg} />)
          )}
        </ScrollView>
      ) : (
        <ScrollView style={styles.list}>
          {peers.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>📡</Text>
              <Text style={styles.emptyText}>No nearby peers detected</Text>
              <Text style={styles.emptyHint}>Ensure Bluetooth is on</Text>
            </View>
          ) : (
            peers.map(peer => <PeerCard key={peer.deviceId} peer={peer} />)
          )}
        </ScrollView>
      )}
    </View>
  );
};

const AlertCard: React.FC<{ msg: MeshMessage }> = ({ msg }) => {
  const age = Date.now() - msg.timestamp;
  const typeColor = msg.emergencyType === 'MEDICAL' ? COLORS.medical
    : msg.emergencyType === 'TRAPPED' ? COLORS.trapped
    : COLORS.safe;

  return (
    <View style={[styles.card, { borderLeftColor: typeColor, borderLeftWidth: 4 }]}>
      <View style={styles.cardHeader}>
        <Text style={[styles.cardType, { color: typeColor }]}>
          {msg.emergencyType ?? 'SOS'}
        </Text>
        <Text style={styles.cardAge}>{fmtAge(age)}</Text>
      </View>
      <Text style={styles.cardSender}>From: {msg.senderName} ({msg.senderId.slice(-6)})</Text>
      {msg.payload.latitude != null && (
        <Text style={styles.cardCoords}>
          📍 {msg.payload.latitude.toFixed(5)}, {msg.payload.longitude.toFixed(5)}
        </Text>
      )}
      {msg.payload.message ? (
        <Text style={styles.cardMessage}>"{msg.payload.message}"</Text>
      ) : null}
      {msg.payload.bloodGroup ? (
        <Text style={styles.cardMeta}>🩸 {msg.payload.bloodGroup}</Text>
      ) : null}
      <Text style={styles.cardHops}>{msg.hops.length} hop{msg.hops.length !== 1 ? 's' : ''} • TTL {msg.ttl}</Text>
    </View>
  );
};

const PeerCard: React.FC<{ peer: PeerDevice }> = ({ peer }) => {
  const age = Date.now() - peer.lastSeen;
  const rssiColor = peer.rssi > -60 ? COLORS.safe : peer.rssi > -80 ? COLORS.trapped : COLORS.sos;

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardSender}>{peer.name}</Text>
        <Text style={[styles.cardType, { color: rssiColor }]}>{peer.rssi} dBm</Text>
      </View>
      <Text style={styles.cardCoords}>ID: {peer.deviceId.slice(-8)}</Text>
      {peer.latitude != null && (
        <Text style={styles.cardCoords}>
          📍 {peer.latitude.toFixed(5)}, {peer.longitude!.toFixed(5)}
        </Text>
      )}
      {peer.distanceMetres != null && (
        <Text style={styles.cardMeta}>~{Math.round(peer.distanceMetres)}m away</Text>
      )}
      <Text style={styles.cardAge}>Last seen: {fmtAge(age)} ago</Text>
    </View>
  );
};

function fmtAge(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  tabBar: { flexDirection: 'row', backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  tab: { flex: 1, paddingVertical: 14, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: COLORS.sos },
  tabText: { fontSize: 13, fontWeight: '600', color: COLORS.textMuted },
  tabTextActive: { color: COLORS.text },
  list: { flex: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 8 },
  emptyIcon: { fontSize: 48 },
  emptyText: { fontSize: 15, color: COLORS.text, fontWeight: '600' },
  emptyHint: { fontSize: 12, color: COLORS.textMuted },
  card: {
    backgroundColor: COLORS.surface, marginHorizontal: 16, marginTop: 12,
    borderRadius: 10, padding: 14, borderWidth: 1, borderColor: COLORS.border, gap: 4,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  cardType: { fontSize: 13, fontWeight: '800', letterSpacing: 1 },
  cardAge: { fontSize: 12, color: COLORS.textMuted },
  cardSender: { fontSize: 13, color: COLORS.text, fontWeight: '600' },
  cardCoords: { fontSize: 12, color: COLORS.textMuted, fontFamily: 'monospace' },
  cardMessage: { fontSize: 13, color: COLORS.text, fontStyle: 'italic', marginTop: 4 },
  cardMeta: { fontSize: 12, color: COLORS.textMuted },
  cardHops: { fontSize: 11, color: COLORS.textMuted, marginTop: 4 },
});
