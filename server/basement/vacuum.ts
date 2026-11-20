// The robot vacuum upstairs (not a basement fit-out: it only rides on the same plumbing, a module here that the page
// talks to as { t: 'fit', id: 'vacuum', op }; client/src/vacuum.tsx is the page's side). The page works out when it
// runs and where it goes from the clock; all the server keeps is the buttons pressed on it, Start cleaning or Send it
// home, and when (its own clock), for the last hour: every page folds them into the run where they fall.
import type { FitGame, FitOut } from '../floor.ts';
import { achieve } from '../achievements.ts';

type Order = { op: 'start' | 'home'; at: number };
const KEEP_MS = 60 * 60_000, KEEP_MAX = 40;
let out: FitOut;
let orders: Order[] = [];
const recent = () => orders.filter((o) => Date.now() - o.at < KEEP_MS).slice(-KEEP_MAX);

const game: FitGame = {
  start(o) { out = o; const kept = o.load<Order[]>('orders', []); orders = Array.isArray(kept) ? kept : []; },
  hello: () => ({ orders: recent() }),
  message(uid, d) {
    if (d.op !== 'start' && d.op !== 'home') return;
    const now = Date.now(), last = orders[orders.length - 1];
    if (last && now - last.at < 1500) return;                       // (two people pressing at once: the first counts)
    if (d.op === 'start') achieve.count(uid, 'vacuum');
    orders = [...recent(), { op: d.op, at: now }];
    out.save('orders', orders);
    out.all({ state: { orders } });
  },
};
export default game;
