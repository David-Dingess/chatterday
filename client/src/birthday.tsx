// A birthday in the room (server/basement/birthday.ts keeps it): a cake on the kitchen table with its candles lit,
// which anyone can blow out (once; everybody sees them go out, in a puff of smoke), and a card standing beside it that
// everybody signs, one short message each. The neon sign is in the birthday person's colour for the day.
// `?date=MM-DD` in the address previews a day: the cake and the card are then this page's alone, and nothing is saved.
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { CLUB } from './clubhouse.gen';
import { CAKE_FRAMES, CAKE_H, CAKE_W, CARD_H, CARD_W, cakeFrame, cardPic, WICKS } from './cake';
import type { Pic } from './cake';
import { hooks, send, useStore } from './store';
import { personColor } from './sprites';
import { SureButton } from './components/ui';
import './birthday.css';

type Signed = Record<string, { text: string; at: number }>;
export type Birthday = { year: string; day: string; people: string[]; blown: { by: string; at: number } | null; cards: Record<string, Signed> };

const SIGN_MAX = 140;                                              // (as server/basement/birthday.ts)
const FORCED = (() => { const d = new URLSearchParams(location.search).get('date'); return d && /^\d\d-\d\d$/.test(d) ? d : null; })();
// Where it all stands: on the kitchen table (CLUB.games is its top), the cake over the hand of cards on its right, the
// card in front of it to the left; just in front of the table itself in depth.
const [TX, TY] = CLUB.games;
const CAKE_AT = [TX + 30, TY - 9], CARD_AT = [TX + 19, TY + 10], Z = TY + 31;

const useLocal = create<{ menu: boolean; open: string | null; puff: number; preview: { blown: Birthday['blown']; cards: Record<string, Signed> } }>(() => ({
  menu: false, open: null, puff: 0, preview: { blown: null, cards: {} },
}));
hooks.fit.push((d) => { if (d.id === 'birthday' && d.puff) useLocal.setState({ puff: Date.now() }); });

/** Today's birthday, if it is anybody's: from the server, or the day previewed. */
export function useBirthday(): Birthday | null {
  const real = useStore((s) => s.fits.birthday as Birthday | null | undefined);
  const users = useStore((s) => s.users);
  const preview = useLocal((s) => s.preview);
  return useMemo(() => {
    if (!FORCED) return real?.people?.length ? real : null;
    const people = Object.values(users).filter((u) => u.role !== 'removed' && u.birthday === FORCED).sort((a, b) => a.name.localeCompare(b.name)).map((u) => u.id);
    return people.length ? { year: 'preview', day: FORCED, people, ...preview } : null;
  }, [real, users, preview]);
}

function blow() {
  if (!FORCED) return send({ t: 'fit', id: 'birthday', op: 'blow' });
  const me = useStore.getState().me?.id ?? '';
  useLocal.setState((s) => ({ puff: Date.now(), preview: { ...s.preview, blown: s.preview.blown ?? { by: me, at: Date.now() } } }));
}
function sign(forId: string, text: string) {
  if (!FORCED) return send({ t: 'fit', id: 'birthday', op: 'sign', for: forId, text });
  const me = useStore.getState().me?.id ?? '';
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, SIGN_MAX);
  useLocal.setState((s) => {
    const card = { ...(s.preview.cards[forId] ?? {}) };
    if (clean) card[me] = { text: clean, at: card[me]?.at ?? Date.now() }; else delete card[me];
    return { preview: { ...s.preview, cards: { ...s.preview.cards, [forId]: card } } };
  });
}

// The pictures, drawn here once per colour, at 4x like the room's own art (scaled down to the room smoothly).
const SCALE = 4;
const toUrl = (pics: Pic[]) => {
  const w = pics.reduce((n, p) => n + p.w, 0), h = Math.max(...pics.map((p) => p.h));
  const one = document.createElement('canvas'), big = document.createElement('canvas');
  one.width = w; one.height = h; big.width = w * SCALE; big.height = h * SCALE;
  let x = 0;
  for (const p of pics) { one.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(p.px), p.w, p.h), x, 0); x += p.w; }
  const g = big.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.drawImage(one, 0, 0, big.width, big.height);
  return big.toDataURL();
};
const art = new Map<string, { cake: string; card: string }>();
function artFor(colour: string) {
  let a = art.get(colour);
  if (!a) art.set(colour, (a = { cake: toUrl(Array.from({ length: CAKE_FRAMES }, (_, f) => cakeFrame(colour, f))), card: toUrl([cardPic(colour)]) }));
  return a;
}

const nameOf = (id: string) => useStore.getState().users[id]?.name ?? 'Somebody';
const names = (ids: string[]) => ids.map(nameOf).join(' and ');

/** The neon sign on the wall: its own warm white, or on somebody's birthday their colour for the day. */
export const BirthdayNeon = memo(function BirthdayNeon({ at }: { at: number[] }) {
  const b = useBirthday();
  const user = useStore((s) => (b ? s.users[b.people[0]] : undefined));
  const style: CSSProperties = { left: at[0], top: at[1], width: at[2], height: at[3] };
  if (!b) return <i className="club-neon" style={style} />;
  return <i className="club-neon bday" style={{ ...style, '--bc': personColor(user) } as CSSProperties} />;
});

/** The cake and the card on the kitchen table (in the room, in its own coordinates). */
export const BirthdayCake = memo(function BirthdayCake({ mini }: { mini: boolean }) {
  const b = useBirthday();
  const user = useStore((s) => (b ? s.users[b.people[0]] : undefined));
  const { menu, open, puff } = useLocal();
  const menuNode = useRef<HTMLDivElement>(null);
  const [, redraw] = useState(0);
  const puffing = Date.now() - puff < 3200;
  useEffect(() => { if (puffing) { const t = window.setTimeout(() => redraw((n) => n + 1), 3300); return () => window.clearTimeout(t); } }, [puff, puffing]);
  useEffect(() => {
    if (!menu) return;
    const away = (e: PointerEvent) => { if (!menuNode.current?.contains(e.target as Node)) useLocal.setState({ menu: false }); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [menu]);
  if (!b) return null;
  const pics = artFor(personColor(user));
  const lit = !b.blown;
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  const live = !mini;
  return (
    <>
      {lit && <i className="bday-glow" style={{ left: CAKE_AT[0] - 8, top: CAKE_AT[1] - 8, width: CAKE_W + 16, height: 24, zIndex: Z }} />}
      <i className={`bday-cake${lit ? ' lit' : ''}${live ? ' clicky' : ''}`} style={{ left: CAKE_AT[0], top: CAKE_AT[1], width: CAKE_W, height: CAKE_H, zIndex: Z + 1, backgroundImage: `url(${pics.cake})` }}
        title={live ? (lit ? `${names(b.people)}'s birthday cake: blow out the candles, or sign the card` : `${nameOf(b.blown!.by)} blew out the candles`) : undefined}
        onMouseMove={live ? stop : undefined} onClick={live ? (e) => { stop(e); useLocal.setState({ menu: !menu }); } : undefined} />
      <i className={`bday-tent${live ? ' clicky' : ''}`} style={{ left: CARD_AT[0], top: CARD_AT[1], width: CARD_W, height: CARD_H, zIndex: Z + 2, backgroundImage: `url(${pics.card})` }}
        title={live ? `${names(b.people)}'s birthday card: open it` : undefined}
        onMouseMove={live ? stop : undefined} onClick={live ? (e) => { stop(e); useLocal.setState({ open: b.people[0], menu: false }); } : undefined} />
      {puffing && WICKS.map(([x, y], k) => [0, 1, 2].map((n) => (
        <i key={`${k}-${n}`} className="bday-smoke" style={{ left: CAKE_AT[0] + x - 1 + (n % 2), top: CAKE_AT[1] + y - 2, zIndex: Z + 3, animationDelay: `${n * 0.35 + k * 0.07}s` }} />
      )))}
      {menu && live && (
        <div ref={menuNode} className="act-menu" style={{ left: Math.min(CLUB.w - 80, CAKE_AT[0] + CAKE_W + 2), top: CAKE_AT[1] + 2, zIndex: 4000 }} onClick={stop}>
          <b>{names(b.people)}'s birthday</b>
          {lit && <button onClick={() => { blow(); useLocal.setState({ menu: false }); }}>Blow out the candles</button>}
          <button onClick={() => useLocal.setState({ open: b.people[0], menu: false })}>Open the card</button>
        </div>
      )}
      {open && live && createPortal(<Card b={b} />, document.querySelector('.main-view') ?? document.body)}
    </>
  );
});

/** The card, opened up: the front on the left (the cake, and who it is for), everybody's messages inside on the right,
 *  and a box for mine. The birthday person reads theirs; they do not sign it. */
function Card({ b }: { b: Birthday }) {
  const open = useLocal((s) => s.open);
  const forId = open && b.people.includes(open) ? open : b.people[0];
  const me = useStore((s) => s.me);
  const users = useStore((s) => s.users);
  const signed = b.cards[forId] ?? {};
  const mine = me ? signed[me.id]?.text ?? '' : '';
  const [draft, setDraft] = useState(mine);
  useEffect(() => setDraft(mine), [mine, forId]);
  const close = () => useLocal.setState({ open: null });
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);
  const downOn = useRef(false);
  const theirs = users[forId];
  const colour = personColor(theirs);
  const pics = artFor(colour);
  const isMe = me?.id === forId;
  const lines = Object.entries(signed).sort((x, y) => x[1].at - y[1].at);
  const changed = draft.trim() !== mine;
  return (
    <div className="bday-overlay" onMouseDown={(e) => { downOn.current = e.target === e.currentTarget; }} onClick={(e) => { if (downOn.current && e.target === e.currentTarget) close(); }}>
      <div className="bday-card" style={{ '--bc': colour } as CSSProperties} onClick={(e) => e.stopPropagation()}>
        <section className="bday-front">
          {b.people.length > 1 && (
            <nav className="bday-whose">{b.people.map((id) => <button key={id} className={id === forId ? 'on' : ''} onClick={() => useLocal.setState({ open: id })}>{nameOf(id)}</button>)}</nav>
          )}
          <h2>Happy Birthday</h2>
          <i className={`bday-cake big${b.blown ? '' : ' lit'}`} style={{ width: CAKE_W * 6, height: CAKE_H * 6, backgroundImage: `url(${pics.cake})` }} />
          <p className="bday-for">for <b>{theirs?.name ?? 'somebody'}</b></p>
          {b.blown ? <p className="bday-note">{b.blown.by === me?.id ? 'You' : nameOf(b.blown.by)} blew out the candles.</p>
            : <button className="bday-blow" onClick={blow}>Blow out the candles</button>}
        </section>
        <section className="bday-inside">
          <header><span>{isMe ? 'Your card. Everybody signs it.' : lines.length ? `Signed by ${lines.length} so far` : 'Not signed yet'}</span><button onClick={close} title="Close (Esc)">Close</button></header>
          <ol className="bday-lines">
            {lines.length === 0 && <li className="bday-empty">{isMe ? 'Nobody has signed it yet.' : 'Nobody has signed it yet. Be the first.'}</li>}
            {lines.map(([id, s]) => (
              <li key={id}><p>{s.text}</p><cite style={{ borderColor: personColor(users[id]) }}>{id === me?.id ? 'you' : nameOf(id)}</cite></li>
            ))}
          </ol>
          {!isMe && me && (
            <div className="bday-sign">
              <textarea value={draft} maxLength={SIGN_MAX} rows={2} placeholder={`Write something for ${theirs?.name ?? 'them'}`}
                onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (changed && draft.trim()) sign(forId, draft); } }} />
              <div>
                <small>{SIGN_MAX - draft.length} left</small>
                {mine && <SureButton onSure={() => sign(forId, '')}>Take mine off</SureButton>}
                <button className="primary" disabled={!changed || !draft.trim()} onClick={() => sign(forId, draft)}>{mine ? 'Save' : 'Sign it'}</button>
              </div>
            </div>
          )}
          {FORCED && <p className="bday-preview">A preview of {FORCED}: nothing on this card is saved.</p>}
        </section>
      </div>
    </div>
  );
}
