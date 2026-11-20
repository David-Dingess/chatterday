// What sort of device the page is on. Chatterday is a desktop app first, but the same page can be opened in a
// browser, a tablet's included, so a few things check for that.

/** A tablet: an iPad (which in Safari's usual mode says it is a Mac, and gives itself away only by its touch screen), or an
 *  Android tablet (whose browser leaves "Mobile" out of its name, as phones do not). */
export const isTablet = () => {
  const ua = navigator.userAgent;
  return /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) || (/Android/.test(ua) && !/Mobile/.test(ua));
};
/** Safari's engine on a touch screen (every browser on an iPhone or an iPad is), which ignores the volume of an audio
 *  element: voices there go through Web Audio instead (voice.ts webAudioMix). */
export const isAppleTouch = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
/** Whether this browser can share a screen at all (an iPad or a phone cannot: the button is not shown there). */
export const canShareScreen = () => !!(window as { chatterdayNative?: unknown }).chatterdayNative || typeof navigator.mediaDevices?.getDisplayMedia === 'function';

// ── where an element is on the page, under CSS zoom ──
// The room (and the scenes and boards inside it) are drawn at their own pixel size and scaled up with CSS `zoom`.
// Chrome (since 128) and Firefox give an element's box in page pixels, as the pointer's clientX and clientY are. Safari
// still gives it divided by the element's own zoom, while the pointer stays in page pixels, so every click in the room
// on an iPad landed somewhere else: a tap on the toilet could put somebody out past the bottom of the house, where they
// could not be seen. Which way this browser does it is measured once, not guessed
// from its name.
let legacyZoom: boolean | null = null;
function zoomIsLegacy(): boolean {
  if (legacyZoom != null) return legacyZoom;
  try {
    const d = document.createElement('div');
    d.style.cssText = 'position:absolute;left:0;top:0;width:100px;height:10px;zoom:2;visibility:hidden;pointer-events:none';
    document.body.appendChild(d);
    const w = d.getBoundingClientRect().width;
    d.remove();
    legacyZoom = w > 0 && w < 150;          // (200 where the box is in page pixels; 100 where it is in the element's own)
  } catch { legacyZoom = false; }
  return legacyZoom;
}
/** An element's box in page pixels, the same as a pointer's clientX and clientY, whatever the browser does with zoom. */
export function pageRect(el: Element): { left: number; top: number; width: number; height: number } {
  const r = el.getBoundingClientRect();
  if (!zoomIsLegacy()) return r;
  let z = 1;
  for (let n: Element | null = el; n; n = n.parentElement) z *= parseFloat(getComputedStyle(n).zoom) || 1;
  return { left: r.left * z, top: r.top * z, width: r.width * z, height: r.height * z };
}
