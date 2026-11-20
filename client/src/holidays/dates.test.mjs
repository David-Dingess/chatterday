import assert from 'node:assert/strict';

// Run: node client/src/holidays/dates.test.mjs (Easter and Thanksgiving checked against published dates, and every window's edges)
const D = await import(new URL('./dates.ts', import.meta.url).href);
let n = 0;
const eq = (a, b, what) => { assert.deepEqual(a, b, what); n++; };
// Easter Sundays, 2026-2030 (published tables)
const EASTER = { 2026: [4, 5], 2027: [3, 28], 2028: [4, 16], 2029: [4, 1], 2030: [4, 21], 2019: [4, 21], 2024: [3, 31], 2025: [4, 20] };
for (const [y, md] of Object.entries(EASTER)) eq(D.easterSunday(Number(y)), md, `easter ${y}`);
// Thanksgiving, 2026-2030
const TG = { 2026: 26, 2027: 25, 2028: 23, 2029: 22, 2030: 28, 2024: 28, 2025: 27 };
for (const [y, d] of Object.entries(TG)) eq(D.thanksgivingDay(Number(y)), d, `thanksgiving ${y}`);
const on = (s) => D.holidayOn(s);
// Easter window: Monday before .. Sunday
for (const [y, [m, d]] of Object.entries(EASTER)) {
  const sun = Date.UTC(Number(y), m - 1, d), fmt = (t) => new Date(t).toISOString().slice(0, 10);
  eq(on(fmt(sun)), 'easter', `easter day ${y}`);
  eq(on(fmt(sun - 6 * 864e5)), 'easter', `easter monday-before ${y}`);
  eq(on(fmt(sun - 7 * 864e5)) === 'easter', false, `palm sunday not ${y}`);
  eq(on(fmt(sun + 864e5)), null, `easter monday after ${y}`);
  eq(D.holidayDay(fmt(sun)).peak, true, `easter peak ${y}`);
}
for (const [y, d] of Object.entries(TG)) {
  eq(on(`${y}-11-${d}`), 'thanksgiving', `tg ${y}`);
  eq(on(`${y}-11-${String(d - 3).padStart(2, '0')}`), 'thanksgiving', `tg mon ${y}`);
  eq(on(`${y}-11-${String(d - 4).padStart(2, '0')}`), null, `tg sun-before ${y}`);
  eq(D.holidayDay(`${y}-11-${d}`).peak, true, `tg peak ${y}`);
}
eq(on('2030-12-01'), 'christmas', 'christmas wins dec 1 (tg 2030 is the 28th: its sunday is dec 1)');
eq(on('2030-11-30'), 'thanksgiving', 'tg saturday');
// fixed windows
const cases = [
  ['2026-12-31', 'newyear'], ['2027-01-01', 'newyear'], ['2027-01-02', null], ['2026-12-30', null],
  ['2027-02-06', null], ['2027-02-07', 'valentine'], ['2027-02-14', 'valentine'], ['2027-02-15', null],
  ['2027-03-13', null], ['2027-03-14', 'stpatrick'], ['2027-03-17', 'stpatrick'], ['2027-03-18', null],
  ['2027-06-30', null], ['2027-07-01', 'july4'], ['2027-07-04', 'july4'], ['2027-07-05', null],
  ['2027-09-30', null], ['2027-10-01', 'halloween'], ['2027-10-31', 'halloween'], ['2027-11-01', null],
  ['2027-11-30', null], ['2027-12-01', 'christmas'], ['2027-12-26', 'christmas'], ['2027-12-27', null],
];
for (const [s, h] of cases) eq(on(s), h, s);
eq(D.holidayDay('2027-10-31').peak, true, 'halloween night'); eq(D.holidayDay('2027-10-30').peak, false, 'halloween 30th');
eq(D.holidayDay('2027-12-19').presents, false, 'no presents 19th'); eq(D.holidayDay('2027-12-20').presents, true, 'presents 20th');
eq(D.holidayDay('2027-12-25').peak, true, 'xmas day');
// MM-DD reads as this year
eq(D.toYmd('12-25', 2031), { y: 2031, m: 12, d: 25 }, 'mm-dd');
eq(on('bad'), null, 'bad');
// every day of 2026-2030 answers without throwing, and every holiday shows up each year
for (let y = 2026; y <= 2030; y++) {
  const seen = new Set();
  for (let t = Date.UTC(y, 0, 1); t < Date.UTC(y + 1, 0, 1); t += 864e5) { const h = on(new Date(t).toISOString().slice(0, 10)); if (h) seen.add(h); }
  eq(seen.size, 8, `all eight in ${y}`);
}
console.log(`ok: ${n} checks`);
