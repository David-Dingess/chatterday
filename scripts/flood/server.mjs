// The throwaway server the flood tests are run against. run.mjs starts it; by hand: node scripts/flood/server.mjs
// It is the real server code on its own port (4591), with its own LiveKit (7950) and its own data folder in the temp
// directory, and six people to test with, made the way scripts/test-server.mjs makes its two: Robin (the admin), Sam,
// Kit, Juno, Mika and Pat, each with a character, a pet and a desk. It is also given one soundboard button and Robin's
// own entrance clip, which on a real server come from the app and from the "entrance sounds" folder next to it (that
// folder is the real server's, so nothing is put in it from here: the clip is written straight into the test data).
import fs from 'node:fs';
import path from 'node:path';
import { DATA, PASSWORD, PEOPLE, PORT } from './lib.mjs';

const root = path.resolve(import.meta.dirname, '..', '..');
if (path.resolve(DATA).toLowerCase() === path.join(root, 'data').toLowerCase()) { console.error('The flood tests are not run on the real data folder.'); process.exit(1); }
process.env.CHATTERDAY_DATA = DATA;
process.env.PORT = String(PORT);
process.env.CHATTERDAY_LK_PORT ??= '7950';
await import('../../server/index.ts');
const { run, rid, userCount } = await import('../../server/db.ts');
if (userCount() === 0) {
  const { createUser } = await import('../../server/accounts.ts');
  const { UPLOADS } = await import('../../server/config.ts');
  const { randomLook } = await import('../../shared/look.ts');
  const { randomPet } = await import('../../shared/pet.ts');
  const { randomDesk } = await import('../../shared/desk.ts');
  const ids = PEOPLE.map((name, k) => {
    const id = createUser(name, PASSWORD, k === 0 ? 'admin' : 'member');
    run('UPDATE users SET look = ?, pet = ?, desk = ? WHERE id = ?', JSON.stringify(randomLook(k + 1)), JSON.stringify(randomPet(k + 1)), JSON.stringify(randomDesk(k + 1)), id);
    return id;
  });
  // a tenth of a second of silence, as a WAV file
  const wav = Buffer.alloc(44 + 800, 0x80);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28); wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34); wav.write('data', 36); wav.writeUInt32LE(800, 40);
  const clip = (name, owner, entranceFor) => {
    const id = rid(15);
    fs.writeFileSync(path.join(UPLOADS, id), wav);
    run('INSERT INTO files (id, user_id, name, mime, size, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, owner, name + '.wav', 'audio/wav', wav.length, 'sound', Date.now());
    return Number(run('INSERT INTO sounds (name, emoji, file_id, user_id, created_at, entrance_for) VALUES (?, ?, ?, ?, ?, ?)', name, 'note', id, owner, Date.now(), entranceFor).lastInsertRowid);
  };
  clip('beep', ids[0], null);                                                                      // a soundboard button, as if Robin had added it in the app
  run('UPDATE users SET entrance = ? WHERE id = ?', clip(PEOPLE[0], 'entrance', ids[0]), ids[0]);   // Robin's own entrance clip
  console.log(`[flood] Made ${ids.length} sign-ins: ${PEOPLE[0]} (admin), ${PEOPLE.slice(1).join(', ')}`);
}
