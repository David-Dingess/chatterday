// For a finger on a touch screen (an iPad, with the whole app open: client/src/device.ts isTablet), where the app was
// made for a mouse.
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';

let tappedTwiceAt = 0;
const last = new WeakMap<EventTarget, { at: number; x: number; y: number }>();

/** A double-click that a double tap does too: spread onto the element, `{...doubleTap(fn)}`. Safari on an iPad turns two
 *  taps into a double-click only some of the time (it depends on whether the page can be zoomed there), so the taps are
 *  caught here, and a double-click that follows them is left alone, or a full screen would go on and straight off. */
export function doubleTap<E extends HTMLElement>(fn: (e: ReactMouseEvent<E>) => void) {
  return {
    onDoubleClick: (e: ReactMouseEvent<E>) => { if (performance.now() - tappedTwiceAt > 600) fn(e); },
    onPointerUp: (e: ReactPointerEvent<E>) => {
      if (e.pointerType !== 'touch') return;
      const now = performance.now(), was = last.get(e.currentTarget);
      if (was && now - was.at < 350 && Math.hypot(e.clientX - was.x, e.clientY - was.y) < 30) {
        last.delete(e.currentTarget);
        tappedTwiceAt = now;
        fn(e);
      } else last.set(e.currentTarget, { at: now, x: e.clientX, y: e.clientY });
    },
  };
}
