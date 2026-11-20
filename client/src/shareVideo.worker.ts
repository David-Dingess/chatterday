// A screen the desktop app captures itself arrives here as H.264 (desktop/main.cjs, startShareVideo), straight from
// the app down a channel of its own, and leaves as pictures written into the track that voice.ts publishes. It all
// happens on this thread and the graphics card: the page's own thread, busy drawing the room, never touches a
// picture, so a busy moment there cannot make the share stutter.

type Start = { port: MessagePort; writable: WritableStream<VideoFrame>; fps: number };

/** H.264 as it comes down a pipe (Annex B, each picture led by an access unit delimiter) cut into whole pictures.
 *  A picture is known to be whole when the mark before the next one arrives. */
function cutter(onPicture: (picture: Uint8Array, key: boolean) => void) {
  let buf = new Uint8Array(0), scanned = 0;
  // a key picture carries the stream's settings (7) or is marked as one (5) before its first slice
  const isKey = (au: Uint8Array) => {
    for (let i = 0; i + 4 < au.length && i < 4096; i++) {
      if (au[i] !== 0 || au[i + 1] !== 0 || au[i + 2] !== 1) continue;
      const type = au[i + 3] & 31;
      if (type === 5 || type === 7) return true;
      if (type === 1) return false;
    }
    return false;
  };
  /** What is left of a stream that has been cut off is dropped: it may be half a picture. */
  const reset = () => { buf = new Uint8Array(0); scanned = 0; };
  const push = (chunk: Uint8Array) => {
    const merged = new Uint8Array(buf.length + chunk.length);
    merged.set(buf);
    merged.set(chunk, buf.length);
    buf = merged;
    let start = 0;
    for (let i = Math.max(scanned, 1); i + 3 < buf.length; i++) {
      if (buf[i] !== 0 || buf[i + 1] !== 0 || buf[i + 2] !== 1 || (buf[i + 3] & 31) !== 9) continue;
      const cut = buf[i - 1] === 0 ? i - 1 : i;
      if (cut > start) { const au = buf.subarray(start, cut); onPicture(au, isKey(au)); }
      start = cut;
      i += 3;
    }
    if (start) buf = buf.slice(start);
    scanned = Math.max(1, buf.length - 3);
  };
  return { push, reset };
}

self.onmessage = (e: MessageEvent<Start>) => {
  const { port, writable, fps } = e.data;
  const writer = writable.getWriter();
  const say = (m: { t: 'first'; width: number; height: number } | { t: 'end'; why: string } | { t: 'count'; pictures: number; late: number }) => (self as unknown as Worker).postMessage(m);
  let over = false, started = false, at = 0, rate = fps, pictures = 0, late = 0, first = true, waitKey = false, behind = 0;
  const end = (why: string) => {
    if (over) return;
    over = true;
    say({ t: 'end', why });
    try { decoder.close(); } catch { /* already closed */ }
    void writer.close().catch(() => {});
    port.close();
  };
  const decoder = new VideoDecoder({
    output: (frame) => {
      if (over) return frame.close();
      if (first) { first = false; say({ t: 'first', width: frame.displayWidth, height: frame.displayHeight }); }
      pictures++;
      // Never a pile of pictures either: if the track has not taken the last few (nothing is sending them yet, or the
      // encoder has stopped for a moment), this one is let go. Each is a piece of the graphics card's memory.
      if ((writer.desiredSize ?? 1) < -4) return frame.close();
      // (the track takes the picture; one it refuses, because the share has just been stopped, is let go of here)
      writer.write(frame).catch(() => { try { frame.close(); } catch { /* taken after all */ } });
    },
    error: (err) => end(`the pictures could not be read (${err.message})`),
  });
  // High profile, level 5.2 (the level only says how big it may be: 2580x1080 at 60 is over 4.2). On the graphics card
  // when it can be; `optimizeForLatency`: each picture out as soon as it is in, none held back to be put in order.
  decoder.configure({ codec: 'avc1.640034', hardwareAcceleration: 'prefer-hardware', optimizeForLatency: true });
  const cut = cutter((picture, key) => {
    if (over) return;
    if (!started || waitKey) { if (!key) return; started = true; waitKey = false; }
    // Never a lasting queue: if pictures have been waiting to be decoded for half a second on end (they should not
    // be: this PC made them), the ones since are dropped and it picks up at the next key picture, a second away at
    // most. Better a skip than a growing delay. (A few waiting for a moment is nothing: the decoder takes a moment to
    // start, and they catch up.)
    behind = decoder.decodeQueueSize > 6 ? behind + 1 : 0;
    if (behind > Math.max(4, rate / 2)) { behind = 0; waitKey = true; late++; return; }
    at += Math.round(1e6 / rate);         // each picture's time: one beat of the stream's rate after the one before
    try { decoder.decode(new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp: at, data: picture })); }
    catch (err) { end(`the pictures could not be read (${(err as Error).message})`); }
  });
  // What comes down the channel: pieces of the stream; a null when the capture has stopped; and, when the app starts
  // the capture afresh at another rate (two pictures a second while nobody is watching, the full rate when somebody
  // is: voice.ts decides), a note that a new stream begins here and how fast it runs. It begins with a key picture.
  port.onmessage = (m: MessageEvent<Uint8Array | null | { restart: true; fps: number }>) => {
    const d = m.data;
    if (!d) return end('the capture stopped');
    if (d instanceof Uint8Array) return cut.push(d);
    cut.reset();
    started = false; waitKey = false; behind = 0;
    rate = d.fps > 0 ? d.fps : fps;
  };
  self.setInterval(() => { if (!over) say({ t: 'count', pictures, late }); }, 5000);
};
