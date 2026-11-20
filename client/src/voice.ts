// One LiveKit room per voice channel. This module owns the connection and mirrors its state into the store.
import type { RemoteAudioTrack, Room, Track as LkTrack } from 'livekit-client';
import { lk, loadLivekit } from './livekit';
import { isAppleTouch } from './device';
import { api } from './api';
import { native } from './native';
import { chime, soundBusy, wakeSounds } from './sfx';
import { hooks, notify, send, toast, updating, useStore } from './store';
import type { VoiceState } from './store';
import { fxLeft, rawMic, wireFx } from './voicefx';

let room: Room | null = null;
type Heard = { track: RemoteAudioTrack; userId: string; group: 'voice' | 'media' };
const heard = new Map<string, Heard>();
let screenStream: MediaStream | null = null;
let previewTimer = 0;
let previewEarly: number[] = [];

const S = useStore.getState;
const patch = (v: Partial<VoiceState>) => useStore.setState((s) => ({ voice: { ...s.voice, ...v } }));
export const HIFI = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 };

/** Whose shared screens I have open right now. The person sharing is told, so they can see who is watching. */
const watching = new Set<string>();
export function setWatching(userId: string, on: boolean) {
  if (on === watching.has(userId)) return;
  if (on) watching.add(userId); else watching.delete(userId);
  applyVolumes();            // (their screen's sound comes and goes with it)
  if (S().voice.channelId != null) announce();
}

/** I have the Player's video large: in the Theatre view, or over the whole screen. Everybody is told, so the room can show it. */
let bigPlayer = false;
/** What I am sharing, in a few words, for everyone's list (the phone page shows it): the window or screen I picked. */
let shareLabel = '';
/** The window or screen being shared, when the desktop app picked it: it can be shared again after a reload with no click. */
let shareFrom: { sourceId: string; name?: string } | null = null;
export function setBigPlayer(on: boolean) {
  if (on === bigPlayer) return;
  bigPlayer = on;
  if (S().voice.channelId != null) announce();
}

/** `again`: said once more after the connection to the server dropped and came back, so the server does not take it for an arrival (no entrance sound). */
export function announce(again = false) {
  const v = S().voice;
  send({ t: 'voice', channelId: v.channelId, muted: v.muted, deafened: v.deafened, sharing: v.sharing, sound: v.sharing && !!soundOut, watching: [...watching], big: bigPlayer, ...(v.sharing && shareLabel ? { label: shareLabel } : {}), ...(again || rejoining ? { again: true } : {}) });
  native?.setTray({ muted: v.muted, inVoice: v.channelId != null, unread: false, deafened: v.deafened });
}
hooks.ready.push(() => announce(true)); // after a reconnect the server has forgotten where we are

// ───────── the server restarting for an update ─────────
// The server says so a moment before it stops (restartForUpdate in server/index.ts). In a voice chat, the page notes
// which one (in sessionStorage: it outlasts the reload into the new version) and leaves it properly. Once the server
// is back, and the new version loaded if there is one, it goes back into that voice chat: muted if it was, with no
// entrance sound (it counts as a reconnect, not an arrival). Not after three minutes: by then it is not the same call.
// The same happens when only the page is loading a new version (checkBuild in store.ts). A share picked in the desktop
// app starts again on its own once back in; one started in a browser cannot (the browser asks for it at a click), so
// the sharer is told to pick it again.
const REJOIN_KEY = 'fc_rejoin';
let rejoining = false;
hooks.restarting.push(() => {
  const v = S().voice;
  if (v.channelId == null) return;
  const shared = v.sharing ? (shareFrom ?? { sourceId: '' }) : null;
  try { sessionStorage.setItem(REJOIN_KEY, JSON.stringify({ channelId: v.channelId, muted: v.muted, deafened: v.deafened, share: shared, at: Date.now() })); } catch { /* no rejoin, then */ }
  toast('Chatterday is updating. You will be back in the voice chat in a moment.');
  void leaveVoice();
});
hooks.ready.push(() => window.setTimeout(() => {
  if (updating()) return;           // about to load the new version: it goes back in from there
  let want: { channelId: number; muted?: boolean; deafened?: boolean; share?: { sourceId: string; name?: string } | null; at: number } | null = null;
  try { want = JSON.parse(sessionStorage.getItem(REJOIN_KEY) ?? 'null'); sessionStorage.removeItem(REJOIN_KEY); } catch { want = null; }
  if (!want || Date.now() - want.at > 3 * 60_000) return;
  const back = want;
  // The page is usually back before the server's LiveKit is: it waits for voice to be up (the server says so when it
  // is), and tries once more if the first try does not get in.
  const go = async () => {
    if (S().voice.channelId != null) return;
    rejoining = true;
    try {
      if (back.muted) patch({ muted: true });       // (muted and deafened as they were: a reload forgets both)
      await joinVoice(Number(back.channelId));
      if (S().voice.channelId == null) { await new Promise((r) => window.setTimeout(r, 3000)); await joinVoice(Number(back.channelId)); }
      if (back.deafened && S().voice.channelId != null && !S().voice.deafened) await toggleDeafen();
      if (back.share && S().voice.channelId != null) {
        if (native && back.share.sourceId) await startShare(back.share.sourceId, back.share.name);
        else toast('You are back in the voice chat. The update stopped your share: share it again to carry on.');
      }
    } finally { rejoining = false; }
  };
  if (S().settings.voice) return void go();
  const until = Date.now() + 2 * 60_000;
  const stop = useStore.subscribe((st) => {
    if (Date.now() > until) return stop();
    if (st.settings.voice) { stop(); void go(); }
  });
}, 400));
// Signed out from the server's side (a new password, or removed) while in a call: the sign-in page takes over the
// window, with no Leave button on it, so the call is left too rather than going on behind it with the microphone open.
useStore.subscribe((s, prev) => { if (s.phase === 'gate' && prev.phase !== 'gate') void leaveVoice(); });

const micPub = () =>
  room?.localParticipant.getTrackPublication(lk().Track.Source.Microphone);
/** How the microphone is opened: the device and the processing chosen in Settings, as they are now. */
const micOptions = () => { const p = S().prefs; return { deviceId: p.micId || undefined, echoCancellation: p.echo, noiseSuppression: p.noise, autoGainControl: p.agc }; };

// ───────── who is talking ─────────
// Measured here, from the sound of each voice (your own microphone included), about thirty times a second. The voice
// engine also reports who is talking, but only after it is sure, which made the ring slow and easy to miss; its
// report is still counted, in case a voice cannot be measured.
export const TALK_LEVEL = 0.012;       // how loud counts as talking (0 to 1; quiet speech is about 0.02)
const TALK_HOLD = 350;          // the ring stays on this long after the last sound, in ms, so it does not flicker between words
type Meter = { source: MediaStreamAudioSourceNode; analyser: AnalyserNode; buf: Float32Array<ArrayBuffer>; until: number; level: number; heard: number };
const meters = new Map<string, Meter>();
let meterCtx: AudioContext | null = null;
let reported: Record<string, boolean> = {};      // what the voice engine last said

function listenTo(userId: string, track: MediaStreamTrack | undefined) {
  stopListening(userId);
  if (!track) return;
  try {
    meterCtx ??= new AudioContext();
    void meterCtx.resume().catch(() => {});       // it rests while there is nobody to measure
    const source = meterCtx.createMediaStreamSource(new MediaStream([track]));
    const analyser = meterCtx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    meters.set(userId, { source, analyser, buf: new Float32Array(analyser.fftSize), until: 0, level: 0, heard: 0 });
  } catch { /* this voice cannot be measured: the engine's report still covers it */ }
}
function stopListening(userId: string) {
  const m = meters.get(userId);
  if (m) { m.source.disconnect(); meters.delete(userId); }
}
/** With no call and nobody to measure, the measuring stops altogether (it would otherwise run on, measuring nothing,
 *  for as long as the app stays open). */
function restMeters() {
  if (room || meters.size) return;
  void meterCtx?.suspend().catch(() => {});
}
// My own microphone is measured from a copy of its track. The copy keeps hearing while the noise gate holds the real
// one shut, and it is made again whenever the microphone is restarted (a new device, or a setting changed).
let myCopy: MediaStreamTrack | null = null;
let myCopyOf = '';
let gateShut = false;
function watchMine(): MediaStreamTrack | null {
  // (the microphone itself even while the voice changer sends its effect in its place: voicefx.ts)
  const real = rawMic() ?? micPub()?.track?.mediaStreamTrack ?? null;
  if (!real || !room) return null;
  if (myCopyOf !== real.id) {
    myCopy?.stop();
    myCopy = real.clone();
    myCopy.enabled = true;
    myCopyOf = real.id;
    listenTo(room.localParticipant.identity, myCopy);
  }
  return real;
}

function measure() {
  if (!room) return;
  const now = performance.now();
  const mic = watchMine();
  const speaking: Record<string, boolean> = { ...reported };
  for (const [id, m] of meters) {
    m.analyser.getFloatTimeDomainData(m.buf);
    let sum = 0;
    for (let i = 0; i < m.buf.length; i++) sum += m.buf[i] * m.buf[i];
    const rms = Math.sqrt(sum / m.buf.length);
    if (rms > (S().users[id]?.talk ?? TALK_LEVEL)) {              // they may have set their own level
      m.until = now + TALK_HOLD;
      // how loud this voice runs, averaged over its last few seconds of speech (not while they sing karaoke: belting a
      // song would have them turned down for the rest of the night)
      if (S().music.current?.singer !== id) m.level = m.level ? m.level * 0.985 + rms * 0.015 : rms;
      m.heard += 0.03;
    }
    if (m.until > now) speaking[id] = true;
  }
  const before = S().voice.speaking, a = Object.keys(before), b = Object.keys(speaking);
  if (a.length !== b.length || b.some((id) => !before[id])) patch({ speaking });

  // The noise gate: while I am below my talking line (and for a moment after), my microphone sends nothing.
  // Muting is the voice engine's business; the gate only ever acts while I am not muted.
  if (mic) {
    const v = S().voice, mine = meters.get(room.localParticipant.identity);
    const want = S().prefs.gate && !v.muted;
    const shut = want && !(mine && mine.until > now);
    if (want) { if (mic.enabled === shut) mic.enabled = !shut; }
    else if (gateShut && !v.muted) mic.enabled = true;            // the gate was switched off while it was shut
    gateShut = shut;
    if (v.gated !== shut) patch({ gated: shut });

    // Talking while muted: after a second or so of it, say so, once. Not again until the microphone has been
    // unmuted and muted again: a muted microphone that hears the room's music would otherwise ring every few
    // seconds. Not with push-to-talk, where being muted between presses is the whole idea.
    const talking = v.muted && !!mine && mine.until > now && S().prefs.mutedNudge && !S().prefs.ptt;
    mutedTalk = talking ? mutedTalk + 30 : Math.max(0, mutedTalk - 60);
    if (mutedTalk > 1200 && !nudged) {
      nudged = true;
      mutedTalk = 0;
      patch({ talkingMuted: true });
      chime('nudge');
      window.clearTimeout(nudgeTimer);
      nudgeTimer = window.setTimeout(() => patch({ talkingMuted: false }), 6000);
    }
    if (!v.muted) { nudged = false; if (v.talkingMuted) patch({ talkingMuted: false }); }
  }
}
let mutedTalk = 0, nudged = false, nudgeTimer = 0;
// Both clocks tick only during a call: the app spends most of its day open and out of voice.
let measureTimer = 0, levelTimer = 0;
function startMeasuring() {
  if (measureTimer) return;
  measureTimer = window.setInterval(measure, 30);
  levelTimer = window.setInterval(() => { if (room && S().prefs.levelVoices) applyVolumes(); }, 1500);
}
function stopMeasuring() {
  window.clearInterval(measureTimer);
  window.clearInterval(levelTimer);
  measureTimer = levelTimer = 0;
}

/** Voice levelling: louder voices are turned down towards the quietest one being heard, so everyone lands at about
 *  the same loudness. Nobody can be made louder than they arrive, so this only ever turns down (to 30% at most). */
function levelFor(userId: string): number {
  if (S().music.current?.singer === userId) return 1;          // whoever is singing karaoke is never turned down
  const me = room?.localParticipant.identity;
  const known = [...meters].filter(([id, m]) => id !== me && m.heard > 2);        // only voices heard for a couple of seconds
  const mine = meters.get(userId);
  if (!mine || mine.heard <= 2 || known.length < 2) return 1;
  const target = Math.max(0.02, Math.min(0.08, Math.min(...known.map(([, m]) => m.level))));
  return Math.max(0.3, Math.min(1, target / mine.level));
}

export function applyVolumes() {
  const { prefs, voice } = S();
  for (const h of heard.values()) {
    const v = h.group === 'voice' ? (prefs.userVol[h.userId] ?? 1) * (prefs.levelVoices ? levelFor(h.userId) : 1) : prefs.mediaVol[h.userId] ?? 0.7;
    // A shared screen's sound is heard only by whoever has that screen open: everybody else in the call heard every
    // share's game or video under the talk, watching it or not (2026-11-18). Switched off at the track, not just turned
    // down, so it is silent on an iPad too, where an element's volume does nothing.
    const off = h.group === 'media' && !watching.has(h.userId);
    const mst = h.track.mediaStreamTrack;
    if (mst && mst.enabled === off) mst.enabled = !off;
    h.track.setVolume(voice.deafened || off ? 0 : Math.min(1, Math.max(0, v)));
  }
}

// Somebody starts or stops sharing, by their own word: look again at which screens there are.
hooks.presence.push((_userId, prev, next) => { if (room && !!prev?.voice?.sharing !== !!next.voice?.sharing) syncScreens(room); });

// On a video call or on the phone (Where are you?), and in a voice chat here as well: muted and deafened, so the friends
// here do not hear the call and the call does not hear them. Back from it, they are put back as they were, but only if it was the
// call that deafened them and nobody has undeafened them since.
let callDeafened: { muted: boolean } | null = null;
hooks.presence.push((userId, prev, next) => {
  const s = S();
  const onCall = (place?: string) => place === 'vcall' || place === 'calling';
  if (userId !== s.me?.id || onCall(prev?.place) === onCall(next.place)) return;
  if (onCall(next.place)) {
    if (s.voice.channelId == null || s.voice.deafened) return;
    callDeafened = { muted: s.voice.muted };
    void toggleDeafen();
  } else if (callDeafened) {
    const was = callDeafened;
    callDeafened = null;
    if (s.voice.channelId == null || !s.voice.deafened) return;
    void toggleDeafen().then(() => { if (was.muted && !S().voice.muted) void setMuted(true, true); });
  }
});

/** Goes to watch the screens being shared in a voice chat: joins it first if need be, then waits for the pictures to arrive. */
export async function watchScreens(channelId: number) {
  if (S().voice.channelId !== channelId) await joinVoice(channelId);
  for (let i = 0; i < 30 && S().voice.channelId === channelId && !S().voice.screens.length; i++) await new Promise((r) => setTimeout(r, 200));
  if (S().voice.screens.length) useStore.setState({ view: { kind: 'stage' } });
}
// Somebody starts sharing their screen: everyone else gets a notice with a Watch button.
hooks.presence.push((userId, prev, next) => {
  const s = S();
  if (userId === s.me?.id || prev?.voice?.sharing || !next.voice?.sharing) return;
  const channelId = next.voice.channelId;
  notify(`${s.users[userId]?.name ?? 'Someone'} is sharing their screen.`, 'Watch', () => void watchScreens(channelId));
});

function syncScreens(r: Room) {
  const ids: string[] = [];
  if (r.localParticipant.getTrackPublication(lk().Track.Source.ScreenShare)?.track) ids.push(r.localParticipant.identity);
  for (const p of r.remoteParticipants.values()) {
    // Their picture is here, and they have not said they stopped. (When somebody stops, the voice engine can go on
    // holding the old picture for a moment, or for good: their own word that they stopped settles it, so no empty
    // screen is left behind.)
    const said = S().presence[p.identity]?.voice;
    if (p.getTrackPublication(lk().Track.Source.ScreenShare)?.track && !(said && said.sharing === false)) ids.push(p.identity);
  }
  patch({ screens: ids, rev: S().voice.rev + 1 });
  if (!ids.length && S().view.kind === 'stage') useStore.setState({ view: { kind: 'hangout' } });
}

export function screenTrack(userId: string): LkTrack | undefined {
  if (!room) return undefined;
  const p = room.localParticipant.identity === userId ? room.localParticipant : room.remoteParticipants.get(userId);
  return p?.getTrackPublication(lk().Track.Source.ScreenShare)?.track ?? undefined;
}

function wire(r: Room) {
  wireFx(r);
  r.on(lk().RoomEvent.TrackSubscribed, (track, pub, part) => {
    // A shared screen (and its sound, to keep the two together) is played a fifth of a second late. A home line's way
    // up does not deliver evenly: the pictures of a share arrive in bursts with gaps between (one tested share was sent
    // at a steady 30 a second, and three short freezes a minute at the far end). Played as they come, each gap is a
    // freeze; held a moment first, the gaps are filled from what is waiting. Voices are not held back at all.
    if (pub.source === lk().Track.Source.ScreenShare || pub.source === lk().Track.Source.ScreenShareAudio) {
      const receiver = (track as unknown as { receiver?: any }).receiver;          // (the newer name of the setting, in milliseconds, or the older one, in seconds)
      const ms = shareTrial().buffer ?? 200;
      try { if (receiver && 'jitterBufferTarget' in receiver) receiver.jitterBufferTarget = ms; else if (receiver && 'playoutDelayHint' in receiver) receiver.playoutDelayHint = ms / 1000; } catch { /* played as it comes */ }
    }
    if (track.kind === lk().Track.Kind.Audio) {
      const el = track.attach();
      el.style.display = 'none';
      document.body.appendChild(el);
      const media = pub.source === lk().Track.Source.ScreenShareAudio;
      heard.set(pub.trackSid, { track: track as RemoteAudioTrack, userId: part.identity, group: media ? 'media' : 'voice' });
      // (who is talking is measured from each voice, but not on an iPad in the whole app: Safari can stop a remote voice
      // playing in its element once Web Audio takes from the same track. The voice engine's own word rings them there.)
      if (!media && !(isAppleTouch() && !document.body.classList.contains('phone'))) listenTo(part.identity, track.mediaStreamTrack);
      applyVolumes();
    } else syncScreens(r);
  });
  r.on(lk().RoomEvent.TrackUnsubscribed, (track, pub) => {
    if (track.kind === lk().Track.Kind.Audio) {
      for (const el of track.detach()) el.remove();
      if (heard.get(pub.trackSid)?.group === 'voice') stopListening(heard.get(pub.trackSid)!.userId);
      heard.delete(pub.trackSid);
      restMeters();
    } else {
      track.detach();
      syncScreens(r);
    }
  });
  r.on(lk().RoomEvent.AudioPlaybackStatusChanged, () => patch({ audioBlocked: !r.canPlaybackAudio }));
  r.on(lk().RoomEvent.ActiveSpeakersChanged, (speakers) => { reported = Object.fromEntries(speakers.map((p) => [p.identity, true])); });
  r.on(lk().RoomEvent.TrackPublished, () => syncScreens(r));
  r.on(lk().RoomEvent.TrackUnpublished, () => syncScreens(r));
  r.on(lk().RoomEvent.LocalTrackPublished, () => syncScreens(r));
  r.on(lk().RoomEvent.LocalTrackUnpublished, () => syncScreens(r));
  r.on(lk().RoomEvent.ParticipantDisconnected, () => syncScreens(r));
  r.on(lk().RoomEvent.Disconnected, (reason) => {
    if (room !== r) return;
    cleanup();
    // (taken out by the admin: the server says so itself, by name, and that is the message to keep on screen)
    if (reason !== lk().DisconnectReason.PARTICIPANT_REMOVED) toast('Voice disconnected.');
  });
}

function cleanup() {
  stopPreviews();
  endShareSound();
  fxLeft();
  screenStream?.getTracks().forEach((t) => t.stop());
  screenStream = null;
  for (const h of heard.values()) for (const el of h.track.detach()) el.remove();
  heard.clear();
  for (const id of [...meters.keys()]) stopListening(id);
  reported = {};
  myCopy?.stop();
  myCopy = null;
  myCopyOf = '';
  gateShut = false;
  nudged = false;
  room = null;
  stopMeasuring();
  restMeters();
  patch({ channelId: null, connecting: false, audioBlocked: false, sharing: false, speaking: {}, screens: [], micError: '', gated: false, talkingMuted: false, deafened: false });       // deafened ends with the call: it must never outlast its button
  if (S().view.kind === 'stage' || S().view.kind === 'theatre') useStore.setState({ view: { kind: 'hangout' } });      // nothing left to watch
  announce();
}

// One join at a time, and one leave. A second click on a voice chat while the first was still leaving the old one
// used to start a second connection beside the first; the voice engine threw one of the two out again, and its
// tidying up took the other's voices off the list that volumes are set from. And Leave pressed while a call was
// still connecting did nothing: the call arrived anyway.
let joining = false;
let leaves = 0;                   // counts every leave, so a join that is still on its way can tell it was called off
let leaving: Promise<void> | null = null;

export async function joinVoice(channelId: number) {
  const v = S().voice;
  if (v.channelId === channelId || v.connecting || joining) return;
  joining = true;
  // Safari on an iPad or an iPhone: the microphone is asked for here, at the tap itself, before anything is waited
  // for. Asked for only once the call had connected (a leave, the voice engine, a token and the connection later), it
  // was asked for long after the tap, and an iPad in testing never showed the question: it was in the call,
  // listening only. Once it is allowed here, opening it again after the connection is not asked about.
  const early = isAppleTouch() && typeof navigator.mediaDevices?.getUserMedia === 'function' ? askForMic() : null;
  appleSound(true);          // (from the tap itself, while Safari still counts it as one)
  try { await join(channelId, early); } finally { joining = false; }
}
/** Opens the microphone for a moment, so the browser asks about it now; '' if it may be used, else why not. */
function askForMic(): Promise<string> {
  return navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => { s.getTracks().forEach((t) => t.stop()); return ''; }, micWhy);
}
/** What to tell somebody whose microphone could not be opened. ("No microphone found" was said whatever went wrong,
 *  a browser saying no included, which left nobody knowing what to do about it.) */
function micWhy(e: any): string {
  const name = e?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return isAppleTouch()
      ? 'Safari is not letting Chatterday use the microphone, so you are listening only. Tap aA in the address bar, then Website Settings, set Microphone to Allow, and join again.'
      : 'The browser is not letting Chatterday use the microphone, so you are listening only. Allow it in the site settings (left of the address), and join again.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return 'No microphone found, so you are listening only.';
  if (name === 'NotReadableError' || name === 'AbortError') return 'The microphone is in use by something else, so you are listening only.';
  return `The microphone could not be opened (${name || e?.message || 'no reason given'}), so you are listening only.`;
}
async function join(channelId: number, early: Promise<string> | null = null) {
  await leaveVoice();
  const asked = leaves;
  patch({ connecting: true, error: '' });
  let engine: Awaited<ReturnType<typeof loadLivekit>>;
  try { engine = await loadLivekit(); }       // (fetched already once the page has settled: client/src/livekit.ts)
  catch {
    patch({ connecting: false, error: 'could not load voice' });
    toast('Voice: could not load voice. Reloading the page usually puts it right.');
    return;
  }
  if (asked !== leaves) { patch({ connecting: false }); return; }      // Leave was pressed while it loaded
  const p = S().prefs;
  const r = new engine.Room({
    // Ask for a screen at the size it is really drawn, in the monitor's own pixels: on a scaled display (125%, 150%)
    // counting in the page's pixels asked for less than 1080p, and the smaller copy is what arrived.
    adaptiveStream: { pixelDensity: 'screen' },
    dynacast: shareTrial().dynacast ?? true,
    audioCaptureDefaults: micOptions(),
    audioOutput: p.outId ? { deviceId: p.outId } : undefined,
    publishDefaults: { dtx: true, red: true },
    // On the phone page the voices go through Web Audio: Safari on an iPhone ignores the volume of an audio element,
    // so each person's volume slider would do nothing there. (The PC app keeps the plain elements it was tuned with.)
    // Not on an iPad with the whole app open: there, through Web Audio, an iPad in testing heard nothing at all, voices or sounds,
    // with everything saying it was playing (the engine running, three voices live, the silent loop on).
    // Plain elements are what an iPad plays most surely; the price is that each person's volume slider does nothing
    // there, as Safari ignores an element's volume.
    webAudioMix: document.body.classList.contains('phone'),
  });
  wire(r);
  try {
    const { token } = await api<{ token: string }>('/voice/token', { channelId });
    await r.connect(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`, token);
  } catch (e: any) {
    const why = e?.message || 'could not connect';
    patch({ connecting: false, error: why });
    toast(`Voice: ${why}`);
    return;
  }
  if (asked !== leaves) {           // Leave was pressed (or the window closed to the tray) while this was connecting
    patch({ connecting: false });
    void r.disconnect().catch(() => {});
    return;
  }
  room = r;
  startMeasuring();
  patch({ channelId, connecting: false });
  let micError = '';
  wantMuted = S().voice.muted || p.ptt;
  try {
    const no = early ? await early : '';          // (asked for at the tap: see joinVoice)
    if (no) throw Object.assign(new Error(no), { said: no });
    await r.localParticipant.setMicrophoneEnabled(true);
    await settleMic();              // Mute pressed (or the talk key let go, or pressed) while it was opening counts
  } catch (e: any) {
    micError = e?.said ?? micWhy(e);
    wantMuted = true;
  }
  if (room !== r) return;           // left again while the microphone was being opened
  patch({ micError, muted: wantMuted, deafened: false });
  applyVolumes();
  announce();
  chime('join');
}

/** A phone (iOS above all) plays the call's sound only once it has been touched after the sound arrived. Called from
 *  a tap: lets the voices play, and the meters that ring whoever is talking. */
// ── an iPad's or an iPhone's sound past its silent switch ──
// There the call's voices and the app's sounds all go through Web Audio (webAudioMix, and sfx.ts), and Web Audio keeps
// quiet while the silent switch (or Silent in Control Center) is on, unless a media element is playing. LiveKit plays a
// silent one for exactly that, but only where it takes the device for iOS, and an iPad says it is a Mac: an iPad in testing
// sent its voice and heard nothing, not the voices, not a sound. So here a silent loop is played from the
// tap, on any iPad or iPhone, and Safari is told this is a call (navigator.audioSession, iPadOS 17 and later).
let silentLoop: HTMLAudioElement | null = null;
function silentWav(): string {
  const n = 8000, b = new Uint8Array(44 + n), v = new DataView(b.buffer);
  const tag = (at: number, s: string) => { for (let i = 0; i < 4; i++) b[at + i] = s.charCodeAt(i); };
  tag(0, 'RIFF'); v.setUint32(4, 36 + n, true); tag(8, 'WAVE'); tag(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  tag(36, 'data'); v.setUint32(40, n, true); b.fill(128, 44);       // one second of 8-bit silence (128 is the middle)
  return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
}
function appleSound(on: boolean) {
  if (!isAppleTouch()) return;
  try { const as = (navigator as unknown as { audioSession?: { type: string } }).audioSession; if (as) as.type = on ? 'play-and-record' : 'auto'; } catch { /* older Safari */ }
  if (!on) { silentLoop?.pause(); return; }
  if (!silentLoop) { silentLoop = new Audio(silentWav()); silentLoop.loop = true; silentLoop.setAttribute('playsinline', ''); }
  if (silentLoop.paused) void silentLoop.play().catch(() => {});
}

export async function startAudio() {
  wakeSounds();
  if (room) appleSound(true);
  void meterCtx?.resume().catch(() => {});
  if (room) await room.startAudio().catch(() => {});
  if (room) patch({ audioBlocked: !room.canPlaybackAudio });
}

// Safari on an iPad or an iPhone (and any browser that holds sound back) plays the call only after a tap that came
// after it connected. Joined by a tap, that is the tap; but put back in by itself (after a new version, or a server
// restart) there was none, and an iPad in testing heard nothing all evening while everybody heard it. So the
// next tap or key anywhere lets the sound through, as well as the button in the voice bar.
for (const kind of ['click', 'touchend', 'keydown'] as const) {
  document.addEventListener(kind, () => {
    // (on an iPad or an iPhone every tap in a call: LiveKit cannot always tell that its Web Audio is held back there)
    if (S().voice.audioBlocked || (room && (!room.canPlaybackAudio || isAppleTouch()))) void startAudio();
  }, { capture: true, passive: true });
}

export function leaveVoice(): Promise<void> {
  leaves++;
  if (leaving) return leaving;
  if (!room) return Promise.resolve();
  const r = room;
  room = null;
  appleSound(false);
  chime('leave');
  leaving = r.disconnect().catch(() => {}).then(() => {
    leaving = null;
    room = r; // so cleanup() sees it once more
    cleanup();
  });
  return leaving;
}

// What was last asked of the microphone: shut, or open. Opening it takes a moment (a long one when the browser asks
// first), and Mute pressed in that moment finds no microphone to shut yet. It used to be noted on the button only, and
// the opening, when it arrived, went by what had been asked before it began: the microphone ended up open and the
// button said so, a moment after Mute was pressed. So everything that opens or changes the microphone finishes by
// bringing it round to this, and the last thing pressed is what holds, however the steps overlap.
let wantMuted = false;
async function settleMic() {
  for (let n = 0; n < 4; n++) {     // (a few rounds at most: each one waits for the change before it, and may find another was asked meanwhile)
    const pub = micPub();
    if (!pub || pub.isMuted === wantMuted) return;
    await (wantMuted ? pub.mute() : pub.unmute());
  }
}

export async function setMuted(muted: boolean, quiet = false) {
  wantMuted = muted;
  const r = room;
  if (r) {
    try {
      if (!muted && !micPub()) { await r.localParticipant.setMicrophoneEnabled(true, micOptions()); if (room === r) patch({ micError: '' }); }
      await settleMic();
    } catch (e) {
      if (wantMuted === muted) wantMuted = S().voice.muted;       // nothing changed: the button goes on saying what it said
      patch({ micError: micWhy(e) });
      return;
    }
    if (wantMuted !== muted) return;          // overruled while this was on its way: the later press has seen to the rest
  }
  patch({ muted, ...(muted ? {} : { deafened: false }) });
  applyVolumes();
  announce();
  if (!quiet) chime(muted ? 'mute' : 'unmute');
}

export async function toggleDeafen() {
  // Only in a call. (The hotkey works anywhere: out of voice it used to switch every tone off, and mute the next
  // call, with nothing on screen to say so or to undo it.)
  if (S().voice.channelId == null) return;
  const deafened = !S().voice.deafened;
  patch({ deafened });
  applyVolumes();
  await setMuted(deafened ? true : S().prefs.ptt, true);
  patch({ deafened });
  applyVolumes();
  announce();
}

/** Re-open the mic with the current device and processing settings. */
/** Whether this browser can send sound to a chosen device. Safari on an iPad or an iPhone cannot (the system picks:
 *  AirPlay in Control Center), and asking it to anyway failed every microphone change with "Could not switch device". */
export const canPickOutput = () => typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
/** The microphone the call is using right now (before the voice changer and the noise gate), or null out of a call. */
export const callMic = (): MediaStreamTrack | null => (room ? rawMic() ?? micPub()?.track?.mediaStreamTrack ?? null : null);
export async function restartMic() {
  if (!room) return;
  const p = S().prefs;
  const pub = micPub();
  try {
    if (pub?.audioTrack) await pub.audioTrack.restartTrack(micOptions());
    if (p.outId !== undefined && canPickOutput()) await room.switchActiveDevice('audiooutput', p.outId || 'default');
  } catch (e: any) {
    toast(`Could not switch device: ${e?.message ?? e}`);
  }
}

// ───────── screenshare ─────────

const QUALITY = { '720p30': [720, 30, 2_500_000], '1080p30': [1080, 30, 4_000_000], '1080p60': [1080, 60, 8_000_000] } as const;

// ───────── a screen captured by the desktop app itself ─────────
// The browser's own capture cannot hold 60 pictures a second while a game has the graphics card (desktop/main.cjs,
// above startShareVideo, has the measurements). The desktop app, from 0.2.1 on and when it has an ffmpeg, captures
// and encodes on the graphics card itself and sends the result here; a worker (shareVideo.worker.ts) turns it back
// into pictures and writes them into a track of our own, which is published like any other.
type NativeShare = { track: MediaStreamTrack; width: number; height: number; encoder: string; pictures: number; late: number; over: boolean; idle: boolean; stop(): void };
let nativeShare: NativeShare | null = null;
let nativeWhy = '';        // why the last share was not captured this way, for the log
async function captureNatively(sourceId: string, side: number, fps: number): Promise<NativeShare | null> {
  const Generator = (window as any).MediaStreamTrackGenerator;
  if (!native?.startShareVideo || !Generator || typeof VideoDecoder === 'undefined') { nativeWhy = native ? 'this version of the app cannot' : ''; return null; }
  // The channel the pictures come down is posted to this window by the app's own script (see preload.cjs).
  let gotPort = (_: MessagePort | null) => {};
  const portCame = new Promise<MessagePort | null>((resolve) => { gotPort = resolve; });
  const onPort = (e: MessageEvent) => { if (e.source === window && e.origin === location.origin && e.data?.chatterdayShareVideo && e.ports[0]) gotPort(e.ports[0]); };
  window.addEventListener('message', onPort);
  const giveUp = window.setTimeout(() => gotPort(null), 20_000);
  let me: NativeShare | null = null;
  try {
    const got = await native.startShareVideo(sourceId, { side, fps }).catch((e: any) => ({ error: String(e?.message ?? e) }) as { error?: string; width?: number; height?: number; fps?: number; encoder?: string });
    if (got.error || !got.width || !got.height) { nativeWhy = got.error ?? 'the app gave no answer'; return null; }
    const port = await portCame;
    if (!port) { native.stopShareVideo?.(); nativeWhy = 'the pictures had no way here'; return null; }
    const track: MediaStreamTrack & { writable: WritableStream } = new Generator({ kind: 'video' });
    const worker = new Worker(new URL('./shareVideo.worker.ts', import.meta.url), { type: 'module' });
    const mine: NativeShare = { track, width: got.width, height: got.height, encoder: got.encoder ?? '?', pictures: 0, late: 0, over: false, idle: false,
      stop: () => { native?.stopShareVideo?.(); worker.terminate(); track.stop(); } };
    me = mine;
    const first = new Promise<string>((resolve) => {
      worker.onmessage = (e: MessageEvent<{ t: 'first' } | { t: 'count'; pictures: number; late: number } | { t: 'end'; why: string }>) => {
        const m = e.data;
        if (m.t === 'first') resolve('');
        else if (m.t === 'count') { mine.pictures = m.pictures; mine.late = m.late; }
        else {
          // It stopped by itself: the window that was shared has closed, or the encoder gave up. So does the share.
          mine.over = true;
          resolve(m.why);
          if (nativeShare === mine && screenStream) void stopShare();
        }
      };
      worker.onerror = () => resolve('the worker would not start');
      window.setTimeout(() => resolve('no pictures came'), 8000);
    });
    worker.postMessage({ port, writable: track.writable, fps: got.fps ?? fps }, [port, track.writable]);
    const why = await first;
    if (why) { mine.stop(); nativeWhy = why; return null; }
    nativeWhy = '';
    return mine;
  } catch (e: any) {
    me?.stop();
    nativeWhy = String(e?.message ?? e);
    return null;
  } finally {
    clearTimeout(giveUp);
    window.removeEventListener('message', onPort);
  }
}
function endNativeShare() {
  const n = nativeShare;
  nativeShare = null;
  clearInterval(idleTimer);
  n?.stop();
}
// While nobody has my screen open, nothing of it is sent (the voice library sees to that: each size of the picture is
// switched off until somebody wants it). The app went on capturing and encoding it sixty times a second all the same,
// and the page decoding it: a seventh of the graphics card's encoder and a tenth of its decoder, taken from the game
// for nobody. So the app is told (0.2.3 on): after five seconds with every size switched off it captures two pictures
// a second, and the moment one is switched on again, the full rate. Whoever opens the screen has a picture at once
// (from the two a second) and the full rate within a second or so.
let idleTimer = 0;
function watchForIdle(r: Room, share: NativeShare) {
  if (!native?.setShareVideoIdle) return;
  let quietSince = 0;
  clearInterval(idleTimer);
  idleTimer = window.setInterval(() => {
    if (nativeShare !== share || room !== r) return clearInterval(idleTimer);
    const sender = r.localParticipant.getTrackPublication(lk().Track.Source.ScreenShare)?.track?.sender;
    let wanted = true;
    try { const sizes = sender?.getParameters().encodings ?? []; wanted = !sizes.length || sizes.some((e) => e.active !== false); } catch { /* not known: as if wanted */ }
    // LiveKit only switches the sizes off once somebody has subscribed and gone again: a share nobody has opened since it
    // started kept every size on, and so the full rate (measured: 30 a second for as long as it ran). So it is also
    // idle while nobody has it open, by everybody's own word (the "watching" each page sends; see setWatching).
    const s = S(), meId = s.me?.id;
    if (wanted && meId && !Object.values(s.presence).some((p) => p.state !== 'offline' && p.voice?.watching?.includes(meId))) wanted = false;
    if (wanted) quietSince = 0; else quietSince ||= Date.now();
    const idle = !wanted && Date.now() - quietSince > 5000;
    if (idle !== share.idle) { share.idle = idle; native?.setShareVideoIdle?.(idle); }
  }, 400);
}
// H.264 comes in kinds ("profiles"), and which kind is agreed with the server decides who encodes it. Left alone, the
// server settles on 42e01f ("constrained baseline": every browser can send it), and that is the one kind a graphics
// card's encoder here does not offer: so H.264 was always encoded on the processor (OpenH264), which cannot keep up
// with 1080p at 60 even with no game running (measured: 39). The kinds the card does encode (baseline, main, high)
// are found here, and are the only H.264 offered for the share's picture: the server then has to agree to one.
/** The kinds of H.264 this PC encodes on its graphics card at this size and rate, best first; none if it cannot. */
async function cardH264(width: number, height: number, fps: number, bitrate: number): Promise<string[]> {
  try {
    const kinds = (RTCRtpSender.getCapabilities('video')?.codecs ?? []).filter((c) => c.mimeType.toLowerCase() === 'video/h264' && c.sdpFmtpLine?.includes('packetization-mode=1')).map((c) => c.sdpFmtpLine!);
    const good: string[] = [];
    for (const kind of kinds) {
      const can = await navigator.mediaCapabilities.encodingInfo({ type: 'webrtc', video: { contentType: `video/H264;${kind}`, width, height, bitrate, framerate: fps } });
      if (can.supported && can.powerEfficient) good.push(kind);
    }
    // high (64...) says the most with the fewest bits, and is the one the server is sure to know; then main (4d...), then baseline
    const rank = (kind: string) => { const id = /profile-level-id=([0-9a-f]{2})/i.exec(kind)?.[1]?.toLowerCase(); return id === '64' ? 0 : id === '4d' ? 1 : 2; };
    return good.sort((a, b) => rank(a) - rank(b));
  } catch { return []; }
}
/** Does `work` (the publishing) so that the picture it adds to the call offers those kinds of H.264 and no other
 *  H.264 (every other codec stays on the list, for the resending of lost pieces). The voice library gives no say in
 *  this, so the browser's own "add a track to the call" is wrapped for as long as `work` takes, and put back. */
async function offeringH264<T>(kinds: string[], work: () => Promise<T>): Promise<T> {
  const proto = window.RTCPeerConnection?.prototype;
  const original = proto?.addTransceiver;
  if (!kinds.length || !original) return work();
  const isH264 = (c: RTCRtpCodec) => c.mimeType.toLowerCase() === 'video/h264';
  proto.addTransceiver = function (this: RTCPeerConnection, trackOrKind: MediaStreamTrack | string, init?: RTCRtpTransceiverInit) {
    const transceiver = original.call(this, trackOrKind, init);
    try {
      if ((typeof trackOrKind === 'string' ? trackOrKind : trackOrKind.kind) === 'video') {
        const all = RTCRtpSender.getCapabilities('video')?.codecs ?? [];
        const first = kinds.map((kind) => all.find((c) => isH264(c) && c.sdpFmtpLine === kind)).filter((c): c is RTCRtpCodec => !!c);
        if (first.length) transceiver.setCodecPreferences([...first, ...all.filter((c) => !isH264(c))]);
      }
    } catch { /* left as it was: the share still goes out, encoded on the processor */ }
    return transceiver;
  };
  try { return await work(); } finally { proto.addTransceiver = original; }
}

// ───────── a share that gets smaller when its line gets thin ─────────
// A game in full motion at 1080 lines needs more bits than a home line's way up has to spare (one tested line had room
// for 5 to 8 Mbps, a picture that wanted 4.1 of the 3.5 it was given). The encoder then keeps to its bitrate the only
// way left to it, by leaving pictures out: 30 a second became 22, and 7 of the small size. The browser makes the
// picture smaller of itself ("maintain-framerate", asked for above) when the encoder says the picture is going coarse
// (a high QP), now that one size is sent and not two; it does nothing about pictures that are left out while the QP
// is fair, which is what that line's were. So that is done here: every two seconds, how many of the captured pictures were
// encoded; under 85 in a hundred twice running, and the picture is made a step smaller (1080 lines: 864, then 720,
// and no further by this hand). After half a minute with nothing left out, and bits to spare (a low QP), a step back
// up; a step up that has to be undone within half a minute doubles the wait before the next (to 4 minutes). The same
// serves a graphics card that the game has left no time on: a smaller picture is less to encode.
const SHRINK = [1, 1.25, 1.5, 2];
/** How much smaller to ask for, near `by`, so that the picture comes out an even number of dots each way: the graphics
 *  card's encoder takes no odd sizes, and the browser then encodes on the processor instead, without a word (tried:
 *  1584x862 by 1.25 is 1267x690, and that was OpenH264 at 60 a second). */
function evenly(w: number, h: number, by: number): number {
  if (!(w > 0 && h > 0)) return by;
  for (let wide = 2 * Math.floor(w / by / 2); wide > w / (by + 0.2); wide -= 2) {
    const high = (h * wide) / w;
    if (Math.floor(high) % 2 === 0 && high - Math.floor(high) < 0.5) return w / wide;
  }
  return by;
}
let shrinkTimer = 0;
let shrunk = { step: 0, times: 0 };
// ───────── a share stuck small on the processor ─────────
// A share started again just after the server restarted: a new connection guesses its line at
// 0.4 Mbps, so the browser made the first pictures a quarter of the size, 505x270 of 2020x1080. 505 is odd, the
// graphics card's encoder takes no odd sizes (see evenly), and the browser went over to OpenH264 on the processor
// without a word. There the picture only grows again when its QP drops under 24; his sat at 26, and stayed 335x179
// with 3.8 Mbps to spare, until he stopped sharing. So: when the card was asked for, the processor is doing it, the
// picture is half its width or less and the line has room, for three checks running (six seconds), the browser is told
// to forget every cut it made. Going to "balanced" and back does that (the browser lifts all its limits on any change
// to or from balanced): the next picture is full size, and with it the card is tried again. No new publish, so
// nobody watching sees the screen go and come back. Twice a share at most, a minute apart.
let restarts = 0;
function watchForPressure(r: Room, video: MediaStreamTrack, most: number, card = false) {
  clearInterval(shrinkTimer);
  shrunk = { step: 0, times: 0 };
  restarts = 0;
  let stuck = 0, restartAt = 0;
  const afresh = async (track: any): Promise<boolean> => {
    const unlock = await track.senderLock?.lock?.();
    try {
      const sender: RTCRtpSender = track.sender;
      const p = sender.getParameters() as RTCRtpSendParameters & { degradationPreference?: RTCDegradationPreference };
      const keep = p.degradationPreference ?? 'maintain-framerate';
      p.degradationPreference = keep === 'balanced' ? 'maintain-framerate' : 'balanced';
      await sender.setParameters(p);
      const q = sender.getParameters() as RTCRtpSendParameters & { degradationPreference?: RTCDegradationPreference };
      q.degradationPreference = keep;
      await sender.setParameters(q);
      return true;
    } catch { return false; } finally { unlock?.(); }
  };
  const began = Date.now(), last = Math.min(SHRINK.length - 1, Math.max(0, most));
  let base: number[] | null = null;
  let was: { src: number; enc: number; qp: number; at: number } | null = null;
  let low = 0, good = 0, rest = 0, wait = 30, wentUp = 0, busy = false;
  // The QP over the last ten seconds or so, and not of one moment: a game at QP 30 to 33 dips under 30 for two seconds
  // often enough, and each step up taken on such a dip had to be undone, at the cost of the pictures it was meant to save
  // (one tested share went 720 lines, up to 864, back to 720, twice in three minutes). 26 leaves room for the step.
  let qpNow: number | null = null;
  const dots = { w: 0, h: 0 };          // the size of the picture as it is captured
  const set = async (track: any, step: number): Promise<boolean> => {
    const unlock = await track.senderLock?.lock?.();          // (the voice library changes the same settings under this lock)
    try {
      const sender: RTCRtpSender = track.sender;
      const params = sender.getParameters();
      base ??= params.encodings.map((e) => e.scaleResolutionDownBy ?? 1);
      if (base.length !== params.encodings.length) return false;
      const big = base.indexOf(Math.min(...base));          // the size people watch (a small one beside it, if two are sent, is small enough as it is)
      const by = step ? evenly(dots.w / base[big], dots.h / base[big], SHRINK[step]) : 1;
      params.encodings.forEach((e, i) => { e.scaleResolutionDownBy = base![i] * (i === big ? by : 1); });
      await sender.setParameters(params);
      return true;
    } catch { return false; } finally { unlock?.(); }
  };
  shrinkTimer = window.setInterval(async () => {
    if (room !== r || screenStream?.getVideoTracks()[0] !== video) return clearInterval(shrinkTimer);
    if (busy) return;
    busy = true;
    try {
      const track = r.localParticipant.getTrackPublication(lk().Track.Source.ScreenShare)?.track;
      const sender = track?.sender;
      if (!sender || Date.now() - began < 15_000) return;          // (the first seconds: the bitrate is still finding its feet)
      const sizes = sender.getParameters().encodings;
      const top = sizes.reduce((a, e) => ((e.scaleResolutionDownBy ?? 1) < (a.scaleResolutionDownBy ?? 1) ? e : a), sizes[0]);
      const st: any[] = [];
      (await sender.getStats()).forEach((x: any) => st.push(x));
      const src = st.find((x) => x.type === 'media-source' && x.kind === 'video');
      const outs = st.filter((x) => x.type === 'outbound-rtp' && x.kind === 'video').sort((a, b) => (b.frameHeight ?? 0) - (a.frameHeight ?? 0));
      const out = outs.find((x) => x.rid && x.rid === top?.rid) ?? outs[0];
      if (src?.width > 0 && src?.height > 0) { dots.w = src.width; dots.h = src.height; }
      if (card && out && dots.w > 0) {          // (stuck small on the processor: see above)
        const soft = out.powerEfficientEncoder === false || /openh264/i.test(out.encoderImplementation ?? '');
        const pair = st.find((x) => x.type === 'candidate-pair' && x.nominated && x.state === 'succeeded');
        const small = (out.frameWidth ?? 0) > 0 && out.frameWidth * 2 <= dots.w;
        if (soft && small && (pair?.availableOutgoingBitrate ?? 0) >= 1.5e6 && restarts < 2 && Date.now() - restartAt > 60_000) {
          if (++stuck >= 3) {
            stuck = 0; restartAt = Date.now();
            if (shrunk.step > 0) await set(track, 0);          // (this hand's own step down goes too: it is a fresh start)
            if (await afresh(track)) { restarts++; shrunk = { step: 0, times: shrunk.times }; low = good = 0; rest = 3; qpNow = null; was = null; return; }
          }
        } else stuck = 0;
      }
      const now = { src: src?.frames ?? -1, enc: out?.framesEncoded ?? 0, qp: out?.qpSum ?? 0, at: performance.now() };
      const before = was;
      was = now;
      // nobody watching (nothing is encoded, and the capture is at two a second): nothing to judge, then or just after
      if (nativeShare?.idle || top?.active === false) { low = good = 0; rest = 3; return; }
      if (rest > 0) { rest--; return; }
      if (!before) return;
      const secs = (now.at - before.at) / 1000;
      const captured = now.src >= 0 && before.src >= 0 ? now.src - before.src : (src?.framesPerSecond ?? 0) * secs;
      const encoded = now.enc - before.enc;
      if (captured < 5 * secs || encoded <= 0) { low = 0; return; }          // a still screen, or this size is not being sent at all
      const kept = encoded / captured, qp = now.qp > before.qp ? (now.qp - before.qp) / encoded : null;
      if (qp != null) qpNow = qpNow == null ? qp : qpNow * 0.75 + qp * 0.25;
      if (wentUp && Date.now() - wentUp > 120_000) { wentUp = 0; wait = 30; }          // the step up held: the wait is the short one again
      if (kept < (shareTrial().shrinkAt ?? 0.85)) {
        good = 0;
        if (++low >= 2 && shrunk.step < last && await set(track, shrunk.step + 1)) {
          shrunk = { step: shrunk.step + 1, times: shrunk.times + 1 };
          if (wentUp && Date.now() - wentUp < 30_000) wait = Math.min(wait * 2, 240);
          low = 0; rest = 3; qpNow = null;
        }
      } else if (kept >= 0.95) {
        low = 0;
        good += secs;
        if (shrunk.step > 0 && good >= wait && (qpNow == null || qpNow < 26) && await set(track, shrunk.step - 1)) {
          shrunk = { step: shrunk.step - 1, times: shrunk.times };
          wentUp = Date.now(); good = 0; rest = 3; qpNow = null;
        }
      } else low = 0;
    } catch { /* the share is ending */ } finally { busy = false; }
  }, 2000);
}

// ───────── the sound of a shared window ─────────
// The desktop app's helper hands over the sound of the shared window's program in small pieces; they are fed into a
// sound track of our own, which is sent along with the picture.
let soundOut: MediaStreamTrack | null = null;
let soundSink: ((chunk: Uint8Array | null) => void) | null = null;
native?.onShareSound?.((chunk) => soundSink?.(chunk));
function soundTrack(): MediaStreamTrack | null {
  const Generator = (window as any).MediaStreamTrackGenerator, Sound = (window as any).AudioData;
  if (!Generator || !Sound) return null;
  const track = new Generator({ kind: 'audio' });
  const writer = track.writable.getWriter();
  let frames = 0;
  soundSink = (chunk) => {
    const n = chunk ? chunk.byteLength >> 2 : 0;          // four bytes to a moment: two channels of 16 bits
    if (!n) return;
    void writer.write(new Sound({ format: 's16', sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((frames / 48000) * 1e6), data: chunk })).catch(() => {});
    frames += n;
  };
  soundOut = track;
  return track;
}
function endShareSound() {
  native?.stopShareSound?.();
  soundSink = null;
  soundOut?.stop();
  soundOut = null;
}

/** For trying another way of sending the picture without a new build (scripts/share-probe.mjs does): in the console,
 *    localStorage.cd_share = '{"codec":"vp8","keep":"balanced","simulcast":false}'      (any of them; remove it to go back)
 *  "dynacast": false keeps sending when nobody is watching, which a measurement with no audience needs.
 *  "native": false has the browser capture the screen even where the desktop app could.
 *  "bitrate": 1000000 sends at most that many bits a second (a thin line, for trying what a share does on one).
 *  "shrink": 0 never makes the picture smaller for a thin line (1, 2, 3: by at most that many steps; 2 as it comes).
 *  "shrinkAt": 2 makes it smaller whatever is getting through (read afresh every two seconds: for trying the steps).
 *  "buffer": 0 plays a screen I am WATCHING as it comes; 400 holds it longer than the usual 200 ms (set before it is opened). */
function shareTrial(): { codec?: string; keep?: string; simulcast?: boolean; dynacast?: boolean; native?: boolean; bitrate?: number; shrink?: number; shrinkAt?: number; buffer?: number; video?: MediaTrackConstraints } {
  try { return JSON.parse(localStorage.getItem('cd_share') ?? '{}') ?? {}; } catch { return {}; }
}

let shareStarting = false;
/** In the desktop app pass the picked source id; in a browser the browser shows its own picker. */
export async function startShare(sourceId?: string, name?: string) {
  if (!room) return toast('Join a voice channel first.');
  if (screenStream || shareStarting) return;        // already sharing, or about to: a second one would never be stopped
  shareStarting = true;
  try { await share(room, sourceId, name); } finally { shareStarting = false; }
}
async function share(r: Room, sourceId?: string, name?: string) {
  const p = S().prefs;
  const trial = shareTrial();
  const [height, fps] = QUALITY[p.shareQuality], bitrate = trial.bitrate ?? QUALITY[p.shareQuality][2];
  let stream: MediaStream;
  // The desktop app captures it itself when it can (60 pictures a second with a game running); else the browser does.
  const captured = native && sourceId && trial.native !== false ? await captureNatively(sourceId, height, fps) : null;
  if (room !== r) return captured?.stop();
  if (captured) { nativeShare = captured; stream = new MediaStream([captured.track]); }
  else try {
    // The PC's whole sound is never captured: it carries the voice chat itself back out to everybody, and nothing this
    // shell offers keeps it out (measured). Sound comes from the desktop app's helper instead, and only for a shared
    // WINDOW: that window's program alone. A whole screen is shared without sound.
    if (native && sourceId) await native.selectSource(sourceId, false);
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: trial.video ?? { height: { ideal: height }, frameRate: { ideal: fps } },
      audio: false,
      selfBrowserSurface: 'exclude',
    } as DisplayMediaStreamOptions);
  } catch (e: any) {
    if (e?.name !== 'NotAllowedError') toast(`Could not start sharing: ${e?.message ?? e}`);
    return;
  }
  // (Leaving the call at any point from here on calls the share off: nothing else would ever stop the capture.)
  const off = () => { stream.getTracks().forEach((t) => t.stop()); endShareSound(); endNativeShare(); };
  if (room !== r) return off();
  const video = stream.getVideoTracks()[0];
  let audio: MediaStreamTrack | null = null;
  if (p.shareAppSound && sourceId?.startsWith('window:') && native?.startShareSound) {
    const got = await native.startShareSound(sourceId).catch(() => ({ error: 'failed' }));
    audio = got?.error ? null : soundTrack();
    if (!audio) endShareSound();
    if (room !== r) return off();
  }
  video.contentHint = fps >= 60 ? 'motion' : 'detail';
  const size = video.getSettings();
  // H.264 on the graphics card when this PC can (the picture never leaves the card, and the processor is left to the
  // game); VP8 on the processor, as it always was, when it cannot.
  const onCard = trial.codec && trial.codec !== 'h264' ? [] : await cardH264(captured?.width ?? size.width ?? 1920, captured?.height ?? size.height ?? 1080, fps, bitrate);
  const codec = trial.codec ?? (onCard.length ? 'h264' : '');
  if (room !== r) return off();
  try {
    await offeringH264(codec === 'h264' ? onCard : [], () => r.localParticipant.publishTrack(video, {
      // One size of the picture is sent, and not a second, small one beside it for a watcher whose own line cannot
      // take the full one (a deliberate choice). The small one (half the size each way, up to a megabit) took a
      // fifth of the way up of a line that had 5 to 8 Mbps for everything, and a second encoder on a card
      // the game already had; whenever the room ran short, both sizes lost pictures. The price: a watcher on a thin
      // line has nothing smaller to fall back to. ("simulcast": true in the trial sends the two again.)
      source: lk().Track.Source.ScreenShare, name: 'screen', simulcast: trial.simulcast ?? false,
      screenShareEncoding: { maxBitrate: bitrate, maxFramerate: fps },
      ...(codec ? { videoCodec: codec as 'vp8' | 'h264' | 'vp9' | 'av1' } : {}),
      // When the encoder cannot keep up (the graphics card is the game's, or the line is thin), the picture gets
      // smaller and the pictures keep coming. The voice library's own choice for a shared screen is the other way
      // round ("maintain-resolution": every picture sharp, fewer of them), right for a page of text and wrong for a
      // game: one tested share was captured at 30 a second and sent at 3 to 18 (each step two thirds of the
      // one before: 30, 20, 13, 9, 6, 4, 3). A still screen is under no pressure and stays as sharp as it was.
      degradationPreference: (trial.keep ?? 'maintain-framerate') as RTCDegradationPreference,
    }));
    if (audio) {
      await r.localParticipant.publishTrack(audio, {
        source: lk().Track.Source.ScreenShareAudio, name: 'screen-audio',
        audioPreset: lk().AudioPresets.musicHighQualityStereo, dtx: false, red: false, forceStereo: true,
      });
    }
  } catch (e: any) {
    await r.localParticipant.unpublishTrack(video, true).catch(() => {});       // the picture may have gone out before the sound failed
    off();
    return toast(`Could not publish the screen: ${e?.message ?? e}`);
  }
  if (room !== r) return off();
  if (captured?.over) { await r.localParticipant.unpublishTrack(video, true).catch(() => {}); return off(); }       // it stopped while it was being published
  screenStream = stream;
  shareFrom = native && sourceId ? { sourceId, ...(name ? { name } : {}) } : null;
  // Its name: the one in the picker (the desktop app), else the browser's own label when it is a real name, not an id.
  const surface = (video.getSettings() as { displaySurface?: string }).displaySurface;
  shareLabel = (name || (/^(screen|window|web-contents)[:-]/i.test(video.label) ? '' : video.label) || (surface === 'monitor' ? 'a screen' : surface === 'browser' ? 'a browser tab' : surface === 'window' ? 'a window' : '')).trim().slice(0, 60);
  video.addEventListener('ended', () => void stopShare());
  if (captured) watchForIdle(r, captured);
  watchForPressure(r, video, trial.shrink ?? 2, codec === 'h264' && onCard.length > 0);
  patch({ sharing: true });
  announce();
  startPreviews(video);
}

export async function stopShare() {
  const stream = screenStream;
  screenStream = null;
  shareFrom = null;
  clearInterval(shrinkTimer);
  stopPreviews();
  if (stream && room) {
    for (const t of stream.getTracks()) await room.localParticipant.unpublishTrack(t, true).catch(() => {});
    if (soundOut) await room.localParticipant.unpublishTrack(soundOut, true).catch(() => {});
  }
  endShareSound();
  stream?.getTracks().forEach((t) => t.stop());
  endNativeShare();
  patch({ sharing: false });
  announce();
}

/** A small still for the projector in the room: one soon after sharing starts, then one a minute. It is what everyone
 *  sees there, in the voice chat or not (the projector is not for watching: the Screens view is). The picture is only
 *  opened for the moment each still is taken, so nothing plays in between. */
function startPreviews(track: MediaStreamTrack) {
  const canvas = document.createElement('canvas');
  let busy = false;
  const snap = async () => {
    if (busy || track.readyState !== 'live') return;
    busy = true;
    const v = document.createElement('video');
    v.muted = true;
    v.srcObject = new MediaStream([track]);
    try {
      await v.play();
      for (let i = 0; i < 20 && !v.videoWidth; i++) await new Promise((r) => setTimeout(r, 100));
      if (v.videoWidth && screenStream) {
        canvas.width = 320;
        canvas.height = Math.round((320 * v.videoHeight) / v.videoWidth);
        canvas.getContext('2d')!.drawImage(v, 0, 0, canvas.width, canvas.height);
        const data = canvas.toDataURL('image/jpeg', 0.5);
        send({ t: 'preview', data });
        const me = S().me?.id;
        if (me) useStore.setState((st) => ({ previews: { ...st.previews, [me]: data } }));      // my own projector shows it too
      }
    } catch { /* next time */ }
    v.pause();
    v.srcObject = null;
    busy = false;
  };
  previewEarly = [window.setTimeout(() => void snap(), 1200), window.setTimeout(() => void snap(), 8000)];      // the first can catch a window still opening
  previewTimer = window.setInterval(() => void snap(), 60_000);
}
function stopPreviews() {
  clearInterval(previewTimer);
  previewEarly.forEach((t) => clearTimeout(t));
  previewEarly = [];
}

// ───────── how a shared screen is really getting through ─────────
// Twice a minute, while I am sending a screen or have one open, a line goes into the server's log (data/server.log,
// "[share] ..."): what was captured, what was sent and what held it back; or what arrived. That is the only way to
// know why a share was not 1080p at 60: the cause is different on every PC and every evening.
const counted = new Map<string, { at: number; bytes: number }>();
function mbps(key: string, bytes: number): string {
  const was = counted.get(key), now = performance.now();
  counted.set(key, { at: now, bytes });
  return was && now > was.at ? ((bytes - was.bytes) * 8 / (now - was.at) / 1000).toFixed(1) : '?';
}
/** How much a count has grown since the last line (0 the first time). */
const countedBefore = new Map<string, number>();
function since(key: string, value: number): number {
  const was = countedBefore.get(key);
  countedBefore.set(key, value);
  return was == null ? 0 : Math.max(0, value - was);
}
async function shareStats(): Promise<string[]> {
  const lines: string[] = [];
  if (!room) return lines;
  const all = async (track: LkTrack | undefined) => { const out: any[] = []; (await track?.getRTCStatsReport().catch(() => undefined))?.forEach((x: any) => out.push(x)); return out; };
  const mine = room.localParticipant.getTrackPublication(lk().Track.Source.ScreenShare)?.track;
  if (mine) {
    const st = await all(mine);
    const src = st.find((x) => x.type === 'media-source' && x.kind === 'video');
    const pair = st.find((x) => x.type === 'candidate-pair' && x.nominated && x.state === 'succeeded');
    const local = pair && st.find((x) => x.id === pair.localCandidateId);
    const layers = st.filter((x) => x.type === 'outbound-rtp' && x.kind === 'video').sort((a, b) => (b.frameHeight ?? 0) - (a.frameHeight ?? 0));
    const codec = st.find((x) => x.id === layers[0]?.codecId)?.mimeType?.replace('video/', '') ?? '?';
    const set = mine.mediaStreamTrack.getSettings();
    const how = nativeShare ? `captured by the app, ${nativeShare.encoder}${nativeShare.idle ? ', two a second while nobody is watching' : ''}${nativeShare.late ? `, fell behind ${nativeShare.late} times` : ''}` : `the capture is set to ${set.width}x${set.height} at up to ${Math.round(set.frameRate ?? 0)}${nativeWhy ? `; not by the app: ${nativeWhy}` : ''}`;
    // What held it back comes first and the encoder's long name last: the log keeps the start of a line. For each size
    // sent: how long it has been held back and by what (so far), how long a picture takes to encode, and how many key
    // pictures went out and how many times the far end asked for one since the last line (a watcher who keeps asking
    // makes every picture a big one, and the rest are then dropped to keep to the bitrate).
    const held = (l: any) => { const d = l.qualityLimitationDurations ?? {}; const t = ['cpu', 'bandwidth', 'other'].filter((k) => d[k] > 0.5).map((k) => `${k} ${Math.round(d[k])} s`).join(', '); return `held back by ${l.qualityLimitationReason || 'nothing'}${t ? ` (so far: ${t}; ${l.qualityLimitationResolutionChanges ?? 0} changes of size)` : ''}`; };
    const brief = (s: string) => s.replace(/MediaFoundationVideoEncodeAccelerator/g, 'MF').replace('SimulcastEncoderAdapter', 'simulcast');
    lines.push(`is sending (${S().prefs.shareQuality}, ${codec}, keeps ${mine.sender?.getParameters().degradationPreference ?? '?'}${shrunk.times ? `, made smaller for the line ${shrunk.times} times, now 1/${SHRINK[shrunk.step]}` : ''}${restarts ? `, started afresh ${restarts} times (stuck small on the processor)` : ''}): captured ${src?.width ?? '?'}x${src?.height ?? '?'} at ${Math.round(src?.framesPerSecond ?? 0)} fps (${how}); ` +
      layers.map((l) => { const n = since('enc' + l.ssrc, l.framesEncoded ?? 0), ms = since('ms' + l.ssrc, (l.totalEncodeTime ?? 0) * 1000), qp = since('qp' + l.ssrc, l.qpSum ?? 0);
        return `${l.frameWidth ?? 0}x${l.frameHeight ?? 0} at ${Math.round(l.framesPerSecond ?? 0)} fps, ${mbps('out' + l.ssrc, l.bytesSent ?? 0)} of ${((l.targetBitrate ?? 0) / 1e6).toFixed(1)} Mbps, ${held(l)}, ${n > 0 ? (ms / n).toFixed(1) : '?'} ms a picture, QP ${n > 0 && qp > 0 ? Math.round(qp / n) : '?'}, ${since('key' + l.ssrc, l.keyFramesEncoded ?? 0)} key pictures, asked for one ${since('pli' + l.ssrc, (l.pliCount ?? 0) + (l.firCount ?? 0))} times, ${brief(l.encoderImplementation ?? '?')}${l.powerEfficientEncoder ? ' (hardware)' : ''}`; }).join(' | ') +
      (pair ? `; link ${local?.protocol ?? '?'} ${local?.candidateType ?? '?'}, ${Math.round((pair.currentRoundTripTime ?? 0) * 1000)} ms, room for ${((pair.availableOutgoingBitrate ?? 0) / 1e6).toFixed(1)} Mbps` : ''));
  }
  for (const id of watching) {
    const st = await all(screenTrack(id));
    const got = st.find((x) => x.type === 'inbound-rtp' && x.kind === 'video');
    if (!got) continue;
    const el = [...document.querySelectorAll<HTMLVideoElement>('.stage video')].sort((a, b) => b.clientWidth - a.clientWidth)[0];
    const lost = got.packetsReceived ? (100 * (got.packetsLost ?? 0) / (got.packetsReceived + (got.packetsLost ?? 0))).toFixed(1) : '?';
    const out = since('jbn' + got.ssrc, got.jitterBufferEmittedCount ?? 0), held = since('jbd' + got.ssrc, (got.jitterBufferDelay ?? 0) * 1000), gone = since('frz' + got.ssrc, got.freezeCount ?? 0);
    lines.push(`is watching ${S().users[id]?.name ?? id}: ${gone} freezes since the last line, held ${out > 0 ? Math.round(held / out) : '?'} ms before it is shown; ${got.frameWidth ?? 0}x${got.frameHeight ?? 0} at ${Math.round(got.framesPerSecond ?? 0)} fps,${mbps('in' + got.ssrc, got.bytesReceived ?? 0)} Mbps, ${got.decoderImplementation ?? '?'}${got.powerEfficientDecoder ? ' (hardware)' : ''}, ` +
      `${lost}% lost, ${got.freezeCount ?? 0} freezes, ${got.framesDropped ?? 0} frames dropped so far, asked for a key picture ${since('ask' + got.ssrc, (got.pliCount ?? 0) + (got.firCount ?? 0))} times; drawn ${el ? Math.round(el.clientWidth * devicePixelRatio) + 'x' + Math.round(el.clientHeight * devicePixelRatio) : '?'}`);
  }
  return lines;
}
window.setInterval(() => void shareStats().then((lines) => { if (lines.length) send({ t: 'stats', lines }); }).catch(() => {}), 30_000);
(window as any).fcShareStats = shareStats;        // the same lines on demand, from the console (F12)

// ───────── push-to-talk (while the window has focus) ─────────

let pttDown = false;
const typingInField = (e: KeyboardEvent) => /^(INPUT|TEXTAREA)$/.test((e.target as HTMLElement)?.tagName ?? '') || (e.target as HTMLElement)?.isContentEditable;
window.addEventListener('keydown', (e) => {
  const { prefs, voice } = S();
  if (!prefs.ptt || voice.channelId == null || e.code !== prefs.pttKey || pttDown || typingInField(e)) return;
  pttDown = true;
  void setMuted(false, true);
});
const pttUp = (e?: KeyboardEvent) => {
  if (!pttDown || (e && e.code !== S().prefs.pttKey)) return;
  pttDown = false;
  void setMuted(true, true);
};
window.addEventListener('keyup', pttUp);
window.addEventListener('blur', () => pttUp());

native?.onHotkey((action) => {
  if (action === 'mute') void setMuted(!S().voice.muted);
  else if (action === 'deafen') void toggleDeafen();
  else if (action.startsWith('sound:')) { if (!soundBusy(Number(action.slice(6)))) send({ t: 'sound', id: Number(action.slice(6)) }); }       // not while it is still playing
});
