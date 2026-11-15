import { useEffect, useRef, useState } from 'react';
import { setPrefs, toast, useStore } from '../store';
import { applyVolumes, screenTrack, setWatching } from '../voice';
import { Avatar, Icon } from './ui';

// ───────── a live screen, wherever it is shown ─────────

export function LiveVideo({ userId }: { userId: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const rev = useStore((s) => s.voice.rev);
  useEffect(() => {
    const track = screenTrack(userId);
    const el = ref.current;
    if (!track || !el) return;
    track.attach(el);
    return () => { track.detach(el); };
  }, [userId, rev]);
  return <video ref={ref} autoPlay playsInline muted />;
}

function StreamTile({ id, big = false, onPick }: { id: string; big?: boolean; onPick: () => void }) {
  const user = useStore((s) => s.users[id]);
  const meId = useStore((s) => s.me?.id);
  const mediaVol = useStore((s) => s.prefs.mediaVol);
  const tile = useRef<HTMLDivElement>(null);
  const presence = useStore((s) => s.presence);
  const users = useStore((s) => s.users);
  // I have this screen open: its owner is told. (Not for my own.)
  useEffect(() => {
    if (id === meId) return;
    setWatching(id, true);
    return () => setWatching(id, false);
  }, [id, meId]);
  const eyes = Object.keys(presence).filter((u) => u !== id && presence[u].state !== 'offline' && presence[u].voice?.watching?.includes(id)).map((u) => users[u]?.name ?? 'someone');
  const full = () => void (document.fullscreenElement === tile.current ? document.exitFullscreen() : tile.current?.requestFullscreen());
  // The browser's own picture-in-picture: a small window that stays on top of everything, games included
  const pop = () => {
    const video = tile.current?.querySelector('video');
    if (!video) return;
    if (document.pictureInPictureElement === video) void document.exitPictureInPicture().catch(() => {});
    else void video.requestPictureInPicture().catch(() => toast('Could not pop this stream out.'));
  };
  return (
    <div className={`tile${big ? ' big' : ''}`} ref={tile} onDoubleClick={full}>
      <div className="frame" onClick={onPick} title={big ? 'Double-click for full screen' : 'Click to focus, double-click for full screen'}><LiveVideo userId={id} /></div>
      <div className="tile-bar">
        <Avatar user={user} size={22} /><b>{user?.name}{id === meId ? ' (you)' : ''}</b>
        {id !== meId && (
          <label title="Volume of this stream's sound"><Icon name="speaker" />
            <input type="range" min={0} max={1} step={0.05} value={mediaVol[id] ?? 0.7}
              onChange={(e) => { setPrefs({ mediaVol: { ...mediaVol, [id]: Number(e.target.value) } }); applyVolumes(); }} />
          </label>
        )}
        <span className="eyes" title={eyes.length ? `Watching: ${eyes.join(', ')}` : 'Nobody is watching yet'}><Icon name="eye" size={12} />{eyes.length}</span>
        <button className="icon" title="Full screen (Esc to leave)" onClick={full}><Icon name="full" /></button>
        <button className="icon pop" title="Pop out: a small window that stays on top while you do something else" onClick={pop}><Icon name="up" /></button>
      </div>
    </div>
  );
}

/** Like Discord's stream view: a grid of everyone sharing, or one stream large with the rest in a strip. */
export function Stage() {
  const screens = useStore((s) => s.voice.screens);
  const users = useStore((s) => s.users);
  const [focus, setFocus] = useState<string | null>(null);
  const stage = useRef<HTMLElement>(null);
  const focused = focus && screens.includes(focus) ? focus : screens.length === 1 ? screens[0] : null;
  const others = focused ? screens.filter((id) => id !== focused) : [];
  const cols = Math.ceil(Math.sqrt(screens.length));
  return (
    <section className="stage" ref={stage}>
      <header className="bar">
        <h2><Icon name="screen" /> {focused ? `${users[focused]?.name}'s screen` : `${screens.length} screens`}</h2>
        {screens.length > 1 && (
          <div className="seg">
            <button className={focused ? '' : 'active'} onClick={() => setFocus(null)}>Grid</button>
            <button className={focused ? 'active' : ''} onClick={() => setFocus(focused ?? screens[0])}>Focus</button>
          </div>
        )}
        <button title="Fill the whole monitor (Esc to leave)" onClick={() => void (document.fullscreenElement && document.fullscreenElement !== document.documentElement ? document.exitFullscreen() : stage.current?.requestFullscreen())}><Icon name="full" /> Full screen</button>
        <button onClick={() => useStore.setState({ view: { kind: 'hangout' } })}>Back to the room</button>
      </header>
      {focused ? (
        <div className="focus-view">
          <StreamTile key={focused} id={focused} big onPick={() => { if (screens.length > 1) setFocus(null); }} />
          {others.length > 0 && (
            <div className="filmstrip">
              {others.map((id) => (
                <button key={id} className="thumb" onClick={() => setFocus(id)} title={`Watch ${users[id]?.name}`}>
                  <LiveVideo userId={id} /><span>{users[id]?.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="tiles" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {screens.map((id) => <StreamTile key={id} id={id} onPick={() => setFocus(id)} />)}
        </div>
      )}
    </section>
  );
}
