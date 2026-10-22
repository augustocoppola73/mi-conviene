/**
 * #38: riepilogo del mese nel Salvadanaio: quanto hai risparmiato e speso, il confronto col mese prima,
 * dove hai risparmiato di più e quanto è andato in ogni reparto. Si scorre mese per mese.
 */
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { Category, SavingEntry } from '../api';
import { PRODUCT_INDEX } from '../engine/data';
import { euro } from '../format';
import { makeStyles, radius, spacing, useTheme } from '../theme';
import { Card, Icon, StoreDot } from './ui';

const value = (e: SavingEntry) => (e.verified ? e.verified_amount ?? 0 : e.amount);
const spent = (e: SavingEntry) => e.paid ?? e.estimated_spend ?? 0;
const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}`;

interface Month { saved: number; savedVerified: number; spent: number; count: number; verified: number;
  stores: { id: string; name: string; saved: number; spent: number; count: number }[];
  cats: { id: string; amount: number }[] }

function summarize(entries: SavingEntry[]): Month {
  const stores = new Map<string, { id: string; name: string; saved: number; spent: number; count: number }>();
  const cats = new Map<string, number>();
  for (const e of entries) {
    const st = stores.get(e.store_id) ?? { id: e.store_id, name: e.store_name, saved: 0, spent: 0, count: 0 };
    st.saved += value(e); st.spent += spent(e); st.count += 1;
    stores.set(e.store_id, st);
    // reparti: le righe dello scontrino calcolato, in proporzione a quanto hai pagato davvero
    const lines = e.snapshot?.receipt?.lines ?? [];
    const tot = lines.reduce((t, l) => t + (l.line_price || 0), 0);
    if (tot > 0) {
      const k = spent(e) / tot;
      for (const l of lines) {
        const c = PRODUCT_INDEX[l.product_id]?.category_id ?? (l as any).category_id ?? 'altro';   // #101: i prodotti scritti a mano tengono il loro reparto
        cats.set(c, (cats.get(c) ?? 0) + (l.line_price || 0) * k);
      }
    }
  }
  return {
    saved: entries.reduce((t, e) => t + value(e), 0),
    savedVerified: entries.filter((e) => e.verified).reduce((t, e) => t + (e.verified_amount ?? 0), 0),
    spent: entries.reduce((t, e) => t + spent(e), 0),
    count: entries.length,
    verified: entries.filter((e) => e.verified).length,
    stores: [...stores.values()].sort((a, b) => b.saved - a.saved),
    cats: [...cats.entries()].map(([id, amount]) => ({ id, amount })).sort((a, b) => b.amount - a.amount),
  };
}

export function MonthSummary({ entries, categories }: { entries: SavingEntry[]; categories: Category[] }) {
  const s = useStyles();
  const { colors } = useTheme();
  const [offset, setOffset] = useState(0);   // 0 = questo mese, 1 = il mese prima…
  const now = new Date();
  const month = new Date(now.getFullYear(), now.getMonth() - offset, 1);
  const prev = new Date(now.getFullYear(), now.getMonth() - offset - 1, 1);
  const byMonth = useMemo(() => {
    const m = new Map<string, SavingEntry[]>();
    for (const e of entries) { const k = key(new Date(e.created_at)); m.set(k, [...(m.get(k) ?? []), e]); }
    return m;
  }, [entries]);
  const cur = summarize(byMonth.get(key(month)) ?? []);
  const before = summarize(byMonth.get(key(prev)) ?? []);
  const oldest = entries.length ? new Date(entries[entries.length - 1].created_at) : now;
  const canBack = month > new Date(oldest.getFullYear(), oldest.getMonth(), 1);
  const label = month.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
  const catById = new Map(categories.map((c) => [c.id, c]));
  const maxCat = Math.max(1, ...cur.cats.map((c) => c.amount));
  const best = cur.stores.find((x) => x.saved > 0);
  const delta = cur.saved - before.saved;

  return (
    <Card style={s.card}>
      <View style={s.head}>
        <Pressable onPress={() => canBack && setOffset(offset + 1)} hitSlop={10} disabled={!canBack} style={{ padding: 10 }} accessibilityRole="button" accessibilityLabel="Mese prima">
          <Icon name="chevron-back" size={22} color={canBack ? colors.text : colors.border} />
        </Pressable>
        <Text style={s.title}>📅 {label[0].toUpperCase() + label.slice(1)}</Text>
        <Pressable onPress={() => offset > 0 && setOffset(offset - 1)} hitSlop={10} disabled={offset === 0} style={{ padding: 10 }} accessibilityRole="button" accessibilityLabel="Mese dopo">
          <Icon name="chevron-forward" size={22} color={offset > 0 ? colors.text : colors.border} />
        </Pressable>
      </View>

      {cur.count === 0 ? (
        <Text style={s.muted}>Nessuna spesa confermata in questo mese.</Text>
      ) : (
        <>
          <View style={s.kpis}>
            <View style={s.kpi}>
              {/* #103: come in cima al Salvadanaio, il numero grande è quello verificato */}
              <Text style={s.kLabel}>✓ Risparmiato</Text>
              <Text style={[s.kValue, { color: cur.savedVerified >= 0 ? colors.success : colors.danger }]}>{cur.savedVerified < 0 ? '−' : ''}{euro(Math.abs(cur.savedVerified))}</Text>
              {cur.saved - cur.savedVerified > 0.005 && <Text style={s.muted}>+{euro(cur.saved - cur.savedVerified)} stimati</Text>}
            </View>
            <View style={s.kpi}>
              <Text style={s.kLabel}>Speso</Text>
              <Text style={s.kValue}>{euro(cur.spent)}</Text>
            </View>
            <View style={s.kpi}>
              <Text style={s.kLabel}>Spese</Text>
              <Text style={s.kValue}>{cur.count}</Text>
            </View>
          </View>
          {before.count > 0 && (
            <Text style={s.muted}>
              {delta >= 0 ? '📈' : '📉'} {euro(Math.abs(delta))} {delta >= 0 ? 'in più' : 'in meno'} di risparmio rispetto a {prev.toLocaleDateString('it-IT', { month: 'long' })}
              {' '}· speso {euro(Math.abs(cur.spent - before.spent))} {cur.spent <= before.spent ? 'in meno' : 'in più'}
            </Text>
          )}
          {cur.verified < cur.count && (
            <Text style={s.muted}>✓ {cur.verified} di {cur.count} verificate con lo scontrino: il resto è stimato.</Text>
          )}
          {best && (
            <View style={s.best}>
              <StoreDot storeId={best.id} size={14} />
              <Text style={s.bestText}>Dove hai risparmiato di più: <Text style={{ fontWeight: '800' }}>{best.name}</Text> · {euro(best.saved)} in {best.count} {best.count === 1 ? 'spesa' : 'spese'}</Text>
            </View>
          )}
          {cur.cats.length > 0 && (
            <View style={{ gap: 6, marginTop: spacing.sm }}>
              <Text style={s.sub}>Speso per reparto</Text>
              {cur.cats.slice(0, 6).map((c) => (
                <View key={c.id} style={s.barRow}>
                  <Text style={s.barLabel} numberOfLines={1}>{catById.get(c.id)?.emoji ?? '🛒'} {catById.get(c.id)?.name ?? 'Altro'}</Text>
                  <View style={s.barTrack}><View style={[s.barFill, { width: `${Math.max(4, (c.amount / maxCat) * 100)}%` }]} /></View>
                  <Text style={s.barValue}>{euro(c.amount)}</Text>
                </View>
              ))}
            </View>
          )}
        </>
      )}
    </Card>
  );
}

const useStyles = makeStyles((c) => ({
  card: { padding: spacing.lg, gap: spacing.sm, marginTop: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: c.text, fontSize: 17, fontWeight: '800' },
  muted: { color: c.textSecondary, fontSize: 13, lineHeight: 18 },
  kpis: { flexDirection: 'row', gap: spacing.sm },
  kpi: { flex: 1, padding: spacing.sm, borderRadius: radius.md, backgroundColor: c.surfaceMuted, alignItems: 'center' },
  kLabel: { color: c.textSecondary, fontSize: 12 },
  kValue: { color: c.text, fontSize: 18, fontWeight: '800', marginTop: 2 },
  best: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, backgroundColor: c.primarySoft },
  bestText: { flex: 1, color: c.text, fontSize: 13, lineHeight: 18 },
  sub: { color: c.text, fontSize: 14, fontWeight: '700' },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  barLabel: { width: 140, color: c.text, fontSize: 12 },
  barTrack: { flex: 1, height: 10, borderRadius: 5, backgroundColor: c.surfaceMuted, overflow: 'hidden' },
  barFill: { height: 10, borderRadius: 5, backgroundColor: c.primary },
  barValue: { width: 62, textAlign: 'right', color: c.textSecondary, fontSize: 12 },
}));
