import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { recentProcs } from '../activity';
import { native } from '../native';
import type { DesktopConfig } from '../native';
import { setPrefs, toast, useStore } from '../store';
import '../devices';
import { applyTheme, DEFAULT_ACCENT, sanitizeTheme, SWATCHES } from '../theme';
import type { Me } from '../types';
import { restartMic, TALK_LEVEL } from '../voice';
import { Admin } from './Admin';
import { CharacterBuilder, DeskBuilder, PetBuilder, PERSON_COLORS } from './Builders';
import { Modal, Toggle } from './ui';

const saveProfile = async (patch: Record<string, unknown>) => {
  try { const { me } = await api<{ me: Me }>('/profile', patch); useStore.setState({ me }); }
  catch (e: any) { toast(e.message); }
};

function Look() {
  const me = useStore((s) => s.me)!;
  const [accent, setAccent] = useState(() => sanitizeTheme(me.theme)?.accent ?? DEFAULT_ACCENT);
  const timer = useRef(0);
  const textSize = useStore((s) => s.prefs.textSize) || 1;
  const change = (c: string) => {
    setAccent(c);
    applyTheme({ accent: c });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void saveProfile({ theme: { accent: c } }), 400);
  };
  return (
    <div className="pane">
      <p>Chatterday has one look. Choose the colour it glows in on your screen; the clock on the wall follows. (Your own colour, the one others see you in, is under Account.)</p>
      <div className="swatch-row">
        {SWATCHES.map((c) => <button key={c} className={c === accent ? 'active' : ''} style={{ background: c }} onClick={() => change(c)} aria-label={c} />)}
        <label>Any colour<input type="color" value={accent} onChange={(e) => change(e.target.value)} /></label>
      </div>
      <h3>Text size</h3>
      <label className="vol">The left panel and the chat: {Math.round(textSize * 100)}%
        <input type="range" min={0.8} max={1.6} step={0.05} value={textSize} onChange={(e) => setPrefs({ textSize: Number(e.target.value) })} />
      </label>
      <p className="hint">100% is the size picked for your screen (a big screen already gets bigger text). This is kept on this PC only. {textSize !== 1 && <button onClick={() => setPrefs({ textSize: 1 })}>Back to 100%</button>}</p>
    </div>
  );
}

// Loudness is shown in decibels, the way hearing works: -60 is near silence, -10 is shouting into the mic.
const toDb = (level: number) => 20 * Math.log10(Math.max(level, 0.0001));
const fromDb = (db: number) => 10 ** (db / 20);
const DB_MIN = -60, DB_MAX = -10;
const along = (db: number) => `${Math.max(0, Math.min(100, ((db - DB_MIN) / (DB_MAX - DB_MIN)) * 100))}%`;

/** A live meter of your microphone, with a slider for how loud counts as you talking. Everyone's app uses your setting
 *  to decide when the ring round your picture lights up, so set it just above your room's background noise. */
function MicTest() {
  const me = useStore((s) => s.me)!;
  const prefs = useStore((s) => s.prefs);
  const [db, setDb] = useState(() => toDb(me.talk ?? TALK_LEVEL));
  const [state, setState] = useState<'starting' | 'on' | 'none'>('starting');
  const bar = useRef<HTMLElement>(null);
  const line = useRef(db);
  line.current = db;
  const save = useRef(0);
  useEffect(() => {
    let stream: MediaStream | null = null, ctx: AudioContext | null = null, raf = 0, gone = false;
    navigator.mediaDevices.getUserMedia({ audio: { deviceId: prefs.micId || undefined, echoCancellation: prefs.echo, noiseSuppression: prefs.noise, autoGainControl: prefs.agc } }).then((s) => {
      if (gone) { s.getTracks().forEach((t) => t.stop()); return; }
      stream = s;
      ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(s).connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      let peak = DB_MIN;
      const draw = () => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const now = toDb(Math.sqrt(sum / buf.length));
        peak = Math.max(now, peak - 0.8);                     // falls back gently, so it can be read
        if (bar.current) { bar.current.style.width = along(peak); bar.current.classList.toggle('talking', peak > line.current); }
        raf = requestAnimationFrame(draw);
      };
      setState('on');
      draw();
    }).catch(() => setState('none'));
    return () => { gone = true; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); void ctx?.close(); };
  }, [prefs.micId, prefs.echo, prefs.noise, prefs.agc]);
  const change = (v: number) => {
    setDb(v);
    window.clearTimeout(save.current);
    save.current = window.setTimeout(() => void saveProfile({ talk: Math.round(fromDb(v) * 10000) / 10000 }), 400);
  };
  return (
    <div className="mic-test">
      <h3>Microphone test</h3>
      <div className="meter" title="How loud your microphone is right now"><i ref={bar} /><b style={{ left: along(db) }} /></div>
      <input type="range" min={-55} max={-15} step={1} value={Math.round(db)} onChange={(e) => change(Number(e.target.value))} aria-label="How loud counts as talking" />
      <p className="hint">{state === 'none' ? 'No microphone could be opened.' : state === 'starting' ? 'Opening your microphone…'
        : 'Talk normally: the bar should pass the line and turn green. Stay quiet: it should stay below it. Drag the slider to move the line. This is what lights the ring round your picture for everyone.'}</p>
    </div>
  );
}

function Voice() {
  const prefs = useStore((s) => s.prefs);
  const me = useStore((s) => s.me)!;
  const everySound = useStore((s) => s.sounds);
  const sounds = everySound.filter((x) => !x.entranceFor);                   // the soundboard's clips
  const mine = everySound.find((x) => x.entranceFor === me.id);              // my own entrance clip, if the host has put one in for me
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [capturing, setCapturing] = useState(false);
  const [perm, setPerm] = useState(typeof Notification === 'undefined' ? 'denied' : Notification.permission);
  useEffect(() => { navigator.mediaDevices.enumerateDevices().then(setDevices).catch(() => {}); }, []);
  const set = (p: Partial<typeof prefs>, restart = true) => { setPrefs(p); if (restart) void restartMic(); };
  const named = devices.some((d) => d.label);

  return (
    <div className="pane">
      <div className="grid2">
        <label>Microphone
          <select value={prefs.micId} onChange={(e) => set({ micId: e.target.value })}>
            <option value="">System default</option>
            {devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default').map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Microphone'}</option>)}
          </select>
        </label>
        <label>Speakers / headphones
          <select value={prefs.outId} onChange={(e) => set({ outId: e.target.value })}>
            <option value="">System default</option>
            {devices.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default').map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Output'}</option>)}
          </select>
        </label>
      </div>
      <Toggle label="Even out everyone's loudness" hint="Louder voices are turned down to match the quietest one you are hearing. Nobody is made louder than they arrive." checked={prefs.levelVoices} onChange={(v) => set({ levelVoices: v }, false)} />
      {native && <Toggle label="Mute my microphone when I lock my PC" hint="Unlocking turns it back on, unless you had muted it yourself. Needs desktop app 0.1.4 or newer." checked={prefs.lockMute} onChange={(v) => set({ lockMute: v }, false)} />}
      <Toggle label="Tell me when I talk while muted" hint="After a second or so of talking into a muted microphone, the mute button flashes. Not with push-to-talk." checked={prefs.mutedNudge} onChange={(v) => set({ mutedNudge: v }, false)} />
      <Toggle label="Switch to a headset when it is plugged in" hint="A microphone and speakers that arrive together as one device. Unplugging it goes back to what you used before." checked={prefs.autoDevice} onChange={(v) => set({ autoDevice: v }, false)} />
      <MicTest />
      <Toggle label="Noise gate" hint="Your microphone sends nothing while you are below the line above, so keyboards and fans never reach anyone. Set the line first." checked={prefs.gate} onChange={(v) => set({ gate: v }, false)} />
      {!named && <button onClick={() => navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => { s.getTracks().forEach((t) => t.stop()); return navigator.mediaDevices.enumerateDevices(); }).then(setDevices).catch(() => toast('Microphone access was refused.'))}>Allow microphone access to list devices</button>}
      <Toggle label="Echo cancellation" checked={prefs.echo} onChange={(v) => set({ echo: v })} />
      <Toggle label="Noise suppression" checked={prefs.noise} onChange={(v) => set({ noise: v })} />
      <Toggle label="Automatic gain" hint="Evens out loud and quiet moments." checked={prefs.agc} onChange={(v) => set({ agc: v })} />
      <Toggle label="Push to talk" hint="Works while this window has focus. For everywhere else, set a mute hotkey under Desktop app." checked={prefs.ptt} onChange={(v) => set({ ptt: v }, false)} />
      {prefs.ptt && (
        <button onClick={() => setCapturing(true)} onKeyDown={(e) => { if (capturing) { e.preventDefault(); setPrefs({ pttKey: e.code }); setCapturing(false); } }}>
          {capturing ? 'Press a key…' : `Talk key: ${prefs.pttKey}`}
        </button>
      )}
      <h3>Screen sharing</h3>
      <div className="grid2">
        <label>Quality
          <select value={prefs.shareQuality} onChange={(e) => set({ shareQuality: e.target.value as typeof prefs.shareQuality }, false)}>
            <option value="720p30">720p · 30 fps (lightest)</option>
            <option value="1080p30">1080p · 30 fps</option>
            <option value="1080p60">1080p · 60 fps (games)</option>
          </select>
        </label>
      </div>
      <p className="hint">For a steady 60, share the game's window rather than the whole screen: Windows hands over a whole screen more slowly (about 48 a second from a 3440 x 1440 monitor, measured). A picture is fitted inside 1920 x 1080, so an ultrawide comes out 1934 x 810.</p>
      <Toggle label="Send a shared window's sound along with it" hint="When you share a window, the others hear that window's program and nothing else, so nobody's voice comes back to them. A whole screen is always shared without sound. Needs desktop app 0.1.6 or newer." checked={prefs.shareAppSound} onChange={(v) => set({ shareAppSound: v }, false)} />
      <h3>Sounds and notifications</h3>
      <Toggle label="Join, leave and mute tones, and the doorbell" hint="The doorbell rings when somebody signs on." checked={prefs.chimes} onChange={(v) => set({ chimes: v }, false)} />
      <Toggle label="Turn the player and sounds down while someone is talking" hint="They come back up a moment after the talking stops." checked={prefs.duck} onChange={(v) => set({ duck: v }, false)} />
      <div className="grid2">
        <label>My entrance sound
          <select value={me.entrance ?? ''} onChange={(e) => void saveProfile({ entrance: e.target.value ? Number(e.target.value) : null })}>
            <option value="">None</option>
            {mine && <option value={mine.id}>My own entrance clip</option>}
            {sounds.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      </div>
      <div className="grid2">
        <label>My exit sound
          <select value={me.exit ?? ''} onChange={(e) => void saveProfile({ exit: e.target.value ? Number(e.target.value) : null })}>
            <option value="">None</option>
            {sounds.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      </div>
      <p className="hint">Your entrance sound plays for everyone in voice when you join, you included (unless you are the first one in), at most once an hour, and your exit sound for those you leave behind, at most once a minute.</p>
      <div className="grid2">
        <label>Tell me about
          <select value={prefs.notify} onChange={(e) => set({ notify: e.target.value as typeof prefs.notify }, false)}>
            <option value="all">Every message</option><option value="mentions">Only @mentions</option><option value="none">Nothing</option>
          </select>
        </label>
      </div>
      {perm === 'default' && <button onClick={() => Notification.requestPermission().then(setPerm)}>Turn on desktop notifications</button>}
    </div>
  );
}

function Privacy() {
  const prefs = useStore((s) => s.prefs);
  const me = useStore((s) => s.me)!;
  return (
    <div className="pane">
      <Toggle label="Show what I'm up to" hint="Lets the house move you between the office, kitchen and couch. Off: you always sit at a desk while online." checked={prefs.shareActivity} onChange={(v) => setPrefs({ shareActivity: v })} />
      <Toggle label="Show the name of the game or site" hint="Otherwise friends only see “gaming” or “watching”." checked={prefs.shareDetail} onChange={(v) => setPrefs({ shareDetail: v })} />
      <div className="grid2">
        <label>Go away after
          <select value={prefs.awayAfter} onChange={(e) => setPrefs({ awayAfter: Number(e.target.value) })}>
            {[2, 5, 10, 15].map((m) => <option key={m} value={m}>{m} minutes</option>)}
          </select>
        </label>
      </div>
      <p className="hint">
        {native
          ? 'That long without touching the mouse or keyboard and you step out of the room. A game in front gets 30 minutes, since a controller does not count, and a video 3 hours. Locking the PC is away at once. Needs desktop app 0.1.7 or newer; before that it is always 5 minutes.'
          : 'In a browser it takes three times that long, because this tab cannot tell when you are busy in another window. The desktop app can.'}
        {' '}Talking in voice counts as being here.
      </p>
      <Toggle label="Invisible" hint="Stay in bed as far as everyone can tell, unless you join voice." checked={me.invisible} onChange={(v) => saveProfile({ invisible: v })} />
      <p className="hint">
        The desktop app works out your status on this computer and sends one word: away, desk, gaming or watching, plus the game's
        name if you allow it. Window titles, sites and files never leave your PC.
      </p>
    </div>
  );
}

function Desktop() {
  const [cfg, setCfg] = useState<DesktopConfig | null>(null);
  const [, tick] = useState(0);
  useEffect(() => { void native!.getConfig().then(setCfg); const t = setInterval(() => tick((n) => n + 1), 3000); return () => clearInterval(t); }, []);
  if (!cfg) return <div className="pane" />;
  const set = (c: Partial<DesktopConfig>) => native!.setConfig(c).then(setCfg);
  const marked = (proc: string) => cfg.games.includes(proc.toLowerCase());
  const mark = (proc: string) => set({ games: marked(proc) ? cfg.games.filter((g) => g !== proc.toLowerCase()) : [...cfg.games, proc.toLowerCase()] });
  return (
    <div className="pane">
      <Toggle label="Start with Windows" hint="Sits in the tray so friends can see when you're around. On unless you turn it off." checked={cfg.autoLaunch} onChange={(v) => set({ autoLaunch: v })} />
      <Toggle label="Closing the window keeps it running in the tray" hint="While it is closed it makes no sound at all, and leaves voice." checked={cfg.closeToTray} onChange={(v) => set({ closeToTray: v })} />
      <h3>Game detection</h3>
      <p className="hint">Games from Steam, Epic, Xbox, Riot, Battle.net and GOG are recognised on their own.</p>
      {recentProcs.length
        ? <>
            <p className="hint">The programs you have had in front lately, newest first:</p>
            {recentProcs.map((r) => (
              <div className="row" key={r.proc}><span><code>{r.proc}</code></span>
                {r.game && !marked(r.proc) ? <small>Recognised as a game</small> : <button onClick={() => mark(r.proc)}>{marked(r.proc) ? 'Not a game' : 'Count this as a game'}</button>}</div>
            ))}
          </>
        : <p className="hint">Switch to a game, then come back here to mark it.</p>}
      {cfg.games.filter((g) => !recentProcs.some((r) => r.proc.toLowerCase() === g)).map((g) => (
        <div className="row" key={g}><span><code>{g}</code></span><button onClick={() => mark(g)}>Not a game</button></div>
      ))}
      <p className="hint">Desktop app {native!.version}</p>
    </div>
  );
}

/** Who I am here: my name, my colour, my birthday, my password. */
function Account() {
  const me = useStore((s) => s.me)!;
  const [name, setName] = useState(me.name);
  const [birthday, setBirthday] = useState(me.birthday ?? '');
  const [old, setOld] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const rename = () => { if (name.trim() && name.trim() !== me.name) void saveProfile({ name }); };
  const saveBirthday = () => {
    const v = birthday.trim();
    if (v && !/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v)) return toast('Write your birthday as month-day, like 05-05.');
    if (v !== (me.birthday ?? '')) void saveProfile({ birthday: v || null });
  };
  const changePassword = async () => {
    try { await api('/password', { old, new: next }); setOld(''); setNext(''); setAgain(''); toast('Password changed. Your other devices are signed out.'); }
    catch (e: any) { toast(e.message); }
  };
  return (
    <div className="pane">
      <h3>You</h3>
      <label className="hotkey wide">Your name
        <input maxLength={24} value={name} onChange={(e) => setName(e.target.value)} onBlur={rename} onKeyDown={(e) => { if (e.key === 'Enter') rename(); }} />
      </label>
      <label className="hotkey wide">Your birthday (month-day)
        <input className="bday" placeholder="MM-DD" maxLength={5} value={birthday} onChange={(e) => setBirthday(e.target.value)} onBlur={saveBirthday} />
      </label>
      <p className="hint">On your birthday the house puts balloons and a cake on your desk and a party hat on your head. Leave it empty for no fuss.</p>
      <h3>Your colour</h3>
      <p className="hint">Your name tag, your headset and blanket, and (unless you pick another under Desk) the lights on whichever desk you sit at.</p>
      <div className="swatch-row">
        {PERSON_COLORS.map((c) => <button key={c} className={c === me.color ? 'active' : ''} style={{ background: c }} onClick={() => void saveProfile({ color: c })} aria-label={c} />)}
        <label>Any colour<input type="color" value={me.color} onChange={(e) => void saveProfile({ color: e.target.value })} /></label>
      </div>
      <h3>Password</h3>
      <div className="grid2">
        <label>Your password now<input type="password" autoComplete="current-password" value={old} onChange={(e) => setOld(e.target.value)} /></label>
        <span />
        <label>A new one (8 characters or more)<input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></label>
        <label>The new one again<input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} /></label>
      </div>
      <button disabled={!old || next.length < 8 || next !== again} onClick={() => void changePassword()}>Change password</button>
      <h3>Signed in as {me.name}</h3>
      <button className="danger" onClick={() => api('/logout', {}).then(() => location.reload())}>Sign out</button>
    </div>
  );
}

export function Settings() {
  const tab = useStore((s) => s.settingsOpen)!;
  const admin = useStore((s) => s.me?.role === 'admin');
  const tabs: [string, string][] = [['character', 'Character'], ['pet', 'Pet'], ['desk', 'Desk'], ['look', 'Screen colour'], ['voice', 'Voice & video'], ['privacy', 'Privacy']];
  if (native) tabs.push(['desktop', 'Desktop app']);
  tabs.push(['account', 'Account']);
  if (admin) tabs.push(['admin', 'Admin']);
  return (
    <Modal title="Settings" onClose={() => useStore.setState({ settingsOpen: null })} wide>
      <div className="settings">
        <nav>{tabs.map(([id, label]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => useStore.setState({ settingsOpen: id })}>{label}</button>)}</nav>
        {tab === 'look' && <Look />}
        {tab === 'character' && <div className="pane"><CharacterBuilder /></div>}
        {tab === 'pet' && <div className="pane"><PetBuilder /></div>}
        {tab === 'desk' && <div className="pane"><DeskBuilder /></div>}
        {tab === 'voice' && <Voice />}
        {tab === 'privacy' && <Privacy />}
        {tab === 'desktop' && native && <Desktop />}
        {tab === 'account' && <Account />}
        {tab === 'admin' && admin && <Admin />}
      </div>
    </Modal>
  );
}
