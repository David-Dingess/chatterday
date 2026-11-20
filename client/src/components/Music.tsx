import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { DUCK } from '../sfx';
import { api } from '../api';
import { ask, playerLevel, send, setPrefs, toast, useStore } from '../store';
import { joinVoice, setBigPlayer } from '../voice';
import type { Playing, Playlist, Track } from '../types';
import { Icon, SureButton } from './ui';

// The player for the voice chat. Somebody types what they want, the server finds the top hit on YouTube, and
// everyone in voice plays that same video from YouTube at the same moment, each at their own volume. Most
// people use it for music. It plays only in YouTube's own player, shown on screen (YouTube's rules: no sound without the
// picture), so folding the Player away stops it for you while the others carry on.
// The player is talked to with the messages YouTube's embedded player understands; no script of theirs is loaded.

const YT = 'https://www.youtube-nocookie.com';


function Player({ song, skew, volume }: { song: Playing; skew: number; volume: number }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const vol = useRef(volume);
  vol.current = volume;
  const now = useRef({ song, skew });         // the newest word from the server, for the listeners set up once below
  now.current = { song, skew };
  const live = useRef({ heard: false, seekAt: 0, nudgeAt: 0, dur: 0, isLive: null as boolean | null, told: false, jumpAt: Date.now(), lead: 0.25, state: -1 });
  const paused = () => now.current.song.pausedAt != null;
  /** A karaoke song, for whoever sings it: their video runs a little ahead of everybody else's (the lounge's sync,
   *  server/basement/karaoke.ts), since their voice reaches the others that much late. So it lands on the beat there. */
  const ahead = () => {
    const st = useStore.getState(), ms = Number(st.fits.karaoke?.sync);
    return now.current.song.singer && now.current.song.singer === st.me?.id && Number.isFinite(ms) ? ms / 1000 : 0;
  };
  /** How far in everyone should be (it stands still while the group has it paused). */
  const expected = () => (paused() ? now.current.song.pausedAt! : (Date.now() - now.current.skew - now.current.song.startedAt) / 1000 + ahead());
  const src = useMemo(() => `${YT}/embed/${song.videoId}?autoplay=1&mute=1&controls=0&rel=0&playsinline=1&enablejsapi=1&cc_load_policy=0&iv_load_policy=3`
    + `&start=${Math.max(0, Math.floor(expected()))}&origin=${encodeURIComponent(location.origin)}`, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const post = (msg: object) => frame.current?.contentWindow?.postMessage(JSON.stringify({ ...msg, id: 1, channel: 'widget' }), YT);
  const cmd = (func: string, ...args: unknown[]) => post({ event: 'command', func, args });
  // Unmute FIRST, then the volume. YouTube lifts any volume under 5 back up to 5 when it is told to unmute, so the
  // other way round the player could never be quieter than 5 of 100: the slider went from silent straight to that.
  const loud = () => {
    if (vol.current <= 0) return cmd('mute');
    cmd('unMute');
    cmd('setVolume', Math.max(1, Math.round(vol.current * 100)));
  };
  // Nobody can click inside the player, so captions are taken off here: YouTube turns them on by itself when the
  // video or your YouTube settings say so, and unloading the captions part of the player is the one way left to stop
  // that. The picture's quality can't be asked for at all any more (YouTube ignores every way of asking, and picks by
  // how big the player is on screen), so that is left to YouTube.
  const noCaptions = () => cmd('unloadModule', 'captions');
  /** Go to where everyone is, and play or stand still as everyone does. */
  const inStep = () => {
    live.current.seekAt = live.current.jumpAt = Date.now();
    cmd('seekTo', Math.max(0, expected() + (paused() ? 0 : live.current.lead)), true);        // a touch ahead, for the moment the jump takes
    cmd(paused() ? 'pauseVideo' : 'playVideo');
  };

  useEffect(() => {
    const hello = window.setInterval(() => {
      if (live.current.heard) return;
      post({ event: 'listening' });
      cmd('addEventListener', 'onStateChange');
      cmd('addEventListener', 'onError');
    }, 400);
    // (the karaoke singer's video ends that much early: they wait for everybody else's to end too)
    const ended = () => { const wait = ahead() * 1000; if (wait > 0) window.setTimeout(() => send({ t: 'music', op: 'ended', id: song.id }), wait); else send({ t: 'music', op: 'ended', id: song.id }); };
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== YT || e.source !== frame.current?.contentWindow || typeof e.data !== 'string') return;
      let d: any;
      try { d = JSON.parse(e.data); } catch { return; }
      if (!live.current.heard) { live.current.heard = true; window.clearInterval(hello); loud(); noCaptions(); inStep(); }       // it has answered: no more knocking
      if (d.event === 'onReady') { loud(); noCaptions(); cmd(paused() ? 'pauseVideo' : 'playVideo'); }
      // Only what is wrong with the video itself is reported: it is gone (100), or may not be played outside YouTube
      // (101, 150). "Bad" moves everybody on to the next one, and any other error (2, 5) is this one player's trouble.
      if (d.event === 'onError' && [100, 101, 150].includes(Number(d.info))) send({ t: 'music', op: 'bad', id: song.id, videoId: song.videoId });
      if (d.event === 'onStateChange' && d.info === 0) ended();
      const info = d.event === 'infoDelivery' || d.event === 'initialDelivery' ? d.info : null;
      if (!info) return;
      if (info.playerState === 0) ended();
      if (info.muted === true && vol.current > 0) loud();
      const t = Date.now();
      // A video that came without its length (one asked for by its link): the player knows it, so tell the server,
      // and everyone gets the bar. A length that keeps growing is a live stream, which has none.
      const l = live.current;
      if (info.videoData && typeof info.videoData.isLive === 'boolean') l.isLive = info.videoData.isLive;
      if (typeof info.duration === 'number' && info.duration > 1 && !l.told && !now.current.song.seconds) {
        const first = l.dur;
        l.dur = info.duration;
        const tell = () => {
          if (l.told || now.current.song.seconds) return;
          l.told = true;
          send(l.isLive ? { t: 'music', op: 'length', id: song.id, live: true } : { t: 'music', op: 'length', id: song.id, seconds: Math.round(l.dur) });
        };
        if (l.isLive != null) tell();
        else if (!first) { const began = info.duration; window.setTimeout(() => { if (l.isLive == null) l.isLive = Math.abs(l.dur - began) > 2; tell(); }, 5000); }
      }
      // Pausing and playing belong to the group: a player that has stopped or started by itself is put right.
      if (typeof info.playerState === 'number' && t - live.current.nudgeAt > 1500) {
        if (paused() && info.playerState === 1) { live.current.nudgeAt = t; cmd('pauseVideo'); }
        else if (!paused() && info.playerState === 2) { live.current.nudgeAt = t; cmd('playVideo'); }
      }
      // keep in step with everybody else (a live stream has no length, and is left alone)
      // For a few seconds after a jump the picture is held to within half a second, trying again sooner; after that it
      // is left alone unless it wanders a second and a half off. How far behind a jump lands is remembered and aimed
      // ahead by next time, since that depends on this PC and its connection.
      if (typeof info.playerState === 'number') live.current.state = info.playerState;
      const length = now.current.song.seconds;
      const settling = t - live.current.jumpAt < 12_000;
      const steady = paused() ? live.current.state === 2 : live.current.state === 1;       // not while it is still loading: the time it reports then is stale
      if (length && steady && typeof info.currentTime === 'number' && t - live.current.seekAt > (paused() ? 1500 : settling ? 2000 : 4000)) {
        const want = expected(), off = want - info.currentTime;
        // (a karaoke song is held much closer, a fifth of a second: the singer's voice has to meet the music)
        const loose = now.current.song.singer ? (settling ? 0.15 : 0.2) : settling ? 0.5 : 1.5;
        if (want > 0 && want < length - 2 && Math.abs(off) > (paused() ? 0.6 : loose)) {
          if (!paused()) live.current.lead = Math.max(0, Math.min(3, live.current.lead + off * 0.8));
          live.current.seekAt = t;
          cmd('seekTo', want + (paused() ? 0 : live.current.lead), true);
        }
      }
    };
    window.addEventListener('message', onMessage);
    return () => { window.clearInterval(hello); window.removeEventListener('message', onMessage); };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (live.current.heard) loud(); }, [volume]);   // eslint-disable-line react-hooks/exhaustive-deps
  // somebody dragged the bar, paused it or set it going again: do the same, at once
  useEffect(() => { if (live.current.heard) inStep(); }, [song.startedAt, song.pausedAt]);   // eslint-disable-line react-hooks/exhaustive-deps

  return <iframe ref={frame} src={src} title="Music" allow="autoplay; encrypted-media" referrerPolicy="strict-origin-when-cross-origin" tabIndex={-1} />;
}

/** How much of its level the Player keeps under somebody talking while a karaoke song is on: more than DUCK, since the
 *  backing track has to stay audible under the singer. */
export const KARAOKE_DUCK = 0.6;
/** A place in the room that shows the Player's video instead of the Player box (the karaoke stage's screen,
 *  client/src/basement/karaoke.tsx). There is still only the one video: the Player box puts it there while it is set. */
export const videoSpot = create<{ el: HTMLElement | null }>(() => ({ el: null }));

/** The video itself, wherever it is shown. There is only ever one, so moving it reloads it at the right moment of the track. */
function MusicVideo() {
  const music = useStore((s) => s.music);
  const volume = useStore((s) => s.prefs.playerVol);
  const deafened = useStore((s) => s.voice.deafened);
  const ducked = useStore((s) => s.ducked);
  const muted = useStore((s) => !!s.prefs.playerMuted);
  const cur = music.current;
  if (!cur) return null;
  return <Player key={`${cur.id}:${cur.videoId}`} song={cur} skew={music.skew} volume={deafened || muted ? 0 : playerLevel(volume) * (ducked ? (cur.singer ? KARAOKE_DUCK : DUCK) : 1)} />;
}

// Everybody is told while I have the video large (the Theatre view, or over the whole screen): the room's projector comes down for it.
const tellBig = () => {
  const s = useStore.getState(), fs = document.fullscreenElement;
  setBigPlayer(!!s.music.current && (s.view.kind === 'theatre' || (!!fs && fs !== document.documentElement && fs.matches('.theatre-frame, .music-frame, .stage-frame'))));
};
document.addEventListener('fullscreenchange', tellBig);
useStore.subscribe(tellBig);

/** The video, over the whole screen (Esc, or the same again, comes back). It is not moved, so it does not start over. */
function fullScreen() {
  if (document.fullscreenElement && document.fullscreenElement !== document.documentElement) return void document.exitFullscreen().catch(() => {});      // (the whole app being full screen does not count)
  const go = () => {
    const el = document.querySelector('.theatre-frame, .music-frame, .stage-frame');
    if (el) void el.requestFullscreen().catch(() => toast('Could not go full screen.'));
  };
  go();
}

const clock = (sec: number) => { const s = Math.max(0, Math.round(sec)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/** Pause or play for everyone, and the bar that shows how far in it is: drag it and everyone jumps with you. */
function Transport({ cur, skew }: { cur: Playing; skew: number }) {
  const [, tick] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);
  const dragging = useRef<number | null>(null);
  const [held, setHeld] = useState<{ to: number; at: number } | null>(null);       // where I just put it, shown until the server's word arrives
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 500);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => { setHeld(null); }, [cur.id, cur.startedAt, cur.pausedAt]);
  const paused = cur.pausedAt != null;
  const pos = Math.max(0, Math.min(cur.seconds || 86_400, paused ? cur.pausedAt! : (Date.now() - skew - cur.startedAt) / 1000));
  const commit = () => {
    const to = dragging.current;
    if (to == null) return;
    dragging.current = null;
    send({ t: 'music', op: 'seek', id: cur.id, to });
    setHeld({ to, at: Date.now() });
    setDrag(null);
  };
  // Letting go counts wherever the pointer has got to, and a drag that just stops is taken as let go after a moment:
  // a bar left "held" would sit still while the video ran on.
  useEffect(() => {
    if (drag == null) return;
    const stale = window.setTimeout(commit, 2500);
    for (const ev of ['pointerup', 'mouseup', 'touchend', 'pointercancel'] as const) window.addEventListener(ev, commit);
    return () => { window.clearTimeout(stale); for (const ev of ['pointerup', 'mouseup', 'touchend', 'pointercancel'] as const) window.removeEventListener(ev, commit); };
  }, [drag]);   // eslint-disable-line react-hooks/exhaustive-deps
  const waiting = held && Date.now() - held.at < 1500 ? held.to + (paused ? 0 : (Date.now() - held.at) / 1000) : null;
  const shown = drag ?? waiting ?? pos;
  return (
    <div className="music-seek">
      <button title={paused ? 'Play, for everyone' : 'Pause, for everyone'} onClick={() => send({ t: 'music', op: paused ? 'resume' : 'pause', id: cur.id })}>
        {paused ? <Icon name="play" size={12} /> : <i className="pause-glyph" />}
      </button>
      <small>{clock(shown)}</small>
      {cur.seconds > 0
        ? <input type="range" min={0} max={cur.seconds} step={1} value={shown} title="Drag to jump: everyone jumps with you" aria-label="How far in it is"
            onChange={(e) => { dragging.current = Number(e.target.value); setDrag(dragging.current); }} onKeyUp={commit} onBlur={commit} />
        : <span className="no-length">{cur.live ? 'live' : ''}</span>}
      {cur.seconds > 0 && <small>{clock(cur.seconds)}</small>}
    </div>
  );
}

/** Theatre: the Player's video fills the middle of the window, for watching something together. */
export function Theatre() {
  const cur = useStore((s) => s.music.current);
  const skew = useStore((s) => s.music.skew);
  const users = useStore((s) => s.users);
  return (
    <section className="theatre">
      <header className="bar">
        <h2><Icon name="tube" /> {cur ? cur.title : 'Nothing is playing'}</h2>
        {cur && <small>picked by {users[cur.by]?.name ?? 'someone'}</small>}
        <button onClick={() => useStore.setState({ view: { kind: 'hangout' } })}>Back to the room</button>
      </header>
      <div className="theatre-frame" onDoubleClick={fullScreen} title="Double-click for full screen"><MusicVideo /></div>
      {cur && (
        <footer className="theatre-controls">
          <Transport cur={cur} skew={skew} />
          <button onClick={fullScreen} title="The video over the whole screen (Esc to come back)"><Icon name="max" size={12} /> Full screen</button>
        </footer>
      )}
    </section>
  );
}

export const MusicBox = memo(function MusicBox() {
  const music = useStore((s) => s.music);
  const users = useStore((s) => s.users);
  const volume = useStore((s) => s.prefs.playerVol);
  const deafened = useStore((s) => s.voice.deafened);
  const ducked = useStore((s) => s.ducked);
  const open = useStore((s) => s.prefs.playerOpen);
  const theatre = useStore((s) => s.view.kind === 'theatre');
  const spot = videoSpot((s) => s.el);
  const [q, setQ] = useState('');
  const [volOpen, setVolOpen] = useState(false);
  // The speaker turns the Player off and on again, the slider staying where it was; moving the slider turns it back on.
  const muted = useStore((s) => !!s.prefs.playerMuted);
  const setVol = (v: number) => setPrefs({ playerVol: v, playerMuted: false });
  const muteBtn = (
    <button type="button" className={`icon mute${muted ? ' muted' : ''}`} title={muted ? 'Turn the Player back on' : 'Mute the Player (just for you)'}
      aria-pressed={muted} onClick={() => setPrefs({ playerMuted: !muted })}><Icon name="speaker" size={12} /></button>
  );
  const volBox = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!volOpen) return;
    const away = (e: MouseEvent) => { if (!volBox.current?.contains(e.target as Node)) setVolOpen(false); };
    document.addEventListener('pointerdown', away);      // (pointerdown: Safari on an iPad sends no mousedown for a tap on nothing in particular)
    return () => document.removeEventListener('pointerdown', away);
  }, [volOpen]);
  const cur = music.current;
  // recently played, and lists the group has saved: either can be queued with a click
  const [panel, setPanel] = useState<'' | 'recent' | 'lists'>('');
  const [recent, setRecent] = useState<Track[]>([]);
  const [lists, setLists] = useState<Playlist[]>([]);
  useEffect(() => {
    if (!panel) return;
    void api<{ lists: Playlist[] }>('/music/lists').then((r) => setLists(r.lists)).catch(() => {});
    if (panel === 'recent') void api<{ items: Track[] }>('/music/history').then((r) => setRecent(r.items)).catch(() => {});
  }, [panel, cur?.id]);
  const lists_ = (path: string, body?: unknown, method?: string) => api<{ lists: Playlist[] }>(path, body, method).then((r) => setLists(r.lists)).catch((e) => toast(e.message));
  const track = (t: Track) => ({ videoId: t.videoId, title: t.title, seconds: t.seconds });
  const saveList = async () => {
    const name = await ask('Name for the list (what is playing and queued is saved in it)', '');
    if (name?.trim()) void lists_('/music/lists', { name: name.trim(), items: [cur, ...music.queue].filter(Boolean).map((s) => track(s!)) });
  };
  const who = (id: string) => users[id]?.name ?? 'someone';
  const add = () => {
    if (!q.trim()) return;
    send({ t: 'music', op: 'add', q: q.trim() });
    setQ('');
  };

  return (
    <div className={`musicbox${open ? '' : ' folded'}`}>
      <div className="music-head">
        <Icon name="play" /><b>{open || !music.current ? 'Player' : music.current.title}</b>
        <button className={`icon${theatre ? ' on' : ''}`} disabled={!cur} title={theatre ? 'Back to the room' : 'Theatre: watch it large, in the middle of the window'}
          onClick={() => useStore.setState({ view: { kind: theatre ? 'hangout' : 'theatre' } })}><Icon name="full" size={12} /></button>
        <button className="icon" disabled={!cur} title="Full screen: the video over the whole screen (Esc to come back)" onClick={fullScreen}><Icon name="max" size={12} /></button>
        <span className="vol-inline">{muteBtn}
          <input type="range" min={0} max={1} step={0.02} value={volume} title="Player volume (just for you)" aria-label="Player volume" onChange={(e) => setVol(Number(e.target.value))} />
        </span>
        {/* in a narrow panel there is no room for the slider: the speaker becomes a button that opens it */}
        <span className="vol-pop" ref={volBox}>
          <button className={`icon${volOpen ? ' on' : ''}${muted ? ' muted' : ''}`} title="Player volume (just for you)" onClick={() => setVolOpen(!volOpen)}><Icon name="speaker" size={12} /></button>
          {volOpen && (
            <span className="vol-popup">{muteBtn}
              <input type="range" min={0} max={1} step={0.02} value={volume} aria-label="Player volume" onChange={(e) => setVol(Number(e.target.value))} />
            </span>
          )}
        </span>
        {/* folded, only this line is left: the video stops for you (never sound without the picture), and its name takes the title's place */}
        <button className="icon fold" title={open ? 'Fold the Player away' : 'Open the Player'} onClick={() => { setVolOpen(false); setPrefs({ playerOpen: !open }); }}><Icon name={open ? 'down' : 'up'} size={12} /></button>
      </div>
      {cur && (
        <>
          {/* (in the karaoke room the video is moved onto its big screen; folded, the video stops for you: never sound without the picture) */}
          {!theatre && (spot ? createPortal(<MusicVideo />, spot)
            : open ? <div className="music-frame" onDoubleClick={fullScreen} title="Double-click for full screen"><MusicVideo /></div>
            : <p className="music-off">Folded away, so it is not playing for you. Open the Player to watch and hear it.</p>)}
          <div className="music-now">
            <span title={cur.title}><b>{cur.title}</b><small>{cur.singer ? `karaoke: ${who(cur.singer)} sings` : cur.auto ? `autoplay, after ${who(cur.by)}'s pick` : `picked by ${who(cur.by)}`}</small></span>
            <button title="Skip to the next one" onClick={() => send({ t: 'music', op: 'skip', id: cur?.id })}><Icon name="next" size={12} /></button>
            <button title="Stop and empty the queue" onClick={() => send({ t: 'music', op: 'stop' })}><Icon name="stop" size={12} /></button>
          </div>
          <Transport cur={cur} skew={music.skew} />
          <p className="music-terms">Plays through YouTube: <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">YouTube Terms of Service</a> · <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">Google Privacy Policy</a></p>
        </>
      )}
      {music.queue.length > 0 && (
        <ol className="music-queue">
          {music.queue.map((s) => (
            <li key={s.id} title={`${s.title} — ${s.singer ? `karaoke, sung by ${who(s.singer)}` : `picked by ${who(s.by)}`}`}><span>{s.singer ? `${who(s.singer)}: ` : ''}{s.title}</span>
              <button className="icon" title="Take it off the queue" onClick={() => send({ t: 'music', op: 'remove', id: s.id })}><Icon name="close" size={8} /></button></li>
          ))}
        </ol>
      )}
      <div className="music-tabs">
        <button className={panel === 'recent' ? 'active' : ''} onClick={() => setPanel(panel === 'recent' ? '' : 'recent')}>Recent</button>
        <button className={panel === 'lists' ? 'active' : ''} onClick={() => setPanel(panel === 'lists' ? '' : 'lists')}>Lists</button>
      </div>
      {panel === 'recent' && (
        <ul className="music-list">
          {!recent.length && <li className="empty">Nothing has been played yet.</li>}
          {recent.map((t) => (
            <li key={t.videoId}>
              <button className="row" title="Play it again (it joins the queue)" onClick={() => send({ t: 'music', op: 'play', ...track(t) })}>{t.title}</button>
              {lists.length > 0 && (
                <select value="" title="Add to a list" aria-label="Add to a list" onChange={(e) => { if (e.target.value) void lists_(`/music/lists/${e.target.value}/items`, track(t)); }}>
                  <option value="">+</option>
                  {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              )}
            </li>
          ))}
        </ul>
      )}
      {panel === 'lists' && (
        <ul className="music-list">
          {!lists.length && <li className="empty">No lists yet.</li>}
          {lists.map((l) => (
            <li key={l.id}>
              <button className="row" disabled={!l.items.length} title={l.items.map((i) => i.title).join('\n') || 'Empty'} onClick={() => send({ t: 'music', op: 'list', id: l.id })}>{l.name} <small>({l.items.length})</small></button>
              {cur && <button className="icon" title={`Add what is playing to "${l.name}"`} onClick={() => void lists_(`/music/lists/${l.id}/items`, track(cur))}><Icon name="plus" size={12} /></button>}
              <SureButton className="icon" title="Delete this list" onSure={() => void lists_(`/music/lists/${l.id}`, undefined, 'DELETE')}><Icon name="trash" size={12} /></SureButton>
            </li>
          ))}
          <li><button className="row" disabled={!cur} onClick={() => void saveList()}><Icon name="plus" size={12} /> Save what is playing as a list</button></li>
        </ul>
      )}
      <form className="music-add" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input value={q} maxLength={200} placeholder={cur ? 'Add another: search or link' : 'Play: a song, a video, or a YouTube link'}
          onChange={(e) => setQ(e.target.value)} aria-label="Search YouTube" />
        <button className="primary" disabled={!q.trim()} title="Plays the top hit on YouTube for everyone in voice"><Icon name="search" size={12} /></button>
      </form>
    </div>
  );
});

// ───────────────────────── the radios in the rooms ─────────────────────────
// The boombox upstairs, the jukebox in the game room and the radios in the backyard and at the campfire are all the
// Player. One click with nothing on puts on Lofi Girl's lo-fi stream at once (the server finds today's id: music.ts,
// LOFI_RADIO); with something on, a little menu in the room: the lo-fi instead, the Player off, or leave it.
// The Player belongs to the voice chat, so somebody who is not in it (or is at the Game Table) gets a menu that takes
// them there, and the lo-fi starts once they are in if nothing is on by then.
const LOFI_RADIO = 'radio:lofi';
const useRadio = create<{ at: { x: number; y: number; name: string } | null }>(() => ({ at: null }));
const mainVoice = () => useStore.getState().channels.find((c) => c.kind === 'voice')?.id;
const inMainVoice = () => { const id = mainVoice(); return id != null && useStore.getState().voice.channelId === id; };
const lofi = () => send({ t: 'music', op: 'add', q: LOFI_RADIO });
/** A radio clicked at (x, y) in the room's own pixels. */
export function clickRadio(x: number, y: number, name = 'The radio') {
  if (useRadio.getState().at) return void useRadio.setState({ at: null });
  if (inMainVoice() && !useStore.getState().music.current) return lofi();
  useRadio.setState({ at: { x, y, name } });
}
/** Closes the radio's menu if it is open (true if it was), for a click anywhere else in the room. */
export function closeRadio() {
  if (!useRadio.getState().at) return false;
  useRadio.setState({ at: null });
  return true;
}
/** What pointing at a radio says. */
export function radioSays(name = 'The radio') {
  const s = useStore.getState(), cur = s.music.current;
  return !inMainVoice() ? `${name}: it plays in the voice chat` : cur ? `${name} is playing ${cur.title}` : `${name}: click for lo-fi`;
}
/** The menu, drawn in the room (in its own pixels, w by h). `floor`: it closes when I take the stairs. */
export function RadioMenu({ floor, w, h }: { floor: string; w: number; h: number }) {
  const at = useRadio((s) => s.at);
  const cur = useStore((s) => s.music.current);
  const voiceOn = useStore((s) => s.settings.voice);
  const connecting = useStore((s) => s.voice.connecting);
  const inMain = useStore((s) => { const id = s.channels.find((c) => c.kind === 'voice')?.id; return id != null && s.voice.channelId === id; });
  useEffect(() => () => { useRadio.setState({ at: null }); }, [floor]);
  useEffect(() => {
    if (!at) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') useRadio.setState({ at: null }); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [at]);
  if (!at) return null;
  const done = () => useRadio.setState({ at: null });
  const join = async () => {
    done();
    const id = mainVoice();
    if (id == null) return;
    await joinVoice(id);
    // (a moment for the server to know I am in, then the lo-fi, unless somebody has put something on meanwhile)
    setTimeout(() => { if (inMainVoice() && !useStore.getState().music.current) lofi(); }, 1500);
  };
  return (
    <div className="act-menu" style={{ left: Math.max(4, Math.min(w - 90, at.x)), top: Math.max(4, Math.min(h - 48, at.y)), zIndex: 4000 }} onClick={(e) => e.stopPropagation()}>
      <b>{at.name}</b>
      {!inMain ? (<>
        {voiceOn && <button disabled={connecting} onClick={() => void join()}>{cur ? 'Join the voice chat to hear it' : 'Join the voice chat and play it'}</button>}
        <button onClick={done}>Leave it</button>
      </>) : (<>
        <button onClick={() => { send({ t: 'music', op: 'stop' }); lofi(); done(); }}>Lo-fi radio</button>
        {cur && <button onClick={() => { send({ t: 'music', op: 'stop' }); done(); }}>Turn it off</button>}
        <button onClick={done}>Leave it</button>
      </>)}
    </div>
  );
}
