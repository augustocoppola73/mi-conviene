import { StyleSheet, useColorScheme } from 'react-native';

// Palette "Moss Green". Regola: nessun colore hardcoded nei componenti.
const light = {
  background: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceSecondary: '#E6EEE2',
  surfaceMuted: '#F3F5F1',
  border: '#E3E7E0',
  text: '#1B1F1A',
  textSecondary: '#6B7368',
  primary: '#4F6B4A',
  primaryText: '#FFFFFF',
  primarySoft: '#DCE7D6',
  danger: '#C2483D',
  warning: '#B7791F',
  success: '#2F7D4A',
  badge: '#3F5A3B',
  badgeText: '#FFFFFF',
  tabInactive: '#7B8478',
  overlay: 'rgba(0,0,0,0.35)',
};

const dark: typeof light = {
  background: '#141614',
  surface: '#1C1F1C',
  surfaceSecondary: '#243024',
  surfaceMuted: '#2A2E2A',
  border: '#2E332E',
  text: '#F1F4EF',
  textSecondary: '#A3AD9F',
  primary: '#6F8F68',
  primaryText: '#FFFFFF',
  primarySoft: '#2F3D2D',
  danger: '#E0675C',
  warning: '#E0A84A',
  success: '#5FB37A',
  badge: '#4F6B4A',
  badgeText: '#FFFFFF',
  tabInactive: '#8A9387',
  overlay: 'rgba(0,0,0,0.6)',
};

export type Colors = typeof light;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 12, lg: 18, pill: 999 };

// Colori di brand delle catene (identificativi, uguali nei due temi).
export const storeColors: Record<string, string> = {
  conad: '#E2231A',
  esselunga: '#7AB51D',
  coop: '#1E6FD9',
  lidl: '#F5C400',
  carrefour: '#F28C1A',
  pam: '#9C1C3B',
  eurospin: '#1B2F7E',
};

export function useTheme() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  return { colors: isDark ? dark : light, isDark };
}

export function makeStyles<T extends StyleSheet.NamedStyles<T>>(factory: (c: Colors) => T) {
  const cache = new Map<Colors, T>();
  return function useStyles(): T {
    const { colors } = useTheme();
    let styles = cache.get(colors);
    if (!styles) {
      styles = StyleSheet.create(factory(colors));
      cache.set(colors, styles);
    }
    return styles;
  };
}
