// Checks the pet and desk drawing without a browser:
//
//     node scripts/test-draw-pets-desks.mjs
//
// 300 random pets and 300 random desks, then every choice in every sensible mix. Nothing may throw, every picture
// must be the right size, every pet frame must have a pet in it, and the thing on a desk may not sit on anything else.
// Prints one line; exits 1 if anything is wrong.

import { drawPetFrame, drawPetSheet } from '../client/src/draw/pet.ts';
import { KEYS_BOX, MOUSE_BOX, PAD_BOX, STANDS, drawDesk, itemBox, ledOf } from '../client/src/draw/desk.ts';
import { DEFAULT_DOG, DEFAULT_PET, PET_OPTIONS, cleanPet, randomPet } from '../shared/pet.ts';
import { DEFAULT_DESK, DESK_OPTIONS, cleanDesk, randomDesk } from '../shared/desk.ts';

const problems = [];
let checks = 0;
const ok = (cond, what) => { checks++; if (!cond && problems.length < 40) problems.push(what); };
const tryTo = (what, fn) => { try { return fn(); } catch (e) { ok(false, `${what} threw: ${e && e.message}`); return undefined; } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const bytes = (pic) => Buffer.from(pic.data.buffer, pic.data.byteOffset, pic.data.byteLength);
const equal = (a, b) => bytes(a).equals(bytes(b));
const hits = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];

// ───────────────────────── pets ─────────────────────────

const F = 24;
let pets = 0;
function checkPet(pet, what) {
  pets++;
  const sheet = tryTo(`drawPetSheet ${what}`, () => drawPetSheet(pet));
  if (!sheet) return null;
  ok(sheet.w === 96 && sheet.h === 168 && sheet.data.length === 96 * 168 * 4, `${what}: sheet is ${sheet.w}x${sheet.h}`);
  for (let row = 0; row < 7; row++) for (let f = 0; f < 4; f++) {
    let solid = 0, low = 0;
    for (let y = 0; y < F; y++) for (let x = 0; x < F; x++) {
      if (sheet.data[((row * F + y) * 96 + f * F + x) * 4 + 3]) { solid++; if (y > 22) low++; }
    }
    ok(solid >= 25, `${what}: row ${row} frame ${f} has only ${solid} dots`);
    ok(low === 0, `${what}: row ${row} frame ${f} goes below the floor`);
  }
  return sheet;
}

for (let n = 0; n < 300; n++) {
  const pet = tryTo(`randomPet(${n})`, () => randomPet(n * 2654435761 + 17));
  if (!pet) continue;
  ok(same(cleanPet(pet), pet), `randomPet(${n}) does not survive cleanPet: ${JSON.stringify(pet)}`);
  ok(same(randomPet(n * 2654435761 + 17), pet), `randomPet(${n}) is not the same twice`);
  const sheet = checkPet(pet, `random pet ${n}`);
  if (sheet && n < 40) {                             // one frame on its own must be the same dots as on the sheet
    const row = n % 7, f = n % 4, one = tryTo('drawPetFrame', () => drawPetFrame(pet, row, f));
    let match = !!one && one.w === F && one.h === F;
    for (let y = 0; match && y < F; y++) for (let x = 0; x < F; x++) for (let k = 0; k < 4; k++) {
      if (one.data[(y * F + x) * 4 + k] !== sheet.data[((row * F + y) * 96 + f * F + x) * 4 + k]) match = false;
    }
    ok(match, `random pet ${n}: drawPetFrame(${row}, ${f}) is not what the sheet has`);
  }
}

// every pattern with every fur, ears, tail and build; then every collar on every build
const PARTS = ['pattern', 'fur', 'ears', 'tail', 'build', 'collar'];
const seenPet = new Set();
for (const kind of ['cat', 'dog']) {
  const o = PET_OPTIONS[kind], base = kind === 'cat' ? DEFAULT_PET : DEFAULT_DOG;
  const coats = ['#2b2c36', '#f6f5f1', '#d98a3d', '#a3a7b1'];
  let n = 0;
  for (const pattern of o.pattern) for (const fur of o.fur) for (const ears of o.ears) for (const tail of o.tail) for (const build of o.build) {
    const pet = { ...base, pattern: pattern.id, fur: fur.id, ears: ears.id, tail: tail.id, build: build.id, coat: coats[n % 4], coat2: coats[(n >> 2) % 4], collar: o.collar[n % o.collar.length].id };
    n++;
    ok(same(cleanPet(pet), pet), `${kind} ${JSON.stringify(pet)} does not survive cleanPet`);
    checkPet(pet, `${kind} ${pattern.id}/${fur.id}/${ears.id}/${tail.id}/${build.id}`);
    for (const part of PARTS) seenPet.add(`${kind}.${part}.${pet[part]}`);
  }
  for (const collar of o.collar) for (const build of o.build) for (const fur of o.fur) checkPet({ ...base, collar: collar.id, build: build.id, fur: fur.id }, `${kind} collar ${collar.id}`);
  // every choice must change the picture: a choice that draws like another is a typo somewhere
  for (const part of PARTS) {
    ok(o[part].every((x) => seenPet.has(`${kind}.${part}.${x.id}`)), `${kind}: not every ${part} was drawn`);
    const plain = { ...base, coat: '#c9945c', coat2: '#2b2c36', collar: 'none' };
    const sheets = o[part].map((x) => tryTo(`${kind} ${part} ${x.id}`, () => bytes(drawPetSheet({ ...plain, [part]: x.id })).toString('latin1')));
    ok(new Set(sheets).size === o[part].length, `${kind}: two choices of ${part} draw the same pet`);
  }
}

// rubbish in: null or a clean pet out, and never an error
const NUL = String.fromCharCode(0), BELL = String.fromCharCode(7), ZERO_WIDTH = String.fromCharCode(0x200b), FLIP = String.fromCharCode(0x202e);
const ODD = ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty'];
const thrower = new Proxy({}, { get() { throw new Error('boom'); }, has() { throw new Error('boom'); }, ownKeys() { throw new Error('boom'); } });
const getters = { get kind() { throw new Error('boom'); }, get surface() { throw new Error('boom'); }, get items() { throw new Error('boom'); } };
const loop = {}; loop.self = loop;
const rubbish = [
  undefined, null, 0, 1, -1, NaN, Infinity, '', 'cat', 'dog', true, false, [], [1, 2, 3], {}, { kind: 'bird' }, { kind: 7 }, { kind: ['cat'] }, () => 1, Symbol('x'), 10n,
  new Date(), /x/, new Map(), thrower, getters, loop,
  { kind: 'cat', name: 5, coat: 'red', coat2: '#12345', pattern: ODD[0], fur: ODD[1], ears: ODD[2], tail: {}, eyes: [], nose: null, collar: ODD[4], collarColor: '#GGGGGG', extra: 'x' },
  { kind: 'dog', name: { toString() { throw new Error('boom'); } }, build: 'x'.repeat(100000), items: 'nope' },
  Object.assign(Object.create(null), { kind: 'cat' }),
  JSON.parse('{"__proto__":{"kind":"cat"},"kind":"dog"}'),
  { surface: ODD[0], monitors: ODD[1], tower: ODD[2], chair: 42, pad: null, items: [ODD[1], ODD[0], 'mug', 'mug', {}, 5, 'plant', 'cactus', 'duck'] },
  { items: new Array(100000).fill('mug') }, { items: { length: 3, 0: 'mug' } }, { items: [thrower, getters] },
];
for (const [n, junk] of rubbish.entries()) {
  const pet = tryTo(`cleanPet(rubbish ${n})`, () => cleanPet(junk));
  if (pet !== null && pet !== undefined) {
    ok((pet.kind === 'cat' || pet.kind === 'dog') && same(cleanPet(pet), pet), `cleanPet(rubbish ${n}) gave something unclean: ${JSON.stringify(pet)}`);
    for (const key of ['coat', 'coat2', 'eyes', 'nose', 'collarColor']) ok(/^#[0-9a-f]{6}$/.test(pet[key]), `cleanPet(rubbish ${n}).${key} is ${pet[key]}`);
    checkPet(pet, `cleaned rubbish ${n}`);
  }
  const desk = tryTo(`cleanDesk(rubbish ${n})`, () => cleanDesk(junk));
  if (desk) {
    ok(same(cleanDesk(desk), desk) && (desk.led === '' || /^#[0-9a-f]{6}$/.test(desk.led)), `cleanDesk(rubbish ${n}) gave something unclean: ${JSON.stringify(desk)}`);
    ok(DESK_OPTIONS.items.some((x) => x.id === desk.item), `cleanDesk(rubbish ${n}) kept an unknown item`);
  } else ok(false, `cleanDesk(rubbish ${n}) gave nothing`);
}
const named = cleanPet({ kind: 'cat', name: `  ${NUL}Mr${BELL} Whis${ZERO_WIDTH}kers${FLIP} the Third of Catland\n  ` });
ok(named && named.name === 'Mr Whiskers the' && named.name.length <= 16, `name was cleaned to ${JSON.stringify(named && named.name)}`);
ok(cleanPet({ kind: 'cat', coat: '#ABCDEF' }).coat === '#abcdef', 'colours are not lowered');
ok(same(cleanDesk({ led: '#ABCDEF', item: 'duck' }), { led: '#abcdef', item: 'duck' }) && same(cleanDesk({ led: 'red', item: 'nope' }), DEFAULT_DESK), 'cleanDesk lets something odd through');
ok(cleanDesk(DEFAULT_DESK) !== DEFAULT_DESK && cleanDesk(null) !== DEFAULT_DESK, 'cleanDesk hands out the default desk itself');
// the drawing itself must put up with choices nobody cleaned
const oddPet = { name: '', build: ODD[0], coat: 'red', coat2: '', pattern: ODD[1], fur: ODD[2], ears: ODD[0], tail: ODD[3], eyes: '#fff', nose: 'x', collar: ODD[0], collarColor: 'blue' };
tryTo('drawPetSheet with odd choices', () => drawPetSheet({ kind: 'cat', ...oddPet }));
tryTo('drawPetSheet with odd choices', () => drawPetSheet({ kind: 'dog', ...oddPet }));
tryTo('drawDesk with odd choices', () => drawDesk({ led: ODD[0], item: ODD[1] }, 'not a colour'));
tryTo('drawDesk with nothing', () => drawDesk({}, '#123456'));

// ───────────────────────── desks ─────────────────────────

const W = 58, H = 91;
let desks = 0;
function checkDesk(desk, accent, what) {
  desks++;
  const art = tryTo(`drawDesk ${what}`, () => drawDesk(desk, accent));
  if (!art) return null;
  ok(art.ox === -4 && art.oy === -30, `${what}: corner is at ${art.ox}, ${art.oy}`);
  for (const part of ['desk', 'chair', 'back']) ok(art[part].w === W && art[part].h === H && art[part].data.length === W * H * 4, `${what}: ${part} is ${art[part].w}x${art[part].h}`);
  ok(art.screens.length === 1 && art.fans.length === 2, `${what}: ${art.screens.length} screens and ${art.fans.length} fans`);
  for (const [x, y, w, h] of art.screens) ok(w > 4 && h > 4 && x - art.ox >= 1 && y - art.oy >= 1 && x - art.ox + w < W && y - art.oy + h < H, `${what}: the screen at ${x},${y} ${w}x${h} is off the picture`);
  for (const [x, y] of art.fans) ok(x - art.ox >= 1 && y - art.oy >= 1 && x - art.ox + 6 < W && y - art.oy + 6 < H, `${what}: a fan at ${x},${y} is off the picture`);
  // nothing may touch the edge of the picture: the outline would be cut off
  for (const part of ['desk', 'chair', 'back']) {
    let edge = false;
    for (let x = 0; x < W; x++) if (art[part].data[x * 4 + 3] || art[part].data[((H - 1) * W + x) * 4 + 3]) edge = true;
    for (let y = 0; y < H; y++) if (art[part].data[(y * W) * 4 + 3] || art[part].data[(y * W + W - 1) * 4 + 3]) edge = true;
    ok(!edge, `${what}: the ${part} touches the edge of its picture`);
  }
  // the thing on the desk keeps clear of the pad, the keyboard, the mouse and the screen's stand
  const box = itemBox(desk);
  ok((desk.item === 'none') === (box === null), `${what}: ${desk.item} was ${box ? '' : 'not '}placed`);
  if (box) {
    for (const [name, other] of [['the pad', PAD_BOX], ['the keyboard', KEYS_BOX], ['the mouse', MOUSE_BOX], ...STANDS.map((s) => ['the stand', s])]) ok(!hits(box, other), `${what}: ${desk.item} sits on ${name}`);
    ok(box[0] >= 1 && box[0] + box[2] <= 49 && box[1] >= 0 && box[1] + box[3] <= 16, `${what}: ${desk.item} hangs off the desk top`);
  }
  return art;
}

const ACCENTS = ['#8f5fe0', '#e5484d', '#3fbf63', '#f2c81e', '#3b9fd0', '#f08a24', '#ffffff', '#000000'];
for (let n = 0; n < 300; n++) {
  const desk = tryTo(`randomDesk(${n})`, () => randomDesk(n * 40503 + 5));
  if (!desk) continue;
  ok(same(cleanDesk(desk), desk), `randomDesk(${n}) does not survive cleanDesk: ${JSON.stringify(desk)}`);
  ok(same(randomDesk(n * 40503 + 5), desk), `randomDesk(${n}) is not the same twice`);
  checkDesk(desk, ACCENTS[n % ACCENTS.length], `random desk ${n}`);
}

// every item, in every colour of light: it must only change dots on its own corner
const items = DESK_OPTIONS.items.map((x) => x.id);
const empty = checkDesk({ led: '', item: 'none' }, '#8f5fe0', 'an empty desk');
for (const item of items) for (const led of ['', ...DESK_OPTIONS.ledColors]) {
  const desk = { led, item };
  const art = checkDesk(desk, '#8f5fe0', `${item} with ${led || 'my own colour'}`);
  const box = itemBox(desk);
  if (!art || !empty || !box) continue;
  let changed = 0, stray = '';
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (empty.desk.data[i] === art.desk.data[i] && empty.desk.data[i + 1] === art.desk.data[i + 1] && empty.desk.data[i + 2] === art.desk.data[i + 2] && empty.desk.data[i + 3] === art.desk.data[i + 3]) continue;
    changed++;
    const px = [x + art.ox, y + art.oy, 1, 1];
    // its own dots, the soft edge round them, and the desk's outline where that soft edge touches it
    if (!hits(px, [box[0] - 2, box[1] - 2, box[2] + 4, box[3] + 4])) stray = `${px[0]},${px[1]} is outside its corner`;
  }
  ok(changed >= 12, `${item}: only ${changed} dots drawn`);
  ok(!stray, `${item}: ${stray}`);
}
ok(new Set(items.map((id) => bytes(drawDesk({ led: '', item: id }, '#e5484d').desk).toString('latin1'))).size === items.length, 'two items draw the same');
ok(items.length >= 17 && PET_OPTIONS.cat.pattern.length >= 8 && PET_OPTIONS.dog.pattern.length >= 7 && PET_OPTIONS.dog.build.length >= 3, 'a list of choices has shrunk');
// the lights: the chair's stripes take the desk's own colour if it has one, else the sitter's; the desk top never changes
const bare = { led: '', item: 'none' };
ok(!equal(drawDesk(bare, '#e5484d').back, drawDesk(bare, '#3fbf63').back) && equal(drawDesk(bare, '#e5484d').desk, drawDesk(bare, '#3fbf63').desk), 'the colour is not where it should be');
ok(equal(drawDesk({ led: '#3fbf63', item: 'none' }, '#e5484d').back, drawDesk(bare, '#3fbf63').back), 'a desk with its own light colour does not use it');
ok(ledOf({ led: '#3fbf63', item: 'mug' }, '#e5484d') === '#3fbf63' && ledOf(bare, '#e5484d') === '#e5484d' && ledOf(null, 'nonsense') === '#8f5fe0', 'ledOf picks the wrong colour');

if (problems.length) {
  console.error(`FAILED: ${problems.length}${problems.length >= 40 ? '+' : ''} problems in ${checks} checks`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(`ok: ${pets} pets and ${desks} desks drawn, ${checks} checks, no problems`);
