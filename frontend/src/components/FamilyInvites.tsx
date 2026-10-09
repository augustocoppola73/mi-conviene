/** Profilo › Famiglia (#13): invito con link (48 ore, una volta), richieste da accettare, inviti aperti da revocare. */
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Platform, Pressable, Text, View } from 'react-native';

import { api, Family, JoinRequest, MyJoinRequest, OpenInvite } from '../api';
import { shareInvite } from '../invite';
import { makeStyles, radius, spacing, useTheme } from '../theme';
import { Icon, PrimaryButton } from './ui';

function tell(message: string) {
  if (Platform.OS === 'web') globalThis.alert?.(message);
  else Alert.alert('Famiglia', message);
}

function ask(message: string, ok: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(globalThis.confirm?.(message) ?? true);
  return new Promise((res) => Alert.alert('Famiglia', message, [
    { text: 'Annulla', style: 'cancel', onPress: () => res(false) },
    { text: ok, style: 'destructive', onPress: () => res(true) },
  ]));
}

function until(iso: string): string {
  const h = Math.round((new Date(iso).getTime() - Date.now()) / 3_600_000);
  return h <= 1 ? 'scade tra meno di un\'ora' : h < 48 ? `scade tra ${h} ore` : `scade tra ${Math.round(h / 24)} giorni`;
}

/** Invita, accetta / rifiuta, revoca. Si aggiorna quando si apre il Profilo e ogni 15 secondi. */
export function FamilyInvites({ family, myName, onChanged }: { family: Family; myName: string; onChanged: () => void }) {
  const s = useStyles();
  const { colors } = useTheme();
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [invites, setInvites] = useState<OpenInvite[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const id = family.id;

  const load = useCallback(async () => {
    if (!id) return;
    const [r, i] = await Promise.all([api.joinRequests(id).catch(() => []), api.invitesOpen(id).catch(() => [])]);
    setRequests(r); setInvites(i);
  }, [id]);
  useFocusEffect(useCallback(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]));

  if (!id) return null;
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); } catch (e) { tell((e as Error).message); } finally { setBusy(null); load(); }
  };
  const invite = () => run('new', async () => {
    const inv = await api.inviteCreate(id);
    const r = await shareInvite(inv.code, myName);
    if (r === 'copied') tell("Messaggio d'invito copiato: incollalo su WhatsApp, SMS o email.");
  });

  return (
    <View style={{ marginTop: spacing.sm }}>
      <Text style={s.help}>Invita chi fa la spesa con te: riceve un link (vale 48 ore, una volta sola), scrive il suo nome e tu lo accetti.</Text>
      <PrimaryButton label="Invita in famiglia" icon="share-social-outline" onPress={invite} loading={busy === 'new'} />

      {requests.map((r) => (
        <View key={r.user_id} style={s.request}>
          <Icon name="hand-left-outline" size={20} color={colors.primary} />
          <Text style={[s.text, { flex: 1 }]}><Text style={{ fontWeight: '700' }}>{r.display_name || 'Qualcuno'}</Text> vuole entrare</Text>
          <Pressable accessibilityRole="button" hitSlop={6} disabled={!!busy}
            onPress={() => run(`no-${r.user_id}`, () => api.joinDecide(id, r.user_id, false))}>
            <Text style={s.no}>Rifiuta</Text>
          </Pressable>
          <Pressable accessibilityRole="button" hitSlop={6} disabled={!!busy} style={s.yesBtn}
            onPress={() => run(`ok-${r.user_id}`, async () => { await api.joinDecide(id, r.user_id, true); onChanged(); })}>
            <Text style={s.yes}>Accetta</Text>
          </Pressable>
        </View>
      ))}

      {invites.length > 0 && (
        <View style={{ marginTop: spacing.md, gap: 6 }}>
          <Text style={s.small}>Inviti ancora aperti</Text>
          {invites.map((i) => (
            <View key={i.code} style={s.row}>
              <Icon name="link-outline" size={16} color={colors.textSecondary} />
              <Text style={[s.small, { flex: 1 }]}>{i.code} · {until(i.expires_at)}{i.created_by_name ? ` · di ${i.created_by_name}` : ''}</Text>
              <Pressable accessibilityRole="button" hitSlop={6} disabled={!!busy}
                onPress={() => run(`rv-${i.code}`, () => api.inviteRevoke(i.code))}>
                <Text style={s.no}>Revoca</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

/** Il proprietario toglie un familiare. */
export async function removeMember(family: Family, userId: string, name: string, done: () => void) {
  if (!family.id) return;
  if (!(await ask(`Togli ${name} dalla famiglia? Non vedrà più la vostra spesa, le ricette e il salvadanaio.`, 'Togli'))) return;
  try { await api.memberRemove(family.id, userId); done(); } catch (e) { tell((e as Error).message); }
}

/** Senza famiglia: la mia richiesta in attesa (si controlla ogni 15 secondi; quando ti accettano si ricarica). */
export function MyJoinRequestCard({ onAccepted }: { onAccepted: () => void }) {
  const s = useStyles();
  const { colors } = useTheme();
  const [req, setReq] = useState<MyJoinRequest | null>(null);
  const load = useCallback(async () => {
    const r = await api.myJoinRequest().catch(() => null);
    setReq(r);
    if (r?.status === 'accettata' && r.kind === 'famiglia') onAccepted();
  }, [onAccepted]);
  useFocusEffect(useCallback(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]));
  if (!req || req.kind !== 'famiglia' || req.status === 'accettata') return null;
  if (req.status === 'rifiutata') {
    return (
      <View style={s.request}>
        <Icon name="close-circle-outline" size={20} color={colors.textSecondary} />
        <Text style={[s.text, { flex: 1 }]}>La tua richiesta di entrare in famiglia non è stata accettata. Se è un errore, chiedi un nuovo invito.</Text>
      </View>
    );
  }
  return (
    <View style={s.request}>
      <Icon name="time-outline" size={20} color={colors.primary} />
      <Text style={[s.text, { flex: 1 }]}>Aspetti che {req.invited_by || 'un familiare'} ti accetti in famiglia. Ti arriva un avviso.</Text>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  help: { color: c.textSecondary, fontSize: 13, lineHeight: 19, marginBottom: spacing.sm },
  text: { color: c.text, fontSize: 14, lineHeight: 20 },
  small: { color: c.textSecondary, fontSize: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  request: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm, padding: spacing.sm,
    borderRadius: radius.md, backgroundColor: c.surfaceMuted },
  no: { color: c.danger, fontWeight: '600', fontSize: 14 },
  yesBtn: { backgroundColor: c.primary, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 6 },
  yes: { color: c.primaryText, fontWeight: '700', fontSize: 14 },
}));
