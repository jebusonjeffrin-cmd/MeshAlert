import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { EmergencyType } from '../types';
import { COLORS } from '../utils/constants';

const TYPES: { type: EmergencyType; label: string; color: string; icon: string }[] = [
  { type: 'MEDICAL', label: 'Medical', color: COLORS.medical, icon: '🏥' },
  { type: 'TRAPPED', label: 'Trapped', color: COLORS.trapped, icon: '🆘' },
  { type: 'SAFE',    label: 'Safe',    color: COLORS.safe,    icon: '✅' },
];

interface Props { selected: EmergencyType | null; onSelect: (t: EmergencyType) => void }

const TypeChip: React.FC<{
  type: EmergencyType; label: string; color: string; icon: string;
  selected: boolean; onSelect: (t: EmergencyType) => void;
}> = ({ type, label, color, icon, selected, onSelect }) => {
  const scale = React.useRef(new Animated.Value(1)).current;

  const handlePress = () => {
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.93, duration: 80, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1,    duration: 80, useNativeDriver: true }),
    ]).start();
    onSelect(type);
  };

  return (
    <Animated.View style={[styles.chipWrap, { transform: [{ scale }] }]}>
      <TouchableOpacity
        style={[
          styles.chip,
          selected && { backgroundColor: color, borderColor: color, elevation: 4,
            shadowColor: color, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.4, shadowRadius: 6 },
        ]}
        onPress={handlePress}
        activeOpacity={0.8}
      >
        <Text style={styles.icon}>{icon}</Text>
        <Text style={[styles.label, selected && styles.labelActive]}>{label}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
};

export const EmergencyTypeSelector: React.FC<Props> = ({ selected, onSelect }) => (
  <View style={styles.row}>
    {TYPES.map(t => (
      <TypeChip key={t.type} {...t} selected={selected === t.type} onSelect={onSelect} />
    ))}
  </View>
);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  chipWrap: { flex: 1 },
  chip: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: COLORS.surface, borderRadius: 10,
    paddingVertical: 11, borderWidth: 1, borderColor: COLORS.border,
  },
  icon: { fontSize: 16 },
  label: { fontSize: 13, fontWeight: '700', color: COLORS.textMuted },
  labelActive: { color: '#fff' },
});
