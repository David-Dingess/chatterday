// Which holiday the clubhouse is dressed for: by the date on the house's clock (client/src/clock.ts), or the day previewed with
// `?date=MM-DD` in the address (that day in this year), or `?date=YYYY-MM-DD` (a day in any year: Easter and
// Thanksgiving move). Pure date logic, no page: the outdoor scenes use it too, and scripts can test it.
//
// The windows (both ends included):
//   newyear       Dec 31 - Jan 1
//   valentine     Feb 7 - 14
//   stpatrick     Mar 14 - 17
//   easter        the Monday before Easter Sunday - Easter Sunday (computed)
//   july4         Jul 1 - 4
//   halloween     Oct 1 - 31 (the 31st is the night itself: scarier)
//   thanksgiving  the Monday - Sunday round the fourth Thursday of November (computed); Christmas wins from Dec 1
//   christmas     Dec 1 - 26 (presents under the tree from Dec 20; the 24th and 25th are the days themselves)
import { useEffect, useState } from 'react';
import { houseDate } from '../clock.ts';

export type Holiday = 'newyear' | 'valentine' | 'stpatrick' | 'easter' | 'july4' | 'halloween' | 'thanksgiving' | 'christmas';
/** A day: year, month (1-12), day of the month. */
export type Ymd = { y: number; m: number; d: number };
/** The holiday on a day, and how far into it: `peak` is the day itself (Halloween night, Christmas Eve and Day, New
 *  Year's Eve and Day, Easter Sunday, Thanksgiving Day, the 14th, the 17th, the 4th); `presents` is Christmas from the 20th. */
export type HolidayDay = { id: Holiday; peak: boolean; presents: boolean };

const serial = (y: number, m: number, d: number) => Math.round(Date.UTC(y, m - 1, d) / 86_400_000);

/** Easter Sunday in a year (Gregorian, the anonymous algorithm): [month, day]. */
export function easterSunday(y: number): [number, number] {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return [month, day];
}

/** Thanksgiving in the US: the fourth Thursday of November, its day of the month. */
export function thanksgivingDay(y: number): number {
  const first = new Date(Date.UTC(y, 10, 1)).getUTCDay();           // 0 Sunday .. 6 Saturday
  return 1 + ((4 - first + 7) % 7) + 21;
}

/** Reads a day: a Ymd, 'YYYY-MM-DD' or 'MM-DD' (that day in `year`, or this year). */
export function toYmd(day: Ymd | string, year = new Date().getFullYear()): Ymd | null {
  if (typeof day !== 'string') return day;
  const m = /^(?:(\d{4})-)?(\d\d)-(\d\d)$/.exec(day);
  return m ? { y: m[1] ? Number(m[1]) : year, m: Number(m[2]), d: Number(m[3]) } : null;
}

/** The holiday on a day, if any, and how far into it. */
export function holidayDay(day: Ymd | string): HolidayDay | null {
  const t = toYmd(day);
  if (!t) return null;
  const { y, m, d } = t, n = serial(y, m, d);
  const is = (id: Holiday, peak = false, presents = false): HolidayDay => ({ id, peak, presents });
  if ((m === 12 && d === 31) || (m === 1 && d === 1)) return is('newyear', true);
  if (m === 12 && d <= 26) return is('christmas', d === 24 || d === 25, d >= 20);
  if (m === 2 && d >= 7 && d <= 14) return is('valentine', d === 14);
  const [em, ed] = easterSunday(y), easter = serial(y, em, ed);
  if (n >= easter - 6 && n <= easter) return is('easter', n === easter);
  if (m === 3 && d >= 14 && d <= 17) return is('stpatrick', d === 17);
  if (m === 7 && d >= 1 && d <= 4) return is('july4', d === 4);
  if (m === 10) return is('halloween', d === 31);
  const tg = serial(y, 11, thanksgivingDay(y));
  if (n >= tg - 3 && n <= tg + 3) return is('thanksgiving', n === tg);
  return null;
}

/** The holiday on a day, if any. */
export function holidayOn(day: Ymd | string): Holiday | null {
  return holidayDay(day)?.id ?? null;
}

/** The day previewed in the address (`?date=MM-DD` or `?date=YYYY-MM-DD`), read once as the page loads. */
const FORCED = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('date');

/** Today on the house's clock (client/src/clock.ts), or the day the address previews: 'YYYY-MM-DD'. */
export function clubDay(now = new Date()): string {
  const real = houseDate(now);
  if (FORCED && /^\d\d-\d\d$/.test(FORCED)) return `${real.slice(0, 4)}-${FORCED}`;
  if (FORCED && /^\d{4}-\d\d-\d\d$/.test(FORCED)) return FORCED;
  return real;
}

/** The holiday today on the clubhouse clock (or the previewed day), kept up to date: the page re-renders only when the
 *  day changes (it is looked at once a minute; the same answer changes nothing). */
export function useHoliday(): HolidayDay | null {
  const [day, setDay] = useState(clubDay);
  useEffect(() => {
    const t = window.setInterval(() => setDay(clubDay()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  // (an object made fresh each render would be a new answer each time: keep it to the day's string)
  const [held] = useState(() => new Map<string, HolidayDay | null>());
  if (!held.has(day)) held.set(day, holidayDay(day));
  return held.get(day)!;
}
