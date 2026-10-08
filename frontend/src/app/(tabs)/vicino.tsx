/** Vicino a me: supermercati e distributori intorno a dove sei, su una mappa, con il raggio regolabile e "Portami lì". */
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api, NearMe, Parking } from '@/api';
import { ParkingLine } from '@/components/ParkingLine';
import { BrandLogo, CHAIN_DOMAINS, fuelDomain } from '@/components/BrandLogo';
import { Slider } from '@/components/Slider';
import { MapPoint, TileMap } from '@/components/TileMap';
import { Card, Chip, Icon, PrimaryButton, StoreDot } from '@/components/ui';
import { euro, km } from '@/format';
import { getCurrentPosition } from '@/location';
import { openNavigation } from '@/navigate';
import { useStore } from '@/store';
import { makeStyles, radius, spacing, storeColors, useTheme } from '@/theme';

const FUEL_COLOR = '#5B6470';
const OTHER_COLOR = '#9AA096'; // insegne senza prezzi (Ekom, Despar…)

interface Place { id: string; kind: 'store' | 'fuel'; chain?: string; name: string; address: string | null; lat: number; lon: number;
  distance_km: number; price?: number | null; parking?: Parking | null; logo?: string | null }

// dominio del sito di un'insegna "altro" (dal tag website di OpenStreetMap), per il logo
const siteDomain = (url?: string | null) => { const m = url?.match(/^https?:\/\/(?:www\.)?([^/:]+)/i); return m ? m[1] : null; };

export default function VicinoScreen() {
  const s = useStyles();
  const { colors } = useTheme();
  const { prefs } = useStore();
  const [pos, setPos] = useState<{ lat: number; lon: number; live: boolean } | null>(null);
  const [locating, setLocating] = useState(false);
  const [posError, setPosError] = useState<string | null>(null);
  const [data, setData] = useState<NearMe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [radiusKm, setRadiusKm] = useState(2);
  const [show, setShow] = useState({ store: true, fuel: true });
  const [selected, setSelectedId] = useState<string | null>(null);
  const scroll = useRef<ScrollView>(null);
  const [mapTouch, setMapTouch] = useState(false); // dito sulla mappa: la pagina non scorre
  // scelto dalla lista: torno su, dove ci sono la mappa e "Portami lì"
  const setSelected = (id: string | null) => { setSelectedId(id); if (id) scroll.current?.scrollTo({ y: 0, animated: true }); };

  const load = useCallback(async (p: { lat: number; lon: number }) => {
    setError(null);
    try { setData(await api.nearMe(p.lat, p.lon, prefs.fuelType)); } catch (e) { setError((e as Error).message); }
  }, [prefs.fuelType]);

  const locate = useCallback(async () => {
    setLocating(true); setPosError(null);
    try {
      const g = await getCurrentPosition();
      const p = { lat: g.lat, lon: g.lon, live: true };
      setPos(p); load(p);
    } catch (e) {
      // senza GPS: la posizione salvata nel Profilo
      if (prefs.location) {
        const p = { lat: prefs.location.lat, lon: prefs.location.lon, live: false };
        setPos(p); load(p);
      }
      setPosError((e as Error).message);
    } finally { setLocating(false); }
  }, [load, prefs.location]);

  useFocusEffect(useCallback(() => { if (!pos) locate(); }, [pos, locate]));

  const places: Place[] = useMemo(() => {
    if (!data) return [];
    const st: Place[] = show.store ? data.stores.map((x) => ({ id: `s-${x.osm_id}`, kind: 'store' as const, chain: x.chain, name: x.name,
      address: x.address, lat: x.lat, lon: x.lon, distance_km: x.distance_km, parking: x.parking,
      logo: CHAIN_DOMAINS[x.chain] ?? siteDomain(x.website) })) : [];
    const fu: Place[] = show.fuel ? data.stations.map((x) => ({ id: `f-${x.id}`, kind: 'fuel' as const, name: x.name || x.brand,
      address: [x.address, x.city].filter(Boolean).join(', ') || null, lat: x.lat, lon: x.lon, distance_km: x.distance_km, price: x.price, logo: fuelDomain(x.brand) })) : [];
    return [...st, ...fu].filter((p) => p.distance_km <= radiusKm).sort((a, b) => a.distance_km - b.distance_km);
  }, [data, show, radiusKm]);

  const points: MapPoint[] = places.map((p) => ({ id: p.id, lat: p.lat, lon: p.lon, kind: p.kind,
    color: p.kind === 'fuel' ? FUEL_COLOR : storeColors[p.chain!] ?? OTHER_COLOR, label: p.name, logo: p.logo }));
  const sel = places.find((p) => p.id === selected) ?? null;
  const nStores = places.filter((p) => p.kind === 'store').length, nFuel = places.length - nStores;

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <ScrollView ref={scroll} contentContainerStyle={s.content} scrollEnabled={!mapTouch}>
        <Text style={s.kicker}>Mi Conviene</Text>
        <Text style={s.title}>Vicino a me</Text>

        {!pos ? (
          <Card style={{ gap: spacing.sm, marginTop: spacing.md }}>
            {locating ? (
              <View style={s.row}><ActivityIndicator color={colors.primary} /><Text style={s.muted}>Cerco dove sei…</Text></View>
            ) : (
              <>
                <Text style={s.muted}>{posError ?? 'Mi serve la tua posizione per mostrarti i negozi intorno a te.'}</Text>
                <PrimaryButton label="Usa la mia posizione" icon="locate-outline" onPress={locate} />
              </>
            )}
          </Card>
        ) : (
          <>
            {!pos.live && <Text style={[s.muted, { marginTop: spacing.sm }]}>📍 Uso la posizione salvata nel Profilo (GPS non disponibile).</Text>}
            <View style={{ marginTop: spacing.md }}>
              <TileMap center={pos} radiusKm={radiusKm} points={points} selectedId={selected} onSelect={setSelected} onInteraction={setMapTouch} height={360} />
              {!data && !error && (
                <View style={s.mapOverlay}><ActivityIndicator color={colors.primary} /><Text style={s.muted}>Cerco i negozi…</Text></View>
              )}
            </View>

            <View style={[s.row, { justifyContent: 'space-between', marginTop: spacing.md }]}>
              <Text style={s.label}>Raggio: {km(radiusKm)}</Text>
              <Pressable onPress={locate} hitSlop={8} style={s.row}>
                {locating ? <ActivityIndicator size="small" color={colors.primary} /> : <Icon name="locate-outline" size={18} color={colors.primary} />}
                <Text style={s.link}>Aggiorna posizione</Text>
              </Pressable>
            </View>
            <Slider value={radiusKm} min={0.5} max={data?.radius_km ?? 6} step={0.5} onChange={(v) => { setRadiusKm(v); }} />

            <View style={[s.row, { marginTop: spacing.sm, flexWrap: 'wrap' }]}>
              <Chip label={`Supermercati${data ? ` (${nStores})` : ''}`} icon="cart-outline" selected={show.store}
                onPress={() => setShow({ ...show, store: !show.store })} />
              <Chip label={`Distributori${data ? ` (${nFuel})` : ''}`} icon="speedometer-outline" selected={show.fuel}
                onPress={() => setShow({ ...show, fuel: !show.fuel })} />
            </View>

            {error && <Text style={[s.muted, { color: colors.danger, marginTop: spacing.sm }]}>{error}</Text>}

            {sel && (
              <Card style={{ marginTop: spacing.md, gap: spacing.sm, borderColor: colors.primary, borderWidth: 2 }}>
                <PlaceRow p={sel} fuelLabel={data?.fuel} />
                <PrimaryButton label="Portami lì" icon="navigate" onPress={() => openNavigation(sel.lat, sel.lon, sel.name)} />
              </Card>
            )}

            {data && (
              <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
                {places.length === 0 && <Text style={s.muted}>Niente in questo raggio: allargalo con il cursore.</Text>}
                {places.filter((p) => p.id !== selected).map((p) => (
                  <Pressable key={p.id} onPress={() => setSelected(p.id)}>
                    <Card style={s.placeCard}>
                      <View style={{ flex: 1 }}><PlaceRow p={p} fuelLabel={data.fuel} /></View>
                      <Pressable onPress={() => openNavigation(p.lat, p.lon, p.name)} style={s.navBtn} accessibilityLabel={`Portami a ${p.name}`}>
                        <Icon name="navigate" size={20} color={colors.primaryText} />
                      </Pressable>
                    </Card>
                  </Pressable>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function PlaceRow({ p, fuelLabel }: { p: Place; fuelLabel?: string }) {
  const s = useStyles();
  return (
    <View style={{ gap: 2 }}>
      <View style={s.row}>
        {p.kind === 'fuel' && !p.logo ? <Text>⛽</Text>
          : <BrandLogo domain={p.logo} color={p.kind === 'fuel' ? FUEL_COLOR : storeColors[p.chain!] ?? OTHER_COLOR} size={20} />}
        <Text style={s.name} numberOfLines={1}>{p.name}</Text>
        <Text style={s.dist}>{km(p.distance_km)}</Text>
      </View>
      {!!p.address && <Text style={s.muted} numberOfLines={1}>{p.address}</Text>}
      {p.kind === 'fuel' && p.price != null && <Text style={s.price}>{fuelLabel}: {euro(p.price)}/l self</Text>}
      {p.kind === 'store' && <ParkingLine parking={p.parking} />}
      {p.kind === 'store' && p.chain === 'altro' && <Text style={s.muted}>Prezzi di questa insegna non ancora nell'app</Text>}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  screen: { flex: 1, backgroundColor: c.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl * 2, maxWidth: 720, width: '100%', alignSelf: 'center' },
  kicker: { fontSize: 13, color: c.textSecondary, fontWeight: '600' },
  title: { fontSize: 28, fontWeight: '700', color: c.text, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  muted: { fontSize: 13, color: c.textSecondary },
  label: { fontSize: 15, fontWeight: '700', color: c.text },
  link: { fontSize: 14, color: c.primary, fontWeight: '600' },
  name: { flex: 1, fontSize: 15, fontWeight: '600', color: c.text },
  dist: { fontSize: 13, color: c.textSecondary, fontWeight: '600' },
  price: { fontSize: 13, color: c.text, fontWeight: '600' },
  placeCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  navBtn: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
  mapOverlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.55)', borderRadius: 14 },
}));
