// Runs the server against a throwaway data folder on port 4478, for trying things without touching real data.
// The first time, it makes two people to test with: Robin (the admin) and Sam, password smoke-test-password.
import os from 'node:os';
import path from 'node:path';
process.env.CHATTERDAY_DATA ??= path.join(os.tmpdir(), 'chatterday-test-data');
process.env.PORT ??= '4478';
process.env.CHATTERDAY_LK_PORT ??= '7890'; // its own LiveKit, so it can run beside the real server
await import('../server/index.ts');
const { run, userCount } = await import('../server/db.ts');
if (userCount() === 0) {
  const { createUser } = await import('../server/accounts.ts');
  const { randomLook } = await import('../shared/look.ts');
  const { randomPet } = await import('../shared/pet.ts');
  const { randomDesk } = await import('../shared/desk.ts');
  ['Robin', 'Sam'].forEach((name, k) => {
    const id = createUser(name, 'smoke-test-password', k === 0 ? 'admin' : 'member');
    run('UPDATE users SET look = ?, pet = ?, desk = ? WHERE id = ?', JSON.stringify(randomLook(k + 1)), JSON.stringify(randomPet(k + 1)), JSON.stringify(randomDesk(k + 1)), id);
  });
  console.log('[test] made Robin (admin) and Sam, password: smoke-test-password');
}
