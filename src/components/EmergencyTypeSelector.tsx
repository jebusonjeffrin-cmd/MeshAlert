import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { EmergencyType } from '../types';
import { COLORS } from '../utils/constants';

const TYPES: { type: EmergencyType; label: string; color: string; icon: string }[] = [
  { type: 'MEDICAL', label: 'Medical', color: COLORS.medical, icon: '🏥' },
  { type: 'TRAPPED', label: 'Trapped', color: COLORS.trapped, icon: '🆘' },
  { type: 'SAFE', label: 'Safe', color: COLORS.safe, icon: '✅' },
];

interface Props { selected: EmergencyType | null; onSelect: (t: EmergencyType) => void }

export const EmergencyTypeSelector: React.FC<Props> = ({ selected, onSelect }) => (
  <View style={styles.row}>
    {TYPES.map(({ type, label, color, icon }) => (
      <TouchableOpacity
        key={type}
        style={[styles.chip, selected === type && { backgroundColor: color, borderColor: color }]}
        onPress={() => onSelect(type)}
      >
        <Text style={styles.icon}>{icon}</Text>
        <Text style={[styles.label, selected === type && styles.labelActive]}>{label}</Text>
      </TouchableOpacity>
    ))}
  </View>
);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  chip: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: COLORS.surface, borderRadius: 10,
    paddingVertical: 10, borderWidth: 1, borderColor: COLORS.border,
  },
  icon: { fontSize: 16 },
  label: { fontSize: 13, fontWeight: '700', color: COLORS.textMuted },
  labelActive: { color: '#fff' },
});
