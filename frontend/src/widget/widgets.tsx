/**
 * #40: i due widget Android (solo Android: questo file lo carica soltanto src/widget/index.android.ts).
 * «ListaGrande» (4×2, ridimensionabile): lista di casa per reparto, «+» per aggiungere, la spesa in corso.
 * «ListaPiccolo» (2×1): quanti prodotti ci sono e «+».
 * Tocchi: «+» apre l'app sulla ricerca, la spesa apre la spesa, il resto apre la lista.
 */
import { FlexWidget, TextWidget } from 'react-native-android-widget';

import type { WidgetData } from './data';

type Pal = { bg: `#${string}`; text: `#${string}`; muted: `#${string}`; primary: `#${string}`; onPrimary: `#${string}`; soft: `#${string}`; border: `#${string}` };
export const LIGHT: Pal = { bg: '#FFFFFF', text: '#1B1F1A', muted: '#6B7368', primary: '#4F6B4A', onPrimary: '#FFFFFF', soft: '#DCE7D6', border: '#E3E7E0' };
export const DARK: Pal = { bg: '#1C1F1C', text: '#F1F4EF', muted: '#A3AD9F', primary: '#8DB085', onPrimary: '#0F150E', soft: '#2F3D2D', border: '#2E332E' };

const OPEN_LIST = { clickAction: 'OPEN_URI', clickActionData: { uri: 'miconviene:///' } } as const;
const OPEN_ADD = { clickAction: 'OPEN_URI', clickActionData: { uri: 'miconviene:///?add=1' } } as const;
const OPEN_SHOP = { clickAction: 'OPEN_URI', clickActionData: { uri: 'miconviene:///spesa' } } as const;

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

function AddButton({ p, size = 36 }: { p: Pal; size?: number }) {
  return (
    <FlexWidget {...OPEN_ADD} accessibilityLabel="Aggiungi un prodotto"
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: p.primary, alignItems: 'center', justifyContent: 'center' }}>
      <TextWidget text="+" style={{ fontSize: size * 0.62, color: p.onPrimary, fontWeight: '700' }} />
    </FlexWidget>
  );
}

function shopLine(d: WidgetData): string | null {
  if (!d.shop) return null;
  const who = d.shop.mine ? 'Sei' : `${d.shop.who || 'Un familiare'} è`;
  return `🛒 ${who} da ${d.shop.store}: ${d.shop.done} di ${d.shop.total}`;
}

export function ListaGrande({ data, p, height }: { data: WidgetData; p: Pal; height: number }) {
  const title = data.family ? 'Lista di casa' : 'La mia lista';
  const shop = shopLine(data);
  // righe che ci stanno: intestazione ~40 dp, spesa ~28, «aggiornata alle» ~16 (solo se c'è posto), margini ~12, una riga ~22
  const footer = height >= 150;
  const room = Math.max(1, Math.floor((height - 40 - (shop ? 28 : 0) - (footer ? 16 : 0) - 12) / 22));
  const shown = data.items.slice(0, data.total > room ? room - 1 : room);
  const more = data.total - shown.length;
  return (
    <FlexWidget {...OPEN_LIST} accessibilityLabel={`${title}: ${data.total} prodotti`}
      style={{ height: 'match_parent', width: 'match_parent', backgroundColor: p.bg, borderRadius: 22, padding: 12, flexDirection: 'column' }}>
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', width: 'match_parent' }}>
        <FlexWidget style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
          <TextWidget text={`🧺 ${title}`} style={{ fontSize: 16, color: p.text, fontWeight: '700' }} maxLines={1} truncate="END" />
          <TextWidget text={`  ${data.total}`} style={{ fontSize: 16, color: p.primary, fontWeight: '700' }} />
        </FlexWidget>
        <AddButton p={p} />
      </FlexWidget>
      {shop && (
        <FlexWidget {...OPEN_SHOP} style={{ marginTop: 6, backgroundColor: p.soft, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4, width: 'match_parent' }}>
          <TextWidget text={shop} style={{ fontSize: 13, color: p.text, fontWeight: '600' }} maxLines={1} truncate="END" />
        </FlexWidget>
      )}
      <FlexWidget style={{ flex: 1, flexDirection: 'column', marginTop: 6, width: 'match_parent' }}>
        {data.total === 0 ? (
          <TextWidget text="Lista vuota: tocca + per aggiungere" style={{ fontSize: 14, color: p.muted }} />
        ) : (
          shown.map((it, k) => (
            <FlexWidget key={k} style={{ flexDirection: 'row', alignItems: 'center', height: 22, width: 'match_parent' }}>
              <TextWidget text={`${it.emoji} ${it.name}`} style={{ fontSize: 14, color: p.text }} maxLines={1} truncate="END" />
              <TextWidget text={`  ${it.qty}`} style={{ fontSize: 13, color: p.muted }} maxLines={1} />
            </FlexWidget>
          ))
        )}
        {more > 0 && <TextWidget text={`… e altri ${more}`} style={{ fontSize: 13, color: p.primary, fontWeight: '600' }} />}
      </FlexWidget>
      {footer && <TextWidget text={`Aggiornata alle ${hhmm(data.at)}`} style={{ fontSize: 11, color: p.muted }} />}
    </FlexWidget>
  );
}

export function ListaPiccolo({ data, p }: { data: WidgetData; p: Pal }) {
  const shop = data.shop ? `🛒 ${data.shop.done}/${data.shop.total}` : null;
  return (
    <FlexWidget {...(data.shop ? OPEN_SHOP : OPEN_LIST)} accessibilityLabel={`Lista: ${data.total} prodotti`}
      style={{ height: 'match_parent', width: 'match_parent', backgroundColor: p.bg, borderRadius: 22, paddingHorizontal: 12,
        flexDirection: 'row', alignItems: 'center' }}>
      <FlexWidget style={{ flex: 1, flexDirection: 'column' }}>
        <TextWidget text={`🧺 ${data.total}`} style={{ fontSize: 22, color: p.text, fontWeight: '700' }} />
        <TextWidget text={shop ?? (data.total === 1 ? 'prodotto' : 'prodotti')} style={{ fontSize: 12, color: p.muted }} maxLines={1} />
      </FlexWidget>
      <AddButton p={p} size={40} />
    </FlexWidget>
  );
}

/** il widget giusto per nome, chiaro e scuro (segue il tema del telefono) */
export function renderFor(name: string, data: WidgetData, height: number) {
  if (name === 'ListaPiccolo') return { light: <ListaPiccolo data={data} p={LIGHT} />, dark: <ListaPiccolo data={data} p={DARK} /> };
  return { light: <ListaGrande data={data} p={LIGHT} height={height} />, dark: <ListaGrande data={data} p={DARK} height={height} /> };
}
