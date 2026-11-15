// One LiveKit room per voice channel. This module owns the connection and mirrors its state into the store.
import { AudioPresets, Room, RoomEvent, Track } from 'livekit-client';
import type { RemoteAudioTrack, Track as LkTrack } from 'livekit-client';
import { api } from './api';
import { native } from './native';
import { chime, soundBusy } from './sfx';
import { hooks, notify, send, toast, useStore } from './store';
import type { VoiceState } from './store';

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
  if (S().voice.channelId != null) announce();
}

/** I have the Player's video large: in the Theatre view, or over the whole screen. Everybody is told, so the room can show it. */
let bigPlayer = false;
export function setBigPlayer(on: boolean) {
  if (on === bigPlayer) return;
  bigPlayer = on;
  if (S().voice.channelId != null) announce();
}

/** `again`: said once more after the connection to the server dropped and came back, so the server does not take it for an arrival (no entrance sound). */
export function announce(again = false) {
  const v = S().voice;
  send({ t: 'voice', channelId: v.channelId, muted: v.muted, deafened: v.deafened, sharing: v.sharing, sound: v.sharing && !!soundOut, watching: [...watching], big: bigPlayer, ...(again ? { again: true } : {}) });
  native?.setTray({ muted: v.muted, inVoice: v.channelId != null, unread: false, deafened: v.deafened });
}
hooks.ready.push(() => announce(true)); // after a reconnect the server has forgotten where we are
// Signed out from the server's side (a new password, or removed) while in a call: the sign-in page takes over the
// window, with no Leave button on it, so the call is left too rather than going on behind it with the microphone open.
useStore.subscribe((s, prev) => { if (s.phase === 'gate' && prev.phase !== 'gate') void leaveVoice(); });

const micPub = () =>
  room?.localParticipant.getTrackPublication(Track.Source.Microphone);
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
  const real = micPub()?.track?.mediaStreamTrack ?? null;
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
      m.level = m.level ? m.level * 0.985 + rms * 0.015 : rms;     // how loud this voice runs, averaged over its last few seconds of speech
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
    h.track.setVolume(voice.deafened ? 0 : Math.min(1, Math.max(0, v)));
  }
}

// Somebody starts or stops sharing, by their own word: look again at which screens there are.
hooks.presence.push((_userId, prev, next) => { if (room && !!prev?.voice?.sharing !== !!next.voice?.sharing) syncScreens(room); });

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
  if (r.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track) ids.push(r.localParticipant.identity);
  for (const p of r.remoteParticipants.values()) {
    // Their picture is here, and they have not said they stopped. (When somebody stops, the voice engine can go on
    // holding the old picture for a moment, or for good: their own word that they stopped settles it, so no empty
    // screen is left behind.)
    const said = S().presence[p.identity]?.voice;
    if (p.getTrackPublication(Track.Source.ScreenShare)?.track && !(said && said.sharing === false)) ids.push(p.identity);
  }
  patch({ screens: ids, rev: S().voice.rev + 1 });
  if (!ids.length && S().view.kind === 'stage') useStore.setState({ view: { kind: 'hangout' } });
}

export function screenTrack(userId: string): LkTrack | undefined {
  if (!room) return undefined;
  const p = room.localParticipant.identity === userId ? room.localParticipant : room.remoteParticipants.get(userId);
  return p?.getTrackPublication(Track.Source.ScreenShare)?.track ?? undefined;
}

function wire(r: Room) {
  r.on(RoomEvent.TrackSubscribed, (track, pub, part) => {
    if (track.kind === Track.Kind.Audio) {
      const el = track.attach();
      el.style.display = 'none';
      document.body.appendChild(el);
      const media = pub.source === Track.Source.ScreenShareAudio;
      heard.set(pub.trackSid, { track: track as RemoteAudioTrack, userId: part.identity, group: media ? 'media' : 'voice' });
      if (!media) listenTo(part.identity, track.mediaStreamTrack);
      applyVolumes();
    } else syncScreens(r);
  });
  r.on(RoomEvent.TrackUnsubscribed, (track, pub) => {
    if (track.kind === Track.Kind.Audio) {
      for (const el of track.detach()) el.remove();
      if (heard.get(pub.trackSid)?.group === 'voice') stopListening(heard.get(pub.trackSid)!.userId);
      heard.delete(pub.trackSid);
      restMeters();
    } else {
      track.detach();
      syncScreens(r);
    }
  });
  r.on(RoomEvent.ActiveSpeakersChanged, (speakers) => { reported = Object.fromEntries(speakers.map((p) => [p.identity, true])); });
  r.on(RoomEvent.TrackPublished, () => syncScreens(r));
  r.on(RoomEvent.TrackUnpublished, () => syncScreens(r));
  r.on(RoomEvent.LocalTrackPublished, () => syncScreens(r));
  r.on(RoomEvent.LocalTrackUnpublished, () => syncScreens(r));
  r.on(RoomEvent.ParticipantDisconnected, () => syncScreens(r));
  r.on(RoomEvent.Disconnected, () => {
    if (room !== r) return;
    cleanup();
    toast('Voice disconnected.');
  });
}

function cleanup() {
  stopPreviews();
  endShareSound();
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
  patch({ channelId: null, connecting: false, sharing: false, speaking: {}, screens: [], micError: '', gated: false, talkingMuted: false, deafened: false });       // deafened ends with the call: it must never outlast its button
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
  try { await join(channelId); } finally { joining = false; }
}
async function join(channelId: number) {
  await leaveVoice();
  const asked = leaves;
  patch({ connecting: true, error: '' });
  const p = S().prefs;
  const r = new Room({
    // Ask for a screen at the size it is really drawn, in the monitor's own pixels: on a scaled display (125%, 150%)
    // counting in the page's pixels asked for less than 1080p, and the smaller copy is what arrived.
    adaptiveStream: { pixelDensity: 'screen' },
    dynacast: shareTrial().dynacast ?? true,
    audioCaptureDefaults: micOptions(),
    audioOutput: p.outId ? { deviceId: p.outId } : undefined,
    publishDefaults: { dtx: true, red: true },
  });
  wire(r);
  try {
    const { token } = await api<{ token: string }>('/voice/token', { channelId });
    await r.connect(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`, token);
  } catch (e: any) {
    patch({ connecting: false, error: e?.message ?? 'Could not connect to voice.' });
    toast(`Voice: ${e?.message ?? 'could not connect'}`);
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
    await r.localParticipant.setMicrophoneEnabled(true);
    await settleMic();              // Mute pressed (or the talk key let go, or pressed) while it was opening counts
  } catch {
    micError = 'No microphone found, so you are listening only.';
    wantMuted = true;
  }
  if (room !== r) return;           // left again while the microphone was being opened
  patch({ micError, muted: wantMuted, deafened: false });
  applyVolumes();
  announce();
  chime('join');
}

export function leaveVoice(): Promise<void> {
  leaves++;
  if (leaving) return leaving;
  if (!room) return Promise.resolve();
  const r = room;
  room = null;
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
    } catch {
      if (wantMuted === muted) wantMuted = S().voice.muted;       // nothing changed: the button goes on saying what it said
      patch({ micError: 'Could not open the microphone.' });
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
export async function restartMic() {
  if (!room) return;
  const p = S().prefs;
  const pub = micPub();
  try {
    if (pub?.audioTrack) await pub.audioTrack.restartTrack(micOptions());
    if (p.outId !== undefined) await room.switchActiveDevice('audiooutput', p.outId || 'default');
  } catch (e: any) {
    toast(`Could not switch device: ${e?.message ?? e}`);
  }
}

// ───────── screenshare ─────────

const QUALITY = { '720p30': [720, 30, 2_500_000], '1080p30': [1080, 30, 4_000_000], '1080p60': [1080, 60, 6_000_000] } as const;

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
 *    localStorage.cd_share = '{"codec":"h264","keep":"balanced","simulcast":false}'      (any of them; remove it to go back)
 *  "dynacast": false keeps sending when nobody is watching, which a measurement with no audience needs. */
function shareTrial(): { codec?: string; keep?: string; simulcast?: boolean; dynacast?: boolean; video?: MediaTrackConstraints } {
  try { return JSON.parse(localStorage.getItem('cd_share') ?? '{}') ?? {}; } catch { return {}; }
}

let shareStarting = false;
/** In the desktop app pass the picked source id; in a browser the browser shows its own picker. */
export async function startShare(sourceId?: string) {
  if (!room) return toast('Join a voice channel first.');
  if (screenStream || shareStarting) return;        // already sharing, or about to: a second one would never be stopped
  shareStarting = true;
  try { await share(room, sourceId); } finally { shareStarting = false; }
}
async function share(r: Room, sourceId?: string) {
  const p = S().prefs;
  const [height, fps, bitrate] = QUALITY[p.shareQuality];
  let stream: MediaStream;
  try {
    // The PC's whole sound is never captured: it carries the voice chat itself back out to everybody, and nothing this
    // shell offers keeps it out (measured). Sound comes from the desktop app's helper instead, and only for a shared
    // WINDOW: that window's program alone. A whole screen is shared without sound.
    if (native && sourceId) await native.selectSource(sourceId, false);
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: shareTrial().video ?? { height: { ideal: height }, frameRate: { ideal: fps } },
      audio: false,
      selfBrowserSurface: 'exclude',
    } as DisplayMediaStreamOptions);
  } catch (e: any) {
    if (e?.name !== 'NotAllowedError') toast(`Could not start sharing: ${e?.message ?? e}`);
    return;
  }
  // (Leaving the call at any point from here on calls the share off: nothing else would ever stop the capture.)
  const off = () => { stream.getTracks().forEach((t) => t.stop()); endShareSound(); };
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
  const trial = shareTrial();
  try {
    await r.localParticipant.publishTrack(video, {
      source: Track.Source.ScreenShare, name: 'screen', simulcast: trial.simulcast ?? true,
      screenShareEncoding: { maxBitrate: bitrate, maxFramerate: fps },
      ...(trial.codec ? { videoCodec: trial.codec as 'vp8' | 'h264' | 'vp9' | 'av1' } : {}),
      ...(trial.keep ? { degradationPreference: trial.keep as RTCDegradationPreference } : {}),
    });
    if (audio) {
      await r.localParticipant.publishTrack(audio, {
        source: Track.Source.ScreenShareAudio, name: 'screen-audio',
        audioPreset: AudioPresets.musicHighQualityStereo, dtx: false, red: false, forceStereo: true,
      });
    }
  } catch (e: any) {
    await r.localParticipant.unpublishTrack(video, true).catch(() => {});       // the picture may have gone out before the sound failed
    off();
    return toast(`Could not publish the screen: ${e?.message ?? e}`);
  }
  if (room !== r) return off();
  screenStream = stream;
  video.addEventListener('ended', () => void stopShare());
  patch({ sharing: true });
  announce();
  startPreviews(video);
}

export async function stopShare() {
  const stream = screenStream;
  screenStream = null;
  stopPreviews();
  if (stream && room) {
    for (const t of stream.getTracks()) await room.localParticipant.unpublishTrack(t, true).catch(() => {});
    if (soundOut) await room.localParticipant.unpublishTrack(soundOut, true).catch(() => {});
  }
  endShareSound();
  stream?.getTracks().forEach((t) => t.stop());
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
async function shareStats(): Promise<string[]> {
  const lines: string[] = [];
  if (!room) return lines;
  const all = async (track: LkTrack | undefined) => { const out: any[] = []; (await track?.getRTCStatsReport().catch(() => undefined))?.forEach((x: any) => out.push(x)); return out; };
  const mine = room.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track;
  if (mine) {
    const st = await all(mine);
    const src = st.find((x) => x.type === 'media-source' && x.kind === 'video');
    const pair = st.find((x) => x.type === 'candidate-pair' && x.nominated && x.state === 'succeeded');
    const local = pair && st.find((x) => x.id === pair.localCandidateId);
    const layers = st.filter((x) => x.type === 'outbound-rtp' && x.kind === 'video').sort((a, b) => (b.frameHeight ?? 0) - (a.frameHeight ?? 0));
    const codec = st.find((x) => x.id === layers[0]?.codecId)?.mimeType?.replace('video/', '') ?? '?';
    const set = mine.mediaStreamTrack.getSettings();
    lines.push(`is sending (${S().prefs.shareQuality}, ${codec}): captured ${src?.width ?? '?'}x${src?.height ?? '?'} at ${Math.round(src?.framesPerSecond ?? 0)} fps (the capture is set to ${set.width}x${set.height} at up to ${Math.round(set.frameRate ?? 0)}); ` +
      layers.map((l) => `${l.frameWidth ?? 0}x${l.frameHeight ?? 0} at ${Math.round(l.framesPerSecond ?? 0)} fps, ${mbps('out' + l.ssrc, l.bytesSent ?? 0)} Mbps, ${l.encoderImplementation ?? '?'}${l.powerEfficientEncoder ? ' (hardware)' : ''}, held back by ${l.qualityLimitationReason || 'nothing'}`).join(' | ') +
      (pair ? `; link ${local?.protocol ?? '?'} ${local?.candidateType ?? '?'}, ${Math.round((pair.currentRoundTripTime ?? 0) * 1000)} ms, room for ${((pair.availableOutgoingBitrate ?? 0) / 1e6).toFixed(1)} Mbps` : ''));
  }
  for (const id of watching) {
    const st = await all(screenTrack(id));
    const got = st.find((x) => x.type === 'inbound-rtp' && x.kind === 'video');
    if (!got) continue;
    const el = [...document.querySelectorAll<HTMLVideoElement>('.stage video')].sort((a, b) => b.clientWidth - a.clientWidth)[0];
    const lost = got.packetsReceived ? (100 * (got.packetsLost ?? 0) / (got.packetsReceived + (got.packetsLost ?? 0))).toFixed(1) : '?';
    lines.push(`is watching ${S().users[id]?.name ?? id}: ${got.frameWidth ?? 0}x${got.frameHeight ?? 0} at ${Math.round(got.framesPerSecond ?? 0)} fps, ${mbps('in' + got.ssrc, got.bytesReceived ?? 0)} Mbps, ${got.decoderImplementation ?? '?'}${got.powerEfficientDecoder ? ' (hardware)' : ''}, ` +
      `${lost}% lost, ${got.freezeCount ?? 0} freezes, ${got.framesDropped ?? 0} frames dropped so far; drawn ${el ? Math.round(el.clientWidth * devicePixelRatio) + 'x' + Math.round(el.clientHeight * devicePixelRatio) : '?'}`);
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
