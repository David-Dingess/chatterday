import { DatabaseSync } from 'node:sqlite';
import type { StatementSync } from 'node:sqlite';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA } from './config.ts';

export const db = new DatabaseSync(path.join(DATA, 'chatterday.db'));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 3000;
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL, avatar TEXT, emoji TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'member', theme TEXT, status TEXT NOT NULL DEFAULT '',
  invisible INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
  pass TEXT,                 -- salt and scrypt hash of their password
  look TEXT, pet TEXT, desk TEXT,      -- their character, their pet and their desk, as they built them (JSON; see the shared folder)
  entrance INTEGER, exit_sound INTEGER,      -- the soundboard clips that play when they join and leave voice
  prefs TEXT, prefs_at INTEGER,        -- their settings as the page keeps them (JSON), so they follow them to another PC
  seen_at INTEGER,           -- the last time they connected
  talk REAL,                 -- how loud counts as this person talking (they set it themselves)
  birthday TEXT              -- 'MM-DD'
);
CREATE TABLE IF NOT EXISTS sessions (
  hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, device TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS invites (
  hash TEXT PRIMARY KEY, user_id TEXT, role TEXT NOT NULL DEFAULT 'member', created_by TEXT,
  expires_at INTEGER NOT NULL, used_at INTEGER, label TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL DEFAULT 0, used_by TEXT
);
CREATE TABLE IF NOT EXISTS channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, kind TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, channel_id INTEGER NOT NULL, user_id TEXT NOT NULL,
  content TEXT NOT NULL, attachments TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, edited_at INTEGER
);
CREATE INDEX IF NOT EXISTS messages_channel ON messages (channel_id, id);
CREATE TABLE IF NOT EXISTS reactions (
  message_id INTEGER NOT NULL, user_id TEXT NOT NULL, emoji TEXT NOT NULL,
  PRIMARY KEY (message_id, user_id, emoji)
);
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL,
  size INTEGER NOT NULL, kind TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, emoji TEXT NOT NULL DEFAULT '🔊',
  file_id TEXT NOT NULL, user_id TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS stash (
  id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL UNIQUE, name TEXT NOT NULL DEFAULT '',
  user_id TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);
// entrance_for: set on a clip from the "entrance sounds" folder, to the id of the person it belongs to. Such a clip
// is that person's own entrance sound and not a soundboard button. (Added to a table that may already exist.)
try { db.exec('ALTER TABLE sounds ADD COLUMN entrance_for TEXT'); } catch { /* it is there already */ }
// the arcade machine: each person's best score at each of its games
db.exec('CREATE TABLE IF NOT EXISTS arcade_scores (game TEXT NOT NULL, user_id TEXT NOT NULL, score INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (game, user_id))');
db.exec(`
CREATE TABLE IF NOT EXISTS plays (
  id INTEGER PRIMARY KEY AUTOINCREMENT, video_id TEXT NOT NULL, title TEXT NOT NULL, seconds INTEGER NOT NULL DEFAULT 0,
  user_id TEXT NOT NULL, played_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS spans (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, kind TEXT NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL, open INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS spans_end ON spans (end);
CREATE TABLE IF NOT EXISTS playlists (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, user_id TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS playlist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, playlist_id INTEGER NOT NULL, video_id TEXT NOT NULL, title TEXT NOT NULL, seconds INTEGER NOT NULL DEFAULT 0
);
`);
// When a saved song's title and length were last checked with YouTube: its terms ask for stored data to be refreshed
// (or deleted) within 30 days. 0 = never, so songs saved before this column existed are checked first.
try { db.exec('ALTER TABLE playlist_items ADD COLUMN fetched_at INTEGER NOT NULL DEFAULT 0'); } catch { /* it is there already */ }

const cache = new Map<string, StatementSync>();
const stmt = (sql: string) => {
  let s = cache.get(sql);
  if (!s) cache.set(sql, (s = db.prepare(sql)));
  return s;
};
type P = string | number | null;
export const get = <T = any>(sql: string, ...p: P[]) => stmt(sql).get(...p) as T | undefined;
export const all = <T = any>(sql: string, ...p: P[]) => stmt(sql).all(...p) as T[];
export const run = (sql: string, ...p: P[]) => stmt(sql).run(...p);
/** Several changes that belong together: all of them land or none do, and they cost one write to the disk instead of
 *  one each. `fn` must not wait for anything (no `await`), and these do not nest. */
export function tx<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export const rid = (bytes = 12) => crypto.randomBytes(bytes).toString('base64url');
export const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export const getKV = (key: string, fallback = '') => get<{ value: string }>('SELECT value FROM kv WHERE key = ?', key)?.value ?? fallback;
export const setKV = (key: string, value: string) =>
  run('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);

if (!get('SELECT 1 FROM channels LIMIT 1')) {
  run("INSERT INTO channels (name, kind, position) VALUES ('general', 'text', 0)");
  run("INSERT INTO channels (name, kind, position) VALUES ('Living Room', 'voice', 1)");
}
// The Game Table: a second voice chat, at the table the games are played on. Added to servers made before it existed,
// and renamed on the ones where it was first called the Side Room.
if (get<{ n: number }>("SELECT COUNT(*) AS n FROM channels WHERE kind = 'voice'")!.n === 1) run("INSERT INTO channels (name, kind, position) VALUES ('Game Table', 'voice', 2)");
run("UPDATE channels SET name = 'Game Table' WHERE kind = 'voice' AND name = 'Side Room'");

const HOUR = 3600_000;
/** A single-use invite. Whoever opens its link picks a name and a password and becomes a member. Only the code's
 *  hash is kept, so the link can be shown once, when it is made. */
export function createInvite(opts: { role?: string; createdBy?: string | null; hours?: number; label?: string }) {
  const code = rid(12);
  run('DELETE FROM invites WHERE expires_at < ? AND used_at IS NULL', Date.now());
  run('INSERT INTO invites (hash, role, created_by, expires_at, label, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    sha(code), opts.role === 'admin' ? 'admin' : 'member', opts.createdBy ?? null, Date.now() + (opts.hours ?? 72) * HOUR, (opts.label ?? '').slice(0, 40), Date.now());
  return code;
}

export const userCount = () => get<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE role != 'removed'")!.n;
