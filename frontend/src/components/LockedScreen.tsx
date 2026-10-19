/** #76: una schermata dell'app completa aperta da un indirizzo diretto in modalità partecipante: spiega e non mostra la funzione. */
import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Feature, FEATURES } from '../features';
import { useStore } from '../store';
import { makeStyles, spacing } from '../theme';
import { PrimaryButton } from './ui';

export function LockedScreen({ feature }: { feature: Feature }) {
  const s = useStyles();
  const { setPrefs } = useStore();
  const f = FEATURES[feature];
  return (
    <SafeAreaView style={s.screen}>
      <View style={s.box}>
        <Text style={s.title}>{f.emoji} {f.title}</Text>
        <Text style={s.text}>È nell'app completa: {f.why}. Adesso stai usando Mi Conviene per il gruppo in cui ti hanno invitato.</Text>
        <PrimaryButton label="Scopri l'app completa" icon="star-outline" onPress={() => setPrefs({ participant: false })} />
        <PrimaryButton label="Torna alla lista" variant="secondary" onPress={() => router.replace('/')} style={{ marginTop: spacing.sm }} />
      </View>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((c) => ({
  screen: { flex: 1, backgroundColor: c.background, justifyContent: 'center' },
  box: { padding: spacing.xl, gap: spacing.md, maxWidth: 520, alignSelf: 'center', width: '100%' },
  title: { color: c.text, fontSize: 22, fontWeight: '800' },
  text: { color: c.text, fontSize: 15, lineHeight: 21 },
}));
