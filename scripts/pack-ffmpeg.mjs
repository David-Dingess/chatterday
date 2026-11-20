// Before the installer is built: puts an LGPL ffmpeg in desktop\vendor\ffmpeg-packed, from where the build packs it
// beside the app (desktop\package.json, extraResources, into resources\ffmpeg). The app uses it to capture a shared
// screen on the graphics card (desktop\main.cjs, "a shared screen, captured here and not by the browser"). On a PC
// with an ffmpeg of its own on the PATH the app can use that one instead, and with none it falls back to the
// browser's own capture.
//
// Only an LGPL build is packed, so that the installer can be given to friends under the LGPL's terms:
//   - its `ffmpeg -version` must show no --enable-gpl, no --enable-nonfree and no libx264 / libx265 (encoding goes
//     through the graphics card's own encoders: nvenc, amf, qsv);
//   - it must be 8.0 or later, with the gfxcapture filter;
//   - its licence file (LICENSE / COPYING, beside ffmpeg.exe or one folder up, as the release zips have it) is packed
//     with it, with FFMPEG-BUILD.txt: the version, the configure line, the licence it is under, and where its source is;
//   - it stays a separate, unmodified ffmpeg.exe (and, for a "shared" build, its own DLLs) that the app runs as a
//     program of its own. Nothing of it is linked into the app.
//
// Where it comes from, first found:
//   1. desktop\vendor\ffmpeg\ : put an LGPL build there by hand (ffmpeg.exe in it or in its bin\, the licence beside).
//      A build there that is not LGPL, or has no licence file, stops the installer build.
//   2. an ffmpeg on this PC's PATH, if it passes. A GPL one there (most "full" builds are) is passed over, with a
//      note, and the installer is built without ffmpeg.
// desktop\vendor is not in the repository.
//
// Run by `npm run dist` in desktop\ (and so by scripts\build-installer.ps1). `node scripts/pack-ffmpeg.mjs --check
// <file>` judges a saved `ffmpeg -version` output and says what it would do, for testing.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const DESKTOP = path.resolve(import.meta.dirname, '..', 'desktop');
export const SOURCE = path.join(DESKTOP, 'vendor', 'ffmpeg');
export const OUT = path.join(DESKTOP, 'vendor', 'ffmpeg-packed');

/** What a build's `ffmpeg -version` says about it: { ok, why, version, configuration, licence }. */
export function judge(text) {
  const version = /ffmpeg version (\S+)/.exec(text)?.[1] ?? '';
  const configuration = /^\s*configuration:(.*)$/m.exec(text)?.[1]?.trim() ?? '';
  const out = { ok: false, why: '', version, configuration, licence: '' };
  if (!version) return { ...out, why: 'it did not say which ffmpeg it is (no "ffmpeg version" line)' };
  if (!/^\s*configuration:/m.test(text)) return { ...out, why: 'it did not say how it was built (no "configuration:" line)' };
  const flags = configuration.split(/\s+/);
  const bad = flags.filter((f) => /^--enable-(gpl|nonfree|libx264|libx265)$/.test(f));
  if (bad.length) return { ...out, why: `it is not an LGPL build (${bad.join(', ')})` };
  // (8.0 on: the capture filter it needs came in then. A version from git, "N-12345-g…", is taken on trust here and
  // checked by its filters below.)
  const major = /^n?(\d+)\./.exec(version)?.[1];
  if (major && Number(major) < 8) return { ...out, why: `it is ffmpeg ${version}, and the app needs 8.0 or later` };
  return { ...out, ok: true, licence: flags.includes('--enable-version3') ? 'LGPL-3.0-or-later' : 'LGPL-2.1-or-later' };
}

/** Where the source for a build of this version is. */
export function sourceFor(version) {
  // a release tarball only for a release build ("n8.1.3", "8.1.2-essentials"); a build from git past it
  // ("n8.1.3-36-ge22a4510c9") is that commit, not the release
  const commit = /-g([0-9a-f]{7,40})\b/.exec(version)?.[1];
  const release = commit ? '' : /^n?(\d+\.\d+(?:\.\d+)?)(?:$|-)/.exec(version)?.[1];
  return [
    release ? `https://ffmpeg.org/releases/ffmpeg-${release}.tar.xz` : '',
    commit ? `https://github.com/FFmpeg/FFmpeg/commit/${commit}` : release ? `https://github.com/FFmpeg/FFmpeg/tree/n${release}` : 'https://github.com/FFmpeg/FFmpeg',
  ].filter(Boolean);
}

/** The build's licence file: beside ffmpeg.exe, or one folder up. */
export function licenceOf(exe) {
  for (const dir of [path.dirname(exe), path.dirname(path.dirname(exe))]) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    const hit = names.find((n) => /^(LICENSE|COPYING)(\.LGPL[v\d.]*|\.txt|\.md)?$/i.test(n) || /^COPYING\.LGPLv[23]/i.test(n));
    if (hit) return path.join(dir, hit);
  }
  return '';
}

const say = (exe, args) => { try { return execFileSync(exe, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000, windowsHide: true }); } catch { return ''; } };
const captures = (exe, run) => /\bgfxcapture\b/.test(run(exe, ['-hide_banner', '-filters']));

/** Packs `exe` (with its DLLs and licence) into `out`, or says why not: { ok, why, judged }. `run` runs a program
 *  and gives back what it printed (a stand-in, for tests). */
export function pack(exe, { out = OUT, run = say } = {}) {
  const judged = judge(run(exe, ['-version']));
  if (!judged.ok) return { ok: false, why: judged.why, judged };
  if (!captures(exe, run)) return { ok: false, why: 'it has no gfxcapture filter (it needs to be 8.0 or later)', judged };
  const licence = licenceOf(exe);
  if (!licence) return { ok: false, why: `there is no licence file (LICENSE or COPYING) beside ${exe} or one folder up`, judged };
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  fs.copyFileSync(exe, path.join(out, 'ffmpeg.exe'));
  // a "shared" build's own libraries (avcodec-*.dll and the like), unchanged, beside it
  for (const n of fs.readdirSync(path.dirname(exe))) if (/\.dll$/i.test(n)) fs.copyFileSync(path.join(path.dirname(exe), n), path.join(out, n));
  fs.copyFileSync(licence, path.join(out, `LICENSE-ffmpeg${path.extname(licence) || '.txt'}`));
  fs.writeFileSync(path.join(out, 'FFMPEG-BUILD.txt'), [
    'FFmpeg, packed with the Chatterday desktop app',
    '',
    `Version: ${judged.version}`,
    `Licence: ${judged.licence} (the licence text is in ${`LICENSE-ffmpeg${path.extname(licence) || '.txt'}`}, beside this file)`,
    `Configuration: ${judged.configuration}`,
    '',
    'This is an unmodified build of FFmpeg (https://ffmpeg.org). The Chatterday app runs it as a separate program to',
    'capture a shared screen; it is not linked into the app. You may replace ffmpeg.exe (and its DLLs) with any other',
    'build of your own.',
    '',
    'The source code for this version:',
    ...sourceFor(judged.version).map((u) => `  ${u}`),
    'and the build scripts of whoever made the build (named on the page the build was downloaded from).',
    'A copy of both is also attached to the Chatterday release this installer came from, on its GitHub releases page.',
    '',
  ].join('\r\n'));
  return { ok: true, why: '', judged };
}

/** The ffmpeg.exe in a build folder put in desktop\vendor\ffmpeg (in it, or in its bin). */
const inSource = () => [path.join(SOURCE, 'ffmpeg.exe'), path.join(SOURCE, 'bin', 'ffmpeg.exe')].find((f) => fs.existsSync(f)) ?? '';

function main() {
  const at = process.argv.indexOf('--check');
  if (at > 0) {
    const j = judge(fs.readFileSync(process.argv[at + 1], 'utf8'));
    console.log(j.ok ? `would pack: ffmpeg ${j.version}, ${j.licence}` : `would refuse: ${j.why}`);
    process.exit(j.ok ? 0 : 1);
  }
  // the whole packed folder (a shared build is mostly its DLLs), not ffmpeg.exe alone
  const mb = () => Math.round(fs.readdirSync(OUT).reduce((n, f) => n + fs.statSync(path.join(OUT, f)).size, 0) / 1e6);
  const own = inSource();
  if (own) {
    const r = pack(own);
    if (!r.ok) { console.error(`desktop\\vendor\\ffmpeg cannot be packed: ${r.why}. Put an LGPL build of ffmpeg 8 there, or remove the folder.`); process.exit(1); }
    console.log(`Packed ffmpeg ${r.judged.version} (${r.judged.licence}) from desktop\\vendor\\ffmpeg (${mb()} MB), with its licence.`);
    return;
  }
  // the real file, not winget's link to it: the link would be packed as a link to a folder no friend has
  const onPath = [...new Set(String(process.env.PATH || '').split(';').filter((d) => path.isAbsolute(d)).map((d) => path.join(d, 'ffmpeg.exe'))
    .filter((exe) => fs.existsSync(exe)).map((exe) => fs.realpathSync(exe)))];
  for (const exe of onPath) {
    const r = pack(exe);
    if (r.ok) { console.log(`Packed ffmpeg ${r.judged.version} (${r.judged.licence}) from ${exe} (${mb()} MB), with its licence.`); return; }
    console.warn(`Not packing the ffmpeg at ${exe}: ${r.why}.`);
  }
  // none: the installer goes without, and the folder the build packs is left empty but for a note
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'README.txt'), 'No ffmpeg was packed with this build. The app uses one on the PATH, if it can, or the browser\'s own screen capture.\r\n');
  console.warn('No LGPL ffmpeg to pack: the installer is built without one. To pack one, put an LGPL build of ffmpeg 8 in desktop\\vendor\\ffmpeg (see docs/FFMPEG.md).');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
