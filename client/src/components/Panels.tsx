import { useMemo, useRef, useState } from 'react';
import { api, upload } from '../api';
import { playSound } from '../sfx';
import { send, setPrefs, toast, useStore } from '../store';
import { Icon, SureButton } from './ui';

// ───────── soundboard (bottom dock) ─────────
// Sounds live on the server: whoever adds one, everybody gets the button.

export function SoundDock() {
  const everySound = useStore((s) => s.sounds);
  const sounds = useMemo(() => everySound.filter((x) => !x.entranceFor), [everySound]);        // (a person's own entrance clip is not a button)
  const users = useStore((s) => s.users);
  const inVoice = useStore((s) => s.voice.channelId != null);
  const soundVol = useStore((s) => s.prefs.soundVol);
  const playingNow = useStore((s) => s.soundBusy);
  const open = useStore((s) => s.prefs.dockOpen);
  const dockH = useStore((s) => s.prefs.dockH);
  const list = useRef<HTMLDivElement>(null);
  // The top edge can be dragged: up for more rows of buttons, down for fewer. Double-click fits them all in.
  const tallest = () => Math.round(window.innerHeight * 0.7);
  const fit = () => { if (list.current) setPrefs({ dockH: Math.max(40, Math.min(tallest(), list.current.scrollHeight + 2)) }); };
  const grab = (e: React.PointerEvent) => {
    const y0 = e.clientY, h0 = Math.min(dockH, list.current?.clientHeight ?? dockH);
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

  if (!open) {
    return <button className="dock closed" onClick={() => setPrefs({ dockOpen: true })}><Icon name="note" /> Soundboard · {sounds.length} <span><Icon name="up" size={12} /></span></button>;
  }
  return (
    <div className="dock">
      <div className="dock-grip" onPointerDown={grab} onDoubleClick={fit} title="Drag to make the soundboard taller or shorter. Double-click to fit every sound." />
      <div className="dock-side">
        <b>Soundboard</b>
        <small>{inVoice ? 'Everyone in voice hears it' : 'Only you hear it until you join voice'}</small>
      </div>
      {draft ? (
        <div className="dock-draft">
          <input autoFocus maxLength={24} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label="Name"
            onKeyDown={(e) => { if (e.key === 'Enter' && draft.name.trim()) void save(); }} />
          <button className="primary" disabled={busy || !draft.name.trim()} onClick={save}>{busy ? 'Adding…' : 'Add for everyone'}</button>
          <button onClick={() => setDraft(null)}>Cancel</button>
        </div>
      ) : (
        <div className="dock-sounds" ref={list} style={{ maxHeight: dockH }}>
          {sounds.map((s) => (
            <span key={s.id} className="sound">
              <button className={(playingNow[s.id] ?? 0) > Date.now() ? 'playing' : ''} disabled={(playingNow[s.id] ?? 0) > Date.now()} title={(playingNow[s.id] ?? 0) > Date.now() ? 'Playing: it can be pressed again when it has finished' : `Added by ${users[s.userId]?.name ?? 'someone'}`}
                onClick={() => (inVoice ? send({ t: 'sound', id: s.id }) : void playSound(s))}>{s.name}</button>
              {editing && (s.userId === me.id || me.role === 'admin') &&
                <SureButton className="del" title="Delete for everyone" onSure={() => void api(`/sounds/${s.id}`, undefined, 'DELETE')}><Icon name="close" size={8} /></SureButton>}
            </span>
          ))}
          {!sounds.length && <span className="empty">No sounds yet. Add one and the whole group gets it.</span>}
        </div>
      )}
      <div className="dock-tools">
        <label className="dock-vol" title="Soundboard volume (just for you)"><Icon name="speaker" />
          <input type="range" min={0} max={1} step={0.02} value={soundVol} onChange={(e) => setPrefs({ soundVol: Number(e.target.value) })} />
        </label>
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
  );
}
