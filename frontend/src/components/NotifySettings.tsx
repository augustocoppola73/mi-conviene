/** Profilo › Notifiche: quali avvisi ricevere dalla famiglia (salvati in profiles.prefs.notify, li legge la funzione). */
import { useEffect, useState } from 'react';
import { Switch, Text, View } from 'react-native';

import { sb } from '../cloud/client';
import { NOTIFY_KINDS, PUSH_SUPPORTED, registerPush, sendTestNotification } from '../push';
import { spacing, useTheme } from '../theme';
import { Card, PrimaryButton, SectionTitle } from './ui';

export function NotifySettings() {
  const { colors } = useTheme();
  const [notify, setNotify] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!PUSH_SUPPORTED) return;
    (async () => {
      const { data: s } = await sb().auth.getSession();
      if (!s.session) return;
      const { data } = await sb().from('profiles').select('prefs').eq('id', s.session.user.id).maybeSingle();
      setNotify((data?.prefs as any)?.notify ?? {});
    })().catch(() => {});
  }, []);
  if (!PUSH_SUPPORTED) return null;

  const save = async (next: Record<string, boolean>) => {
    setNotify(next);
    const { data: s } = await sb().auth.getSession();
    if (!s.session) return;
    const { data } = await sb().from('profiles').select('prefs').eq('id', s.session.user.id).maybeSingle();
    await sb().from('profiles').update({ prefs: { ...((data?.prefs as any) ?? {}), notify: next } }).eq('id', s.session.user.id);
  };
  const test = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await registerPush(true);
      if (r === 'denied') { setMsg('Notifiche non permesse: attivale dalle impostazioni del telefono (App › Mi Conviene › Notifiche).'); return; }
      await sendTestNotification();
      setMsg('Inviata: tra qualche secondo dovrebbe arrivarti.');
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <>
      <SectionTitle>Notifiche</SectionTitle>
      <Card style={{ gap: spacing.sm }}>
        <Text style={{ color: colors.textSecondary, fontSize: 13 }}>Ti avviso quando qualcuno della famiglia…</Text>
        {NOTIFY_KINDS.map((k) => (
          <View key={k.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Text style={{ flex: 1, color: colors.text, fontSize: 15 }}>{k.label}</Text>
            <Switch value={notify[k.id] !== false} onValueChange={(v) => save({ ...notify, [k.id]: v })}
              trackColor={{ true: colors.primary, false: colors.border }} thumbColor="#fff" />
          </View>
        ))}
        <PrimaryButton label="Prova le notifiche" icon="notifications-outline" variant="secondary" onPress={test} loading={busy} />
        {msg && <Text style={{ color: colors.textSecondary, fontSize: 13 }}>{msg}</Text>}
      </Card>
    </>
  );
}
