import React, { useEffect, useRef } from 'react';
import { TouchableOpacity, Text, StyleSheet, Animated } from 'react-native';
import { COLORS } from '../utils/constants';

interface Props {
  onPress: () => void;
  onLongPress: () => void;
  isActive: boolean;
  disabled: boolean;
}

export const SOSButton: React.FC<Props> = ({ onPress, onLongPress, isActive, disabled }) => {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (isActive) {
      const anim = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.08, duration: 600, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
        ]),
      );
      anim.start();
      return () => anim.stop();
    } else {
      pulse.setValue(1);
    }
  }, [isActive, pulse]);

  return (
    <Animated.View style={[styles.wrapper, { transform: [{ scale: pulse }] }]}>
      <TouchableOpacity
        style={[styles.btn, isActive && styles.btnActive, disabled && styles.btnDisabled]}
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={600}
        disabled={disabled}
        activeOpacity={0.8}
      >
        <Text style={styles.icon}>🆘</Text>
        <Text style={styles.label}>SOS</Text>
        <Text style={styles.sub}>{disabled ? 'Sending...' : isActive ? 'ACTIVE' : 'Tap or shake'}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  wrapper: { alignItems: 'center' },
  btn: {
    width: 180, height: 180, borderRadius: 90,
    backgroundColor: COLORS.sos,
    alignItems: 'center', justifyContent: 'center',
    elevation: 8,
    shadowColor: COLORS.sos, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.5, shadowRadius: 12,
  },
  btnActive: { backgroundColor: '#C62828' },
  btnDisabled: { opacity: 0.6 },
  icon: { fontSize: 36, marginBottom: 4 },
  label: { fontSize: 28, fontWeight: '900', color: '#fff', letterSpacing: 4 },
  sub: { fontSize: 11, color: 'rgba(255,255,255,0.8)', marginTop: 4 },
});
