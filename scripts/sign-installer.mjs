// Signs the desktop installer, so that an app updating itself can tell that whoever runs the server built what it hands over.
// (docs/SIGNED-UPDATES.md has the whole story.)
//
//   node scripts/sign-installer.mjs --new-key    once: makes the pair of keys
//   node scripts/sign-installer.mjs              after "Build installer.bat": signs the newest installer in desktop\dist
//   node scripts/sign-installer.mjs <installer>  signs that one instead
//
// The private key is the thing to look after: whoever has it can make an installer every friend's app will run. It
// is kept outside this folder and outside the data folder, in <your user folder>\.chatterday-signing\update-key.pem,
// or wherever CHATTERDAY_SIGNING_KEY points (a USB stick is a good place). It is never printed.
// The public key goes in desktop\update-key.txt, which is packed into the app and is safe to commit.
// The signature is written beside the installer, as <installer>.sig, and the server sends it along with the file.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
const keyFile = path.resolve(process.env.CHATTERDAY_SIGNING_KEY || path.join(os.homedir(), '.chatterday-signing', 'update-key.pem'));
const pubFile = path.join(root, 'desktop', 'update-key.txt');
const stop = (why) => { console.error(why); process.exit(1); };

// The app keeps the public key as its 32 bytes in base64 (one line of 44 characters).
const publicText = (key) => crypto.createPublicKey(key).export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
const inside = (folder, file) => !path.relative(folder, file).startsWith('..') && !path.isAbsolute(path.relative(folder, file));
const dataFolder = path.resolve(process.env.CHATTERDAY_DATA || path.join(root, 'data'));
if (inside(root, keyFile) || inside(dataFolder, keyFile)) stop(`The private key must not live in the project or the data folder (${keyFile}). Point CHATTERDAY_SIGNING_KEY somewhere else.`);

if (process.argv[2] === '--new-key') {
  // Never over an existing key: apps already out there trust the old one, and would refuse everything signed with a new one.
  if (fs.existsSync(keyFile)) stop(`There is already a private key at ${keyFile}. Nothing was changed.`);
  if (fs.existsSync(pubFile)) stop(`There is already a public key in ${pubFile}, from a private key that is not at ${keyFile}.\nFind that private key (or point CHATTERDAY_SIGNING_KEY at it). Nothing was changed.`);
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.mkdirSync(path.dirname(keyFile), { recursive: true });
  fs.writeFileSync(keyFile, privateKey.export({ format: 'pem', type: 'pkcs8' }), { flag: 'wx' });
  fs.writeFileSync(pubFile, publicText(privateKey) + '\n');
  console.log(`Private key: ${keyFile}\n  Keep a copy somewhere safe and off this PC. If it is lost, friends must install the next version by hand.`);
  console.log(`Public key:  ${pubFile}\n  Packed into the app by the next "Build installer.bat". Commit it.`);
  process.exit(0);
}

// Which installer: the one named, or the newest in desktop\dist by version number (as the server picks it).
const parts = (f) => (/(\d+)\.(\d+)\.(\d+)/.exec(f) ?? []).slice(1).map(Number);
let installer = process.argv[2] ? path.resolve(process.argv[2]) : '';
if (!installer) {
  const dist = path.join(root, 'desktop', 'dist');
  const newest = (fs.existsSync(dist) ? fs.readdirSync(dist) : []).filter((f) => /Setup.*\.exe$/i.test(f) && parts(f).length === 3)
    .sort((x, y) => { const m = parts(x), n = parts(y); return m[0] - n[0] || m[1] - n[1] || m[2] - n[2]; }).pop();
  if (!newest) stop('There is no installer in desktop\\dist. Run "Build installer.bat" first.');
  installer = path.join(dist, newest);
}
if (!fs.existsSync(installer)) stop(`There is no such file: ${installer}`);
// The version is read from the file's name, exactly as the app reads it from the name the server gives.
const version = /(\d+\.\d+\.\d+)/.exec(path.basename(installer))?.[1];
if (!version) stop('The installer\'s name has no version number in it (Chatterday-Setup-1.2.3.exe).');
if (!fs.existsSync(keyFile)) stop(`The private key is not at ${keyFile}.\nPlug in whatever it is kept on, or set CHATTERDAY_SIGNING_KEY, or make the keys once with: node scripts/sign-installer.mjs --new-key`);
const privateKey = crypto.createPrivateKey(fs.readFileSync(keyFile));
const mine = publicText(privateKey);
const packed = fs.existsSync(pubFile) ? fs.readFileSync(pubFile, 'utf8').trim() : '';
if (packed !== mine) stop(`desktop\\update-key.txt does not hold the public half of ${keyFile}.\nAn app built with it would refuse this signature. Nothing was signed.`);

const hash = crypto.createHash('sha256'), buf = Buffer.alloc(1 << 20), fd = fs.openSync(installer, 'r');
for (let n = 0; (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0;) hash.update(buf.subarray(0, n));
fs.closeSync(fd);
const sha = hash.digest('hex');
// What is signed: one short text naming the version and the fingerprint (the same text as signedText in desktop/main.cjs).
const text = Buffer.from(`chatterday-update\n${version}\n${sha}\n`);
const sig = crypto.sign(null, text, privateKey);
if (!crypto.verify(null, text, crypto.createPublicKey(privateKey), sig)) stop('The signature did not check out. Nothing was written.');
fs.writeFileSync(installer + '.sig', sig.toString('base64') + '\n');
console.log(`Signed Chatterday ${version}: ${path.basename(installer)}.sig`);

// Was this installer built with the public key inside? Built before the key was made, its app checks nothing. (The
// folder beside the installers holds the app as it was last packed, and the key is in there as plain text.)
const asar = path.join(path.dirname(installer), 'win-unpacked', 'resources', 'app.asar');
if (fs.existsSync(asar) && !fs.readFileSync(asar).includes(mine)) {
  console.log('NOTE  The app in this build does not have the public key inside (it was built before the key was made).\n      Run "Build installer.bat" again, so that the app friends install checks signatures.');
}
