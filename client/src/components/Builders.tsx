import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { api } from '../api';
import { deskPics, lookOf, petSheet, sheetFor, sheetOf } from '../sprites';
import { toast, useStore } from '../store';
import type { Desk, Look, Me, PetLook } from '../types';
import { DEFAULT_DESK, DESK_OPTIONS, randomDesk } from '../../../shared/desk.ts';
import { LOOK_OPTIONS, randomLook } from '../../../shared/look.ts';
import { DEFAULT_DOG, DEFAULT_PET, PET_OPTIONS, randomPet } from '../../../shared/pet.ts';
import { Sprite } from './ui';

// The builders: where somebody makes their character, their pet and their desk out of parts. Everything is drawn
// right here in the page as they click (client/src/draw), so there is no waiting, and nobody else sees a thing
// until it is saved. The lists of parts live in the shared folder, where the server reads them too.

/** The colours a person can be (any other colour is allowed too). */
export const PERSON_COLORS = ['#e5484d', '#ff8f2e', '#f2c230', '#3fbf63', '#2fd3c6', '#3b82f6', '#8b6be0', '#ff6fb7', '#9aa0b0', '#c9a36a'];

type Option = { id: string; label: string };

/** A row of choices; the one in use is lit. */
export function Picks({ value, options, onPick }: { value: string; options: readonly Option[]; onPick: (id: string) => void }) {
  return <div className="picks">{options.map((o) => <button key={o.id} className={value === o.id ? 'active' : ''} onClick={() => onPick(o.id)}>{o.label}</button>)}</div>;
}

/** A row of colours to pick from, and a box for any other colour. A swatch is a colour, or a colour with a name. */
export function Colours({ value, swatches, onPick }: { value: string; swatches: readonly (string | Option)[]; onPick: (c: string) => void }) {
  return (
    <div className="dots">
      {swatches.map((s) => {
        const c = typeof s === 'string' ? s : s.id, name = typeof s === 'string' ? s : s.label;
        return <button key={c} className={c.toLowerCase() === value.toLowerCase() ? 'active' : ''} style={{ background: c }} onClick={() => onPick(c)} title={name} aria-label={name} />;
      })}
      <input type="color" value={value} onChange={(e) => onPick(e.target.value)} title="Any colour" />
    </div>
  );
}

/** A value that follows another a moment later, so dragging a colour does not redraw a whole sheet for every shade on the way. */
export function useSettled<T>(value: T, ms = 90): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => { const t = window.setTimeout(() => setSettled(value), ms); return () => window.clearTimeout(t); }, [value, ms]);
  return settled;
}

/** One part of a builder: a heading and what can be picked under it. */
export const Part = ({ title, children }: { title: string; children: ReactNode }) => <><h3>{title}</h3>{children}</>;

export const saveProfile = async (patch: Record<string, unknown>, said = 'Saved.') => {
  try { const { me } = await api<{ me: Me }>('/profile', patch); useStore.setState({ me }); toast(said); return true; }
  catch (e: any) { toast(e.message); return false; }
};

// ───────────────────────── pets ─────────────────────────

/** A pet doing one thing, large: `row` is which row of its sheet (0 walk down, 1 walk left, 2 walk up, 3 sit, 4 eat, 5 sleep, 6 being petted). */
function PetView({ url, row, ms = 1000 }: { url: string; row: number; ms?: number }) {
  return <span className="pet-view"><i className="pet-sprite" style={{ backgroundImage: `url(${url})`, '--row': row, '--dur': `${ms * 4}ms` } as CSSProperties} /></span>;
}

/** Builds a pet. `value` is null for no pet. */
export function PetEditor({ value, onChange }: { value: PetLook | null; onChange: (pet: PetLook | null) => void }) {
  const shown = useSettled(value);
  if (!value) {
    return (
      <div className="builder none">
        <p>No pet.</p>
        <div className="row">
          <button className="primary" onClick={() => onChange(DEFAULT_PET)}>Get a cat</button>
          <button className="primary" onClick={() => onChange(DEFAULT_DOG)}>Get a dog</button>
          <button onClick={() => onChange(randomPet(Math.floor(Math.random() * 1e9)))}>Surprise me</button>
        </div>
      </div>
    );
  }
  const set = (patch: Partial<PetLook>) => onChange({ ...value, ...patch });
  const parts = PET_OPTIONS[value.kind];
  const url = shown ? petSheet(shown) : '';
  /** Switching between cat and dog keeps the name and the colours, and takes the other animal's usual shape. */
  const switchKind = (kind: string) => {
    if (kind === value.kind) return;
    const base = kind === 'dog' ? DEFAULT_DOG : DEFAULT_PET;
    onChange({ ...base, name: value.name, coat: value.coat, coat2: value.coat2, collarColor: value.collarColor });
  };
  return (
    <div className="builder">
      <div className="builder-view">
        <div className="mirror pets">
          <PetView url={url} row={3} /><PetView url={url} row={1} ms={130} /><PetView url={url} row={4} ms={260} /><PetView url={url} row={5} />
        </div>
        <label className="hotkey">Its name<input maxLength={16} value={value.name} placeholder="Give it a name" onChange={(e) => set({ name: e.target.value })} /></label>
        <div className="row">
          <button onClick={() => onChange({ ...randomPet(Math.floor(Math.random() * 1e9)), name: value.name })}>Surprise me</button>
          <button onClick={() => onChange(null)}>No pet</button>
        </div>
      </div>
      <div className="builder-parts">
        <Part title="Animal"><Picks value={value.kind} options={PET_OPTIONS.kind} onPick={switchKind} /></Part>
        <Part title="Build"><Picks value={value.build} options={parts.build} onPick={(build) => set({ build })} /></Part>
        <Part title="Coat">
          <Picks value={value.pattern} options={parts.pattern} onPick={(pattern) => set({ pattern })} />
          <Colours value={value.coat} swatches={PET_OPTIONS.coats} onPick={(coat) => set({ coat })} />
          <p className="hint">Its second colour (white bits, patches or points, depending on the coat):</p>
          <Colours value={value.coat2} swatches={PET_OPTIONS.coats} onPick={(coat2) => set({ coat2 })} />
        </Part>
        <Part title="Fur"><Picks value={value.fur} options={parts.fur} onPick={(fur) => set({ fur })} /></Part>
        <Part title="Ears"><Picks value={value.ears} options={parts.ears} onPick={(ears) => set({ ears })} /></Part>
        <Part title="Tail"><Picks value={value.tail} options={parts.tail} onPick={(tail) => set({ tail })} /></Part>
        <Part title="Eyes"><Colours value={value.eyes} swatches={PET_OPTIONS.eyes} onPick={(eyes) => set({ eyes })} /></Part>
        <Part title="Nose"><Colours value={value.nose} swatches={PET_OPTIONS.noses} onPick={(nose) => set({ nose })} /></Part>
        <Part title="Collar">
          <Picks value={value.collar} options={parts.collar} onPick={(collar) => set({ collar })} />
          {value.collar !== 'none' && <Colours value={value.collarColor} swatches={PET_OPTIONS.collarColors} onPick={(collarColor) => set({ collarColor })} />}
        </Part>
      </div>
    </div>
  );
}

/** The pet page in Settings: change it, then save. */
export function PetBuilder() {
  const me = useStore((s) => s.me)!;
  const [pet, setPet] = useState<PetLook | null>(me.pet);
  const changed = JSON.stringify(pet) !== JSON.stringify(me.pet);
  return (
    <>
      <PetEditor value={pet} onChange={setPet} />
      <div className="builder-save">
        <button className="primary" disabled={!changed} onClick={() => void saveProfile({ pet }, pet ? `${pet.name || 'Your pet'} is in the house.` : 'No pet now.')}>Save</button>
        {changed && <button onClick={() => setPet(me.pet)}>Undo changes</button>}
        <small>{changed ? 'Nobody else sees this until you save.' : 'Your pet is in the house whenever you are online.'}</small>
      </div>
    </>
  );
}

// ───────────────────────── characters ─────────────────────────

const LOOK_TABS = [['body', 'Body'], ['face', 'Face'], ['hair', 'Hair'], ['clothes', 'Clothes'], ['extras', 'Hats and extras']] as const;
const dice = () => Math.floor(Math.random() * 1e9);

/** Builds a character. `accent` is the person's colour (their headset and blanket take it). Anything passed as
 *  children is shown at the end of the Body page (the welcome flow puts the colour picker there). */
export function LookEditor({ value, onChange, accent, children }: { value: Look; onChange: (look: Look) => void; accent: string; children?: ReactNode }) {
  const [tab, setTab] = useState<(typeof LOOK_TABS)[number][0]>('body');
  const shown = useSettled(value), tint = useSettled(accent);
  const url = sheetFor(shown, tint);
  const set = (patch: Partial<Look>) => onChange({ ...value, ...patch });
  const O = LOOK_OPTIONS;
  const toggleExtra = (id: string) => {
    const has = value.extras.includes(id);
    set({ extras: has ? value.extras.filter((x) => x !== id) : [...value.extras, id].slice(-O.maxExtras) });
  };
  return (
    <div className="builder">
      <div className="builder-view">
        <div className="mirror">
          <Sprite url={url} row="idle" frames={2} ms={600} scale={3} />
          <Sprite url={url} row="walk_left" frames={4} ms={170} scale={3} />
          <Sprite url={url} row="walk_up" frames={4} ms={170} scale={3} />
          <Sprite url={url} row="gaming" frames={2} ms={300} scale={3} />
        </div>
        <div className="row"><button onClick={() => onChange(randomLook(dice()))}>Surprise me</button></div>
      </div>
      <div className="builder-parts">
        <div className="seg">{LOOK_TABS.map(([id, label]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}</div>
        {tab === 'body' && (
          <>
            <Part title="Body type"><Picks value={value.body} options={O.body} onPick={(body) => set({ body })} /></Part>
            <Part title="Height"><Picks value={value.height} options={O.height} onPick={(height) => set({ height })} /></Part>
            <Part title="Skin"><Colours value={value.skin} swatches={O.skinColors} onPick={(skin) => set({ skin })} /></Part>
            {children}
          </>
        )}
        {tab === 'face' && (
          <>
            <Part title="Eyes">
              <Picks value={value.eyes} options={O.eyes} onPick={(eyes) => set({ eyes })} />
              <Colours value={value.eyeColor} swatches={O.eyeColors} onPick={(eyeColor) => set({ eyeColor })} />
            </Part>
            <Part title="Brows"><Picks value={value.brows} options={O.brows} onPick={(brows) => set({ brows })} /></Part>
            <Part title="Mouth"><Picks value={value.mouth} options={O.mouth} onPick={(mouth) => set({ mouth })} /></Part>
            <Part title="Marks"><Picks value={value.marks} options={O.marks} onPick={(marks) => set({ marks })} /></Part>
            <Part title="Glasses"><Picks value={value.glasses} options={O.glasses} onPick={(glasses) => set({ glasses })} /></Part>
          </>
        )}
        {tab === 'hair' && (
          <>
            <Part title="Hair">
              <Picks value={value.hair.style} options={O.hair} onPick={(style) => set({ hair: { ...value.hair, style } })} />
              <Colours value={value.hair.color} swatches={O.hairColors} onPick={(color) => set({ hair: { ...value.hair, color } })} />
            </Part>
            <Part title="Facial hair">
              <Picks value={value.facial.style} options={O.facial} onPick={(style) => set({ facial: { ...value.facial, style } })} />
              {value.facial.style !== 'none' && <Colours value={value.facial.color} swatches={O.hairColors} onPick={(color) => set({ facial: { ...value.facial, color } })} />}
              {value.facial.style !== 'none' && value.facial.color !== value.hair.color && <button onClick={() => set({ facial: { ...value.facial, color: value.hair.color } })}>Match my hair</button>}
            </Part>
          </>
        )}
        {tab === 'clothes' && (
          <>
            <Part title="Top">
              <Picks value={value.top.kind} options={O.top} onPick={(kind) => set({ top: { ...value.top, kind } })} />
              <Colours value={value.top.color} swatches={O.clothColors} onPick={(color) => set({ top: { ...value.top, color } })} />
            </Part>
            <Part title="Its pattern">
              <Picks value={value.top.pattern} options={O.pattern} onPick={(pattern) => set({ top: { ...value.top, pattern } })} />
              <p className="hint">A second colour, for the pattern (or for the shirt under a vest):</p>
              <Colours value={value.top.color2 ?? value.top.color} swatches={O.clothColors} onPick={(color2) => set({ top: { ...value.top, color2 } })} />
              {value.top.color2 && <button onClick={() => set({ top: { kind: value.top.kind, color: value.top.color, pattern: value.top.pattern } })}>Pick one to suit</button>}
            </Part>
            <Part title="Bottoms">
              <Picks value={value.bottom.kind} options={O.bottom} onPick={(kind) => set({ bottom: { ...value.bottom, kind } })} />
              <Colours value={value.bottom.color} swatches={O.clothColors} onPick={(color) => set({ bottom: { ...value.bottom, color } })} />
            </Part>
            <Part title="Shoes">
              <Picks value={value.shoes.kind} options={O.shoes} onPick={(kind) => set({ shoes: { ...value.shoes, kind } })} />
              {value.shoes.kind !== 'barefoot' && <Colours value={value.shoes.color} swatches={O.clothColors} onPick={(color) => set({ shoes: { ...value.shoes, color } })} />}
            </Part>
          </>
        )}
        {tab === 'extras' && (
          <>
            <Part title="On your head">
              <Picks value={value.hat.kind} options={O.hat} onPick={(kind) => set({ hat: { ...value.hat, kind } })} />
              {value.hat.kind !== 'none' && <Colours value={value.hat.color} swatches={O.clothColors} onPick={(color) => set({ hat: { ...value.hat, color } })} />}
            </Part>
            <Part title={`Extras (up to ${O.maxExtras})`}>
              <div className="picks">{O.extras.map((x) => <button key={x.id} className={value.extras.includes(x.id) ? 'active' : ''} onClick={() => toggleExtra(x.id)}>{x.label}</button>)}</div>
            </Part>
          </>
        )}
      </div>
    </div>
  );
}

/** The character page in Settings: change it, then save. */
export function CharacterBuilder() {
  const me = useStore((s) => s.me)!;
  const [look, setLook] = useState<Look>(() => lookOf(me));
  const changed = JSON.stringify(look) !== JSON.stringify(lookOf(me));
  return (
    <>
      <LookEditor value={look} onChange={setLook} accent={me.color} />
      <div className="builder-save">
        <button className="primary" disabled={!changed} onClick={() => void saveProfile({ look }, 'That is you now.')}>Save</button>
        {changed && <button onClick={() => setLook(lookOf(me))}>Undo changes</button>}
        <small>{changed ? 'Nobody else sees this until you save.' : 'Your colour is under Account.'}</small>
      </div>
    </>
  );
}

// ───────────────────────── desks ─────────────────────────

/** A desk as it will stand in the room: the chair, the desk, somebody sitting at it, and the chair's back in front of them. */
function DeskView({ desk, accent, sitter }: { desk: Desk; accent: string; sitter?: string }) {
  const pics = deskPics(desk, accent), { art } = pics;
  const layer = (url: string) => <i style={{ backgroundImage: `url(${url})` }} />;
  return (
    <span className="desk-view" style={{ width: art.desk.w, height: art.desk.h }}>
      {layer(pics.chair)}{layer(pics.desk)}
      {sitter && <span style={{ position: 'absolute', left: 1 - art.ox, top: 9 - art.oy }}><Sprite url={sitter} row="sit_back" first={2} frames={2} ms={340} scale={1} /></span>}
      {layer(pics.back)}
    </span>
  );
}

/** Sets up a desk: the colour of its lights, and the one thing on it. `accent` is the person's own colour, which the
 *  lights take unless another is picked. `sitter` is the sheet of whoever to show sitting at it. */
export function DeskEditor({ value, onChange, accent, sitter }: { value: Desk; onChange: (desk: Desk) => void; accent: string; sitter?: string }) {
  const set = (patch: Partial<Desk>) => onChange({ ...value, ...patch });
  const shown = useSettled(value);
  return (
    <div className="builder">
      <div className="builder-view">
        <div className="mirror desk"><DeskView desk={shown} accent={accent} sitter={sitter} /></div>
        <div className="row"><button onClick={() => onChange(randomDesk(dice()))}>Surprise me</button></div>
      </div>
      <div className="builder-parts">
        <Part title="Its lights">
          <p className="hint">The strip under the desk, the fans in the tower, the keyboard and the stripes on the chair.</p>
          <div className="picks"><button className={value.led === '' ? 'active' : ''} onClick={() => set({ led: '' })}>My own colour</button></div>
          <Colours value={value.led || accent} swatches={DESK_OPTIONS.ledColors} onPick={(led) => set({ led })} />
        </Part>
        <Part title="On the desk"><Picks value={value.item} options={DESK_OPTIONS.items} onPick={(item) => set({ item })} /></Part>
      </div>
    </div>
  );
}

/** The desk page in Settings: change it, then save. */
export function DeskBuilder() {
  const me = useStore((s) => s.me)!;
  const [desk, setDesk] = useState<Desk>(me.desk ?? DEFAULT_DESK);
  const changed = JSON.stringify(desk) !== JSON.stringify(me.desk ?? DEFAULT_DESK);
  return (
    <>
      <DeskEditor value={desk} onChange={setDesk} accent={me.color} sitter={sheetOf(me)} />
      <div className="builder-save">
        <button className="primary" disabled={!changed} onClick={() => void saveProfile({ desk }, 'Your desk is set up.')}>Save</button>
        {changed && <button onClick={() => setDesk(me.desk ?? DEFAULT_DESK)}>Undo changes</button>}
        <small>{changed ? 'Nobody else sees this until you save.' : 'Whichever desk you sit at looks like this while you are there.'}</small>
      </div>
    </>
  );
}
