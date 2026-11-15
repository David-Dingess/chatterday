// What a pet looks like: the parts its owner picked in the pet builder. This is all that is saved and sent
// around; the pictures are drawn from it in the browser (client/src/draw/pet.ts). The server reads this file
// too, to check what people send, so it must not import anything.

export type PetKind = 'cat' | 'dog';

export type PetLook = {
  kind: PetKind;
  /** what it is called; may be empty */
  name: string;
  /** how big and heavy it is */
  build: string;
  /** the main coat colour, as #rrggbb */
  coat: string;
  /** the second colour: white bits, patches or points, depending on the pattern */
  coat2: string;
  pattern: string;
  fur: string;
  ears: string;
  tail: string;
  eyes: string;
  nose: string;
  /** 'none' or a kind of collar */
  collar: string;
  collarColor: string;
};

export type Option = { id: string; label: string };
/** A colour to offer: the id is the colour itself. */
export type Swatch = { id: string; label: string };

type KindOptions = { build: Option[]; pattern: Option[]; fur: Option[]; ears: Option[]; tail: Option[]; collar: Option[] };

const CAT: KindOptions = {
  build: [{ id: 'regular', label: 'Regular' }, { id: 'chunky', label: 'Chunky' }],
  pattern: [
    { id: 'solid', label: 'Solid' },
    { id: 'tabby', label: 'Tabby stripes' },
    { id: 'tabbywhite', label: 'Tabby with white' },
    { id: 'tuxedo', label: 'Tuxedo' },
    { id: 'socks', label: 'White paws' },
    { id: 'mask', label: 'Bicolour mask' },
    { id: 'patches', label: 'Patches' },
    { id: 'point', label: 'Colour point' },
    { id: 'spots', label: 'Spots' },
    { id: 'tortie', label: 'Tortoiseshell' },
  ],
  fur: [{ id: 'short', label: 'Short' }, { id: 'long', label: 'Long and fluffy' }],
  ears: [{ id: 'pointed', label: 'Pointed' }, { id: 'folded', label: 'Folded' }, { id: 'tufted', label: 'Tufted' }, { id: 'round', label: 'Rounded' }],
  tail: [{ id: 'thin', label: 'Thin' }, { id: 'fluffy', label: 'Fluffy' }, { id: 'bob', label: 'Bobtail' }],
  collar: [{ id: 'none', label: 'None' }, { id: 'collar', label: 'Collar' }, { id: 'bell', label: 'Collar with a bell' }, { id: 'bow', label: 'Bow' }],
};

const DOG: KindOptions = {
  build: [{ id: 'small', label: 'Small' }, { id: 'medium', label: 'Medium' }, { id: 'large', label: 'Large' }],
  pattern: [
    { id: 'solid', label: 'Solid' },
    { id: 'twotone', label: 'White chest and paws' },
    { id: 'mask', label: 'Dark muzzle' },
    { id: 'maskwhite', label: 'Dark muzzle, white chest' },
    { id: 'saddle', label: 'Saddle' },
    { id: 'tricolour', label: 'Tricolour' },
    { id: 'spots', label: 'Spotted' },
    { id: 'patch', label: 'Eye patch' },
    { id: 'brindle', label: 'Brindle' },
  ],
  fur: [{ id: 'short', label: 'Short' }, { id: 'shaggy', label: 'Shaggy' }],
  ears: [{ id: 'floppy', label: 'Floppy' }, { id: 'long', label: 'Long and hanging' }, { id: 'pointed', label: 'Pointed' }, { id: 'halfup', label: 'Half up' }],
  tail: [{ id: 'long', label: 'Long' }, { id: 'short', label: 'Short' }, { id: 'curled', label: 'Curled' }, { id: 'fluffy', label: 'Fluffy' }],
  collar: [{ id: 'none', label: 'None' }, { id: 'collar', label: 'Collar' }, { id: 'tag', label: 'Collar with a tag' }, { id: 'bandana', label: 'Bandana' }],
};

/** Everything the builder offers, in the order to show it. Any #rrggbb colour is allowed; the swatches are suggestions. */
export const PET_OPTIONS = {
  kind: [{ id: 'cat', label: 'Cat' }, { id: 'dog', label: 'Dog' }] as Option[],
  cat: CAT,
  dog: DOG,
  coats: [
    { id: '#2b2c36', label: 'Black' },
    { id: '#4d4f5c', label: 'Charcoal' },
    { id: '#7f8799', label: 'Blue grey' },
    { id: '#a3a7b1', label: 'Grey' },
    { id: '#d3d5db', label: 'Silver' },
    { id: '#f6f5f1', label: 'White' },
    { id: '#ead8b0', label: 'Cream' },
    { id: '#e0b060', label: 'Golden' },
    { id: '#d98a3d', label: 'Ginger' },
    { id: '#c9945c', label: 'Fawn' },
    { id: '#a8623a', label: 'Russet' },
    { id: '#9c8a76', label: 'Brown tabby' },
    { id: '#6f4c36', label: 'Chocolate' },
    { id: '#4a3327', label: 'Dark brown' },
  ] as Swatch[],
  eyes: [
    { id: '#d9c84f', label: 'Yellow' },
    { id: '#e0a43a', label: 'Amber' },
    { id: '#9ccf5a', label: 'Green' },
    { id: '#63b7e6', label: 'Blue' },
    { id: '#c97a3a', label: 'Copper' },
    { id: '#5a3a26', label: 'Brown' },
    { id: '#22232b', label: 'Black' },
  ] as Swatch[],
  noses: [
    { id: '#e79aa6', label: 'Pink' },
    { id: '#22232b', label: 'Black' },
    { id: '#6b4a3a', label: 'Brown' },
    { id: '#b0756a', label: 'Liver' },
  ] as Swatch[],
  collarColors: [
    { id: '#d8342c', label: 'Red' },
    { id: '#f08a24', label: 'Orange' },
    { id: '#f2c81e', label: 'Yellow' },
    { id: '#3f8f5a', label: 'Green' },
    { id: '#2f9fb8', label: 'Teal' },
    { id: '#3b6fd0', label: 'Blue' },
    { id: '#8f5fe0', label: 'Purple' },
    { id: '#e86aa8', label: 'Pink' },
    { id: '#2a2c3a', label: 'Black' },
    { id: '#f1f1ee', label: 'White' },
  ] as Swatch[],
};

export const DEFAULT_PET: PetLook = {
  kind: 'cat', name: '', build: 'regular', coat: '#a3a7b1', coat2: '#f6f5f1', pattern: 'tabbywhite', fur: 'short',
  ears: 'pointed', tail: 'thin', eyes: '#d9c84f', nose: '#e79aa6', collar: 'none', collarColor: '#d8342c',
};

/** What a dog starts as when somebody switches the builder from cat to dog. */
export const DEFAULT_DOG: PetLook = {
  kind: 'dog', name: '', build: 'medium', coat: '#c9945c', coat2: '#f6f5f1', pattern: 'twotone', fur: 'short',
  ears: 'floppy', tail: 'long', eyes: '#22232b', nose: '#22232b', collar: 'collar', collarColor: '#d8342c',
};

const HEX = /^#[0-9a-f]{6}$/i;
// control characters, and the invisible marks that can hide or reorder text
const UNSEEN = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g;

function pick(list: Option[], value: unknown, fallback: string): string {
  return typeof value === 'string' && list.some((o) => o.id === value) ? value : fallback;
}
function colour(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX.test(value) ? value.toLowerCase() : fallback;
}
function cleanName(value: unknown): string {
  if (typeof value !== 'string') return '';
  return Array.from(value.replace(UNSEEN, '').trim()).slice(0, 16).join('').trim();
}

/** Checks a pet that came from somewhere else. Anything unknown falls back to the usual; no pet at all gives null. Never throws. */
export function cleanPet(input: unknown): PetLook | null {
  try {
    if (!input || typeof input !== 'object') return null;
    const o = input as Record<string, unknown>;
    const kind: PetKind | null = o.kind === 'cat' || o.kind === 'dog' ? o.kind : null;
    if (!kind) return null;
    const opts = PET_OPTIONS[kind], base = kind === 'cat' ? DEFAULT_PET : DEFAULT_DOG;
    return {
      kind,
      name: cleanName(o.name),
      build: pick(opts.build, o.build, base.build),
      coat: colour(o.coat, base.coat),
      coat2: colour(o.coat2, base.coat2),
      pattern: pick(opts.pattern, o.pattern, base.pattern),
      fur: pick(opts.fur, o.fur, base.fur),
      ears: pick(opts.ears, o.ears, base.ears),
      tail: pick(opts.tail, o.tail, base.tail),
      eyes: colour(o.eyes, base.eyes),
      nose: colour(o.nose, base.nose),
      collar: pick(opts.collar, o.collar, base.collar),
      collarColor: colour(o.collarColor, base.collarColor),
    };
  } catch {
    return null;
  }
}

const NAMES = ['Biscuit', 'Mochi', 'Pepper', 'Waffles', 'Noodle', 'Pickle', 'Maple', 'Olive', 'Pumpkin', 'Sprout', 'Toast', 'Clover',
  'Peanut', 'Dumpling', 'Button', 'Smudge', 'Nugget', 'Pebble', 'Marble', 'Tater'];

/** A pet made up from a number: the same number always gives the same pet. */
export function randomPet(seed: number): PetLook {
  let t = (Math.floor(Number(seed) || 0) ^ 0x9e3779b9) >>> 0;
  const next = () => {            // a small, well-spread number maker (mulberry32)
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
  const of = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)];
  const kind: PetKind = next() < 0.55 ? 'cat' : 'dog';
  const opts = PET_OPTIONS[kind];
  const pattern = of(opts.pattern).id;
  const coats = PET_OPTIONS.coats.map((c) => c.id);
  let coat = of(coats);
  // the second colour is white more often than not, except where the pattern wants a real second colour
  let coat2 = '#f6f5f1';
  if (['patches', 'tortie'].includes(pattern)) { coat = of(['#f6f5f1', '#ead8b0', '#2b2c36', '#4d4f5c']); coat2 = of(['#d98a3d', '#e0b060', '#a8623a']); }
  else if (pattern === 'point') { coat = of(['#ead8b0', '#f6f5f1', '#d3d5db']); coat2 = of(['#4a3327', '#6f4c36', '#4d4f5c', '#7f8799']); }
  else if (['saddle', 'tricolour', 'patch'].includes(pattern)) { coat = of(['#c9945c', '#e0b060', '#ead8b0', '#a8623a', '#f6f5f1']); coat2 = of(['#2b2c36', '#4a3327', '#6f4c36']); }
  else if (pattern === 'spots' && kind === 'dog') { coat = of(['#f6f5f1', '#ead8b0', '#d3d5db']); coat2 = of(['#2b2c36', '#6f4c36', '#4d4f5c']); }
  else if (coat === '#f6f5f1' || next() < 0.15) coat2 = of(['#ead8b0', '#d3d5db', '#f6f5f1']);
  return {
    kind,
    name: of(NAMES),
    build: of(opts.build).id,
    coat,
    coat2,
    pattern,
    fur: next() < 0.7 ? opts.fur[0].id : opts.fur[1].id,
    ears: of(opts.ears).id,
    tail: of(opts.tail).id,
    eyes: kind === 'cat' ? of(['#d9c84f', '#e0a43a', '#9ccf5a', '#63b7e6', '#c97a3a']) : of(['#22232b', '#22232b', '#5a3a26', '#63b7e6']),
    nose: kind === 'cat' ? of(['#e79aa6', '#e79aa6', '#22232b', '#b0756a']) : of(['#22232b', '#22232b', '#6b4a3a']),
    collar: next() < 0.4 ? 'none' : of(opts.collar.slice(1)).id,
    collarColor: of(PET_OPTIONS.collarColors).id,
  };
}
