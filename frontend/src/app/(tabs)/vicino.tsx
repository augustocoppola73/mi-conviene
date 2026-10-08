/** Vicino a me: supermercati e distributori intorno a dove sei, su una mappa, con il raggio regolabile e "Portami lì". */
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api, NearMe, Parking } from '@/api';
import { ParkingLine } from '@/components/ParkingLine';
import { BrandLogo, CHAIN_DOMAINS, fuelDomain } from '@/components/BrandLogo';
import { Slider } from '@/components/Slider';
import { MapPoint, TileMap } from '@/components/TileMap';
import { Card, Chip, Icon, PrimaryButton, StoreDot } from '@/components/ui';
import { euro, km } from '@/format';
import { IS_CLOUD } from '@/cloud/client';
import { C } from '@/engine/data';
import { haversineKm, pyRound } from '@/engine/util';
import { getCurrentPosition, metersBetween, watchPosition } from '@/location';
import { openNavigation } from '@/navigate';
import { useStore } from '@/store';
import { makeStyles, radius, spacing, storeColors, useTheme } from '@/theme';

const FUEL_COLOR = '#5B6470';
const OTHER_COLOR = '#9AA096'; // insegne senza prezzi (Ekom, Despar…)
// scatti del cursore del raggio (km)
// (la versione locale, senza OpenStreetMap in diretta, resta entro i 6 km)
const STEPS = IS_CLOUD ? [0.5, 1, 2, 3, 5, 10, 15, 20] : [0.5, 1, 2, 3, 5];
const ZONE_SMALL_KM = 6; // fino a qui la zona solita, già in cache; oltre si scarica la zona da 20 km
const MAX_LIST = 40; // oltre, "Mostra altri"
const MAX_MAP = 150; // punti sulla mappa (i più vicini)

interface Place { id: string; kind: 'store' | 'fuel'; chain?: string; name: string; address: string | null; lat: number; lon: number;
  distance_km: number; price?: number | null; parking?: Parking | null; logo?: string | null }

// dominio del sito di un'insegna "altro" (dal tag website di OpenStreetMap), per il logo
const siteDomain = (url?: string | null) => { const m = url?.match(/^https?:\/\/(?:www\.)?([^/:]+)/i); return m ? m[1] : null; };

export default function VicinoScreen() {
  const s = useStyles();
  const { colors } = useTheme();
  const { prefs, setPrefs } = useStore();
  const [pos, setPos] = useState<{ lat: number; lon: number; live: boolean } | null>(null);
  const [locating, setLocating] = useState(false);
  const [posError, setPosError] = useState<string | null>(null);
  const [data, setData] = useState<NearMe | null>(null);
  const [anchor, setAnchor] = useState<{ lat: number; lon: number } | null>(null); // dove ho scaricato i dati
  const [loadingZone, setLoadingZone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stepIdx, setStepIdx] = useState(2);
  const radiusKm = STEPS[stepIdx];
  const [listAll, setListAll] = useState(false);
  const [followAt, setFollowAt] = useState<string | null>(null); // ultimo aggiornamento automatico
  const [show, setShow] = useState({ store: true, fuel: true });
  const [selected, setSelectedId] = useState<string | null>(null);
  const scroll = useRef<ScrollView>(null);
  const [mapTouch, setMapTouch] = useState(false); // dito sulla mappa: la pagina non scorre
  // scelto dalla lista: torno su, dove ci sono la mappa e "Portami lì"
  const setSelected = (id: string | null) => { setSelectedId(id); if (id) scroll.current?.scrollTo({ y: 0, animated: true }); };

  const loading = useRef(false);
  const asked = useRef(''); // zona più grande già chiesta per questo punto (se non arriva, non insisto)
  const load = useCallback(async (p: { lat: number; lon: number }, rKm: number) => {
    if (loading.current) return;
    loading.current = true; setLoadingZone(true); setError(null);
    try {
      const next = await api.nearMe(p.lat, p.lon, prefs.fuelType, rKm);
      // OpenStreetMap non ha dato i parcheggi questa volta: tengo quelli che sapevo già per gli stessi negozi
      setData((prev) => {
        if (!next.parking_missing || !prev) return next;
        const known = new Map(prev.stores.filter((x) => x.parking).map((x) => [x.osm_id, x.parking]));
        return { ...next, stores: next.stores.map((x) => (x.parking || !known.has(x.osm_id) ? x : { ...x, parking: known.get(x.osm_id) })) };
      });
      setAnchor({ lat: p.lat, lon: p.lon });
    }
    catch (e) { setError((e as Error).message); }
    finally { loading.current = false; setLoadingZone(false); }
  }, [prefs.fuelType]);

  const locate = useCallback(async () => {
    setLocating(true); setPosError(null);
    try {
      const g = await getCurrentPosition();
      const p = { lat: g.lat, lon: g.lon, live: true };
      setPos(p); load(p, radiusKm);
    } catch (e) {
      // senza GPS: la posizione salvata nel Profilo
      if (prefs.location) {
        const p = { lat: prefs.location.lat, lon: prefs.location.lon, live: false };
        setPos(p); load(p, radiusKm);
      }
      setPosError((e as Error).message);
    } finally { setLocating(false); }
  }, [load, prefs.location, radiusKm]);

  useFocusEffect(useCallback(() => { if (!pos) locate(); }, [pos, locate]));

  // la posizione ti segue mentre sei in Vicino a me (e l'app è aperta): ~10 s, solo se ti sei spostato
  const live = !!pos?.live;
  const prefsRef = useRef(prefs); prefsRef.current = prefs;
  useFocusEffect(useCallback(() => {
    if (!live) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    const start = () => {
      if (stop) return;
      watchPosition((g) => {
        setPos((cur) => (cur && metersBetween(cur, g) < 20 ? cur : { lat: g.lat, lon: g.lon, live: true }));
        setFollowAt(g.updatedAt);
        // anche il resto dell'app (Lista, Profilo) usa la posizione nuova
        const pr = prefsRef.current;
        if (pr.locationMode === 'gps' && (!pr.location || metersBetween(pr.location, g) >= 100)) setPrefs({ location: g });
      }).then((fn) => { if (cancelled) fn(); else stop = fn; });
    };
    const halt = () => { stop?.(); stop = null; };
    start();
    const sub = AppState.addEventListener('change', (st) => (st === 'active' ? start() : halt()));
    return () => { cancelled = true; halt(); sub.remove(); };
  }, [live, setPrefs]));

  // OpenStreetMap non ha dato i parcheggi (server occupato): riprovo dopo un po', al massimo 3 volte
  const parkTries = useRef(0);
  useEffect(() => {
    if (!data?.parking_missing || !anchor || parkTries.current >= 3) return;
    const t = setTimeout(() => { parkTries.current += 1; load(anchor, radiusKm); }, 15000);
    return () => clearTimeout(t);
  }, [data, anchor, radiusKm, load]);
  useEffect(() => { if (data && !data.parking_missing) parkTries.current = 0; }, [data]);

  // dati da riscaricare? se il raggio esce dalla zona scaricata, o ti sei spostato troppo dal punto di partenza
  useEffect(() => {
    if (!pos || !data || !anchor) return;
    const zone = data.radius_km;
    const need = radiusKm > ZONE_SMALL_KM ? Math.max(zone, 20) : zone;
    const moved = haversineKm(anchor.lat, anchor.lon, pos.lat, pos.lon) * C.road_factor;
    // un po' di tolleranza sul bordo: in auto non riscarico la zona a ogni aggiornamento
    const tol = zone > ZONE_SMALL_KM ? 3 : 1;
    const key = `${need}@${anchor.lat},${anchor.lon}`;
    if (need > zone && asked.current !== key) { asked.current = key; load(pos, radiusKm); return; }
    if (moved > tol && moved + radiusKm > zone + tol) load(pos, radiusKm);
  }, [pos, radiusKm, data, anchor, load]);

  const places: Place[] = useMemo(() => {
    if (!data || !pos) return [];
    // distanze sempre da dove sei adesso (i dati possono essere stati scaricati un po' più in là)
    const dist = (la: number, lo: number) => pyRound(Math.max(haversineKm(pos.lat, pos.lon, la, lo) * C.road_factor, 0.1), 1);
    const st: Place[] = show.store ? data.stores.filter((x) => !prefs.nearOnlyPriced || x.chain !== 'altro').map((x) => ({ id: `s-${x.osm_id}`, kind: 'store' as const, chain: x.chain, name: x.name,
      address: x.address, lat: x.lat, lon: x.lon, distance_km: dist(x.lat, x.lon), parking: x.parking,
      logo: CHAIN_DOMAINS[x.chain] ?? siteDomain(x.website) })) : [];
    const fu: Place[] = show.fuel ? data.stations.map((x) => ({ id: `f-${x.id}`, kind: 'fuel' as const, name: x.name || x.brand,
      address: [x.address, x.city].filter(Boolean).join(', ') || null, lat: x.lat, lon: x.lon, distance_km: dist(x.lat, x.lon), price: x.price, logo: fuelDomain(x.brand) })) : [];
    return [...st, ...fu].filter((p) => p.distance_km <= radiusKm).sort((a, b) => a.distance_km - b.distance_km);
  }, [data, show, radiusKm, pos, prefs.nearOnlyPriced]);

  const points: MapPoint[] = places.slice(0, MAX_MAP).map((p) => ({ id: p.id, lat: p.lat, lon: p.lon, kind: p.kind,
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
              <View style={s.row}>
                <Text style={s.label}>Raggio: {km(radiusKm)}</Text>
                {loadingZone && data && <ActivityIndicator size="small" color={colors.primary} />}
              </View>
              <Pressable onPress={locate} hitSlop={8} style={s.row}>
                {locating ? <ActivityIndicator size="small" color={colors.primary} /> : <Icon name="locate-outline" size={18} color={colors.primary} />}
                <Text style={s.link}>Aggiorna</Text>
              </Pressable>
            </View>
            <Slider value={stepIdx} min={0} max={STEPS.length - 1} step={1} onChange={(v) => { setStepIdx(v); setListAll(false); }} />
            <View style={[s.row, { justifyContent: 'space-between' }]}>
              {STEPS.map((k) => <Text key={k} style={[s.tick, k === radiusKm && { color: colors.primary, fontWeight: '700' }]}>{k < 1 ? '½' : k}</Text>)}
            </View>
            {pos.live && (
              <Text style={[s.muted, { marginTop: 4 }]}>
                📍 La posizione ti segue mentre ti sposti{followAt ? ` · aggiornata alle ${new Date(followAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : ''}
              </Text>
            )}
            {loadingZone && data && <Text style={[s.muted, { marginTop: 4 }]}>Cerco i negozi nel nuovo raggio…</Text>}
            {data?.parking_missing && !loadingZone && (
              <Text style={[s.muted, { marginTop: 4 }]}>🅿️ Info sui parcheggi non disponibili ora (OpenStreetMap occupato): riprovo tra poco.</Text>
            )}

            <View style={[s.row, { marginTop: spacing.sm, flexWrap: 'wrap' }]}>
              <Chip label={`Supermercati${data ? ` (${nStores})` : ''}`} icon="cart-outline" selected={show.store}
                onPress={() => setShow({ ...show, store: !show.store })} />
              <Chip label={`Distributori${data ? ` (${nFuel})` : ''}`} icon="speedometer-outline" selected={show.fuel}
                onPress={() => setShow({ ...show, fuel: !show.fuel })} />
              <Chip label="Solo con prezzi" icon="pricetag-outline" selected={prefs.nearOnlyPriced}
                onPress={() => setPrefs({ nearOnlyPriced: !prefs.nearOnlyPriced })} />
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
                {places.filter((p) => p.id !== selected).slice(0, listAll ? undefined : MAX_LIST).map((p) => (
                  <Pressable key={p.id} onPress={() => setSelected(p.id)}>
                    <Card style={s.placeCard}>
                      <View style={{ flex: 1 }}><PlaceRow p={p} fuelLabel={data.fuel} /></View>
                      <Pressable onPress={() => openNavigation(p.lat, p.lon, p.name)} style={s.navBtn} accessibilityLabel={`Portami a ${p.name}`}>
                        <Icon name="navigate" size={20} color={colors.primaryText} />
                      </Pressable>
                    </Card>
                  </Pressable>
                ))}
                {!listAll && places.length > MAX_LIST + (sel ? 1 : 0) && (
                  <Pressable onPress={() => setListAll(true)} style={{ alignSelf: 'center', padding: spacing.sm }}>
                    <Text style={s.link}>Mostra altri {places.length - MAX_LIST - (sel ? 1 : 0)}</Text>
                  </Pressable>
                )}
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
  tick: { fontSize: 11, color: c.textSecondary, width: 22, textAlign: 'center' },
  price: { fontSize: 13, color: c.text, fontWeight: '600' },
  placeCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  navBtn: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
  mapOverlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.55)', borderRadius: 14 },
}));
