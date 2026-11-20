// A consistent copy of the database while the server keeps running (it is in WAL mode, so a plain file copy can
// catch it half-written). Handy for backups, or for moving the data to another PC.
//
//   node --no-warnings scripts/snapshot-db.mjs <out.db> [source.db]
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const out = process.argv[2];
const src = process.argv[3] || path.resolve(import.meta.dirname, '..', 'data', 'chatterday.db');
if (!out) { console.error('Usage: node scripts/snapshot-db.mjs <out.db> [source.db]'); process.exit(2); }
if (!fs.existsSync(src)) { console.error(`No database at ${src}`); process.exit(1); }
fs.rmSync(out, { force: true });
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });

const db = new DatabaseSync(src, { readOnly: true });
db.exec(`VACUUM INTO '${path.resolve(out).replaceAll("'", "''")}'`);
db.close();

const check = new DatabaseSync(out, { readOnly: true });
const ok = check.prepare('PRAGMA integrity_check').get();
const users = check.prepare('SELECT COUNT(*) AS n FROM users').get();
check.close();
if (Object.values(ok)[0] !== 'ok') { console.error('The copy failed its integrity check.'); process.exit(1); }
console.log(`Snapshot ${out}: ${(fs.statSync(out).size / 1024 / 1024).toFixed(1)} MB, ${users.n} users, integrity ok.`);
