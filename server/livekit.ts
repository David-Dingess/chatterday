import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { DATA, LK, ROOT, secrets } from './config.ts';

let child: ChildProcess | null = null;
let stopping = false;
export let voiceReady = false;
let changed = () => {};
/** Has `fn` called whenever voice comes up or goes down. */
export const onVoiceChange = (fn: () => void) => { changed = fn; };
function setReady(up: boolean) {
  if (voiceReady === up) return;
  voiceReady = up;
  changed();
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const exe = path.join(ROOT, 'bin', process.platform === 'win32' ? 'livekit-server.exe' : 'livekit-server');

const portOpen = (port: number) =>
  new Promise<boolean>((resolve) => {
    const s = net.connect(port, '127.0.0.1');
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
    s.setTimeout(800, () => { s.destroy(); resolve(false); });
  });

function writeConfig() {
  const file = path.join(DATA, 'livekit.yaml');
  // Signalling listens on loopback only: every client reaches it through our authenticated /rtc proxy.
  fs.writeFileSync(file, [
    `port: ${LK.port}`,
    'bind_addresses:',
    '  - "127.0.0.1"',
    'rtc:',
    `  tcp_port: ${LK.tcp}`,
    `  udp_port: ${LK.udp}`,
    `  use_external_ip: ${process.env.CHATTERDAY_BIND === 'all' ? 'true' : 'false'}`,
    'room:',
    '  auto_create: true',
    '  empty_timeout: 30',
    'logging:',
    '  level: warn',
    'keys:',
    `  ${secrets.livekitKey}: ${secrets.livekitSecret}`,
    '',
  ].join('\n'));
  return file;
}

/** Starts LiveKit again after a pause. A start that fails outright is tried again every half minute. */
function startLater(ms: number) {
  setTimeout(() => {
    startLiveKit().catch((e) => { console.error('[voice] could not start LiveKit:', e.message); startLater(30_000); });
  }, ms);
}

/** A LiveKit that was already running (left behind when a server was stopped hard) is not ours to supervise, so
 *  nothing would notice it going. Look every 10 s; once it has gone, start our own. */
function watchBorrowed() {
  const timer = setInterval(async () => {
    if (child || stopping) return clearInterval(timer);
    if (await portOpen(LK.port)) return;
    clearInterval(timer);
    setReady(false);
    console.warn('[voice] the LiveKit that was already running has stopped; starting our own.');
    startLater(0);
  }, 10_000);
  timer.unref();
}

export async function startLiveKit() {
  if (child || stopping) return;
  if (!fs.existsSync(exe)) {
    console.warn('[voice] bin/livekit-server is missing. Run "npm run setup". Text chat still works.');
    return;
  }
  if (await portOpen(LK.port)) {
    console.log('[voice] LiveKit is already running; reusing it.');
    setReady(true);
    watchBorrowed();
    return;
  }
  let mine: ChildProcess;
  try {
    const args = ['--config', writeConfig()];
    if (process.env.LIVEKIT_NODE_IP) args.push('--node-ip', process.env.LIVEKIT_NODE_IP);
    mine = spawn(exe, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  } catch (e: any) {
    // On Windows a program that cannot be run (damaged, or held by a virus scanner) makes spawn itself throw. That is
    // no reason for the whole server to stop: the chat carries on, and voice is tried again.
    console.warn(`[voice] LiveKit could not be run (${e.message}); trying again in 30 s. Text chat still works.`);
    startLater(30_000);
    return;
  }
  child = mine;
  // LiveKit prints a Go stack trace under every error; keep only the dated first line of each entry.
  const log = (b: Buffer) => {
    for (const l of b.toString().split('\n')) if (/^\d{4}-/.test(l) && !l.includes('CPU monitoring unsupported')) console.log('[livekit]', l.trim());
  };
  mine.stdout!.on('data', log);
  mine.stderr!.on('data', log);
  const gone = (why: string, againIn: number) => {
    if (child !== mine) return;
    child = null;
    setReady(false);
    if (stopping) return;
    console.warn(`[voice] LiveKit ${why}; restarting in ${againIn / 1000} s.`);
    startLater(againIn);
  };
  mine.on('exit', (code) => gone(`exited (${code})`, 3000));
  // (elsewhere than Windows, a program that cannot be run reports an 'error' and never an 'exit'; with nobody
  // listening for it, that too would stop the whole server)
  mine.on('error', (e) => gone(`could not be run (${e.message})`, 30_000));
  // It is up once its port answers: usually within a second or two. Startup waits 10 s for that and then carries on,
  // but the looking goes on for as long as this LiveKit runs, so one that is slow to start still turns voice on.
  const up = (async () => {
    for (let i = 0; child === mine && !(await portOpen(LK.port)); i++) await sleep(i < 40 ? 250 : 1000);
    if (child !== mine) return;
    setReady(true);
    console.log('[voice] LiveKit is up.');
  })();
  await Promise.race([up, sleep(10_000)]);
  if (!voiceReady && child === mine) console.log('[voice] LiveKit is slow to start; voice turns on when it is ready.');
}

/** LiveKit only listens on the network addresses that exist when it starts, so a late Tailscale needs a restart. */
export function restartLiveKit() {
  if (child) { console.log('[voice] network changed; restarting LiveKit.'); child.kill(); }
}

export function stopLiveKit() {
  stopping = true;
  child?.kill();
}

let rooms: RoomServiceClient | undefined;
/** Puts somebody out of the voice chats now (they have been removed). Their pass is good for hours and their
 *  connection is already open, so without this they would stay in the call until they chose to leave. */
export async function kickFromVoice(userId: string, channelIds: number[]) {
  if (!voiceReady) return;
  rooms ??= new RoomServiceClient(`http://127.0.0.1:${LK.port}`, secrets.livekitKey, secrets.livekitSecret);
  for (const id of channelIds) await rooms.removeParticipant(`vc-${id}`, userId).catch(() => { /* not in that one */ });
}

export async function voiceToken(user: { id: string; name: string }, channelId: number) {
  const at = new AccessToken(secrets.livekitKey, secrets.livekitSecret, { identity: user.id, name: user.name, ttl: 6 * 3600 });
  at.addGrant({ room: `vc-${channelId}`, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });
  return at.toJwt();
}
