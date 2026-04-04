import React, { useEffect, useRef, useState } from 'react';
import { TouchableOpacity, Text, StyleSheet, Animated, View } from 'react-native';
import { COLORS } from '../utils/constants';

interface Props {
  onPress: () => void;
  onLongPress: () => void;
  isActive: boolean;
  disabled: boolean;
}

export const SOSButton: React.FC<Props> = ({ onPress, onLongPress, isActive, disabled }) => {
  const pulse1 = useRef(new Animated.Value(1)).current;
  const pulse2 = useRef(new Animated.Value(1)).current;
  const pulse3 = useRef(new Animated.Value(1)).current;
  const ring1Opacity = useRef(new Animated.Value(0)).current;
  const ring2Opacity = useRef(new Animated.Value(0)).current;
  const ring3Opacity = useRef(new Animated.Value(0)).current;
  const pressScale = useRef(new Animated.Value(1)).current;

  const [countdown, setCountdown] = useState<number | null>(null);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingPress = useRef(false);

  // Triple-ring pulse when active
  useEffect(() => {
    if (isActive) {
      const makeRing = (scale: Animated.Value, opacity: Animated.Value, delay: number) =>
        Animated.loop(
          Animated.sequence([
            Animated.delay(delay),
            Animated.parallel([
              Animated.timing(scale, { toValue: 1.8, duration: 1200, useNativeDriver: true }),
              Animated.timing(opacity, { toValue: 0, duration: 1200, useNativeDriver: true }),
            ]),
            Animated.parallel([
              Animated.timing(scale, { toValue: 1, duration: 0, useNativeDriver: true }),
              Animated.timing(opacity, { toValue: 0.4, duration: 0, useNativeDriver: true }),
            ]),
          ]),
        );
      const a1 = makeRing(pulse1, ring1Opacity, 0);
      const a2 = makeRing(pulse2, ring2Opacity, 400);
      const a3 = makeRing(pulse3, ring3Opacity, 800);
      ring1Opacity.setValue(0.4);
      ring2Opacity.setValue(0.4);
      ring3Opacity.setValue(0.4);
      a1.start(); a2.start(); a3.start();
      return () => { a1.stop(); a2.stop(); a3.stop(); };
    } else {
      [pulse1, pulse2, pulse3].forEach(p => p.setValue(1));
      [ring1Opacity, ring2Opacity, ring3Opacity].forEach(o => o.setValue(0));
    }
  }, [isActive]);

  const handlePress = () => {
    if (disabled || countdown !== null) return;
    // Start 3-second countdown
    setCountdown(3);
    pendingPress.current = true;
    Animated.sequence([
      Animated.timing(pressScale, { toValue: 0.95, duration: 80, useNativeDriver: true }),
      Animated.timing(pressScale, { toValue: 1, duration: 80, useNativeDriver: true }),
    ]).start();

    let c = 3;
    countdownTimer.current = setInterval(() => {
      c -= 1;
      if (c <= 0) {
        clearInterval(countdownTimer.current!);
        countdownTimer.current = null;
        setCountdown(null);
        if (pendingPress.current) { pendingPress.current = false; onPress(); }
      } else {
        setCountdown(c);
      }
    }, 1000);
  };

  const handleCancel = () => {
    if (countdown === null) return;
    if (countdownTimer.current) { clearInterval(countdownTimer.current); countdownTimer.current = null; }
    pendingPress.current = false;
    setCountdown(null);
  };

  const handleLongPress = () => {
    // Cancel any running countdown and send immediately
    handleCancel();
    onLongPress();
  };

  useEffect(() => {
    return () => { if (countdownTimer.current) clearInterval(countdownTimer.current); };
  }, []);

  const subLabel = disabled ? 'Sending...'
    : countdown !== null ? `Sending in ${countdown}s — tap to cancel`
    : isActive ? 'ACTIVE — mesh alerted'
    : 'Tap · or shake 3×';

  return (
    <Animated.View style={[styles.wrapper, { transform: [{ scale: pressScale }] }]}>
      {/* Expanding rings */}
      <Animated.View style={[styles.ring, { transform: [{ scale: pulse1 }], opacity: ring1Opacity }]} />
      <Animated.View style={[styles.ring, { transform: [{ scale: pulse2 }], opacity: ring2Opacity }]} />
      <Animated.View style={[styles.ring, { transform: [{ scale: pulse3 }], opacity: ring3Opacity }]} />

      <TouchableOpacity
        style={[
          styles.btn,
          isActive && styles.btnActive,
          countdown !== null && styles.btnCountdown,
          disabled && styles.btnDisabled,
        ]}
        onPress={countdown !== null ? handleCancel : handlePress}
        onLongPress={handleLongPress}
        delayLongPress={600}
        disabled={disabled}
        activeOpacity={0.85}
      >
        <Text style={styles.icon}>{countdown !== null ? `${countdown}` : '🆘'}</Text>
        <Text style={styles.sub} numberOfLines={2}>{subLabel}</Text>
        {countdown !== null && (
          <Text style={styles.cancelHint}>tap to cancel</Text>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
};

const RING_SIZE = 180;

const styles = StyleSheet.create({
  wrapper: { alignItems: 'center', justifyContent: 'center', width: RING_SIZE, height: RING_SIZE },
  ring: {
    position: 'absolute',
    width: RING_SIZE, height: RING_SIZE, borderRadius: RING_SIZE / 2,
    backgroundColor: COLORS.sos,
  },
  btn: {
    width: RING_SIZE, height: RING_SIZE, borderRadius: RING_SIZE / 2,
    backgroundColor: COLORS.sos,
    alignItems: 'center', justifyContent: 'center',
    elevation: 10,
    shadowColor: COLORS.sos, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.6, shadowRadius: 16,
  },
  btnActive: { backgroundColor: '#C62828' },
  btnCountdown: { backgroundColor: '#E65100' },
  btnDisabled: { opacity: 0.5 },
  icon: { fontSize: 42, marginBottom: 6 },
  sub: { fontSize: 11, color: 'rgba(255,255,255,0.85)', textAlign: 'center', paddingHorizontal: 16, lineHeight: 15 },
  cancelHint: { fontSize: 10, color: 'rgba(255,255,255,0.6)', marginTop: 4 },
});
