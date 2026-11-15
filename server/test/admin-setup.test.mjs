// Host / admin setup tests: starts the real server against a throwaway data folder on free ports, then walks the
// first-run flow (claiming the admin account), the admin-only routes, and checks that members and strangers are
// turned away. It also runs the locked-out-admin CLI (server/accounts.ts) and the invite CLI against the same data.
// Run: node --test server/test/admin-setup.test.mjs
// Set SETUP_TEST_DATA to choose where the throwaway data goes (default: the OS temp folder).
// Tests marked "todo" record known weaknesses: they run and report, but do not fail the suite.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const BASE_DIR = path.join(process.env.SETUP_TEST_DATA || os.tmpdir(), `chatterday-setup-${Date.now()}`);
const DATA = path.join(BASE_DIR, 'data');
const EMPTY_DATA = path.join(BASE_DIR, 'empty-data');
const INSTALLERS = path.join(BASE_DIR, 'installers');

const free = (port) => new Promise((resolve) => {
  const s = net.createServer().once('error', () => resolve(false)).once('listening', () => s.close(() => resolve(true)));
  s.listen(port, '127.0.0.1');
});
async function pickPort(lo, hi, run = 1) {
  for (let i = 0; i < 200; i++) {
    const p = lo + Math.floor(Math.random() * (hi - lo));
    let ok = true;
    for (let k = 0; k < run && ok; k++) ok = await free(p + k);
    if (ok) return p;
  }
  throw new Error('no free port');
}

let PORT, LK_PORT, server, log = '';
/** This PC's Tailscale address, if it has one: requests to it arrive from a non-loopback address. */
const TS_IP = Object.values(os.networkInterfaces()).flat().find((a) => a && a.family === 'IPv4' && !a.internal && /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a.address))?.address;

/** One HTTP request with full control of Host and Origin. */
function call(method, p, { body, cookie, host = '127.0.0.1', hostHeader, origin = 'same', extra = {} } = {}) {
  const hh = hostHeader ?? `${host}:${PORT}`;
  const headers = { host: hh, ...extra };
  if (origin === 'same') headers.origin = `http://${hh}`;
  else if (origin) headers.origin = origin;
  if (cookie) headers.cookie = cookie;
  const data = body === undefined ? undefined : JSON.stringify(body);
  if (data) { headers['content-type'] = 'application/json'; headers['content-length'] = Buffer.byteLength(data); }
  return new Promise((resolve, reject) => {
    const req = http.request({ host, port: PORT, method, path: p.startsWith('/') && !p.startsWith('/api') && !p.startsWith('/local') ? '/api' + p : p, headers }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(text); } catch { /* not json */ }
        const sc = res.headers['set-cookie'];
        resolve({ status: res.statusCode, json, text, cookie: sc ? sc[0].split(';')[0] : null, setCookie: sc?.[0] ?? '' });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const node = (script, args, data = DATA) => execFileSync(process.execPath, [path.join(ROOT, 'server', script), ...args], {
  cwd: ROOT, env: { ...process.env, CHATTERDAY_DATA: data, PORT: String(PORT), CHATTERDAY_LK_PORT: String(LK_PORT) }, encoding: 'utf8', windowsHide: true,
});

let adminCookie, adminName, memberCookie, memberId;
const ADMIN_PASS = 'admin-pass-123', MEMBER_PASS = 'member-pass-123';

before(async () => {
  fs.mkdirSync(DATA, { recursive: true });
  fs.mkdirSync(INSTALLERS, { recursive: true });
  PORT = await pickPort(31000, 34900);
  LK_PORT = await pickPort(35000, 38900, 3);
  server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.ts')], {
    cwd: ROOT,
    env: { ...process.env, CHATTERDAY_DATA: DATA, PORT: String(PORT), CHATTERDAY_LK_PORT: String(LK_PORT), CHATTERDAY_INSTALLERS: INSTALLERS },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));
  const t0 = Date.now();
  while (!log.includes(`127.0.0.1:${PORT}`)) {
    if (server.exitCode !== null || Date.now() - t0 > 20000) throw new Error('server did not start:\n' + log);
    await new Promise((r) => setTimeout(r, 100));
  }
  console.log(`# server on ${PORT} (LiveKit ${LK_PORT}), data ${DATA}, tailscale ${TS_IP ?? 'none'}`);
});

after(() => {
  if (server && server.exitCode === null) {
    try { execFileSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { server.kill(); }
  }
  console.log('# server log:\n' + log.split('\n').map((l) => '#   ' + l).join('\n'));
});

// ── before anyone has an account ──

test('fresh server: /hello says it needs setup, and that this visitor is local', async () => {
  const r = await call('GET', '/hello');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { serverName: 'Chatterday', needsSetup: true, local: true, port: PORT });
});

test('fresh server: the data folder gets its own LiveKit secrets', () => {
  const s = JSON.parse(fs.readFileSync(path.join(DATA, 'secrets.json'), 'utf8'));
  assert.match(s.livekitKey, /^cd[0-9a-f]{12}$/);
  assert.ok(s.livekitSecret.length >= 40);
});

test('/local/status answers from this PC', async () => {
  const r = await call('GET', '/local/status');
  assert.equal(r.status, 200);
  assert.equal(r.json.online, 0);
  assert.equal(r.json.inVoice, 0);
});

test('admin routes need a sign-in before setup too', async () => {
  for (const [m, p] of [['GET', '/admin/people'], ['GET', '/admin/config'], ['POST', '/invites']]) {
    const r = await call(m, p, { body: m === 'POST' ? {} : undefined });
    assert.equal(r.status, 401, `${m} ${p}`);
  }
});

test('setup is refused from another site (wrong Origin)', async () => {
  const r = await call('POST', '/setup', { body: { name: 'Evil', password: 'evil-pass-123' }, origin: 'http://evil.example' });
  assert.equal(r.status, 403);
});

test('setup is refused with no Origin header', async () => {
  const r = await call('POST', '/setup', { body: { name: 'Evil', password: 'evil-pass-123' }, origin: null });
  assert.equal(r.status, 403);
});

test('setup is refused from a non-loopback address (this PC\'s Tailscale IP)', { skip: !TS_IP && 'no Tailscale address on this PC' }, async () => {
  const hello = await call('GET', '/hello', { host: TS_IP });
  assert.equal(hello.json.local, false);
  const r = await call('POST', '/setup', { host: TS_IP, body: { name: 'Remote', password: 'remote-pass-123' } });
  assert.equal(r.status, 403);
  assert.equal(r.json.error, 'Set the server up from the PC it runs on.');
  const st = await call('GET', '/local/status', { host: TS_IP });
  assert.equal(st.json, null, '/local/status must not answer remote callers with JSON');
});

test('setup checks the name and password', async () => {
  let r = await call('POST', '/setup', { body: { name: 'A', password: 'long-enough-1' } });
  assert.equal(r.status, 400);
  r = await call('POST', '/setup', { body: { name: 'Admin', password: 'short' } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /8 characters/);
  assert.equal((await call('GET', '/hello')).json.needsSetup, true, 'nothing was made');
});

test('setup refuses a foreign Host header from loopback (DNS rebinding)', async () => {
  // A weak password, so getting past the guards would show as the password error (400) and no account is made.
  const r = await call('POST', '/setup', { hostHeader: `rebind.example:${PORT}`, body: { name: 'Rebind', password: 'x' } });
  assert.equal(r.status, 403, `got ${r.status}: ${JSON.stringify(r.json)}`);
  assert.equal((await call('GET', '/hello', { hostHeader: `rebind.example:${PORT}` })).json.local, false);
  const st = await call('GET', '/local/status', { hostHeader: `rebind.example:${PORT}` });
  assert.equal(st.json, null, '/local/status must not answer a rebinding page');
});

test('setup refuses requests passed on by a proxy on this PC (tailscale serve)', async () => {
  for (const extra of [{ 'x-forwarded-for': '100.101.102.103' }, { 'tailscale-user-login': 'someone@example.com' }, { forwarded: 'for=100.1.2.3' }]) {
    const r = await call('POST', '/setup', { extra, body: { name: 'Proxied', password: 'x' } });
    assert.equal(r.status, 403, `${JSON.stringify(extra)} -> ${r.status}`);
  }
  assert.equal((await call('GET', '/hello')).json.needsSetup, true, 'nothing was made');
});

// (userCount() is checked before the body is awaited, so in theory two could both pass; this checks it does not happen in practice)
test('only one of two setups sent at the same moment succeeds', async () => {
  const [a, b] = await Promise.all([
    call('POST', '/setup', { body: { name: 'Owner', password: ADMIN_PASS, serverName: 'Test Place' } }),
    call('POST', '/setup', { body: { name: 'Racer', password: ADMIN_PASS } }),
  ]);
  const won = [a, b].filter((r) => r.status === 200);
  console.log(`# race: statuses ${a.status} / ${b.status}`);
  adminCookie = (a.status === 200 ? a : b).cookie;
  adminName = a.status === 200 ? 'Owner' : 'Racer';
  assert.equal(won.length, 1, `${won.length} setups succeeded`);
});

// ── after setup ──

test('setup signed the admin in with a hardened cookie', async () => {
  assert.ok(adminCookie, 'a session cookie was set');
  const me = await call('GET', '/me', { cookie: adminCookie });
  assert.equal(me.status, 200);
  assert.equal(me.json.me.role, 'admin');
});

test('setup cannot be run a second time', async () => {
  const r = await call('POST', '/setup', { body: { name: 'Second', password: 'second-pass-123' } });
  assert.equal(r.status, 400);
  assert.equal(r.json.error, 'This server has already been set up.');
  assert.equal((await call('GET', '/hello')).json.needsSetup, false);
});

test('the admin can sign in with the password from setup; a wrong one is refused', async () => {
  const ok = await call('POST', '/login', { body: { name: adminName, password: ADMIN_PASS } });
  assert.equal(ok.status, 200);
  assert.match(ok.setCookie, /HttpOnly/);
  assert.match(ok.setCookie, /SameSite=Strict/);
  const bad = await call('POST', '/login', { body: { name: adminName, password: 'wrong-password' } });
  assert.equal(bad.status, 401);
});

test('admin routes work for the admin', async () => {
  const people = await call('GET', '/admin/people', { cookie: adminCookie });
  assert.equal(people.status, 200);
  assert.ok(people.json.people.some((p) => p.name === adminName && p.role === 'admin'));
  const cfg = await call('GET', '/admin/config', { cookie: adminCookie });
  assert.equal(cfg.status, 200);
  assert.equal(typeof cfg.json.youtubeKey, 'boolean', 'the YouTube key is never sent back, only whether there is one');
  const set = await call('POST', '/admin/settings', { cookie: adminCookie, body: { serverName: 'Renamed Place' } });
  assert.equal(set.status, 200);
  assert.equal((await call('GET', '/hello')).json.serverName, 'Renamed Place');
  const inv = await call('GET', '/admin/invites', { cookie: adminCookie });
  assert.equal(inv.status, 200);
});

test('a member joins through an admin-made invite', async () => {
  const made = await call('POST', '/invites', { cookie: adminCookie, body: { hours: 24, label: 'member' } });
  assert.equal(made.status, 200);
  const r = await call('POST', '/redeem', { body: { code: made.json.code, name: 'Member', password: MEMBER_PASS } });
  assert.equal(r.status, 200);
  memberCookie = r.cookie;
  const me = await call('GET', '/me', { cookie: memberCookie });
  assert.equal(me.json.me.role, 'member');
  memberId = me.json.me.id;
});

const ADMIN_ROUTES = [
  ['POST', '/invites', { hours: 24, role: 'admin' }],
  ['GET', '/admin/invites'],
  ['DELETE', '/admin/invites/0123456789abcdef'],
  ['POST', '/admin/password', { userId: 'x' }],
  ['POST', '/admin/role', { userId: 'x', role: 'admin' }],
  ['POST', '/admin/birthday', { userId: 'x', birthday: '01-01' }],
  ['GET', '/admin/people'],
  ['POST', '/admin/remove', { userId: 'x' }],
  ['GET', '/admin/config'],
  ['POST', '/admin/settings', { serverName: 'Hijacked' }],
  ['GET', '/admin/towns?q=London'],
  ['POST', '/admin/installer', {}],            // (empty: nothing would be written even if it got through)
  ['POST', '/channels', {}],
];

test('every admin route refuses a member (403)', async () => {
  const got = [];
  for (const [m, p, body] of ADMIN_ROUTES) {
    const r = await call(m, p, { cookie: memberCookie, body });
    got.push(`${m} ${p} -> ${r.status}`);
    assert.equal(r.status, 403, `${m} ${p}`);
    assert.equal(r.json.error, 'Only the admin can do that.');
  }
  console.log('# member: ' + got.join(', '));
  assert.equal((await call('GET', '/hello')).json.serverName, 'Renamed Place', 'settings unchanged');
});

test('every admin route refuses a stranger (401)', async () => {
  for (const [m, p, body] of ADMIN_ROUTES) {
    const r = await call(m, p, { body });
    assert.equal(r.status, 401, `${m} ${p}`);
  }
});

test('a forged or stale cookie gets nothing', async () => {
  const r = await call('GET', '/admin/people', { cookie: 'cd_session=' + 'A'.repeat(43) });
  assert.equal(r.status, 401);
});

test('a member cannot promote themselves through /profile', async () => {
  await call('POST', '/profile', { cookie: memberCookie, body: { role: 'admin' } });
  const me = await call('GET', '/me', { cookie: memberCookie });
  assert.equal(me.json.me.role, 'member');
});

test('an admin request from another site is refused even with the admin cookie', async () => {
  const r = await call('POST', '/admin/settings', { cookie: adminCookie, body: { serverName: 'CSRF' }, origin: 'http://evil.example' });
  assert.equal(r.status, 403);
  assert.equal((await call('GET', '/hello')).json.serverName, 'Renamed Place');
});

test('the admin cannot change their own role; promoting a member works', async () => {
  const self = await call('GET', '/me', { cookie: adminCookie });
  const r = await call('POST', '/admin/role', { cookie: adminCookie, body: { userId: self.json.me.id, role: 'member' } });
  assert.equal(r.status, 400);
  const up = await call('POST', '/admin/role', { cookie: adminCookie, body: { userId: memberId, role: 'admin' } });
  assert.equal(up.status, 200);
  assert.equal((await call('GET', '/admin/people', { cookie: memberCookie })).status, 200, 'promoted member now gets admin routes');
  const down = await call('POST', '/admin/role', { cookie: adminCookie, body: { userId: memberId, role: 'member' } });
  assert.equal(down.status, 200);
  assert.equal((await call('GET', '/admin/people', { cookie: memberCookie })).status, 403, 'demoted again');
});

test('the admin cannot remove themselves', async () => {
  const self = await call('GET', '/me', { cookie: adminCookie });
  const r = await call('POST', '/admin/remove', { cookie: adminCookie, body: { userId: self.json.me.id } });
  assert.equal(r.status, 400);
});

// ── the host-PC command line ──

test('npm run invite on a server nobody has set up says to set it up first', () => {
  fs.mkdirSync(EMPTY_DATA, { recursive: true });
  const out = node('invite.ts', [], EMPTY_DATA);
  console.log('# ' + out.trim());
  assert.match(out, /Nobody has an account yet/);
});

test('npm run invite after setup prints a link', () => {
  const out = node('invite.ts', []);
  assert.match(out, /#\/invite\/[A-Za-z0-9_-]+/);
});

test('accounts.ts list / admin / reset (the locked-out admin route)', async () => {
  const list = node('accounts.ts', ['list']);
  console.log('# list: ' + list.trim().replace(/\r?\n/g, ' | '));
  assert.match(list, new RegExp(`${adminName}\\s+\\(admin\\)`));
  assert.match(node('accounts.ts', ['reset', 'Nobody']), /Nobody is called Nobody/);
  const reset = node('accounts.ts', ['reset', adminName]);
  const pass = /New password for .+?: (\S+)/.exec(reset)?.[1];
  assert.ok(pass, reset);
  assert.equal((await call('GET', '/me', { cookie: adminCookie })).status, 401, 'old session ended');
  assert.equal((await call('POST', '/login', { body: { name: adminName, password: ADMIN_PASS } })).status, 401, 'old password gone');
  assert.equal((await call('POST', '/login', { body: { name: adminName, password: pass } })).status, 200, 'new password works');
  assert.match(node('accounts.ts', ['admin', 'Member']), /is now an admin/);
});
