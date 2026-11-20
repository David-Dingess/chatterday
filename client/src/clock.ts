// The house's clock in the browser: the zone the server keeps (server/clock.ts: the admin's pick, CHATTERDAY_TZ, or the
// host PC's own), sent as settings.tz and passed in here by the store. Nothing here imports the store, so plain
// modules (and their tests under node) can read the clock too. Until the server has said, the browser's own zone.
let zone = '';
const formats = new Map<string, Intl.DateTimeFormat>();

/** Called by the store whenever the server's settings arrive. An unknown zone is ignored. */
export function setHouseZone(tz: string | undefined) {
  if (!tz || tz === zone) return;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); zone = tz; } catch { /* keep the one we have */ }
}
/** The zone the house keeps ('' until the server has said: the browser's own). */
export const houseZone = () => zone;

/** A formatter on the house's clock, made once per zone and kind. */
export function houseFormat(kind: string, how: Intl.DateTimeFormatOptions, locale = 'en-US'): Intl.DateTimeFormat {
  const key = `${kind}|${locale}|${zone}`;
  let f = formats.get(key);
  if (!f) formats.set(key, (f = new Intl.DateTimeFormat(locale, { ...how, timeZone: zone || undefined })));
  return f;
}
const parts = (d: Date) => Object.fromEntries(houseFormat('parts', { year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }, 'en-CA').formatToParts(d).map((p) => [p.type, p.value]));
/** The hour and minute on the house's clock. */
export function houseHM(d = new Date()): [number, number] { const p = parts(d); return [Number(p.hour) % 24, Number(p.minute)]; }
/** Today on the house's clock: 'YYYY-MM-DD'. */
export function houseDate(d = new Date()): string { const p = parts(d); return `${p.year}-${p.month}-${p.day}`; }
