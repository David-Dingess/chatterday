// Soundboard clips and the little join/leave tones. Everything here plays locally on each listener's PC.
import { hooks, soundGain, useStore } from './store';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;       // the soundboard volume slider, live
let silent = false;                       // the desktop app sets this while its window is closed to the tray
type Clip = { buffer: AudioBuffer; gain: number; from: number; length: number };

/** Where a sound really starts and ends. The dead air before and after it is skipped when it plays, so a button
 *  answers at once and nothing hangs on in silence. Done for every sound, however it got here; the file is not touched. */
function trim(buffer: AudioBuffer, peak: number) {
  const n = buffer.length, rate = buffer.sampleRate;
  const chans = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const loud = (i: number, level: number) => { for (const d of chans) if (Math.abs(d[i]) > level) return true; return false; };
  const head = Math.max(0.003, peak * 0.01), tail = Math.max(0.0015, peak * 0.004);      // a lower line at the end, so a fade or an echo is kept
  let a = 0, b = n - 1;
  while (a < n && !loud(a, head)) a++;
  if (a >= n) return { from: 0, length: buffer.duration };          // nothing but silence: leave it be
  while (b > a && !loud(b, tail)) b--;
  a = Math.max(0, a - Math.round(rate * 0.01));
  b = Math.min(n - 1, b + Math.round(rate * 0.08));
  return { from: a / rate, length: (b - a + 1) / rate };
}
/** A clip too spiky to reach the target by turning it up alone (a clap: all peaks and little body) has its peaks held
 *  down as it is turned up. The gain looks 5 ms ahead, so it is already down when a peak arrives, eases down over
 *  those 5 ms, and lets go over 80 ms. Done once, when the clip is first loaded; the file is not touched. */
function limited(buffer: AudioBuffer, gain: number): AudioBuffer {
  const n = buffer.length, rate = buffer.sampleRate;
  const chans = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const look = Math.max(1, Math.round(rate * 0.005));
  const need = new Float32Array(n);                 // the most each moment may be multiplied by, on top of `gain`
  for (let i = 0; i < n; i++) {
    let p = 0;
    for (const d of chans) p = Math.max(p, Math.abs(d[i]));
    need[i] = p * gain > PEAK_CEILING ? PEAK_CEILING / (p * gain) : 1;
  }
  const low = new Float32Array(n);                  // the lowest of those over the last 5 ms (a sliding minimum)
  const queue = new Int32Array(n);
  let head = 0, tail = 0;
  for (let j = 0; j < n; j++) {
    while (tail > head && need[queue[tail - 1]] >= need[j]) tail--;
    queue[tail++] = j;
    if (queue[head] < j - look) head++;
    low[j] = need[queue[head]];
  }
  const env = new Float32Array(n);
  const letGo = 1 - Math.exp(-1 / (rate * 0.08));
  let r = 1;
  for (let i = 0; i < n; i++) {                     // read 5 ms ahead; drop at once, come back slowly
    const g = low[Math.min(n - 1, i + look)];
    r = g < r ? g : r + (g - r) * letGo;
    env[i] = r;
  }
  const out = ac().createBuffer(chans.length, n, rate);
  const smooth = new Float32Array(n);               // and averaged over the same 5 ms, so the gain never jumps
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += env[i];
    if (i >= look) sum -= env[i - look];
    smooth[i] = sum / Math.min(i + 1, look);
  }
  for (let c = 0; c < chans.length; c++) {
    const d = chans[c], o = out.getChannelData(c);
    for (let i = 0; i < n; i++) o[i] = d[i] * gain * smooth[i];
  }
  return out;
}
const clips = new Map<string, Promise<Clip>>();

/** How much of their level music and clips keep while somebody else is talking. */
export const DUCK = 0.3;
const TARGET_LUFS = -16;                  // every clip is brought to about this loudness
const PEAK_CEILING = 0.89;                // and never pushed past -1 dB

function level() {
  const s = useStore.getState();
  return silent || (s.voice.deafened && s.voice.channelId != null) ? 0 : soundGain(s.prefs.soundVol) * (s.ducked ? DUCK : 1);       // deafened: clips already playing go quiet too
}

// The sound engine rests once nothing has played for half a minute, and wakes for the next sound. Left running it
// goes on producing silence, and holds the PC's sound device open, for as long as the app is open: all day, mostly.
let restTimer = 0, playingUntil = 0;
function rest() {
  const left = playingUntil - Date.now();
  if (left > 0) restTimer = window.setTimeout(rest, left + 1000);         // a long clip is still going
  else void ctx?.suspend().catch(() => {});
}
function ac() {
  ctx ??= new AudioContext();
  void ctx.resume().catch(() => {});        // (always asked, not only when it says it is resting: it may be on its way there)
  window.clearTimeout(restTimer);
  restTimer = window.setTimeout(rest, 30_000);
  const out = useStore.getState().prefs.outId;
  const c = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void>; sinkId?: string };
  if (c.setSinkId && (c.sinkId ?? '') !== out) c.setSinkId(out).catch(() => {});
  if (!master) {
    master = ctx.createGain();
    master.gain.value = level();
    master.connect(ctx.destination);
  }
  return ctx;
}
const setMaster = () => { if (master && ctx) master.gain.setTargetAtTime(level(), ctx.currentTime, 0.06); };
useStore.subscribe((s, prev) => { if (s.prefs.soundVol !== prev.prefs.soundVol || s.ducked !== prev.ducked || s.voice.deafened !== prev.voice.deafened || s.voice.channelId !== prev.voice.channelId) setMaster(); });

// Ducking: while anyone else in my voice chat is talking, `ducked` is on; it lets go a moment after they stop.
let release = 0;
useStore.subscribe((s, prev) => {
  if (s.voice.speaking === prev.voice.speaking && s.prefs.duck === prev.prefs.duck && s.voice.channelId === prev.voice.channelId) return;
  const talking = s.prefs.duck && s.voice.channelId != null && Object.keys(s.voice.speaking).some((id) => id !== s.me?.id);
  if (talking) {
    window.clearTimeout(release);
    release = 0;
    if (!s.ducked) useStore.setState({ ducked: true });
  } else if (s.ducked && !release) {        // (a wait already under way is left to finish: my own voice starting and stopping must not put it off)
    release = window.setTimeout(() => { release = 0; useStore.setState({ ducked: false }); }, 900);
  }
});

/** No sound at all while this is on: clips already playing are cut, and nothing new starts. */
export function setSilent(on: boolean) {
  silent = on;
  setMaster();
}

/**
 * How loud a clip is, in LUFS (the broadcast measure of loudness): filtered the way hearing is, measured in
 * 400 ms blocks, quiet blocks ignored. Clips shorter than a block are measured whole.
 */
async function loudness(buffer: AudioBuffer): Promise<number> {
  const off = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  const src = off.createBufferSource();
  src.buffer = buffer;
  const shelf = off.createBiquadFilter();
  shelf.type = 'highshelf'; shelf.frequency.value = 1500; shelf.gain.value = 4;
  const high = off.createBiquadFilter();
  high.type = 'highpass'; high.frequency.value = 38; high.Q.value = 0.5;
  src.connect(shelf).connect(high).connect(off.destination);
  src.start();
  const weighted = await off.startRendering();
  const block = Math.round(0.4 * weighted.sampleRate), hop = Math.round(block / 4);
  const powers: number[] = [];
  const power = (from: number, to: number) => {
    let sum = 0;
    for (let ch = 0; ch < weighted.numberOfChannels; ch++) {
      const d = weighted.getChannelData(ch);
      let s = 0;
      for (let i = from; i < to; i++) s += d[i] * d[i];
      sum += s / Math.max(1, to - from);
    }
    return sum;
  };
  if (weighted.length <= block) powers.push(power(0, weighted.length));
  else for (let at = 0; at + block <= weighted.length; at += hop) powers.push(power(at, at + block));
  const lufs = (p: number) => -0.691 + 10 * Math.log10(Math.max(p, 1e-12));
  const mean = (list: number[]) => list.reduce((a, b) => a + b, 0) / Math.max(1, list.length);
  let kept = powers.filter((p) => lufs(p) > -70);
  if (!kept.length) return -70;
  const gate = lufs(mean(kept)) - 10;
  kept = kept.filter((p) => lufs(p) > gate);
  return lufs(mean(kept.length ? kept : powers));
}

function load(url: string) {
  let p = clips.get(url);
  if (!p) {
    p = fetch(url).then((r) => r.arrayBuffer()).then((b) => ac().decodeAudioData(b)).then(async (buffer) => {
      let peak = 0;
      for (let ch = 0; ch < buffer.numberOfChannels; ch++) { const d = buffer.getChannelData(ch); for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i])); }
      const was = await loudness(buffer);
      const want = Math.min(10 ** ((TARGET_LUFS - was) / 20), 8);
      const cut = trim(buffer, peak);
      if (buffer.duration - cut.length > 0.05) console.debug(`[sfx] ${url}: skipping ${cut.from.toFixed(2)}s of silence at the start and ${(buffer.duration - cut.from - cut.length).toFixed(2)}s at the end`);
      if (peak * want <= PEAK_CEILING) return { buffer, gain: want, ...cut };
      // Turning it up that far would clip: hold the peaks down instead, and push a little harder until it measures right.
      let out = buffer, push = want, got = was;
      for (let pass = 0; pass < 6; pass++) {
        out = limited(buffer, push);
        got = await loudness(out);
        if (Math.abs(TARGET_LUFS - got) < 0.3) break;
        push = Math.min(push * 10 ** ((TARGET_LUFS - got) / 20), 40);
      }
      console.debug(`[sfx] ${url}: ${was.toFixed(1)} LUFS with peaks at ${peak.toFixed(2)}; peaks held down, comes out at ${got.toFixed(1)}`);
      return { buffer: out, gain: 1, ...cut };
    });
    p.catch(() => clips.delete(url));
    clips.set(url, p);
  }
  return p;
}

function start(clip: Clip) {
  const a = ac();
  const src = a.createBufferSource();
  const level = a.createGain();
  level.gain.value = clip.gain;
  src.buffer = clip.buffer;
  src.connect(level).connect(master!);
  src.onended = () => level.disconnect();
  src.start(0, clip.from, clip.length);
  playingUntil = Math.max(playingUntil, Date.now() + clip.length * 1000);
}
export async function playUrl(url: string) {
  if (silent) return;
  start(await load(url));
}

/** Marks a soundboard sound as playing for this long. Its button waits until then: here because I pressed it, and for
 *  everyone else in the voice chat because they are sent the same sound at the same moment. */
function busyFor(id: number, ms: number) {
  const until = Date.now() + ms;
  useStore.setState((s) => ({ soundBusy: { ...s.soundBusy, [id]: until } }));
  window.setTimeout(() => useStore.setState((s) => (s.soundBusy[id] === until ? { soundBusy: Object.fromEntries(Object.entries(s.soundBusy).filter(([k]) => Number(k) !== id)) } : s)), ms + 30);
}
/** Plays a soundboard sound, all the way through. `audible` false (deafened, say) still holds the button for its length. */
export async function playSound(sound: { id: number; url: string }, audible = true) {
  busyFor(sound.id, 2500);                   // until its real length is known: the first time, it has to be fetched
  const clip = await load(sound.url);
  busyFor(sound.id, clip.length * 1000);
  if (audible && !silent) start(clip);
}
export const soundBusy = (id: number) => (useStore.getState().soundBusy[id] ?? 0) > Date.now();

const TONES: Record<string, [number, number][]> = {
  join: [[523, 0], [784, 0.09]],
  leave: [[784, 0], [523, 0.09]],
  mute: [[330, 0]],
  unmute: [[494, 0]],
  message: [[1175, 0], [1568, 0.07]],          // a small two-note ping
  wave: [[660, 0], [880, 0.1], [660, 0.2], [880, 0.3]],
  nudge: [[392, 0], [392, 0.14]],            // you are talking while muted
  door: [[784, 0], [587, 0.22]],             // ding-dong: somebody has signed on
};
export function chime(kind: keyof typeof TONES) {
  const { prefs, voice } = useStore.getState();
  if (silent || !prefs.chimes || voice.deafened) return;
  const a = ac();
  for (const [freq, at] of TONES[kind]) {
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    const t0 = a.currentTime + at;
    g.gain.setValueAtTime(0, t0);
    // the tones follow the soundboard's slider, but never drop so low that they are missed
    g.gain.linearRampToValueAtTime(0.1 * (0.45 + 0.55 * soundGain(prefs.soundVol)), t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
    o.connect(g).connect(a.destination);
    o.onended = () => g.disconnect();
    o.start(t0);
    o.stop(t0 + 0.2);
  }
}

hooks.sound.push((id, channelId) => {
  const s = useStore.getState();
  const sound = s.sounds.find((x) => x.id === id);
  // Only in voice, and only a sound meant for the voice chat I am in. (The server sends them only there anyway;
  // this is a second lock, in case it and this page ever disagree about where I am.)
  if (!sound || s.voice.channelId == null || (channelId != null && channelId !== s.voice.channelId)) return;
  void playSound(sound, !s.voice.deafened).catch(() => {});
});

hooks.wave.push(() => chime('wave'));

// The doorbell: somebody signs on. Only after a real absence: everybody's page blinks off and on when it reloads
// itself for an update, and that is not an arrival.
const leftAt = new Map<string, number>();
hooks.presence.push((userId, prev, next) => {
  if (userId === useStore.getState().me?.id) return;
  const was = !prev || prev.state === 'offline', is = next.state === 'offline';
  if (!was && is) leftAt.set(userId, Date.now());
  if (was && !is && Date.now() - (leftAt.get(userId) ?? 0) > 45_000) chime('door');
});

// Someone joining or leaving the voice channel I am in.
hooks.presence.push((userId, prev, next) => {
  const s = useStore.getState();
  const mine = s.voice.channelId;
  if (mine == null || userId === s.me?.id) return;
  const was = prev?.voice?.channelId === mine;
  const is = next.voice?.channelId === mine;
  if (was !== is) chime(is ? 'join' : 'leave');
});
