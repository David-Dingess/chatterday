import { useState } from 'react';
import { api } from '../api';
import { toast, useStore } from '../store';
import { lookOf } from '../sprites';
import type { Desk, Look, Me, PetLook } from '../types';
import { DEFAULT_DESK } from '../../../shared/desk.ts';
import { DeskEditor, LookEditor, PERSON_COLORS, PetEditor } from './Builders';

// The first thing somebody new sees after picking their name and password: they make their character, then a pet
// if they want one, then set up their desk. Nothing is saved until the last step, and all of it can be changed
// later in Settings.

const STEPS = ['You', 'Your pet', 'Your desk'] as const;

export function Welcome() {
  const me = useStore((s) => s.me)!;
  const serverName = useStore((s) => s.settings.serverName);
  const [step, setStep] = useState(0);
  const [look, setLook] = useState<Look>(() => lookOf(me));
  const [color, setColor] = useState(me.color);
  const [pet, setPet] = useState<PetLook | null>(me.pet);
  const [desk, setDesk] = useState<Desk>(me.desk ?? DEFAULT_DESK);
  const [busy, setBusy] = useState(false);

  const finish = async () => {
    setBusy(true);
    try {
      const r = await api<{ me: Me }>('/profile', { look, pet, desk, color });
      useStore.setState({ me: r.me, settingsOpen: me.role === 'admin' ? 'admin' : null });
      if (me.role === 'admin') toast('You are in. Next: invite people, and set the place up, here in Admin.');
    } catch (e: any) { toast(e.message); setBusy(false); }
  };

  return (
    <div className="welcome">
      <header>
        <h1>Welcome to {serverName}, {me.name}</h1>
        <ol>{STEPS.map((s, k) => <li key={s} className={k === step ? 'now' : k < step ? 'done' : ''}><button disabled={k > step} onClick={() => setStep(k)}>{k + 1}. {s}</button></li>)}</ol>
      </header>
      <div className="welcome-body">
        {step === 0 && (
          <>
            <p className="hint">This is who walks around the house for you. Everyone sees it; change it whenever you like from the wardrobe in the bunk room, or in Settings.</p>
            <LookEditor value={look} onChange={setLook} accent={color}>
              <h3>Your colour</h3>
              <p className="hint">Your name tag, your headset and blanket, and the lights on your desk.</p>
              <div className="dots">
                {PERSON_COLORS.map((c) => <button key={c} className={c === color ? 'active' : ''} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />)}
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} title="Any colour" />
              </div>
            </LookEditor>
          </>
        )}
        {step === 1 && (
          <>
            <p className="hint">A pet is in the house whenever you are: it wanders about, eats, naps, and comes to sit by people. Anyone can stop to pet it. You do not have to have one.</p>
            <PetEditor value={pet} onChange={setPet} />
          </>
        )}
        {step === 2 && (
          <>
            <p className="hint">The house has six desks and nobody owns one. Whichever you sit at lights up in your colour, with your thing on it, while you are there.</p>
            <DeskEditor value={desk} onChange={setDesk} accent={color} />
          </>
        )}
      </div>
      <footer>
        {step > 0 && <button onClick={() => setStep(step - 1)}>Back</button>}
        <span />
        {step < STEPS.length - 1
          ? <button className="primary" onClick={() => setStep(step + 1)}>Next: {STEPS[step + 1].toLowerCase()}</button>
          : <button className="primary" disabled={busy} onClick={() => void finish()}>{busy ? 'One moment…' : 'Walk in'}</button>}
      </footer>
    </div>
  );
}
