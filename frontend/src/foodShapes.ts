/** #29: le confezioni disegnate (scatoletta, vasetto…): colori e dove sta l'etichetta col prodotto (in 96esimi). */
export type ContainerKind = 'can' | 'jar' | 'bottle' | 'carton' | 'box' | 'frozen' | 'spray' | 'tray' | 'bag' | 'cup' | 'tube' | 'pack';

export const COLORS: Record<string, string> = {
  r: '#D35454', o: '#F0932B', y: '#F6C343', g: '#4CAF50', t: '#1ABC9C', b: '#3A7BD5', n: '#2C3E8F', p: '#8E44AD',
  k: '#E84393', w: '#A0522D', s: '#95A5A6', c: '#E9D8B4',
};

/** etichetta: x, y, lato dell'immagine del prodotto; colore se il nome non lo dice */
export const CONTAINERS: Record<ContainerKind, { x: number; y: number; s: number; color: string }> = {
  can: { x: 34, y: 41, s: 28, color: 'b' },
  jar: { x: 33, y: 44, s: 30, color: 'y' },
  bottle: { x: 35, y: 51, s: 26, color: 'g' },
  carton: { x: 33, y: 42, s: 30, color: 'b' },
  box: { x: 30, y: 39, s: 36, color: 'o' },
  frozen: { x: 33, y: 39, s: 30, color: 'b' },
  spray: { x: 33, y: 47, s: 24, color: 't' },
  tray: { x: 22, y: 10, s: 52, color: 'r' },
  bag: { x: 32, y: 44, s: 32, color: 'c' },
  cup: { x: 33, y: 43, s: 30, color: 'b' },
  tube: { x: 36, y: 30, s: 24, color: 'r' },
  pack: { x: 31, y: 39, s: 34, color: 'y' },
};
