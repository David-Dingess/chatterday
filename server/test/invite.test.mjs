// Invite system tests: runs the real server against a throwaway data folder and drives it over HTTP.
// Run: node --test server/test/invite.test.mjs
// Set INVITE_TEST_DATA to choose where the throwaway data goes (default: the OS temp folder).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const DATA = path.join(process.env.INVITE_TEST_DATA || os.tmpdir(), `chatterday-invite-${Date.now()}`);
const PORT = 40000 + Math.floor(Math.random() * 10000);
const LK_PORT = PORT + 20;
const BASE = `http://127.0.0.1:${PORT}`;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

let server, log = '';

async function call(method, p, { body, cookie, origin = BASE } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (origin) headers.origin = origin;
  if (cookie) headers.cookie = cookie;
  const res = await fetch(BASE + '/api' + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const setCookie = res.headers.get('set-cookie');
  let json = null;
  try { json = await res.json(); } catch { /* not json */ }
  return { status: res.status, json, cookie: setCookie ? setCookie.split(';')[0] : null };
}

let adminCookie, memberCookie;
const createInvite = async (opts = {}, cookie = adminCookie) => call('POST', '/invites', { body: opts, cookie });
const redeem = (code, name, password = 'password123') => call('POST', '/redeem', { body: { code, name, password } });

before(async () => {
  fs.mkdirSync(DATA, { recursive: true });
  server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.ts')], {
    cwd: ROOT,
    env: { ...process.env, CHATTERDAY_DATA: DATA, PORT: String(PORT), CHATTERDAY_LK_PORT: String(LK_PORT) },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));
  const t0 = Date.now();
  while (!log.includes(`127.0.0.1:${PORT}`)) {
    if (server.exitCode !== null || Date.now() - t0 > 20000) throw new Error('server did not start:\n' + log);
    await new Promise((r) => setTimeout(r, 100));
  }
  const s = await call('POST', '/setup', { body: { name: 'Admin', password: 'adminpass123' } });
  assert.equal(s.status, 200, JSON.stringify(s.json));
  adminCookie = s.cookie;
});

after(() => {
  if (server && server.exitCode === null) {
    try { execFileSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { server.kill(); }
  }
});

test('admin creates an invite: 96-bit random base64url code, default 72h expiry, only its hash stored', async () => {
  const r = await createInvite({ label: 'friend' });
  assert.equal(r.status, 200);
  assert.match(r.json.code, /^[A-Za-z0-9_-]{16}$/);
  const hours = (r.json.expiresAt - Date.now()) / 3600_000;
  assert.ok(hours > 71.9 && hours <= 72, `expiry ~72h, got ${hours}`);
  const db = new DatabaseSync(path.join(DATA, 'chatterday.db'), { readOnly: true });
  const row = db.prepare('SELECT * FROM invites WHERE hash = ?').get(sha(r.json.code));
  const raw = db.prepare('SELECT COUNT(*) AS n FROM invites WHERE hash = ?').get(r.json.code);
  db.close();
  assert.ok(row, 'hash row exists');
  assert.equal(row.role, 'member');
  assert.equal(raw.n, 0, 'plain code is not stored');
});

test('codes are unique across many creations', async () => {
  const codes = new Set();
  for (let i = 0; i < 25; i++) codes.add((await createInvite()).json.code);
  assert.equal(codes.size, 25);
});

test('expiry hours are whitelisted (24/72/168/720); anything else falls back to 72', async () => {
  for (const [asked, want] of [[24, 24], [168, 168], [720, 720], [5, 72], [99999, 72], ['abc', 72]]) {
    const r = await createInvite({ hours: asked });
    const hours = Math.round((r.json.expiresAt - Date.now()) / 3600_000);
    assert.equal(hours, want, `asked ${asked}`);
  }
});

test('invite-info reports valid / invalid codes', async () => {
  const { json: { code } } = await createInvite();
  assert.equal((await call('GET', `/invite-info?code=${code}`)).json.valid, true);
  assert.equal((await call('GET', '/invite-info?code=nope')).json.valid, false);
  assert.equal((await call('GET', '/invite-info')).json.valid, false);
});

test('redeeming creates a member, signs them in, and spends the invite (no reuse)', async () => {
  const { json: { code } } = await createInvite();
  const r = await redeem(code, 'Member1');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(r.cookie?.startsWith('cd_session='));
  memberCookie = r.cookie;
  const me = await call('GET', '/me', { cookie: memberCookie });
  assert.equal(me.json.me.role, 'member');
  assert.equal((await call('GET', `/invite-info?code=${code}`)).json.valid, false);
  const again = await redeem(code, 'Member1b');
  assert.equal(again.status, 400);
  assert.match(again.json.error, /used up or has expired/);
});

test('a bad name/password does not spend the invite', async () => {
  const { json: { code } } = await createInvite();
  assert.equal((await redeem(code, 'X')).status, 400);                    // name too short
  assert.equal((await redeem(code, 'Shorty', 'short')).status, 400);      // password too short
  assert.equal((await redeem(code, 'admin')).status, 400);                // name taken (case-insensitive)
  assert.equal((await call('GET', `/invite-info?code=${code}`)).json.valid, true);
  assert.equal((await redeem(code, 'Member2')).status, 200);
});

test('admin-role invite makes an admin', async () => {
  const { json: { code } } = await createInvite({ role: 'admin' });
  const r = await redeem(code, 'Admin2');
  assert.equal(r.status, 200);
  assert.equal((await call('GET', '/me', { cookie: r.cookie })).json.me.role, 'admin');
});

test('unknown role values fall back to member', async () => {
  const { json: { code } } = await createInvite({ role: 'superuser' });
  const r = await redeem(code, 'Member3');
  assert.equal((await call('GET', '/me', { cookie: r.cookie })).json.me.role, 'member');
});

test('expired invite is rejected', async () => {
  const { json: { code } } = await createInvite();
  const db = new DatabaseSync(path.join(DATA, 'chatterday.db'));
  db.exec('PRAGMA busy_timeout = 3000');
  db.prepare('UPDATE invites SET expires_at = ? WHERE hash = ?').run(Date.now() - 1000, sha(code));
  db.close();
  assert.equal((await call('GET', `/invite-info?code=${code}`)).json.valid, false);
  assert.equal((await redeem(code, 'Late')).status, 400);
});

test('admin can list and revoke an unused invite; revoked code no longer works', async () => {
  const { json: { code } } = await createInvite({ label: 'to revoke' });
  const id = sha(code).slice(0, 16);
  const list = await call('GET', '/admin/invites', { cookie: adminCookie });
  assert.equal(list.status, 200);
  assert.ok(list.json.invites.some((i) => i.id === id && i.label === 'to revoke'));
  assert.ok(!JSON.stringify(list.json).includes(code), 'listing never shows the code');
  assert.equal((await call('DELETE', `/admin/invites/${id}`, { cookie: adminCookie })).status, 200);
  assert.equal((await redeem(code, 'Revoked')).status, 400);
});

test('permissions: members and signed-out visitors cannot create, list or revoke invites', async () => {
  const { json: { code } } = await createInvite();
  const id = sha(code).slice(0, 16);
  assert.equal((await createInvite({}, memberCookie)).status, 403);
  assert.equal((await call('GET', '/admin/invites', { cookie: memberCookie })).status, 403);
  assert.equal((await call('DELETE', `/admin/invites/${id}`, { cookie: memberCookie })).status, 403);
  assert.equal((await createInvite({}, null)).status, 401);
  assert.equal((await call('GET', '/admin/invites')).status, 401);
  assert.equal((await call('DELETE', `/admin/invites/${id}`)).status, 401);
  assert.equal((await call('GET', `/invite-info?code=${code}`)).json.valid, true, 'still usable after failed revokes');
});

test('cross-origin POSTs are refused (CSRF guard)', async () => {
  assert.equal((await call('POST', '/invites', { body: {}, cookie: adminCookie, origin: 'https://evil.example' })).status, 403);
  assert.equal((await call('POST', '/invites', { body: {}, cookie: adminCookie, origin: null })).status, 403);
  const { json: { code } } = await createInvite();
  assert.equal((await call('POST', '/redeem', { body: { code, name: 'Csrf', password: 'password123' }, origin: 'https://evil.example' })).status, 403);
});

test('race: 10 simultaneous redeems of one code -> exactly one account', async () => {
  const { json: { code } } = await createInvite();
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => redeem(code, `Racer${i}`)));
  const ok = results.filter((r) => r.status === 200).length;
  assert.equal(ok, 1, `statuses: ${results.map((r) => r.status).join(',')}`);
  const db = new DatabaseSync(path.join(DATA, 'chatterday.db'), { readOnly: true });
  const n = db.prepare("SELECT COUNT(*) AS n FROM users WHERE name LIKE 'Racer%'").get().n;
  db.close();
  assert.equal(n, 1);
});

// Last, because it locks this address out of /redeem for five minutes.
test('rate limit: 12 bad codes from one address -> 429, but a valid code still works', async () => {
  const { json: { code } } = await createInvite();
  // Earlier tests already failed some redeems from this address (reuse, expired, revoked, race losers), and those
  // count too, so we may hit the limit before 12 fresh tries.
  const statuses = [];
  for (let i = 0; i < 13; i++) statuses.push((await redeem('bogus' + i, 'Guesser')).status);
  assert.ok(statuses.every((s) => s === 400 || s === 429), statuses.join(','));
  assert.equal(statuses.at(-1), 429, `limit reached: ${statuses.join(',')}`);
  assert.equal((await redeem('bogus-x', 'Guesser')).status, 429);
  assert.equal((await redeem(code, 'Legit')).status, 200, 'a friend with a real invite is not locked out by someone else\'s typos');
});
