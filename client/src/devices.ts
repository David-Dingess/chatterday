// Plugging in a headset switches the microphone and the speakers over to it, and unplugging it goes back to what
// was in use before. Only a headset counts: a microphone and speakers that arrive together as one device. A
// monitor waking up (speakers only) or a webcam (microphone only) changes nothing.
import type { Prefs } from './store';
import { setPrefs, toast, useStore } from './store';
import { restartMic } from './voice';

type Dev = { id: string; kind: string; label: string; group: string };
const key = (d: Dev) => `${d.kind}|${d.id}`;
let known: Map<string, Dev> | null = null;
/** What was chosen before the app switched by itself, and what it switched to. */
let auto: { mic: string; out: string; micBefore: string; outBefore: string } | null = null;

async function list() {
  const all = await navigator.mediaDevices.enumerateDevices();
  // "default" and "communications" are Windows' own pointers at one of the others, not devices
  return new Map(all.filter((d) => (d.kind === 'audioinput' || d.kind === 'audiooutput') && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
    .map((d) => ({ id: d.deviceId, kind: d.kind as string, label: d.label, group: d.groupId })).map((d) => [key(d), d] as const));
}

async function changed() {
  const now = await list();
  const was = known;
  known = now;
  const prefs = useStore.getState().prefs;
  // Before the microphone is allowed, devices have no names and no ids: the first proper list is a start, not an arrival
  if (!was || !prefs.autoDevice || ![...was.values()].some((d) => d.label)) return;
  // Never a virtual device (a cable, a mixer, a streaming driver): on a virtual cable, whatever is played into it
  // comes straight back out of its "microphone", which would send the whole call back to everybody in it.
  const virtual = (d: Dev) => /vb-audio|voicemeeter|\bcable\b|virtual|steam streaming|nvidia broadcast|stereo mix|wave link|loopback|vaio|blackhole|soundflower/i.test(d.label);
  const fresh = [...now.values()].filter((d) => !was.has(key(d)) && d.label && !virtual(d));
  const handsFree = (d: Dev) => /hands-free/i.test(d.label) ? 1 : 0;          // a Bluetooth headset's poor-sounding twin: last choice
  const mics = fresh.filter((d) => d.kind === 'audioinput').sort((a, b) => handsFree(a) - handsFree(b));
  const outs = fresh.filter((d) => d.kind === 'audiooutput').sort((a, b) => handsFree(a) - handsFree(b));
  let patch: Partial<Prefs> | null = null;
  let said = '';
  const mic = mics.find((m) => outs.some((o) => o.group && o.group === m.group)) ?? (mics.length === 1 && outs.length === 1 ? mics[0] : undefined);
  if (mic) {
    const out = outs.find((o) => o.group && o.group === mic.group) ?? outs[0];
    auto = { mic: mic.id, out: out.id, micBefore: auto ? auto.micBefore : prefs.micId, outBefore: auto ? auto.outBefore : prefs.outId };
    patch = { micId: mic.id, outId: out.id };
    said = `Switched to ${out.label.replace(/\s*\([^)]*\)\s*$/, '') || 'the headset'}.`;
  } else {
    // something in use has gone: back to what was used before a switch of ours, or else to Windows' own choice
    const gone = (kind: string, id: string) => !!id && !now.has(`${kind}|${id}`);
    const back = (kind: string, id: string, mine: string | undefined, before: string | undefined) =>
      mine === id && before !== undefined && (before === '' || now.has(`${kind}|${before}`)) ? before : '';
    if (gone('audioinput', prefs.micId)) patch = { ...(patch ?? {}), micId: back('audioinput', prefs.micId, auto?.mic, auto?.micBefore) };
    if (gone('audiooutput', prefs.outId)) patch = { ...(patch ?? {}), outId: back('audiooutput', prefs.outId, auto?.out, auto?.outBefore) };
    if (patch) { auto = null; said = 'The headset is gone: back to what you used before.'; }
  }
  if (!patch) return;
  setPrefs(patch);
  toast(said);
  await restartMic();
}

let timer = 0;
if (navigator.mediaDevices) {
  const learn = () => void list().then((m) => { known = m; }).catch(() => {});
  learn();
  useStore.subscribe((s, prev) => { if (s.voice.channelId !== prev.voice.channelId) learn(); });       // joining voice is when names first show up in a browser
  // a headset arrives as several changes close together; wait for them all
  navigator.mediaDevices.addEventListener('devicechange', () => { window.clearTimeout(timer); timer = window.setTimeout(() => void changed().catch(() => {}), 700); });
}
