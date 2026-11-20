// Parts of the window that most visits never open (Play Games, the Arcade, the whiteboard, Settings) are chunks of their own, so the page that opens first is smaller to fetch and quicker to start.
// Each is fetched the first time it is drawn, and in any case once the page has settled after loading: so opening one
// is as quick as before, and a page left open across a new build (whose old chunks are gone from the server) already
// has every part it can draw.
import { lazy } from 'react';
import type { ComponentType } from 'react';

const all: (() => Promise<unknown>)[] = [];

/** A component from a chunk of its own: draw it inside a <Suspense>. */
export function later<P extends object>(load: () => Promise<ComponentType<P>>) {
  let got: Promise<{ default: ComponentType<P> }> | null = null;
  const get = () => (got ??= load().then((c) => ({ default: c }), (e) => { got = null; throw e; }));
  all.push(get);
  return lazy(get);
}

/** Starts something only once the page is idle (a few seconds after it loaded). */
export function whenIdle(run: () => void, ms = 2500) {
  const idle = () => {
    const ric = (window as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (ric) ric(run, { timeout: 5000 }); else run();
  };
  const go = () => window.setTimeout(idle, ms);
  if (document.readyState === 'complete') go(); else window.addEventListener('load', go, { once: true });
}

whenIdle(() => { for (const get of all) get().catch(() => {}); });
