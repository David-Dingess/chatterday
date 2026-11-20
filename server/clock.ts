// The clock the house keeps, the same for everybody: the night in the yard, the log's times, birthdays, holidays,
// seasons and the achievements that go by the hour all read it here. Which zone, first that is set and valid:
//   1. the one the admin picked in Settings → Admin (kv 'tz'; picking a weather town sets it to that town's),
//   2. CHATTERDAY_TZ in .env (an IANA name such as Europe/Berlin),
//   3. the host PC's own zone.
// The browser is sent the zone this works out (settings.tz) and keeps its clock by it (client/src/clock.ts).
import { getKV } from './db.ts';
import { validZone } from './weather.ts';

/** The host PC's own zone. */
export const hostZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
/** CHATTERDAY_TZ, when it is a zone this server knows. */
export const envZone = () => (validZone(process.env.CHATTERDAY_TZ) ? process.env.CHATTERDAY_TZ : '');
/** The zone the house keeps. */
export function houseZone(): string {
  const tz = getKV('tz');
  return validZone(tz) ? tz : envZone() || hostZone();
}

const formats = new Map<string, Intl.DateTimeFormat>();
function parts(at: number): Record<string, string> {
  const tz = houseZone();
  let f = formats.get(tz);
  if (!f) formats.set(tz, (f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' })));
  return Object.fromEntries(f.formatToParts(new Date(at)).map((x) => [x.type, x.value]));
}
/** The hour on the house's clock, 0 to 23. */
export const houseHour = (at = Date.now()) => Number(parts(at).hour) % 24;
/** The month on the house's clock, 1 to 12. */
export const houseMonth = (at = Date.now()) => Number(parts(at).month);
/** Today on the house's clock: ['2026', '11-18']. */
export const houseToday = (at = Date.now()) => { const p = parts(at); return [p.year, `${p.month}-${p.day}`] as const; };
