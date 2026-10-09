/** Scheda Lista: "La mia lista ▾" → la mia lista, i gruppi (con quanto c'è da prendere), + Nuovo gruppo (#14). */
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';

import { IS_CLOUD } from '../cloud/client';
import { eventLabel, Group, myGroups } from '../cloud/groups';
import { makeStyles, radius, spacing, useTheme } from '../theme';
import { GroupSheet } from './GroupSheet';
import { Icon } from './ui';

export function ListPicker() {
  const s = useStyles();
  const { colors } = useTheme();
  const [groups, setGroups] = useState<Group[]>([]);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  useFocusEffect(useCallback(() => {
    if (IS_CLOUD) myGroups().then(setGroups).catch(() => {});
  }, []));
  if (!IS_CLOUD) return null;
  const todo = groups.reduce((t, g) => t + g.todo, 0);

  return (
    <>
      <Pressable onPress={() => setOpen(true)} style={({ pressed }) => [s.pill, pressed && { opacity: 0.7 }]} accessibilityRole="button"
        accessibilityLabel="Scegli la lista">
        <Icon name="list-outline" size={16} color={colors.primary} />
        <Text style={s.pillText}>La mia lista</Text>
        {groups.length > 0 && <Text style={s.count}>{groups.length} {groups.length === 1 ? 'gruppo' : 'gruppi'}{todo ? ` · ${todo} da prendere` : ''}</Text>}
        <Icon name="chevron-down" size={16} color={colors.primary} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={s.backdrop} onPress={() => setOpen(false)}>
          <View style={s.box}>
            <Pressable onPress={() => setOpen(false)} style={[s.row, s.current]}>
              <Text style={s.emoji}>🧺</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.name}>La mia lista</Text>
                <Text style={s.meta}>la tua spesa (e quella che condividi in famiglia)</Text>
              </View>
              <Icon name="checkmark" size={18} color={colors.primary} />
            </Pressable>
            {groups.map((g) => (
              <Pressable key={g.id} onPress={() => { setOpen(false); router.push(`/gruppo/${g.id}`); }} style={s.row}>
                <Text style={s.emoji}>{g.emoji || '🛒'}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.name} numberOfLines={1}>{g.name}</Text>
                  <Text style={s.meta}>{eventLabel(g.event_date)} · {g.members} {g.members === 1 ? 'persona' : 'persone'}{g.todo ? ` · ${g.todo} da prendere` : ''}</Text>
                </View>
                <Icon name="chevron-forward" size={18} color={colors.textSecondary} />
              </Pressable>
            ))}
            <Pressable onPress={() => { setOpen(false); setCreating(true); }} style={s.row}>
              <Text style={s.emoji}>➕</Text>
              <Text style={[s.name, { color: colors.primary, fontWeight: '700' }]}>Nuovo gruppo</Text>
            </Pressable>
            <Text style={s.meta}>Un gruppo è una lista con amici: una festa, una cena, i coinquilini. Ognuno dice cosa prende.</Text>
          </View>
        </Pressable>
      </Modal>
      <GroupSheet visible={creating} onClose={() => setCreating(false)} />
    </>
  );
}

const useStyles = makeStyles((c) => ({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: spacing.sm, paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: radius.pill, backgroundColor: c.primarySoft },
  pillText: { color: c.text, fontWeight: '700', fontSize: 14 },
  count: { color: c.textSecondary, fontSize: 12 },
  backdrop: { flex: 1, backgroundColor: c.overlay, justifyContent: 'flex-start', paddingTop: 90, paddingHorizontal: spacing.lg },
  box: { backgroundColor: c.surface, borderRadius: radius.lg, padding: spacing.md, gap: 4, width: '100%', maxWidth: 480, alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.sm, borderRadius: radius.md },
  current: { backgroundColor: c.primarySoft },
  emoji: { fontSize: 24, width: 32, textAlign: 'center' },
  name: { color: c.text, fontSize: 16 },
  meta: { color: c.textSecondary, fontSize: 12, marginTop: 2 },
}));
