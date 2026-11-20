// The people who can sign in. The first person is made on the host PC when the server is first opened, and is
// the admin. Everyone after that comes in through an invite link the admin makes: they pick their own name and
// password. Passwords are only ever stored as salted scrypt hashes.
//
// For when the admin is locked out, on the host PC:
//   node server/accounts.ts list             who has an account
//   node server/accounts.ts reset <name>     give that person a new password (it is printed once)
//   node server/accounts.ts admin <name>     make that person an admin
import crypto from 'node:crypto';
import path from 'node:path';
import { get, all, rid, run } from './db.ts';

/** The colours a new person is given one of (they can change it). The same list is offered in the profile page. */
export const COLORS = ['#e5484d', '#ff8f2e', '#f2c230', '#3fbf63', '#2fd3c6', '#3b82f6', '#8b6be0', '#ff6fb7', '#9aa0b0', '#c9a36a'];

const WORDS = ('amber anchor arcade autumn badger bamboo banjo beacon biscuit blanket bottle breeze bronze bubble cactus candle canyon carpet castle cedar ' +
  'cherry cinder clover cobalt comet copper coral cotton coyote cricket crystal dagger daisy dapper denim desert diesel dragon ember falcon feather fiddle ' +
  'forest fossil garlic ginger glacier goblin granite gravel hammer harbor hazel hollow honey island jacket jungle kettle lantern lemon lizard magnet mango ' +
  'maple marble meadow mirror monkey mustard nickel noodle oyster paddle pebble pepper pickle pirate planet pocket potato pumpkin puzzle rabbit radish raven ' +
  'ribbon rocket saddle salmon sandal shadow silver sketch spider sponge squid stone summer sunset thunder timber toffee tunnel turtle velvet violet walnut ' +
  'whistle willow winter wizard yonder zipper ' +
  // (a longer list: four words from it are about 32 bits before the number, see newPassword)
  'acorn alpine apricot arrow aspen atlas avocado bagel ballad banana barley basil beetle berry blossom bonfire bramble brick bucket ' +
  'buffalo bugle butter button cabin camel canoe caramel carrot cashew cello chalk cheddar chimney cider cliff cloud cobble cocoa compass ' +
  'cookie cosmos cupcake curtain dolphin donut drum eagle easel elbow emerald engine fable fern ferry flannel flint flute fudge galaxy ' +
  'garden gecko geyser glove gopher grape gumbo hammock hatchet helmet heron hiccup igloo iris ivory jasper jelly jigsaw juniper kayak ' +
  'kiwi koala ladder lagoon latte lava lilac lobster locket lotus lunar mammoth meteor mitten moose muffin nectar nutmeg olive onion ' +
  'orbit otter panda papaya parrot peach peanut pelican penguin piano plum pony quartz quill raccoon raisin rhubarb river robin saffron ' +
  'sequoia sherbet skillet sloth sparrow spruce tango teapot thistle tiger tomato topaz trumpet tulip tundra ukulele umbrella valley ' +
  'vanilla viking waffle walrus wasabi yeti yodel zebra').split(' ').filter((w, i, all) => all.indexOf(w) === i);

/** Easy to read out, hard to guess: four words and a number (about 38 bits: with the sign-in limits, centuries of
 *  guessing). Older passwords of three words still work. */
export function newPassword() {
  const pick = () => WORDS[crypto.randomInt(WORDS.length)];
  return `${pick()}-${pick()}-${pick()}-${pick()}-${crypto.randomInt(10, 100)}`;
}

export function hashPassword(password: string) {
  const salt = crypto.randomBytes(16);
  return `${salt.toString('hex')}:${crypto.scryptSync(password, salt, 32).toString('hex')}`;
}

export function checkPassword(password: string, stored: string | null | undefined) {
  const [salt, hash] = (stored ?? '').split(':');
  if (!salt || !hash) return false;
  const want = Buffer.from(hash, 'hex');
  const got = crypto.scryptSync(password, Buffer.from(salt, 'hex'), want.length);
  return crypto.timingSafeEqual(want, got);
}

/** A name as it will be shown: no line breaks or odd spacing, 24 characters at most. */
/** A name as it is kept: on one line, with nothing invisible in it (a name is written to the log, a line each, so
 *  one with a line break or a text-direction mark in it could write lines of its own there). */
export const cleanName = (v: unknown) => String(v ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 24);

/** Why this name or password cannot be used, or '' if they are fine. `exceptId`: the person renaming themselves. */
export function whyNot(name: string, password: string | null, exceptId = '') {
  if (name.length < 2) return 'Pick a name of at least two letters.';
  const taken = get<{ id: string }>("SELECT id FROM users WHERE name = ? COLLATE NOCASE AND role != 'removed'", name);
  if (taken && taken.id !== exceptId) return 'Somebody here already has that name.';
  if (password !== null && password.length < 8) return 'Pick a password of at least 8 characters.';
  if (password !== null && password.length > 200) return 'That password is too long.';
  return '';
}

/** Makes a person. The caller has already checked the name and password with whyNot(). */
export function createUser(name: string, password: string, role: 'admin' | 'member') {
  const id = rid(9);
  const n = get<{ n: number }>('SELECT COUNT(*) AS n FROM users')!.n;
  run('INSERT INTO users (id, name, color, role, pass, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, name, COLORS[n % COLORS.length], role, hashPassword(password), Date.now());
  return id;
}

export function setPassword(userId: string, password: string) {
  run('UPDATE users SET pass = ? WHERE id = ?', hashPassword(password), userId);
}

/** Gives somebody a new password and signs them out everywhere. Returns it, to be passed on to them once. */
export function resetPassword(userId: string) {
  const user = get<{ id: string }>("SELECT id FROM users WHERE id = ? AND role != 'removed'", userId);
  if (!user) return null;
  const password = newPassword();
  setPassword(user.id, password);
  run('DELETE FROM sessions WHERE user_id = ?', user.id);
  return password;
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const [cmd, ...rest] = process.argv.slice(2);
  const who = rest.join(' ');
  const user = who ? get<{ id: string; name: string }>("SELECT id, name FROM users WHERE name = ? COLLATE NOCASE AND role != 'removed'", who) : undefined;
  if (cmd === 'list') {
    for (const u of all<{ name: string; role: string }>("SELECT name, role FROM users WHERE role != 'removed' ORDER BY name COLLATE NOCASE")) console.log(`${u.name}${u.role === 'admin' ? '  (admin)' : ''}`);
  } else if ((cmd === 'reset' || cmd === 'admin') && !user) {
    console.log(who ? `Nobody is called ${who}.` : `Say who: node server/accounts.ts ${cmd} <name>`);
  } else if (cmd === 'reset') {
    console.log(`New password for ${user!.name}: ${resetPassword(user!.id)}\nThey are signed out everywhere. (If the server is running, restart it so open windows notice.)`);
  } else if (cmd === 'admin') {
    run("UPDATE users SET role = 'admin' WHERE id = ?", user!.id);
    console.log(`${user!.name} is now an admin. Restart the server if it is running.`);
  } else {
    console.log('node server/accounts.ts list | reset <name> | admin <name>');
  }
}
