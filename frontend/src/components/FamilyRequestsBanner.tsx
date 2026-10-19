/** #97: «Moira vuole entrare in famiglia · Accetta» direttamente in Lista (prima solo in Altro › Profilo › Famiglia). */
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { api, JoinRequest } from '../api';
import { showError } from '../errors';
import { useStore } from '../store';
import { makeStyles, radius, spacing, useTheme } from '../theme';

export function FamilyRequestsBanner() {
  const s = useStyles();
  const { colors } = useTheme();
  const { familyId, reloadProfile } = useStore();
  const [reqs, setReqs] = useState<JoinRequest[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => { if (familyId) api.joinRequests(familyId).then(setReqs).catch(() => setReqs([])); else setReqs([]); }, [familyId]);
  useFocusEffect(useCallback(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, [load]));
  if (!familyId || !reqs.length) return null;
  const decide = async (r: JoinRequest, ok: boolean) => {
    setBusy(r.user_id);
    try { await api.joinDecide(familyId, r.user_id, ok); setReqs((x) => x.filter((y) => y.user_id !== r.user_id)); if (ok) reloadProfile(); }
    catch (e) { showError('Non ci sono riuscito', e, 'rispondere'); } finally { setBusy(null); }
  };
  return (
    <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
      {reqs.map((r) => (
        <View key={r.user_id} style={s.box}>
          <Text style={s.text}>🙋 <Text style={{ fontWeight: '800' }}>{r.display_name || 'Qualcuno'}</Text> vuole entrare in famiglia</Text>
          <View style={s.row}>
            <Pressable disabled={!!busy} onPress={() => decide(r, false)} hitSlop={8}><Text style={[s.link, { color: colors.danger }]}>Rifiuta</Text></Pressable>
            <Pressable disabled={!!busy} onPress={() => decide(r, true)} style={s.yes} accessibilityRole="button"><Text style={s.yesText}>Accetta</Text></Pressable>
          </View>
        </View>
      ))}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  box: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1.5, borderColor: c.primary, backgroundColor: c.primarySoft, gap: spacing.sm },
  text: { color: c.text, fontSize: 15 },
  row: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: spacing.lg },
  link: { fontWeight: '700', fontSize: 14 },
  yes: { backgroundColor: c.primary, borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 8 },
  yesText: { color: c.primaryText, fontWeight: '800' },
}));
