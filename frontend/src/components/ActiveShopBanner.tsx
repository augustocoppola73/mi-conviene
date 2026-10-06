import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { api, Shop } from '../api';
import { useStore } from '../store';
import { makeStyles, radius, spacing, useTheme } from '../theme';
import { Icon } from './ui';

/** In home: la spesa in corso (tua o di un familiare), da aprire in negozio. */
export function ActiveShopBanner() {
  const s = useStyles();
  const { colors } = useTheme();
  const { userId } = useStore();
  const [shop, setShop] = useState<Shop | null>(null);

  useFocusEffect(useCallback(() => {
    if (!userId) return;
    let alive = true;
    const load = () => api.shopActive(userId).then((r) => alive && setShop(r.shop)).catch(() => {});
    load();
    const t = setInterval(load, 15000);
    return () => { alive = false; clearInterval(t); };
  }, [userId]));

  if (!shop) return null;
  const { checked, total } = shop.progress;
  return (
    <Pressable onPress={() => router.push('/spesa')} style={s.card} accessibilityRole="button">
      <Text style={s.icon}>🛒</Text>
      <View style={{ flex: 1 }}>
        <Text style={s.title}>Spesa in corso · {shop.store_name}{shop.mine ? '' : ` (${shop.display_name ?? 'famiglia'})`}</Text>
        <Text style={s.meta} numberOfLines={1}>
          {shop.taken_by
            ? (shop.taken_by.user_id === userId ? 'La stai facendo tu · ' : `La sta facendo ${shop.taken_by.name ?? 'un familiare'} · `)
            : ''}
          {checked} di {total} nel carrello{shop.branch ? ` · ${shop.branch}` : ''}
        </Text>
      </View>
      <View style={s.open}>
        <Text style={s.openText}>Apri</Text>
        <Icon name="chevron-forward" size={16} color={colors.primaryText} />
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles((c) => ({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, marginTop: spacing.md,
    borderRadius: radius.lg, backgroundColor: c.primarySoft, borderWidth: 1, borderColor: c.primary,
  },
  icon: { fontSize: 26 },
  title: { color: c.text, fontSize: 15, fontWeight: '700' },
  meta: { color: c.textSecondary, fontSize: 12, marginTop: 2 },
  open: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: c.primary, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 },
  openText: { color: c.primaryText, fontWeight: '700', fontSize: 13 },
}));
