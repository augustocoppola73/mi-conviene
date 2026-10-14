/**
 * #29: icona del prodotto, stile "confezione vera": la confezione (scatoletta, vasetto, bottiglia…) con il prodotto
 * disegnato sull'etichetta, oppure il prodotto così com'è (frutta, verdura, freschi), oppure un disegno fatto apposta.
 */
import { Image, Text, View } from 'react-native';

import { CONTAINER_ICONS, FOOD_ICONS, SPECIAL_ICONS } from '../foodIcons.generated';
import { CONTAINERS } from '../foodShapes';
import { productIcon } from '../productEmoji';
import { useTheme } from '../theme';

const img = (src: number, size: number, style?: object) => (
  <Image source={src} style={[{ width: size, height: size }, style]} resizeMode="contain" accessibilityIgnoresInvertColors />
);

function Glyph({ e, size }: { e: string; size: number }) {
  const src = FOOD_ICONS[e];
  return src ? img(src, size) : <Text style={{ fontSize: size * 0.82, lineHeight: size, textAlign: 'center', width: size }}>{e}</Text>;
}

export function ProductIcon({ name, productId, categoryEmoji, size = 36 }: {
  name: string; productId?: string | null; categoryEmoji?: string | null; size?: number;
}) {
  const { colors } = useTheme();
  const spec = productIcon(name, productId, categoryEmoji);
  const box = { width: size, height: size };
  if (spec.special && SPECIAL_ICONS[spec.special]) return <View style={box} accessible={false}>{img(SPECIAL_ICONS[spec.special], size)}</View>;
  if (spec.container && spec.base) {
    const k = `${spec.container.kind}:${spec.container.color}`;
    const src = CONTAINER_ICONS[k] ?? CONTAINER_ICONS[`${spec.container.kind}:${CONTAINERS[spec.container.kind].color}`];
    const g = CONTAINERS[spec.container.kind];
    const u = size / 96;
    if (src) {
      return (
        <View style={box} accessible={false}>
          {img(src, size)}
          <View style={{ position: 'absolute', left: g.x * u, top: g.y * u }}><Glyph e={spec.base} size={g.s * u} /></View>
        </View>
      );
    }
  }
  const b = Math.round(size * 0.46);
  return (
    <View style={box} accessible={false}>
      <Glyph e={spec.base ?? '🛒'} size={size} />
      {spec.letter && (
        <View style={{ position: 'absolute', right: -2, bottom: -2, width: b, height: b, borderRadius: b / 2, alignItems: 'center',
          justifyContent: 'center', backgroundColor: colors.primary, borderWidth: 1, borderColor: colors.surface }}>
          <Text style={{ color: colors.primaryText, fontSize: b * 0.6, fontWeight: '800', lineHeight: b * 0.75 }}>{spec.letter}</Text>
        </View>
      )}
    </View>
  );
}
