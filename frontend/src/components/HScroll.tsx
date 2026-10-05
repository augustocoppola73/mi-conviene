import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent, Platform, Pressable, ScrollView, StyleProp, View, ViewStyle } from 'react-native';

import { makeStyles, useTheme } from '../theme';
import { Icon } from './ui';

/**
 * Striscia orizzontale scorrevole. Sul telefono si scorre col dito; sul web
 * (mouse) si scorre anche con la rotella e con le frecce ‹ › ai lati.
 */
export function HScroll({ children, contentContainerStyle, style }: {
  children: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const ref = useRef<ScrollView>(null);
  const [x, setX] = useState(0);
  const [contentW, setContentW] = useState(0);
  const [viewW, setViewW] = useState(0);
  const isWeb = Platform.OS === 'web';

  // rotella verticale -> scorrimento orizzontale (solo web)
  useEffect(() => {
    if (!isWeb) return;
    const node = (ref.current as unknown as { getScrollableNode?: () => HTMLElement })?.getScrollableNode?.();
    if (!node) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return; // touchpad orizzontale: già gestito dal browser
      const max = node.scrollWidth - node.clientWidth;
      if (max <= 0) return;
      const next = Math.min(max, Math.max(0, node.scrollLeft + e.deltaY));
      if (next !== node.scrollLeft) {
        e.preventDefault();
        node.scrollLeft = next;
      }
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [isWeb]);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => setX(e.nativeEvent.contentOffset.x), []);
  const page = (dir: 1 | -1) => ref.current?.scrollTo({ x: Math.max(0, x + dir * viewW * 0.8), animated: true });

  const canLeft = x > 4;
  const canRight = x + viewW < contentW - 4;

  return (
    <View style={style} onLayout={(e) => setViewW(e.nativeEvent.layout.width)}>
      <ScrollView
        ref={ref}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={contentContainerStyle}
        onScroll={onScroll}
        scrollEventThrottle={32}
        onContentSizeChange={(w) => setContentW(w)}>
        {children}
      </ScrollView>
      {isWeb && canLeft && (
        <Pressable accessibilityLabel="Scorri a sinistra" onPress={() => page(-1)} style={[s.arrow, s.left]}>
          <Icon name="chevron-back" size={20} color={colors.text} />
        </Pressable>
      )}
      {isWeb && canRight && (
        <Pressable accessibilityLabel="Scorri a destra" onPress={() => page(1)} style={[s.arrow, s.right]}>
          <Icon name="chevron-forward" size={20} color={colors.text} />
        </Pressable>
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  arrow: {
    position: 'absolute', top: '50%', marginTop: -18, width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface,
    borderWidth: 1, borderColor: c.border,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 3,
  },
  left: { left: 4 },
  right: { right: 4 },
}));
