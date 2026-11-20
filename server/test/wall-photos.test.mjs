// Wall photo tests: starts the real server against a throwaway data folder on free ports, claims it, makes a member,
// then checks that only the admin can upload photos for the lounge wall, that only photos of the allowed types and
// size get in, and that the day's picks reach everybody's settings and can be taken down again.
// Run: node --test server/test/wall-photos.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const BASE_DIR = path.join(process.env.SETUP_TEST_DATA || os.tmpdir(), `chatterday-wall-${Date.now()}`);
const DATA = path.join(BASE_DIR, 'data');
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

/** One request: a JSON body, or raw bytes (`raw`). */
function call(method, p, { body, raw, cookie } = {}) {
  const hh = `127.0.0.1:${PORT}`;
  const headers = { host: hh, origin: `http://${hh}` };
  if (cookie) headers.cookie = cookie;
  const data = raw ?? (body === undefined ? undefined : Buffer.from(JSON.stringify(body)));
  if (data) { headers['content-type'] = raw ? 'application/octet-stream' : 'application/json'; headers['content-length'] = data.length; }
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, method, path: p.startsWith('/files') ? p : '/api' + p, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(buf.toString('utf8')); } catch { /* not json */ }
        const sc = res.headers['set-cookie'];
        resolve({ status: res.statusCode, json, buf, cookie: sc ? sc[0].split(';')[0] : null });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// The smallest real files of each kind: their first bytes are what the server goes by.
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5d1e7a80000000049454e44ae426082', 'hex');
const JPEG = Buffer.concat([Buffer.from('ffd8ffe000104a46494600010100000100010000', 'hex'), Buffer.alloc(64, 0), Buffer.from('ffd9', 'hex')]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x1a, 0, 0, 0]), Buffer.from('WEBPVP8L'), Buffer.alloc(18, 0)]);
const GIF = Buffer.from('GIF89a' + '\x01\x00\x01\x00\x00\x00\x00;', 'latin1');

const up = (bytes, cookie, name = 'photo.png') => call('POST', `/upload?kind=photo&name=${encodeURIComponent(name)}`, { raw: bytes, cookie });
const uploads = () => fs.existsSync(path.join(DATA, 'uploads')) ? fs.readdirSync(path.join(DATA, 'uploads')) : [];

/** The settings a signed-in app is sent when it connects. */
function settingsOf(cookie) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { cookie, origin: `http://127.0.0.1:${PORT}` } });
    ws.on('message', (d) => { const m = JSON.parse(String(d)); if (m.t === 'ready') { ws.close(); resolve(m.settings); } });
    ws.on('error', reject);
  });
}

let adminCookie, memberCookie;

before(async () => {
  fs.mkdirSync(DATA, { recursive: true });
  fs.mkdirSync(INSTALLERS, { recursive: true });
  PORT = await pickPort(31000, 34900);
  LK_PORT = await pickPort(35000, 38900, 3);
  server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.ts')], {
    cwd: ROOT,
    env: { ...process.env, CHATTERDAY_DATA: DATA, PORT: String(PORT), CHATTERDAY_LK_PORT: String(LK_PORT), CHATTERDAY_INSTALLERS: INSTALLERS, CHATTERDAY_TZ: 'UTC' },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));
  const t0 = Date.now();
  while (!log.includes(`listening on http://127.0.0.1:${PORT}`)) {
    if (server.exitCode !== null || Date.now() - t0 > 20000) throw new Error('server did not start:\n' + log);
    await new Promise((r) => setTimeout(r, 100));
  }
  const setup = await call('POST', '/setup', { body: { name: 'Owner', password: 'admin-pass-123', serverName: 'Wall Test' } });
  assert.equal(setup.status, 200, JSON.stringify(setup.json));
  adminCookie = setup.cookie;
  const inv = await call('POST', '/invites', { cookie: adminCookie, body: { hours: 24 } });
  const joined = await call('POST', '/redeem', { body: { code: inv.json.code, name: 'Member', password: 'member-pass-123' } });
  assert.equal(joined.status, 200, JSON.stringify(joined.json));
  memberCookie = joined.cookie;
  console.log(`# server on ${PORT} (LiveKit ${LK_PORT}), data ${DATA}`);
});

after(() => {
  if (server && server.exitCode === null) {
    try { execFileSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { server.kill(); }
  }
  try { fs.rmSync(BASE_DIR, { recursive: true, force: true }); } catch { /* still held: the OS cleans temp */ }
});

test('a fresh wall has no photos: the frames keep their paintings', async () => {
  const settings = await settingsOf(memberCookie);
  assert.deepEqual(settings.wall, {});
  assert.equal(settings.photo, null);
});

test('a stranger cannot upload a wall photo', async () => {
  const r = await up(PNG, undefined);
  assert.equal(r.status, 401);
});

test('a member cannot upload a wall photo, and nothing of it is kept', async () => {
  const before = uploads().length;
  const r = await up(PNG, memberCookie);
  assert.equal(r.status, 403);
  assert.match(r.json.error, /admin/);
  assert.equal(uploads().length, before);
});

test('a member cannot hang, take down or clear wall photos', async () => {
  for (const body of [{ wallAdd: 'x' }, { wallRemove: 'x' }, { wallClear: true }, { photo: null }]) {
    const r = await call('POST', '/admin/settings', { cookie: memberCookie, body });
    assert.equal(r.status, 403, JSON.stringify(body));
  }
});

test('the admin cannot upload something that is not a photo, or a GIF', async () => {
  const before = uploads().length;
  for (const [bytes, name] of [[Buffer.from('<html>not a photo</html>'), 'evil.png'], [GIF, 'moving.gif'], [Buffer.from('ID3' + 'x'.repeat(40)), 'song.jpg']]) {
    const r = await up(bytes, adminCookie, name);
    assert.equal(r.status, 400, name);
    assert.match(r.json.error, /PNG, JPG or WebP/);
  }
  assert.equal(uploads().length, before);
});

test('the admin cannot upload a photo over the size limit', async () => {
  const big = Buffer.concat([PNG, Buffer.alloc(12 * 1024 * 1024 + 1)]);
  const r = await up(big, adminCookie, 'huge.png');
  assert.equal(r.status, 400);
  assert.match(r.json.error, /Too big/);
});

test('only an uploaded photo can be hung', async () => {
  const r = await call('POST', '/admin/settings', { cookie: adminCookie, body: { wallAdd: 'no-such-file' } });
  assert.equal(r.status, 400);
  // an ordinary chat attachment is not a wall photo either
  const att = await call('POST', '/upload?kind=attachment&name=a.png', { raw: PNG, cookie: memberCookie });
  assert.equal(att.status, 200);
  const r2 = await call('POST', '/admin/settings', { cookie: adminCookie, body: { wallAdd: att.json.id } });
  assert.equal(r2.status, 400);
});

const hung = [];
test('the admin uploads PNG, JPEG and WebP photos, and they go on the wall', async () => {
  for (const [bytes, name] of [[PNG, 'a.png'], [JPEG, 'b.jpg'], [WEBP, 'c.webp']]) {
    const r = await up(bytes, adminCookie, name);
    assert.equal(r.status, 200, `${name}: ${JSON.stringify(r.json)}`);
    assert.ok(fs.existsSync(path.join(DATA, 'uploads', r.json.id)), 'kept in the data folder');
    const s = await call('POST', '/admin/settings', { cookie: adminCookie, body: { wallAdd: r.json.id } });
    assert.equal(s.status, 200);
    hung.push(r.json.id);
  }
  const cfg = await call('GET', '/admin/config', { cookie: adminCookie });
  assert.deepEqual(cfg.json.wall.map((w) => w.id), hung);
});

test("everybody is sent today's photos: three photos fill the big frame and two small ones, all different", async () => {
  const settings = await settingsOf(memberCookie);
  const wall = settings.wall;
  assert.deepEqual(Object.keys(wall), ['poster', 'boat', 'peaks']);
  assert.equal(new Set(Object.values(wall)).size, 3);
  for (const url of Object.values(wall)) assert.ok(hung.includes(url.replace('/files/', '')), url);
  assert.equal(settings.photo, wall.poster);
  const file = await call('GET', wall.poster, { cookie: memberCookie });
  assert.equal(file.status, 200);
});

test('the frames move on by a day at a time (wallToday)', async () => {
  // (importing it opens a database: a scratch one of its own, never the real data folder)
  process.env.CHATTERDAY_DATA = path.join(BASE_DIR, 'import-data');
  fs.mkdirSync(process.env.CHATTERDAY_DATA, { recursive: true });
  const { wallToday } = await import(new URL('../wallphotos.ts', import.meta.url).href);
  const pool = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const day0 = wallToday(100, pool), day1 = wallToday(101, pool);
  assert.equal(Object.keys(day0).length, 5);
  assert.equal(new Set(Object.values(day0)).size, 5);
  assert.notDeepEqual(day0, day1);
});

test('a member cannot take a photo down; the admin can, and its file goes', async () => {
  const id = hung[1];
  await call('POST', '/admin/settings', { cookie: memberCookie, body: { wallRemove: id } });
  assert.equal((await call('GET', '/admin/config', { cookie: adminCookie })).json.wall.length, 3);
  const r = await call('POST', '/admin/settings', { cookie: adminCookie, body: { wallRemove: id } });
  assert.equal(r.status, 200);
  const cfg = await call('GET', '/admin/config', { cookie: adminCookie });
  assert.deepEqual(cfg.json.wall.map((w) => w.id), [hung[0], hung[2]]);
  assert.ok(!fs.existsSync(path.join(DATA, 'uploads', id)));
});

test('the admin can take them all down', async () => {
  const r = await call('POST', '/admin/settings', { cookie: adminCookie, body: { wallClear: true } });
  assert.equal(r.status, 200);
  assert.deepEqual((await settingsOf(memberCookie)).wall, {});
});
