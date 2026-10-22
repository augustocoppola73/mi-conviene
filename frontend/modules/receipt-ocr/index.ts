/**
 * #32: lettore del testo nel telefono (ML Kit). Negli APK costruiti prima di questo modulo non c'è:
 * `available` è false e l'app nasconde la foto dello scontrino invece di rompersi.
 */
import { requireOptionalNativeModule } from 'expo';

export type OcrLine = { text: string; box: [number, number][] };
const Native = requireOptionalNativeModule<{ recognize(uri: string): Promise<OcrLine[]> }>('ReceiptOcr');

export const available = !!Native;
export async function recognize(uri: string): Promise<OcrLine[]> {
  if (!Native) throw new Error('La lettura delle foto arriva con la prossima versione dell\'app da installare');
  return Native.recognize(uri);
}
