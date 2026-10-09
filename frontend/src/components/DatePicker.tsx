/** Calendario a mese (solo JavaScript: arriva con l'aggiornamento, senza APK nuovo). value/onChange in "AAAA-MM-GG". */
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { makeStyles, radius, spacing, useTheme } from '../theme';
import { Icon } from './ui';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const WEEK = ['L', 'M', 'M', 'G', 'V', 'S', 'D'];

export function DatePicker({ value, onChange, minDate }: { value: string | null; onChange: (d: string) => void; minDate?: Date }) {
  const s = useStyles();
  const { colors } = useTheme();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const min = minDate ?? today;
  const start = value ? new Date(`${value}T00:00:00`) : today;
  const [month, setMonth] = useState(new Date(start.getFullYear(), start.getMonth(), 1));
  const first = (month.getDay() + 6) % 7;   // lunedì = 0
  const daysIn = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = [...Array(first).fill(null), ...Array.from({ length: daysIn }, (_, k) => new Date(month.getFullYear(), month.getMonth(), k + 1))];
  while (cells.length % 7) cells.push(null);
  const canPrev = new Date(month.getFullYear(), month.getMonth(), 0) >= min;
  const title = month.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });

  return (
    <View style={s.box}>
      <View style={s.head}>
        <Pressable onPress={() => canPrev && setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} hitSlop={10} disabled={!canPrev}
          accessibilityLabel="Mese prima">
          <Icon name="chevron-back" size={22} color={canPrev ? colors.text : colors.border} />
        </Pressable>
        <Text style={s.title}>{title[0].toUpperCase() + title.slice(1)}</Text>
        <Pressable onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} hitSlop={10} accessibilityLabel="Mese dopo">
          <Icon name="chevron-forward" size={22} color={colors.text} />
        </Pressable>
      </View>
      <View style={s.grid}>
        {WEEK.map((w, k) => <Text key={`w${k}`} style={[s.cell, s.week]}>{w}</Text>)}
        {cells.map((d, k) => {
          if (!d) return <View key={k} style={s.cell} />;
          const off = d < min;
          const on = value === iso(d);
          const isToday = iso(d) === iso(today);
          return (
            <Pressable key={k} disabled={off} onPress={() => onChange(iso(d))} style={[s.cell, s.day, on && s.on, isToday && !on && s.today]}
              accessibilityRole="button" accessibilityState={{ selected: on, disabled: off }}
              accessibilityLabel={d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })}>
              <Text style={[s.dayText, off && { color: colors.border }, on && s.onText]}>{d.getDate()}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  box: { borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: spacing.sm, backgroundColor: c.background },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.sm, paddingVertical: 4 },
  title: { color: c.text, fontSize: 16, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, aspectRatio: 1.15, alignItems: 'center', justifyContent: 'center', textAlign: 'center' },
  week: { color: c.textSecondary, fontSize: 12, fontWeight: '700', textAlignVertical: 'center', lineHeight: 30 },
  day: { borderRadius: 999 },
  dayText: { color: c.text, fontSize: 15 },
  on: { backgroundColor: c.primary },
  onText: { color: c.primaryText, fontWeight: '800' },
  today: { borderWidth: 1, borderColor: c.primary },
}));
