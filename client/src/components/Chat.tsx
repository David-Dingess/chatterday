import { personColor } from '../sprites';
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api, upload } from '../api';
import { jumpTo, loadMessages, markRead, mentionsMe, openText, send, sendMessage, SPOILER, toast, useStore, veiled } from '../store';
import { applyTheme, sanitizeTheme } from '../theme';
import type { Attachment, Message, User } from '../types';
import { ICON_NAMES } from '../icons.gen';
import { Avatar, fmtDay, fmtSize, fmtTime, Icon, SureButton } from './ui';
import type { IconName } from './ui';

// ───────── text → rich nodes ─────────

const IMG = /\.(png|jpe?g|gif|webp|avif)(\?[^\s]*)?$/i;
const VID = /\.(mp4|webm)(\?[^\s]*)?$/i;
const YT = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/;
const GIPHY = /giphy\.com\/gifs\/(?:[\w-]*-)?([A-Za-z0-9]+)(?:[/?#].*)?$/;
const URL_RE = /https?:\/\/[^\s<>"']+/g;
const cleanUrl = (u: string) => u.replace(/[.,!?)\]]+$/, '');

type Embed = { type: 'img' | 'video' | 'yt'; url: string; id?: string };
function embedFor(url: string): Embed | null {
  if (!url.startsWith('https://')) return null;
  const yt = YT.exec(url);
  if (yt) return { type: 'yt', url, id: yt[1] };
  const g = GIPHY.exec(url);
  if (g) return { type: 'img', url: `https://i.giphy.com/${g[1]}.gif` };
  const path = url.split('#')[0];
  if (IMG.test(path)) return { type: 'img', url };
  if (VID.test(path)) return { type: 'video', url };
  return null;
}

function rich(text: string, users: User[]): ReactNode[] {
  const names = users.map((u) => u.name).sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const token = new RegExp(`(https?:\\/\\/[^\\s<>"']+|\\*\\*[^*\\n]+\\*\\*|\\*[^*\\n]+\\*|@everyone${names.length ? '|@(?:' + names.join('|') + ')' : ''})`, 'gi');
  const plain = (part: string, key: string) => {
    const out: ReactNode[] = [];
    part.split(token).forEach((p, j) => {
      const k = `${key}-${j}`;
      if (!p) return;
      if (/^https?:\/\//i.test(p)) {
        const url = cleanUrl(p);
        out.push(<a key={k} href={url} target="_blank" rel="noopener noreferrer">{url}</a>, p.slice(url.length));
      } else if (/^\*\*[^*]+\*\*$/.test(p)) out.push(<b key={k}>{p.slice(2, -2)}</b>);
      else if (/^\*[^*]+\*$/.test(p)) out.push(<i key={k}>{p.slice(1, -1)}</i>);
      else if (p.startsWith('@') && j % 2 === 1) out.push(<span key={k} className="mention">{p}</span>);
      else out.push(p);
    });
    return out;
  };
  const out: ReactNode[] = [];
  text.split(/(`[^`\n]+`)/).forEach((part, i) => {
    if (/^`[^`\n]+`$/.test(part)) return void out.push(<code key={i}>{part.slice(1, -1)}</code>);
    part.split(/(\|\|[^\n]+?\|\|)/).forEach((p, j) => {
      if (j % 2 === 1) out.push(<Spoiler key={`${i}-s${j}`}>{plain(p.slice(2, -2), `${i}-s${j}`)}</Spoiler>);
      else out.push(...plain(p, `${i}-${j}`));
    });
  });
  return out;
}

/** ||hidden until clicked|| */
function Spoiler({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <span className={`spoiler${open ? ' open' : ''}`} title={open ? undefined : 'Spoiler: click to show it'} onClick={open ? undefined : (e) => { e.preventDefault(); setOpen(true); }}>{children}</span>;
}

// ───────── media bits ─────────

/** How long a moving picture in the chat keeps moving after it was posted. Then it holds still, and moves only while
 *  the mouse is on it: a chat full of old GIFs is not left looping for ever. */
const MOVES_FOR = 5 * 60_000;
/** What a picture is, as far as its address or type says: a GIF, something that never moves, or (anything else: a
 *  .webp may or may not be moving) not known. */
function pictureKind(url: string, mime = ''): 'gif' | 'still' | 'unknown' {
  const path = url.split(/[?#]/)[0];
  if (mime === 'image/gif' || /\.gif$/i.test(path) || /^https:\/\/[^/]*(giphy|tenor)\.com\//i.test(url)) return 'gif';
  if (/^image\/(png|jpe?g|bmp|svg)/.test(mime) || /\.(png|jpe?g)$/i.test(path)) return 'still';
  return 'unknown';
}

function Picture({ url, name, at, mime }: { url: string; name?: string; at: number; mime?: string }) {
  const [zoom, setZoom] = useState(false);
  const [dead, setDead] = useState(false);
  // A browser cannot stop a GIF where it is. So when its time is up, a still of it is drawn on a canvas laid over it
  // and the picture itself is hidden (hidden, it is not played: that work stops too). With the mouse on it the real
  // one shows again, moving; when the mouse leaves, the still is back. The still is always the GIF's FIRST frame:
  // that is the only one Chromium will draw from a moving picture, whichever it is showing.
  const kind = pictureKind(url, mime);
  const [late, setLate] = useState(() => Date.now() - at >= MOVES_FOR);
  const [loaded, setLoaded] = useState(false);
  const [over, setOver] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  const still = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (late || kind === 'still') return;
    const t = window.setTimeout(() => setLate(true), at + MOVES_FOR - Date.now());
    return () => window.clearTimeout(t);
  }, [at, late, kind]);
  const held = kind !== 'still' && late && loaded && !over && !dead;
  useLayoutEffect(() => {
    const from = img.current, to = still.current;
    if (!held || !from || !to || !from.naturalWidth) return;
    const k = Math.min(1, 1280 / Math.max(from.naturalWidth, from.naturalHeight));       // (no need for more than the chat ever shows)
    to.width = Math.round(from.naturalWidth * k);
    to.height = Math.round(from.naturalHeight * k);
    to.getContext('2d')?.drawImage(from, 0, 0, to.width, to.height);
  }, [held]);
  if (dead) return <a href={url} target="_blank" rel="noopener noreferrer">{name || url}</a>;
  return (
    <span className={`picture${held ? ' held' : ''}`} onMouseEnter={() => setOver(true)} onMouseLeave={() => setOver(false)}>
      <img ref={img} src={url} alt={name ?? ''} loading="lazy" referrerPolicy="no-referrer" onClick={() => setZoom(true)} onLoad={() => setLoaded(true)} onError={() => setDead(true)} />
      {held && <canvas ref={still} onClick={() => setZoom(true)} />}
      {held && kind === 'gif' && <i className="held-tag" title="Put the mouse on it to play it">GIF</i>}
      <button className="stash-btn" title="Save to the group stash"
        onClick={() => api('/stash', { url, name: name ?? '' }).then(() => toast('Saved to the stash.')).catch((e) => toast(e.message))}><Icon name="star" size={12} /></button>
      {zoom && <div className="lightbox" onClick={() => setZoom(false)}><img src={url} alt="" referrerPolicy="no-referrer" /></div>}
    </span>
  );
}

const YT_ORIGIN = 'https://www.youtube-nocookie.com';
function YouTube({ id }: { id: string }) {
  const [on, setOn] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const deafened = useStore((s) => s.voice.deafened && s.voice.channelId != null);
  const started = useRef(false);            // whether it was started while deafened (then it starts muted)
  const told = useRef(false);
  // Deafened: the video is muted with the messages YouTube's player understands, and given its sound back after.
  useEffect(() => {
    if (!on || (!deafened && !told.current)) return;
    told.current = true;
    const say = () => {
      const w = frame.current?.contentWindow;
      w?.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), YT_ORIGIN);
      w?.postMessage(JSON.stringify({ event: 'command', func: deafened ? 'mute' : 'unMute', args: [], id: 1, channel: 'widget' }), YT_ORIGIN);
    };
    say();
    const t = window.setTimeout(say, 1500);        // once more, in case it was still loading
    return () => window.clearTimeout(t);
  }, [deafened, on]);
  return on
    ? <iframe ref={frame} className="yt" src={`${YT_ORIGIN}/embed/${id}?autoplay=1&enablejsapi=1&origin=${encodeURIComponent(location.origin)}${started.current ? '&mute=1' : ''}`} allow="autoplay; encrypted-media; fullscreen" title="YouTube video" />
    : <button className="yt poster" onClick={() => { started.current = deafened; setOn(true); }} style={{ backgroundImage: `url(https://i.ytimg.com/vi/${id}/hqdefault.jpg)` }} aria-label="Play video"><span><Icon name="play" size={24} /></span></button>;
}

function ThemeCard({ theme: raw }: { theme: unknown }) {
  const theme = sanitizeTheme(raw);
  if (!theme) return null;
  const apply = async () => {
    applyTheme(theme);
    const { me } = await api('/profile', { theme });
    useStore.setState({ me });
  };
  return <button className="colour-chip" onClick={() => void apply()}><i style={{ background: theme.accent }} />Use this colour</button>;
}

/** A small card for a link: where it is from, its title, a line of description and its picture. */
function LinkCard({ a }: { a: Extract<Attachment, { kind: 'link' }> }) {
  const [dead, setDead] = useState(false);
  return (
    <a className="link-card" href={a.url} target="_blank" rel="noopener noreferrer">
      <span><small>{a.site}</small><b>{a.title}</b>{a.description && <i>{a.description}</i>}</span>
      {a.image && !dead && <img src={a.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setDead(true)} />}
    </a>
  );
}

function AttachmentView({ a, at }: { a: Attachment; at: number }) {
  if (a.kind === 'link') return <LinkCard a={a} />;
  if (a.kind === 'theme') return <ThemeCard theme={a.theme} />;
  if (a.kind === 'image') return <Picture url={a.url} name={a.name} at={at} />;
  if (a.kind !== 'file') return null;          // a kind of attachment newer than this copy of the app: nothing here can draw it
  const mime = a.mime ?? '';
  if (mime.startsWith('image/')) return <Picture url={a.url} name={a.name} at={at} mime={mime} />;
  if (mime.startsWith('video/')) return <video className="clip" src={a.url} controls preload="metadata" />;
  if (mime.startsWith('audio/')) return <span className="audio-file"><small>{a.name}</small><audio src={a.url} controls preload="none" /></span>;
  return <a className="file-chip" href={a.url} download={a.name}><Icon name="clip" size={12} /> {a.name}<small>{fmtSize(a.size)}</small></a>;
}

// ───────── one message ─────────

const QUICK: IconName[] = ['thumb', 'lol', 'heart', 'fire', 'wow', 'sad', 'skull', 'party'];
/** Reactions are stored as ":name:" and drawn with the app's own icons; anything else is shown as typed. */
const reaction = (code: string) => {
  const name = /^:(\w+):$/.exec(code)?.[1] as IconName | undefined;
  return name && ICON_NAMES.includes(name) ? <Icon name={name} size={16} /> : code;
};

// (memo: a row is drawn again only when its own message, or somebody's name or colour, changes; not on every key typed below)
const MessageRow = memo(function MessageRow({ m, head, users, meId, admin }: { m: Message; head: boolean; users: Record<string, User>; meId: string; admin: boolean }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const tools = useRef<HTMLDivElement>(null);
  const leaving = useRef(0);
  // The reaction picker used to shut the moment the pointer slipped off it. Now it stays until a reaction is picked,
  // something else is clicked, Escape is pressed, or the pointer has been off the whole message for a second and a half.
  useEffect(() => {
    if (!picking) return;
    const away = (e: PointerEvent) => { if (!tools.current?.contains(e.target as Node)) setPicking(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setPicking(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); window.clearTimeout(leaving.current); };
  }, [picking]);
  const user = users[m.userId];
  const list = useMemo(() => Object.values(users), [users]);
  const urls = useMemo(() => [...new Set((m.content.replace(SPOILER, ' ').match(URL_RE) ?? []).map(cleanUrl))], [m.content]);      // a spoilered link shows no picture or video
  const embeds = urls.map(embedFor).filter(Boolean).slice(0, 3) as Embed[];
  const onlyEmbed = embeds.length === 1 && urls.length === 1 && m.content.trim() === urls[0] && embeds[0].type !== 'yt';
  const body = useMemo(() => rich(m.content, list), [m.content, list]);
  const saveEdit = () => { if (editing?.trim() && editing !== m.content) send({ t: 'edit', id: m.id, content: editing }); setEditing(null); };      // unchanged: not "(edited)"

  return (
    <div id={`m-${m.id}`} className={`msg${head ? ' head' : ''}${mentionsMe(m) ? ' mentioned' : ''}${picking ? ' picking' : ''}`}
      onMouseEnter={() => window.clearTimeout(leaving.current)}
      onMouseLeave={() => { if (picking) leaving.current = window.setTimeout(() => setPicking(false), 1500); }}>
      <div className="gutter">{head ? <Avatar user={user} size={38} /> : <time>{fmtTime(m.createdAt)}</time>}</div>
      <div className="body">
        {head && <div className="meta"><b style={{ color: personColor(user) }}>{user?.name ?? 'someone'}</b><time>{fmtTime(m.createdAt)}</time></div>}
        {editing !== null
          ? <textarea className="edit" autoFocus value={editing} onChange={(e) => setEditing(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(); } if (e.key === 'Escape') setEditing(null); }} />
          : !onlyEmbed && m.content && <div className="text">{body}{m.editedAt && <small className="edited"> (edited)</small>}</div>}
        {embeds.map((e, i) => e.type === 'img' ? <Picture key={i} url={e.url} at={m.createdAt} /> : e.type === 'video'
          ? <video key={i} className="clip" src={e.url} controls loop muted playsInline preload="metadata" /> : <YouTube key={i} id={e.id!} />)}
        {m.attachments.map((a, i) => <AttachmentView key={i} a={a} at={m.createdAt} />)}
        {Object.keys(m.reactions).length > 0 && (
          <div className="reactions">
            {Object.entries(m.reactions).map(([emoji, ids]) => (
              <button key={emoji} className={ids.includes(meId) ? 'mine' : ''} title={ids.map((id) => users[id]?.name).join(', ')}
                onClick={() => send({ t: 'react', id: m.id, emoji })}>{reaction(emoji)} {ids.length}</button>
            ))}
          </div>
        )}
      </div>
      <div className="actions" ref={tools}>
        <button title="React" onClick={() => setPicking(!picking)}><Icon name="smile" size={12} /></button>
        {m.userId === meId && <button title="Edit" onClick={() => setEditing(m.content)}><Icon name="pencil" size={12} /></button>}
        {(m.userId === meId || admin) && <SureButton title="Delete" onSure={() => send({ t: 'delete', id: m.id })}><Icon name="trash" size={12} /></SureButton>}
        {picking && <div className="quick">
          {QUICK.map((e) => <button key={e} title={e} onClick={() => { send({ t: 'react', id: m.id, emoji: `:${e}:` }); setPicking(false); }}><Icon name={e} size={20} /></button>)}
        </div>}
      </div>
    </div>
  );
});

// ───────── GIF picker: Giphy search plus the group's own stash ─────────

type Gif = { id: string; title: string; preview: string; url: string };
const gifCache = new Map<string, Gif[]>();

/** Runs on each person's own computer, straight to Giphy. Results are cached because the free key allows 100 calls an hour. */
async function searchGiphy(q: string, key: string): Promise<Gif[]> {
  const term = q.trim().toLowerCase();
  const hit = gifCache.get(term);
  if (hit) return hit;
  const base = 'https://api.giphy.com/v1/gifs/';
  const common = `api_key=${encodeURIComponent(key)}&limit=30&rating=r&bundle=messaging_non_clips`;
  const r = await fetch(term ? `${base}search?q=${encodeURIComponent(term)}&${common}` : `${base}trending?${common}`, { referrerPolicy: 'no-referrer' });
  if (r.status === 429) throw new Error('Giphy is rate-limiting the group (100 searches an hour). Try again in a bit, or use the stash.');
  if (r.status === 401 || r.status === 403) throw new Error('Giphy rejected the API key. The admin should check it in Settings → Admin.');
  if (!r.ok) throw new Error(`Giphy answered ${r.status}.`);
  const j = await r.json();
  const out: Gif[] = (j.data ?? []).map((g: any) => ({
    id: g.id, title: g.title ?? '',
    preview: g.images?.fixed_width?.url ?? g.images?.original?.url,
    url: String(g.images?.downsized?.url || g.images?.original?.url || '').split('?')[0],
  })).filter((g: Gif) => g.preview && g.url.startsWith('https://'));
  gifCache.set(term, out);
  return out;
}

function GifPicker({ onPick, onClose }: { onPick: (url: string, name: string) => void; onClose: () => void }) {
  const gifKey = useStore((s) => s.settings.gifKey);
  const admin = useStore((s) => s.me?.role === 'admin');
  const [tab, setTab] = useState<'search' | 'stash'>(gifKey ? 'search' : 'stash');
  const [q, setQ] = useState('');
  const [gifs, setGifs] = useState<Gif[] | null>(null);
  const [error, setError] = useState('');
  const [items, setItems] = useState<{ id: number; url: string; name: string }[] | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const loadStash = () => api('/stash').then((r) => setItems(r.items)).catch(() => setItems([]));
  useEffect(() => { void loadStash(); }, []);
  useEffect(() => {
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest('.gif-toggle')) onClose(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [onClose]);
  useEffect(() => {
    if (tab !== 'search' || !gifKey) return;
    setError('');
    let stale = false;          // an answer to an earlier search that comes in late must not replace a newer one
    const t = setTimeout(() => searchGiphy(q, gifKey).then((r) => { if (!stale) setGifs(r); }).catch((e) => { if (!stale) { setError(e.message); setGifs([]); } }), q ? 450 : 0);
    return () => { stale = true; clearTimeout(t); };
  }, [q, tab, gifKey]);

  const stashed = (items ?? []).filter((i) => i.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="stash" ref={box}>
      <div className="stash-tabs">
        <button className={tab === 'search' ? 'active' : ''} onClick={() => setTab('search')}>Search Giphy</button>
        <button className={tab === 'stash' ? 'active' : ''} onClick={() => setTab('stash')}>Our stash{items ? ` · ${items.length}` : ''}</button>
      </div>
      {(tab === 'stash' || gifKey) && <input autoFocus placeholder={tab === 'search' ? 'Search GIFs' : 'Search the stash'} value={q} onChange={(e) => setQ(e.target.value)} />}
      {tab === 'search' && !gifKey && (
        <p className="empty">GIF search needs a free Giphy key. {admin
          ? <button className="link" onClick={() => { onClose(); useStore.setState({ settingsOpen: 'admin' }); }}>Add it in Settings → Admin</button>
          : 'Ask the admin to add one in Settings → Admin.'}</p>
      )}
      {tab === 'search' && gifKey && (
        <>
          {error && <p className="error">{error}</p>}
          <div className="gif-grid">
            {(gifs ?? []).map((g) => (
              <span key={g.id} className="stash-item">
                <img src={g.preview} alt={g.title} title={g.title} loading="lazy" referrerPolicy="no-referrer" onClick={() => onPick(g.url, g.title)} />
                <button title="Save to our stash" onClick={() => api('/stash', { url: g.url, name: g.title || q }).then(() => { toast('Saved to the stash.'); void loadStash(); }).catch((e) => toast(e.message))}><Icon name="star" size={12} /></button>
              </span>
            ))}
          </div>
          {gifs && !gifs.length && !error && <p className="empty">Nothing found for “{q}”.</p>}
          {!gifs && <p className="empty">Searching…</p>}
          <small className="powered">Powered by GIPHY</small>
        </>
      )}
      {tab === 'stash' && (
        <div className="gif-grid">
          {stashed.map((i) => (
            <span key={i.id} className="stash-item">
              <img src={i.url} alt={i.name} title={i.name} loading="lazy" referrerPolicy="no-referrer" onClick={() => onPick(i.url, i.name)} />
              <button title="Remove from the stash" onClick={() => api(`/stash/${i.id}`, undefined, 'DELETE').then(loadStash)}><Icon name="close" size={8} /></button>
            </span>
          ))}
          {items && !stashed.length && <p className="empty">Nothing here yet. Press the star on any GIF or picture to keep it for the whole group.</p>}
        </div>
      )}
    </div>
  );
}

// ───────── the channel ─────────

export const Chat = memo(function Chat({ channelId }: { channelId: number }) {
  const messages = useStore((s) => s.messages[channelId]);
  const more = useStore((s) => s.more[channelId]);
  const users = useStore((s) => s.users);
  const me = useStore((s) => s.me)!;
  const historic = useStore((s) => !!s.historic[channelId]);
  const dm = useStore((s) => s.dms.find((x) => x.id === channelId));
  const mainChat = useStore((s) => s.channels.find((c) => c.kind === 'text')?.id);
  const place = dm ? users[dm.with]?.name ?? 'them' : '# Text Chat';
  // search: type two letters or more and matching messages are listed, newest first; click one to see it in place
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Message[] | null>(null);
  useEffect(() => {
    if (query.trim().length < 2) { setFound(null); return; }
    let stale = false;
    const t = window.setTimeout(() => void api<{ messages: Message[] }>(`/search?channel=${channelId}&q=${encodeURIComponent(query.trim())}`).then((r) => { if (!stale) setFound(r.messages); }).catch(() => {}), 250);
    return () => { stale = true; window.clearTimeout(t); };
  }, [query]);
  const show = async (id: number) => {
    setQuery('');
    atBottom.current = false;
    await jumpTo(channelId, id).catch((e) => toast(e.message));
    window.setTimeout(() => {
      const el = document.getElementById(`m-${id}`);
      el?.scrollIntoView({ block: 'center' });
      el?.classList.add('found');
      window.setTimeout(() => el?.classList.remove('found'), 2500);
    }, 60);
  };
  const latest = () => { atBottom.current = true; void loadMessages(channelId); };
  const typing = useStore((s) => s.typing[channelId]);
  const [text, setText] = useState('');
  const [pending, setPending] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(0);
  const [stash, setStash] = useState(false);
  const closeStash = useCallback(() => setStash(false), []);
  const [beat, tick] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  // The message box is as tall as what is typed in it (wrapped lines included), up to half the window; then it scrolls.
  const fit = () => { const el = input.current; if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; } };
  useLayoutEffect(fit, [text]);
  useEffect(() => {
    const box = input.current?.parentElement;
    if (!box) return;
    let width = box.clientWidth;
    const ro = new ResizeObserver(() => { if (box.clientWidth !== width) { width = box.clientWidth; fit(); } });      // a narrower or wider chat column wraps the text differently
    ro.observe(box);
    return () => ro.disconnect();
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const atBottom = useRef(true);
  const prevHeight = useRef(0);
  const prevFirst = useRef<number | undefined>(undefined);
  const lastTyping = useRef(0);

  useEffect(() => { atBottom.current = true; input.current?.focus(); }, [channelId]);
  // "… is typing" goes four seconds after their last key: one timer for the moment the next name is due to go, and
  // none at all while nobody is typing.
  useEffect(() => {
    const due = Object.entries(typing ?? {}).filter(([id, ts]) => id !== me.id && ts + 4000 > Date.now()).map(([, ts]) => ts + 4000);
    if (!due.length) return;
    const t = window.setTimeout(() => tick((n) => n + 1), Math.min(...due) - Date.now() + 20);
    return () => window.clearTimeout(t);
  }, [typing, beat, me.id]);
  // "Today" and "Yesterday" move on at midnight even if nothing else is happening
  const [, setDay] = useState(() => new Date().toDateString());
  useEffect(() => { const t = window.setInterval(() => setDay(new Date().toDateString()), 60_000); return () => window.clearInterval(t); }, []);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const first = messages?.[0]?.id;
    if (prevFirst.current !== undefined && first !== undefined && first < prevFirst.current) el.scrollTop += el.scrollHeight - prevHeight.current; // older page added on top
    else if (atBottom.current) el.scrollTop = el.scrollHeight;
    prevHeight.current = el.scrollHeight;
    prevFirst.current = first;
  }, [messages, channelId, found]);       // (`found`: the list is put away while search results show, and comes back at the bottom if it was there)
  // A picture or clip takes up its room only once it has loaded, which is after the list was scrolled: a chat that was
  // at the bottom is put back there. True when it did that.
  const settle = () => {
    const el = scroller.current;
    if (!el) return false;
    const grew = el.scrollHeight > prevHeight.current;
    prevHeight.current = el.scrollHeight;
    if (grew && atBottom.current) el.scrollTop = el.scrollHeight;
    return grew && atBottom.current;
  };
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.addEventListener('load', settle, true);                 // (neither event bubbles, so they are caught on the way down)
    el.addEventListener('loadedmetadata', settle, true);
    return () => { el.removeEventListener('load', settle, true); el.removeEventListener('loadedmetadata', settle, true); };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const failedOn = useRef<Message[] | undefined>(undefined);       // the list as it stood when fetching older messages last failed
  const loadOlder = () => { setBusy((b) => b + 1); void loadMessages(channelId, true).catch(() => { failedOn.current = messages; }).finally(() => setBusy((b) => b - 1)); };
  const onScroll = () => {
    const el = scroller.current!;
    // (a picture can take up its room between the list being scrolled to the bottom and this event arriving: that is
    // the list growing, not the reader scrolling up, and must not unpin it)
    if (settle()) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (atBottom.current) markRead(channelId);
    if (el.scrollTop < 60 && more && !busy) loadOlder();
  };
  // In a tall window one page of messages may not fill the list: with nothing to scroll there is no way to ask for the
  // older ones, so they are fetched until the list overflows (or there are no more). A fetch that failed is not tried
  // again until the list changes.
  useEffect(() => {
    const el = scroller.current;
    if (el && messages && more && !busy && failedOn.current !== messages && el.clientHeight > 0 && el.scrollHeight <= el.clientHeight) loadOlder();
  }, [messages, more, busy]);   // eslint-disable-line react-hooks/exhaustive-deps

  async function addFiles(files: Iterable<File>) {
    for (const f of files) {
      setBusy((b) => b + 1);
      try { const a = await upload(f, 'attachment'); setPending((p) => [...p, a]); }
      catch (e: any) { toast(`${f.name}: ${e.message}`); }
      finally { setBusy((b) => b - 1); }
    }
  }

  function submit() {
    if (!text.trim() && !pending.length) return;
    if (!sendMessage(channelId, text.trim(), pending)) return;       // no connection: what was typed stays in the box
    setText('');
    setPending([]);
    atBottom.current = true;
  }

  const typers = Object.entries(typing ?? {}).filter(([id, ts]) => id !== me.id && Date.now() - ts < 4000).map(([id]) => users[id]?.name ?? 'someone');
  let lastDay = '';

  return (
    <section className="chat" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void addFiles(e.dataTransfer.files); }}>
      {dm && (
        <div className="dm-title">
          <b>Private: you and {place}</b>
          {mainChat != null && <button onClick={() => void openText(mainChat, true)}># Text Chat</button>}
        </div>
      )}
      <div className="chat-search">
        <Icon name="search" size={12} />
        <input value={query} placeholder={dm ? 'Search this private chat' : 'Search the chat'} maxLength={80} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setQuery(''); }} aria-label="Search the chat" />
        {query && <button className="icon" title="Close search" onClick={() => setQuery('')}><Icon name="close" size={12} /></button>}
      </div>
      {found && (
        <div className="search-results">
          {found.length === 0 && <p className="empty">Nothing found for "{query.trim()}".</p>}
          {found.map((m) => (
            <button key={m.id} onClick={() => void show(m.id)} title="Show it in the chat">
              <small>{users[m.userId]?.name ?? 'someone'} · {fmtDay(m.createdAt)} {fmtTime(m.createdAt)}</small>
              <span>{m.content.length > 160 ? `${veiled(m.content).slice(0, 160)}…` : veiled(m.content)}</span>
            </button>
          ))}
        </div>
      )}
      {historic && !found && <button className="to-latest" onClick={latest}>You are looking at older messages. Back to the latest</button>}
      <div className="messages" ref={scroller} onScroll={onScroll} hidden={!!found}>
        {messages && !more && <p className="beginning">{dm ? `This is the start of your private chat with ${place}. Only the two of you can see it.` : 'This is the start of # Text Chat.'}</p>}
        {(messages ?? []).map((m, i) => {
          const prev = messages![i - 1];
          const day = fmtDay(m.createdAt);
          const newDay = day !== lastDay;
          lastDay = day;
          const head = newDay || !prev || prev.userId !== m.userId || m.createdAt - prev.createdAt > 5 * 60_000;
          return (
            <Fragment key={m.id}>
              {newDay && <div className="day"><span>{day}</span></div>}
              <MessageRow m={m} head={head} users={users} meId={me.id} admin={me.role === 'admin'} />
            </Fragment>
          );
        })}
      </div>
      <div className="typing">{typers.length > 0 && `${typers.join(', ')} ${typers.length === 1 ? 'is' : 'are'} typing…`}</div>
      {(pending.length > 0 || busy > 0) && (
        <div className="pending">
          {pending.map((a, i) => (
            <span key={i} className="chip">{a.kind === 'file' ? a.name : 'attachment'}
              <button onClick={() => setPending((p) => p.filter((_, k) => k !== i))} aria-label="Remove"><Icon name="close" size={8} /></button></span>
          ))}
          {busy > 0 && <span className="chip">Uploading…</span>}
        </div>
      )}
      <div className="composer">
        <label className="icon" title="Attach files"><Icon name="plus" /><input type="file" multiple hidden onChange={(e) => { if (e.target.files) void addFiles([...e.target.files]); e.target.value = ''; }} /></label>{/* a copy: clearing the box empties its own list, and only the first file would be sent */}
        <textarea ref={input} rows={1} placeholder={`Message ${place}`} title="**bold**   *italic*   `code`   ||spoiler||" value={text} maxLength={4000}
          onChange={(e) => {
            setText(e.target.value);
            if (Date.now() - lastTyping.current > 2500) { lastTyping.current = Date.now(); send({ t: 'typing', channelId }); }
          }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
          onPaste={(e) => { const files = [...e.clipboardData.files]; if (files.length) { e.preventDefault(); void addFiles(files); } }} />
        <button className="icon gif-toggle" title="GIFs" onClick={() => setStash(!stash)}>GIF</button>
        <button className="primary" onClick={submit} disabled={!text.trim() && !pending.length}>Send</button>
        {stash && <GifPicker onClose={closeStash} onPick={(url, name) => { if (!sendMessage(channelId, '', [{ kind: 'image', url, name }])) return; setStash(false); atBottom.current = true; }} />}
      </div>
    </section>
  );
});
