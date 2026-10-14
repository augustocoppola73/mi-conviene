/** #29: icona disegnata del prodotto (uguale su tutti i telefoni) con il piccolo segno che distingue i prodotti simili. */
import { Image, Text, View } from 'react-native';

import { FOOD_ICONS } from '../foodIcons.generated';
import { productIcon } from '../productEmoji';
import { useTheme } from '../theme';

function Glyph({ e, size }: { e: string; size: number }) {
  const src = FOOD_ICONS[e];
  if (src) return <Image source={src} style={{ width: size, height: size }} resizeMode="contain" accessibilityIgnoresInvertColors />;
  return <Text style={{ fontSize: size * 0.82, lineHeight: size, textAlign: 'center', width: size }}>{e}</Text>;
}

export function ProductIcon({ name, productId, categoryEmoji, size = 36 }: {
  name: string; productId?: string | null; categoryEmoji?: string | null; size?: number;
}) {
  const { colors } = useTheme();
  const spec = productIcon(name, productId, categoryEmoji);
  const b = Math.round(size * 0.48);
  return (
    <View style={{ width: size + b * 0.3, height: size + b * 0.15, alignItems: 'center', justifyContent: 'center' }} accessible={false}>
      <Glyph e={spec.base} size={size} />
      {(spec.badge || spec.letter) && (
        <View style={{ position: 'absolute', right: 0, bottom: 0, width: b, height: b, borderRadius: b / 2, alignItems: 'center',
          justifyContent: 'center', backgroundColor: spec.letter ? colors.primary : colors.surface, borderWidth: 1, borderColor: colors.border }}>
          {spec.letter
            ? <Text style={{ color: colors.primaryText, fontSize: b * 0.6, fontWeight: '800', lineHeight: b * 0.75 }}>{spec.letter}</Text>
            : <Glyph e={spec.badge!} size={Math.round(b * 0.78)} />}
        </View>
      )}
    </View>
  );
}
