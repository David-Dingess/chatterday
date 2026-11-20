// A look: everything somebody picked for their character, as plain JSON. The builder shows these lists, the server
// checks what it is sent against them, and the drawing reads the same ids, so this file is the one place a part is
// named. It imports nothing, so the server and the browser can both use it.

export type Look = {
  /** Body type: how wide the character is built. */
  body: string;
  height: string;
  /** Colours are always '#rrggbb'. */
  skin: string;
  eyes: string;
  eyeColor: string;
  brows: string;
  mouth: string;
  /** Something on the face: freckles, a scar... */
  marks: string;
  hair: { style: string; color: string };
  facial: { style: string; color: string };
  /** color2 is the second colour of a pattern, or of the shirt under a vest. Left out, one is chosen to suit. */
  top: { kind: string; color: string; pattern: string; color2?: string };
  bottom: { kind: string; color: string };
  shoes: { kind: string; color: string };
  hat: { kind: string; color: string };
  glasses: string;
  /** Accessories, several at once (up to LOOK_OPTIONS.maxExtras). They take the person's own colour. */
  extras: string[];
  /** Eyebrows of their own colour (bleached hair over dark brows, or the other way). Left out, they follow the hair. */
  browColor?: string;
  /** Tattoos, drawn as the house's are (see Person.ink in client/src/draw/avatar.ts). Not in the builder: set from a file. */
  ink?: Ink;
};

/** Rows of letters, one letter a dot of ink ('.' none; the tones are INK_TONES in avatar.ts). f and b: [their right
 *  leg, their left leg] from the front and from behind, from the knee down; s their near leg from the side. The arms:
 *  9 rows from the shoulder, 3 dots across. */
export type Ink = { f: [string[], string[]]; b: [string[], string[]]; s: string[]; armF?: [string[], string[]]; armB?: [string[], string[]]; armS?: string[] };

export type LookOption = { readonly id: string; readonly label: string };

const o = (id: string, label: string): LookOption => ({ id, label });

/** Every choice for every part, in the order the builder should show them, and colours to offer. */
export const LOOK_OPTIONS = {
  body: [o('slim', 'Slim'), o('medium', 'Medium'), o('broad', 'Broad'), o('stocky', 'Stocky'), o('tapered', 'Tapered'), o('hourglass', 'Hourglass')],
  height: [o('short', 'Short'), o('medium', 'Medium'), o('tall', 'Tall'), o('xtall', 'Very tall')],
  eyes: [o('default', 'Classic'), o('round', 'Bright'), o('big', 'Wide'), o('small', 'Small'), o('dot', 'Dots'), o('sleepy', 'Sleepy'), o('lashes', 'Lashes'), o('happy', 'Happy'), o('tired', 'Tired')],
  brows: [o('regular', 'Regular'), o('thick', 'Thick'), o('thin', 'Thin'), o('arched', 'Arched'), o('stern', 'Stern'), o('soft', 'Soft'), o('mono', 'One brow'), o('none', 'None')],
  mouth: [o('smile', 'Smile'), o('neutral', 'Straight'), o('grin', 'Grin'), o('small', 'Small'), o('smirk', 'Smirk'), o('frown', 'Frown'), o('open', 'Open'), o('tongue', 'Tongue out')],
  marks: [o('none', 'None'), o('freckles', 'Freckles'), o('blush', 'Blush'), o('mole', 'Mole'), o('scar', 'Scar'), o('vitiligo', 'Vitiligo'), o('bindi', 'Bindi'), o('plaster', 'Plaster'), o('whiskers', 'Whiskers'), o('paint', 'Face paint')],
  hair: [
    o('bald', 'Bald'), o('buzz', 'Buzz cut'), o('fade', 'Fade with waves'), o('balding', 'Bald on top'), o('crop', 'Crop'), o('short', 'Short'), o('neat', 'Neat'), o('sidepart', 'Side part'),
    o('quiff', 'Quiff'), o('pixie', 'Pixie'), o('bowl', 'Bowl cut'), o('flattop', 'Flat top'), o('spiky', 'Spiky'), o('messy', 'Messy'), o('slick', 'Slicked back'),
    o('undercut', 'Undercut'), o('mohawk', 'Mohawk'), o('fringe', 'Long fringe'), o('curly', 'Curly'), o('curlytop', 'Curly top'), o('twists', 'Twists'), o('afro', 'Afro'), o('afro_big', 'Big afro'), o('puffs', 'Puffs'),
    o('bantu', 'Bantu knots'), o('cornrows', 'Cornrows'), o('bob', 'Bob'), o('lob', 'Lob'), o('sidelob', 'Side-parted lob'), o('mullet', 'Mullet'), o('rattail', 'Rat tail'), o('long', 'Long straight'), o('longpart', 'Long, parted'),
    o('xlong', 'Very long'), o('long_wavy', 'Long wavy'), o('long_curly', 'Long curly'), o('dreads', 'Locs'),
    o('boxbraids', 'Box braids'), o('braids', 'Two braids'),
    o('ponytail', 'Ponytail'), o('shoulderpony', 'Low ponytail'), o('high_pony', 'High ponytail'), o('pigtails', 'Pigtails'), o('bun', 'Bun'), o('topknot', 'Top knot'), o('buns', 'Two buns'),
  ],
  facial: [
    o('none', 'None'), o('stubble', 'Stubble'), o('shadow', 'Shadow'), o('scruff', 'Scruff'), o('pencil', 'Pencil moustache'), o('moustache', 'Moustache'), o('handlebar', 'Handlebar'),
    o('soulpatch', 'Soul patch'), o('anchor', 'Moustache and chin beard'), o('goatee', 'Goatee'), o('chinstrap', 'Chin strap'), o('sideburns', 'Sideburns'), o('chops', 'Mutton chops'), o('trim', 'Trimmed beard'),
    o('short', 'Short beard'), o('medium', 'Beard'), o('full', 'Full beard'), o('heavy', 'Heavy beard'), o('long', 'Long beard'), o('wizard', 'Very long beard'),
  ],
  top: [
    o('tee', 'T-shirt'), o('long', 'Long sleeve'), o('tank', 'Tank top'), o('crop', 'Crop top'), o('polo', 'Polo'), o('shirt', 'Shirt'), o('jersey', 'Jersey'), o('sweater', 'Sweater'),
    o('turtleneck', 'Turtleneck'), o('hoodie', 'Hoodie'), o('jacket', 'Jacket'), o('varsity', 'Varsity jacket'), o('cardigan', 'Cardigan'), o('blazer', 'Blazer'), o('vest', 'Vest and shirt'), o('overalls', 'Overalls'), o('dress', 'Dress'),
  ],
  pattern: [
    o('plain', 'Plain'), o('stripes', 'Stripes'), o('hoops', 'Hoops'), o('vstripes', 'Pinstripes'), o('check', 'Check'), o('plaid', 'Plaid'), o('dots', 'Dots'), o('quilt', 'Quilted'),
    o('block', 'Colour block'), o('split', 'Half and half'), o('tiedye', 'Tie-dye'), o('camo', 'Camo'), o('logo', 'Logo'), o('heart', 'Heart'), o('star', 'Star'), o('bars', 'Sound bars'),
  ],
  bottom: [o('trousers', 'Trousers'), o('jeans', 'Jeans'), o('joggers', 'Joggers'), o('cargo', 'Cargo'), o('leggings', 'Leggings'), o('shorts', 'Shorts'), o('bermuda', 'Long shorts'), o('skirt', 'Skirt'), o('longskirt', 'Long skirt')],
  shoes: [o('sneakers', 'Sneakers'), o('hightops', 'High-tops'), o('boots', 'Boots'), o('smart', 'Smart shoes'), o('sandals', 'Sandals'), o('slippers', 'Slippers'), o('barefoot', 'Barefoot')],
  hat: [
    o('none', 'None'), o('cap', 'Cap'), o('beanie', 'Beanie'), o('bucket', 'Bucket hat'), o('visor', 'Visor'), o('headband', 'Headband'), o('bandana', 'Bandana'), o('durag', 'Durag'), o('beret', 'Beret'), o('kufi', 'Kufi'),
    o('fedora', 'Fedora'), o('cowboy', 'Cowboy hat'), o('tophat', 'Top hat'), o('hardhat', 'Hard hat'), o('chef', 'Chef hat'), o('wizard', 'Wizard hat'), o('pirate', 'Pirate hat'),
    o('santa', 'Santa hat'), o('party', 'Party hat'), o('propeller', 'Propeller cap'), o('crown', 'Crown'), o('flowercrown', 'Flower crown'), o('bow', 'Bow'), o('catears', 'Cat ears'),
    o('bunny', 'Bunny ears'), o('horns', 'Horns'), o('halo', 'Halo'), o('headphones', 'Headphones'), o('turban', 'Turban'), o('headwrap', 'Head wrap'), o('hijab', 'Hijab'),
  ],
  glasses: [o('none', 'None'), o('wire', 'Wire'), o('round', 'Round'), o('thick', 'Thick'), o('shades', 'Shades'), o('aviator', 'Aviators'), o('monocle', 'Monocle'), o('eyepatch', 'Eye patch'), o('goggles', 'Goggles')],
  extras: [
    o('watch', 'Watch'), o('necklace', 'Necklace'), o('earrings', 'Earrings'), o('scarf', 'Scarf'), o('tie', 'Tie'), o('bowtie', 'Bow tie'), o('belt', 'Belt'), o('sling', 'Sling bag'),
    o('backpack', 'Backpack'), o('neckphones', 'Headphones round the neck'), o('mask', 'Face mask'), o('flower', 'Flower in hair'), o('cape', 'Cape'), o('wings', 'Wings'), o('tail', 'Tail'),
  ],
  maxExtras: 4,
  skinColors: ['#fbe0cf', '#f5ccb2', '#f2c4a2', '#eebf9f', '#e8b792', '#f0cf9e', '#dfb07f', '#d19c73', '#c08a5e', '#aa7448', '#96603c', '#7e4e30', '#683e27', '#52301f', '#3f2418', '#2f1b13'],
  /** The first `naturalHair` of these are everyday hair colours; the rest are dyes. */
  hairColors: ['#1d1a20', '#2e2228', '#3d2a20', '#553828', '#6f4831', '#8d6444', '#8a3a22', '#a9552d', '#c26a33', '#d98e5a', '#b9995a', '#e6c66a', '#f0e6c8', '#9a9aa4', '#c9cbd3', '#f1f1f4',
    '#f08fb0', '#e5484d', '#8b6be0', '#3b82f6', '#2bb3a3', '#5fae57'],
  naturalHair: 16,
  eyeColors: ['#261c2e', '#3b2416', '#6b4423', '#8a6a2f', '#4f7a3a', '#2f8f83', '#3f7fbf', '#7d8590', '#8b6be0'],
  clothColors: ['#f3f0e8', '#c9cbd3', '#7d8597', '#3a3a48', '#1e1e24', '#2b3a67', '#3f5078', '#2f62dc', '#6f9ad2', '#2a9d8f', '#3fbf63', '#2f6b45', '#8d9884', '#cdb98e', '#c9ae7c', '#7a563a',
    '#f4d03f', '#ff8f2e', '#d8473f', '#7a2e3a', '#ff6fb7', '#f4b3a2', '#8b6be0', '#b8a4e8'],
} as const;

export const DEFAULT_LOOK: Look = {
  body: 'medium', height: 'medium', skin: '#eebf9f',
  eyes: 'default', eyeColor: '#261c2e', brows: 'regular', mouth: 'smile', marks: 'none',
  hair: { style: 'crop', color: '#5d4634' },
  facial: { style: 'none', color: '#5d4634' },
  top: { kind: 'long', color: '#7d8597', pattern: 'plain' },
  bottom: { kind: 'trousers', color: '#3b4252' },
  shoes: { kind: 'sneakers', color: '#d9d6cf' },
  hat: { kind: 'none', color: '#f4f1e9' },
  glasses: 'none',
  extras: [],
};

type Bag = Record<string, unknown>;
const bag = (v: unknown): Bag => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Bag) : {});
const idOf = (list: readonly LookOption[], v: unknown, fallback: string): string => (typeof v === 'string' && list.some((x) => x.id === v) ? v : fallback);
const colorOf = (v: unknown, fallback: string): string => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fallback);

const inkRows = (v: unknown, max: number): string[] => (Array.isArray(v) ? v.slice(0, max).map((r) => (typeof r === 'string' && /^[.bokwyrgtn]{0,6}$/.test(r) ? r : '')) : []);
const inkPair = (v: unknown, max: number): [string[], string[]] => { const a = Array.isArray(v) ? v : []; return [inkRows(a[0], max), inkRows(a[1], max)]; };
/** Tattoos as they are stored: only rows of ink letters, a few of them; anything else is dropped. */
function inkOf(v: unknown): Ink | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const i = v as Bag;
  const ink: Ink = { f: inkPair(i.f, 12), b: inkPair(i.b, 12), s: inkRows(i.s, 12) };
  if (i.armF || i.armB || i.armS) { ink.armF = inkPair(i.armF, 9); ink.armB = inkPair(i.armB, 9); ink.armS = inkRows(i.armS, 9); }
  return ink;
}

/** Makes anything into a look that is safe to store and draw: unknown ids and bad colours fall back to the default
 *  look's. Never throws, whatever it is given. */
export function cleanLook(input: unknown): Look {
  const O = LOOK_OPTIONS, D = DEFAULT_LOOK;
  try {
    const i = bag(input), hair = bag(i.hair), facial = bag(i.facial), top = bag(i.top), bottom = bag(i.bottom), shoes = bag(i.shoes), hat = bag(i.hat);
    const extras: string[] = [];
    if (Array.isArray(i.extras)) {
      for (const e of i.extras) {
        if (typeof e === 'string' && O.extras.some((x) => x.id === e) && !extras.includes(e) && extras.length < O.maxExtras) extras.push(e);
      }
    }
    const hairColor = colorOf(hair.color, D.hair.color);
    const look: Look = {
      body: idOf(O.body, i.body, D.body), height: idOf(O.height, i.height, D.height), skin: colorOf(i.skin, D.skin),
      eyes: idOf(O.eyes, i.eyes, D.eyes), eyeColor: colorOf(i.eyeColor, D.eyeColor), brows: idOf(O.brows, i.brows, D.brows),
      mouth: idOf(O.mouth, i.mouth, D.mouth), marks: idOf(O.marks, i.marks, D.marks),
      hair: { style: idOf(O.hair, hair.style, D.hair.style), color: hairColor },
      facial: { style: idOf(O.facial, facial.style, D.facial.style), color: colorOf(facial.color, hairColor) },
      top: { kind: idOf(O.top, top.kind, D.top.kind), color: colorOf(top.color, D.top.color), pattern: idOf(O.pattern, top.pattern, D.top.pattern) },
      bottom: { kind: idOf(O.bottom, bottom.kind, D.bottom.kind), color: colorOf(bottom.color, D.bottom.color) },
      shoes: { kind: idOf(O.shoes, shoes.kind, D.shoes.kind), color: colorOf(shoes.color, D.shoes.color) },
      hat: { kind: idOf(O.hat, hat.kind, D.hat.kind), color: colorOf(hat.color, D.hat.color) },
      glasses: idOf(O.glasses, i.glasses, D.glasses),
      extras,
    };
    const second = colorOf(top.color2, '');
    if (second) look.top.color2 = second;
    const brow = colorOf(i.browColor, '');
    if (brow) look.browColor = brow;
    const ink = inkOf(i.ink);
    if (ink) look.ink = ink;
    return look;
  } catch {
    return { ...D, hair: { ...D.hair }, facial: { ...D.facial }, top: { ...D.top }, bottom: { ...D.bottom }, shoes: { ...D.shoes }, hat: { ...D.hat }, extras: [] };
  }
}

/** The same seed always gives the same character. Mostly everyday choices, with the odd surprise. */
export function randomLook(seed: number): Look {
  const O = LOOK_OPTIONS;
  let s = (Math.floor(Number(seed) || 0) ^ 0x9e3779b9) >>> 0;
  const rnd = () => {                                     // a small, well-mixed generator (mulberry32)
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)];
  const id = (list: readonly LookOption[]) => pick(list).id;
  const mostly = (usual: string, list: readonly LookOption[], chance: number) => (rnd() < chance ? usual : id(list));

  const skin = pick(O.skinColors);
  // Hair the same shade as the skin makes the head one blob, so those pairs are passed over.
  const far = (a: string, b: string) => [1, 3, 5].reduce((sum, i) => sum + Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)), 0) > 110;
  const hairs = (rnd() < 0.88 ? O.hairColors.slice(0, O.naturalHair) : O.hairColors.slice(O.naturalHair)).filter((c) => far(c, skin));
  const hairColor = pick(hairs.length ? hairs : O.hairColors);
  const quiet = ['#3f5078', '#2b3a67', '#3a3a48', '#1e1e24', '#7d8597', '#cdb98e', '#c9ae7c', '#7a563a', '#8d9884', '#2f6b45'];
  const shoeTones = ['#ecebe4', '#d9d6cf', '#50505e', '#1e1e24', '#7a563a', '#8a8f9c', '#d8473f', '#2f62dc'];
  const topColor = pick(O.clothColors);
  const pattern = mostly('plain', O.pattern, 0.5);
  const top: Look['top'] = { kind: id(O.top), color: topColor, pattern };
  if (rnd() < 0.6) {
    const second = pick(O.clothColors.filter((c) => c !== topColor));
    top.color2 = second;
  }
  const extras: string[] = [];
  const count = rnd() < 0.5 ? 0 : rnd() < 0.7 ? 1 : 2;
  while (extras.length < count) {
    const e = id(O.extras);
    if (!extras.includes(e)) extras.push(e);
  }
  const hats = O.hat.filter((h) => h.id !== 'none' && h.id !== 'party');     // the party hat is kept for birthdays
  return {
    body: rnd() < 0.4 ? 'medium' : id(O.body),
    height: rnd() < 0.4 ? 'medium' : id(O.height),
    skin,
    eyes: mostly('default', O.eyes, 0.45),
    eyeColor: rnd() < 0.55 ? pick(O.eyeColors.slice(0, 3)) : pick(O.eyeColors),
    brows: mostly('regular', O.brows.filter((b) => b.id !== 'none' && b.id !== 'mono'), 0.45),
    mouth: mostly('smile', O.mouth, 0.5),
    marks: mostly('none', O.marks, 0.72),
    hair: { style: id(O.hair), color: hairColor },
    facial: { style: mostly('none', O.facial, 0.68), color: hairColor },
    top,
    bottom: { kind: id(O.bottom), color: rnd() < 0.75 ? pick(quiet) : pick(O.clothColors) },
    shoes: { kind: mostly('sneakers', O.shoes, 0.4), color: pick(shoeTones) },
    hat: { kind: rnd() < 0.72 ? 'none' : pick(hats).id, color: pick(O.clothColors) },
    glasses: mostly('none', O.glasses, 0.72),
    extras,
  };
}
