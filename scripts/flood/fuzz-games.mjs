// Fuzzes the rules of every table game directly (server/games/*.ts): whole games played by the computer players or by
// random legal moves, with nonsense thrown at move() at every step.
//   node scripts/flood/fuzz-games.mjs [game ...] [--games=N] [--shape]
// Needs no server. Checks at every step: nothing throws, a refused move leaves the game exactly as it was, a computer
// player's own move is never refused, no card or tile is lost or doubled, every game ends, and every seat's view can
// be drawn. Then the chess move generator against the published counts, and the table itself under nonsense.
const imp = (f) => import(new URL('../../server/' + f, import.meta.url).href);
const { GAMES, makeTable } = await imp('games.ts');
const chessMod = await imp('games/chess.ts');
const checkersMod = await imp('games/checkers.ts');

const args = process.argv.slice(2);
const N = Number(args.find((a) => a.startsWith('--games='))?.slice(8) ?? 40);
const SHAPE = args.includes('--shape');
const which = args.filter((a) => !a.startsWith('--'));

function rngOf(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const J = (x) => JSON.stringify(x);

const POOL = [null, undefined, true, false, 0, 1, -1, 2, 3, 1.5, 63, 64, 1e9, -1e9, NaN, Infinity, '', 'x', 'QS', '2C', 'AH', 'XX', '__proto__', 'constructor', 'toString', [], [[]], {}, [0], [1, 2, 3], ['QS'], ['2C', '3C', '4C'], Array(20).fill(0),
  { length: 3 }, 'play', 'pass', 'resign', 'offer', 'accept', 'decline', 'bid', 'draw', 'discard', 'meld', 'lay', 'take', 'chow', 'pung', 'kong', 'win', 'skip', 'q', 'n', 'Q', 9, 13, 19, 4, 5, 6, 7, 12, 13, 14, 26, 33, 34, 35, 51, 52];
const KEYS = ['a', 'card', 'cards', 'from', 'to', 'promo', 'path', 'at', 'pass', 'size', 'resume', 'agree', 'dead', 'col', 'pit', 'n', 'bid', 'tile', 'tiles', 'meld', 'i', 'kind', 'nil', 'blind', 'with', 'take', 'pile', 'on', 'seat', 'x', 'y'];

const problems = new Map();
function problem(game, what, detail) {
  const key = `${game}: ${what}`;
  const p = problems.get(key) ?? { n: 0, first: detail };
  p.n++;
  problems.set(key, p);
}

/** A legal move for a seat in the games that have no computer player. */
function randomMove(kind, s, seat, rng) {
  const pick = (a) => a[Math.floor(rng() * a.length)];
  if (kind === 'chess') { const ms = chessMod.legalMoves(s); if (!ms.length) return null; const m = pick(ms); return { from: m.from, to: m.to, promo: m.promo }; }
  if (kind === 'checkers') { const ms = checkersMod.legalMoves(s.b, seat); return ms.length ? { path: pick(ms) } : null; }
  if (kind === 'go') {
    if (s.phase === 'mark') { if (rng() < 0.3) { const stones = s.b.flatMap((x, i) => (x !== '.' ? [i] : [])); if (stones.length) return { dead: pick(stones) }; } return rng() < 0.05 ? { resume: true } : { agree: true }; }
    if (s.ply === 0 && rng() < 0.3) return { size: pick([9, 13, 19]) };
    if (rng() < 0.04 || s.ply > 500) return { pass: true };
    const empty = s.b.flatMap((x, i) => (x === '.' ? [i] : []));
    for (let k = 0; k < 30 && empty.length; k++) { const at = pick(empty); return { at }; }
    return { pass: true };
  }
  return null;
}

function garbage(rng, like) {
  const pick = (a) => a[Math.floor(rng() * a.length)];
  const r = rng();
  if (r < 0.08) return pick(POOL);                               // not even an object
  const m = like && rng() < 0.7 ? structuredClone(like) : {};
  const n = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const k = like && rng() < 0.6 && Object.keys(like).length ? pick(Object.keys(like)) : pick(KEYS);
    if (rng() < 0.15) delete m[k]; else m[k] = pick(POOL);
  }
  return m;
}

function conserve(kind, s) {
  const flat = (x) => x.flat(Infinity);
  if (kind === 'hearts' || kind === 'spades') {
    if (s.phase === 'handEnd' || s.phase === 'over') return null;
    const cards = [...flat(s.hands), ...s.trick.map((p) => p.card)];
    if (new Set(cards).size !== cards.length) return 'a card twice: ' + J(cards);
    if (cards.length + 4 * s.tricks !== 52) return cards.length + ' cards in play with ' + s.tricks + ' tricks done';
    if (kind === 'hearts' && s.phase === 'play' && s.taken.reduce((a, b) => a + b, 0) > 26) return 'more than 26 points';
  }
  if (kind === 'rummy') {
    if (s.phase === 'handEnd' || s.phase === 'over') return null;
    const cards = [...flat(s.hands), ...s.stock, ...s.discard, ...flat(s.melds.map((m) => m.cards))];
    if (new Set(cards).size !== cards.length || cards.length !== 52) return cards.length + ' cards, ' + new Set(cards).size + ' different';
  }
  if (kind === 'mahjong') {
    if (s.phase === 'handEnd' || s.phase === 'over') return null;
    const tiles = [...s.wall, ...flat(s.hands), ...flat(s.melds.map((ms) => ms.map((m) => m.tiles))), ...flat(s.discards)];
    const c = new Array(34).fill(0); for (const t of tiles) c[t]++;
    if (tiles.length !== 136 || c.some((n) => n !== 4)) return tiles.length + ' tiles; counts ' + J(c);
    for (let i = 0; i < 4; i++) { const n = s.hands[i].length + 3 * s.melds[i].length; if (n !== 13 && n !== 14) return 'seat ' + i + ' holds ' + n + ' (hand ' + s.hands[i].length + ', melds ' + s.melds[i].length + ')'; }
  }
  return null;
}
const stats = {};
for (const [kind, rules] of Object.entries(GAMES)) {
  if (which.length && !which.includes(kind)) continue;
  const st = (stats[kind] = { games: 0, moves: 0, garbage: 0, accepted: new Map(), ends: new Map(), longest: 0, ms: 0, viewMs: 0, maxViewBytes: 0 });
  const t0 = performance.now();
  for (let g = 0; g < N; g++) {
    const rng = rngOf(g * 7919 + 13), frng = rngOf(g * 104729 + 7);
    const players = rules.seats[0] + Math.floor(rng() * (rules.seats[1] - rules.seats[0] + 1));
    let s;
    try { s = rules.start(players, rng); } catch (e) { problem(kind, 'start() threw', e.stack); continue; }
    if (SHAPE && g === 0) console.log(`\n[${kind}] state at the start:\n`, J(s).slice(0, 900), `\n[${kind}] view for seat 0:\n`, J(rules.view(s, 0)).slice(0, 900), `\n[${kind}] view for a watcher:\n`, J(rules.view(s, -1)).slice(0, 600));
    let steps = 0, stuck = 0;
    for (; steps < 6000; steps++) {
      let res;
      try { res = rules.result(s); } catch (e) { problem(kind, 'result() threw', e.stack); break; }
      if (res) {
        if (!Array.isArray(res.winners) || res.winners.some((w) => !Number.isInteger(w) || w < 0 || w >= players) || typeof res.text !== 'string') problem(kind, 'odd result', J(res));
        st.ends.set(res.text.replace(/\d+/g, 'N').slice(0, 50), (st.ends.get(res.text.replace(/\d+/g, 'N').slice(0, 50)) ?? 0) + 1);
        break;
      }
      let turn;
      try { turn = rules.turn(s); } catch (e) { problem(kind, 'turn() threw', e.stack); break; }
      if (!turn.length) { problem(kind, 'nobody to move but no result', J(s).slice(0, 300)); break; }
      if (turn.some((i) => !Number.isInteger(i) || i < 0 || i >= players)) { problem(kind, 'turn() names a seat that is not there', J(turn)); break; }

      // every seat's view, and a watcher's, must be drawable and must be plain data
      const tv = performance.now();
      for (let seat = -1; seat < players; seat++) {
        try { const v = J(rules.view(s, seat)); st.maxViewBytes = Math.max(st.maxViewBytes, v.length); if (v.includes('null') && /NaN|Infinity/.test(v)) problem(kind, 'view has NaN', v.slice(0, 200)); }
        catch (e) { problem(kind, 'view() threw', e.stack); }
      }
      st.viewMs += performance.now() - tv;

      // a legal move for one of the seats whose turn it is
      let moved = false, legalMove = null, legalSeat = -1;
      for (const seat of turn) {
        let m;
        try { m = rules.bot ? rules.bot(s, seat, rng) : randomMove(kind, s, seat, rng); } catch (e) { problem(kind, 'bot() threw', e.stack); m = null; }
        if (m == null) continue;
        legalMove = m; legalSeat = seat;
        break;
      }

      // nonsense first (on a sample of steps): it must never throw, and a refusal must leave the game exactly as it was
      if (frng() < 0.25) {
        for (let k = 0; k < 12; k++) {
          const seat = Math.floor(frng() * players);
          const m = garbage(frng, seat === legalSeat || frng() < 0.5 ? legalMove : null);
          const before = J(s);
          let err;
          try { err = rules.move(s, seat, m, frng); } catch (e) { problem(kind, 'move() threw on nonsense', `${J(m)} seat ${seat}\n${e.stack.split('\n').slice(0, 4).join('\n')}`); s = JSON.parse(before); continue; }
          st.garbage++;
          if (typeof err === 'string') { if (J(s) !== before) { problem(kind, 'a REFUSED move changed the game', `${J(m)} seat ${seat} -> "${err}"`); s = JSON.parse(before); } }
          else if (err === null) {
            // accepted: fine if it is a real move; keep a tally of the shapes to look over, then put the game back so the playout stays on its own line
            const shape = `${turn.includes(seat) ? 'in turn' : 'OUT OF TURN'} ${J(m, (k2, v) => (typeof v === 'number' ? 0 : v)).slice(0, 70)}`;
            st.accepted.set(shape, (st.accepted.get(shape) ?? 0) + 1);
            try { J(rules.view(s, seat)); rules.result(s); rules.turn(s); } catch (e) { problem(kind, 'game broken after an accepted odd move', `${J(m)}\n${e.stack.split('\n').slice(0, 3).join('\n')}`); }
            s = JSON.parse(before);
          } else problem(kind, 'move() gave back neither a line nor null', J(err));
        }
      }

      if (legalMove == null && s.phase === 'handEnd') { legalMove = { next: true }; legalSeat = turn[0]; }
      if (legalMove == null) { if (++stuck > 3) { problem(kind, 'it is somebody\'s turn but nobody has a move', J({ turn, s }).slice(0, 400)); break; } continue; }
      let err;
      try { err = rules.move(s, legalSeat, legalMove, rng); } catch (e) { problem(kind, 'move() threw on a legal move', `${J(legalMove)}\n${e.stack}`); break; }
      if (err) {
        if (rules.bot || kind !== 'go') { problem(kind, 'a computer player\'s own move was refused', `${J(legalMove)} -> "${err}"`); break; }
        if (++stuck > 200) { s.ply > 0 ? rules.move(s, legalSeat, { pass: true }, rng) : null; stuck = 0; }       // go: an illegal point (suicide, ko); try again
        continue;
      }
      stuck = 0; moved = true; st.moves++;
      { const bad = conserve(kind, s); if (bad) { problem(kind, 'cards or tiles lost or doubled', bad + ' after ' + J(legalMove)); break; } }
      void moved;
    }
    if (steps >= 6000) problem(kind, 'a game did not end in 6000 steps', J(rules.view(s, -1)).slice(0, 300));
    st.longest = Math.max(st.longest, steps);
    st.games++;
  }
  st.ms = Math.round(performance.now() - t0);
}

console.log('\n=== per game ===');
for (const [kind, st] of Object.entries(stats)) {
  console.log(`${kind}: ${st.games} games, ${st.moves} moves, ${st.garbage} nonsense moves, longest ${st.longest} steps, ${st.ms} ms (views ${Math.round(st.viewMs)} ms, biggest view ${st.maxViewBytes} bytes)`);
  console.log('   ends: ' + [...st.ends].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `${n}x "${k}"`).join(', '));
  const odd = [...st.accepted].sort((a, b) => b[1] - a[1]);
  console.log(`   moves accepted OUT OF TURN: ` + (odd.filter(([k]) => k.startsWith('OUT')).slice(0, 12).map(([k, n]) => `${n}x ${k.slice(12)}`).join(' | ') || 'none'));
}
console.log('\n=== problems ===');
if (!problems.size) console.log('none');
for (const [k, p] of problems) console.log(`\n* ${k}  (${p.n} times)\n  first: ${String(p.first).slice(0, 700)}`);

// chess: the move generator against the published counts ("perft") for positions chosen to trip one up: taking
// en passant into a pin, castling through or out of check, promoting, stalemate
let bad = 0;
if (!which.length || which.includes('chess')) {
  console.log('\n=== chess move generator (perft) ===');
  for (const [fen, depth, want] of [['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 4, 197281], ['r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 3, 97862],
    ['8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', 4, 43238], ['r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', 3, 9467], ['rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', 3, 62379],
    ['3k4/3p4/8/K1P4r/8/8/8/8 b - - 0 1', 6, 1134888], ['8/8/4k3/8/2p5/8/B2P2K1/8 w - - 0 1', 6, 1015133], ['8/8/1k6/2b5/2pP4/8/5K2/8 b - d3 0 1', 6, 1440467],
    ['5k2/8/8/8/8/8/8/4K2R w K - 0 1', 6, 661072], ['3k4/8/8/8/8/8/8/R3K3 w Q - 0 1', 6, 803711], ['r3k2r/1b4bq/8/8/8/8/7B/R3K2R w KQkq - 0 1', 4, 1274206],
    ['r3k2r/8/3Q4/8/8/5q2/8/R3K2R b KQkq - 0 1', 4, 1720476], ['2K2r2/4P3/8/8/8/8/8/3k4 w - - 0 1', 6, 3821001], ['8/8/1P2K3/8/2n5/1q6/8/5k2 b - - 0 1', 5, 1004658],
    ['4k3/1P6/8/8/8/8/K7/8 w - - 0 1', 6, 217342], ['8/P1k5/K7/8/8/8/8/8 w - - 0 1', 6, 92683], ['K1k5/8/P7/8/8/8/8/8 w - - 0 1', 6, 2217], ['8/k1P5/8/1K6/8/8/8/8 w - - 0 1', 7, 567584], ['8/8/2k5/5q2/5n2/8/5K2/8 b - - 0 1', 4, 23527]]) {
    let got; try { got = chessMod.perft(chessMod.fromFen(fen), depth); } catch (e) { got = e.message; }
    if (got !== want) bad++;
    console.log(`${got === want ? '  ok  ' : ' FAIL '} ${fen}  depth ${depth}: ${got}${got === want ? '' : ` (should be ${want})`}`);
  }
}

// the table itself: people sitting, standing, starting and ending in nonsense orders
if (!which.length) {
  console.log('\n=== the table (seats, starting, ending) under nonsense ===');
  const rng = rngOf(99);
  const pick = (a) => a[Math.floor(rng() * a.length)];
  let threw = 0, sent = 0; const firstErr = [];
  const online = new Set(['a', 'b', 'c', 'd', 'e']);
  const queue = [];
  const table = makeTable({ send() { sent++; }, everyone: () => [...online], online: (u) => online.has(u), later: (fn) => queue.push(fn), now: () => 1e12 + sent * 1000, rng });
  const ops = ['sync', 'pick', 'sit', 'stand', 'bot', 'start', 'move', 'replace', 'end', 'again'];
  for (let i = 0; i < 300_000; i++) {
    const u = pick(['a', 'b', 'c', 'd', 'e']);
    const r = rng();
    try {
      if (r < 0.02) { online.delete(u); table.gone(u); }
      else if (r < 0.05) { online.add(u); table.handle(u, { op: 'sync' }); }
      else if (r < 0.25 && queue.length) queue.shift()();
      else {
        const peek = table.peek();
        const rules = peek.kind ? GAMES[peek.kind] : null;
        let m = garbage(rng, null);
        const seatNow = peek.seats.findIndex((s) => s.userId === u);
        if (rules && peek.state && seatNow >= 0 && rng() < 0.7) m = rules.bot ? rules.bot(peek.state, seatNow, rng) ?? m : randomMove(peek.kind, peek.state, seatNow, rng) ?? m;
        table.handle(u, { op: rng() < 0.5 ? 'move' : pick(ops), kind: rng() < 0.9 ? pick(Object.keys(GAMES)) : pick(POOL), seat: rng() < 0.9 ? Math.floor(rng() * 5) : pick(POOL), m });
      }
      const p = table.peek();
      for (const who of ['a', 'e']) JSON.stringify(table.view(who));
      const sitters = p.seats.filter((s) => s.userId !== null).map((s) => s.userId);
      if (new Set(sitters).size !== sitters.length) { threw++; if (firstErr.length < 3) firstErr.push('one person in two seats: ' + J(p.seats)); }
      if (p.phase === 'playing' && !p.state) { threw++; if (firstErr.length < 3) firstErr.push('playing with no game'); }
    } catch (e) { threw++; if (firstErr.length < 5 && !firstErr.includes(e.stack.split('\n').slice(0, 4).join('\n'))) firstErr.push(e.stack.split('\n').slice(0, 4).join('\n')); }
  }
  console.log(`${threw ? ' FAIL ' : '  ok  '} 300,000 table actions: ${threw} went wrong, ${sent} snapshots sent`);
  for (const e of firstErr) console.log('   ' + e);
  if (threw) bad++;
}
process.exit(problems.size || bad ? 1 : 0);
