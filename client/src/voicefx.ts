// The voice changer: a few silly filters for a bit (radio, chipmunk, cave...), on only while the button or the hold key
// is held (or locked on). Everything happens here, on the sender's own PC, between the microphone and the call: the
// microphone as the browser hands it over (its echo cancelling and noise suppression already done) goes through a
// small Web Audio graph, and the graph's output is what the call sends, in place of the microphone. One voice track
// stays one voice track, at the same bitrate: nothing new goes to the server or to anybody else.
//
// While no effect is on, there is no graph at all: it is built on the first press (a few milliseconds), and taken
// down again a few seconds after the last release (so a run of presses does not rebuild it every time, and a cave's
// echo can ring out). Between press and release the graph only switches between the effect and the dry voice.
//
// The meters, the noise gate and the talking-while-muted nudge go on reading the microphone itself, not the
// effect (voice.ts asks rawMic() for it): the gate shuts the microphone, so nothing goes into the graph either.
//
// Nothing here is a plugin: a VST cannot run inside the app. The effects are the browser's own audio nodes (filters,
// a convolver for the reverb, delay lines for the pitch), which is what such a plugin would do for these.
import { lk } from './livekit';
import type { LocalAudioTrack, RemoteParticipant, Room } from 'livekit-client';
import { create } from 'zustand';

export const EFFECTS = [
  { id: 'radio', name: 'Radio', hint: 'An old walkie-talkie: thin, a little crunchy, with crackle' },
  { id: 'chipmunk', name: 'Chipmunk', hint: 'Pitched up' },
  { id: 'deep', name: 'Deep', hint: 'Pitched down' },
  { id: 'cave', name: 'Cave', hint: 'A big stone cave, with an echo' },
  { id: 'robot', name: 'Robot', hint: 'A ring modulator and a metal box' },
  { id: 'megaphone', name: 'Megaphone', hint: 'A bullhorn, pushed too hard' },
] as const;
export type FxId = (typeof EFFECTS)[number]['id'];
const isFx = (x: unknown): x is FxId => EFFECTS.some((e) => e.id === x);

// ───────── what is chosen, and who has one on ─────────
const SAVE_KEY = 'fc_vfx';
function saved(): { fx: FxId; key: string } {
  try { const s = JSON.parse(localStorage.getItem(SAVE_KEY) ?? '{}'); return { fx: isFx(s.fx) ? s.fx : 'radio', key: typeof s.key === 'string' ? s.key : '' }; } catch { return { fx: 'radio', key: '' }; }
}
type FxState = {
  /** The effect the button puts on. */
  pick: FxId;
  /** The key that puts it on while held (an `event.code`), or none. Only while the window has focus: no global hotkeys. */
  key: string;
  held: boolean;
  lock: boolean;
  /** Mine, as the others hear it: the effect that is on right now. */
  on: FxId | null;
  /** Everybody else in my voice chat with one on, by user id. */
  others: Record<string, FxId>;
};
const first = saved();
export const useFx = create<FxState>(() => ({ pick: first.fx, key: first.key, held: false, lock: false, on: null, others: {} }));
const F = useFx.getState;
function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify({ fx: F().pick, key: F().key })); } catch { /* chosen again next time */ } }

/** Phones skip it: the phone page mixes its voices through Web Audio already, and has no room for the button. */
export const fxAvailable = () => typeof AudioContext !== 'undefined' && !document.body.classList.contains('phone');

export function pickFx(fx: FxId) { useFx.setState({ pick: fx }); save(); void sync(); }
export function setFxKey(code: string) { useFx.setState({ key: code }); save(); }
export function holdFx(down: boolean) { if (F().held !== down) { useFx.setState({ held: down }); void sync(); } }
export function lockFx(on: boolean) { if (F().lock !== on) { useFx.setState({ lock: on }); void sync(); } }

// ───────── the call ─────────
let room: Room | null = null;
const TOPIC = 'vfx';
/** voice.ts hands over each new call's room as it is set up. */
export function wireFx(r: Room) {
  room = r;
  r.on(lk().RoomEvent.DataReceived, (payload: Uint8Array, who?: RemoteParticipant, _kind?: unknown, topic?: string) => {
    if (topic !== TOPIC || !who) return;
    let fx: unknown = null;
    try { fx = JSON.parse(new TextDecoder().decode(payload)).fx; } catch { return; }
    const others = { ...F().others };
    if (isFx(fx)) others[who.identity] = fx; else delete others[who.identity];
    useFx.setState({ others });
  });
  r.on(lk().RoomEvent.ParticipantConnected, () => { if (F().on) tell(F().on); });        // somebody new: they are told mine
  r.on(lk().RoomEvent.ParticipantDisconnected, (who) => {
    if (!(who.identity in F().others)) return;
    const others = { ...F().others };
    delete others[who.identity];
    useFx.setState({ others });
  });
}
function tell(fx: FxId | null) {
  void room?.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ fx })), { reliable: true, topic: TOPIC }).catch(() => {});
}
/** Leaving the voice chat: off, unlocked, and the graph gone at once. */
export function fxLeft() {
  room = null;
  useFx.setState({ held: false, lock: false, on: null, others: {} });
  window.clearTimeout(lingerTimer);
  const g = graph;
  graph = null;
  if (g) void g.ctx.close().catch(() => {});
}
/** The microphone itself, while the call is sending the effect's output in its place (else null: the call's own track is the microphone). */
export function rawMic(): MediaStreamTrack | null {
  return graph?.raw.readyState === 'live' ? graph.raw : null;
}

// ───────── the graph ─────────
type Chain = { input: AudioNode; output: AudioNode; stop(): void };
type Graph = {
  ctx: AudioContext; track: LocalAudioTrack; raw: MediaStreamTrack;
  src: MediaStreamAudioSourceNode | null; dest: MediaStreamAudioDestinationNode;
  dry: GainNode; send: GainNode; wet: GainNode; chain: Chain | null; fx: FxId | null;
};
let graph: Graph | null = null;
let lingerTimer = 0;
const LINGER = 4000;

const micTrack = () => room?.localParticipant.getTrackPublication(lk().Track.Source.Microphone)?.track as LocalAudioTrack | undefined;

let busy = false, again = false;
/** Brings the sound round to what is asked (held, or locked, in a call, with a microphone): one change at a time. */
async function sync(): Promise<void> {
  if (busy) { again = true; return; }
  busy = true;
  try {
    do {
      again = false;
      await step();
    } while (again);
  } finally { busy = false; }
}
async function step() {
  const s = F();
  const track = micTrack();
  const want = room && track && fxAvailable() && (s.held || s.lock) ? s.pick : null;
  if (want) {
    window.clearTimeout(lingerTimer);
    if (graph && graph.track !== track) await teardown();         // a new microphone track (the old one went with its graph)
    if (!graph) await install(track!);
    if (!graph) return;
    if (graph.fx !== want) swapChain(graph, want);
    engage(graph, true);
  } else if (graph) {
    engage(graph, false);
    window.clearTimeout(lingerTimer);
    lingerTimer = window.setTimeout(() => { if (!F().on) void teardown(); }, LINGER);
  }
  if (F().on !== want) { useFx.setState({ on: want }); tell(want); }
}

async function install(track: LocalAudioTrack) {
  const ctx = new AudioContext({ latencyHint: 'interactive' });
  const dest = ctx.createMediaStreamDestination();
  dest.channelCount = 1; dest.channelCountMode = 'explicit';           // one channel in, one out: the call sends mono, as it did
  const g: Graph = { ctx, track, raw: track.mediaStreamTrack, src: null, dest, dry: ctx.createGain(), send: ctx.createGain(), wet: ctx.createGain(), chain: null, fx: null };
  g.send.gain.value = 0;
  // a limiter on the effect's side only: a metal box that rings, or a cave, can stack up louder than the voice was
  const limit = ctx.createDynamicsCompressor();
  limit.threshold.value = -8; limit.knee.value = 4; limit.ratio.value = 12; limit.attack.value = 0.003; limit.release.value = 0.15;
  g.dry.connect(dest); g.wet.connect(limit).connect(dest);
  const connect = (raw: MediaStreamTrack) => {
    g.src?.disconnect();
    g.raw = raw;
    g.src = ctx.createMediaStreamSource(new MediaStream([raw]));
    g.src.connect(g.dry); g.src.connect(g.send);
  };
  const processor = {
    name: 'chatterday-voicefx',
    processedTrack: dest.stream.getAudioTracks()[0],
    async init(o: { track: MediaStreamTrack }) { connect(o.track); },
    // a new microphone under the same track (a new device, or a setting changed in Settings)
    async restart(o: { track: MediaStreamTrack }) { connect(o.track); },
    async destroy() { g.src?.disconnect(); g.chain?.stop(); },
  };
  try {
    void ctx.resume().catch(() => {});
    await track.setAudioContext(ctx);
    await track.setProcessor(processor as any);
  } catch {
    void ctx.close().catch(() => {});
    return;
  }
  if (micTrack() !== track) { void ctx.close().catch(() => {}); return; }        // left, or a new microphone, meanwhile
  graph = g;
}

async function teardown() {
  const g = graph;
  if (!g) return;
  graph = null;
  try {
    if (g.track.getProcessor()) await g.track.stopProcessor();          // the call sends the microphone itself again
    await g.track.setAudioContext(undefined);
  } catch { /* the track is gone with the call */ }
  g.chain?.stop();
  void g.ctx.close().catch(() => {});
}

function engage(g: Graph, on: boolean) {
  const t = g.ctx.currentTime;
  // (a hundredth of a second either way, so there is no click; the effect's own tail, a cave's echo, rings on)
  g.send.gain.setTargetAtTime(on ? 1 : 0, t, 0.008);
  g.dry.gain.setTargetAtTime(on ? 0 : 1, t, 0.008);
}

function swapChain(g: Graph, fx: FxId) {
  const old = g.chain;
  const chain = build(g.ctx, fx);
  g.send.connect(chain.input);
  chain.output.connect(g.wet);
  g.chain = chain; g.fx = fx;
  if (old) { try { g.send.disconnect(old.input); } catch { /* already */ } window.setTimeout(() => old.stop(), 3000); }
}

// ───────── the effects ─────────
function build(ctx: AudioContext, fx: FxId): Chain {
  switch (fx) {
    case 'radio': return radio(ctx);
    case 'chipmunk': return pitch(ctx, 8);
    case 'deep': return pitch(ctx, -6);
    case 'cave': return cave(ctx);
    case 'robot': return robot(ctx);
    case 'megaphone': return megaphone(ctx);
  }
}

const filter = (ctx: AudioContext, type: BiquadFilterType, frequency: number, Q = 0.707, gain = 0) => { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = frequency; f.Q.value = Q; f.gain.value = gain; return f; };
const gain = (ctx: AudioContext, value: number) => { const g = ctx.createGain(); g.gain.value = value; return g; };
function chainOf(...nodes: AudioNode[]) { for (let i = 1; i < nodes.length; i++) nodes[i - 1].connect(nodes[i]); return nodes; }
/** A soft clipper that leaves quiet sound as it is and squashes the loud: it starts to bite at about 1/`drive`
 *  (4: the peaks of ordinary talking crunch a little; 12: everything but a whisper does). */
function shaper(ctx: AudioContext, drive: number) {
  const w = ctx.createWaveShaper();
  const n = 2048, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(drive * x) / drive; }
  w.curve = curve;
  w.oversample = '2x';
  return w;
}
/** How loud the voice going in is, as a slow number (for crackle that only crackles while somebody talks). */
function follower(ctx: AudioContext, input: AudioNode): AudioNode {
  const rect = ctx.createWaveShaper();
  const c = new Float32Array(257);
  for (let i = 0; i < c.length; i++) c[i] = Math.abs((i / 128) - 1);
  rect.curve = c;
  const smooth = filter(ctx, 'lowpass', 6);
  input.connect(rect).connect(smooth);
  return smooth;
}
function noise(ctx: AudioContext, seconds: number, make: (i: number) => number): AudioBufferSourceNode {
  const b = ctx.createBuffer(1, Math.round(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = make(i);
  const s = ctx.createBufferSource();
  s.buffer = b; s.loop = true;
  return s;
}

function radio(ctx: AudioContext): Chain {
  const input = gain(ctx, 1), output = gain(ctx, 1);
  chainOf(input, filter(ctx, 'highpass', 450), filter(ctx, 'highpass', 450), filter(ctx, 'peaking', 1600, 1, 7), shaper(ctx, 4), filter(ctx, 'lowpass', 2800), filter(ctx, 'lowpass', 2800), output);
  // the crackle: a hiss with pops in it, as loud as the voice is (so it is quiet between words, and gone when gated)
  const hiss = noise(ctx, 2, () => (Math.random() < 0.0015 ? (Math.random() * 2 - 1) * 4 : (Math.random() * 2 - 1) * 0.15));
  const crackle = gain(ctx, 0);
  chainOf(hiss, filter(ctx, 'bandpass', 2000, 0.8), crackle, output);
  follower(ctx, input).connect(crackle.gain);
  hiss.start();
  return { input, output, stop: () => { hiss.stop(); input.disconnect(); output.disconnect(); } };
}

function megaphone(ctx: AudioContext): Chain {
  const input = gain(ctx, 1), output = gain(ctx, 1.5);
  chainOf(input, filter(ctx, 'highpass', 700), filter(ctx, 'highpass', 700), filter(ctx, 'peaking', 1900, 1.4, 10), shaper(ctx, 12), filter(ctx, 'lowpass', 3500), filter(ctx, 'lowpass', 3500), output);
  return { input, output, stop: () => { input.disconnect(); output.disconnect(); } };
}

function robot(ctx: AudioContext): Chain {
  const input = gain(ctx, 1), output = gain(ctx, 0.6);
  // a ring modulator: the voice times a 50 Hz wave (the classic one), then a short metal box that rings
  const ring = gain(ctx, 0);
  const carrier = ctx.createOscillator();
  carrier.frequency.value = 50;
  carrier.connect(ring.gain);
  input.connect(ring);
  const box = ctx.createDelay(0.05), back = gain(ctx, 0.55);
  box.delayTime.value = 0.008;
  ring.connect(output); ring.connect(box); box.connect(back).connect(box); box.connect(output);
  carrier.start();
  return { input, output, stop: () => { carrier.stop(); input.disconnect(); output.disconnect(); box.disconnect(); } };
}

function cave(ctx: AudioContext): Chain {
  const input = gain(ctx, 1), output = gain(ctx, 1);
  const verb = ctx.createConvolver();
  // a made-up stone room: three seconds of noise dying away, the high end dying first (one channel: the call is mono)
  const sr = ctx.sampleRate, len = Math.round(sr * 3), ir = ctx.createBuffer(1, len, sr);
  for (let ch = 0; ch < 1; ch++) {
    const d = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr, decay = Math.exp(-t * 2.3), k = Math.min(0.9, 0.25 + t * 0.4);      // darker as it dies
      lp = lp * k + (Math.random() * 2 - 1) * (1 - k);
      d[i] = (t < 0.02 ? 0 : lp * decay * 2.2);
    }
  }
  verb.buffer = ir;
  verb.normalize = true;
  const echo = ctx.createDelay(1), back = gain(ctx, 0.35), echoOut = gain(ctx, 0.45);
  echo.delayTime.value = 0.32;
  input.connect(gain(ctx, 0.6)).connect(output);                    // the voice itself, a little down
  input.connect(verb).connect(gain(ctx, 0.5)).connect(output);       // the room
  input.connect(echo); echo.connect(back).connect(echo); echo.connect(filter(ctx, 'lowpass', 2500)).connect(echoOut).connect(output);      // the far wall
  return { input, output, stop: () => { input.disconnect(); output.disconnect(); echo.disconnect(); } };
}

/** A pitch shifter from two delay lines whose delay slides steadily (a sliding delay plays faster or slower, so
 *  higher or lower), each faded out where it jumps back, half a cycle apart so one is always sounding. The
 *  browser's own nodes only: no worklet, and very little work. `semis` up (+) or down (-). */
function pitch(ctx: AudioContext, semis: number): Chain {
  const input = gain(ctx, 1), output = gain(ctx, 1);
  const sr = ctx.sampleRate, cycle = 0.07, n = Math.round(sr * cycle);
  const ratio = Math.pow(2, semis / 12);
  const depth = Math.abs(ratio - 1) * cycle;          // how far the delay slides in one cycle
  const up = ratio > 1;
  const sources: AudioBufferSourceNode[] = [];
  for (const half of [0, 0.5]) {
    const ramp = ctx.createBuffer(1, n, sr), fade = ctx.createBuffer(1, n, sr);
    const r = ramp.getChannelData(0), f = fade.getChannelData(0);
    for (let i = 0; i < n; i++) {
      const ph = (i / n + half) % 1;
      r[i] = up ? 1 - ph : ph;                         // shrinking delay: higher; growing: lower
      f[i] = Math.sin(Math.PI * ph) ** 2;              // silent at the jump; the two halves add up to one
    }
    const delay = ctx.createDelay(0.2), amount = gain(ctx, depth), level = gain(ctx, 0);
    delay.delayTime.value = 0.002;
    const rs = ctx.createBufferSource(), fs = ctx.createBufferSource();
    rs.buffer = ramp; fs.buffer = fade; rs.loop = fs.loop = true;
    rs.connect(amount).connect(delay.delayTime);
    fs.connect(level.gain);
    input.connect(delay).connect(level).connect(output);
    sources.push(rs, fs);
  }
  const at = ctx.currentTime + 0.01;
  for (const s of sources) s.start(at);
  // a touch of tone for each: the chipmunk a little thinner, the deep voice a little less boomy
  const tone = up ? filter(ctx, 'highshelf', 3000, 0.7, 2) : filter(ctx, 'lowshelf', 180, 0.7, -3);
  const out2 = gain(ctx, 1);
  output.connect(tone).connect(out2);
  return { input, output: out2, stop: () => { for (const s of sources) s.stop(); input.disconnect(); out2.disconnect(); } };
}

// ───────── the hold key (while the window has focus: the desktop app has no global hotkeys, by choice) ─────────
const typing = (e: KeyboardEvent) => /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName ?? '') || (e.target as HTMLElement)?.isContentEditable;
let keyDown = false;
window.addEventListener('keydown', (e) => {
  const k = F().key;
  if (!k || e.code !== k || keyDown || !room || typing(e) || capturing) return;
  keyDown = true;
  holdFx(true);
});
const keyUp = (e?: KeyboardEvent) => {
  if (!keyDown || (e && e.code !== F().key)) return;
  keyDown = false;
  holdFx(false);
};
window.addEventListener('keyup', keyUp);
window.addEventListener('blur', () => keyUp());
/** While the pick list waits for a new hold key, that key does nothing else. */
let capturing = false;
export function captureKey(on: boolean) { capturing = on; }

// For testing from the console (F12): whether there is a graph, and how much work each effect is (`bench('cave')`:
// renders a minute of a test tone through it as fast as it can, and says how many times faster than real time that was).
(window as any).fcVoiceFx = {
  state: () => ({ graph: !!graph, fx: graph?.fx ?? null, ctx: graph?.ctx.state ?? null, raw: graph?.raw.id ?? null }),
  async bench(fx: FxId, seconds = 60) {
    const ctx = new OfflineAudioContext(1, 48000 * seconds, 48000);
    const tone = ctx.createOscillator();
    tone.type = 'sawtooth'; tone.frequency.value = 150;
    const chain = build(ctx as unknown as AudioContext, fx);
    tone.connect(chain.input); chain.output.connect(ctx.destination); tone.start();
    const t = performance.now();
    await ctx.startRendering();
    const ms = performance.now() - t;
    return { fx, seconds, ms: Math.round(ms), timesRealTime: Math.round((seconds * 1000) / ms) };
  },
};
