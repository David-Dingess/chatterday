// Floods and malformed traffic against the throwaway server (started by run.mjs). All of it, or the sections named:
//   node scripts/flood/flood.mjs chat multi conns frames fuzz board preview react http uploads slow looks login
// 'login' locks 127.0.0.1 out of signing in for five minutes, so it goes last. The answer times printed are measured
// from this same process: while it is itself busy sending (the thumbnail flood above all) they overstate the server's.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { BASE, DATA, HOST, LOG, PORT, check, health, login, note, raw, req, sleep, summary, ws } from './lib.mjs';
const shared = (f) => import(new URL('../../shared/' + f, import.meta.url).href);
const { cleanLook, randomLook } = await shared('look.ts'), { cleanPet, randomPet } = await shared('pet.ts'), { cleanDesk, randomDesk } = await shared('desk.ts');

const only = process.argv.slice(2);
const want = (name) => !only.length || only.includes(name);
const pid = Number(/LISTENING\s+(\d+)/.exec(execSync('netstat -ano -p tcp').toString().split('\n').find((l) => l.includes(`127.0.0.1:${PORT} `) && l.includes('LISTENING')) ?? '')?.[1]);
const memMB = () => { try { return Math.round(Number(execSync(`powershell -NoProfile -Command "(Get-Process -Id ${pid}).WorkingSet64"`).toString().trim()) / 1048576); } catch { return -1; } };
const logFile = LOG;
const logSize = () => fs.statSync(logFile).size;
const logSince = (from) => fs.readFileSync(logFile).subarray(from).toString();
/** Samples how long the server takes to answer while something else is going on. */
function watch() {
  const got = []; let on = true;
  (async () => { while (on) { got.push(await health(8000)); await sleep(100); } })();
  return () => { on = false; const ok = got.filter((x) => x >= 0); return { worst: Math.max(...ok, 0), dead: got.length - ok.length, n: got.length }; };
}
const lat = (w) => `answers while flooded: worst ${w.worst} ms over ${w.n} probes${w.dead ? `, ${w.dead} got NO answer` : ''}`;

const robin = await login('Robin'), sam = await login('Sam'), kit = await login('Kit'), juno = await login('Juno'), mika = await login('Mika'), pat = await login('Pat');
const R = await ws(robin);
const idOf = (name) => R.ready.users.find((u) => u.name === name).id;
const general = R.ready.channels.find((c) => c.kind === 'text').id;
const voiceCh = R.ready.channels.find((c) => c.kind === 'voice').id;
const count = async () => { let n = 0, before; for (;;) { const r = (await req('GET', `/api/messages?channel=${general}${before ? `&before=${before}` : ''}`, { cookie: robin })).json; n += r.messages.length; if (!r.more) return n; before = r.messages[0].id; } };
console.log(`server pid ${pid}, ${memMB()} MB at the start`);

if (want('chat')) {
  console.log('\n== chat flood: one connection, 20,000 messages as fast as they will go ==');
  const S = await ws(sam, { keep: false }), K = await ws(kit, { keep: false });
  const before = await count(), w = watch(), t = performance.now();
  for (let i = 0; i < 20_000; i++) S.send({ t: 'send', channelId: general, content: `flood ${i}` });
  await sleep(4000);
  const took = Math.round(performance.now() - t), after = await count(), r = w();
  note('stored', `${after - before} of 20,000 (limit is 120 per connection per 10 s)`);
  check('one connection cannot store more than its allowance', after - before <= 240, String(after - before));
  check('server kept answering', r.dead === 0 && r.worst < 2000, lat(r));
  note('a bystander received', `${K.count} messages, ${Math.round(K.bytes / 1024)} KB in ${took} ms`);
  S.close(); K.close();
  await sleep(10_500);
}

if (want('multi')) {
  console.log('\n== chat flood: the same person on 40 connections at once ==');
  const before = await count(), w = watch();
  const tried = await Promise.allSettled(Array.from({ length: 40 }, () => ws(sam, { keep: false })));
  const socks = tried.filter((x) => x.status === 'fulfilled').map((x) => x.value);
  check('one person is held to 12 connections', socks.length <= 12, socks.length + ' of 40 opened');
  for (const s of socks) for (let i = 0; i < 500; i++) s.send({ t: 'send', channelId: general, content: `multi ${i}` });
  await sleep(5000);
  const after = await count(), r = w();
  check('however many connections, one person stores one allowance', after - before <= 240, `${after - before} stored in ~5 s`);
  check('server kept answering', r.dead === 0 && r.worst < 3000, lat(r));
  for (const s of socks) s.close();
  await sleep(10_500);
}

if (want('conns')) {
  console.log('\n== connection flood: one person opening 1,500 sockets ==');
  const m0 = memMB(), w = watch(), t = performance.now();
  const socks = [];
  let refused = 0;
  for (let batch = 0; batch < 15; batch++) {
    const got = await Promise.allSettled(Array.from({ length: 100 }, () => ws(kit, { keep: false })));
    for (const g of got) if (g.status === 'fulfilled') socks.push(g.value); else refused++;
  }
  const took = Math.round(performance.now() - t), r = w(), m1 = memMB();
  note('opened', `${socks.length} (refused ${refused}) in ${took} ms; memory ${m0} -> ${m1} MB`);
  check('one person is held to 12 connections', socks.length <= 12, String(socks.length));
  note('each new arrival is told to everyone already on', `the last socket alone received ${socks.at(-1)?.count} messages; the first ${socks[0]?.count}`);
  check('server kept answering', r.dead === 0 && r.worst < 3000, lat(r));
  const w2 = watch(), t2 = performance.now();
  R.send({ t: 'send', channelId: general, content: 'one message to 1500 sockets' });
  await sleep(1500);
  const r2 = w2();
  note('one chat message with all of them connected', lat(r2));
  for (const s of socks) s.sock.terminate();
  await sleep(3000);
  const r3 = await health();
  check('server fine after they all vanish at once', r3 >= 0 && r3 < 1000, `${r3} ms, memory ${memMB()} MB`);
  void t2;
}

if (want('frames')) {
  console.log('\n== frames the server should refuse without falling over ==');
  const from = logSize();
  const tryFrame = async (name, send) => {
    const S = await ws(sam);
    try { send(S); } catch (e) { note(name, 'client refused to send: ' + e.message); }
    await sleep(400);
    const h = await health();
    check(`${name}`, h >= 0, `socket ${S.closed ? 'closed ' + S.closed.code : 'still open'}, server ${h} ms`);
    S.sock.terminate();
  };
  await tryFrame('a 300 KB frame (limit 256 KB)', (S) => S.send(JSON.stringify({ t: 'send', channelId: general, content: 'x'.repeat(300_000) })));
  await tryFrame('a 60 MB frame', (S) => S.send(Buffer.alloc(60 * 1024 * 1024, 0x61)));
  await tryFrame('binary rubbish', (S) => S.sock.send(crypto.randomBytes(5000), { binary: true }));
  await tryFrame('text that is not UTF-8', (S) => S.sock._socket.write(Buffer.from([0x81, 0x84, 0, 0, 0, 0, 0xff, 0xfe, 0xfd, 0xfc])));
  await tryFrame('a frame with a reserved opcode', (S) => S.sock._socket.write(Buffer.from([0x83, 0x80, 0, 0, 0, 0])));
  await tryFrame('an unmasked frame', (S) => S.sock._socket.write(Buffer.from([0x81, 0x02, 0x7b, 0x7d])));
  await tryFrame('a frame claiming 2^63 bytes', (S) => S.sock._socket.write(Buffer.from([0x81, 0xff, 0x7f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 1, 2, 3, 4])));
  await tryFrame('raw rubbish straight after the handshake', (S) => S.sock._socket.write(crypto.randomBytes(4096)));
  await tryFrame('JSON 200,000 brackets deep', (S) => S.send('['.repeat(200_000)));
  await tryFrame('JSON null / number / string / array', (S) => { for (const x of ['null', '7', '"send"', '[1,2]', 'true', '{}', '{"t":{}}', '{"t":["send"]}', '{"t":"__proto__"}', '{"t":"constructor"}']) S.send(x); });
  await tryFrame('10,000 pings and 10,000 pongs', (S) => { for (let i = 0; i < 10_000; i++) { S.sock.ping(); S.sock.pong(); } });
  await tryFrame('a huge compressed frame (zip bomb) if compression is offered', (S) => note('permessage-deflate negotiated', String(S.sock.extensions || '(none: the server does not offer it)')));
  const said = logSince(from);
  note('server log lines for these', String(said.split('\n').filter(Boolean).length));
  check('no crash written to the log', !/uncaught|unhandled/i.test(said));
}

if (want('fuzz')) {
  console.log('\n== every message type with nonsense in every field ==');
  const from = logSize();
  const msg = (await R.wait((x) => x.t === 'msg', 100)) ?? (R.send({ t: 'send', channelId: general, content: 'fuzz target' }), await R.wait((x) => x.t === 'msg' && x.message.content === 'fuzz target'));
  const mid = msg.message.id, soundId = R.ready.sounds.find((s) => !s.entranceFor)?.id;
  const users = R.ready.users.map((u) => u.id);
  const pool = [null, true, false, 0, -1, 1, 2, 1.5, 1e308, -1e308, 2 ** 53, 9e15, '', 'x', 'here', 'x'.repeat(5000), '🙂', '\u0000', '__proto__', 'constructor', 'toString', 'hasOwnProperty',
    [], [[]], {}, { a: 1 }, { length: 5 }, [1, 2, 3], ['a'], [null], Array(900).fill(0), Array(800).fill(199), { toString: 'x' }, { valueOf: 1 }, '1', '-0', 'NaN', 'Infinity', '0x10', '1e3',
    general, voiceCh, mid, soundId, users[0], users[1], 'add', 'play', 'list', 'skip', 'seek', 'pause', 'resume', 'remove', 'stop', 'bad', 'length', 'ended', 'line', 'fill', 'clear', 'undo',
    'pick', 'sit', 'stand', 'bot', 'start', 'move', 'replace', 'end', 'again', 'sync', 'hearts', 'spades', 'rummy', 'mahjong', 'chess', 'checkers', 'go', 'four', 'mancala',
    'dance', 'hug', 'pet', 'kick', 'maze', 'beer', 'gaming', 'living1', 'data:image/jpeg;base64,AAAA', 'dQw4w9WgXcQ', { a: 'play', card: 'QS' }, { a: 'resign' }, { a: 'pass', cards: ['2C', '3C', '4C'] }, { a: 'move', from: 52, to: 36 }, { a: 'drop', col: 3 }, { a: 'sow', pit: 2 }, { a: 'play', at: 40 }, { a: 'pass' }, { a: 'bid', n: 3 }, { a: 'draw' }, { a: 'discard', tile: 3 }, { size: 9 }];
  const fields = {
    send: ['channelId', 'content', 'attachments', 'nonce'], edit: ['id', 'content'], delete: ['id'], react: ['id', 'emoji'], typing: ['channelId'], activity: ['state', 'label'],
    place: ['place', 'x', 'y', 'seat'], drink: ['kind'], voice: ['channelId', 'muted', 'deafened', 'sharing', 'watching', 'big', 'again', 'sound'], act: ['kind', 'userId', 'pet'],
    kick: ['x', 'y'], toss: ['x', 'y', 'dx', 'dy'], arcade: ['game', 'score'], wave: ['userId'], music: ['op', 'id', 'q', 'videoId', 'title', 'seconds', 'to', 'live'], prefs: ['at', 'prefs'],
    game: ['op', 'kind', 'seat', 'm'], board: ['op', 'c', 'x', 'y', 's', 'pts', 'k'], sound: ['id'], stats: ['lines'], preview: ['data'],
  };
  const types = Object.keys(fields);
  let rnd = 12345; const rand = (n) => { rnd = (Math.imul(rnd, 1103515245) + 12345) >>> 0; return rnd % n; };
  const attach = [{ kind: 'file', id: 'nope' }, { kind: 'image', url: 'https://x/y.png', name: {} }, { kind: 'image', url: 'javascript:alert(1)' }, { kind: 'theme', theme: { a: 'b' } }, { kind: 'theme', theme: 'x'.repeat(5000) }, null, 7, { kind: 'link', url: 'javascript:alert(1)', title: 'x' }];
  let sent = 0;
  const w = watch();
  for (let round = 0; round < 60; round++) {
    if (round && round % 6 === 0) await sleep(10_300);      // each person's allowance is 120 per 10 s
    const cookie = [sam, robin, kit, juno, mika, pat][round % 6];
    const c = await ws(cookie, { keep: false });
    if (round % 3 === 0) c.send({ t: 'voice', channelId: voiceCh, sharing: round % 6 === 0 });      // some of it from "inside voice"
    for (let i = 0; i < 100; i++) {
      const t = types[rand(types.length)];
      const d = { t };
      for (const f of fields[t]) { const r = rand(10); if (r === 0) continue; d[f] = f === 'attachments' && r < 5 ? [attach[rand(attach.length)], attach[rand(attach.length)]] : pool[rand(pool.length)]; }
      if (t === 'music' && d.op === 'add') d.op = 'play';      // (no searching YouTube from a fuzzer)
      if (t === 'send' && typeof d.content === 'string' && /https?:/.test(d.content)) d.content = 'x';
      c.send(d); sent++;
    }
    await sleep(40);
    c.sock.terminate();
  }
  await sleep(1500);
  const r = w(), said = logSince(from);
  const errors = said.split('\n').filter((l) => /^\[(ws|games|http)\]/.test(l) && !/^\[ws\] \S+ (Max payload|Invalid)/.test(l));
  note('sent', `${sent} nonsense messages over 150 connections; ${lat(r)}`);
  check('server alive', (await health()) >= 0);
  check('nothing threw inside a handler', errors.length === 0, `${errors.length} error lines`);
  const kinds = new Map();
  for (const l of errors) { const k = l.slice(0, 110); kinds.set(k, (kinds.get(k) ?? 0) + 1); }
  for (const [k, n] of [...kinds].slice(0, 25)) console.log(`        ${n} x ${k}`);
  // print a few stack lines for each distinct error
  const stacks = said.split(/\n(?=\[(?:ws|games|http)\])/).filter((b) => /\n\s+at /.test(b));
  const seen = new Set();
  for (const b of stacks) { const key = b.split('\n').slice(0, 3).join('|'); if (seen.has(key)) continue; seen.add(key); console.log('        ---\n        ' + b.split('\n').slice(0, 6).join('\n        ')); if (seen.size >= 12) break; }
  check('no crash written to the log', !/uncaught|unhandled/i.test(said));
}

if (want('board')) {
  console.log('\n== whiteboard: the most expensive stroke allowed, 120 times ==');
  await sleep(10_300);
  const S = await ws(sam, { keep: false }), W = await ws(kit);
  const huge = []; for (let i = 0; i < 400; i++) huge.push(i % 2 ? 199 : 0, i % 2 ? 107 : 0);
  S.send({ t: 'board', op: 'line', c: 3, s: 12, pts: huge, k: 9999 });
  await sleep(500);
  check('a stroke of 11 million dots is refused', !W.msgs.some((x) => x.t === 'board'));
  const pts = []; for (let i = 0; i < 9; i++) pts.push(i % 2 ? 199 : 0, 50);      // 8 runs across the board with the fattest nib: 230,400 dots, just inside the limit
  const w = watch(), t = performance.now();
  for (let i = 0; i < 120; i++) S.send({ t: 'board', op: 'line', c: 1 + (i % 11), s: 12, pts, k: i });
  let h; do { await sleep(50); h = await health(20_000); } while (h < 0);
  await sleep(300);
  const r = w();
  note('120 full-size strokes', `${lat(r)}; first clean answer ${Math.round(performance.now() - t)} ms after sending`);
  check('whiteboard strokes cannot freeze the server for long', r.worst < 1500 && r.dead === 0, lat(r));
  check('strokes inside the limit still arrive', W.msgs.filter((x) => x.t === 'board' && x.op === 'line').length >= 100, String(W.msgs.filter((x) => x.t === 'board').length));
  S.close(); W.close();
  await sleep(10_500);
}

if (want('preview')) {
  console.log('\n== screen-share thumbnails: 120 KB each, as fast as allowed ==');
  const S = await ws(sam, { keep: false });
  const others = await Promise.all([kit, juno, robin].map((c) => ws(c, { keep: false })));
  S.send({ t: 'voice', channelId: voiceCh, sharing: true });
  const data = 'data:image/jpeg;base64,' + 'A'.repeat(119_900);
  const w = watch();
  for (let i = 0; i < 2000; i++) S.send({ t: 'preview', data });
  await sleep(4000);
  const r = w();
  note('each bystander was sent', `${Math.round(others[0].bytes / 1048576 * 10) / 10} MB in ~4 s from one sharer (${others[0].count} messages)`);
  check('server kept answering', r.dead === 0 && r.worst < 2000, lat(r));
  check('thumbnails are held to a few every 10 s', others[0].bytes < 1_000_000, `${others[0].bytes} bytes`);
  S.close(); for (const o of others) o.close();
  await sleep(10_500);
}

if (want('react')) {
  console.log('\n== reactions: one person, 115 different ones on one message ==');
  const S = await ws(sam);
  S.send({ t: 'send', channelId: general, content: 'react to me' });
  const m = await S.wait((x) => x.t === 'msg' && x.message.content === 'react to me');
  for (let i = 0; i < 115; i++) S.send({ t: 'react', id: m.message.id, emoji: 'r' + i });
  await sleep(1500);
  const last = S.msgs.filter((x) => x.t === 'msg_edit' && x.message.id === m.message.id).at(-1);
  const n = Object.keys(last?.message.reactions ?? {}).length;
  note('reactions kept on one message', `${n}; every one of them is re-sent to everybody on each change (${JSON.stringify(last).length} bytes a time)`);
  check('one person cannot pile unlimited reactions on a message', n <= 20, String(n));
  await sleep(10_300);
  S.send({ t: 'react', id: m.message.id, emoji: 'r0' }); S.send({ t: 'react', id: m.message.id, emoji: 'fresh' }); await sleep(400);
  const now = Object.keys(S.msgs.filter((x) => x.t === 'msg_edit' && x.message.id === m.message.id).at(-1).message.reactions);
  check('taking one off makes room for another', now.length === 20 && now.includes('fresh') && !now.includes('r0'), now.length + ' kinds');
  S.close();
  await sleep(10_500);
}

if (want('http')) {
  console.log('\n== HTTP floods ==');
  const burst = async (name, n, conc, fn) => {
    const w = watch(), t = performance.now(); let i = 0; const codes = {};
    await Promise.all(Array.from({ length: conc }, async () => { while (i < n) { i++; try { const s = await fn(); codes[s] = (codes[s] ?? 0) + 1; } catch (e) { codes[e.cause?.code ?? e.name] = (codes[e.cause?.code ?? e.name] ?? 0) + 1; } } }));
    const took = performance.now() - t, r = w();
    note(name, `${n} requests in ${Math.round(took)} ms (${Math.round(n / took * 1000)}/s) ${JSON.stringify(codes)}; ${lat(r)}`);
    return { codes, r };
  };
  await burst('GET /api/me, signed in', 5000, 100, async () => (await req('GET', '/api/me', { cookie: sam })).status);
  await burst('GET / (the page)', 5000, 100, async () => (await req('GET', '/')).status);
  await burst('GET /api/invite-info, signed out', 5000, 100, async () => (await req('GET', '/api/invite-info?code=' + crypto.randomBytes(12).toString('base64url'))).status);
  const red = await burst('POST /api/redeem with made-up codes, signed out', 5000, 100, async () => (await req('POST', '/api/redeem', { body: { code: crypto.randomBytes(12).toString('base64url'), name: 'Guesser', password: 'a-password-of-my-own' } })).status);
  check('guessing invite codes stops after 12 tries from one address', red.codes[400] === 12 && Object.keys(red.codes).every((c) => c === '400' || c === '429'), JSON.stringify(red.codes));
  await burst('POST /api/login with a 300 KB body', 300, 50, async () => (await req('POST', '/api/login', { body: { name: 'x'.repeat(300_000) } })).status);
  await burst('GET /api/messages (50 rows + reactions)', 3000, 100, async () => (await req('GET', `/api/messages?channel=${general}`, { cookie: sam })).status);
  await burst('GET /api/search, 80 wildcard-ish chars', 2000, 100, async () => (await req('GET', `/api/search?channel=${general}&q=${encodeURIComponent('flood 1'.repeat(11))}`, { cookie: sam })).status);
  await burst('socket upgrades, signed out', 3000, 100, async () => (await raw(`GET /ws HTTP/1.1\r\nHost: ${HOST}:${PORT}\r\nOrigin: ${BASE}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`, 3000)).slice(9, 12));
  check('server alive after HTTP floods', (await health()) >= 0, `memory ${memMB()} MB`);
}

if (want('uploads')) {
  console.log('\n== uploads cut off, and downloads abandoned ==');
  const dir = path.join(DATA, 'uploads'), before = fs.readdirSync(dir).length;
  await Promise.all(Array.from({ length: 200 }, () => new Promise((done) => {
    const s = net.connect(PORT, HOST, () => {
      s.write(`POST /api/upload?kind=attachment&name=cut.bin HTTP/1.1\r\nHost: ${HOST}:${PORT}\r\nOrigin: ${BASE}\r\nCookie: ${sam}\r\nContent-Length: 5000000\r\n\r\n`);
      s.write(Buffer.alloc(100_000, 1));
      setTimeout(() => { s.destroy(); done(); }, 200);
    });
    s.on('error', done);
  })));
  await sleep(1500);
  const after = fs.readdirSync(dir).length;
  check('200 uploads cut off part-way leave nothing behind', after === before, `${after - before} files left`);
  const big = await fetch(`${BASE}/api/upload?kind=attachment&name=big.bin`, { method: 'POST', headers: { Origin: BASE, Cookie: sam }, body: Buffer.alloc(8 * 1024 * 1024, 7) }).then((r) => r.json());
  await Promise.all(Array.from({ length: 400 }, () => new Promise((done) => {
    const s = net.connect(PORT, HOST, () => s.write(`GET ${big.url} HTTP/1.1\r\nHost: ${HOST}:${PORT}\r\nCookie: ${sam}\r\n\r\n`));
    s.once('data', () => { s.destroy(); done(); });
    s.on('error', done);
  })));
  await sleep(1000);
  const h = await health();
  check('400 downloads abandoned after the first bytes', h >= 0 && h < 1000, `${h} ms`);
  // the file can still be deleted => nothing holds it open
  let free = true; try { fs.renameSync(path.join(dir, big.id), path.join(dir, big.id + '.x')); fs.renameSync(path.join(dir, big.id + '.x'), path.join(dir, big.id)); } catch { free = false; }
  check('no file handle left open on it', free);
  const w = watch();
  const many = await Promise.all(Array.from({ length: 30 }, () => fetch(`${BASE}/api/upload?kind=attachment&name=p.bin`, { method: 'POST', headers: { Origin: BASE, Cookie: sam }, body: Buffer.alloc(8 * 1024 * 1024, 7) }).then((r) => r.status)));
  const r = w();
  note('30 uploads of 8 MB at once', `${many.filter((s) => s === 200).length} kept; ${lat(r)}; there is no quota on how much one person may upload in total`);
}

if (want('slow')) {
  console.log('\n== connections that say nothing, or never finish ==');
  const socks = [];
  const w = watch();
  for (let i = 0; i < 3000; i++) {
    const s = net.connect(PORT, HOST); s.on('error', () => {});
    if (i % 2) s.on('connect', () => s.write(`POST /api/login HTTP/1.1\r\nHost: ${HOST}:${PORT}\r\nOrigin: ${BASE}\r\nContent-Length: 1000\r\n\r\n{"name":`));
    else s.on('connect', () => s.write('GET / HTTP/1.1\r\nHost: x\r\nX-A: '));
    socks.push(s);
    if (i % 200 === 0) await sleep(20);
  }
  await sleep(3000);
  const r = w(), m = memMB();
  check('3,000 stalled connections do not stop real ones', r.dead === 0 && r.worst < 2000, `${lat(r)}; memory ${m} MB`);
  const S = await ws(sam).catch(() => null);
  check('a real person can still connect meanwhile', !!S);
  S?.close();
  for (const s of socks) s.destroy();
  await sleep(500);
}

if (want('looks')) {
  console.log('\n== characters: 300 different looks, pets and desks saved by one person at once, then 300 made of nonsense ==');
  const from = logSize();
  const K = await ws(kit, { keep: false });
  const canon = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
  const same = (a, b) => canon(a) === canon(b);
  const save = (body) => req('POST', '/api/profile', { cookie: sam, body });
  const tally = (got) => { const codes = {}; for (const g of got) codes[g.status] = (codes[g.status] ?? 0) + 1; return JSON.stringify(codes); };
  const mine = (me) => ({ look: me?.look, pet: me?.pet, desk: me?.desk });

  const sent = Array.from({ length: 300 }, (_, i) => ({ look: randomLook(1000 + i), pet: randomPet(1000 + i), desk: randomDesk(1000 + i) }));
  const w = watch(), t = performance.now();
  const got = await Promise.all(sent.map(save));
  const took = Math.round(performance.now() - t), r = w();
  note('300 characters', `${took} ms (${Math.round(took / 30) / 10} ms each); ${lat(r)}; each is told to everybody: a bystander was sent ${K.count} messages, ${Math.round(K.bytes / 1024)} KB`);
  check('every one of them was saved', got.every((g) => g.status === 200), tally(got));
  const wrong = got.findIndex((g, i) => !same(mine(g.json?.me), sent[i]));
  check('each answer carries the character that was sent, whole and unchanged', wrong < 0, wrong < 0 ? '' : `number ${wrong}: sent ${canon(sent[wrong])} got ${canon(mine(got[wrong].json?.me))}`.slice(0, 600));
  const end = mine((await req('GET', '/api/me', { cookie: sam })).json.me);
  check('what is kept at the end is one of them, not a mix of several', sent.some((s) => same(s, end)), canon(end).slice(0, 300));
  check('server kept answering', r.dead === 0 && r.worst < 2000, lat(r));

  // nonsense in every part: all of it is answered, and what is kept is what the lists in the shared folder make of it
  let rnd = 4242; const rand = (n) => { rnd = (Math.imul(rnd, 1103515245) + 12345) >>> 0; return (rnd >>> 8) % n; };
  const small = [null, true, false, 0, -1, 1.5, 1e308, '', 'x', 'red', '#12345', '#GGGGGG', '#ABCDEF', '#abcdef0', 'url(x)', '../../x', '<img src=x onerror=alert(1)>', '__proto__', 'constructor', [], [[]], {}, { length: 5 }, ['wings'],
    ['wings', 'wings', 'tail', 'cape', 'mask', 'tie', 'belt', 'nope', 7], 'cat', 'dog', 'tee', 'mug', 'none', 'medium', 'afro', 'wizard', 'B\u202eis\ncuit', JSON.parse('{"__proto__":{"kind":"cat","body":"slim"}}'), { kind: 'cat' }, { kind: 'dog', name: {} }];
  const big = ['x'.repeat(5000), Array(900).fill('wings'), Array(900).fill({ kind: 'cat' })];
  const any = () => small[rand(small.length)];
  const part = () => (rand(20) === 0 ? big[rand(big.length)] : rand(3) === 0 ? { kind: any(), style: any(), color: any(), pattern: any(), color2: any(), name: any() } : any());
  const junk = (real) => {
    if (rand(10) === 0) return part();
    const o = rand(2) ? { ...real } : {};
    for (const k of [...Object.keys(real), 'more', 'constructor']) if (rand(3) === 0) o[k] = part(); else if (rand(8) === 0) delete o[k];
    return o;
  };
  const odd = Array.from({ length: 300 }, (_, i) => ({ look: junk(randomLook(i)), pet: junk(randomPet(i)), desk: junk(randomDesk(i)) }));
  const w2 = watch();
  const back = [];
  for (let i = 0; i < odd.length; i += 50) back.push(...await Promise.all(odd.slice(i, i + 50).map(save)));
  const r2 = w2();
  check('every nonsense character was answered', back.every((g) => g.status === 200), tally(back));
  const asSent = (v) => JSON.parse(JSON.stringify(v));       // (as the server reads it: what JSON cannot carry is already gone)
  const bad = back.findIndex((g, i) => !same(mine(g.json?.me), { look: cleanLook(asSent(odd[i].look)), pet: cleanPet(asSent(odd[i].pet)), desk: cleanDesk(asSent(odd[i].desk)) }));
  check('what is kept of each is only what is on the lists', bad < 0, bad < 0 ? '' : `number ${bad}: sent ${JSON.stringify(odd[bad]).slice(0, 300)} got ${canon(mine(back[bad].json?.me)).slice(0, 300)}`);
  // (a pet's name is its owner's to choose, 16 characters of anything that can be seen: looked at apart from the rest)
  const names = back.map((g) => g.json?.me.pet?.name ?? '');
  const kept = back.map((g) => JSON.stringify(mine(g.json?.me), (k, x) => (k === 'name' ? '' : x)));
  check('and none of it is big, or carries any of the nonsense', kept.every((k) => k.length < 1500 && !/\.\.\/|url\(|<img|xxxx|more|constructor|__proto__/.test(k)) && names.every((n) => [...n].length <= 16 && !/[\u0000-\u001f\u202a-\u202e]/.test(n)),
    `longest ${Math.max(...kept.map((k) => k.length))} characters; pet names: ${JSON.stringify([...new Set(names)]).slice(0, 200)}`);
  note('pets among them', `${back.filter((g) => g.json?.me.pet).length} of 300 kept a pet (a pet that is neither a cat nor a dog is no pet)`);
  check('server kept answering', r2.dead === 0 && r2.worst < 2000, lat(r2));
  check('nothing threw while saving them', !/^\[http\]/m.test(logSince(from)) && !/uncaught|unhandled/i.test(logSince(from)));
  K.close();
}

if (want('login')) {
  console.log('\n== guessing passwords (run last: it locks this address out for five minutes) ==');
  const codes = {};
  const t = performance.now();
  for (let i = 0; i < 60; i++) { const r = await req('POST', '/api/login', { body: { name: 'Juno', password: 'wrong-' + i } }); codes[r.status] = (codes[r.status] ?? 0) + 1; }
  note('60 wrong passwords for one name', `${JSON.stringify(codes)} in ${Math.round(performance.now() - t)} ms`);
  check('guessing stops after 8 tries for a name', codes[401] === 8 && codes[429] === 52, JSON.stringify(codes));
  const codes2 = {};
  for (let i = 0; i < 80; i++) { const r = await req('POST', '/api/login', { body: { name: 'nobody' + i, password: 'x' } }); codes2[r.status] = (codes2[r.status] ?? 0) + 1; }
  check('and after 40 from one address, whatever the names', codes2[401] === 32 && codes2[429] === 48, JSON.stringify(codes2));
  const mixed = await req('POST', '/api/login', { body: { name: 'JUNO ', password: 'x' } });
  check('capitals and spaces do not get round it', mixed.status === 429, String(mixed.status));
  const R2 = await ws(robin).catch(() => null);
  check('people already signed in are not affected', !!R2);
  R2?.close();
}

console.log(`\nmemory at the end: ${memMB()} MB`);
R.close();
process.exit(summary() ? 1 : 0);
