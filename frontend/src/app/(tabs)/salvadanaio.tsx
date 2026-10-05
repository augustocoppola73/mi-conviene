import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api, SavingsSummary } from '@/api';
import { Card, EmptyState, ErrorState, Icon, SectionTitle, StoreDot } from '@/components/ui';
import { euro, formatDate } from '@/format';
import { useStore } from '@/store';
import { makeStyles, spacing, useTheme } from '@/theme';

export default function SalvadanaioScreen() {
  const s = useStyles();
  const { colors } = useTheme();
  const { userId } = useStore();
  const [data, setData] = useState<SavingsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      setError(null);
      setData(await api.savings(userId));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [userId]);

  // ricarica ogni volta che si apre il tab
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const remove = async (id: string) => {
    await api.deleteSaving(id).catch(() => {});
    load();
  };

  const now = new Date();
  const thisMonth = data?.entries
    .filter((e) => { const d = new Date(e.created_at); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); })
    .reduce((sum, e) => sum + e.amount, 0) ?? 0;

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
        <Text style={s.kicker}>Il tuo salvadanaio 🐷</Text>
        <Text style={s.title}>Quanto hai risparmiato</Text>

        {error && !data ? (
          <ErrorState message={error} onRetry={load} />
        ) : !data ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xxl }} />
        ) : (
          <>
            <Card style={s.hero}>
              <Text style={s.heroLabel}>Questo mese</Text>
              <Text style={s.heroValue}>{euro(thisMonth)}</Text>
              <View style={s.totals}>
                <View style={{ flex: 1 }}>
                  <Text style={s.heroLabel}>Totale stimato</Text>
                  <Text style={s.totalValue}>{euro(data.total_estimated)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.heroLabel}>Verificato</Text>
                  <Text style={s.totalValue}>{euro(data.total_verified)}</Text>
                </View>
              </View>
            </Card>

            <SectionTitle>Storico</SectionTitle>
            {data.entries.length === 0 ? (
              <EmptyState icon="wallet-outline" text="Ancora niente. Quando confermi una spesa dai Risultati, il risparmio finisce qui." />
            ) : (
              <View style={{ gap: spacing.sm }}>
                {data.entries.map((e) => (
                  <Card key={e.id} style={s.row}>
                    <StoreDot storeId={e.store_id} size={14} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.rowTitle}>{e.store_name}</Text>
                      <Text style={s.rowMeta}>
                        {formatDate(e.created_at)}{e.note ? ` · ${e.note}` : ''}{e.verified ? ' · verificato' : ' · stimato'}
                      </Text>
                    </View>
                    <Text style={s.amount}>+{euro(e.amount)}</Text>
                    <Pressable accessibilityLabel="Elimina" hitSlop={8} onPress={() => remove(e.id)}>
                      <Icon name="trash-outline" size={18} color={colors.danger} />
                    </Pressable>
                  </Card>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((c) => ({
  screen: { flex: 1, backgroundColor: c.background },
  content: { width: '100%', maxWidth: 640, alignSelf: 'center', padding: spacing.lg, paddingBottom: spacing.xxl },
  kicker: { color: c.textSecondary, fontSize: 14 },
  title: { color: c.text, fontSize: 28, fontWeight: '800', marginTop: 2 },
  hero: { marginTop: spacing.lg, backgroundColor: c.primary, borderColor: c.primary },
  heroLabel: { color: c.primaryText, opacity: 0.8, fontSize: 13 },
  heroValue: { color: c.primaryText, fontSize: 40, fontWeight: '800' },
  totals: { flexDirection: 'row', marginTop: spacing.md, gap: spacing.md },
  totalValue: { color: c.primaryText, fontSize: 18, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  rowTitle: { color: c.text, fontSize: 15, fontWeight: '600' },
  rowMeta: { color: c.textSecondary, fontSize: 12 },
  amount: { color: c.success, fontSize: 16, fontWeight: '700' },
}));
