// Shared helpers for the flood tests (see run.mjs). They talk only to the throwaway server on 127.0.0.1:4591, never the real one.
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
export const WebSocket = require('ws');
export const PORT = Number(process.env.FLOOD_PORT || 4591), HOST = '127.0.0.1', BASE = `http://${HOST}:${PORT}`;
/** The throwaway server's data folder and its log: run.mjs sets both; these are where it puts them by default. */
export const DATA = process.env.CHATTERDAY_DATA || path.join(os.tmpdir(), 'chatterday-flood-data');
export const LOG = process.env.FLOOD_LOG || path.join(os.tmpdir(), 'chatterday-flood.log');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The six people the throwaway server is given (server.mjs makes them when it starts): the first is its admin. */
export const PEOPLE = ['Robin', 'Sam', 'Kit', 'Juno', 'Mika', 'Pat'];
/** The password all six sign in with. run.mjs makes up a new one for each run and hands it to the server and the
 *  tests alike; this one is for a server started by hand (node scripts/flood/server.mjs). */
export const PASSWORD = process.env.FLOOD_PASSWORD || 'flood-test-password';

export async function req(method, p, { cookie, body, origin = BASE, headers = {}, rawBody } = {}) {
  const h = { ...headers };
  if (origin) h.Origin = origin;
  if (cookie) h.Cookie = cookie;
  let data = rawBody;
  if (body !== undefined) { data = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const r = await fetch(BASE + p, { method, headers: h, body: data, redirect: 'manual' });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, text, json, headers: r.headers };
}

const cookies = new Map();
export async function login(name) {
  if (cookies.has(name)) return cookies.get(name);
  const r = await fetch(BASE + '/api/login', { method: 'POST', headers: { Origin: BASE, 'Content-Type': 'application/json' }, body: JSON.stringify({ name, password: PASSWORD, device: 'flood' }) });
  if (r.status !== 200) throw new Error(`login ${name}: ${r.status} ${await r.text()}`);
  const c = /cd_session=[^;]+/.exec(r.headers.get('set-cookie'))[0];
  cookies.set(name, c);
  return c;
}

/** A signed-in socket. `msgs` collects everything received; `wait(pred, ms)` resolves with the first match (past or future) or null. */
export function ws(cookie, { origin = BASE, kind = 'web', keep = true } = {}) {
  return new Promise((resolve, reject) => {
    const sock = new WebSocket(`ws://${HOST}:${PORT}/ws?kind=${kind}`, { headers: { Cookie: cookie ?? '', ...(origin ? { Origin: origin } : {}) }, maxPayload: 64 * 1024 * 1024 });
    const msgs = [], waiters = [];
    const c = {
      sock, msgs, bytes: 0, count: 0, closed: null,
      send: (o) => { if (sock.readyState === 1) sock.send(typeof o === 'string' || Buffer.isBuffer(o) ? o : JSON.stringify(o)); },
      wait: (pred, ms = 3000) => new Promise((res) => {
        const had = msgs.find(pred);
        if (had) return res(had);
        const w = { pred, res };
        waiters.push(w);
        setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); res(null); } }, ms);
      }),
      close: () => sock.close(),
    };
    sock.on('message', (raw) => {
      c.bytes += raw.length; c.count++;
      let d; try { d = JSON.parse(raw.toString()); } catch { return; }
      if (keep) msgs.push(d);
      for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i].pred(d)) { waiters[i].res(d); waiters.splice(i, 1); }
      if (d.t === 'ready') { c.ready = d; resolve(c); }
    });
    sock.on('close', (code, why) => { c.closed = { code, why: why.toString() }; });
    sock.on('unexpected-response', (_rq, res) => reject(new Error('upgrade refused: ' + res.statusCode)));
    sock.on('error', (e) => { if (!c.ready) reject(e); });
  });
}

/** Raw bytes over TCP; gives back whatever came back (as text) until the server closes or `ms` passes. */
export function raw(data, ms = 2000) {
  return new Promise((resolve) => {
    const s = net.connect(PORT, HOST);
    let out = '';
    const done = () => { s.destroy(); resolve(out); };
    s.on('connect', () => s.write(data));
    s.on('data', (d) => { out += d.toString('latin1'); });
    s.on('close', done); s.on('error', done);
    setTimeout(done, ms);
  });
}

/** How long the server takes to answer a trivial request right now (ms), or -1 if it does not. */
export async function health(ms = 5000) {
  const t = performance.now();
  try {
    const r = await fetch(BASE + '/local/status', { signal: AbortSignal.timeout(ms) });
    await r.text();
    return r.ok ? Math.round(performance.now() - t) : -1;
  } catch { return -1; }
}

let pass = 0, fail = 0;
export const findings = [];
export function check(name, ok, detail = '') {
  if (ok) pass++; else { fail++; findings.push(`${name} ${detail}`); }
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? '  :: ' + detail : ''}`);
}
export const note = (name, detail) => console.log(`  --   ${name}  :: ${detail}`);
/** Prints the tally; gives back how many checks failed. */
export const summary = () => { console.log(`\n${pass} ok, ${fail} failed`); for (const f of findings) console.log('  FAILED: ' + f); return fail; };
