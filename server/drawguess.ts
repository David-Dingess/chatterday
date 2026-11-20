// Draw & Guess on the whiteboard, and only there: nothing goes in the text chat. Somebody opens a game from the board and
// whoever wants in presses Join; once two or more are in, any of them starts it. The server takes the players' turns
// drawing and picks each drawer a word only they are shown. The others guess in the box beside the board: a wrong guess
// shows in the game's own feed, a right one only as "Dan got it". Guessers score by how quickly they got it, the
// drawer for each person who did. The picture that was on the board is put aside for the game and put back at the
// end. Players show as playing Draw & Guess. Kept in memory only: a restart ends a game (the old picture is still in the
// file, so it comes back).
import { borrowBoard, returnBoard, wipeForTurn } from './board.ts';
import { achieve } from './achievements.ts';

const TURN_MS = 80_000;
const BETWEEN_MS = 6_000;          // the word shown to everyone before the next turn
const OVER_MS = 30_000;            // how long the final scores stay up on the board
const GONE_MS = 15_000;            // a player away this long is out of the game (a drawer loses the turn)
const LOBBY_MS = 10 * 60_000;      // a game opened and never started is put away after this
const FEED_MAX = 60;

export type PictWays = {
  /** Sends something to one person, on every device they have open. */
  send(userId: string, msg: unknown): void;
  /** Everybody with the app open. */
  online(): string[];
  /** Whether they have the app open on a computer (the phone page has no whiteboard to draw on). */
  canDraw(userId: string): boolean;
  nameOf(userId: string): string;
  /** A note just for one person (a toast). */
  tell(userId: string, text: string): void;
  /** Tells every page the board has changed: 'clear' or 'reload'. */
  board(op: 'clear' | 'reload'): void;
  /** Who is playing has changed (for everybody's status). */
  changed(): void;
};

type Line = { k: 'sys' | 'guess' | 'got'; who?: string; text: string };
type Game = {
  by: string; rounds: number; round: number;
  players: string[];                // who is in, in the order they joined
  goneAt: Record<string, number>;   // when a player was last seen gone
  order: string[];                  // who draws this round, in turn
  turn: number;                     // index into order
  drawer: string; word: string; shown: Set<number>;     // letters given away as a hint
  phase: 'lobby' | 'drawing' | 'between' | 'over';
  started: number; ends: number;
  guessed: { id: string; pts: number }[];
  scores: Record<string, number>;
  used: Set<string>; swapped: boolean;
  last: string;                     // the word of the turn just ended (shown in 'between' and 'over')
  feed: Line[];
};

// ── the words: things that can be drawn, none rude, easy ones and some that take a little more ──
const EASY = `cat dog fish bird cow pig horse duck frog snake mouse rabbit bear lion tiger elephant giraffe monkey zebra penguin
owl turtle snail spider bee butterfly ladybug octopus shark whale crab starfish dinosaur dragon unicorn robot ghost alien
pirate king queen wizard witch mermaid snowman clown cowboy ninja sun moon star cloud rain snow rainbow lightning volcano
mountain island beach river tree flower cactus leaf mushroom apple banana grapes cherry lemon pineapple strawberry watermelon
carrot corn pumpkin pizza hamburger hot_dog taco sandwich cookie cake cupcake donut ice_cream popcorn pancake egg cheese
bread pretzel spaghetti candy lollipop coffee milk house castle igloo tent barn bridge tower school car bus train airplane
helicopter rocket boat ship bicycle truck ball kite balloon guitar drum piano trumpet camera television computer phone
clock lamp candle umbrella glasses hat crown shoe sock shirt pants dress scarf glove backpack key lock door window ladder
chair table bed couch bathtub toilet toothbrush scissors pencil book envelope gift bell anchor sword hammer shovel broom
bucket magnet fork spoon cup teapot bone nest worm bat fox wolf deer peach heart eye nose ear hand foot tooth baby
pumpkin sandcastle swing slide flag map basketball football baseball soccer_ball trophy whistle bone`;
const MEDIUM = `trampoline roller_coaster ferris_wheel carousel campfire fireworks treasure_chest compass telescope microscope globe
parachute scarecrow birthday_cake party_hat juggler fishing_rod surfboard snowboard skis bowling golf tennis_racket hockey
boxing_glove medal astronaut firefighter doctor chef farmer teacher dentist magician superhero detective knight princess
caveman zombie skeleton vampire jellyfish seahorse peacock flamingo kangaroo koala panda sloth hedgehog squirrel raccoon
skunk camel crocodile hippo rhino gorilla parrot eagle swan caterpillar beaver moose lobster toaster blender microwave
refrigerator vacuum washing_machine faucet mailbox traffic_light stop_sign fire_hydrant escalator windmill pyramid statue
fountain bench fence chimney doghouse birdhouse treehouse lighthouse waterfall tornado submarine motorcycle skateboard
tractor fire_truck ambulance hot_air_balloon hourglass magnifying_glass piggy_bank crayon paintbrush stapler paper_clip
calculator calendar thermometer bandage mustache beard brain planet comet earth french_fries milkshake waffle burrito
popsicle cereal bacon broccoli peanut avocado coconut onion potato tomato video_game remote_control flashlight alarm_clock
doorbell sled mitten earmuffs sunglasses flip_flops necktie bow_tie belt zipper spider_web beehive cocoon footprint
fingerprint jack_o_lantern christmas_tree gingerbread_man reindeer pinata pirate_ship desert_island sunrise sunset
tightrope unicycle snowflake icicle snowball shadow sneeze yawn haircut picnic camping swimming dancing sleeping
homework vacation wedding headphones microphone keyboard battery light_bulb frying_pan suitcase bow_and_arrow shield
saw violin drum_set wheelbarrow`;
const words = (s: string) => [...new Set(s.split(/\s+/).filter(Boolean).map((w) => w.replace(/_/g, ' ')))];
export const WORDS = { easy: words(EASY), medium: words(MEDIUM).filter((w) => !words(EASY).includes(w)) };

// ── checking a guess ──
const tokens = (s: string) => s.toLowerCase().replace(/['’]/g, '').split(/[^a-z0-9]+/).filter(Boolean);
/** The plain forms of a word as typed: as it is, and without a plural ending. */
function forms(w: string) {
  const out = new Set([w]);
  if (w.endsWith('ies') && w.length > 4) out.add(w.slice(0, -3) + 'y');
  if (w.endsWith('es') && w.length > 3) out.add(w.slice(0, -2));
  if (w.endsWith('s') && w.length > 2) out.add(w.slice(0, -1));
  return out;
}
function same(a: string, b: string) {
  const fa = forms(a), fb = forms(b);
  for (const x of fa) if (fb.has(x)) return true;
  return false;
}
/** Whether the message has the word in it, anywhere: "a cat?" and "CATS" both have "cat"; "icecream" and "ice-cream"
 *  both have "ice cream". */
export function hasWord(text: string, word: string) {
  const t = tokens(text), want = tokens(word).join('');
  for (let i = 0; i < t.length; i++) {
    let joined = '';
    for (let j = i; j < Math.min(t.length, i + 5); j++) {
      joined += t[j];
      if (same(joined, want)) return true;
    }
  }
  return false;
}
/** One letter wrong, missing or extra: "So close." */
function close1(text: string, word: string) {
  const a = tokens(text).join(''), b = tokens(word).join('');
  if (b.length < 5 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, slips = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++slips > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return slips + (a.length - i) + (b.length - j) <= 1;
}

/** The word as the guessers see it: a line for each letter, the given-away letters filled in. */
function hintOf(word: string, shown: Set<number>) {
  return [...word].map((ch, i) => (ch === ' ' ? ' ' : ch === '-' ? '-' : shown.has(i) ? ch.toUpperCase() : '_')).join('');
}
const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)];


export function makeDrawGuess(w: PictWays) {
  let g: Game | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let tick: ReturnType<typeof setInterval> | null = null;

  const name = (id: string) => w.nameOf(id);
  const isOn = (id: string) => w.online().includes(id);
  /** The players who guess this turn: in the game, on, and not drawing. */
  const guessers = () => (g ? g.players.filter((id) => id !== g!.drawer && isOn(id)) : []);
  const say = (text: string, k: Line['k'] = 'sys', who?: string) => {
    if (!g) return;
    g.feed.push({ k, text, ...(who ? { who } : {}) });
    if (g.feed.length > FEED_MAX) g.feed.splice(0, g.feed.length - FEED_MAX);
  };

  function stateFor(userId: string) {
    if (!g) return null;
    const drawing = g.phase === 'drawing';
    return {
      by: g.by, round: g.round, rounds: g.rounds, drawer: g.drawer, phase: g.phase, ends: g.ends, now: Date.now(), turnMs: TURN_MS,
      hint: drawing ? hintOf(g.word, g.shown) : '',
      word: drawing && userId === g.drawer ? g.word : '',
      was: drawing ? '' : g.last,
      guessed: g.guessed.map((x) => x.id), scores: g.scores,
      players: g.players, joined: g.players.includes(userId),
      canSwap: drawing && userId === g.drawer && !g.swapped,
      feed: g.feed,
    };
  }
  function push() {
    for (const id of w.online()) w.send(id, { t: 'board', op: 'pict', game: stateFor(id) });
    w.changed();
  }

  function newWord() {
    const pool = Math.random() < 0.6 ? WORDS.easy : WORDS.medium;
    let word = pick(pool);
    for (let i = 0; i < 40 && g!.used.has(word); i++) word = pick(Math.random() < 0.6 ? WORDS.easy : WORDS.medium);
    g!.used.add(word);
    return word;
  }
  /** Who draws in a round: those who drew last round, in the same order, then anybody who joined since. */
  function drawersNow(before: string[]) {
    const can = g!.players.filter((id) => isOn(id) && w.canDraw(id));
    return [...before.filter((id) => can.includes(id)), ...can.filter((id) => !before.includes(id))];
  }
  /** The next turn, or the next round, or the end. */
  function next() {
    if (!g) return;
    for (;;) {
      g.turn++;
      if (g.turn >= g.order.length) {
        g.round++;
        if (g.round > g.rounds) { g.round = g.rounds; return end(); }
        g.order = drawersNow(g.order);
        g.turn = 0;
        if (!g.order.length) return end('Draw & Guess is over: nobody in the game is on a computer to draw.');
      }
      const id = g.order[g.turn];
      if (g.players.includes(id) && isOn(id) && w.canDraw(id)) break;     // somebody who has gone (or left) is skipped
    }
    g.drawer = g.order[g.turn];
    g.word = newWord();
    g.shown = new Set();
    g.phase = 'drawing';
    g.started = Date.now();
    g.ends = g.started + TURN_MS;
    g.guessed = [];
    g.swapped = false;
    wipeForTurn();
    w.board('clear');
    say(`Round ${g.round} of ${g.rounds}: ${name(g.drawer)} is drawing.`);
    schedule(TURN_MS, () => endTurn());
    push();
  }
  function schedule(ms: number, fn: () => void) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; try { fn(); } catch (e) { console.error('[drawguess]', e); } }, ms);
  }
  function endTurn(why = '') {
    if (!g || g.phase !== 'drawing') return;
    g.last = g.word;
    g.phase = 'between';
    g.ends = Date.now() + BETWEEN_MS;
    const got = g.guessed.map((x) => `${name(x.id)} +${x.pts}`);
    const drawn = g.guessed.length * 3;
    if (drawn) g.scores[g.drawer] = (g.scores[g.drawer] ?? 0) + drawn;
    const lead = why ? `${why} ` : '';
    say(got.length
      ? `${lead}The word was "${g.word}". ${got.join(', ')}, and ${name(g.drawer)} +${drawn} for the drawing.`
      : `${lead}Nobody got it. The word was "${g.word}".`);
    schedule(BETWEEN_MS, next);
    push();
  }
  /** The end of a game. One never started is simply put away. */
  function end(why = '') {
    if (!g) return;
    if (g.phase === 'lobby') { close(); return; }
    if (g.phase === 'drawing') endTurn();
    const ranked = Object.entries(g.scores).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
    let line = why || 'Draw & Guess is over.';
    if (ranked.length) {
      const top = ranked.filter(([, n]) => n === ranked[0][1]).map(([id]) => name(id));
      line += ` Final scores: ${ranked.map(([id, n]) => `${name(id)} ${n}`).join(', ')}. `
        + (top.length > 1 ? `${top.slice(0, -1).join(', ')} and ${top[top.length - 1]} tie for first.` : `${top[0]} wins.`);
    } else line += ' Nobody scored.';
    if (ranked.length && !(ranked[1]?.[1] === ranked[0][1])) achieve.won('drawguess', [ranked[0][0]], g.players);      // (a tie for first wins nothing)
    say(line);
    g.phase = 'over';
    g.ends = Date.now() + OVER_MS;
    returnBoard();
    w.board('reload');
    if (tick) { clearInterval(tick); tick = null; }
    schedule(OVER_MS, close);
    push();
  }
  function close() {
    const wasDrawing = !!g && g.phase !== 'lobby' && g.phase !== 'over';
    g = null;
    if (timer) { clearTimeout(timer); timer = null; }
    if (tick) { clearInterval(tick); tick = null; }
    if (wasDrawing) { returnBoard(); w.board('reload'); }
    for (const id of w.online()) w.send(id, { t: 'board', op: 'pict', game: null });
    w.changed();
  }
  function join(userId: string) {
    if (!g || g.players.includes(userId)) return;
    g.players.push(userId);
    delete g.goneAt[userId];
    say(`${name(userId)} joined.`);
  }

  /** Every second: hints as the clock runs down, and players who have gone. */
  function everySecond() {
    if (!g) return;
    const now = Date.now();
    if (g.phase === 'lobby' && now - g.started > LOBBY_MS) return close();
    // players gone a while are out of the game (a page reloading, for an update say, is gone only for a moment)
    for (const id of [...g.players]) {
      if (isOn(id)) { delete g.goneAt[id]; continue; }
      if (!g.goneAt[id]) { g.goneAt[id] = now; continue; }
      if (now - g.goneAt[id] < GONE_MS) continue;
      g.players = g.players.filter((x) => x !== id);
      delete g.goneAt[id];
      say(`${name(id)} has gone, so is out of the game.`);
      if (g.phase === 'drawing' && id === g.drawer) endTurn(`${name(id)} was drawing, so that turn is over.`);
      else push();
    }
    if (!g) return;
    if (g.phase === 'lobby') { if (!g.players.length) close(); return; }
    if ((g.phase === 'drawing' || g.phase === 'between') && g.players.length < 2) return end('Draw & Guess is over: not enough players are left.');
    if (g.phase !== 'drawing') return;
    if (guessers().length && guessers().every((id) => g!.guessed.some((x) => x.id === id))) return endTurn('Everybody got it.');
    const left = g.ends - now;
    const letters = [...g.word].map((ch, i) => (/[a-z]/i.test(ch) ? i : -1)).filter((i) => i >= 0);
    const want = letters.length < 4 ? 0 : left < TURN_MS * 0.25 ? (letters.length >= 7 ? 2 : 1) : left < TURN_MS * 0.5 ? 1 : 0;
    if (g.shown.size < want) {
      const hidden = letters.filter((i) => !g!.shown.has(i));
      g.shown.add(pick(hidden));
      push();
    }
  }

  /** A guess typed into the box beside the board. */
  function guess(userId: string, raw: string) {
    if (!g) return;
    const text = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!text) return;
    if (g.phase !== 'drawing') { if (g.players.includes(userId) || g.phase === 'lobby') { say(text, 'guess', userId); push(); } return; }
    if (!g.players.includes(userId)) join(userId);       // somebody watching can jump in by guessing
    const has = hasWord(text, g.word);
    // (a word one letter off gives it away as surely as the word itself, so neither goes in the feed for the others)
    const near = !has && close1(text, g.word);
    if (userId === g.drawer || g.guessed.some((x) => x.id === userId)) {
      if (has || near) return w.tell(userId, userId === g.drawer ? 'That would give the word away.' : 'You have it already: that would give it away.');
      say(text, 'guess', userId);
      return push();
    }
    if (!has) {
      if (near) return w.tell(userId, `"${text.slice(0, 30)}" is so close.`);
      say(text, 'guess', userId);
      return push();
    }
    const left = Math.max(0, g.ends - Date.now());
    const pts = Math.max(2, Math.round(10 * left / TURN_MS));
    g.guessed.push({ id: userId, pts });
    g.scores[userId] = (g.scores[userId] ?? 0) + pts;
    say(`${name(userId)} got it (+${pts}).`, 'got', userId);
    w.tell(userId, `You got it: "${g.word}".`);
    if (guessers().every((id) => g!.guessed.some((x) => x.id === id))) endTurn('Everybody got it.');
    else push();
  }

  return {
    /** What the page needs when it loads the board. */
    stateFor,
    /** For their status: in a game ("Playing Draw & Guess"), or in one not started yet ("Waiting to play"). */
    playing(userId: string): { game: string; waiting: boolean } | null {
      if (!g || !g.players.includes(userId) || g.phase === 'over') return null;
      return { game: 'Draw & Guess', waiting: g.phase === 'lobby' };
    },
    /** From the board's own controls. */
    handle(userId: string, d: any) {
      if (d.do === 'open') {
        if (g && g.phase !== 'over') return w.tell(userId, 'A game is already open on the board.');
        if (!w.canDraw(userId)) return;
        const rounds = [1, 2, 3].includes(d.rounds) ? d.rounds : 2;
        if (timer) { clearTimeout(timer); timer = null; }
        g = { by: userId, rounds, round: 1, players: [userId], goneAt: {}, order: [], turn: -1, drawer: '', word: '', shown: new Set(),
          phase: 'lobby', started: Date.now(), ends: 0, guessed: [], scores: {}, used: new Set(), swapped: false, last: '', feed: [] };
        say(`${name(userId)} opened a game of Draw & Guess (${rounds} ${rounds === 1 ? 'round' : 'rounds'}). Press Join to play.`);
        if (tick) clearInterval(tick);
        tick = setInterval(() => { try { everySecond(); } catch (e) { console.error('[drawguess]', e); } }, 1000);
        tick.unref?.();
        return push();
      }
      if (!g) return;
      if (d.do === 'guess') return guess(userId, d.text);
      if (d.do === 'join') { if (g.phase === 'over') return; join(userId); return push(); }
      if (d.do === 'leave') {
        if (!g.players.includes(userId)) return;
        g.players = g.players.filter((x) => x !== userId);
        say(`${name(userId)} left the game.`);
        if (g.phase === 'lobby' && !g.players.length) return close();
        if (g.phase === 'drawing' && userId === g.drawer) return endTurn(`${name(userId)} left while drawing, so that turn is over.`);
        if ((g.phase === 'drawing' || g.phase === 'between') && g.players.length < 2) return end('Draw & Guess is over: not enough players are left.');
        return push();
      }
      if (d.do === 'begin' && g.phase === 'lobby') {
        if (!g.players.includes(userId)) return;
        const on = g.players.filter(isOn);
        if (on.length < 2) return w.tell(userId, 'Draw & Guess needs at least two players. Somebody else has to press Join.');
        // the one who opened it draws first (if they are still in), then the others in the order they joined
        g.players = on;
        g.order = [...on.filter((id) => id === g!.by), ...on.filter((id) => id !== g!.by)].filter((id) => w.canDraw(id));
        if (!g.order.length) return w.tell(userId, 'Nobody in the game is on a computer to draw.');
        g.turn = -1;
        borrowBoard((id) => !!g && g.phase === 'drawing' && id === g.drawer);
        say('The game is on.');
        return next();
      }
      if (d.do === 'stop' && g.phase !== 'over') {
        if (g.phase === 'lobby') { say(`${name(userId)} put the game away.`); return close(); }
        return end(`${name(userId)} stopped the game.`);
      }
      if (d.do === 'swap' && g.phase === 'drawing' && userId === g.drawer && !g.swapped && !g.guessed.length) {
        g.swapped = true;
        g.word = newWord();
        g.shown = new Set();
        push();
      }
    },
  };
}
