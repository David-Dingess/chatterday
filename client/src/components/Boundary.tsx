import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { hooks, send, useStore } from '../store';
import { leaveVoice } from '../voice';
import { Logo } from './ui';

// Anything that throws while the window is being drawn takes the whole picture with it: from then on React shows
// nothing at all. The voice call is no part of the picture (voice.ts holds it), so it used to carry on behind a blank
// window, with no button left to leave it by. This catches the throw and draws a small page in its place: a way to
// start again, and a way out of the call.

function Broken({ error }: { error: unknown }) {
  const inVoice = useStore((s) => s.voice.channelId != null);
  const muted = useStore((s) => s.voice.muted);
  return (
    <div className="gate">
      <div className="gate-card">
        <Logo size={56} />
        <h1>Something broke</h1>
        <p>The window could not be drawn. Reloading usually puts it right.</p>
        {inVoice && <p>You are still in the voice chat, {muted ? 'muted' : 'and your microphone is on'}. Reloading leaves it.</p>}
        <button className="primary" onClick={() => location.reload()}>Reload</button>
        {inVoice && <button onClick={() => void leaveVoice()}>Leave the voice chat</button>}
        <p><small>{error instanceof Error ? error.message : String(error)}</small></p>
      </div>
    </div>
  );
}

export class Boundary extends Component<{ children: ReactNode }, { failed: boolean; error: unknown }> {
  state = { failed: false, error: null as unknown };
  static getDerivedStateFromError(error: unknown) { return { failed: true, error }; }
  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('The window could not be drawn:', error, info.componentStack);
    // ...and the server's log is told, with where: on somebody else's iPad the console is out of reach, and "Something
    // broke" alone says nothing about what.
    const e = error instanceof Error ? error : null;
    // A part of the page fetched when first wanted (Settings, say) from a build that has since been replaced: its file is
    // gone. Loading the page again gets the new one; once, so a real fault is not loaded round and round.
    if (e && /Importing a module script failed|Failed to fetch dynamically imported module|error loading dynamically imported module/i.test(e.message)) {
      let last = 0;
      try { last = Number(sessionStorage.getItem('fc_chunk_reload') ?? 0); sessionStorage.setItem('fc_chunk_reload', String(Date.now())); } catch { /* reloaded anyway */ }
      if (Date.now() - last > 60_000) {
        // (in a call, the way an update goes: noted, left properly, and gone back into once the page is back)
        if (useStore.getState().voice.channelId != null) { for (const h of hooks.restarting) h(); window.setTimeout(() => location.reload(), 1500); }
        else location.reload();
        return;
      }
    }
    send({ t: 'oops', message: (e ? `${e.name}: ${e.message}` : String(error)).slice(0, 300), stack: (e?.stack ?? '').slice(0, 1200),
      where: (info.componentStack ?? '').trim().split('\n').slice(0, 6).map((l) => l.trim()).join(' < ').slice(0, 600), ua: navigator.userAgent.slice(0, 200) });
  }
  render() { return this.state.failed ? <Broken error={this.state.error} /> : this.props.children; }
}
