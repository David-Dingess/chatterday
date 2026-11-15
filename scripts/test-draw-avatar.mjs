// Checks the character drawing: node scripts/test-draw-avatar.mjs (exit code 1 if anything is wrong).
// It draws 300 random looks and every choice of every part, and makes sure each sheet is the right size, every
// frame has somebody in it, every choice really draws something of its own, and no look can make it throw. Then the
// headroom over every frame, the party hat that stands in it, the drink rows, where the app is told a hand or a
// drink is, the forearms of somebody gaming, and the sheet for the shower.
import { ART_FAULTS, SPRITE_ROWS, SPRITE_UP, drawFrame, drawNudeSheet, drawSheet, faceY, marksOf } from '../client/src/draw/avatar.ts';
import { LIGHT, hex, mix, rgb } from '../client/src/draw/kit.ts';
import { DEFAULT_LOOK, LOOK_OPTIONS, cleanLook, randomLook } from '../shared/look.ts';

const problems = [];
const fail = (msg) => { if (problems.length < 40) problems.push(msg); };
const F = 48, UP = SPRITE_UP, CH = F + UP, ROWS = SPRITE_ROWS.length;       // a cell is F wide and CH tall: UP rows of headroom, then the frame
const W = F * 8, H = CH * ROWS;
if (UP !== 18 || ROWS !== 18 || W !== 384 || H !== 66 * 18) fail(`a sheet should be 384 by ${66 * 18} (18 rows of 48 + 18): it is ${W} by ${H}, ${ROWS} rows of 48 + ${UP}`);
if (SPRITE_ROWS.join() !== 'walk_down,walk_left,walk_right,walk_up,idle,sit_front,sit_side,sit_back,gaming,sleep,gaming_back,dance,cheer,reach,punch,floored,drink,drink_sit') fail('the rows are not in the order the app counts on: ' + SPRITE_ROWS.join());
let sheets = 0;
const rowOf = (name) => SPRITE_ROWS.indexOf(name);
/** A dot of a sheet: row `r`, column `i`, and (x, y) in that frame; y is negative in the headroom. */
const at = (pic, r, i, x, y) => ((r * CH + UP + y) * pic.w + i * F + x) * 4;
const dot = (pic, r, i, x, y) => pic.data[at(pic, r, i, x, y) + 3] > 0;
const colour = (pic, r, i, x, y) => { const k = at(pic, r, i, x, y); return pic.data[k + 3] ? hex([pic.data[k], pic.data[k + 1], pic.data[k + 2]]) : ''; };
/** The highest drawn row of a frame (negative: in the headroom), or 99 for an empty one. */
const topOf = (pic, r, i) => { for (let y = -UP; y < F; y++) for (let x = 0; x < F; x++) if (dot(pic, r, i, x, y)) return y; return 99; };

/** Draws a sheet and checks it. Returns a fingerprint of its dots, to tell sheets apart. */
function check(look, accent, what) {
  let pic;
  try { pic = drawSheet(look, accent); } catch (e) { fail(`${what}: threw ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e}`); return ''; }
  sheets++;
  if (pic.w !== W || pic.h !== H || pic.data.length !== W * H * 4) { fail(`${what}: sheet is ${pic.w}x${pic.h}`); return ''; }
  for (let r = 0; r < ROWS; r++) for (let i = 0; i < 8; i++) {
    let n = 0;
    for (let y = 0; y < F; y++) for (let x = 0; x < F; x++) if (dot(pic, r, i, x, y)) n++;
    if (n < 40) fail(`${what}: ${SPRITE_ROWS[r]} frame ${i} has only ${n} dots`);
    // Nothing may reach the top of a cell: more of it would have been cut off.
    for (let x = 0; x < F; x++) if (dot(pic, r, i, x, -UP)) { fail(`${what}: ${SPRITE_ROWS[r]} frame ${i} reaches the top of its headroom`); break; }
  }
  let h = 2166136261;
  for (let i = 0; i < pic.data.length; i++) h = Math.imul(h ^ pic.data[i], 16777619);
  return String(h >>> 0);
}

if (ART_FAULTS.length) fail('art rows of the wrong width: ' + ART_FAULTS.slice(0, 3).join('; '));

// 300 random looks. Each must already be clean, and come out the same from the same seed.
const accents = ['#8b6be0', '#3fbf63', '#ff8f2e', '#ff6fb7', '#3b82f6', '#e5484d'];
for (let seed = 0; seed < 300; seed++) {
  const look = randomLook(seed);
  if (JSON.stringify(look) !== JSON.stringify(randomLook(seed))) fail(`randomLook(${seed}) is not the same twice`);
  if (JSON.stringify(cleanLook(look)) !== JSON.stringify(look)) fail(`randomLook(${seed}) is changed by cleanLook: ${JSON.stringify(look)}`);
  check(look, accents[seed % accents.length], `random look ${seed}`);
}

// Every choice of every part, on the default character. Two choices that draw the same sheet mean one of them is
// not really drawn, so each list's sheets must all be different.
const O = LOOK_OPTIONS, base = cleanLook(DEFAULT_LOOK);
const parts = {
  body: (id) => ({ ...base, body: id }), height: (id) => ({ ...base, height: id }),
  eyes: (id) => ({ ...base, eyes: id }), brows: (id) => ({ ...base, brows: id }), mouth: (id) => ({ ...base, mouth: id }), marks: (id) => ({ ...base, marks: id }),
  hair: (id) => ({ ...base, hair: { ...base.hair, style: id } }),
  facial: (id) => ({ ...base, facial: { ...base.facial, style: id } }),
  top: (id) => ({ ...base, top: { ...base.top, kind: id, color2: '#f4d03f' } }),
  pattern: (id) => ({ ...base, top: { kind: 'tee', color: '#2a9d8f', pattern: id, color2: '#f4d03f' } }),
  bottom: (id) => ({ ...base, bottom: { ...base.bottom, kind: id } }),
  shoes: (id) => ({ ...base, shoes: { kind: id, color: '#d8473f' } }),
  hat: (id) => ({ ...base, hat: { kind: id, color: '#d8473f' } }),
  glasses: (id) => ({ ...base, glasses: id }),
};
let choices = 0;
for (const [part, make] of Object.entries(parts)) {
  const seen = new Map();
  for (const opt of O[part]) {
    choices++;
    const look = make(opt.id);
    if (JSON.stringify(cleanLook(look)) !== JSON.stringify(look)) fail(`${part} ${opt.id} does not pass cleanLook`);
    const print = check(look, '#8b6be0', `${part} ${opt.id}`);
    if (seen.has(print)) fail(`${part} ${opt.id} draws exactly like ${seen.get(print)}`);
    seen.set(print, opt.id);
  }
}
const bare = check(base, '#8b6be0', 'no extras');
for (const opt of O.extras) {
  choices++;
  if (check({ ...base, extras: [opt.id] }, '#8b6be0', `extra ${opt.id}`) === bare) fail(`extra ${opt.id} draws nothing`);
}
for (const list of [O.skinColors, O.hairColors, O.eyeColors, O.clothColors]) for (const c of list) if (!/^#[0-9a-f]{6}$/.test(c)) fail(`bad colour ${c}`);
for (const c of O.skinColors) check({ ...base, skin: c, eyes: 'happy' }, '#8b6be0', `skin ${c}`);
// Everything at once, on the biggest and the smallest body.
check({ ...base, body: 'stocky', height: 'xtall', hair: { style: 'afro_big', color: '#1d1a20' }, hat: { kind: 'wizard', color: '#8b6be0' }, glasses: 'goggles', extras: ['cape', 'wings', 'tail', 'backpack'] }, '#ffffff', 'big and busy');
check({ ...base, body: 'slim', height: 'short', hair: { style: 'long_curly', color: '#f1f1f4' }, hat: { kind: 'hijab', color: '#2b3a67' }, top: { kind: 'dress', color: '#000000', pattern: 'tiedye' }, bottom: { kind: 'longskirt', color: '#ffffff' }, extras: ['scarf', 'mask', 'earrings', 'flower'] }, '#000000', 'small and busy');

// One frame on its own must be the same dots as that frame on the sheet.
{
  const look = randomLook(7), sheet = drawSheet(look, '#3fbf63');
  SPRITE_ROWS.forEach((row, r) => {
    for (const i of [0, 3, 5]) {
      const one = drawFrame(look, '#3fbf63', row, i);
      if (one.w !== F || one.h !== CH || one.data.length !== F * CH * 4) fail(`drawFrame ${row} ${i} is ${one.w}x${one.h}`);
      for (let y = 0; y < CH; y++) for (let x = 0; x < F * 4; x++) if (one.data[y * F * 4 + x] !== sheet.data[((r * CH + y) * W + i * F) * 4 + x]) { fail(`drawFrame ${row} ${i} differs from the sheet`); return; }
    }
  });
  for (const h of O.height) { const y = faceY({ ...base, height: h.id }); if (!(y >= 0 && y <= 24)) fail(`faceY for ${h.id} is ${y}`); }
}

// ── the headroom: only what should stand in it does ──
{
  // Standing still with no hat, nobody is more than their hair taller than the frame; the turned (floored) frame never is.
  for (let seed = 0; seed < 60; seed++) {
    const look = { ...randomLook(seed), hat: { kind: 'none', color: '#d8473f' } }, pic = drawSheet(look, '#8b6be0');
    for (const name of ['idle', 'walk_left', 'walk_up', 'sit_front', 'drink', 'drink_sit']) if (topOf(pic, rowOf(name), 0) < -2) fail(`look ${seed} with no hat is in the headroom in ${name}: row ${topOf(pic, rowOf(name), 0)}`);
    for (let i = 0; i < 8; i++) if (topOf(pic, rowOf('floored'), i) < 0) fail(`look ${seed}: floored frame ${i} is in the headroom`);
  }
  // A party hat stands on top of the hair: it goes higher than the same person without it, whatever their hair,
  // from the front, the side and the back; at the top of a jump it is still all there; on the floor it is cut off.
  for (const opt of O.hair) {
    const plain = { ...base, height: 'xtall', hair: { ...base.hair, style: opt.id } }, party = { ...plain, hat: { kind: 'party', color: '#f2c230' } };
    const a = drawSheet(plain, '#8b6be0'), b = drawSheet(party, '#8b6be0');
    for (const name of ['idle', 'walk_left', 'walk_up']) {
      const r = rowOf(name), rise = topOf(a, r, 0) - topOf(b, r, 0);
      if (rise < 3 || rise > 7) fail(`party hat on ${opt.id} hair, ${name}: it stands ${rise} rows over the hair (it is eight rows tall, and its rim is a row down into the hair under its middle)`);
    }
    if (topOf(b, rowOf('idle'), 0) >= 0) fail(`party hat on ${opt.id} hair does not reach the headroom on the tallest body`);
    if (topOf(b, rowOf('cheer'), 2) !== topOf(b, rowOf('idle'), 0) - 6) fail(`party hat on ${opt.id} hair: the jump is ${topOf(b, rowOf('idle'), 0) - topOf(b, rowOf('cheer'), 2)} rows, not 6`);
    for (let i = 0; i < 8; i++) if (topOf(b, rowOf('floored'), i) < 0) fail(`party hat on ${opt.id} hair: floored frame ${i} is in the headroom`);
    for (let r = 0; r < ROWS; r++) for (let i = 0; i < 8; i++) if (topOf(b, r, i) <= -UP) fail(`party hat on ${opt.id} hair: ${SPRITE_ROWS[r]} frame ${i} reaches the top of its headroom`);
  }
}

// ── the drink rows, and where the app is told things are ──
{
  // The numbers the earlier Python version of this drawing code gave for its own people (half a torso of 9 on legs of 8; 8 on 6).
  const m98 = marksOf({ ...base, body: 'broad', height: 'tall' }), m86 = marksOf({ ...base, body: 'medium', height: 'short' });
  if (JSON.stringify([m98.faceY, m98.hand, m98.drink]) !== '[3,[34,33],{"hold":[29,30],"sip":[31,26],"sit":1}]') fail('marksOf broad and tall: ' + JSON.stringify(m98));
  if (JSON.stringify([m86.faceY, m86.hand, m86.drink]) !== '[5,[33,35],{"hold":[28,32],"sip":[30,28],"sit":0}]') fail('marksOf medium and short: ' + JSON.stringify(m86));
  for (let seed = 0; seed < 80; seed++) {
    const look = { ...randomLook(seed), extras: [] }, m = marksOf(look), pic = drawSheet(look, '#8b6be0'), what = `look ${seed} (${look.body}, ${look.height})`;
    if (m.skin !== look.skin) fail(`${what}: marks say skin ${m.skin}, the look ${look.skin}`);
    if (m.faceY !== faceY(look)) fail(`${what}: marks faceY ${m.faceY}, faceY() ${faceY(look)}`);
    // The fist is skin where the marks say its middle is: held (frames 0, 1) and sipping (2, 3), standing and sitting,
    // and a dot lower in the second frame of each pair.
    for (const [name, down] of [['drink', 0], ['drink_sit', m.drink.sit]]) for (let i = 0; i < 8; i++) {
      const [x, y] = i % 4 < 2 ? m.drink.hold : m.drink.sip, c = colour(pic, rowOf(name), i, x, y + down + (i % 2));
      if (c !== look.skin) fail(`${what}: ${name} frame ${i}: the fist should be at ${x},${y + down + (i % 2)}, but that dot is ${c || 'empty'}`);
    }
    // A hand hanging at their side: skin just above its last row, and the arm does not go on below it.
    const [hx, hy] = m.hand, r = rowOf('idle');
    if (!dot(pic, r, 0, hx, hy) || colour(pic, r, 0, hx, hy - 1) !== look.skin) fail(`${what}: no hand at ${hx},${hy}`);
    if (colour(pic, r, 0, hx, hy + 2) === look.skin) fail(`${what}: the arm goes on below the hand at ${hx},${hy}`);
    if (topOf(pic, rowOf('drink'), 1) !== topOf(pic, rowOf('drink'), 0) + 1 || topOf(pic, rowOf('drink_sit'), 3) !== topOf(pic, rowOf('drink_sit'), 2) + 1) fail(`${what}: the drink frames do not breathe`);
  }
  // Gaming: a forearm joins the elbow to the hand on the controller, on both sides. Its first row is lit, and starts
  // a third of the way in from the arm: bare skin under a short sleeve, the sleeve itself when that is long.
  for (const top of ['tee', 'long', 'tank']) for (const b of O.body) {
    const look = { ...base, body: b.id, top: { ...base.top, kind: top, color: '#2a9d8f' } }, pic = drawSheet(look, '#8b6be0'), m = marksOf(look);
    const lit = hex(mix(rgb(top === 'long' ? '#2a9d8f' : look.skin), LIGHT, 0.30));
    const ax = m.hand[0] - 1, y = m.hand[1] - 9 + m.drink.sit + 6;            // the right arm's left column, and the row under the elbow, sitting
    const fx = Math.round(ax + (29 - ax) / 3), mx = 47 - fx - 2;              // where that row starts, on the right and on the left
    for (const [side, x0] of [['right', fx], ['left', mx]]) for (const x of [x0, x0 + 1, x0 + 2]) {
      const edge = top === 'long' && x === (side === 'right' ? x0 : x0 + 2);   // (a long sleeve has its shaded edge there)
      if (!edge && colour(pic, rowOf('gaming'), 0, x, y) !== lit) fail(`gaming, ${b.id} in a ${top}: no ${side} forearm at ${x},${y} (${colour(pic, rowOf('gaming'), 0, x, y) || 'empty'}, not ${lit})`);
    }
  }
}

// ── the sheet for the shower ──
{
  const STANDING = ['walk_down', 'walk_left', 'walk_right', 'walk_up', 'idle', 'dance', 'cheer', 'reach', 'punch'];
  let fewest = 99;
  for (let seed = 0; seed < 40; seed++) {
    const look = randomLook(seed), accent = accents[seed % accents.length], what = `shower sheet of look ${seed}`;
    let pic;
    try { pic = drawNudeSheet(look, accent); } catch (e) { fail(`${what}: threw ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e}`); continue; }
    if (pic.w !== W || pic.h !== H || pic.data.length !== W * H * 4) { fail(`${what}: it is ${pic.w}x${pic.h}`); continue; }
    for (let r = 0; r < ROWS; r++) for (let i = 0; i < 8; i++) { let n = 0; for (let y = 0; y < F; y++) for (let x = 0; x < F; x++) if (dot(pic, r, i, x, y)) n++; if (n < 40) fail(`${what}: ${SPRITE_ROWS[r]} frame ${i} has only ${n} dots`); }
    // Nothing on: whatever they were wearing, it comes out the same.
    const other = drawNudeSheet({ ...look, hat: { kind: 'party', color: '#d8473f' }, glasses: 'shades', extras: ['cape', 'scarf'], top: { kind: 'hoodie', color: '#000000', pattern: 'camo', color2: '#ff00ff' }, bottom: { kind: 'jeans', color: '#000000' }, shoes: { kind: 'boots', color: '#000000' } }, accent);
    for (let k = 0; k < pic.data.length; k++) if (pic.data[k] !== other.data[k]) { fail(`${what}: clothes, a hat, glasses or extras change it`); break; }
    // And it is the same head as with clothes on (and no hat, glasses or extras), down to the chin.
    const m = marksOf(look), hip = m.hand[1] - 1, r = rowOf('idle');
    const dressed = drawSheet({ ...look, hat: { kind: 'none', color: '#d8473f' }, glasses: 'none', extras: [], top: { kind: 'tee', color: '#2a9d8f', pattern: 'plain' } }, accent);
    same: for (let y = -UP; y < hip - 14; y++) for (let x = 0; x < F; x++) if (colour(pic, r, 0, x, y) !== colour(dressed, r, 0, x, y)) { fail(`${what}: the head is not the same as with clothes on (at ${x},${y})`); break same; }
    // The squares: over the hips in every standing frame, each a flat 2 by 2, one of them in a grey no skin has; and none anywhere else.
    const grey = hex(mix(rgb(look.skin), [150, 150, 160], 0.5));
    for (let rr = 0; rr < ROWS; rr++) for (let i = 0; i < 8; i++) {
      const name = SPRITE_ROWS[rr], dy = name === 'cheer' ? [0, -3, -6, -3][i % 4] : 0;
      let whole = 0, greys = 0;
      for (let by = hip - 3; by < hip + 5; by += 2) for (let bx = 18; bx < 30; bx += 2) {
        const c = colour(pic, rr, i, bx, by + dy);
        if (c && colour(pic, rr, i, bx + 1, by + dy) === c && colour(pic, rr, i, bx, by + dy + 1) === c && colour(pic, rr, i, bx + 1, by + dy + 1) === c) whole++;
      }
      for (let y = -UP; y < F; y++) for (let x = 0; x < F; x++) if (colour(pic, rr, i, x, y) === grey) greys++;
      if (STANDING.includes(name)) { fewest = Math.min(fewest, whole); if (whole < 12 || !greys) fail(`${what}: ${name} frame ${i} has ${whole} whole squares over the hips, ${greys} grey dots`); }
      else if (greys) fail(`${what}: ${name} frame ${i} is not a standing frame, and has squares on it`);
    }
  }
  if (fewest === 99) fail('no shower sheet was checked');
}

// cleanLook has to survive anything, give back a whole look every time, and the drawing has to accept what it gives.
const cyclic = {}; cyclic.self = cyclic; cyclic.hair = cyclic;
const junk = [null, undefined, 42, 'look', true, [], [1, 2, 3], {}, { hair: 7 }, { hair: null, top: [], extras: 'cape' }, cyclic,
  { hair: { style: {}, color: 12 }, top: { kind: ['tee'], color: '#GGGGGG', pattern: null, color2: 'red' }, extras: [null, 3, {}, 'cape', 'cape', 'wings', 'tail', 'scarf', 'mask', 'nope'] },
  { skin: '#ABCDEF', eyeColor: 'abcdef', body: 'giant', height: 9, extras: { length: 3 } }, Object.create(null), new Proxy({}, { get() { throw new Error('boom'); } }),
  () => 1, Symbol('x'), 10n, new Date(), JSON.parse('{"__proto__":{"skin":"#000000"},"hat":{"kind":"party","color":"#12AB9f"}}')];
const keys = Object.keys(DEFAULT_LOOK).sort().join();
junk.forEach((j, n) => {
  let look;
  try { look = cleanLook(j); } catch (e) { fail(`cleanLook threw on junk ${n}: ${e}`); return; }
  if (Object.keys(look).sort().join() !== keys) fail(`cleanLook(junk ${n}) is missing parts`);
  if (look.extras.length > O.maxExtras || new Set(look.extras).size !== look.extras.length) fail(`cleanLook(junk ${n}) extras are wrong: ${look.extras}`);
  if (JSON.stringify(cleanLook(look)) !== JSON.stringify(look)) fail(`cleanLook(junk ${n}) is not stable`);
  check(look, n % 2 ? 'not a colour' : '#8b6be0', `cleaned junk ${n}`);
});
if (cleanLook({ skin: '#ABCDEF' }).skin !== '#abcdef') fail('colours are not lower-cased');
if (cleanLook(junk[11]).extras.join() !== 'cape,wings,tail,scarf') fail('extras are not deduped and capped: ' + cleanLook(junk[11]).extras);
if (cleanLook(junk[junk.length - 1]).hat.color !== '#12ab9f' || cleanLook(junk[junk.length - 1]).skin !== DEFAULT_LOOK.skin) fail('a look from JSON is not read properly');

if (problems.length) {
  console.error(`FAILED: ${problems.length}${problems.length >= 40 ? '+' : ''} problem(s)\n  ` + problems.join('\n  '));
  process.exit(1);
}
console.log(`ok: ${sheets} sheets (300 random looks, ${choices} choices across ${Object.keys(parts).length + 1} parts, ${junk.length} junk inputs), each ${W}x${H} (${ROWS} rows of 48 + ${UP}) with ${ROWS * 8} filled frames; party hats on ${O.hair.length} hair styles, the drink rows and marks of 80 looks, gaming forearms, and 40 shower sheets`);
