// One look for everybody: a pixel terminal. The only thing a person chooses is its colour, and the
// rest (backgrounds, borders, quiet text, the neon sign in the clubhouse) is worked out from it.
import { logoSvg } from './logo';

export type Theme = { accent: string };

export const DEFAULT_ACCENT = '#38ff5c';
export const SWATCHES = ['#38ff5c', '#ffb000', '#33d6ff', '#ff5fa8', '#b58cff', '#ff5a4d', '#e8e8e8'];

const HEX = /^#[0-9a-f]{6}$/i;
/** Colours arrive from saved profiles and old chat cards, so they are checked before use. */
export function sanitizeTheme(x: any): Theme | null {
  if (!x || typeof x !== 'object' || typeof x.accent !== 'string' || !HEX.test(x.accent)) return null;
  return { accent: x.accent.toLowerCase() };
}

const parts = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const mix = (a: string, b: string, t: number) => {
  const x = parts(a), y = parts(b);
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
};

export function applyTheme(theme: Theme | null) {
  let accent = sanitizeTheme(theme)?.accent ?? DEFAULT_ACCENT;
  const [r, g, b] = parts(accent);
  if (r * 0.299 + g * 0.587 + b * 0.114 < 90) accent = mix(accent, '#ffffff', 0.45);     // too dark to read on black
  const s = document.documentElement.style;
  s.setProperty('--accent', accent);
  s.setProperty('--accent-text', '#050805');
  s.setProperty('--bg', mix('#000000', accent, 0.035));
  s.setProperty('--panel', mix('#000000', accent, 0.07));
  s.setProperty('--raised', mix('#000000', accent, 0.13));
  s.setProperty('--text', mix(accent, '#ffffff', 0.3));
  s.setProperty('--muted', mix('#000000', accent, 0.6));
  const tile = mix('#0b0c0c', accent, 0.05);                                             // the logo's dark tile, tinted like the rest
  s.setProperty('--logo-tile', tile);
  s.colorScheme = 'dark';
  setTabIcon(accent, tile);
}

/** The browser tab's icon follows the colour too. (The desktop app's own icon is the fixed release one.) */
function setTabIcon(sun: string, tile: string) {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
  link.type = 'image/svg+xml';
  link.href = 'data:image/svg+xml,' + encodeURIComponent(logoSvg(sun, tile));
}
