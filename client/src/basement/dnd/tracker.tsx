// The initiative tracker: a slate board hanging on the DnD room's wall (whose turn it is at the top, then who comes
// next, and the round), and the tracker itself, the same in the war table's Initiative tab and opened large from the wall.
// server/basement/dnd.ts keeps it and says who may do what: the DM runs it; a player may put their own character in,
// roll or set its number, and end their own turn.
import { useState } from 'react';
import { SureButton } from '../../components/ui';

export type Init = { id: string; name: string; init: number; token: string; hp: number; maxHp: number; owner?: string; bonus?: number; foe?: boolean; hidden?: boolean };
type Tok = { id: string; color: string; hidden: boolean };
export type TrackerSt = { dm: string; tokens: Tok[]; init: { round: number; turn: number; list: Init[] } };
export type TrackerApi = { me: string; act: (op: string, rest?: Record<string, unknown>) => void; colorOf: (uid: string) => string };

const FOE = '#b02a30';
/** Its colour: its token's, or its player's, or a monster's red. */
export const entryColor = (st: TrackerSt, e: Init, api: TrackerApi) => st.tokens.find((t) => t.id === e.token)?.color ?? (!e.foe && e.owner ? api.colorOf(e.owner) : FOE);
/** Hidden from me (a hidden monster, and I am not the DM). */
const veiled = (st: TrackerSt, e: Init, me: string) => !!st.dm && st.dm !== me && (!!e.hidden || !!st.tokens.find((t) => t.id === e.token)?.hidden);
const signed = (n: number) => (n >= 0 ? `+${n}` : String(n));

/** The board on the wall: `at` is [x, y, width, height] in the room's dots. */
export function WallBoard({ st, api, at, z, onOpen }: { st: TrackerSt | null; api: TrackerApi; at: number[]; z: number; onOpen?: () => void }) {
  const I = st?.init;
  const n = I?.list.length ?? 0;
  const rows = I && n ? Array.from({ length: Math.min(3, n) }, (_, k) => I.list[(I.turn + k) % n]) : [];
  return (
    <div className="dnd-wallboard" style={{ left: at[0], top: at[1], width: at[2], height: at[3], zIndex: z }}
      title="Initiative: click to open it large" onClick={(e) => { e.stopPropagation(); onOpen?.(); }}>
      <i className="nail" />
      <b className="hd">{n ? `ROUND ${I!.round}` : 'INITIATIVE'}</b>
      {/* (whose turn it is, then the next two: the rest are in the tracker, a click away) */}
      {rows.map((e, k) => {
        const v = veiled(st!, e, api.me);
        return (
          <div key={e.id} className={k === 0 ? 'now' : ''}>
            <i style={{ background: v ? '#6a6a6a' : entryColor(st!, e, api) }} />
            <span>{v ? '???' : e.name.slice(0, 7)}</span>
            <em>{v ? '' : e.init}</em>
          </div>
        );
      })}
    </div>
  );
}

/** The whole tracker. `big`: opened from the wall (more room, bigger type). */
export function Tracker({ st, api, big = false }: { st: TrackerSt; api: TrackerApi; big?: boolean }) {
  const { me, act } = api;
  const [name, setName] = useState('');
  const [init, setInit] = useState('');
  const [bonus, setBonus] = useState('');
  const I = st.init;
  const boss = !st.dm || st.dm === me;
  const mine = (e: Init) => boss || (!!e.owner && e.owner === me);
  const cur = I.list[I.turn];
  return (
    <div className={`dnd-init${big ? ' big' : ''}`}>
      <div className="row">
        <b>Round {I.round}</b>
        {boss && <button onClick={() => act('init', { act: 'prev' })} disabled={!I.list.length}>Back</button>}
        {boss && <button className="go" onClick={() => act('init', { act: 'next' })} disabled={!I.list.length}>Next turn</button>}
        {!boss && cur && cur.owner === me && <button className="go" onClick={() => act('init', { act: 'next', from: cur.id })}>End my turn</button>}
        <span className="gap" />
        {boss && <button onClick={() => act('init', { act: 'tokens' })} title="Every token on the map not already in: d20 plus Dex (from its sheet), into the log">Roll in the tokens</button>}
        {boss && I.list.length > 0 && <button onClick={() => act('init', { act: 'restart' })} title="The same order, from the top of round 1">Round 1</button>}
        {boss && I.list.length > 0 && <SureButton className="danger" onSure={() => act('init', { act: 'clear' })} title="Take everybody out">Clear</SureButton>}
      </div>
      {!I.list.length && <p className="muted">Nobody in yet. {boss ? 'Add monsters and NPCs below, or roll in the tokens on the map; players put their own characters in from a sheet or a token.' : 'Put your character in from your sheet or your token, or add yourself below.'}</p>}
      <ol>
        {I.list.map((e, k) => {
          const v = veiled(st, e, me), can = mine(e);
          return (
            <li key={e.id} className={`${k === I.turn ? 'now' : ''}${e.hidden ? ' hid' : ''}`}>
              <i className="chip" style={{ background: v ? '#6a6a6a' : entryColor(st, e, api) }} />
              {can && !v ? <input type="number" value={e.init} onChange={(ev) => act('init', { act: 'set', id: e.id, init: Number(ev.target.value) })} title="Initiative" />
                : <span className="num">{v ? '?' : e.init}</span>}
              <span className="nm">{v ? '???' : e.name}{e.foe && !v && <small> monster</small>}</span>
              {can && !v && <button className="d20" onClick={() => act('init', { act: 'roll', id: e.id })} title={`Roll again: d20${signed(e.bonus ?? 0)}, into the log`}>d20{signed(e.bonus ?? 0)}</button>}
              {(can || !e.foe) && !v && (e.maxHp > 0 || can) && (
                <label className="hp">HP {can ? <input type="number" value={e.hp} onChange={(ev) => act('init', { act: 'set', id: e.id, hp: Number(ev.target.value) })} /> : e.hp}{e.maxHp ? ` / ${e.maxHp}` : ''}</label>
              )}
              {boss && !!st.dm && <button className={e.hidden ? 'on' : ''} onClick={() => act('init', { act: 'set', id: e.id, hidden: !e.hidden })} title="Hidden: players see only ???">Hide</button>}
              {can && <button onClick={() => act('init', { act: 'remove', id: e.id })} title="Take them out">✕</button>}
            </li>
          );
        })}
      </ol>
      <form className="row" onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        const b = Number(bonus) || 0;
        act('init', init.trim() ? { act: 'add', name, init: Number(init), bonus: b } : { act: 'add', name, roll: true, bonus: b });
        setName(''); setInit(''); setBonus('');
      }}>
        <input placeholder={boss ? 'Name (a monster, an NPC…)' : 'Your character'} value={name} onChange={(e) => setName(e.target.value)} />
        <input className="small" placeholder="Bonus" value={bonus} onChange={(e) => setBonus(e.target.value)} title="Added to the d20 (Dex)" />
        <input className="small" placeholder="Init (blank: roll)" value={init} onChange={(e) => setInit(e.target.value)} />
        <button type="submit">Add</button>
      </form>
    </div>
  );
}
