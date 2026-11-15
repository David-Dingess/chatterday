import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { useStore } from '../store';
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
  componentDidCatch(error: unknown, info: ErrorInfo) { console.error('The window could not be drawn:', error, info.componentStack); }
  render() { return this.state.failed ? <Broken error={this.state.error} /> : this.props.children; }
}
