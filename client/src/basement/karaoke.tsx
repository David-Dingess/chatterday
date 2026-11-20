// The karaoke lounge (scripts/basement/karaoke.py draws it; the server's half is server/basement/karaoke.ts).
//
// The songs are the Player's: signing up puts a song on the Player's queue tagged with who sings it (the 'music'
// message, op 'play', karaoke: true), so everybody in voice hears it in step, and seek, pause and skip work as ever.
// Drawn here, over the picture:
//   the big screen behind the stage: the Player's own video, moved into it while I am down here (Music.tsx videoSpot:
//     still the one video, never a second player); with nothing on, or me out of the voice chat, a still card instead;
//   the line-up board beside it: who is singing and who is up next, from the Player's queue;
//   the host stand: a click on it is the sign-up (search YouTube, "karaoke" added, pick one of the top hits), and the
//     songs of mine still waiting, to take off;
//   the stage: when it is my turn I walk up to the mic, take it out of its stand and sing (the drink row's lifted frames,
//     the mic in the hand: ./karaoke-art.ts), with a pool of light on the boards round my feet (never on anybody); Done
//     (or the song ending) brings the next one up, and I go back and sit down;
//   the announcer: at every change of singer the server sends the words ("Great job, Sam! Riya, you're up!"); each page
//     in the voice chat says them with the browser's own speech (not when deafened, at the sound volume), and the room
//     shows them on a card.
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { create } from 'zustand';
import { marksOf, personColor } from '../sprites';
import { hooks, send, soundGain, useStore } from '../store';
import { videoSpot } from '../components/Music';
import { joinVoice } from '../voice';
import { LAYOUT } from './karaoke.gen';
import { drawn } from './index';
import type { FitPose, FitProps } from './index';
import { pixels } from './smokes';
import type { Art } from './smokes';
import { MIC_HELD, micAt, STAND_EMPTY, STAND_MIC } from './karaoke-art';
import './karaoke.css';

const ID = 'karaoke';
const T = LAYOUT.things as Record<string, any>;
const SCREEN = T.screen as number[], BOARD = T.board as number[], BOOTH = T.booth as number[], BOOTH_STAND = T.boothStand as number[];
const STAGE = T.stage as number, STAGE_KEY = `b${T.stage}`, SPOT = T.spot as number[], MIC = T.mic as number[], POOL = T.pool as number[];
const AUDIENCE = T.audience as number[];
const box = (r: number[]): CSSProperties => ({ left: r[0], top: r[1], width: r[2], height: r[3] });

type Found = { videoId: string; title: string; seconds: number };
const clock = (sec: number) => (sec > 0 ? `${Math.floor(sec / 60)}:${String(Math.round(sec) % 60).padStart(2, '0')}` : '');
const first = (name: string | undefined) => (name ?? 'Someone').trim().split(/\s+/)[0] || 'Someone';
const mainVoice = () => useStore.getState().channels.find((c) => c.kind === 'voice')?.id;
const inMainVoice = () => { const id = mainVoice(); return id != null && useStore.getState().voice.channelId === id; };

// ── the announcer ──
/** The card the room shows, and what was last said (for anybody checking: window.__karaokeSaid in a test). */
const card = create<{ text: string; n: number; at: number }>(() => ({ text: '', n: 0, at: 0 }));
const CARD_MS = 6500;
let robot: SpeechSynthesisVoice | null | undefined;
/** An English voice, the plainer the better (a robot is the point): Windows' own first, then any. */
function voiceFor(synth: SpeechSynthesis) {
  if (robot !== undefined) return robot;
  const all = synth.getVoices().filter((v) => /^en/i.test(v.lang));
  if (!all.length) return null;          // (the list arrives a moment after the page loads: asked again next time)
  robot = all.find((v) => /microsoft (david|mark)/i.test(v.name)) ?? all.find((v) => /en-US/i.test(v.lang)) ?? all[0];
  return robot;
}
/** Says it, if I can hear the Player (in the main voice chat, not deafened, the sound not all the way down). */
export function speak(text: string) {
  const s = useStore.getState(), w = window as unknown as { __karaokeSaid?: string[] };
  if (!inMainVoice() || s.voice.deafened) return false;
  const vol = soundGain(s.prefs.soundVol);
  const synth = typeof window.speechSynthesis !== 'undefined' ? window.speechSynthesis : null;
  if (vol <= 0 || !synth || typeof SpeechSynthesisUtterance === 'undefined') return false;
  const u = new SpeechSynthesisUtterance(text);
  u.volume = Math.max(0, Math.min(1, vol));
  u.rate = 0.95;
  u.pitch = 0.4;                         // (low and flat: an announcer, a little robotic)
  const v = voiceFor(synth);
  if (v) u.voice = v;
  synth.cancel();
  synth.speak(u);
  (w.__karaokeSaid ??= []).push(text);
  return true;
}
hooks.fit.push((d) => {
  if (d.id !== ID || d.op !== 'say' || typeof d.text !== 'string') return;
  const text = d.text.slice(0, 160);
  card.setState((c) => ({ text, n: c.n + 1, at: Date.now() }));
  speak(text);
});

// ── the sign-up's search results, as the server sends them ──
const found = create<{ q: string; results: Found[] | null; error: string }>(() => ({ q: '', results: null, error: '' }));
hooks.fit.push((d) => {
  if (d.id !== ID || d.op !== 'found') return;
  found.setState({ q: String(d.q ?? ''), results: Array.isArray(d.results) ? d.results : [], error: String(d.error ?? '') });
});

// ── how the singer is drawn: at the mic, the hand up at the mouth with it (eyes shut: the drink row's sip frames) ──
const singer = () => useStore.getState().music.current?.singer;
export function pose(uid: string, seat: string): FitPose | null {
  if (seat !== STAGE_KEY || singer() !== uid) return null;
  return { row: 'drink', first: 2, frames: 2, ms: 650 };
}
/** What pointing at the stage spot says (nobody is ever sent there by a click: it has no hit). */
export const says = (seat: number) => (seat === STAGE ? 'The stage' : AUDIENCE.includes(seat) ? 'Sit and watch' : undefined);

/** A picture as an image to lay over the room (made once, as it is first needed). */
const urls = new Map<string, { url: string; w: number; h: number; anchor: [number, number] }>();
function urlOf(name: string, art: Art, skin = '#f0c2a2') {
  const key = `${name}${skin}`;
  let u = urls.get(key);
  if (!u) {
    const px = pixels(art, false, skin), c = document.createElement('canvas');
    c.width = px.w; c.height = px.h;
    c.getContext('2d')!.putImageData(new ImageData(px.frames[0] as Uint8ClampedArray<ArrayBuffer>, px.w, px.h), 0, 0);
    u = { url: c.toDataURL(), w: px.w, h: px.h, anchor: px.anchor };
    urls.set(key, u);
  }
  return u;
}
const img = (u: { url: string; w: number; h: number }): CSSProperties => ({ backgroundImage: `url(${u.url})`, width: u.w, height: u.h });

/** Somebody sat in one of these seats just now (by seat number), but for me. */
function takenSeats() {
  const s = useStore.getState(), me = s.me?.id;
  return new Set(Object.entries(s.presence).filter(([id, p]) => id !== me && p && p.state !== 'offline' && p.floor === ID && p.place === 'here' && p.at?.seat)
    .map(([, p]) => Number(p.at!.seat!.slice(1))));
}

export function Room({ mini }: FitProps) {
  const cur = useStore((s) => s.music.current);
  const queue = useStore((s) => s.music.queue);
  const users = useStore((s) => s.users);
  const meId = useStore((s) => s.me?.id ?? '');
  const myFloor = useStore((s) => (s.me ? s.presence[s.me.id]?.floor ?? '' : ''));
  const mySeat = useStore((s) => (s.me ? s.presence[s.me.id]?.at?.seat ?? '' : ''));
  const inVoice = useStore((s) => { const id = s.channels.find((c) => c.kind === 'voice')?.id; return id != null && s.voice.channelId === id; });
  const voiceOn = useStore((s) => s.settings.voice);
  const connecting = useStore((s) => s.voice.connecting);
  const said = card();
  const [, tick] = useState(0);
  const here = !mini && myFloor === ID;
  const nameOf = (id: string | undefined) => first(id ? users[id]?.name : undefined);
  const singing = cur?.singer;
  const lineUp = queue.filter((s) => s.singer);

  // the screen: the Player's video comes here while I am down here (and goes back to the Player box when I leave)
  const spotRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = spotRef.current;
    if (!here || !el) return;
    videoSpot.setState({ el });
    return () => { if (videoSpot.getState().el === el) videoSpot.setState({ el: null }); };
  }, [here]);

  // my turn: up to the mic (once a song); my turn over and still up there: back down to a seat
  const sentFor = useRef(0);
  useEffect(() => {
    if (!here || !cur) return;
    if (singing === meId && sentFor.current !== cur.id) {
      sentFor.current = cur.id;
      if (mySeat !== STAGE_KEY) send({ t: 'place', place: 'here', x: SPOT[0], y: SPOT[1], seat: STAGE_KEY });
    }
  }, [here, cur?.id, singing, meId]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!here || mySeat !== STAGE_KEY || singing === meId) return;
    const t = window.setTimeout(() => {
      if (singer() === meId) return;
      const taken = takenSeats(), n = AUDIENCE.find((k) => !taken.has(k)) ?? AUDIENCE[0];
      const q = LAYOUT.seats[n];
      send({ t: 'place', place: 'here', x: q.x, y: q.y, seat: `b${n}` });
    }, 1800);         // (a moment to take a bow)
    return () => window.clearTimeout(t);
  }, [here, mySeat, singing, meId]);

  // the card: shown for a while after it is said
  useEffect(() => {
    if (!said.at) return;
    const left = said.at + CARD_MS - Date.now();
    if (left <= 0) return;
    const t = window.setTimeout(() => tick((n) => n + 1), left + 50);
    return () => window.clearTimeout(t);
  }, [said.n]);   // eslint-disable-line react-hooks/exhaustive-deps
  const cardOn = !!said.text && Date.now() - said.at < CARD_MS;

  // the mic: in the singer's hand once they are at the stand, and in its stand otherwise. Placed every frame, on the
  // frame their sprite is showing (so it keeps step as they breathe).
  const micNode = useRef<HTMLElement>(null);
  const atMic = useRef(false);
  const [micOut, setMicOut] = useState(false);
  useEffect(() => {
    if (mini) return;
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const s = useStore.getState(), who = s.music.current?.singer, node = micNode.current;
      const q = who ? drawn.get(who) : undefined;
      const up = !!who && !!q && s.presence[who]?.at?.seat === STAGE_KEY && Math.hypot(q.x - SPOT[0], q.y - SPOT[1]) < 1.5 && q.row === 'drink';
      if (up !== atMic.current) { atMic.current = up; setMicOut(up); }
      if (!node) return;
      if (!up || !q) { node.style.display = 'none'; return; }
      const u = s.users[who!];
      if (!u) return;
      let f = q.first ?? 2;
      const spr = q.el?.firstElementChild as HTMLElement | null | undefined;
      if (spr && (q.frames ?? 1) > 1) { const an = spr.getAnimations?.()[0]; f += Math.floor(Number(an?.currentTime ?? 0) / (q.ms || 650)) % (q.frames ?? 1); }
      const mk = marksOf(u), art = urlOf('held', MIC_HELD, mk.skin), at = micAt(mk, f);
      if (node.dataset.skin !== mk.skin) { node.dataset.skin = mk.skin; Object.assign(node.style, { backgroundImage: `url(${art.url})`, width: `${art.w}px`, height: `${art.h}px` }); }
      node.style.display = '';
      node.style.transform = `translate(${Math.round(q.x - 24 + at[0] - art.anchor[0])}px, ${Math.round(q.y - 45 + at[1] - art.anchor[1])}px)`;
      node.style.zIndex = String(Math.round(q.y) + 2);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [mini]);
  const stand = urlOf(micOut ? 'empty' : 'stand', micOut ? STAND_EMPTY : STAND_MIC);

  // the sign-up, opened by a click on the host stand
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const results = found((s) => s.results), searched = found((s) => s.q), error = found((s) => s.error);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setBusy(false); }, [results, error]);
  useEffect(() => { if (!here) setOpen(false); }, [here]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open]);
  const search = () => {
    const text = q.trim();
    if (!text) return;
    setBusy(true);
    found.setState({ results: null, error: '' });
    send({ t: 'fit', id: ID, op: 'search', q: text });
  };
  const pick = (r: Found) => {
    const others = (results ?? []).filter((o) => o.videoId !== r.videoId);
    send({ t: 'music', op: 'play', karaoke: true, videoId: r.videoId, title: r.title, seconds: r.seconds, alts: others });
    setOpen(false); setQ(''); found.setState({ results: null, q: '', error: '' });
  };
  const clickBooth = () => {
    if (open) return setOpen(false);
    setOpen(true);
    send({ t: 'place', place: 'here', x: BOOTH_STAND[0], y: BOOTH_STAND[1] });
  };
  const mine = lineUp.filter((s) => s.singer === meId);
  const admin = useStore((s) => s.me?.role === 'admin');
  const sync = useStore((s) => Number(s.fits.karaoke?.sync) || 0);

  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  return (
    <>
      {/* the screen: the Player's video lands in .ko-video (put there by the Player box); a still card under it */}
      <div className="ko-screen stage-frame" style={{ ...box(SCREEN), zIndex: 2 }}>
        <div className="ko-idle">
          {cur && singing ? <><b>{nameOf(singing)}</b><span className="ko-title">{cur.title}</span>{!inVoice && <span className="ko-note">in the voice chat</span>}</>
            : cur ? <><span className="ko-title">{cur.title}</span>{!inVoice && <span className="ko-note">playing in the voice chat</span>}</>
            : <><b className="ko-logo">KARAOKE</b><span className="ko-note">sign up at the stand</span></>}
        </div>
        <div className="ko-video" ref={spotRef} />
      </div>

      {/* the line-up board */}
      <ol className="ko-board" style={{ ...box(BOARD), zIndex: 3 }}>
        {singing && <li className="now"><i style={{ background: personColor(users[singing]) }} />{nameOf(singing)}<span className="ko-tag">now</span></li>}
        {lineUp.slice(0, 5).map((s, k) => <li key={s.id}><i style={{ background: personColor(users[s.singer!]) }} />{nameOf(s.singer)}<span className="ko-tag">{k === 0 ? 'next' : `${k + 1}`}</span></li>)}
        {!singing && !lineUp.length && <li className="none">nobody yet</li>}
        {lineUp.length > 5 && <li className="none">and {lineUp.length - 5} more</li>}
      </ol>
      {/* Done for the singer (Skip for anyone else down here) */}
      {!mini && singing && inVoice && (
        <button className="ko-done" style={{ left: BOARD[0] - 4, top: BOARD[1] + BOARD[3] + 6, width: BOARD[2] + 8, zIndex: 3000 }}
          title={singing === meId ? 'Finished: the next singer is up' : `Skip ${nameOf(singing)}'s song: the next singer is up`}
          onClick={(e) => { stop(e); send({ t: 'music', op: 'skip', id: cur!.id }); }}>{singing === meId ? 'Done' : 'Skip'}</button>
      )}

      {/* the admin only: how far ahead the singer's video runs, tuned by ear while somebody sings (server/basement/karaoke.ts) */}
      {!mini && singing && admin && (
        <span className="ko-sync" style={{ left: BOARD[0] - 4, top: BOARD[1] + BOARD[3] + 19, width: BOARD[2] + 8, zIndex: 3000 }} onClick={stop}
          title="The singer's video runs this far ahead of everybody else's. Voice late on the music: more. Voice early: less.">
          <button title="Less: the voice is coming in early" onClick={() => send({ t: 'fit', id: ID, op: 'sync', by: -50 })}>-</button>
          <span>sync {(sync / 1000).toFixed(2)}s</span>
          <button title="More: the voice is coming in late" onClick={() => send({ t: 'fit', id: ID, op: 'sync', by: 50 })}>+</button>
        </span>
      )}

      {/* the spotlight's pool on the stage, under the singer's feet (never on them) */}
      {singing && <i className="ko-pool" style={{ left: POOL[0] - POOL[2], top: POOL[1] - POOL[3], width: POOL[2] * 2, height: POOL[3] * 2, zIndex: 1 }} />}
      {/* the mic stand, and the mic in the singer's hand */}
      {!mini && <i className="ko-pic" style={{ ...img(stand), left: MIC[0] - stand.anchor[0], top: MIC[1] - stand.anchor[1], zIndex: MIC[1] }} />}
      <i className="ko-pic ko-held" ref={micNode} style={{ display: 'none' }} />

      {/* the host stand: a click on it is the sign-up */}
      {!mini && <i className="ko-hot" title="Sign up to sing" style={{ ...box(BOOTH), zIndex: BOOTH[1] + BOOTH[3] }} onClick={(e) => { stop(e); clickBooth(); }} />}
      {open && !mini && (
        <form className="ko-menu" style={{ left: BOOTH[0] + BOOTH[2] + 4, top: BOOTH[1] - 2, zIndex: 4000 }} onClick={stop} onMouseMove={stop}
          onSubmit={(e) => { e.preventDefault(); search(); }}>
          <b>Sign up to sing</b>
          {!inVoice ? (<>
            <p>The songs play on the Player, in the voice chat.</p>
            {voiceOn && <button type="button" disabled={connecting} onClick={() => { const id = mainVoice(); if (id != null) void joinVoice(id); }}>Join the voice chat</button>}
          </>) : (<>
            <span className="ko-row">
              <input autoFocus value={q} maxLength={150} placeholder="Song and artist" aria-label="Song and artist" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
              <button className="primary" disabled={!q.trim() || busy}>{busy ? '...' : 'Find'}</button>
            </span>
            {error && <p>{error}</p>}
            {results && !results.length && !error && <p>Nothing found for "{searched}".</p>}
            {results && results.map((r) => (
              <button type="button" key={r.videoId} className="ko-result" title={r.title} onClick={() => pick(r)}>
                <span>{r.title}</span><span className="ko-len">{clock(r.seconds)}</span>
              </button>
            ))}
            {mine.length > 0 && <>
              <b>Waiting to sing</b>
              {mine.map((s) => (
                <span key={s.id} className="ko-row ko-mine"><span title={s.title}>{s.title}</span>
                  <button type="button" title="Take it off the line-up" onClick={() => send({ t: 'music', op: 'remove', id: s.id })}>Drop</button></span>
              ))}
            </>}
          </>)}
          <button type="button" onClick={() => setOpen(false)}>Close</button>
        </form>
      )}

      {/* the announcer's card */}
      {cardOn && !mini && <div key={said.n} className="ko-card" style={{ left: SCREEN[0] + SCREEN[2] / 2, top: SCREEN[1] + SCREEN[3] + 14, zIndex: 4000 }}>{said.text}</div>}
    </>
  );
}
