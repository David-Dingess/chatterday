import { useMemo, useRef, useState } from 'react';
import { api, upload } from '../api';
import { playSound } from '../sfx';
import { send, setPrefs, toast, toggleFav, useStore } from '../store';
import { Icon, Star, SureButton } from './ui';
import { doubleTap } from '../touch';

// ───────── soundboard (bottom dock) ─────────
// Sounds live on the server: whoever adds one, everybody gets the button.

export function SoundDock() {
  const everySound = useStore((s) => s.sounds);
  const sounds = useMemo(() => everySound.filter((x) => !x.entranceFor), [everySound]);        // (a person's own entrance clip is not a button)
  const users = useStore((s) => s.users);
  const inVoice = useStore((s) => s.voice.channelId != null);
  const soundVol = useStore((s) => s.prefs.soundVol);
  const playingNow = useStore((s) => s.soundBusy);
  const favs = useStore((s) => s.prefs.favSounds);
  // Starred ones first, in the order they were starred, above a line; the rest after it, as before.
  const [starred, rest] = useMemo(() => [
    sounds.filter((x) => favs[x.id]).sort((a, b) => favs[a.id] - favs[b.id]),
    sounds.filter((x) => !favs[x.id]),
  ], [sounds, favs]);
  const open = useStore((s) => s.prefs.dockOpen);
  const dockH = useStore((s) => s.prefs.dockH);
  const list = useRef<HTMLDivElement>(null);
  // The top edge can be dragged: up for more rows of buttons, down for fewer. Double-click fits them all in.
  const tallest = () => Math.round(window.innerHeight * 0.7);
  const fit = () => { if (list.current) setPrefs({ dockH: Math.max(40, Math.min(tallest(), list.current.scrollHeight + 2)) }); };
  const grab = (e: React.PointerEvent) => {
    // (from the height it is drawn at: the column on the right can hold it taller than dockH, and a drag must move it at once)
    const y0 = e.clientY, h0 = list.current?.clientHeight ?? dockH;
    const move = (ev: PointerEvent) => setPrefs({ dockH: Math.round(Math.max(40, Math.min(tallest(), h0 + y0 - ev.clientY))) });
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      document.body.classList.remove('dragging');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    document.body.classList.add('dragging');
    e.preventDefault();
  };
  const me = useStore((s) => s.me)!;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{ file: File; name: string; emoji: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!draft) return;
    setBusy(true);
    try {
      const f = await upload(draft.file, 'sound');
      await api('/sounds', { name: draft.name, emoji: draft.emoji, fileId: f.id });
      setDraft(null);
    } catch (e: any) { toast(e.message); }
    setBusy(false);
  }

  const button = (s: (typeof sounds)[number]) => (
    <span key={s.id} className="sound">
      <button className={(playingNow[s.id] ?? 0) > Date.now() ? 'playing' : ''} disabled={(playingNow[s.id] ?? 0) > Date.now()} title={(playingNow[s.id] ?? 0) > Date.now() ? 'Playing: it can be pressed again when it has finished' : `Added by ${users[s.userId]?.name ?? 'someone'}`}
        onClick={() => (inVoice ? send({ t: 'sound', id: s.id }) : void playSound(s))}>{s.name}</button>
      <button className={`fav${favs[s.id] ? ' on' : ''}`} title={favs[s.id] ? 'Take it out of your favorites' : 'Add to your favorites (just for you)'} aria-pressed={!!favs[s.id]}
        onClick={() => toggleFav(s.id)}><Star on={!!favs[s.id]} /></button>
      {editing && (s.userId === me.id || me.role === 'admin') &&
        <SureButton className="del" title="Delete for everyone" onSure={() => void api(`/sounds/${s.id}`, undefined, 'DELETE')}><Icon name="close" size={8} /></SureButton>}
    </span>
  );

  if (!open) {
    return <button className="dock closed" onClick={() => setPrefs({ dockOpen: true })}><Icon name="note" /> Soundboard · {sounds.length} <span><Icon name="up" size={12} /></span></button>;
  }
  return (
    <div className="dock">
      <div className="dock-grip" onPointerDown={grab} {...doubleTap(fit)} title="Drag to make the soundboard taller or shorter. Double-click to fit every sound." />
      {draft ? (
        <div className="dock-draft">
          <input autoFocus maxLength={24} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label="Name"
            onKeyDown={(e) => { if (e.key === 'Enter' && draft.name.trim()) void save(); }} />
          <button className="primary" disabled={busy || !draft.name.trim()} onClick={save}>{busy ? 'Adding…' : 'Add for everyone'}</button>
          <button onClick={() => setDraft(null)}>Cancel</button>
        </div>
      ) : (
        <div className="dock-sounds" ref={list} style={{ minHeight: dockH }}>
          {starred.map(button)}
          {starred.length > 0 && <div className="dock-favs"><span>favorites</span></div>}
          {rest.map(button)}
          {!sounds.length && <span className="empty">No sounds yet. Add one and the whole group gets it.</span>}
        </div>
      )}
      {/* the right-hand column: what it is, then the volume, then the buttons, each on its own line, so the sounds have
          all the width there is */}
      <div className="dock-side">
        <b>Soundboard</b>
        <small>{inVoice ? 'Everyone in voice hears it' : 'Only you hear it until you join voice'}</small>
        <label className="dock-vol" title="Soundboard volume (just for you)"><Icon name="speaker" />
          <input type="range" min={0} max={1} step={0.02} value={soundVol} onChange={(e) => setPrefs({ soundVol: Number(e.target.value) })} />
        </label>
        <div className="dock-tools">
        <label className="btn" title="Add a sound for the whole group"><Icon name="plus" />Add
          <input type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac" hidden onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) setDraft({ file, name: file.name.replace(/\.[^.]+$/, '').slice(0, 24), emoji: 'note' });
            e.target.value = '';
          }} />
        </label>
        {sounds.length > 0 && <button className={editing ? 'primary' : ''} onClick={() => setEditing(!editing)}>{editing ? 'Done' : 'Edit'}</button>}
        <button className="icon" title="Hide the soundboard" onClick={() => setPrefs({ dockOpen: false })}><Icon name="down" /></button>
        </div>
      </div>
    </div>
  );
}
