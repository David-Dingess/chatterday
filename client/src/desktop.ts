// Things only the desktop app does: staying quiet in the tray, and the notices at the corner of the screen.
import { native as bridge } from './native';
import { setSilent } from './sfx';
import { hooks, useStore } from './store';
import { leaveVoice } from './voice';

const native = bridge;
if (native) {
  // A page that loads while the window is out of sight (it reloads itself for an update, even in the tray) starts
  // silent, and stays so until the window is seen again.
  if (document.hidden) setSilent(true);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) setSilent(false); });
  // Closed to the tray: leave voice and make no sound at all until the window is opened again.
  native.onWindow?.((visible) => {
    setSilent(!visible);
    if (!visible) void leaveVoice();        // (asked even when not in a call yet: one that is still connecting is called off)
  });

  const accent = () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#38ff5c';
  let told = '';
  const report = () => window.setTimeout(() => {
    const s = useStore.getState();
    const online = Object.entries(s.presence).filter(([id, p]) => id !== s.me?.id && p.state !== 'offline').length;     // other people only
    // Only when it has changed: this is asked after everything anybody does, and the shell loads its counter afresh each time it is told
    const colour = accent(), now = `${online}|${colour}`;
    if (now === told) return;
    told = now;
    native.setOnline?.(online, colour);
  }, 0);
  hooks.ready.push(report);
  hooks.wave.push((from) => native.popup?.(`${useStore.getState().users[from]?.name ?? 'Someone'} is waving you over`, accent()));
  hooks.presence.push((userId, prev, next) => {
    report();
    const s = useStore.getState();
    if (userId !== s.me?.id && !prev?.voice && next.voice) native.popup?.(`${s.users[userId]?.name ?? 'Someone'} joined voice chat`, accent());
    if (userId !== s.me?.id && !prev?.voice?.sharing && next.voice?.sharing) native.popup?.(`${s.users[userId]?.name ?? 'Someone'} is sharing their screen`, accent());
  });
}
