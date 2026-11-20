# Third-party notices

Chatterday's own code is under the MIT license (see `LICENSE`). It is built on, downloads, or talks to the things
listed here, and each of those comes under its own license or terms, not ours. This page is meant to be an honest
list of all of it.

## npm packages

### The server and web app (`package.json`)

| Package | Used for | License |
|---|---|---|
| `@fontsource/vt323` | The VT323 pixel font the app is set in | OFL-1.1 |
| `livekit-client` | Voice, video and screen sharing in the app | Apache-2.0 |
| `livekit-server-sdk` | Making voice room tokens on the server | Apache-2.0 |
| `react` | The app's user interface | MIT |
| `react-dom` | Putting the interface on the page | MIT |
| `ws` | The live connection between the app and the server | MIT |
| `zustand` | The app's shared state | MIT |
| `@types/node` (dev) | Type definitions for Node | MIT |
| `@types/react` (dev) | Type definitions for React | MIT |
| `@types/react-dom` (dev) | Type definitions for React DOM | MIT |
| `@types/ws` (dev) | Type definitions for ws | MIT |
| `@vitejs/plugin-react` (dev) | React support in the build | MIT |
| `typescript` (dev) | Type checking | Apache-2.0 |
| `vite` (dev) | Building and serving the web app | MIT |

### The desktop app (`desktop/package.json`)

| Package | Used for | License |
|---|---|---|
| `electron` (dev) | The desktop app's shell | MIT |
| `electron-builder` (dev) | Building the Windows installer | MIT |

### Everything those pull in

The packages above depend on others, and each of those is covered by its own license. At the time of writing they
were all permissive (MIT, ISC, Apache-2.0, BSD, BlueOak-1.0.0, 0BSD, Python-2.0, WTFPL, CC0), except
`lightningcss` (part of Vite's build), which is MPL-2.0. MPL-2.0 is file-level copyleft: it only matters if you
change and redistribute lightningcss itself. Versions change, so check for yourself:

```powershell
npm ls --all
npx license-checker --summary
cd desktop; npx license-checker --summary
```

## Downloaded at setup or build time

None of these are in the repository. They are fetched by the scripts the first time they are needed.

| What | Fetched by | From | License |
|---|---|---|---|
| LiveKit server (`bin\livekit-server.exe`, v1.13.11) | `scripts/setup.ps1` (`npm run setup`) | `https://github.com/livekit/livekit/releases/download/v1.13.11/`, checked against LiveKit's published `checksums.txt` | Apache-2.0 |
| Electron runtime (Chromium, Node, FFmpeg and more) | `npm install` in `desktop/` | Electron's GitHub releases, via the `electron` package | MIT for Electron; Chromium and its parts are under their own licenses, listed in `LICENSES.chromium.html`, which Electron ships and the installer carries |

**About Tailscale.** Chatterday does not include, bundle or install Tailscale. Each person who uses it downloads it
from tailscale.com and signs in with their own account, accepting Tailscale's Terms of Service themselves. The desktop app
only checks whether Tailscale is running (with its open-source command-line tool, BSD-3-Clause) and links to Tailscale's
download page. Tailscale is a trademark of Tailscale Inc.; Chatterday is not affiliated with it.

**FFmpeg (optional, packed into the installer only if the host provides one).** The desktop app can capture a shared
screen on the graphics card with [FFmpeg](https://ffmpeg.org) 8.0 or later. Nothing downloads it: the host puts a build
in `desktop\vendor\ffmpeg\` (or has one on their PATH), and `scripts/pack-ffmpeg.mjs` packs it when the installer is built.

- **Licence:** LGPL-2.1-or-later (LGPL-3.0-or-later for a build configured with `--enable-version3`). The packer runs
  `ffmpeg -version` and **refuses** any build configured with `--enable-gpl`, `--enable-nonfree`, `--enable-libx264` or
  `--enable-libx265`, so only an LGPL build is ever passed on. (Encoding goes through the graphics card's own encoders:
  NVENC, AMF or Quick Sync.)
- **Shipped with it:** the build's own licence file (`resources\ffmpeg\LICENSE-ffmpeg.*` in the installed app) and
  `resources\ffmpeg\FFMPEG-BUILD.txt`, which records that build's exact version, its full configure line, the licence it
  is under and links to its source. `scripts/build-installer.ps1` stops if ffmpeg was packed without them.
- **Unmodified, and a separate program.** `ffmpeg.exe` (and a "shared" build's own DLLs) are copied as they are. The app
  starts it as its own process and reads its output; nothing of FFmpeg is linked into Chatterday. Anyone may replace it
  with another build.
- **Source:** the release tarball for that version at `https://ffmpeg.org/releases/` (for example
  `ffmpeg-8.0.1.tar.xz`), or the matching commit or tag in `https://github.com/FFmpeg/FFmpeg`. `FFMPEG-BUILD.txt` names
  the exact one. The build scripts are those of whoever made the build (for example BtbN's FFmpeg-Builds on GitHub).
- Without a packed ffmpeg, the app uses one on the PC's PATH if it can capture, or falls back to the browser's own
  screen capture. A PC's own ffmpeg is that person's, under whatever licence it came with.

FFmpeg is a trademark of Fabrice Bellard, originator of the FFmpeg project. Chatterday is not affiliated with it.

**`desktop\sharesound.exe`** is not downloaded. It is built from `desktop/sharesound.cs` in this repository, using the
C# compiler that comes with Windows.

## Fonts

| Font | Where | License |
|---|---|---|
| VT323 (Copyright 2011, The VT323 Project Authors), via `@fontsource/vt323` | The whole app | SIL Open Font License 1.1 |
| Segoe Script, or Lucida Handwriting or Brush Script if that is missing (Windows system fonts) | Only when `scripts/make-clubhouse.py` draws the neon "Chatterday" sign. The letters are drawn once into `client/public/clubhouse/neon.png`, and no font file is included | Microsoft's font license, part of Windows |
| Segoe UI, Consolas (system fonts) | Named in CSS. They are only used if the viewer's PC has them | Not included |

## Outside services the app talks to

The app is meant to run on your own PC, but a few features reach out to the web. Each service's own terms apply to
how you use it.

| Service | Used for | Who talks to it | Key needed? |
|---|---|---|---|
| Open-Meteo (`api.open-meteo.com`, `geocoding-api.open-meteo.com`) | The weather and time of day in the house, and finding a town by name | The server | No. Open-Meteo's free tier is for non-commercial use, and asks for credit (CC BY 4.0 data) |
| GIPHY (`api.giphy.com`, `i.giphy.com`) | The GIF button in chat. The app shows "Powered by GIPHY" | Each person's app | Yes, a free key from developers.giphy.com |
| YouTube (`youtube.com/oembed`, `youtube-nocookie.com` embeds, `i.ytimg.com` thumbnails) | The shared music Player, and playing YouTube links posted in chat | The server looks up the title of a pasted link. Each person's app plays videos in YouTube's embedded player, always visible | No |
| YouTube Data API (`googleapis.com/youtube/v3/search`, `/videos`) | Searching by name for the Player, and refreshing saved titles every 30 days as YouTube's terms require | The server | Optional: the host's own Google API key. Without it, only pasted links work |
| Any website linked in chat | Link preview cards (title, description, picture), in `server/links.ts` | The server, once per link | No |
| Tailscale | Connecting friends' PCs to the host PC. Not included: each person installs it from tailscale.com themselves | Each person's own Tailscale. The desktop app only checks whether it is running and links to Tailscale's download page | Each person's own free Tailscale account |
| npm, GitHub, Tailscale's package site | Downloading the parts listed above | Setup and build scripts only | No |

## Pictures, sounds and other files in the repository

As far as we can tell from the repository, all of the art was made for Chatterday. Most of it is drawn by scripts in
this repository, a pixel at a time, rather than taken from an asset pack.

| Files | Where they come from |
|---|---|
| `client/public/clubhouse/*.png`, `client/src/clubhouse.gen.ts`, `art/clubhouse-*.png`, `art/yard-*.png`, `art/window-*.png`, `art/table-preview.png` | Drawn by `scripts/make-clubhouse.py` (with `scripts/pixelkit.py`) |
| `client/public/games/*.png`, `art/games-preview.png`, `art/mahjong-preview.png` | Drawn by `scripts/make-games.py` |
| `client/public/icons.png`, `client/src/icons.gen.ts`, `art/icons-preview.png` | Drawn by `scripts/make-icons.py` |
| `client/public/icon.svg`, `art/logo.svg`, `desktop/icon.png`, `desktop/icon.ico`, `desktop/tray.png` | Drawn by `scripts/make-logo.mjs`, from `client/src/logo.ts` |
| `art/logos/pixel-sun/09-centered/*` | Drawn by `art/logos/pixel-sun/09-centered/generate.mjs` |
| `art/logos/*.svg`, `art/logos/pixel-sun/*.svg`, their `preview.png` and `index.html` pages | Logo drafts made for Chatterday while choosing its logo: plain SVG written from scratch, no outside art. The throwaway scripts that wrote them are not kept |
| Characters, pets and desks (in the app, plus `art/looks-preview.png`, `art/look-parts-preview.png`, `art/pets-preview.png`, `art/desks-preview.png`) | Drawn in code by `client/src/draw/*.ts`. The previews come from `scripts/preview-looks.mjs` and `scripts/preview-pets-desks.mjs`. Drawn from scratch for this project. The character code was ported from an earlier Python version of the same drawing code, which also used no outside art |
| `docs/screenshots/*.png` | Screenshots of the app running the demo, taken by `scripts/screenshots.mjs` |
| Sound | No sound files are in the repository. Soundboard clips (`soundboard/`) and entrance clips (`entrance sounds/`) are added by whoever runs a server, and git ignores them |

## Games

Chess, checkers (American/English draughts), go, mahjong (Hong Kong style), hearts, spades, rummy, mancala (the
Kalah way) and four in a row (`server/games/`) are traditional games. The code is written from their rules, which
nobody owns. "Four in a row" is used rather than any brand name for that game.

The four arcade games (`client/src/components/Arcade.tsx`) are Chatterday's own: Kibble Run, Moth Raid, Rock Drift
and Paddle Duel. They play in the style of classic arcade genres (a maze chase, a diving-swarm shooter, a
drifting-rocks shooter and bat-and-ball), with their own names and art, drawn in code.

## Copied code

No code or art was copied from other projects. All of it, art included, was written for this project, with AI help (Claude).

## Inspiration

The idea of a pixel-art room where each person's character moves around to show what they're doing was inspired by
two MIT-licensed projects. Nothing was copied from either; they were looked at for the idea and the feel:

| Project | Licence | What it inspired |
|---|---|---|
| [pixel-agents](https://github.com/pixel-agents-hq/pixel-agents) | MIT | Characters that walk to a desk and work or idle depending on their state |
| [Star-Office-UI](https://github.com/ringhyacinth/Star-Office-UI) | MIT (code). Its art has separate, stricter terms, and none of it is used here | A pixel office that moves a character between areas by status, with guests joining |

## Trademarks

Chatterday has nothing to do with the companies and products named in it. Some names appear only so the app can
recognise what is running on a PC and show a friendly status ("playing Minecraft", "watching Netflix"). These include
Steam, Epic Games, Riot Games, Xbox, GOG, Ubisoft, EA, Rockstar Games, Battle.net, Minecraft, Roblox, osu!, Dolphin,
World of Warcraft, GTA V, Diablo IV, VLC, Plex, Netflix, Stremio,
Kodi, Jellyfin, Disney+, YouTube, Hulu, Prime Video, Crunchyroll, Peacock, Paramount+, Apple TV and Max (in
`desktop/main.cjs` and `client/src/components/Settings.tsx`). GIPHY, YouTube, Google, Tailscale, LiveKit, Open-Meteo,
Electron and Windows are named because Chatterday uses them. Every trademark belongs to its owner.

Spotted something wrong or missing? This repository isn't maintained, so fix it in your own fork, and please keep the credits accurate when you share it on.
