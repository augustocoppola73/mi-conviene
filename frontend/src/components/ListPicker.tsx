/** Scheda Lista (#21): in alto "🧺 La mia lista · 🎉 Festa di sabato · ＋ Nuovo gruppo": la lista che stai compilando. */
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { IS_CLOUD } from '../cloud/client';
import { Group, myGroups } from '../cloud/groups';
import { useStore } from '../store';
import { makeStyles, radius, spacing } from '../theme';
import { GroupSheet } from './GroupSheet';
import { HScroll } from './HScroll';

export function ListPicker() {
  const s = useStyles();
  const { prefs, setPrefs, items, groupMine } = useStore();
  const [groups, setGroups] = useState<Group[]>([]);
  const [creating, setCreating] = useState(false);
  useFocusEffect(useCallback(() => {
    if (!IS_CLOUD) return;
    myGroups().then((g) => {
      setGroups(g);
      if (prefs.activeList && !g.some((x) => x.id === prefs.activeList)) setPrefs({ activeList: null });   // gruppo chiuso o uscito
    }).catch(() => {});
  }, [prefs.activeList]));
  if (!IS_CLOUD) return null;
  const sel = prefs.activeList;
  const mineCount = items.length + groupMine.length;

  return (
    <>
      <HScroll contentContainerStyle={s.row}>
        <Pressable onPress={() => setPrefs({ activeList: null })} style={[s.chip, !sel && s.on]} accessibilityRole="tab" accessibilityState={{ selected: !sel }}>
          <Text style={[s.text, !sel && s.onText]}>🧺 La mia lista{mineCount ? ` · ${mineCount}` : ''}</Text>
        </Pressable>
        {groups.map((g) => {
          const on = sel === g.id;
          return (
            <Pressable key={g.id} onPress={() => setPrefs({ activeList: g.id })} style={[s.chip, on && s.on]} accessibilityRole="tab" accessibilityState={{ selected: on }}>
              <Text style={[s.text, on && s.onText]} numberOfLines={1}>{g.emoji || '🛒'} {g.name}{g.todo ? ` · ${g.todo}` : ''}</Text>
              {g.role === 'proprietario' && g.proposals > 0 && <View style={s.dot} />}
            </Pressable>
          );
        })}
        <Pressable onPress={() => setCreating(true)} style={[s.chip, s.add]} accessibilityRole="button">
          <Text style={s.addText}>＋ Nuovo gruppo</Text>
        </Pressable>
      </HScroll>
      <GroupSheet visible={creating} onClose={() => setCreating(false)} onSaved={(id) => setPrefs({ activeList: id })} noNavigate />
    </>
  );
}

const useStyles = makeStyles((c) => ({
  row: { gap: spacing.sm, paddingVertical: spacing.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill,
    borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, maxWidth: 220 },
  on: { backgroundColor: c.primary, borderColor: c.primary },
  text: { color: c.text, fontSize: 14, fontWeight: '600' },
  onText: { color: c.primaryText },
  add: { borderStyle: 'dashed', borderColor: c.primary },
  addText: { color: c.primary, fontSize: 14, fontWeight: '700' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.danger },
}));
