// The weather outside the house's windows: the current conditions for the town the admin picked, from
// Open-Meteo (free, no key, anywhere in the world). The server asks every ten minutes and tells everyone;
// nobody's own app talks to a weather service. With no town picked there is no weather, and the house
// shows a fair sky.

export type Weather = {
  kind: 'clear' | 'clouds' | 'rain' | 'storm' | 'snow' | 'fog';
  /** How much of the sky is cloud, 0 to 1. */
  cover: number;
  text: string;
  /** In the unit the admin chose. */
  temp: number | null;
  unit: 'F' | 'C';
  at: number;
};
/** Where the house is: what the weather is read for, and whose clock the house keeps. */
export type Town = { name: string; lat: number; lon: number; tz: string };

// Open-Meteo reports the weather as a WMO code.
const CODES: [number[], Weather['kind'], string][] = [
  [[0], 'clear', 'Clear'], [[1], 'clear', 'Mostly clear'], [[2], 'clouds', 'Partly cloudy'], [[3], 'clouds', 'Overcast'],
  [[45, 48], 'fog', 'Fog'], [[51, 53, 55, 56, 57], 'rain', 'Drizzle'], [[61, 63, 65, 66, 67, 80, 81, 82], 'rain', 'Rain'],
  [[71, 73, 75, 77, 85, 86], 'snow', 'Snow'], [[95, 96, 99], 'storm', 'Thunderstorm'],
];

export async function fetchWeather(town: Town, unit: 'F' | 'C'): Promise<Weather | null> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${town.lat.toFixed(3)}&longitude=${town.lon.toFixed(3)}` +
      `&current=temperature_2m,weather_code,cloud_cover&temperature_unit=${unit === 'F' ? 'fahrenheit' : 'celsius'}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!r.ok) throw new Error(`Open-Meteo said ${r.status}`);
    const cur = (await r.json() as any).current ?? {};
    const [, kind, text] = CODES.find(([codes]) => codes.includes(Number(cur.weather_code))) ?? [[], 'clear', 'Clear'];
    const clouds = typeof cur.cloud_cover === 'number' ? Math.max(0, Math.min(1, cur.cloud_cover / 100)) : 0.4;
    const cover = kind === 'clear' ? Math.min(clouds, 0.3) : kind === 'clouds' ? Math.max(clouds, 0.5) : kind === 'fog' ? 0.7 : 1;
    return { kind, cover, text, temp: typeof cur.temperature_2m === 'number' ? Math.round(cur.temperature_2m) : null, unit, at: Date.now() };
  } catch (e: any) {
    console.error('[weather]', e.message);
    return null;
  }
}

/** Towns that match what the admin typed, for them to pick from. */
export async function findTowns(q: string): Promise<Town[]> {
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=6&language=en&format=json&name=${encodeURIComponent(q.slice(0, 60))}`, { signal: AbortSignal.timeout(12_000) });
  if (!r.ok) throw new Error(`Open-Meteo said ${r.status}`);
  const list = (await r.json() as any).results ?? [];
  return list.filter((t: any) => typeof t.latitude === 'number' && typeof t.longitude === 'number').map((t: any) => ({
    name: [t.name, t.admin1, t.country].filter(Boolean).join(', ').slice(0, 80), lat: t.latitude, lon: t.longitude, tz: validZone(t.timezone) ? t.timezone : 'UTC',
  }));
}

export function validZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length > 64) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

/** A town as it was saved, checked again on the way out. */
export function cleanTown(v: any): Town | null {
  if (!v || typeof v !== 'object' || typeof v.lat !== 'number' || typeof v.lon !== 'number' || Math.abs(v.lat) > 90 || Math.abs(v.lon) > 180) return null;
  return { name: String(v.name ?? '').slice(0, 80), lat: v.lat, lon: v.lon, tz: validZone(v.tz) ? v.tz : 'UTC' };
}
