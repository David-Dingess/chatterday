// Access control, path handling and input checks: who can reach what.
import fs from 'node:fs';
import path from 'node:path';
import { BASE, DATA, check, health, login, note, raw, req, sleep, summary, ws, PORT } from './lib.mjs';
const shared = (f) => import(new URL('../../shared/' + f, import.meta.url).href);
const { cleanLook } = await shared('look.ts'), { cleanPet } = await shared('pet.ts'), { cleanDesk } = await shared('desk.ts');

const robin = await login('Robin'), sam = await login('Sam'), kit = await login('Kit');
const R = await ws(robin), S = await ws(sam), K = await ws(kit);
const idOf = (name) => R.ready.users.find((u) => u.name === name).id;
const general = R.ready.channels.find((c) => c.kind === 'text').id;

console.log('\n== paths that should not leave the built UI ==');
const secret = /livekitSecret|scrypt|"dependencies"|GIPHY|SQLite format/;
for (const p of ['//', '/%', '/%00', '/..%2f..%2f.env', '/..%5c..%5c.env', '/%2e%2e/%2e%2e/package.json', '/assets/..%2f..%2f..%2fpackage.json',
  '/..\\..\\package.json', '/assets/../../../data/secrets.json', '/C:/Windows/win.ini', '/CON', '/nul', '/aux.txt', '/index.html::$DATA', '/index.html.', '/index.html%20',
  '/files/..%2f..%2fsecrets.json', '/files/../secrets.json', '/files/..%2fchatterday.db', '/clubhouse/..%2f..%2fsecrets.json.png', '/clubhouse/../../secrets.json', '/' + 'a'.repeat(12000)]) {
  const out = await raw(`GET ${p} HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\nCookie: ${sam}\r\nConnection: close\r\n\r\n`, 3000);
  const status = out.split('\r\n')[0];
  const src = p.includes('$DATA') && /<script/.test(out) === false && /import|createRoot/.test(out);
  check(`GET ${p.slice(0, 50)}`, !secret.test(out) && !src, status);
}
check('server alive after odd paths', (await health()) >= 0);

console.log('\n== signed out ==');
for (const [m, p] of [['GET', '/api/me'], ['GET', '/api/messages?channel=1'], ['GET', '/files/abc'], ['GET', '/rtc'], ['POST', '/api/upload'], ['GET', '/api/admin/people'], ['GET', '/api/board'], ['GET', '/api/stash'], ['POST', '/api/profile'], ['POST', '/api/invites'], ['GET', '/api/admin/invites']]) {
  const r = await req(m, p, { body: m === 'POST' ? {} : undefined });
  check(`${m} ${p} signed out`, r.status === 401, String(r.status));
}
await ws('', {}).then((c) => { check('socket with no cookie', false, 'opened'); c.close(); }, (e) => check('socket with no cookie', /401/.test(e.message), e.message));
await ws('cd_session=' + 'A'.repeat(43), {}).then((c) => { check('socket with made-up cookie', false, 'opened'); c.close(); }, (e) => check('socket with made-up cookie', /401/.test(e.message), e.message));
{ // the first account is made on a server nobody has an account on yet, and only then
  const r = await req('POST', '/api/setup', { body: { name: 'Intruder', password: 'a-password-of-my-own', serverName: 'pwned' } });
  check('a server that is set up cannot be claimed again', r.status === 400 && !r.headers.get('set-cookie'), String(r.status));
}

console.log('\n== another site (Origin) ==');
for (const origin of ['http://evil.example', `http://127.0.0.1:${PORT + 1}`, 'null', '']) {
  const r = await req('POST', '/api/profile', { cookie: sam, origin, body: { status: 'pwned' } });
  check(`POST from origin "${origin}"`, r.status === 403, String(r.status));
  await ws(sam, { origin: origin || null }).then((c) => { check(`socket from origin "${origin}"`, false, 'opened'); c.close(); }, (e) => check(`socket from origin "${origin}"`, /401/.test(e.message), e.message));
}
{ // a forwarded-host header only counts from this PC's own proxy; from here it IS loopback, so this shows what a local proxy is trusted with
  const r = await req('POST', '/api/profile', { cookie: sam, origin: 'http://evil.example', headers: { 'X-Forwarded-Host': 'evil.example' }, body: {} });
  note('POST with Origin=evil + X-Forwarded-Host=evil from loopback', `${r.status} (accepted by design from loopback only; a browser cannot set this header cross-site without a preflight)`);
}

console.log('\n== a member trying the admin\'s things ==');
for (const [m, p, body] of [['POST', '/api/admin/password', { userId: idOf('Robin') }], ['POST', '/api/admin/remove', { userId: idOf('Kit') }], ['POST', '/api/admin/settings', { serverName: 'x' }],
  ['POST', '/api/channels', { name: 'x' }], ['PATCH', `/api/channels/${general}`, { name: 'x' }], ['DELETE', `/api/channels/${general}`], ['POST', '/api/invites', {}], ['GET', '/api/admin/people'], ['POST', '/api/admin/birthday', { userId: idOf('Sam'), birthday: '01-01' }],
  ['POST', '/api/admin/role', { userId: idOf('Sam'), role: 'admin' }], ['GET', '/api/admin/invites'], ['DELETE', '/api/admin/invites/0000000000000000'], ['GET', '/api/admin/config'], ['POST', '/api/admin/installer', {}]]) {
  const r = await req(m, p, { cookie: sam, body });
  check(`member ${m} ${p}`, r.status === 403, String(r.status));
}
check('and is still a member after all that', (await req('GET', '/api/me', { cookie: sam })).json.me.role === 'member');

console.log('\n== private chats ==');
const dm = (await req('POST', '/api/dm', { cookie: robin, body: { userId: idOf('Kit') } })).json.id;
R.send({ t: 'send', channelId: dm, content: 'secret-for-kit-only', nonce: 'n1' });
const sent = await R.wait((x) => x.t === 'msg' && x.message.content === 'secret-for-kit-only');
check('DM delivered to sender', !!sent);
check('DM delivered to the other person', !!(await K.wait((x) => x.t === 'msg' && x.message?.content === 'secret-for-kit-only')));
await sleep(200);
check('DM not delivered to a third person', !S.msgs.some((x) => JSON.stringify(x).includes('secret-for-kit-only')));
const mid = sent.message.id;
for (const [name, p] of [['read', `/api/messages?channel=${dm}`], ['read around', `/api/messages?channel=${dm}&around=${mid}`], ['search', `/api/search?channel=${dm}&q=secret`]]) {
  const r = await req('GET', p, { cookie: sam });
  check(`third person cannot ${name} a DM`, !r.text.includes('secret-for-kit-only'), String(r.status));
}
{
  const r = await req('POST', '/api/unread', { cookie: sam, body: { since: { [dm]: 0 } } });
  check('third person gets no unread count for a DM', !r.json?.counts?.[dm], r.text);
  const before = S.msgs.length;
  S.send({ t: 'send', channelId: dm, content: 'intruder' });
  S.send({ t: 'react', id: mid, emoji: 'x' });
  S.send({ t: 'delete', id: mid });
  S.send({ t: 'edit', id: mid, content: 'changed by sam' });
  S.send({ t: 'typing', channelId: dm });
  await sleep(400);
  const got = (await req('GET', `/api/messages?channel=${dm}`, { cookie: robin })).json.messages;
  check('third person cannot write, react, edit or delete in a DM', got.length === 1 && got[0].content === 'secret-for-kit-only' && !Object.keys(got[0].reactions).length, JSON.stringify(got.map((g) => [g.content, g.reactions])));
  check('third person\'s typing does not reach a DM', !R.msgs.some((x) => x.t === 'typing' && x.channelId === dm));
  check('DM list is only sent to its two people', !S.msgs.slice(before).some((x) => x.t === 'dm') && !S.ready.dms.some((x) => x.id === dm));
  // the admin is in this DM; check a DM he is NOT in
  const dm2 = (await req('POST', '/api/dm', { cookie: sam, body: { userId: idOf('Kit') } })).json.id;
  S.send({ t: 'send', channelId: dm2, content: 'sam-and-kit-only' });
  const m2 = await S.wait((x) => x.t === 'msg' && x.message.content === 'sam-and-kit-only');
  const r1 = await req('GET', `/api/messages?channel=${dm2}`, { cookie: robin });
  check('admin cannot read a DM he is not in', r1.status === 403, String(r1.status));
  for (const [m, body] of [['PATCH', { name: `${idOf('Robin')}|${idOf('Sam')}` }], ['DELETE', undefined]]) {
    const r2 = await req(m, `/api/channels/${dm2}`, { cookie: robin, body });
    check(`admin cannot ${m} a DM`, r2.status === 404, String(r2.status));
  }
  R.send({ t: 'delete', id: m2.message.id });
  await sleep(300);
  check('admin cannot delete a message in a DM he is not in', (await req('GET', `/api/messages?channel=${dm2}`, { cookie: sam })).json.messages.length === 1);
}

console.log('\n== other people\'s messages ==');
R.send({ t: 'send', channelId: general, content: 'robins message' });
const dmsg = await R.wait((x) => x.t === 'msg' && x.message.content === 'robins message');
S.send({ t: 'edit', id: dmsg.message.id, content: 'sam was here' });
S.send({ t: 'delete', id: dmsg.message.id });
await sleep(300);
{
  const got = (await req('GET', `/api/messages?channel=${general}`, { cookie: robin })).json.messages;
  check('member cannot edit or delete another person\'s message', got.some((g) => g.id === dmsg.message.id && g.content === 'robins message'));
}

console.log('\n== searching and odd numbers ==');
for (const q of ["' OR 1=1 --", '%', '_', '\\', '%%%%%%%%', '"; DROP TABLE messages; --']) {
  const r = await req('GET', `/api/search?channel=${general}&q=${encodeURIComponent(q + q)}`, { cookie: sam });
  check(`search ${q}`, r.status === 200 && Array.isArray(r.json.messages) && !r.json.messages.length, `${r.status} ${r.json?.messages?.length}`);
}
for (const ch of ['1 OR 1=1', 'NaN', '1e999', '-1', '1.5', '', '9'.repeat(40), `${dm}.0`, `0x${dm.toString(16)}`, ` ${dm} `, `${dm}e0`]) {
  const r = await req('GET', `/api/messages?channel=${encodeURIComponent(ch)}`, { cookie: sam });
  check(`messages?channel=${ch.slice(0, 20)}`, !r.text.includes('secret-for-kit-only') && r.status !== 500, String(r.status));
}

console.log('\n== uploads ==');
const up = async (kind, name, bytes, cookie = sam) => {
  const r = await fetch(`${BASE}/api/upload?kind=${kind}&name=${name}`, { method: 'POST', headers: { Origin: BASE, Cookie: cookie }, body: bytes });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100)]);
const html = Buffer.from('<html><script>alert(document.cookie)</script></html>');
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>');
{
  const a = await up('attachment', 'x.html', html);
  const f = await fetch(BASE + a.json.url, { headers: { Cookie: sam } });
  check('an uploaded HTML page is never shown as a page', f.headers.get('content-type') === 'application/octet-stream' && /^attachment/.test(f.headers.get('content-disposition')) && /sandbox/.test(f.headers.get('content-security-policy')) && f.headers.get('x-content-type-options') === 'nosniff',
    `${f.headers.get('content-type')} | ${f.headers.get('content-disposition')}`);
  const s = await up('attachment', 'x.svg', svg);
  const g = await fetch(BASE + s.json.url, { headers: { Cookie: sam } });
  check('an uploaded SVG is a download, not a picture', g.headers.get('content-type') === 'application/octet-stream', g.headers.get('content-type'));
  check('SVG as avatar refused', (await up('avatar', 'a.svg', svg)).status === 400);
  check('HTML as sound refused', (await up('sound', 'a.mp3', html)).status === 400);
  const poly = Buffer.concat([Buffer.from('GIF89a'), Buffer.from('<script>alert(1)</script>')]);
  const p2 = await up('avatar', 'p.gif', poly);
  const h = await fetch(BASE + p2.json.url, { headers: { Cookie: sam } });
  check('GIF/HTML polyglot is served as image/gif with nosniff + sandbox', h.headers.get('content-type') === 'image/gif' && h.headers.get('x-content-type-options') === 'nosniff' && /sandbox/.test(h.headers.get('content-security-policy')));
  const n = await up('attachment', encodeURIComponent('..\\..\\evil\r\nSet-Cookie: x=1.png'), png);
  const nf = await fetch(BASE + n.json.url, { headers: { Cookie: sam } });
  check('file name cannot add a header or a path', !nf.headers.get('set-cookie') && !/[\r\n\\/]/.test(n.json.name), `${n.json.name} | ${nf.headers.get('content-disposition')}`);
  check('unknown upload kind refused', (await up('constructor', 'x', png)).status === 400 && (await up('__proto__', 'x', png)).status === 400);
  check('empty upload refused', (await up('attachment', 'x', Buffer.alloc(0))).status === 400);
  const big = await up('avatar', 'big.png', Buffer.concat([png, Buffer.alloc(4 * 1024 * 1024 + 10)]));
  check('over-limit upload refused, server alive', big.status === 400 && (await health()) >= 0, String(big.status));
  // ranges
  const id = a.json.url;
  for (const range of ['bytes=5-2', 'bytes=-0', 'bytes=99999999-', 'bytes=0-99999999999999999999999', 'bytes=-99999999999999999999', 'bytes=0-0,5-6', 'bytes=abc', 'bytes=-', 'bytes=1-']) {
    const r = await fetch(BASE + id, { headers: { Cookie: sam, Range: range } });
    const body = await r.arrayBuffer();
    check(`Range: ${range}`, [200, 206, 416].includes(r.status) && body.byteLength <= html.length, `${r.status} ${body.byteLength}b ${r.headers.get('content-range') ?? ''}`);
  }
  check('server alive after ranges', (await health()) >= 0);
}

console.log('\n== profile fields ==');
{
  const r = await req('POST', '/api/profile', { cookie: sam, body: { name: 'Sa\nm\r[voice] 00:00:00 Robin left voice', status: 'a\u202eb', color: 'red; background:url(x)', emoji: '<img src=x onerror=alert(1)>', avatar: '../../secrets.json', talk: 5, entrance: 999999, theme: { a: 'x'.repeat(5000) },
    look: { body: '../../x', skin: 'red; background:url(x)', hair: { style: '<img src=x onerror=alert(1)>', color: '#12345' }, top: { kind: 'x'.repeat(5000), color2: 'javascript:alert(1)' }, extras: Array(900).fill('wings'), more: 'x'.repeat(5000) },
    pet: { kind: 'cat', name: 'Bis\ncuit\u202e' + 'y'.repeat(5000), coat: 'url(x)', build: '../../x', more: 'x'.repeat(5000) }, desk: { led: 'red', item: '../../x', more: 'x'.repeat(5000) } } });
  const me = r.json.me;
  note('name with line breaks', JSON.stringify(me.name));
  check('name cannot carry a line break (it is written to the log)', !/[\r\n]/.test(me.name), JSON.stringify(me.name));
  check('colour, avatar, talk, entrance, big theme all refused', me.color !== 'red; background:url(x)' && me.avatar === null && me.talk !== 5 && me.entrance !== 999999 && me.theme === null, JSON.stringify({ c: me.color, a: me.avatar, t: me.talk, e: me.entrance }));
  // what is kept of a character is only what is on the lists: cleaning it again changes nothing, and none of the nonsense is in it
  const kept = JSON.stringify([me.look, me.pet, me.desk]);
  check('a look, a pet and a desk full of nonsense are cut down to what is on the lists', kept === JSON.stringify([cleanLook(me.look), cleanPet(me.pet), cleanDesk(me.desk)]) && !/\.\.\/|url\(|<img|javascript|xxxx|more|\\n|\u202e/.test(kept) && me.look.extras.length === 1 && kept.length < 1200, kept.slice(0, 300));
  note('emoji field accepts any 16 chars', JSON.stringify(me.emoji));
  const taken = await req('POST', '/api/profile', { cookie: sam, body: { name: 'robin' } });
  check('cannot take another person\'s name (any capitals)', taken.status === 400, String(taken.status));
  const look = await req('POST', '/api/profile', { cookie: sam, body: { name: 'Rоbin' } });      // Cyrillic o
  note('look-alike name (Cyrillic "o" in Robin)', `${look.status}: ${look.status === 200 ? 'accepted' : 'refused'}`);
  await req('POST', '/api/profile', { cookie: sam, body: { name: 'Sam' } });
  const other = (await up('avatar', 'm.png', png, kit)).json.id;
  // (the test server is given one soundboard button and Robin's own entrance clip: see server.mjs)
  const clip = R.ready.sounds.find((s) => s.entranceFor === idOf('Robin'))?.id, button = R.ready.sounds.find((s) => !s.entranceFor)?.id;
  const steal = await req('POST', '/api/profile', { cookie: sam, body: { entrance: clip ?? -1, exit: clip ?? -1 } });
  check('cannot take somebody else\'s own entrance clip', clip != null && steal.json.me.entrance !== clip && steal.json.me.exit !== clip, `clip ${clip}, entrance ${steal.json.me.entrance}, exit ${steal.json.me.exit}`);
  const own = await req('GET', '/api/me', { cookie: robin });
  check('its owner has it', clip != null && own.json.me.entrance === clip, String(own.json.me.entrance));
  const fair = await req('POST', '/api/profile', { cookie: sam, body: { entrance: button ?? -1 } });
  check('a soundboard clip can be anybody\'s entrance sound', button != null && fair.json.me.entrance === button, String(fair.json.me.entrance));
  await req('POST', '/api/profile', { cookie: sam, body: { entrance: null } });
  void other;
}

console.log('\n== signing out ends the live connection ==');
{
  const mika = await login('Mika');
  const M = await ws(mika);
  await req('POST', '/api/logout', { cookie: mika });
  await sleep(500);
  check('socket closed on sign-out', M.closed?.code === 4001, JSON.stringify(M.closed));
  check('cookie dead after sign-out', (await req('GET', '/api/me', { cookie: mika })).status === 401);
}

console.log('\n== leftovers ==');
check('no half-written uploads left', fs.readdirSync(path.join(DATA, 'uploads')).every((f) => fs.statSync(path.join(DATA, 'uploads', f)).size > 0));
check('server alive at the end', (await health()) >= 0);
for (const c of [R, S, K]) c.close();
process.exit(summary() ? 1 : 0);
