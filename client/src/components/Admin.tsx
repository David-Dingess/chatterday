import { useEffect, useRef, useState } from 'react';
import { api, upload } from '../api';
import { toast, useStore } from '../store';
import { Icon, SureButton } from './ui';

/** Every time zone this browser knows, for the house's clock. */
const ZONES: string[] = (() => { try { return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('timeZone'); } catch { return []; } })();

// The admin's pages: who is allowed in, what the place is called, the keys for the things that need one, the
// town the weather is read for, the picture on the wall, the soundboard, and the installer friends use.

type Person = { id: string; name: string; role: string; createdAt: number; seenAt: number | null; devices: { device: string; last_seen: number }[] };
type Invite = { id: string; label: string; role: string; createdAt: number; expiresAt: number; usedAt: number | null; usedBy: string | null };
type Town = { name: string; lat: number; lon: number; tz: string };
type Installer = {
  serverUrl: string; built: { name: string; version: string; at: number } | null; building: boolean; failed: boolean; log: string;
  tailscaleIp: string; port: number; mediaPorts: number[];
};
/** The biggest photo the wall takes (LIMITS.photo on the server). */
const PHOTO_MAX = 12 * 1048576;
type Config = { giphyKey: string; giphyFromEnv?: boolean; youtubeKey: boolean; town: Town | null; tz: string; hostTz: string; envTz?: string; unit: 'F' | 'C'; photo: string | null; wall?: { id: string; url: string }[]; wallMax?: number; installer: Installer };

const when = (ts: number) => new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const fail = (e: any) => toast(e.message);

export function CopyBox({ value, note }: { value: string; note?: string }) {
  return (
    <div className="copybox">
      <input readOnly value={value} onFocus={(e) => e.target.select()} />
      <button onClick={() => navigator.clipboard.writeText(value).then(() => toast('Copied.'))}>Copy</button>
      {note && <small>{note}</small>}
    </div>
  );
}

/** Invites and the people who are in. */
function People() {
  const me = useStore((s) => s.me)!;
  const users = useStore((s) => s.users);
  const settings = useStore((s) => s.settings);
  const [people, setPeople] = useState<Person[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [label, setLabel] = useState('');
  const [hours, setHours] = useState(72);
  const [made, setMade] = useState<{ code: string; label: string } | null>(null);
  const [fresh, setFresh] = useState<{ name: string; password: string } | null>(null);
  const load = () => {
    api('/admin/people').then((r) => setPeople(r.people)).catch(() => {});
    api('/admin/invites').then((r) => setInvites(r.invites)).catch(() => {});
  };
  useEffect(load, [users]);

  const base = settings.publicUrl || location.origin;
  const invite = async () => {
    try { const r = await api<{ code: string }>('/invites', { label, hours }); setMade({ code: r.code, label }); setLabel(''); load(); } catch (e) { fail(e); }
  };
  const setBirthday = (userId: string, birthday: string) => {
    if (birthday && !/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(birthday)) return toast('Write a birthday as month-day, like 05-05.');
    void api('/admin/birthday', { userId, birthday }).catch(fail);
  };
  const open = invites.filter((i) => !i.usedAt), used = invites.filter((i) => i.usedAt);

  return (
    <>
      <h3>Invite somebody</h3>
      <p className="hint">An invite is a link that lets one new person in. They pick their own name and password, then make their character. Nobody gets in without one.</p>
      <div className="row">
        <input placeholder="Who is it for? (a note for you)" maxLength={40} value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void invite(); }} />
        <select value={hours} onChange={(e) => setHours(Number(e.target.value))} aria-label="How long the invite lasts">
          <option value={24}>Good for a day</option><option value={72}>Good for 3 days</option><option value={168}>Good for a week</option><option value={720}>Good for 30 days</option>
        </select>
        <button className="primary" onClick={() => void invite()}>Make an invite link</button>
      </div>
      {made && (
        <>
          <CopyBox value={`${base}/#/invite/${made.code}`} note={`Send this to ${made.label || 'them'}, privately. It works once, and it is only shown now.`} />
          <CopyBox value={made.code} note="Or just the code, for the box in the desktop app (I have an invite)." />
          {!settings.publicUrl && <p className="hint">This link uses the address in your own address bar. If friends reach the server at a different address, set it under This place first.</p>}
        </>
      )}
      {open.length > 0 && <h3>Invites waiting to be used</h3>}
      {open.map((i) => (
        <div key={i.id} className="row spread">
          <span><b>{i.label || 'No note'}</b> <small>made {when(i.createdAt)}, good until {when(i.expiresAt)}</small></span>
          <SureButton onSure={() => void api(`/admin/invites/${i.id}`, undefined, 'DELETE').then(load).catch(fail)}>Cancel it</SureButton>
        </div>
      ))}

      <h3>Who is in</h3>
      {people.map((p) => (
        <div key={p.id} className="row spread">
          <span><b>{p.name}</b> {p.role === 'admin' && <small>admin</small>} <small>{p.seenAt ? `last here ${when(p.seenAt)}` : 'has not been in yet'}</small></span>
          <span className="row">
            <input className="bday" defaultValue={users[p.id]?.birthday ?? ''} placeholder="MM-DD" maxLength={5} title="Birthday, as month-day. The house throws a party that day." aria-label={`${p.name}'s birthday`}
              onBlur={(e) => { const v = e.target.value.trim(); if (v !== (users[p.id]?.birthday ?? '')) setBirthday(p.id, v); }} />
            {p.id !== me.id && <SureButton onSure={() => void api('/admin/role', { userId: p.id, role: p.role === 'admin' ? 'member' : 'admin' }).then(load).catch(fail)}>{p.role === 'admin' ? 'Not an admin' : 'Make admin'}</SureButton>}
            <SureButton ask="Sure? It signs them out" onSure={() => void api('/admin/password', { userId: p.id }).then(setFresh).catch(fail)}>New password</SureButton>
            {p.id !== me.id && <SureButton className="danger" ask="Sure? They are out" onSure={() => void api('/admin/remove', { userId: p.id }).then(load).catch(fail)}>Remove</SureButton>}
          </span>
        </div>
      ))}
      {fresh && <CopyBox value={fresh.password} note={`${fresh.name}'s new password. Send it to them; it is only shown now. They can change it under Account.`} />}
      {used.length > 0 && <p className="hint">Joined with an invite: {used.map((i) => `${users[i.usedBy ?? '']?.name ?? 'someone'}${i.label ? ` (${i.label})` : ''}`).join(', ')}.</p>}
      <p className="hint">Removing somebody signs them out and keeps them out. What they wrote in chat stays.</p>
    </>
  );
}

/** What the place is called, its keys, its weather and clock, and the picture on the wall. */
function Place({ cfg, reload }: { cfg: Config; reload: () => void }) {
  const settings = useStore((s) => s.settings);
  const [name, setName] = useState(settings.serverName);
  const [gifKey, setGifKey] = useState(cfg.giphyKey);
  const [ytKey, setYtKey] = useState('');
  const [q, setQ] = useState('');
  const [towns, setTowns] = useState<Town[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [tzDraft, setTzDraft] = useState(cfg.tz);
  const save = (patch: Record<string, unknown>, said = 'Saved.') => api('/admin/settings', patch).then(() => { toast(said); reload(); }).catch(fail);
  const find = async () => {
    if (q.trim().length < 2) return;
    try { setTowns((await api<{ towns: Town[] }>(`/admin/towns?q=${encodeURIComponent(q.trim())}`)).towns); } catch (e) { fail(e); }
  };
  const hang = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    let hung = 0;
    for (const file of files) {
      if (file.size > PHOTO_MAX) { fail(new Error(`${file.name} is too big. The limit is ${PHOTO_MAX / 1048576} MB.`)); continue; }
      try { const f = await upload(file, 'photo'); await api('/admin/settings', { wallAdd: f.id }); hung++; } catch (e) { fail(e); }
    }
    if (hung) { toast(hung === 1 ? 'It is on the wall.' : `${hung} photos are on the wall.`); reload(); }
    setBusy(false);
  };
  const wallPhotos = cfg.wall ?? [];

  return (
    <>
      <h3>This place</h3>
      <label className="hotkey wide">Its name
        <input maxLength={40} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => { if (name.trim() && name.trim() !== settings.serverName) void save({ serverName: name }); }} />
      </label>

      <h3>Photos on the lounge wall</h3>
      <p className="hint">The wall has five frames: the big gold one and four small ones beside it. Each shows one of these photos,
        cut to the frame's shape from the middle, and they change every day at midnight on the house's clock. Frames without a photo keep
        their paintings. Clicking a photo in the room shows it whole. PNG, JPG or WebP, up to {PHOTO_MAX / 1048576} MB each; group photos
        wider than they are tall suit the big frame.</p>
      {wallPhotos.length > 0 && <div className="wall-thumbs">{wallPhotos.map((w) => (
        <figure key={w.id}><img className="photo-thumb" src={w.url} alt="" />
          <SureButton onSure={() => void save({ wallRemove: w.id }, 'Taken down.')}>Take down</SureButton></figure>))}</div>}
      <div className="row">
        <label className="btn">{busy ? 'Hanging them…' : wallPhotos.length ? 'Add photos' : 'Choose photos'}
          <input type="file" multiple accept="image/png,image/jpeg,image/webp" hidden disabled={busy || wallPhotos.length >= (cfg.wallMax ?? 60)} onChange={(e) => { void hang([...(e.target.files ?? [])]); e.target.value = ''; }} />
        </label>
        {wallPhotos.length > 1 && <SureButton onSure={() => void save({ wallClear: true }, 'All taken down.')}>Take them all down</SureButton>}
        <span className="hint">{wallPhotos.length ? `${wallPhotos.length} photo${wallPhotos.length > 1 ? 's' : ''}.` : 'No photos yet: the frames show their paintings.'}</span>
      </div>

      <h3>Weather and the clock</h3>
      <p className="hint">The yard and the windows show the real weather in one town, and the house keeps that town's time for everybody. It comes from Open-Meteo, which needs no key.</p>
      <p>{cfg.town ? <>The house is in <b>{cfg.town.name}</b>.</> : <>No town picked: fair skies.</>} The house's clock is on <b>{settings.tz}</b>{cfg.tz ? '' : cfg.envTz ? ' (CHATTERDAY_TZ in .env)' : " (the host PC's own)"}.</p>
      <div className="row">
        <input placeholder="Town or city" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void find(); }} />
        <button onClick={() => void find()}>Look it up</button>
        {cfg.town && <SureButton onSure={() => void save({ town: null, tz: '' }, 'No town now.')}>No town</SureButton>}
        <select value={cfg.unit} onChange={(e) => void save({ unit: e.target.value })} aria-label="Temperature in">
          <option value="F">Fahrenheit</option><option value="C">Celsius</option>
        </select>
      </div>
      {towns && (towns.length
        ? <div className="picks">{towns.map((t) => <button key={`${t.lat},${t.lon}`} onClick={() => { setTowns(null); setQ(''); void save({ town: t }, `The house is in ${t.name}.`); }}>{t.name}</button>)}</div>
        : <p className="hint">Nothing by that name. Try the nearest bigger town.</p>)}
      <p className="hint">The clock decides night and day in the yard, the holidays, birthdays and the times in the log. Picking a town sets it to that town's; set it here to keep another.</p>
      <div className="row">
        <input list="admin-tz" placeholder={cfg.envTz || cfg.hostTz} value={tzDraft} spellCheck={false} aria-label="Time zone" onChange={(e) => setTzDraft(e.target.value.trim())} />
        <datalist id="admin-tz">{ZONES.map((z) => <option key={z} value={z} />)}</datalist>
        <button disabled={!tzDraft || tzDraft === cfg.tz || !ZONES.includes(tzDraft)} onClick={() => void save({ tz: tzDraft }, `The clock is on ${tzDraft} now.`)}>Set the clock</button>
        {cfg.tz && <button onClick={() => { setTzDraft(''); void save({ tz: '' }, `The clock follows ${cfg.envTz ? '.env' : 'the host PC'} now.`); }}>Use {cfg.envTz || `the host PC's (${cfg.hostTz})`}</button>}
      </div>

      <h3>GIF search</h3>
      <p className="hint">The GIF button in chat searches Giphy, which needs a free key: make an account at developers.giphy.com, create an app (choose API), and paste its key here. Without one, people can still paste GIF links.</p>
      <label className="hotkey wide">Giphy API key
        <input placeholder={cfg.giphyFromEnv ? 'Set in the .env file (paste one here to override)' : 'Paste the key here'} value={gifKey} spellCheck={false} onChange={(e) => setGifKey(e.target.value.trim())} onBlur={() => { if (gifKey !== cfg.giphyKey) void save({ giphyKey: gifKey }); }} />
      </label>

      <h3>The Player's search</h3>
      <p className="hint">Without a key, people can still paste YouTube links into the Player. To search by name, it needs a YouTube Data API key of your own: free from the Google Cloud console (make a project, turn on YouTube Data API v3, create an API key). The free allowance is about 100 searches a day for the whole group. Using a key means agreeing to <a href="https://developers.google.com/youtube/terms/api-services-terms-of-service" target="_blank" rel="noreferrer">YouTube's API terms</a>.</p>
      <label className="hotkey wide">YouTube Data API key {cfg.youtubeKey ? '(one is saved)' : '(optional, for searching)'}
        <input placeholder={cfg.youtubeKey ? 'Paste a new key to replace it' : 'Paste the key here'} value={ytKey} spellCheck={false} onChange={(e) => setYtKey(e.target.value.trim())}
          onBlur={() => { if (ytKey) void save({ youtubeKey: ytKey }).then(() => setYtKey('')); }} />
      </label>
      {cfg.youtubeKey && <SureButton onSure={() => void save({ youtubeKey: '' }, 'Key removed.')}>Remove the YouTube key</SureButton>}
    </>
  );
}

/** The soundboard: add a lot of sounds in one go, and clear out the ones nobody wants. */
function Sounds() {
  const sounds = useStore((s) => s.sounds);
  const users = useStore((s) => s.users);
  const [progress, setProgress] = useState('');
  const add = async (files: FileList | null) => {
    const list = [...(files ?? [])];
    let done = 0, failed = 0;
    for (const file of list) {
      setProgress(`Adding ${done + failed + 1} of ${list.length}…`);
      try {
        const f = await upload(file, 'sound');
        await api('/sounds', { name: file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 24) || 'sound', emoji: 'note', fileId: f.id });
        done++;
      } catch { failed++; }
    }
    setProgress('');
    if (list.length) toast(failed ? `Added ${done}. ${failed} could not be added (not a sound, or over 3 MB).` : `Added ${done} sound${done === 1 ? '' : 's'}.`);
  };
  return (
    <>
      <h3>Soundboard</h3>
      <p className="hint">The soundboard belongs to the whole group: every sound is a button for everyone, and pressing one plays it for everybody in the voice chat. Anyone can add a sound from the soundboard itself; this is for adding a lot at once. Short clips work best (3 MB each at most: MP3, WAV, OGG, M4A, FLAC). Every clip is brought to the same loudness when it plays.</p>
      <div className="row">
        <label className="btn"><Icon name="plus" />{progress || 'Add sounds…'}
          <input type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac" multiple hidden disabled={!!progress} onChange={(e) => { void add(e.target.files); e.target.value = ''; }} />
        </label>
        <small>{sounds.length} on the board</small>
      </div>
      <p className="hint">You can also drop sound files into the <code>soundboard</code> folder next to the app on the host PC: each becomes a button within about 20 seconds.</p>
      {sounds.map((s) => (
        <div key={s.id} className="row spread">
          <span><b>{s.name}</b> <small>added by {s.userId === 'soundboard' ? 'the soundboard folder' : users[s.userId]?.name ?? 'someone'}</small></span>
          <SureButton onSure={() => void api(`/sounds/${s.id}`, undefined, 'DELETE').catch(fail)}>Delete</SureButton>
        </div>
      ))}
    </>
  );
}

/** How friends get in from outside the house: Tailscale, and the installer that sets it up for them. */
function Reach({ cfg, reload }: { cfg: Config; reload: () => void }) {
  const settings = useStore((s) => s.settings);
  const inst = cfg.installer;
  const [url, setUrl] = useState(inst.serverUrl || settings.publicUrl);
  const [publicUrl, setPublicUrl] = useState(settings.publicUrl);
  const timer = useRef(0);
  useEffect(() => {                      // while it builds, look again every few seconds
    if (!inst.building) return;
    timer.current = window.setInterval(reload, 4000);
    return () => window.clearInterval(timer.current);
  }, [inst.building]);
  const post = (body: Record<string, unknown>, said: string) => api('/admin/installer', body).then(() => { toast(said); reload(); }).catch(fail);
  const ip = inst.tailscaleIp || '100.x.y.z';
  // Friends get this PC shared with them (each on their own free Tailscale account), and these rules let them reach
  // only Chatterday's ports on it. Your own devices keep reaching everything, as before.
  const policy = JSON.stringify({
    hosts: { 'chatterday-host': ip },
    grants: [
      { src: ['autogroup:member'], dst: ['*'], ip: ['*'] },
      { src: ['autogroup:shared'], dst: ['chatterday-host'], ip: [`tcp:${inst.port}`, `tcp:${inst.mediaPorts[0]}`, `udp:${inst.mediaPorts[1]}`] },
    ],
  }, null, 2);

  return (
    <>
      <h3>How friends reach this PC</h3>
      <p className="hint">Chatterday is not on the open internet. Friends reach this PC over Tailscale, a free private network: nothing is opened on your router, and the server ignores anything that is not this PC or Tailscale. Do these once.</p>
      <ol className="steps">
        <li>Install <b>Tailscale</b> on this PC (tailscale.com/download) and sign in. Leave this PC untagged: Tailscale cannot share a tagged machine. {inst.tailscaleIp ? <small>Done: this PC is {inst.tailscaleIp}.</small> : <small>Not connected yet. The server notices within half a minute of Tailscale connecting.</small>}</li>
        <li>Once, from an <b>administrator</b> PowerShell in the app's folder, let Tailscale addresses (and only those) through the Windows firewall:
          <CopyBox value={'powershell -ExecutionPolicy Bypass -File scripts\\firewall.ps1'} />
        </li>
        <li>In the Tailscale admin console (login.tailscale.com/admin), under <b>Access controls</b>, use this policy (keep any rules of your own). Your own devices keep working as before; friends can reach only Chatterday on this PC, nothing else of yours.
          <textarea className="code" readOnly rows={8} value={policy} onFocus={(e) => e.target.select()} />
        </li>
        <li>For each friend: in the console, <b>Machines</b>, this PC's <b>⋯</b> menu, <b>Share</b>, and copy a link. Send it to them privately along with an invite. They install Tailscale themselves with their own free account (agreeing to Tailscale's terms themselves), then open the link and accept. You can take a share back from the same menu.</li>
      </ol>

      <h3>The address friends connect to</h3>
      <p className="hint">This PC's Tailscale name with the port, like <code>http://my-pc.tail1234.ts.net:{inst.port}</code> (<code>tailscale status</code> shows the name). Invite links and the installer use it.</p>
      <div className="row">
        <input value={publicUrl} spellCheck={false} placeholder={`http://my-pc.tailnet-name.ts.net:${inst.port}`} onChange={(e) => { setPublicUrl(e.target.value.trim()); setUrl(e.target.value.trim()); }} />
        <button onClick={() => void api('/admin/settings', { publicUrl }).then(() => post({ serverUrl: publicUrl }, 'Saved.')).catch(fail)}>Save</button>
      </div>

      <h3>The installer friends use</h3>
      <p className="hint">A Windows app with this server's address packed in. It does not include Tailscale: the first time a friend opens it, it walks them through installing Tailscale from Tailscale's own site and accepting your share link, then connects by itself. It is built here, on this PC, and takes a few minutes the first time.</p>
      <div className="row">
        <button className="primary" disabled={inst.building || !url} onClick={() => void post({ serverUrl: url, build: true }, 'Building. This takes a few minutes.')}>{inst.building ? 'Building…' : inst.built ? 'Build it again' : 'Build the installer'}</button>
        {inst.built && !inst.building && <a className="btn" href="/download/desktop">Download {inst.built.name}</a>}
      </div>
      {inst.built && <p className="hint">Built {when(inst.built.at)}. Friends who are already in get the newer version offered inside the app; a newcomer needs the file sent to them.</p>}
      {inst.failed && <p className="error">The build stopped. The end of its log:</p>}
      {(inst.building || inst.failed) && inst.log && <textarea className="code" readOnly rows={8} value={inst.log} />}
    </>
  );
}

export function Admin() {
  const [tab, setTab] = useState<'people' | 'place' | 'sounds' | 'reach'>('people');
  const [cfg, setCfg] = useState<Config | null>(null);
  const reload = () => { api<Config>('/admin/config').then(setCfg).catch(fail); };
  useEffect(reload, []);
  const tabs: [typeof tab, string][] = [['people', 'People and invites'], ['place', 'This place'], ['sounds', 'Soundboard'], ['reach', 'Getting friends connected']];
  return (
    <div className="pane admin">
      <div className="seg">{tabs.map(([id, label]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}</div>
      {tab === 'people' && <People />}
      {tab === 'place' && cfg && <Place cfg={cfg} reload={reload} />}
      {tab === 'sounds' && <Sounds />}
      {tab === 'reach' && cfg && <Reach cfg={cfg} reload={reload} />}
    </div>
  );
}
