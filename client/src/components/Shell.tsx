import React, { memo, Suspense, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { native } from '../native';
import { canShareScreen } from '../device';
import type { Source } from '../native';
import { api } from '../api';
import { ask, GAME_NAMES, openDm, openText, send, setPrefs, toast, useStore } from '../store';
import type { Me, Place, User } from '../types';
import { applyVolumes, joinVoice, leaveVoice, setMuted, startAudio, startShare, stopShare, toggleDeafen } from '../voice';
import { CLUB } from '../clubhouse.gen';
import { Chat } from './Chat';
import { AT_COMPUTER, Hangout, PLACES } from './Clubhouse';
import { MusicBox, Theatre } from './Music';
import { Stage } from './Hangout';
import { SoundDock } from './Panels';
import { later } from '../later';
import '../devices';      // (the headset switch-over: it listens from the start, not only once Settings has been opened)

// Each in a chunk of its own, fetched when first opened or once the page has settled (client/src/later.ts)
const Board = later(() => import('./Board').then((m) => m.Board));
const Games = later(() => import('./Games').then((m) => m.Games));
const Arcade = later(() => import('./Arcade').then((m) => m.Arcade));
const Settings = later(() => import('./Settings').then((m) => m.Settings));
import { Avatar, Icon, Modal, presenceText, SureButton } from './ui';
import { yardKey } from '../basement/yard';
import { askableGame, askedAt, askToShare } from '../askshare';
import { FxBadge, VoiceFxButton } from './VoiceFx';

function ScreenPicker({ onClose }: { onClose: () => void }) {
  const [sources, setSources] = useState<Source[] | null>(null);
  const sound = useStore((s) => s.prefs.shareAppSound);
  useEffect(() => { native!.getSources().then(setSources).catch(() => setSources([])); }, []);
  const group = (kind: Source['kind'], title: string) => {
    const list = (sources ?? []).filter((s) => s.kind === kind);
    return list.length > 0 && (
      <>
        <h3>{title} <small>{kind === 'screen' ? 'shared without sound' : native?.startShareSound && sound ? 'shared with the sound of that program only' : 'shared without sound'}</small></h3>
        <div className="source-grid">
          {list.map((s) => (
            <button key={s.id} onClick={() => { onClose(); void startShare(s.id, s.name); }}>
              <img src={s.thumb} alt="" /><span>{s.name}</span>
            </button>
          ))}
        </div>
      </>
    );
  };
  return (
    <Modal title="Share your screen" onClose={onClose} wide>
      <div className="modal-body">
        {!sources && <p>Looking for windows…</p>}
        {group('screen', 'Screens')}
        {group('window', 'Windows')}
      </div>
    </Modal>
  );
}

/** On a friend's row: ask them to share the game their PC says they are playing. Only while they are in my voice chat
 *  and not sharing yet (client/src/askshare.ts); once asked, it stays pressed for ten minutes. */
function AskShareButton({ user }: { user: User }) {
  const [, bump] = useState(0);
  const game = askableGame(user.id);
  useEffect(() => { const t = window.setInterval(() => bump((n) => n + 1), 30_000); return () => window.clearInterval(t); }, []);
  if (!game) return null;
  const at = askedAt(user.id);
  return (
    <button className={`ask-share${at ? ' on' : ''}`} disabled={!!at} onClick={() => { askToShare(user.id); bump((n) => n + 1); }}
      title={at ? `You asked ${user.name} to share at ${new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : `Ask ${user.name} to share ${game}`}>
      <Icon name="eye" size={12} />
    </button>
  );
}

/** Whether version a ("0.1.1") is later than b. */
const newer = (a: string, b: string) => {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number));
  if (x.length < 3 || x.some(Number.isNaN) || y.some(Number.isNaN)) return false;
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
};

/** While you watch shared screens, the room shrinks to a small live view: on top of the chat column if chat is open,
 *  otherwise in the left panel between the lists and the player. Click it to go back to the room. */
const SideRoom = memo(function SideRoom() {
  return <div className="side-room" title="Back to the room" onClick={() => useStore.setState({ view: { kind: 'hangout' } })}><Hangout mini /></div>;
});

/** How much larger the side panels are drawn for this window: 1 for an ordinary one, up to 2 on a big screen.
 *  With only the left panel showing the window is narrow on purpose, so its height decides. */
function bigFor(solo: boolean) {
  const s = Math.min(window.innerHeight / 850, window.innerWidth / (solo ? 300 : 1400));
  const auto = Math.max(1, Math.min(2, Math.round(s * 20) / 20));
  return Math.round(auto * (useStore.getState().prefs.textSize || 1) * 20) / 20;       // times the person's own text size
}

/** An installed app older than the server's installer: say so, and let it replace itself. Apps from before 0.1.3 cannot
 *  do that, so they get the download instead. */
function UpdateBar({ version }: { version: string }) {
  const [state, setState] = useState('idle');
  const [part, setPart] = useState(0);
  const inVoice = useStore((s) => s.voice.channelId != null);
  useEffect(() => { native?.onUpdate?.((p) => { setState(p.state); setPart(p.part); }); }, []);
  if (!native) return null;
  if (!native.installUpdate) return <a className="update" href="/download/desktop" target="_blank" rel="noreferrer">A newer Chatterday app is ready (yours is {native.version}). Get it</a>;
  const go = async () => {
    setState('downloading');
    setPart(0);
    const r = await native!.installUpdate!();
    if (r.error) { setState('idle'); toast(r.error); } else if (r.dry) setState('tested');
  };
  return (
    <div className="update">
      {state === 'idle' && (
        <>
          <span>Chatterday {version} is ready (yours is {native.version}).</span>
          <button onClick={() => void go()} title={inVoice ? 'The app closes for a moment and comes back, so you will drop out of voice' : 'The app closes for a moment and comes back by itself'}>Install</button>
        </>
      )}
      {state === 'downloading' && <><span>Getting Chatterday {version}: {Math.round(part * 100)}%</span><i style={{ width: `${part * 100}%` }} /></>}
      {state === 'installing' && <span>Installing. The app will close and come back by itself.</span>}
      {state === 'tested' && <span>Fetched and checked (test run: nothing was installed).</span>}
    </div>
  );
}

/** "3h ago", "12m ago", "just now". */
function ago(ts: number) {
  const m = Math.floor((Date.now() - ts) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (m < 48 * 60) return `${Math.floor(m / 60)}h ago`;
  return `${Math.floor(m / 1440)}d ago`;
}

/** Where are you? One button that shows where you are, and opens upwards into the list of places. Your character goes
 *  there and stays until you pick it again, and then the button says "At Computer". (Places in the room itself can be clicked too.) */
const Where = memo(function Where() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const place = useStore((s) => ((s.me && s.presence[s.me.id]?.place) || '') as Place);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', away);      // (pointerdown: Safari on an iPad sends no mousedown for a tap on nothing in particular)
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  const cur = PLACES.find(([id]) => id === place) ?? AT_COMPUTER;
  return (
    <div className="where" ref={box}>
      {open && (
        <div className="where-list" role="menu">
          {PLACES.map(([id, icon, label]) => (
            <button key={id} className={place === id ? 'active' : ''} onClick={() => { send({ t: 'place', place: place === id ? '' : id }); setOpen(false); }}><Icon name={icon} /> {label}</button>
          ))}
        </div>
      )}
      <button className={`where-now${open ? ' open' : ''}`} onClick={() => setOpen(!open)}
        title="Your character goes there and stays until you pick it again. You can also click a place in the room: the sofa, the theatre, a desk, the shower.">
        <small>Where are you?</small><span><Icon name={cur[1]} /> {cur[2]}</span><Icon name={open ? 'down' : 'up'} size={12} />
      </button>
    </div>
  );
});

const Sidebar = memo(function Sidebar() {
  // Only what the panel shows is listened to. (It used to listen to everything, so it, the Player and the small view of
  // the room were all drawn again for every chat message, typing notice, toast and soundboard press.)
  const s = {
    me: useStore((st) => st.me), users: useStore((st) => st.users), presence: useStore((st) => st.presence), channels: useStore((st) => st.channels),
    voice: useStore((st) => st.voice), unread: useStore((st) => st.unread), counts: useStore((st) => st.counts), dms: useStore((st) => st.dms),
    chat: useStore((st) => st.chat), view: { kind: useStore((st) => st.view.kind) },
    prefs: { roomOpen: useStore((st) => st.prefs.roomOpen), userVol: useStore((st) => st.prefs.userVol), mediaVol: useStore((st) => st.prefs.mediaVol) },
    settings: { voice: useStore((st) => st.settings.voice), appVersion: useStore((st) => st.settings.appVersion) },
  };
  // What is on the game table, in a word or two (only that: the table itself changes with every card played).
  const gameNow = useStore((st) => { const t = st.table; return !t?.kind ? '' : t.phase === 'playing' && t.you >= 0 && t.turn.includes(t.you) ? 'Your turn' : GAME_NAMES[t.kind]; });
  useStore(yardKey);                  // (mowing, smoking: said in the backyard's statuses, not in anybody's presence)
  const [, beat] = useState(0);       // "Offline · 3h ago" is brought up to date once a minute
  useEffect(() => { const t = window.setInterval(() => beat((n) => n + 1), 60_000); return () => window.clearInterval(t); }, []);
  const me = s.me!;
  const admin = me.role === 'admin';
  const textCh = s.channels.find((c) => c.kind === 'text');
  const [voiceCh, sideCh] = s.channels.filter((c) => c.kind === 'voice');      // the voice chat, and the Game Table (the second one)
  const v = s.voice;
  const inVoice = v.channelId != null;
  const roomOpen = s.prefs.roomOpen;
  // a ring round anyone who is talking, yourself included, so you can tell your own mic is getting through
  const talking = (id: string) => inVoice && s.presence[id]?.voice?.channelId === v.channelId && !!v.speaking[id] && !(id === me.id && v.muted);
  const unread = textCh ? s.unread[textCh.id] ?? 0 : 0;

  const [open, setOpen] = useState<string | null>(null);
  const [tidy, setTidy] = useState<string | null>(null);      // (the admin: the person whose status is being tidied up)
  const people = Object.values(s.users).filter((u) => u.role !== 'removed').sort((a, b) => a.name.localeCompare(b.name));
  const chatting = (u: User) => !!s.presence[u.id]?.voice && s.presence[u.id].state !== 'offline';
  const inSide = (u: User) => chatting(u) && sideCh != null && s.presence[u.id].voice!.channelId === sideCh.id;
  const inSideRoom = sideCh != null && v.channelId === sideCh.id;
  const watchers = v.sharing ? people.filter((u) => u.id !== me.id && chatting(u) && s.presence[u.id].voice!.watching?.includes(me.id)).map((u) => u.name) : [];
  const slider = (label: string, key: 'userVol' | 'mediaVol', id: string, fallback: number) => (
    <label className="vol">{label}
      <input type="range" min={0} max={1} step={0.05} value={s.prefs[key][id] ?? fallback}
        onChange={(e) => { setPrefs({ [key]: { ...s.prefs[key], [id]: Number(e.target.value) } }); applyVolumes(); }} />
    </label>
  );
  /** What an unread badge says: how many, or "new" until the number is known. */
  const waiting = (channelId?: number) => { const n = channelId == null ? 0 : s.counts[channelId] ?? 0; return n > 99 ? '99+' : n || 'new'; };
  const unreadDm = (userId: string) => { const dm = s.dms.find((x) => x.with === userId); return dm ? s.unread[dm.id] ?? 0 : 0; };
  const member = (u: User) => {
    const p = s.presence[u.id];
    const offline = !p || p.state === 'offline';
    const together = inVoice && p?.voice?.channelId === v.channelId && u.id !== me.id;
    return (
      <div key={u.id} className={`voice-member${chatting(u) ? '' : offline ? ' out asleep' : ' out'}`}>
        <button className="member-row" disabled={!together} onClick={() => setOpen(open === u.id ? null : u.id)} title={`${u.name} — ${presenceText(p)}${u.status && !offline ? ` — ${u.status}` : ''}`}>
          <Avatar user={u} size={40} speaking={talking(u.id)} />
          <span><b>{u.name}{chatting(u) && <FxBadge userId={u.id} me={u.id === me.id} />}{chatting(u) && p?.voice?.deafened ? <i className="quiet" title="Deafened: cannot hear or be heard"><Icon name="micoff" size={12} /><Icon name="phonesoff" size={12} /></i> : chatting(u) && p?.voice?.muted ? <i className="quiet" title="Muted"><Icon name="micoff" size={12} /></i> : null}{unreadDm(u.id) > 0 && <em className="dm-new" title="Unread private messages"><Icon name="mail" size={14} />{waiting(s.dms.find((x) => x.with === u.id)?.id)}</em>}</b><small>{offline && u.seenAt ? `Offline · ${ago(u.seenAt)}` : presenceText(p)}</small>{u.status && !offline && <small className="status">{u.status}</small>}</span>
          {p?.voice?.sharing && <Icon name="screen" />}
        </button>
        {u.id !== me.id && (
          <span className="member-tools">
            <button className={s.chat != null && s.dms.some((x) => x.id === s.chat && x.with === u.id) ? 'on' : unreadDm(u.id) > 0 ? 'waiting' : ''} title={unreadDm(u.id) > 0 ? `${u.name} sent you a private message` : `Message ${u.name} privately`} onClick={() => void openDm(u.id)}><Icon name="mail" size={12} /></button>
            {!offline && <button title={`Wave ${u.name} over`} onClick={() => { send({ t: 'wave', userId: u.id }); toast(`You waved at ${u.name}.`); }}><Icon name="wave" size={12} /></button>}
            {/* ask them to share the game their PC says they are playing (in my voice chat, not sharing yet): askshare.ts */}
            <AskShareButton user={u} />
            {/* the admin only: out of the voice chat (left there AFK, say). Two clicks, so a slip does not do it. */}
            {me.role === 'admin' && (
              <button className={tidy === u.id ? 'on' : ''} title={`Tidy up ${u.name}'s status (gone, but still showing as here?)`} onClick={() => setTidy(tidy === u.id ? null : u.id)}><Icon name="pencil" size={12} /></button>
            )}
            {me.role === 'admin' && chatting(u) && (
              <SureButton className="kick" ask="Kick?" title={`Take ${u.name} out of the voice chat`}
                onSure={() => void api('/admin/kick-voice', { userId: u.id }).then(() => toast(`${u.name} is out of the voice chat.`)).catch((e) => toast(e.message))}><Icon name="close" size={12} /></SureButton>
            )}
          </span>
        )}
        {tidy === u.id && me.role === 'admin' && (
          <div className="tidy-status">
            {([['', 'Clear'], ['away', 'Away'], ['sleeping', 'To bed']] as [string, string][]).map(([place, label]) => (
              <button key={place || 'clear'} title={place ? `Set ${u.name} to ${label.toLowerCase()}` : `Take away what ${u.name} had chosen (back to what their PC says)`}
                onClick={() => void api('/admin/set-status', { userId: u.id, place }).then(() => { toast(`${u.name}: ${place ? label.toLowerCase() : 'cleared'}.`); setTidy(null); }).catch((e) => toast(e.message))}>{label}</button>
            ))}
            {u.status && <button title={`Wipe "${u.status}"`} onClick={() => void api('/admin/set-status', { userId: u.id, clearText: true }).then(() => { toast(`${u.name}'s status line is wiped.`); setTidy(null); }).catch((e) => toast(e.message))}>Wipe words</button>}
          </div>
        )}
        {open === u.id && together && (
          <div className="person-vols">
            {slider('Voice', 'userVol', u.id, 1)}
            {p?.voice?.sharing && slider("Their stream's sound", 'mediaVol', u.id, 0.7)}
          </div>
        )}
      </div>
    );
  };
  const editStatus = async () => {
    const v = await ask('Your status', me.status, true);
    if (v === null) return;
    try { const r = await api<{ me: Me }>('/profile', { status: v }); useStore.setState({ me: r.me }); } catch (e: any) { toast(e.message); }
  };
  const share = () => {
    if (v.sharing) return void stopShare();
    if (native) useStore.setState({ picker: true }); else void startShare();
  };

  return (
    <nav className="sidebar">
      <div className="channels">
        <button className={`chan${roomOpen ? ' active' : ''}`} onClick={() => setPrefs({ roomOpen: !roomOpen })} title={s.view.kind !== 'hangout' ? (roomOpen ? 'Hide the small view of the room' : 'Show the small view of the room') : roomOpen ? 'Hide the room, where-are-you and the soundboard' : 'Show the room'}>
          <span className="glyph"><Icon name="home" /></span>Hangout
        </button>
        {textCh && (
          <button className={`chan${s.chat === textCh.id ? ' active' : ''}`} onClick={() => void openText(textCh.id)} title={s.chat === textCh.id ? 'Close the chat' : 'Open the chat'}>
            <span className="glyph">#</span>Text Chat{unread > 0 && <em title={unread === 2 ? 'Unread, and you were mentioned' : 'Unread messages'}>{unread === 2 ? '@ ' : ''}{waiting(textCh.id)}</em>}
          </button>
        )}
        <div className="chan-pair">
          {voiceCh && (
            <button className={`chan${v.channelId === voiceCh.id ? ' active' : ''}`} disabled={!s.settings.voice || v.connecting} onClick={() => { if (v.channelId !== voiceCh.id) void joinVoice(voiceCh.id); }}
              title={!s.settings.voice ? 'Voice is not running on the server' : v.channelId === voiceCh.id ? 'You are in the voice chat' : inVoice ? 'Move over to the voice chat' : 'Join the voice chat'}>
              <span className="glyph"><Icon name="speaker" /></span><span>Voice<span className="rest"> Chat</span></span>
            </button>
          )}
          {sideCh && (
            <button className={`chan${v.channelId === sideCh.id ? ' active' : ''}`} disabled={!s.settings.voice || v.connecting} onClick={() => { if (v.channelId !== sideCh.id) void joinVoice(sideCh.id); }}
              title={!s.settings.voice ? 'Voice is not running on the server' : v.channelId === sideCh.id ? 'You are in the Game Table voice chat' : 'A second voice chat, at the table: for whoever is playing a game, or off doing something else'}>
              <span className="glyph"><Icon name="speaker" /></span><span>Game<span className="rest"> Table</span></span>
            </button>
          )}
        </div>
        <button className={`chan${s.view.kind === 'games' ? ' active' : ''}`} onClick={() => useStore.setState({ view: { kind: s.view.kind === 'games' ? 'hangout' : 'games' } })}
          title={s.view.kind === 'games' ? 'Back to the room' : 'Cards, mahjong and board games at the game table. Anybody can play or watch.'}>
          <span className="glyph"><Icon name="gamepad" /></span>Play Games{gameNow && <em title="What is on the game table">{gameNow}</em>}
        </button>
        {v.screens.length > 0 && (
          <button className={`chan${s.view.kind === 'stage' ? ' active' : ''}`} onClick={() => useStore.setState({ view: { kind: s.view.kind === 'stage' ? 'hangout' : 'stage' } })}>
            <span className="glyph"><Icon name="screen" /></span>Screens<em>{v.screens.length}</em>
          </button>
        )}
        <h3>In Chat</h3>
        {people.filter((u) => chatting(u) && !inSide(u)).map(member)}
        {!people.some((u) => chatting(u) && !inSide(u)) && <p className="empty">Nobody yet.</p>}
        {people.some(inSide) && <h3>Game Table</h3>}
        {people.filter(inSide).map(member)}
        <h3>Not in Chat</h3>
        {people.filter((u) => !chatting(u)).map(member)}
      </div>
      <Where />

      {s.view.kind !== 'hangout' && roomOpen && s.chat == null && <SideRoom />}
      {inVoice && !inSideRoom && <MusicBox />}
      {(inVoice || v.connecting) && (
        <div className="voicebar">
          <div className="voicebar-title">
            <span className={v.connecting ? 'pulse' : 'live'} />
            <b>{v.connecting ? 'Connecting…' : inSideRoom ? 'At the Game Table' : 'In voice chat'}</b>
            <button className="hangup" title="Leave the voice chat" onClick={() => void leaveVoice()}><Icon name="hangup" />Leave</button>
          </div>
          {v.audioBlocked && <button className="primary" onClick={() => void startAudio()}>Tap to hear everyone</button>}
          {v.micError && <small className="error">{v.micError}</small>}
          {v.talkingMuted && <small className="muted-note">You are talking, but your mic is muted.</small>}
          {v.sharing && <small className="watchers" title="Who has your screen open"><Icon name="eye" size={12} /> {watchers.length ? `${watchers.join(', ')} watching` : 'Nobody is watching yet'}</small>}
          <div className="voicebar-buttons">
            <button className={`${v.muted ? 'on' : ''}${v.gated && !v.muted ? ' gated' : ''}${v.talkingMuted ? ' nudge' : ''}`} title={v.muted ? 'Unmute' : v.gated ? 'Mute (the noise gate is holding your mic shut: you are below your line)' : 'Mute'} onClick={() => void setMuted(!v.muted)}><Icon name={v.muted ? 'micoff' : 'mic'} /></button>
            <button className={v.deafened ? 'on' : ''} title={v.deafened ? 'Undeafen' : 'Deafen'} onClick={() => void toggleDeafen()}><Icon name={v.deafened ? 'phonesoff' : 'phones'} /></button>
            {/* (not where the browser cannot share a screen at all: an iPad) */}
            {(v.sharing || canShareScreen()) && <button className={v.sharing ? 'on' : ''} title={v.sharing ? 'Stop sharing' : 'Share your screen'} onClick={share}><Icon name="screen" /></button>}
            {inVoice && <VoiceFxButton />}
          </div>
        </div>
      )}
      {native && newer(s.settings.appVersion ?? '', native.version) && <UpdateBar version={s.settings.appVersion ?? ''} />}
      <div className="mebar">
        <Avatar user={me} size={40} speaking={talking(me.id)} />
        <span><b>{me.name}</b><button className="status-btn" title="Set your status: it shows under your name and over your character" onClick={() => void editStatus()}>{me.status || (me.invisible ? 'Invisible' : 'Set a status')}</button></span>
        <button className="icon" title="Settings" onClick={() => useStore.setState({ settingsOpen: 'character' })}><Icon name="gear" /></button>
      </div>
    </nav>
  );
});

/** A bar between two panels that can be dragged sideways. `flip` is for a panel on the right. */
function Splitter({ value, min, max, flip = false, scale = 1, onChange }: { value: number; min: number; max: number; flip?: boolean; scale?: number; onChange: (v: number) => void }) {
  const start = (e: React.PointerEvent) => {
    const x0 = e.clientX;
    const move = (ev: PointerEvent) => onChange(Math.round(Math.min(max, Math.max(min, value + (flip ? x0 - ev.clientX : ev.clientX - x0) / scale))));
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      document.body.classList.remove('dragging');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    document.body.classList.add('dragging');
    e.preventDefault();
  };
  return <div className="splitter" onPointerDown={start} title="Drag to resize" />;
}

// How narrow and how wide the two side panels may be (before the big-screen scale): by dragging, or by the full-screen fit.
const LEFT_W = [220, 560], CHAT_W = [300, 960];
/** How big the strips under the room are drawn, from how wide the middle of the window is (the `--ui` they are sized by). */
const uiFor = (width: number) => String(Math.max(1, Math.min(2, Math.round((width / 1050) * 20) / 20)));
/** A window a good deal taller than it is wide: a monitor turned on its side. */
const isPortrait = () => window.innerHeight > window.innerWidth * 1.15;
const within = (v: number, [min, max]: number[]) => Math.round(Math.min(max, Math.max(min, v)));
/** Shares `total` between the left panel and the chat in the proportion the person keeps them at, each within its limits. */
function shareSides(total: number, left0: number, chat0: number) {
  const t = Math.min(LEFT_W[1] + CHAT_W[1], Math.max(LEFT_W[0] + CHAT_W[0], total));
  const chat = within(t - within((t * left0) / (left0 + chat0), LEFT_W), CHAT_W);
  return { left: within(t - chat, LEFT_W), chat };
}

/** The whole app over the whole monitor, no taskbar: F11 or the button in the title bar; the same again (or Esc) comes back. */
export function toggleAppFull() {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  else void document.documentElement.requestFullscreen().catch(() => toast('Could not go full screen.'));
}

/** The desktop app has no Windows frame: this bar is the handle to drag it by, with its own buttons. */
function TitleBar({ down }: { down: boolean }) {
  const ask = (what: 'minimize' | 'maximize' | 'close') => () => native?.windowControl?.(what);
  return (
    <header className={`titlebar${down ? ' down' : ''}`}>
      <b>Chatterday</b>
      <span className="grow" />
      <button title="Full screen (F11)" onClick={toggleAppFull}><Icon name="full" size={12} /></button>
      <button title="Minimise" onClick={ask('minimize')}><Icon name="min" size={12} /></button>
      <button title="Full size" onClick={ask('maximize')}><Icon name="max" size={12} /></button>
      <button title="Close" className="shut" onClick={ask('close')}><Icon name="close" size={12} /></button>
    </header>
  );
}

function AskModal() {
  const asking = useStore((s) => s.asking)!;
  const [value, setValue] = useState(asking.value);
  const done = (v: string | null) => { useStore.setState({ asking: null }); asking.resolve(v); };
  return (
    <Modal title={asking.title} onClose={() => done(null)}>
      <div className="modal-body ask">
        <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') done(value); }} />
        <div className="row"><button className="primary" onClick={() => done(value)}>OK</button>{asking.clear && <button onClick={() => done('')}>Clear</button>}<button onClick={() => done(null)}>Cancel</button></div>
      </div>
    </Modal>
  );
}

export function Shell() {
  const view = useStore((s) => s.view);
  const chat = useStore((s) => s.chat);
  const connected = useStore((s) => s.connected);
  const settingsOpen = useStore((s) => s.settingsOpen);
  const picker = useStore((s) => s.picker);
  const toastText = useStore((s) => s.toast);
  const notice = useStore((s) => s.notice);
  const asking = useStore((s) => s.asking);
  const framed = !!native?.windowControl;
  const ownLeftW = useStore((s) => s.prefs.leftW);
  const ownChatW = useStore((s) => s.prefs.chatW);
  const roomOpen = useStore((s) => s.prefs.roomOpen);

  // Full screen is laid out for the room. Hangout and the chat are opened, and the two side panels are made just wide
  // enough between them that the middle is the room's own shape: the room is then as large as the monitor allows, with
  // as little lawn round it as can be. (When even the narrowest panels leave the middle too narrow for that, they
  // stay at their narrowest.) These widths last only while the app is full screen; the person's own are kept for the
  // window, and dragging a bar meanwhile changes only these. Once a bar HAS been dragged in full screen, the widths
  // are the person's to keep: the fit stands back (`byHand`) and nothing moves them again until full screen is left
  // and entered afresh. Watching a stream or sitting at the game table is left alone.
  // What that comes to depends on the monitor. A very wide one has room to spare, and the panels take it. An ordinary
  // one has none: both panels go to their narrowest. One turned on its side is laid out differently altogether
  // (`tall`): the room across the top at its own shape, the left panel and the chat sharing what is under it.
  const [full, setFull] = useState(() => document.fullscreenElement === document.documentElement);
  const [fullFit, setFullFit] = useState<{ left: number; chat: number } | null>(null);
  const leftW = fullFit?.left ?? ownLeftW, chatW = fullFit?.chat ?? ownChatW;
  const inRoom = view.kind === 'hangout';
  const [portrait, setPortrait] = useState(isPortrait);
  const tall = full && inRoom && roomOpen && portrait;
  useEffect(() => {
    const changed = () => setFull(document.fullscreenElement === document.documentElement);
    const sized = () => setPortrait(isPortrait());
    document.addEventListener('fullscreenchange', changed);
    window.addEventListener('resize', sized);
    return () => { document.removeEventListener('fullscreenchange', changed); window.removeEventListener('resize', sized); };
  }, []);
  // The soundboard is folded away too, every time: the room gets its height. (It comes back afterwards if it was open,
  // and can be opened meanwhile: the fit follows.)
  const wasFull = useRef(full);
  const fitNow = useRef(fullFit);
  fitNow.current = fullFit;
  const dockWas = useRef(false);
  const byHand = useRef(false);                 // a bar was dragged while full screen: the fit leaves the panels alone
  useEffect(() => {
    const entered = full && !wasFull.current, exited = !full && wasFull.current;
    if (entered || !full) byHand.current = false;
    wasFull.current = full;
    const st = useStore.getState();
    if (entered) {
      dockWas.current = st.prefs.dockOpen;
      if (st.prefs.dockOpen) setPrefs({ dockOpen: false });
    }
    if (exited && dockWas.current) setPrefs({ dockOpen: true });
    if (!full) return setFullFit(null);
    if (!inRoom) return;
    if (entered) {
      if (!st.prefs.roomOpen) setPrefs({ roomOpen: true });
      const text = st.channels.find((c) => c.kind === 'text');
      if (st.chat == null && text) void openText(text.id, true);
    }
    if (portrait) return setFullFit(fitNow.current ?? { left: st.prefs.leftW, chat: st.prefs.chatW });        // stacked: nothing to work out, the room is as wide as the window
    // The fit follows the room's size for as long as the app is full screen, not just once on the way in. The page
    // is told it is full screen a moment BEFORE the window has grown to the monitor: measured once, there and then,
    // the panels were sometimes fitted to the window as it had been, and stayed that way. Whatever changes the room's
    // space afterwards (the window, the chat opening, the soundboard) is followed too.
    let frame = 0, tries = 0, moves = 0, since = 0, busy = false;
    /** The widths the panels should have, from the room as it is on the page this instant; null if they are right. */
    const step = () => {
      const el = document.querySelector<HTMLElement>('.main-view .club-wrap');
      if (!el || !el.clientHeight) return null;
      // How much wider the middle is than the room would be at this height (or, below zero, how much narrower).
      const big = bigFor(false), sparePx = el.clientWidth - Math.ceil((el.clientHeight * CLUB.w) / CLUB.h);
      if (Math.abs(sparePx) < big + 1.5) return null;   // as near as whole steps of the panels can get: let it be (or it goes back and forth for ever)
      const own = useStore.getState().prefs, chatOpen = useStore.getState().chat != null;
      const now = fitNow.current ?? { left: own.leftW, chat: own.chatW };
      const next = chatOpen ? shareSides(now.left + now.chat + sparePx / big, own.leftW, own.chatW) : { left: within(now.left + sparePx / big, LEFT_W), chat: now.chat };
      return next.left === now.left && next.chat === now.chat ? null : next;
    };
    // Each step is put on the page at once (flushSync), and the next is worked out from the page as it then is, all
    // before the screen is drawn again. It used to ask for a step and carry on: called again before that step had
    // been drawn (the room's size changes twice in a frame when the strips under it resize as well), it measured the
    // old layout against the new widths and took the same step twice, overshot, and then swung back and forth between
    // two layouts some twenty times: the second of stutter on bringing the chat back in full screen. Now what is
    // measured and what is being changed are always the same thing, and it settles within the frame.
    const fit = () => {
      if (byHand.current || busy) return;         // the person has set the panels themselves (or this is its own doing)
      busy = true;
      try {
        for (let k = 0; k < 8; k++) {
          const r = row.current;
          if (r) r.style.setProperty('--ui', uiFor(r.clientWidth));      // (the strips under the room, kept in step: their height is part of what the room has)
          const next = step();
          if (!next) break;
          // (should it ever fail to settle all the same, it stops)
          const t = performance.now();
          if (t - since > 1500) { since = t; moves = 0; }
          if (++moves > 40) break;
          flushSync(() => setFullFit(next));
        }
      } finally { busy = false; }
    };
    // (it also calls once at the start, and again after each change the fit itself makes. One more look when things
    // have gone quiet, in case a change was missed.)
    let again = 0;
    const watch = new ResizeObserver(() => { fit(); window.clearTimeout(again); again = window.setTimeout(fit, 300); });
    const find = () => {
      const el = document.querySelector<HTMLElement>('.main-view .club-wrap');
      if (el) return watch.observe(el);
      if (++tries < 240) frame = requestAnimationFrame(find);       // the room is not on the page yet
    };
    find();
    return () => { cancelAnimationFrame(frame); window.clearTimeout(again); watch.disconnect(); };
  }, [full, inRoom, portrait, roomOpen]);

  // Full screen puts the title bar away at once, wherever the mouse is (it is on the bar's own button when that is
  // what was clicked). It comes down when the mouse goes to the top edge after having been away from it, and goes
  // back up when the mouse leaves it. Not while a mouse button is held, though: dragging a bar between the panels up
  // to the top of the screen is not asking for the title bar.
  const [barDown, setBarDown] = useState(false);
  useEffect(() => {
    if (!full || !framed) return;
    let away = false;
    const move = (e: MouseEvent) => {
      if (e.clientY > 40) { away = true; setBarDown(false); }
      else if (away && e.clientY <= 3 && !e.buttons && !document.body.classList.contains('dragging')) setBarDown(true);
    };
    const gone = () => { away = true; setBarDown(false); };
    window.addEventListener('mousemove', move);
    document.documentElement.addEventListener('mouseleave', gone);
    return () => { window.removeEventListener('mousemove', move); document.documentElement.removeEventListener('mouseleave', gone); setBarDown(false); };
  }, [full, framed]);
  // While shared screens are being watched the middle stays open whatever Hangout says: turning Hangout off then
  // only puts away the small view of the room.
  const showMain = roomOpen || view.kind !== 'hangout';
  const solo = !showMain && chat == null;       // nothing but the left panel

  // On a big screen the left panel and the chat (text, pictures, everything in them) are shown larger. How much
  // follows the size of the window; an ordinary window is 1.
  const textSize = useStore((s) => s.prefs.textSize);
  const [big, setBig] = useState(() => bigFor(solo));
  useEffect(() => {
    const fit = () => setBig(bigFor(solo));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [solo, textSize]);

  // The strips under the room grow with it: their size follows how wide the middle of the window is.
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    const fit = () => el.style.setProperty('--ui', uiFor(el.clientWidth));
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();
    return () => ro.disconnect();
  }, [showMain]);
  useEffect(() => {
    if (!native) return;                              // a browser has its own F11
    // Esc leaves full screen too, whatever the window does with it by itself; not while a box is open, where Esc only
    // closes the box (each box listens for it on its own).
    const key = (e: KeyboardEvent) => {
      if (e.key === 'F11') { e.preventDefault(); toggleAppFull(); }
      else if (e.key === 'Escape' && document.fullscreenElement === document.documentElement && !document.querySelector('.scrim')) { void document.exitFullscreen().catch(() => {}); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  // With only the left panel showing, the desktop app's window can be as narrow as that panel.
  // It can then be dragged narrower or wider, and comes back to that width next time.
  useEffect(() => {
    native?.windowControl?.(solo ? `compact:${useStore.getState().prefs.soloW || Math.round(leftW * bigFor(true))}` : 'expand');
    if (!solo || !native?.windowControl) return;
    let save = 0;
    const onResize = () => {
      window.clearTimeout(save);
      save = window.setTimeout(() => { if (window.innerWidth <= 700) setPrefs({ soloW: window.innerWidth }); }, 400);
    };
    const arm = window.setTimeout(() => window.addEventListener('resize', onResize), 700);      // after the window has finished narrowing
    return () => { window.clearTimeout(arm); window.clearTimeout(save); window.removeEventListener('resize', onResize); };
  }, [solo]);   // eslint-disable-line react-hooks/exhaustive-deps

  // The room is always there, with the soundboard under it. Chat opens beside both, full height; watching a
  // screen moves the room into the corner. The bars between the panels can be dragged.
  return (
    <div className={`shell${framed ? ' framed' : ''}${solo ? ' solo' : ''}${tall ? (chat == null ? ' tall nochat' : ' tall') : ''}`} style={{ '--left': `${Math.round(leftW * big)}px`, '--big': big } as React.CSSProperties}>
      {framed && <TitleBar down={barDown} />}
      <Sidebar />
      {!solo && <Splitter value={leftW} min={LEFT_W[0]} max={LEFT_W[1]} scale={big} onChange={(w) => { if (!fullFit) return setPrefs({ leftW: w }); byHand.current = true; setFullFit({ ...fullFit, left: w }); }} />}
      {!solo && <main>
        {showMain && <div className="main-row" ref={row}>
          <div className="main-view">
            <Suspense fallback={null}>
              {view.kind === 'stage' ? <Stage /> : view.kind === 'theatre' ? <Theatre /> : view.kind === 'board' ? <Board /> : view.kind === 'games' ? <Games /> : view.kind === 'arcade' ? <Arcade /> : <Hangout />}
            </Suspense>
          </div>
          <SoundDock />
        </div>}
        {chat != null && (
          <>
            {showMain && !tall && <Splitter value={chatW} min={CHAT_W[0]} max={CHAT_W[1]} flip scale={big} onChange={(w) => { if (!fullFit) return setPrefs({ chatW: w }); byHand.current = true; setFullFit({ ...fullFit, chat: w }); }} />}
            <div className={`chat-col${showMain ? '' : ' wide'}`} style={showMain && !tall ? { width: Math.round(chatW * big) } : undefined}>
              {view.kind !== 'hangout' && roomOpen && <SideRoom />}
              <Chat key={chat} channelId={chat} />
            </div>
          </>
        )}
      </main>}
      {!connected && <div className="banner">Lost the connection to the server. Trying again…</div>}
      {settingsOpen && <Suspense fallback={null}><Settings /></Suspense>}
      {picker && <ScreenPicker onClose={() => useStore.setState({ picker: false })} />}
      {asking && <AskModal />}
      {notice && (
        <div className="notice" role="status">
          <span>{notice.text}</span>
          <button className="primary" onClick={notice.run}>{notice.label}</button>
          {notice.no ? <button onClick={notice.no.run}>{notice.no.label}</button>
            : <button className="icon" title="Not now" onClick={() => useStore.setState({ notice: null })}><Icon name="close" size={12} /></button>}
        </div>
      )}
      {toastText && <div className="toast" role="status">{toastText}</div>}
    </div>
  );
}
