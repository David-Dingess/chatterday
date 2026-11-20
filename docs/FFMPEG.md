# ffmpeg in the installer (optional)

The desktop app can capture a screen with ffmpeg (`gfxcapture` and the GPU's own encoder) instead of the browser's
capture. That's optional. Without ffmpeg, screen sharing uses the browser capture.

## Packing a build

Only an **LGPL** build of ffmpeg **8.x** is packed. `scripts/pack-ffmpeg.mjs` runs `ffmpeg -version` and refuses a build
with `--enable-gpl`, `--enable-nonfree`, `--enable-libx264` or `--enable-libx265`, an older version, a build without
`gfxcapture`, or a build without its licence file.

1. Get an LGPL win64 build of ffmpeg 8.x, "shared" or static. For example, use a BtbN FFmpeg-Builds release asset
   named like `ffmpeg-n8.1-latest-win64-lgpl-shared-8.1.zip`. Don't use a `gpl` one, or gyan.dev's builds, which
   are GPL.
2. Unzip it so these exist:
   - `desktop\vendor\ffmpeg\bin\ffmpeg.exe`
   - `desktop\vendor\ffmpeg\LICENSE.txt`

   The folder is gitignored.
3. Build the installer (`scripts\build-installer.ps1`), or run `node scripts/pack-ffmpeg.mjs` on its own.

The packer looks in `desktop\vendor\ffmpeg\` first, and a build there that fails the checks stops the installer build.
Then it tries the PATH, where a GPL build is passed over with a note. It stages into `desktop\vendor\ffmpeg-packed\`:
`ffmpeg.exe`, a shared build's DLLs, `LICENSE-ffmpeg.*` and `FFMPEG-BUILD.txt`. That last file gives the version, the
licence, the full configure line and where its source is. The installer puts the folder in `resources\ffmpeg\`.

## Releasing an installer with ffmpeg inside

ffmpeg's LGPL licence asks for its source to be offered with the binary. Attach both of these to the GitHub release
that carries the installer:

- ffmpeg's source at the exact commit named in `FFMPEG-BUILD.txt`: `https://github.com/FFmpeg/FFmpeg/archive/<commit>.tar.gz`
- the build scripts for the same build (for BtbN's builds, the release tag's source archive)

Repeat this whenever the packed ffmpeg changes.

Tests: `node --test scripts/test-pack-ffmpeg.mjs` uses made-up `-version` outputs and runs no real ffmpeg.
