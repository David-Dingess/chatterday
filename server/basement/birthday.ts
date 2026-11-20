// A birthday upstairs (not a basement fit-out: it only rides on the same plumbing, a module here that the page talks to
// as { t: 'fit', id: 'birthday', ... }; client/src/birthday.tsx is the page's side).
//
// On anybody's birthday (users.birthday, 'MM-DD' on the house's clock, server/clock.ts) there is a cake on the kitchen table with its
// candles lit, and a card beside it for that person.
//   the candles: anyone can blow them out, once; they stay out for the rest of the day (kept, under blown:<year>-<day>)
//     and are lit again on the next birthday;
//   the card: one short message from each person, which they can change or take back; the birthday person reads it but
//     does not sign their own. Kept for good (card:<year>:<user id>), so last year's is still there.
// The line in chat ("It's Sam's birthday") is the server's own (sayBirthdays in server/index.ts).
import { all } from '../db.ts';
import type { FitGame, FitOut } from '../floor.ts';
import { achieve } from '../achievements.ts';
import { houseToday } from '../clock.ts';

/** The longest message on the card: a line or two, not a letter. */
export const SIGN_MAX = 140;
type Card = Record<string, { text: string; at: number }>;

/** Today on the house's clock: ['2026', '11-18']. */
const today = () => houseToday();

let out: FitOut;
let shown = '';                     // what was last sent to everybody: the day and whose birthday it is

/** Whose birthday it is today (everybody's, if two share one). */
const people = (day: string) => all<{ id: string }>("SELECT id FROM users WHERE birthday = ? AND role != 'removed' ORDER BY name, id", day).map((u) => u.id);

function state() {
  const [year, day] = today();
  const ids = people(day);
  const cards: Record<string, Card> = {};
  for (const id of ids) cards[id] = out.load<Card>(`card:${year}:${id}`, {});
  return { year, day, people: ids, blown: ids.length ? out.load<{ by: string; at: number } | null>(`blown:${year}-${day}`, null) : null, cards };
}

const game: FitGame = {
  start(o) {
    out = o;
    shown = JSON.stringify([...today(), people(today()[1])]);
    // Midnight (and a birthday set or changed in Settings): everybody is told the new day's state.
    setInterval(() => {
      const now = JSON.stringify([...today(), people(today()[1])]);
      if (now === shown) return;
      shown = now;
      out.all({ state: state() });
    }, 20_000).unref?.();
  },
  hello: () => (out ? state() : null),
  message(uid, d) {
    const s = state();
    if (!s.people.length) return;
    if (d.op === 'blow') {
      if (s.blown) return;
      out.save(`blown:${s.year}-${s.day}`, { by: uid, at: Date.now() });
      achieve.award(uid, 'candles');
      out.all({ state: state(), puff: uid });
    } else if (d.op === 'sign') {
      const who = String(d.for ?? '');
      if (!s.people.includes(who) || who === uid) return;           // (nobody signs their own card)
      const text = String(d.text ?? '').replace(/\s+/g, ' ').trim().slice(0, SIGN_MAX);
      const card = { ...s.cards[who] };
      if (text) card[uid] = { text, at: card[uid]?.at ?? Date.now() };
      else delete card[uid];                                         // (an emptied message is taken back)
      out.save(`card:${s.year}:${who}`, card);
      out.all({ state: state() });
    }
  },
};
export default game;
