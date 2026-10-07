/**
 * Mappa disegnata in JavaScript (tessere di OpenStreetMap + segnaposto), senza moduli nativi:
 * così arriva con gli aggiornamenti automatici, senza un APK nuovo.
 * Si sposta trascinando con un dito, si zooma con due dita (o con + e −); "centra" torna su di te.
 * Quando cambia il raggio la vista si ricentra e si adatta al raggio.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Image } from 'expo-image';
import { GestureResponderEvent, PanResponder, Platform, Pressable, Text, View } from 'react-native';

import { useTheme } from '../theme';
import { Icon } from './ui';

export interface MapPoint { id: string; lat: number; lon: number; color: string; kind: 'store' | 'fuel'; label?: string }

const TILE = 256;
const MPP0 = 156543.03392; // metri per pixel a zoom 0 all'equatore
const MIN_Z = 4, MAX_Z = 19;
// tessere OpenStreetMap: chiedono un User-Agent che identifichi l'app. Il componente Image di React Native su Android
// non lo manda (e OSM risponde "Access blocked"): uso expo-image, che lo passa davvero e tiene le tessere in cache.
const TILE_URL = (z: number, x: number, y: number) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
const TILE_HEADERS = Platform.OS === 'web' ? undefined : { 'User-Agent': 'MiConviene/1.0 (+https://mi-conviene.augustocoppola.workers.dev)' };

const worldX = (lon: number, z: number) => ((lon + 180) / 360) * TILE * 2 ** z;
const worldY = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * TILE * 2 ** z;
};
const lonOf = (x: number, z: number) => (x / (TILE * 2 ** z)) * 360 - 180;
const latOf = (y: number, z: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / (TILE * 2 ** z)))) * 180) / Math.PI;
const clampZ = (z: number) => Math.max(MIN_Z, Math.min(MAX_Z, z));

interface View3 { lat: number; lon: number; z: number }

export function TileMap({ center, radiusKm, points, selectedId, onSelect, onInteraction, height = 320 }: {
  center: { lat: number; lon: number }; radiusKm: number; points: MapPoint[];
  selectedId?: string | null; onSelect?: (id: string | null) => void;
  /** true mentre il dito è sulla mappa: chi la contiene blocca lo scorrimento della pagina */
  onInteraction?: (active: boolean) => void;
  height?: number;
}) {
  const { colors } = useTheme();
  const [W, setW] = useState(0);
  const H = height;

  // zoom che fa stare il raggio (+ margine) nel lato corto
  const fitZ = (w: number) => {
    const cos = Math.cos((center.lat * Math.PI) / 180);
    return clampZ(Math.log2((MPP0 * cos * Math.min(w || 360, H)) / (radiusKm * 1000 * 2 * 1.15)));
  };
  const [view, setView] = useState<View3>({ lat: center.lat, lon: center.lon, z: fitZ(W) });
  // nuovo raggio o nuova posizione: ricentro e adatto lo zoom
  useEffect(() => { setView({ lat: center.lat, lon: center.lon, z: fitZ(W) }); }, [center.lat, center.lon, radiusKm, W]); // eslint-disable-line react-hooks/exhaustive-deps

  // gesti: un dito sposta, due dita zoomano (e spostano)
  const g = useRef({ start: view, d0: 0, mx0: 0, my0: 0, view });
  g.current.view = view;
  const touches = (e: GestureResponderEvent) => e.nativeEvent.touches ?? [];
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (e, s) => touches(e).length >= 2 || Math.abs(s.dx) + Math.abs(s.dy) > 4,
    onMoveShouldSetPanResponderCapture: (e, s) => touches(e).length >= 2 || Math.abs(s.dx) + Math.abs(s.dy) > 4,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => { g.current.start = g.current.view; g.current.d0 = 0; },
    onPanResponderMove: (e, s) => {
      const t = touches(e);
      const st = g.current.start;
      if (t.length >= 2) {
        const d = Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY);
        const mx = (t[0].pageX + t[1].pageX) / 2, my = (t[0].pageY + t[1].pageY) / 2;
        if (!g.current.d0) { g.current.d0 = d; g.current.mx0 = mx; g.current.my0 = my; g.current.start = g.current.view; return; }
        const s0 = g.current.start;
        const z = clampZ(s0.z + Math.log2(d / g.current.d0));
        const x = worldX(s0.lon, z) - (mx - g.current.mx0), y = worldY(s0.lat, z) - (my - g.current.my0);
        setView({ lat: latOf(y, z), lon: lonOf(x, z), z });
        return;
      }
      if (g.current.d0) return; // finito il pizzico con un dito ancora giù: aspetto il rilascio
      const x = worldX(st.lon, st.z) - s.dx, y = worldY(st.lat, st.z) - s.dy;
      setView({ lat: latOf(y, st.z), lon: lonOf(x, st.z), z: st.z });
    },
  }), []);

  const zoomBy = (dz: number) => setView((v) => ({ ...v, z: clampZ(v.z + dz) }));
  const recenter = () => setView({ lat: center.lat, lon: center.lon, z: fitZ(W) });

  let body = null;
  if (W > 0) {
    const zf = view.z;
    const z = Math.min(MAX_Z, Math.floor(zf));
    const scale = 2 ** (zf - z);
    const T = TILE * scale;
    const cx = worldX(view.lon, z), cy = worldY(view.lat, z);
    const n = 2 ** z;
    const x0 = Math.floor((cx - W / 2 / scale) / TILE), x1 = Math.floor((cx + W / 2 / scale) / TILE);
    const y0 = Math.max(0, Math.floor((cy - H / 2 / scale) / TILE)), y1 = Math.min(n - 1, Math.floor((cy + H / 2 / scale) / TILE));
    const tiles = [];
    for (let tx = x0; tx <= x1; tx++) {
      for (let ty = y0; ty <= y1; ty++) {
        const left = Math.floor(W / 2 + (tx * TILE - cx) * scale), top = Math.floor(H / 2 + (ty * TILE - cy) * scale);
        const wx = ((tx % n) + n) % n;
        tiles.push(
          <Image key={`${z}/${tx}/${ty}`} source={{ uri: TILE_URL(z, wx, ty), headers: TILE_HEADERS }} cachePolicy="disk" transition={0}
            style={{ position: 'absolute', left, top, width: Math.ceil(T) + 1, height: Math.ceil(T) + 1 }} />,
        );
      }
    }
    const fx = worldX(view.lon, zf), fy = worldY(view.lat, zf);
    const toScreen = (lat: number, lon: number) => ({ x: W / 2 + worldX(lon, zf) - fx, y: H / 2 + worldY(lat, zf) - fy });
    const me = toScreen(center.lat, center.lon);
    const cos = Math.cos((center.lat * Math.PI) / 180);
    const rPx = (radiusKm * 1000) / ((MPP0 * cos) / 2 ** zf);

    const visible = points.map((p) => ({ ...p, ...toScreen(p.lat, p.lon) }));
    const onScreen = visible.filter((p) => p.x > -30 && p.x < W + 30 && p.y > -30 && p.y < H + 30);
    const selected = visible.find((p) => p.id === selectedId);
    const D = onScreen.length > 25 ? 16 : 22; // con tanti negozi segnaposto più piccoli
    body = (
      <>
        {tiles}
        <View pointerEvents="none" style={{ position: 'absolute', left: me.x - rPx, top: me.y - rPx, width: rPx * 2, height: rPx * 2,
          borderRadius: rPx, borderWidth: 2, borderColor: colors.primary, backgroundColor: 'rgba(79,107,74,0.08)' }} />
        {/* collegamenti dalla tua posizione ai negozi trovati (con pochi negozi tutti, altrimenti solo quello scelto) */}
        {visible.filter((p) => visible.length <= 15 || p.id === selectedId).map((p) => <Line key={`l-${p.id}`} x1={me.x} y1={me.y} x2={p.x} y2={p.y}
          color={p.id === selectedId ? colors.primary : p.color} strong={p.id === selectedId} />)}
        {onScreen.map((p) => (
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
        <View pointerEvents="none" style={{ position: 'absolute', left: me.x - 18, top: me.y - 18, width: 36, height: 36, borderRadius: 18,
          backgroundColor: 'rgba(30,111,217,0.18)' }} />
        <View pointerEvents="none" style={{ position: 'absolute', left: me.x - 9, top: me.y - 9, width: 18, height: 18, borderRadius: 9,
          backgroundColor: '#1E6FD9', borderWidth: 3, borderColor: '#fff' }} />
        {/* comandi */}
        <View style={{ position: 'absolute', right: 8, top: 8, gap: 6 }}>
          <MapBtn icon="add" onPress={() => zoomBy(1)} label="Avvicina" />
          <MapBtn icon="remove" onPress={() => zoomBy(-1)} label="Allontana" />
          <MapBtn icon="locate" onPress={recenter} label="Centra su di me" />
        </View>
        <Text style={{ position: 'absolute', right: 4, bottom: 2, fontSize: 10, color: '#333', backgroundColor: 'rgba(255,255,255,0.75)', paddingHorizontal: 3 }}>
          © OpenStreetMap
        </Text>
      </>
    );
  }
  return (
    <View onLayout={(e) => setW(Math.round(e.nativeEvent.layout.width))} {...pan.panHandlers}
      onTouchStart={() => onInteraction?.(true)} onTouchEnd={() => onInteraction?.(false)} onTouchCancel={() => onInteraction?.(false)}
      style={{ height: H, overflow: 'hidden', borderRadius: 14, backgroundColor: '#E8E6E1' }}>
      {body}
    </View>
  );
}

function MapBtn({ icon, onPress, label }: { icon: 'add' | 'remove' | 'locate'; onPress: () => void; label: string }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityLabel={label} hitSlop={4}
      style={({ pressed }) => ({ width: 38, height: 38, borderRadius: 10, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center',
        borderWidth: 1, borderColor: colors.border, opacity: pressed ? 0.7 : 1 })}>
      <Icon name={icon} size={20} color={colors.text} />
    </Pressable>
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
