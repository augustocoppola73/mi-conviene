/**
 * Logo dell'insegna (supermercato o distributore) al posto del quadratino colorato.
 * È l'icona pubblicata dal sito ufficiale dell'insegna, presa al volo dal servizio favicon di Google e tenuta in cache;
 * se non arriva (niente rete, insegna sconosciuta) resta il quadratino col colore della catena.
 */
import { Image } from 'expo-image';
import { useState } from 'react';
import { View } from 'react-native';

import { storeColors } from '../theme';

const SITE = 'https://mi-conviene.augustocoppola.workers.dev';
// loghi già copiati sul nostro sito (public/logos): si caricano sempre, anche dove il servizio di Google non risponde
const LOCAL = new Set(['conad', 'esselunga', 'coop', 'lidl', 'carrefour', 'pam', 'eurospin', 'aldi', 'md', 'penny', 'ekom', 'prix',
  'eni', 'esso', 'ip', 'q8', 'tamoil', 'total']);

/** Logo di ogni catena dell'app (dpiu e tuodi non ne hanno uno disponibile: quadratino colorato). */
export const CHAIN_DOMAINS: Record<string, string> = Object.fromEntries(
  ['conad', 'esselunga', 'coop', 'lidl', 'carrefour', 'pam', 'eurospin', 'aldi', 'md', 'penny', 'ekom', 'prix'].map((c) => [c, c]));

const FUEL_BRANDS: [RegExp, string][] = [
  [/\b(eni|agip|enilive)\b/i, 'eni'],
  [/\bq8\b|kuwait/i, 'q8'],
  [/\b(ip|api)\b/i, 'ip'],
  [/\besso\b/i, 'esso'],
  [/\btamoil\b/i, 'tamoil'],
  [/\btotal/i, 'total'],
  [/\brepsol\b/i, 'repsol.it'],
  [/\bshell\b/i, 'shell.it'],
  [/\b(costantin|costan)/i, 'costantin.it'],
  [/\bbeyfin\b/i, 'beyfin.it'],
  [/\b(retitalia|europam)\b/i, 'europam.it'],
];
/** Logo del marchio di un distributore (dal nome che usa il MIMIT), oppure null per le "pompe bianche". */
export const fuelDomain = (brand?: string | null) => (brand ? FUEL_BRANDS.find(([re]) => re.test(brand))?.[1] ?? null : null);

/** domain: una chiave dei loghi nostri (es. "conad") oppure il dominio di un sito (logo dal servizio di Google). */
const logoUrl = (domain: string) => LOCAL.has(domain) ? `${SITE}/logos/${domain}.png` : `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;

export function BrandLogo({ domain, color = '#999', size = 16, round = false }: { domain?: string | null; color?: string; size?: number; round?: boolean }) {
  const [failed, setFailed] = useState(false);
  const box = { width: size, height: size, borderRadius: round ? size / 2 : Math.max(3, size / 5) };
  if (!domain || failed) return <View style={[box, { backgroundColor: color }]} />;
  return (
    <View style={[box, { backgroundColor: '#fff', overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)' }]}>
      <Image source={{ uri: logoUrl(domain) }} cachePolicy="disk" transition={0} onError={() => setFailed(true)}
        style={{ width: size * 0.82, height: size * 0.82 }} contentFit="contain" />
    </View>
  );
}

/** Logo di una catena dell'app. */
export function ChainLogo({ chain, size = 16 }: { chain: string; size?: number }) {
  return <BrandLogo domain={CHAIN_DOMAINS[chain]} color={storeColors[chain] ?? '#999'} size={size} />;
}
