// The faint scan lines lie over the whole app (styles.css, body::after), but not over moving pictures: a shared
// screen, the player, a video in chat. The lines are one sheet on top of everything, so a hole is cut in the sheet
// wherever a video (or an embedded player) is showing, and moved as it moves.
// The photographs on the clubhouse wall are left clear of lines too (`.club-photo`): each one's hole is the shape of
// the part of it that shows, which Clubhouse.tsx notes on the picture as `data-clip` (corners, in the room's dots,
// `data-w` of them across), so the monitors standing in front of a frame keep their lines.
// A video shown full screen is above the sheet already. While a dialog is open the sheet is left whole, so the
// dialog does not lose its lines where it happens to cover a video.

type Box = [number, number, number, number];

/** The part of an element that can actually be seen: inside every scrolling or clipping box it sits in, and the window. */
function seen(el: Element): Box | null {
  const r = el.getBoundingClientRect();
  let x0 = Math.max(0, r.left), y0 = Math.max(0, r.top), x1 = Math.min(innerWidth, r.right), y1 = Math.min(innerHeight, r.bottom);
  for (let p = el.parentElement; p && p !== document.body && x1 - x0 >= 8 && y1 - y0 >= 8; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (s.visibility === 'hidden' || s.opacity === '0') return null;
    if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
    const c = p.getBoundingClientRect();
    x0 = Math.max(x0, c.left); y0 = Math.max(y0, c.top); x1 = Math.min(x1, c.right); y1 = Math.min(y1, c.bottom);
  }
  return x1 - x0 >= 8 && y1 - y0 >= 8 ? [Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1)] : null;
}

let last = '';
/** Cuts the holes as they should be this moment. False if there is no moving picture on the page at all. */
function cut(): boolean {
  const pictures = document.querySelectorAll('video, iframe');
  const photos = document.querySelectorAll<HTMLElement>('.club-photo');
  let holes = '';
  if ((pictures.length || photos.length) && (!document.fullscreenElement || document.fullscreenElement === document.documentElement) && !document.querySelector('.scrim, .lightbox')) {
    for (const el of pictures) {
      const b = seen(el);
      if (b) holes += ` M${b[0]} ${b[1]}H${b[2]}V${b[3]}H${b[0]}Z`;
    }
    for (const el of photos) {
      if (!seen(el)) continue;
      const r = el.getBoundingClientRect(), k = r.width / (Number(el.dataset.w) || 1);
      const pts = (el.dataset.clip ?? '').split(' ').map((q) => q.split(',').map(Number)).filter((q) => q.length === 2);
      if (pts.length > 2) holes += ` M${pts.map(([x, y]) => `${Math.round(r.left + x * k)} ${Math.round(r.top + y * k)}`).join('L')}Z`;
    }
  }
  const value = holes ? `path(evenodd, "M0 0H${innerWidth}V${innerHeight}H0Z${holes}")` : '';
  if (value !== last) {
    last = value;
    if (value) document.documentElement.style.setProperty('--scan-holes', value);
    else document.documentElement.style.removeProperty('--scan-holes');
  }
  return pictures.length > 0;
}
// Every frame while there is a moving picture to follow. With none (most of the time) a look four times a second
// is plenty (the photos on the wall only move when the room is resized), and none at all while the window is out of sight.
function tick() {
  if (cut()) requestAnimationFrame(tick);
  else if (document.hidden) document.addEventListener('visibilitychange', tick, { once: true });
  else window.setTimeout(tick, 250);
}
requestAnimationFrame(tick);
