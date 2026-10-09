/** Profilo a sezioni chiudibili (#20): chiusa mostra una riga di riepilogo, un tocco la apre. Ricorda quali hai lasciato aperte. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ReactNode, useState, useSyncExternalStore } from 'react';
import { LayoutAnimation, Platform, Pressable, Text, UIManager, View } from 'react-native';

import { makeStyles, radius, spacing, useTheme } from '../theme';
import { Icon, IconName } from './ui';

const KEY = 'mc_profilo_aperte';
let opened: Set<string> | null = null;
const listeners = new Set<() => void>();
let loading: Promise<void> | null = null;

function load(): Promise<void> {
  if (opened) return Promise.resolve();
  loading ??= AsyncStorage.getItem(KEY)
    .then((v) => { opened = new Set(JSON.parse(v || '[]')); })
    .catch(() => { opened = new Set(); })
    .finally(() => listeners.forEach((l) => l()));
  return loading;
}

function setOpen(id: string, open: boolean) {
  opened ??= new Set();
  if (open) opened.add(id); else opened.delete(id);
  AsyncStorage.setItem(KEY, JSON.stringify([...opened])).catch(() => {});
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  load();
  return () => { listeners.delete(l); };
}

if (Platform.OS === 'android') UIManager.setLayoutAnimationEnabledExperimental?.(true);

export function ProfileSection({ id, icon, title, summary, attention, children }: {
  id: string; icon: IconName; title: string; summary?: string | null;
  /** c'è qualcosa da fare (es. una richiesta di ingresso): si apre da sola e mostra il pallino */
  attention?: boolean; children: ReactNode;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  // stato fuori da React (condiviso e salvato): letto con useSyncExternalStore, così si ridisegna sempre
  const saved = useSyncExternalStore(subscribe, () => !!opened?.has(id), () => false);
  const [dismissed, setDismissed] = useState(false);   // chiusa a mano anche se c'è il pallino
  const open = saved || (!!attention && !dismissed);
  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    if (open && attention) setDismissed(true);
    if (!open) setDismissed(false);
    setOpen(id, !open);
  };
  return (
    <View style={s.box}>
      <Pressable onPress={toggle} style={({ pressed }) => [s.head, pressed && { opacity: 0.7 }]}
        accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${title}${summary ? `: ${summary}` : ''}`}>
        <View style={s.iconWrap}>
          <Icon name={icon} size={20} color={colors.primary} />
          {attention && <View style={s.dot} />}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>{title}</Text>
          {!open && !!summary && <Text style={s.summary} numberOfLines={1}>{summary}</Text>}
        </View>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} />
      </Pressable>
      {open && <View style={s.body}>{children}</View>}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  box: { backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, marginTop: spacing.md, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  iconWrap: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.primarySoft, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', top: 0, right: 0, width: 10, height: 10, borderRadius: 5, backgroundColor: c.danger, borderWidth: 2, borderColor: c.surface },
  title: { color: c.text, fontSize: 16, fontWeight: '700' },
  summary: { color: c.textSecondary, fontSize: 13, marginTop: 2 },
  body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.sm },
}));
