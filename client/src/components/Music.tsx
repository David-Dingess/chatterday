import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { DUCK } from '../sfx';
import { api } from '../api';
import { ask, playerLevel, send, setPrefs, toast, useStore } from '../store';
import { setBigPlayer } from '../voice';
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
  /** How far in everyone should be (it stands still while the group has it paused). */
  const expected = () => (paused() ? now.current.song.pausedAt! : (Date.now() - now.current.skew - now.current.song.startedAt) / 1000);
  const src = useMemo(() => `${YT}/embed/${song.videoId}?autoplay=1&mute=1&controls=0&rel=0&playsinline=1&enablejsapi=1`
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
    const ended = () => send({ t: 'music', op: 'ended', id: song.id });
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== YT || e.source !== frame.current?.contentWindow || typeof e.data !== 'string') return;
      let d: any;
      try { d = JSON.parse(e.data); } catch { return; }
      if (!live.current.heard) { live.current.heard = true; window.clearInterval(hello); loud(); inStep(); }       // it has answered: no more knocking
      if (d.event === 'onReady') { loud(); cmd(paused() ? 'pauseVideo' : 'playVideo'); }
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
        if (want > 0 && want < length - 2 && Math.abs(off) > (paused() ? 0.6 : settling ? 0.5 : 1.5)) {
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

/** The video itself, wherever it is shown. There is only ever one, so moving it reloads it at the right moment of the track. */
function MusicVideo() {
  const music = useStore((s) => s.music);
  const volume = useStore((s) => s.prefs.playerVol);
  const deafened = useStore((s) => s.voice.deafened);
  const ducked = useStore((s) => s.ducked);
  const cur = music.current;
  if (!cur) return null;
  return <Player key={`${cur.id}:${cur.videoId}`} song={cur} skew={music.skew} volume={deafened ? 0 : playerLevel(volume) * (ducked ? DUCK : 1)} />;
}

// Everybody is told while I have the video large (the Theatre view, or over the whole screen): the room's projector comes down for it.
const tellBig = () => {
  const s = useStore.getState(), fs = document.fullscreenElement;
  setBigPlayer(!!s.music.current && (s.view.kind === 'theatre' || (!!fs && fs !== document.documentElement && fs.matches('.theatre-frame, .music-frame'))));
};
document.addEventListener('fullscreenchange', tellBig);
useStore.subscribe(tellBig);

/** The video, over the whole screen (Esc, or the same again, comes back). It is not moved, so it does not start over. */
function fullScreen() {
  if (document.fullscreenElement && document.fullscreenElement !== document.documentElement) return void document.exitFullscreen().catch(() => {});      // (the whole app being full screen does not count)
  const el = document.querySelector('.theatre-frame, .music-frame');
  if (el) void el.requestFullscreen().catch(() => toast('Could not go full screen.'));
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
        <h2><Icon name="play" /> {cur ? cur.title : 'Nothing is playing'}</h2>
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
  const [q, setQ] = useState('');
  const [volOpen, setVolOpen] = useState(false);
  const volBox = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!volOpen) return;
    const away = (e: MouseEvent) => { if (!volBox.current?.contains(e.target as Node)) setVolOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
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
        <label className="vol-inline" title="Player volume (just for you)"><Icon name="speaker" size={12} />
          <input type="range" min={0} max={1} step={0.02} value={volume} onChange={(e) => setPrefs({ playerVol: Number(e.target.value) })} />
        </label>
        {/* in a narrow panel there is no room for the slider: the speaker becomes a button that opens it */}
        <span className="vol-pop" ref={volBox}>
          <button className={`icon${volOpen ? ' on' : ''}`} title="Player volume (just for you)" onClick={() => setVolOpen(!volOpen)}><Icon name="speaker" size={12} /></button>
          {volOpen && (
            <span className="vol-popup">
              <input type="range" min={0} max={1} step={0.02} value={volume} aria-label="Player volume" onChange={(e) => setPrefs({ playerVol: Number(e.target.value) })} />
            </span>
          )}
        </span>
        {/* folded, only this line is left: the video stops for you (never sound without the picture), and its name takes the title's place */}
        <button className="icon fold" title={open ? 'Fold the Player away' : 'Open the Player'} onClick={() => { setVolOpen(false); setPrefs({ playerOpen: !open }); }}><Icon name={open ? 'down' : 'up'} size={12} /></button>
      </div>
      {cur && (
        <>
          {!theatre && open && <div className="music-frame"><MusicVideo /></div>}
          {!theatre && !open && <p className="music-off">Folded away, so it is not playing for you. Open the Player to watch and hear it.</p>}
          <div className="music-now">
            <span title={cur.title}><b>{cur.title}</b><small>picked by {who(cur.by)}</small></span>
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
            <li key={s.id} title={`${s.title} — picked by ${who(s.by)}`}><span>{s.title}</span>
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
        <input value={q} maxLength={200} placeholder={cur ? 'Add another: search or link' : 'Play: a song, a video, or a YouTube link'} onChange={(e) => setQ(e.target.value)} aria-label="Search YouTube" />
        <button className="primary" disabled={!q.trim()} title="Plays the top hit on YouTube for everyone in voice"><Icon name="search" size={12} /></button>
      </form>
    </div>
  );
});
