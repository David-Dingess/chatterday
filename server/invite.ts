// Prints a fresh invite link, for when the admin page is not to hand. Usage: npm run invite
import { PORT } from './config.ts';
import { createInvite, getKV, userCount } from './db.ts';

if (userCount() === 0) {
  console.log(`Nobody has an account yet. Open http://127.0.0.1:${PORT} on this PC to set the server up first.`);
} else {
  const base = getKV('publicUrl') || `http://localhost:${PORT}`;
  console.log(`Invite (one person, good for 3 days):
  ${base}/#/invite/${createInvite({ label: 'made on the host PC' })}`);
}
