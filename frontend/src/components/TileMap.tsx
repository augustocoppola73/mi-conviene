/**
 * Mappa semplice disegnata in JavaScript (tessere di OpenStreetMap + segnaposto), senza moduli nativi:
 * così arriva con gli aggiornamenti automatici, senza un APK nuovo.
 * L'area visibile si adatta al raggio: il cerchio del raggio occupa quasi tutta la larghezza.
 */
import { useState } from 'react';
import { Image, Platform, Pressable, Text, View } from 'react-native';

import { useTheme } from '../theme';

export interface MapPoint { id: string; lat: number; lon: number; color: string; kind: 'store' | 'fuel'; label?: string }

const TILE = 256;
const MPP0 = 156543.03392; // metri per pixel a zoom 0 all'equatore
const TILE_URL = (z: number, x: number, y: number) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
// OpenStreetMap chiede di farsi riconoscere; il browser lo fa da sé
const TILE_HEADERS = Platform.OS === 'web' ? undefined : { 'User-Agent': 'MiConviene/1.0 (+https://mi-conviene.augustocoppola.workers.dev)' };

const worldX = (lon: number, z: number) => ((lon + 180) / 360) * TILE * 2 ** z;
const worldY = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * TILE * 2 ** z;
};

export function TileMap({ center, radiusKm, points, selectedId, onSelect, height = 320 }: {
  center: { lat: number; lon: number }; radiusKm: number; points: MapPoint[];
  selectedId?: string | null; onSelect?: (id: string | null) => void; height?: number;
}) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const W = width, H = height;

  let body = null;
  if (W > 0) {
    // zoom (anche frazionario) perché il diametro del raggio + un po' di margine stia nel lato corto
    const side = Math.min(W, H);
    const cos = Math.cos((center.lat * Math.PI) / 180);
    const zf = Math.max(3, Math.min(18, Math.log2((MPP0 * cos * side) / (radiusKm * 1000 * 2 * 1.15))));
    const z = Math.floor(zf);
    const scale = 2 ** (zf - z);
    const T = TILE * scale;
    const cx = worldX(center.lon, z), cy = worldY(center.lat, z);
    const n = 2 ** z;
    const x0 = Math.floor((cx - W / 2 / scale) / TILE), x1 = Math.floor((cx + W / 2 / scale) / TILE);
    const y0 = Math.max(0, Math.floor((cy - H / 2 / scale) / TILE)), y1 = Math.min(n - 1, Math.floor((cy + H / 2 / scale) / TILE));
    const tiles = [];
    for (let tx = x0; tx <= x1; tx++) {
      for (let ty = y0; ty <= y1; ty++) {
        const left = Math.floor(W / 2 + (tx * TILE - cx) * scale), top = Math.floor(H / 2 + (ty * TILE - cy) * scale);
        const wx = ((tx % n) + n) % n;
        tiles.push(
          <Image key={`${z}/${tx}/${ty}`} source={{ uri: TILE_URL(z, wx, ty), headers: TILE_HEADERS }}
            style={{ position: 'absolute', left, top, width: Math.ceil(T) + 1, height: Math.ceil(T) + 1 }} />,
        );
      }
    }
    // posizione sullo schermo di un punto, con lo zoom frazionario
    const fx = worldX(center.lon, zf), fy = worldY(center.lat, zf);
    const toScreen = (lat: number, lon: number) => ({ x: W / 2 + worldX(lon, zf) - fx, y: H / 2 + worldY(lat, zf) - fy });
    const rPx = (radiusKm * 1000) / ((MPP0 * cos) / 2 ** zf);

    const visible = points.map((p) => ({ ...p, ...toScreen(p.lat, p.lon) }));
    const selected = visible.find((p) => p.id === selectedId);
    const D = visible.length > 25 ? 16 : 22; // con tanti negozi segnaposto più piccoli
    body = (
      <>
        {tiles}
        <View pointerEvents="none" style={{ position: 'absolute', left: W / 2 - rPx, top: H / 2 - rPx, width: rPx * 2, height: rPx * 2,
          borderRadius: rPx, borderWidth: 2, borderColor: colors.primary, backgroundColor: 'rgba(79,107,74,0.08)' }} />
        {/* collegamenti dalla tua posizione a ogni negozio trovato */}
        {visible.filter((p) => visible.length <= 15 || p.id === selectedId).map((p) => <Line key={`l-${p.id}`} x1={W / 2} y1={H / 2} x2={p.x} y2={p.y}
          color={p.id === selectedId ? colors.primary : p.color} strong={p.id === selectedId} />)}
        {visible.map((p) => (
          <Pressable key={p.id} onPress={() => onSelect?.(p.id === selectedId ? null : p.id)} hitSlop={8}
            style={{ position: 'absolute', left: p.x - D / 2, top: p.y - D / 2, width: D, height: D, borderRadius: p.kind === 'fuel' ? 5 : D / 2,
              backgroundColor: p.color, borderWidth: p.id === selectedId ? 3 : 2, borderColor: p.id === selectedId ? colors.text : '#fff',
              alignItems: 'center', justifyContent: 'center' }}>
            {p.kind === 'fuel' && <Text style={{ color: '#fff', fontSize: D / 2, fontWeight: '800' }}>⛽</Text>}
          </Pressable>
        ))}
        {selected?.label && (
          <View pointerEvents="none" style={{ position: 'absolute', left: Math.min(Math.max(selected.x - 70, 4), W - 144), top: Math.max(selected.y - 40, 4),
            width: 140, backgroundColor: colors.surface, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 3, borderWidth: 1, borderColor: colors.border }}>
            <Text numberOfLines={1} style={{ color: colors.text, fontSize: 12, fontWeight: '700', textAlign: 'center' }}>{selected.label}</Text>
          </View>
        )}
        {/* tu sei qui */}
        <View pointerEvents="none" style={{ position: 'absolute', left: W / 2 - 18, top: H / 2 - 18, width: 36, height: 36, borderRadius: 18,
          backgroundColor: 'rgba(30,111,217,0.18)' }} />
        <View pointerEvents="none" style={{ position: 'absolute', left: W / 2 - 9, top: H / 2 - 9, width: 18, height: 18, borderRadius: 9,
          backgroundColor: '#1E6FD9', borderWidth: 3, borderColor: '#fff' }} />
        <Text style={{ position: 'absolute', right: 4, bottom: 2, fontSize: 10, color: '#333', backgroundColor: 'rgba(255,255,255,0.75)', paddingHorizontal: 3 }}>
          © OpenStreetMap
        </Text>
      </>
    );
  }
  return (
    <View onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
      style={{ height: H, overflow: 'hidden', borderRadius: 14, backgroundColor: '#E8E6E1' }}>
      {body}
    </View>
  );
}

function Line({ x1, y1, x2, y2, color, strong }: { x1: number; y1: number; x2: number; y2: number; color: string; strong?: boolean }) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len < 12) return null;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const h = strong ? 3 : 2;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: (x1 + x2) / 2 - len / 2, top: (y1 + y2) / 2 - h / 2, width: len, height: h,
      backgroundColor: color, opacity: strong ? 0.95 : 0.45, borderRadius: h, transform: [{ rotate: `${angle}rad` }] }} />
  );
}
