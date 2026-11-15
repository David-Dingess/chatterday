// The Chatterday mark: a pixel sun whose bottom-left ray is a speech-bubble tail, with three typing dots.
// One grid, used three ways: the app draws it in each person's own accent colour (Logo in ui.tsx and the
// tab icon, from theme.ts), and scripts/make-logo.mjs draws the official files in the release colours.
// No imports, so the script can load this file directly.

/** 13x13, so column and row 6 are the exact middle. S = sun, D = typing dot (tile colour), R = ray, T = tail. */
export const LOGO_GRID = [
  '.............',
  '......R......',
  '..R.......R..',
  '....SSSSS....',
  '...SSSSSSS...',
  '...SSSSSSS...',
  '.R.SDSDSDS.R.',
  '...SSSSSSS...',
  '...SSSSSSS...',
  '...SSSSSS....',
  '..TT.....R...',
  '.T....R......',
  '.............',
];

/** The release colours: phosphor green on near-black. */
export const LOGO_SUN = '#38ff5c';
export const LOGO_TILE = '#0d1410';

/** Every cell of the mark, in grid units, with whether it is a dot (drawn in the tile colour). */
export const logoCells = () =>
  LOGO_GRID.flatMap((row, y) => [...row].flatMap((c, x) => (c === '.' ? [] : [{ x, y, dot: c === 'D' }])));

/** The mark as SVG markup: a rounded tile 13 cells wide. Colours may be CSS colours or var(...) references. */
export function logoSvg(sun = LOGO_SUN, tile = LOGO_TILE, size?: number) {
  const dim = size ? ` width="${size}" height="${size}"` : '';
  const sunCells = logoCells().filter((c) => !c.dot).map((c) => `M${c.x} ${c.y}h1v1h-1z`).join('');
  const dotCells = logoCells().filter((c) => c.dot).map((c) => `M${c.x} ${c.y}h1v1h-1z`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 13 13"${dim} shape-rendering="crispEdges">` +
    `<rect width="13" height="13" rx="2.85" fill="${tile}" shape-rendering="geometricPrecision"/>` +
    `<path d="${sunCells}" fill="${sun}"/><path d="${dotCells}" fill="${tile}"/></svg>`;
}
