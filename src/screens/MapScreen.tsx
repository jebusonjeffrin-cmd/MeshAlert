import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl, Alert,
} from 'react-native';
import WebView from 'react-native-webview';
import { storageService } from '../services/StorageService';
import { nearbyService } from '../services/NearbyService';
import { locationService } from '../services/LocationService';
import { MeshMessage, PeerDevice } from '../types';
import { COLORS } from '../utils/constants';
import { LEAFLET_CSS, LEAFLET_JS } from '../utils/leafletAssets';

type Tab = 'map' | 'alerts' | 'peers';

function buildMapHtml(myLat: number, myLng: number, alerts: MeshMessage[], peers: PeerDevice[]): string {
  const alertMarkers = alerts
    .filter(m => m.payload.latitude && m.payload.longitude)
    .map(m => {
      const color = m.emergencyType === 'MEDICAL' ? '#E53935'
        : m.emergencyType === 'TRAPPED' ? '#FB8C00' : '#43A047';
      const time = new Date(m.timestamp).toLocaleTimeString();
      const popup = `<b>${m.emergencyType ?? 'SOS'}</b><br>${m.senderName}<br>${m.payload.bloodGroup ? '🩸 ' + m.payload.bloodGroup + '<br>' : ''}${m.payload.message ? '"' + m.payload.message + '"<br>' : ''}${m.hops.length} hops · ${time}`;
      return `L.circleMarker([${m.payload.latitude},${m.payload.longitude}],{radius:12,color:'${color}',fillColor:'${color}',fillOpacity:0.85,weight:3}).bindPopup(\`${popup}\`).addTo(map);`;
    }).join('\n');

  const peerMarkers = peers
    .filter(p => p.latitude != null)
    .map(p => {
      const popup = `<b>${p.name}</b><br>Signal: ${p.rssi} dBm`;
      return `L.circleMarker([${p.latitude},${p.longitude}],{radius:8,color:'#00BCD4',fillColor:'#00BCD4',fillOpacity:0.8,weight:2}).bindPopup(\`${popup}\`).addTo(map);`;
    }).join('\n');

  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>${LEAFLET_CSS}</style>
<script>${LEAFLET_JS}</script>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body,#map { width:100%; height:100%; background:#0D1117; }
  .leaflet-popup-content-wrapper { background:#1C2128; color:#E6EDF3; border:1px solid #30363D; border-radius:8px; }
  .leaflet-popup-tip { background:#1C2128; }
  .leaflet-popup-content b { color:#FF3B30; }
</style>
</head>
<body>
<div id="map"></div>
<script>
  const map = L.map('map', {zoomControl:true, attributionControl:false})
    .setView([${myLat},${myLng}], 15);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom:19, opacity:0.85
  }).addTo(map);

  // My location — blue pulsing dot
  const myIcon = L.divIcon({
    html: '<div style="width:18px;height:18px;border-radius:50%;background:#1E88E5;border:3px solid #fff;box-shadow:0 0 0 4px rgba(30,136,229,0.3);animation:pulse 2s infinite"></div>',
    iconSize:[18,18], iconAnchor:[9,9], className:''
  });
  const style = document.createElement('style');
  style.textContent = '@keyframes pulse{0%,100%{box-shadow:0 0 0 4px rgba(30,136,229,0.3)}50%{box-shadow:0 0 0 10px rgba(30,136,229,0)}}';
  document.head.appendChild(style);

  L.marker([${myLat},${myLng}], {icon:myIcon})
    .bindPopup('<b>You are here</b>')
    .addTo(map);

  // SOS alert markers
  ${alertMarkers}

  // Peer markers
  ${peerMarkers}

  // Legend
  const legend = L.control({position:'bottomright'});
  legend.onAdd = () => {
    const d = L.DomUtil.create('div');
    d.style.cssText = 'background:#1C2128;padding:8px 12px;border-radius:8px;border:1px solid #30363D;font-size:11px;color:#8B949E;line-height:1.8';
    d.innerHTML = '<span style="color:#1E88E5">●</span> You &nbsp; <span style="color:#E53935">●</span> SOS &nbsp; <span style="color:#00BCD4">●</span> Peer';
    return d;
  };
  legend.addTo(map);
</script>
</body>
</html>`;
}

export const MapScreen: React.FC = () => {
  const [tab, setTab] = useState<Tab>('map');
  const [messages, setMessages] = useState<MeshMessage[]>([]);
  const [peers, setPeers] = useState<PeerDevice[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [myLocation, setMyLocation] = useState(locationService.getLastLocation());
  const webViewRef = useRef<any>(null);

  const loadData = useCallback(async () => {
    try {
      const msgs = await storageService.getSOSMessages();
      setMessages(msgs.slice().reverse());
    } catch (e) {
      console.warn('[Map] loadData error:', e);
    }
  }, []);

  const handleDelete = useCallback(async (messageId: string) => {
    Alert.alert('Delete Alert', 'Remove this SOS alert from your device?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          await storageService.deleteMessage(messageId);
          setMessages(prev => prev.filter(m => m.messageId !== messageId));
        },
      },
    ]);
  }, []);

  useEffect(() => {
    loadData();
    const unsub = nearbyService.onPeerUpdate(p => setPeers([...p]));
    setPeers(nearbyService.getPeers());
    const locUnsub = locationService.onUpdate(loc => setMyLocation(loc));
    return () => { unsub(); if (locUnsub) locUnsub(); };
  }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const lat = myLocation?.latitude ?? 12.9716;
  const lng = myLocation?.longitude ?? 77.5946;
  const mapHtml = buildMapHtml(lat, lng, messages, peers);

  return (
    <View style={styles.screen}>
      {/* Screen header */}
      <View style={styles.screenHeader}>
        <Text style={styles.screenTitle}>Map & Alerts</Text>
        <Text style={styles.screenSub}>{messages.length} alerts · {peers.length} peers</Text>
      </View>

      <View style={styles.tabBar}>
        {(['map', 'alerts', 'peers'] as Tab[]).map(t => (
          <TouchableOpacity
            key={t}
            style={[styles.tab, tab === t && styles.tabActive]}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === 'map' ? '🗺 Map' : t === 'alerts' ? `🆘 Alerts (${messages.length})` : `📡 Peers (${peers.length})`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'map' && (
        <WebView
          ref={webViewRef}
          source={{ html: mapHtml }}
          style={styles.map}
          javaScriptEnabled
          domStorageEnabled
          geolocationEnabled
          originWhitelist={['*']}
          onError={e => console.warn('[Map] WebView error:', e.nativeEvent.description)}
        />
      )}

      {tab === 'alerts' && (
        <ScrollView
          style={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.sos} />}
        >
          {messages.length === 0 ? (
            <EmptyState icon="📭" text="No SOS alerts yet" hint="Pull to refresh" />
          ) : (
            messages.map(msg => <AlertCard key={msg.messageId} msg={msg} onDelete={handleDelete} />)
          )}
        </ScrollView>
      )}

      {tab === 'peers' && (
        <ScrollView style={styles.list}>
          {peers.length === 0 ? (
            <EmptyState icon="📡" text="No nearby peers" hint="Ensure WiFi and Bluetooth are on" />
          ) : (
            peers.map(peer => <PeerCard key={peer.deviceId} peer={peer} />)
          )}
        </ScrollView>
      )}
    </View>
  );
};

const AlertCard: React.FC<{ msg: MeshMessage; onDelete: (id: string) => void }> = ({ msg, onDelete }) => {
  const age = Date.now() - msg.timestamp;
  const typeColor = msg.emergencyType === 'MEDICAL' ? COLORS.medical
    : msg.emergencyType === 'TRAPPED' ? COLORS.trapped : COLORS.safe;

  return (
    <View style={[styles.card, { borderLeftColor: typeColor, borderLeftWidth: 4 }]}>
      <View style={styles.cardHeader}>
        <Text style={[styles.cardType, { color: typeColor }]}>{msg.emergencyType ?? 'SOS'}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={styles.cardAge}>{fmtAge(age)}</Text>
          <TouchableOpacity onPress={() => onDelete(msg.messageId)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={{ fontSize: 16 }}>🗑</Text>
          </TouchableOpacity>
        </View>
      </View>
      <Text style={styles.cardSender}>From: {msg.senderName}</Text>
      {msg.payload.latitude != null && (
        <Text style={styles.cardCoords}>📍 {msg.payload.latitude.toFixed(5)}, {msg.payload.longitude.toFixed(5)}</Text>
      )}
      {msg.payload.message ? <Text style={styles.cardMessage}>"{msg.payload.message}"</Text> : null}
      {msg.payload.bloodGroup ? <Text style={styles.cardMeta}>🩸 {msg.payload.bloodGroup}</Text> : null}
      <Text style={styles.cardHops}>{msg.hops.length} hop{msg.hops.length !== 1 ? 's' : ''} · TTL {msg.ttl} {msg.synced ? '· ✅' : ''}</Text>
    </View>
  );
};

const PeerCard: React.FC<{ peer: PeerDevice }> = ({ peer }) => {
  const age = Date.now() - peer.lastSeen;
  const rssiColor = peer.rssi > -60 ? COLORS.safe : peer.rssi > -80 ? COLORS.trapped : COLORS.sos;
  const rssiPct = Math.max(0, Math.min(100, ((peer.rssi + 100) / 60) * 100));

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardSender}>{peer.name}</Text>
        <Text style={[styles.cardType, { color: rssiColor }]}>{peer.rssi} dBm</Text>
      </View>
      <View style={styles.rssiBg}>
        <View style={[styles.rssiFill, { width: `${rssiPct}%` as any, backgroundColor: rssiColor }]} />
      </View>
      {peer.distanceMetres != null && <Text style={styles.cardMeta}>~{Math.round(peer.distanceMetres)}m away</Text>}
      <Text style={styles.cardAge}>Last seen {fmtAge(age)}</Text>
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
  screenHeader: {
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
    backgroundColor: COLORS.background,
  },
  screenTitle: { fontSize: 22, fontWeight: '900', color: COLORS.text },
  screenSub: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  tabBar: { flexDirection: 'row', backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: COLORS.sos },
  tabText: { fontSize: 12, fontWeight: '600', color: COLORS.textMuted },
  tabTextActive: { color: COLORS.text },
  map: { flex: 1 },
  list: { flex: 1 },
  empty: { alignItems: 'center', paddingTop: 80, gap: 8 },
  emptyIcon: { fontSize: 48 },
  emptyText: { fontSize: 15, color: COLORS.text, fontWeight: '600' },
  emptyHint: { fontSize: 12, color: COLORS.textMuted },
  card: {
    backgroundColor: COLORS.surface, marginHorizontal: 16, marginTop: 12,
    borderRadius: 12, padding: 14, borderWidth: 1, borderColor: COLORS.border, gap: 4,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  cardType: { fontSize: 13, fontWeight: '800', letterSpacing: 1 },
  cardAge: { fontSize: 12, color: COLORS.textMuted },
  cardSender: { fontSize: 13, color: COLORS.text, fontWeight: '600' },
  cardCoords: { fontSize: 12, color: COLORS.textMuted, fontFamily: 'monospace' },
  cardMessage: { fontSize: 13, color: COLORS.text, fontStyle: 'italic', marginTop: 2 },
  cardMeta: { fontSize: 12, color: COLORS.textMuted },
  cardHops: { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
  rssiBg: { height: 4, backgroundColor: COLORS.border, borderRadius: 2, marginVertical: 4 },
  rssiFill: { height: 4, borderRadius: 2 },
});
