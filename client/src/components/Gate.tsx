import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { native } from '../native';
import { boot } from '../store';
import { Logo } from './ui';

/** The demo opens with a name and password already in the address: #/login/<name>/<password>. */
const loginFromHash = () => {
  const m = /^#\/login\/([^/]+)\/([^/]+)$/.exec(location.hash);
  if (!m) return null;
  // (a "%" that is not the start of an escape cannot be decoded: such a link counts as no link at all, and the page
  // opens with empty fields. Left to throw, it took the whole sign-in page with it.)
  try { return { name: decodeURIComponent(m[1]), password: decodeURIComponent(m[2]) }; } catch { return null; }
};
/** An invite link ends in #/invite/<code>. Somebody may also paste the whole link, or just the code, into the box. */
const inviteFromHash = () => /^#\/invite\/([\w-]{8,40})$/.exec(location.hash)?.[1] ?? '';
const codeIn = (text: string) => /(?:#\/invite\/)?([\w-]{8,40})\s*$/.exec(text.trim())?.[1] ?? '';

type Hello = { serverName: string; needsSetup: boolean; local: boolean; port?: number };
const device = () => (native ? `Desktop app (${native.platform})` : 'Browser');

/** The door. Three ways through it: the first person sets the server up (on the PC it runs on) and becomes its
 *  admin; somebody with an invite link picks a name and a password; everyone else signs in. */
export function Gate() {
  const [hello, setHello] = useState<Hello | null>(null);
  const [mode, setMode] = useState<'signin' | 'invite'>(() => (inviteFromHash() ? 'invite' : 'signin'));
  const [name, setName] = useState(() => loginFromHash()?.name ?? '');
  const [password, setPassword] = useState(() => loginFromHash()?.password ?? '');
  const [again, setAgain] = useState('');
  const [serverName, setServerName] = useState('');
  const [invite, setInvite] = useState(inviteFromHash);
  const [inviteOk, setInviteOk] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { api<Hello>('/hello').then(setHello).catch(() => setHello({ serverName: 'Chatterday', needsSetup: false, local: false })); }, []);

  // is the invite in the box still good?
  useEffect(() => {
    const code = codeIn(invite);
    if (mode !== 'invite' || !code) { setInviteOk(null); return; }
    let stale = false;
    const t = window.setTimeout(() => api<{ valid: boolean }>(`/invite-info?code=${encodeURIComponent(code)}`).then((r) => { if (!stale) setInviteOk(r.valid); }).catch(() => {}), 250);
    return () => { stale = true; window.clearTimeout(t); };
  }, [invite, mode]);

  const going = useRef(false);        // (a ref: Enter twice before the redraw that disables the button would sign in twice)
  async function go(path: string, body: Record<string, unknown>) {
    if (going.current) return;
    going.current = true;
    setBusy(true);
    setError('');
    try {
      await api(path, { ...body, device: device() });
      history.replaceState(null, '', location.pathname);
      await boot();
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    } finally { going.current = false; }
  }
  useEffect(() => {
    const use = () => {
      const given = loginFromHash();
      if (given) { setName(given.name); setPassword(given.password); void go('/login', given); }
      const code = inviteFromHash();
      if (code) { setInvite(code); setMode('invite'); }
    };
    use();
    window.addEventListener('hashchange', use);
    return () => window.removeEventListener('hashchange', use);
  }, []);

  if (!hello) return <div className="gate"><div className="gate-card"><Logo size={56} /><p>Knocking on the door…</p></div></div>;

  const card = (title: string, lead: string, fields: React.ReactNode, ready: boolean, label: string, act: () => void, foot?: React.ReactNode) => (
    <div className="gate">
      <div className="gate-card" onKeyDown={(e) => { if (e.key === 'Enter' && ready && !busy) act(); }}>
        <Logo size={56} />
        <h1>{title}</h1>
        {lead && <p className="hint">{lead}</p>}
        {fields}
        <button className="primary" disabled={!ready || busy} onClick={act}>{busy ? 'One moment…' : label}</button>
        {error && <p className="error">{error}</p>}
        {foot}
      </div>
    </div>
  );
  const nameField = <label>Your name<input autoFocus maxLength={24} autoComplete="username" value={name} onChange={(e) => setName(e.target.value)} /></label>;
  const newPassword = (
    <>
      <label>Pick a password<input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      <label>The same password again<input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} /></label>
    </>
  );
  const passwordsFine = password.length >= 8 && password === again;
  const passwordNote = password && password.length < 8 ? 'At least 8 characters.' : again && password !== again ? 'Those two do not match yet.' : '';

  // ── a brand-new server: whoever is at the PC it runs on makes the first account ──
  if (hello.needsSetup) {
    if (!hello.local) return card('Chatterday', `This server is new and has not been set up yet. That is done on the PC it runs on: open http://127.0.0.1:${hello.port ?? 4477} there.`, null, false, 'Not here', () => {});
    return card('Welcome to Chatterday', 'This is a new server. You are setting it up, so you will be its admin: the one who invites people and looks after the settings.', (
      <>
        <label>What should this place be called?<input maxLength={40} placeholder="Chatterday" value={serverName} onChange={(e) => setServerName(e.target.value)} /></label>
        {nameField}
        {newPassword}
        {passwordNote && <p className="hint">{passwordNote}</p>}
      </>
    ), name.trim().length >= 2 && passwordsFine, 'Set it up', () => void go('/setup', { name, password, serverName }));
  }

  // ── somebody new, with an invite ──
  if (mode === 'invite') {
    return card(`Join ${hello.serverName}`, 'Pick the name people will see and a password. Then you get to make your character.', (
      <>
        <label>Invite<input placeholder="Paste the invite link or code" value={invite} spellCheck={false} onChange={(e) => setInvite(e.target.value)} /></label>
        {inviteOk === false && <p className="error">That invite is used up or has expired. Ask for a new one.</p>}
        {nameField}
        {newPassword}
        {passwordNote && <p className="hint">{passwordNote}</p>}
      </>
    ), !!codeIn(invite) && inviteOk !== false && name.trim().length >= 2 && passwordsFine, 'Come in', () => void go('/redeem', { code: codeIn(invite), name, password }),
      <p className="hint">Already have an account? <button className="link" onClick={() => { setMode('signin'); setError(''); }}>Sign in</button></p>);
  }

  // ── everyone else ──
  return card(hello.serverName, '', (
    <>
      <label>Name<input autoFocus maxLength={24} autoComplete="username" value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
    </>
  ), name.trim() !== '' && password !== '', 'Sign in', () => void go('/login', { name, password }), (
    <>
      <p className="hint">New here? <button className="link" onClick={() => { setMode('invite'); setError(''); setPassword(''); }}>I have an invite</button></p>
      {!native && <p className="hint">The desktop app shows what you are up to and can share sound: <a href="/download/desktop">download it</a>.</p>}
    </>
  ));
}
