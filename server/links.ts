// Link previews: when a message has a link in it, the server fetches that page once and reads its title,
// description and picture, so the chat can show a small card. The page is fetched by the host PC, so anything
// that points back into the home network or the PC itself is refused.
import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import zlib from 'node:zlib';

export type LinkPreview = { kind: 'link'; url: string; title: string; description: string; image: string; site: string };

// This PC, the home network, Tailscale, and link-local addresses. A list of networks rather than patterns on the
// text, because one address can be written many ways: [::ffff:7f00:1] is 127.0.0.1, and is matched here as such.
const PRIVATE = new net.BlockList();
for (const [network, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16]] as const) PRIVATE.addSubnet(network, bits, 'ipv4');
for (const [network, bits] of [['::', 127], ['fc00::', 7], ['fe80::', 10]] as const) PRIVATE.addSubnet(network, bits, 'ipv6');
const isPrivate = (address: string) => PRIVATE.check(address, net.isIPv6(address) ? 'ipv6' : 'ipv4');

type Address = { address: string; family: number };
/** Where a link leads, if that is somewhere on the ordinary public web: http or https, the usual ports, and a name
 *  whose every address is a public one. Null if not. The addresses are given back because the page is then asked for
 *  from exactly these (see `page`). */
async function publicAddresses(u: URL): Promise<Address[] | null> {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.port && u.port !== '80' && u.port !== '443') return null;
  if (u.username || u.password) return null;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const found: Address[] = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await dns.lookup(host, { all: true }).catch(() => []);
  return found.length > 0 && !found.some((a) => isPrivate(a.address)) ? found : null;
}

type Page = { status: number; location: string | null; type: string; html: string };
/** Asks for a page, from one of the addresses that were checked and from nowhere else. The connection is not left to
 *  look the name up again: a name can be made to give a public address the first time it is asked and this PC's own
 *  the second, and the card would then show what a page on this PC or the home network says. Gives back the start
 *  of the page (as much as holds its <head>), or where it sends us on to. */
function page(url: URL, addresses: Address[]): Promise<Page> {
  return new Promise((resolve, reject) => {
    const lookup = (_host: string, opts: { all?: boolean }, cb: (...a: any[]) => void) => (opts?.all ? cb(null, addresses) : cb(null, addresses[0].address, addresses[0].family));
    const req = (url.protocol === 'https:' ? https : http).request(url, {
      lookup: lookup as any, agent: false,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; link preview)', Accept: 'text/html', 'Accept-Encoding': 'gzip, deflate, br' },
    }, (res) => {
      const status = res.statusCode ?? 0, type = String(res.headers['content-type'] ?? '');
      const location = status >= 300 && status < 400 ? res.headers.location ?? null : null;
      if (location || status < 200 || status > 299 || !/text\/html/i.test(type)) { res.destroy(); return resolve({ status, location, type, html: '' }); }
      const packed = String(res.headers['content-encoding'] ?? '').toLowerCase();
      const body = /^(x-)?gzip$/.test(packed) ? res.pipe(zlib.createGunzip()) : packed === 'deflate' ? res.pipe(zlib.createInflate()) : packed === 'br' ? res.pipe(zlib.createBrotliDecompress()) : res;
      const chunks: Buffer[] = [];
      let size = 0;
      // (over when enough has come, when it ends, or when it is cut short: what arrived by then is what is read)
      const done = () => { res.destroy(); resolve({ status, location, type, html: Buffer.concat(chunks).toString('utf8') }); };
      body.on('data', (c: Buffer) => { chunks.push(c); size += c.length; if (size >= 400_000) done(); });      // the head of the page is enough
      body.on('end', done);
      body.on('error', done);
      res.on('error', done);
    });
    const timer = setTimeout(() => req.destroy(new Error('too slow')), 6000);       // for the whole of it, not only the wait for an answer
    req.on('close', () => clearTimeout(timer));
    req.on('error', reject);
    req.end();
  });
}

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
const tidy = (s: string) => decode(s).replace(/\s+/g, ' ').trim();

/** What a page says about itself: its <meta> tags by name (the first of each), and its title. The page is somebody
 *  else's, so it is read in one pass with patterns that stop at the next '<' (outside quotes): a page made of
 *  thousands of tags that never close cannot keep the server busy (with a pattern that ran on to the next '>', it
 *  could, for minutes). */
function headOf(html: string) {
  const metas = new Map<string, string>();
  for (const [tag] of html.matchAll(/<meta\s(?:[^<>"']|"[^"]*"|'[^']*')*>/gi)) {
    const name = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1].toLowerCase();
    const content = /content\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    const value = content && tidy(content[1] ?? content[2]);
    if (name && value && !metas.has(name)) metas.set(name, value);
  }
  const meta = (...names: string[]) => names.map((n) => metas.get(n)).find(Boolean) ?? '';
  return { meta, title: tidy(/<title[^<>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? '') };
}

/** The card for a page, from its address and the start of its HTML; null if the page does not even have a title. */
export function cardFor(link: string, url: URL, html: string): LinkPreview | null {
  const { meta, title: plain } = headOf(html);
  const title = meta('og:title', 'twitter:title') || plain;
  if (!title) return null;
  let image = meta('og:image', 'og:image:url', 'twitter:image');
  try { image = image ? new URL(image, url).href : ''; } catch { image = ''; }
  return {
    kind: 'link', url: link, title: title.slice(0, 140), description: meta('og:description', 'description', 'twitter:description').slice(0, 240),
    image: image.startsWith('https://') && image.length < 600 ? image : '', site: (meta('og:site_name') || url.hostname.replace(/^www\./, '')).slice(0, 60),
  };
}

/** The first plain link in a message that is worth a card (pictures, GIFs and YouTube already show themselves). */
export function linkIn(text: string): string | null {
  for (const m of text.matchAll(/https?:\/\/[^\s<>"')\]]+/g)) {
    const url = m[0].replace(/[.,!?;:]+$/, '');
    if (/\.(png|jpe?g|gif|webp|mp4|webm|mp3|wav)(\?|$)/i.test(url) || /(youtube\.com|youtu\.be|giphy\.com|tenor\.com)/i.test(url)) continue;
    return url.length <= 500 ? url : null;
  }
  return null;
}

let fetching = 0;       // how many pages are being read right now
export async function previewFor(link: string): Promise<LinkPreview | null> {
  if (fetching >= 4) return null;                             // a burst of links gets cards for the first few, and is not a way to have this PC call on a site over and over
  fetching++;
  try {
    let url = new URL(link);
    let got: Page | null = null;
    for (let hop = 0; hop < 4; hop++) {                       // follow redirects by hand, checking each stop
      const addresses = await publicAddresses(url);
      if (!addresses) return null;
      const res = await page(url, addresses);
      if (!res.location) { got = res; break; }
      url = new URL(res.location, url);
    }
    if (!got || !got.html) return null;
    return cardFor(link, url, got.html);
  } catch {
    return null;
  } finally {
    fetching--;
  }
}
