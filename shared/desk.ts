// A desk. Every desk in the house is the same desk (one screen, a tower, a gaming chair) and nobody owns one:
// whoever sits at it brings two things of their own, the colour of its lights and the one thing they keep on it.
// This is all that is saved and sent around; the pictures are drawn from it in the browser
// (client/src/draw/desk.ts). The server reads this file too, so it must not import anything.

export type Desk = {
  /** the colour of the desk's lights, as #rrggbb; '' means the person's own colour */
  led: string;
  /** the one thing on the desk, or 'none' */
  item: string;
};

export type Option = { id: string; label: string };

/** Everything the desk builder offers, in the order to show it. */
export const DESK_OPTIONS = {
  /** Colours to offer for the lights. Any #rrggbb colour is allowed. */
  ledColors: ['#e5484d', '#ff8f2e', '#f2c230', '#3fbf63', '#2fd3c6', '#3b82f6', '#8b6be0', '#ff6fb7', '#f4f1e9'],
  items: [
    { id: 'none', label: 'Nothing' },
    { id: 'mug', label: 'Mug' },
    { id: 'can', label: 'Fizzy drink' },
    { id: 'books', label: 'Stack of books' },
    { id: 'plant', label: 'Plant' },
    { id: 'cactus', label: 'Cactus' },
    { id: 'lamp', label: 'Desk lamp' },
    { id: 'lavalamp', label: 'Lava lamp' },
    { id: 'candle', label: 'Candle' },
    { id: 'clock', label: 'Alarm clock' },
    { id: 'frame', label: 'Photo frame' },
    { id: 'globe', label: 'Globe' },
    { id: 'snowglobe', label: 'Snow globe' },
    { id: 'trophy', label: 'Trophy' },
    { id: 'duck', label: 'Rubber duck' },
    { id: 'robot', label: 'Toy robot' },
    { id: 'controller', label: 'Game controller' },
    { id: 'headphones', label: 'Headphones on a stand' },
    { id: 'soccer', label: 'Soccer ball' },
    { id: 'baseball', label: 'Baseball' },
    { id: 'basketball', label: 'Basketball' },
    { id: 'lunchbag', label: 'Paper lunch bag' },
    { id: 'sandwich', label: 'Sandwich' },
    { id: 'fishbowl', label: 'Fish bowl' },
    { id: 'pencils', label: 'Cup of pencils' },
  ] as Option[],
};

export const DEFAULT_DESK: Desk = { led: '', item: 'mug' };

const HEX = /^#[0-9a-f]{6}$/i;

/** Checks a desk that came from somewhere else. Anything unknown falls back to the usual desk. Never throws. */
export function cleanDesk(input: unknown): Desk {
  try {
    if (!input || typeof input !== 'object') return { ...DEFAULT_DESK };
    const o = input as Record<string, unknown>;
    return {
      led: typeof o.led === 'string' && HEX.test(o.led) ? o.led.toLowerCase() : '',
      item: typeof o.item === 'string' && DESK_OPTIONS.items.some((x) => x.id === o.item) ? o.item : DEFAULT_DESK.item,
    };
  } catch {
    return { ...DEFAULT_DESK };
  }
}

/** A desk made up from a number: the same number always gives the same desk. */
export function randomDesk(seed: number): Desk {
  let t = (Math.floor(Number(seed) || 0) ^ 0x51ed270b) >>> 0;
  const next = () => {            // a small, well-spread number maker (mulberry32)
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
  const item = DESK_OPTIONS.items[Math.floor(next() * DESK_OPTIONS.items.length)].id;
  const led = next() < 0.4 ? '' : DESK_OPTIONS.ledColors[Math.floor(next() * DESK_OPTIONS.ledColors.length)];
  return { led, item };
}
