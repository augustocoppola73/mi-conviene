/** Cursore semplice (trascina o tocca la barra), fatto in JavaScript: niente moduli nativi. */
import { useMemo, useRef, useState } from 'react';
import { PanResponder, View } from 'react-native';

import { useTheme } from '../theme';

export function Slider({ value, min, max, step, onChange }: {
  value: number; min: number; max: number; step: number; onChange: (v: number) => void;
}) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const state = useRef({ width: 0, startX: 0, onChange, min, max, step });
  state.current = { ...state.current, width, onChange, min, max, step };

  const snap = (x: number) => {
    const { width: w, min: a, max: b, step: s } = state.current;
    if (w <= 0) return a;
    const raw = a + (Math.min(Math.max(x, 0), w) / w) * (b - a);
    return Math.round(Math.round(raw / s) * s * 100) / 100;
  };
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => {
      state.current.startX = e.nativeEvent.locationX;
      state.current.onChange(snap(e.nativeEvent.locationX));
    },
    onPanResponderMove: (_e, g) => state.current.onChange(snap(state.current.startX + g.dx)),
  }), []);

  const pct = (value - min) / (max - min);
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} {...pan.panHandlers}
      style={{ height: 36, justifyContent: 'center' }} accessibilityRole="adjustable">
      <View pointerEvents="none" style={{ height: 6, borderRadius: 3, backgroundColor: colors.border }} />
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, width: pct * width, height: 6, borderRadius: 3, backgroundColor: colors.primary }} />
      <View pointerEvents="none" style={{ position: 'absolute', left: pct * width - 13, width: 26, height: 26, borderRadius: 13,
        backgroundColor: colors.surface, borderWidth: 3, borderColor: colors.primary }} />
    </View>
  );
}
