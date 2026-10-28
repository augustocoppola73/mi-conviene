/**
 * #40: l'aspetto del widget, scelto dall'utente (Altro › Widget, o ⚙ sul widget).
 * Sta sul telefono (lo legge anche il compito in background che ridisegna il widget ad app chiusa).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export type WidgetTheme = 'scuro' | 'chiaro' | 'auto';
export interface WidgetStyle { theme: WidgetTheme; transparency: number }   // trasparenza in %, 0 = pieno
export const STYLE_KEY = 'mc_widget_style_v1';
export const DEFAULT_STYLE: WidgetStyle = { theme: 'scuro', transparency: 40 };
export const TRANSPARENCY_STEPS = [0, 20, 40, 60, 80];

export async function loadWidgetStyle(): Promise<WidgetStyle> {
  try {
    const raw = await AsyncStorage.getItem(STYLE_KEY);
    const v = raw ? JSON.parse(raw) : null;
    if (!v) return DEFAULT_STYLE;
    const theme: WidgetTheme = ['scuro', 'chiaro', 'auto'].includes(v.theme) ? v.theme : DEFAULT_STYLE.theme;
    const t = Number(v.transparency);
    return { theme, transparency: Number.isFinite(t) ? Math.max(0, Math.min(90, t)) : DEFAULT_STYLE.transparency };
  } catch { return DEFAULT_STYLE; }
}

export async function saveWidgetStyle(s: WidgetStyle): Promise<void> {
  await AsyncStorage.setItem(STYLE_KEY, JSON.stringify(s));
}

type Rgba = `rgba(${number}, ${number}, ${number}, ${number})`;
export type Pal = { bg: Rgba; text: `#${string}`; muted: `#${string}`; primary: `#${string}`; onPrimary: `#${string}`; soft: Rgba };

/** i colori del widget: scuro o chiaro, con il fondo trasparente quanto scelto */
export function palette(dark: boolean, transparency: number): Pal {
  const a = Math.round((1 - transparency / 100) * 100) / 100;
  return dark
    ? { bg: `rgba(18, 20, 18, ${a})`, text: '#FFFFFF', muted: '#C9D1C5', primary: '#A9CF9F', onPrimary: '#10170F', soft: 'rgba(255, 255, 255, 0.12)' }
    : { bg: `rgba(255, 255, 255, ${a})`, text: '#1B1F1A', muted: '#5E665B', primary: '#4F6B4A', onPrimary: '#FFFFFF', soft: 'rgba(0, 0, 0, 0.07)' };
}
