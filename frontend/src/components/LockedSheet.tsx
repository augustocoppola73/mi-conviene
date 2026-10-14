/** #23: "È nell'app completa": si apre toccando una funzione ingrigita (modalità partecipante). */
import { Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FEATURES, hideLocked, lockedFeatures, useLockedSheet } from '../features';
import { useStore } from '../store';
import { makeStyles, radius, spacing, useTheme } from '../theme';
import { Icon, PrimaryButton } from './ui';

export function LockedSheet() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const which = useLockedSheet();
  const { prefs, setPrefs } = useStore();
  const f = which && which !== 'tutte' ? FEATURES[which] : null;
  const others = lockedFeatures(prefs).filter((k) => k !== which);
  const unlock = () => { setPrefs({ participant: false }); hideLocked(); };

  return (
    <Modal visible={!!which} transparent animationType="slide" onRequestClose={hideLocked}>
      <Pressable style={s.bg} onPress={hideLocked}>
        <Pressable style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 16) + spacing.md }]} onPress={() => {}}>
          <View style={s.head}>
            <Text style={s.title}>{f ? `${f.emoji} ${f.title}` : '⭐ L\'app completa'}</Text>
            <Pressable onPress={hideLocked} hitSlop={12} accessibilityLabel="Chiudi"><Icon name="close" size={26} color={colors.textSecondary} /></Pressable>
          </View>
          <Text style={s.text}>
            {f ? `È nell'app completa: ${f.why}. ` : ''}
            Adesso stai usando Mi Conviene per il gruppo in cui ti hanno invitato: lista, "Lo prendo io", dove conviene comprare e conti.
          </Text>
          {others.length > 0 && (
            <View style={{ gap: 6, marginTop: spacing.sm }}>
              <Text style={s.label}>{f ? 'Con l\'app completa anche:' : 'Con l\'app completa:'}</Text>
              {others.map((k) => (
                <Text key={k} style={s.item}>{FEATURES[k].emoji} <Text style={{ fontWeight: '700' }}>{FEATURES[k].title}</Text>: {FEATURES[k].why}</Text>
              ))}
            </View>
          )}
          <Text style={s.small}>È gratis. I gruppi e le liste restano come sono.</Text>
          <PrimaryButton label="Usa l'app completa" icon="star-outline" onPress={unlock} style={{ marginTop: spacing.md }} />
          <PrimaryButton label="Non ora" variant="secondary" onPress={hideLocked} style={{ marginTop: spacing.sm }} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  bg: { flex: 1, backgroundColor: c.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: c.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.xl,
    width: '100%', maxWidth: 640, alignSelf: 'center', gap: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: c.text, fontSize: 20, fontWeight: '800', flex: 1 },
  text: { color: c.text, fontSize: 15, lineHeight: 21 },
  label: { color: c.text, fontSize: 14, fontWeight: '700' },
  item: { color: c.textSecondary, fontSize: 14, lineHeight: 20 },
  small: { color: c.textSecondary, fontSize: 12, marginTop: spacing.sm },
}));
