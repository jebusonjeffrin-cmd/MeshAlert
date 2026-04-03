import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS } from '../utils/constants';

interface Props { count: number }

export const NearbyCounter: React.FC<Props> = ({ count }) => (
  <View style={[styles.badge, count > 0 && styles.badgeActive]}>
    <Text style={styles.count}>{count}</Text>
    <Text style={styles.label}>device{count !== 1 ? 's' : ''} nearby</Text>
  </View>
);

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: COLORS.surface,
    borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8,
    borderWidth: 1, borderColor: COLORS.border,
  },
  badgeActive: { borderColor: COLORS.peer, backgroundColor: 'rgba(30,136,229,0.12)' },
  count: { fontSize: 22, fontWeight: '800', color: COLORS.peer },
  label: { fontSize: 13, color: COLORS.textMuted },
});
