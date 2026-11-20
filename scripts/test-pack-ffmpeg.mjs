// Tests scripts/pack-ffmpeg.mjs with made-up `ffmpeg -version` outputs and a made-up build folder: no real ffmpeg is
// run, and nothing is downloaded. Run: node --test scripts/test-pack-ffmpeg.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { judge, pack, sourceFor } from './pack-ffmpeg.mjs';

const said = (version, configure) => `ffmpeg version ${version} Copyright (c) 2000-2026 the FFmpeg developers
built with gcc 15.2.0 (crosstool-NG 1.28.0)
configuration: ${configure}
libavutil      60.  8.100 / 60.  8.100
libavcodec     62. 11.100 / 62. 11.100
`;
const LGPL = '--prefix=/ffbuild/prefix --pkg-config-flags=--static --target-os=mingw32 --enable-version3 --disable-debug --enable-shared --disable-static --enable-ffnvcodec --enable-cuda-llvm --enable-amf --enable-libvpl --enable-libdav1d --enable-libopus';
const LGPL21 = '--target-os=mingw32 --disable-debug --enable-shared --enable-ffnvcodec --enable-amf';

test('an LGPL build passes, and its licence is worked out from the configure line', () => {
  const a = judge(said('n8.0.1-12-g0123abcd-20261101', LGPL));
  assert.equal(a.ok, true, a.why);
  assert.equal(a.licence, 'LGPL-3.0-or-later');
  assert.equal(a.version, 'n8.0.1-12-g0123abcd-20261101');
  const b = judge(said('8.1.2-essentials', LGPL21));
  assert.equal(b.ok, true, b.why);
  assert.equal(b.licence, 'LGPL-2.1-or-later');
});

for (const flag of ['--enable-gpl', '--enable-nonfree', '--enable-libx264', '--enable-libx265']) {
  test(`a build with ${flag} is refused`, () => {
    const j = judge(said('8.1.2-full_build-www.gyan.dev', `${LGPL} ${flag}`));
    assert.equal(j.ok, false);
    assert.match(j.why, /not an LGPL build/);
    assert.ok(j.why.includes(flag));
  });
}

test('a typical "full" GPL build is refused with every bad flag named', () => {
  const j = judge(said('8.1.2-full_build-www.gyan.dev', '--enable-gpl --enable-version3 --enable-static --enable-libx264 --enable-libx265 --enable-nvenc'));
  assert.equal(j.ok, false);
  assert.match(j.why, /--enable-gpl, --enable-libx264, --enable-libx265/);
});

test('flags are matched whole: --enable-gplv3-ish names and --disable-gpl do not count', () => {
  assert.equal(judge(said('8.0', `${LGPL21} --disable-gpl --enable-libx264rgb-not-really`)).ok, true);
});

test('older than 8.0, or no version or configure line, is refused', () => {
  assert.match(judge(said('7.1.1', LGPL21)).why, /8\.0 or later/);
  assert.match(judge('nothing useful').why, /ffmpeg version/);
  assert.match(judge('ffmpeg version 8.0\nlibavutil 60').why, /configuration/);
  assert.equal(judge('').ok, false);
});

test('the source is pointed at for a release and for a git build', () => {
  assert.deepEqual(sourceFor('8.1.2-essentials'), ['https://ffmpeg.org/releases/ffmpeg-8.1.2.tar.xz', 'https://github.com/FFmpeg/FFmpeg/tree/n8.1.2']);
  assert.deepEqual(sourceFor('n8.0.1-12-g0123abcd-20261101'), ['https://github.com/FFmpeg/FFmpeg/commit/0123abcd']);
  assert.deepEqual(sourceFor('N-121000-gdeadbeef12'), ['https://github.com/FFmpeg/FFmpeg/commit/deadbeef12']);
});

/** A made-up build folder (bin\ffmpeg.exe, a DLL, the licence one folder up) and a stand-in for running it. */
function fakeBuild({ licence = true, configure = LGPL, filters = ' ... gfxcapture   V->V  Capture with Windows.Graphics.Capture' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-ffmpeg-'));
  fs.mkdirSync(path.join(dir, 'bin'));
  fs.writeFileSync(path.join(dir, 'bin', 'ffmpeg.exe'), 'not really ffmpeg');
  fs.writeFileSync(path.join(dir, 'bin', 'avcodec-62.dll'), 'not really a dll');
  if (licence) fs.writeFileSync(path.join(dir, 'LICENSE.txt'), 'GNU LESSER GENERAL PUBLIC LICENSE');
  const run = (exe, args) => (args.includes('-version') ? said('n8.0.1-12-g0123abcd-20261101', configure) : args.includes('-filters') ? filters : '');
  return { dir, exe: path.join(dir, 'bin', 'ffmpeg.exe'), out: path.join(dir, 'packed'), run };
}

test('an LGPL build is packed with its DLLs, its licence and its build notes', () => {
  const b = fakeBuild();
  const r = pack(b.exe, { out: b.out, run: b.run });
  assert.equal(r.ok, true, r.why);
  assert.deepEqual(fs.readdirSync(b.out).sort(), ['FFMPEG-BUILD.txt', 'LICENSE-ffmpeg.txt', 'avcodec-62.dll', 'ffmpeg.exe']);
  const notes = fs.readFileSync(path.join(b.out, 'FFMPEG-BUILD.txt'), 'utf8');
  assert.match(notes, /Version: n8\.0\.1-12-g0123abcd/);
  assert.match(notes, /Licence: LGPL-3\.0-or-later/);
  assert.ok(notes.includes(`Configuration: ${LGPL}`));
  assert.match(notes, /github\.com\/FFmpeg\/FFmpeg\/commit\/0123abcd/);
  assert.doesNotMatch(notes, /ffmpeg\.org\/releases\//);  // a git build past 8.0.1 is not the 8.0.1 tarball
  assert.match(notes, /unmodified/);
  fs.rmSync(b.dir, { recursive: true, force: true });
});

test('a GPL build is refused and nothing is packed', () => {
  const b = fakeBuild({ configure: `${LGPL} --enable-gpl --enable-libx264` });
  const r = pack(b.exe, { out: b.out, run: b.run });
  assert.equal(r.ok, false);
  assert.match(r.why, /not an LGPL build/);
  assert.equal(fs.existsSync(b.out), false);
  fs.rmSync(b.dir, { recursive: true, force: true });
});

test('a build without its licence file is refused', () => {
  const b = fakeBuild({ licence: false });
  const r = pack(b.exe, { out: b.out, run: b.run });
  assert.equal(r.ok, false);
  assert.match(r.why, /no licence file/);
  fs.rmSync(b.dir, { recursive: true, force: true });
});

test('a build that cannot capture (no gfxcapture) is refused', () => {
  const b = fakeBuild({ filters: ' ... ddagrab' });
  const r = pack(b.exe, { out: b.out, run: b.run });
  assert.equal(r.ok, false);
  assert.match(r.why, /gfxcapture/);
  fs.rmSync(b.dir, { recursive: true, force: true });
});
