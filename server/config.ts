import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';

export const ROOT = path.resolve(import.meta.dirname, '..');

// Settings kept out of git live in a .env file next to the app, one NAME=value per line.
try {
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch { /* no .env: fine */ }
export const DATA = path.resolve(process.env.CHATTERDAY_DATA || path.join(ROOT, 'data'));
export const UPLOADS = path.join(DATA, 'uploads');
export const DIST = path.resolve(process.env.CHATTERDAY_DIST || path.join(ROOT, 'client', 'dist'));      // (another folder: a test build, so trying a change does not ship it)
export const PORT = Number(process.env.PORT || 4477);
/** LiveKit ports: signalling stays on loopback (we proxy it); tcp/udp carry the media. */
const lkBase = Number(process.env.CHATTERDAY_LK_PORT || 7880);
export const LK = { port: lkBase, tcp: lkBase + 1, udp: lkBase + 2 };

fs.mkdirSync(UPLOADS, { recursive: true });

type Secrets = { livekitKey: string; livekitSecret: string };
const secretsPath = path.join(DATA, 'secrets.json');

function loadSecrets(): Secrets {
  if (fs.existsSync(secretsPath)) return JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
  const s: Secrets = {
    livekitKey: 'cd' + crypto.randomBytes(6).toString('hex'),
    livekitSecret: crypto.randomBytes(32).toString('base64url'),
  };
  fs.writeFileSync(secretsPath, JSON.stringify(s, null, 2));
  return s;
}
export const secrets = loadSecrets();

/** Tailscale hands out addresses in 100.64.0.0/10. */
export const isTailscale = (ip: string) => {
  const [a, b] = ip.split('.').map(Number);
  return a === 100 && b >= 64 && b <= 127;
};
const isPrivate = (ip: string) => {
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
};

/**
 * Where the server listens. Default: this PC plus its Tailscale address, so nothing on the
 * home network or the internet can reach it. CHATTERDAY_BIND=lan adds the home network;
 * CHATTERDAY_BIND=all listens everywhere (only for a port-forward setup).
 */
export function bindAddresses(): string[] {
  const mode = process.env.CHATTERDAY_BIND || 'tailscale';
  if (mode === 'all') return ['0.0.0.0'];
  const out = ['127.0.0.1'];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (isTailscale(a.address) || (mode === 'lan' && isPrivate(a.address))) out.push(a.address);
    }
  }
  return out;
}

export const LIMITS = {
  attachment: 50 * 1024 * 1024,
  avatar: 4 * 1024 * 1024,
  sound: 3 * 1024 * 1024,
  photo: 12 * 1024 * 1024,
} as const;
