import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/vt323';
import './styles.css';
import './activity';
import './desktop';
import './gamealerts';
import './deafen';
import './scanlines';
import './achievements';
import { Boundary } from './components/Boundary';
import { Gate } from './components/Gate';
import { Shell } from './components/Shell';
import { Logo } from './components/ui';
import { Welcome } from './components/Welcome';
import { boot, useStore } from './store';
import { applyTheme } from './theme';

function App() {
  const phase = useStore((s) => s.phase);
  const needsLook = useStore((s) => !!s.me && !s.me.look);
  if (phase === 'loading') return <div className="gate"><div className="gate-card"><Logo size={56} /><p>Knocking on the door…</p></div></div>;
  if (phase === 'gate') return <Gate />;
  return needsLook ? <Welcome /> : <Shell />;      // somebody new makes their character before they walk in
}

applyTheme(null);
useStore.subscribe((s, prev) => {
  if (s.unread === prev.unread) return;
  const n = Object.values(s.unread).filter(Boolean).length;
  document.title = n ? `(${n}) Chatterday` : 'Chatterday';
});
createRoot(document.getElementById('root')!).render(<Boundary><App /></Boundary>);
void boot();
