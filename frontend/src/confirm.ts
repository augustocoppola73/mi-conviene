/** #64: domanda sì/no prima delle azioni che cancellano (sul web confirm, sul telefono il riquadro di Android). */
import { Alert, Platform } from 'react-native';

export function confirmAsk(title: string, message: string, yes: string, no = 'Annulla'): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(globalThis.confirm?.(`${title}\n\n${message}`) ?? true);
  return new Promise((res) => Alert.alert(title, message, [
    { text: no, style: 'cancel', onPress: () => res(false) },
    { text: yes, style: 'destructive', onPress: () => res(true) },
  ], { cancelable: true, onDismiss: () => res(false) }));
}
