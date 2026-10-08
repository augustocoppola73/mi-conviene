/**
 * Logo dell'insegna (supermercato o distributore) al posto del quadratino colorato.
 * È l'icona pubblicata dal sito ufficiale dell'insegna, presa al volo dal servizio favicon di Google e tenuta in cache;
 * se non arriva (niente rete, insegna sconosciuta) resta il quadratino col colore della catena.
 */
import { Image } from 'expo-image';
import { useState } from 'react';
import { View } from 'react-native';

import { storeColors } from '../theme';

export const CHAIN_DOMAINS: Record<string, string> = {
  conad: 'conad.it', esselunga: 'esselunga.it', coop: 'coop.it', lidl: 'lidl.it', carrefour: 'carrefour.it',
  pam: 'pampanorama.it', eurospin: 'eurospin.it', aldi: 'aldi.it', md: 'mdspa.it', penny: 'penny.it',
  ekom: 'ekomdiscount.it', dpiu: 'dpiu.it', tuodi: 'tuodi.it', prix: 'prixquality.com',
};

const FUEL_BRANDS: [RegExp, string][] = [
  [/\b(eni|agip|enilive)\b/i, 'enilive.it'],
  [/\bq8\b|kuwait/i, 'q8.it'],
  [/\b(ip|api)\b/i, 'gruppoapi.com'],
  [/\besso\b/i, 'esso.it'],
  [/\btamoil\b/i, 'tamoil.it'],
  [/\btotal/i, 'totalenergies.it'],
  [/\brepsol\b/i, 'repsol.it'],
  [/\bshell\b/i, 'shell.it'],
  [/\b(costantin|costan)/i, 'costantin.it'],
  [/\bbeyfin\b/i, 'beyfin.it'],
  [/\b(retitalia|europam)\b/i, 'europam.it'],
];
/** Dominio del marchio di un distributore (dal nome che usa il MIMIT), oppure null per le "pompe bianche". */
export const fuelDomain = (brand?: string | null) => (brand ? FUEL_BRANDS.find(([re]) => re.test(brand))?.[1] ?? null : null);

const logoUrl = (domain: string) => `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;

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
