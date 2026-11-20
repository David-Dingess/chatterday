// The trophy rack in the unfinished basement (not a fit-out of its own: it rides the same plumbing as the sudoku book and
// the robot vacuum, { t: 'fit', id: 'trophies', op }; client/src/achievements.tsx is the page's side). The achievements
// themselves are counted in server/achievements.ts; this only passes them to the pages.
//   hello / { state }            everybody's: the list and who has earned what, when (sent again whenever anybody earns one)
//   { op: 'got', ids } to one    what they have just earned, for their toast (nobody else is told)
//   { op: 'load' }               -> { op: 'progress', progress } to them: everybody's counters, for the progress bars
//   { op: 'test', ach }          only on a test server (CHATTERDAY_ACH_TEST=1): earns that one, to try the toasts
import { achieve } from '../achievements.ts';
import type { FitGame, FitOut } from '../floor.ts';

let out: FitOut;
const TEST = process.env.CHATTERDAY_ACH_TEST === '1';

const game: FitGame = {
  start(o) {
    out = o;
    achieve.backfill();
    achieve.listen((uid, ids) => {
      out.to(uid, { op: 'got', ids, defs: ids.map((id) => achieve.def(id)).filter(Boolean) });
      out.all({ state: achieve.board() });
    });
  },
  hello: () => achieve.board(),
  message(uid, d) {
    if (d.op === 'load') out.to(uid, { op: 'progress', progress: achieve.progress() });
    else if (d.op === 'test' && TEST && typeof d.ach === 'string') achieve.award(uid, d.ach);
  },
};
export default game;
