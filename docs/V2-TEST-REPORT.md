# v2 test report (Phase 5)

Tested on 2026-11-19, on branch `v2` before its history was squashed into one commit. Everything ran on throwaway servers with scratch data folders and free ports (4478, 4485, 4591, 4613, 4721,
4731, and LiveKit on 7890, 7896, 7950, 7963, 7971, 7981). Nothing touched a live server, its ports or its data.

Setup note: this workspace had no `bin\livekit-server.exe`, so `npm run setup` had never been run here. Rather than download it again, I
copied LiveKit 1.13.11 from the v1 checkout. Its SHA-256 matches the one already in use on this PC. `bin\` is gitignored.

## Automated: all pass

| Test | Result |
|---|---|
| `npm run build` | passes |
| `node --test server/test/*.test.mjs` | 52/52 |
| `npm test` (avatars, pets, desks) | 554 sheets; 1688 pets, 551 desks, 109175 checks: ok |
| `node --test scripts/test-pack-ffmpeg.mjs` | 13/13 |
| `scripts/test-room-layout.mjs` | all reachable, nothing overlaps |
| `client/src/holidays/dates.test.mjs` | 121 checks ok |
| `scripts/linux-check.mjs` | no case problems (2 before the fix below) |
| `scripts/desktop-smoke.mjs` (Electron, fake mic, real screen picker) | 52/52 |
| `scripts/sharesound-test.mjs` (a real test tone) | 4/4 |
| `scripts/flood/run.mjs` | access 122/0; flood 51/0 (50/1 before the fix below); game fuzz all ok, perft all ok, 300,000 table actions with 0 wrong |
| v1 → v2 upgrade (`phase2a-upgrade-test.mjs`, real v1 `dc3a7fb` in a worktree) | 41/41 |

## Fixed

- **Draw & Guess imports broke on Linux.** The Phase 3 rename left `server/index.ts` importing
  `./drawGuess.ts` and `Board.tsx` importing `../drawGuess.css`, but the files are `drawguess.*`. Windows doesn't care
  about case. On Linux the server would not start and the build would fail. `linux-check.mjs` caught both.
- **The flood test failed on a log line, not on a handler error.** v2 brought over the server's rate-limit notice
  (`[ws] … sent N messages in 10 s; past the first 120 were ignored`), and `flood.mjs` counted every `[ws]` line as a
  handler that threw. That gave 53 "errors" and the only flood failure. The check now skips that notice. In the same
  commit, a request whose client hangs up mid-body (`ECONNRESET`) is dropped quietly. Before, the stalled-login flood
  wrote 1500 full stack traces.
- **README screenshots taken again on v2.** I ran `scripts/screenshots.mjs` with `PORT=4485`, because its default
  of 4480 is taken on this PC. They show only the demo's made-up people.
- **A share nobody has opened now drops to 2 fps.** It used to run at the full rate until somebody had
  watched and left. Details under "The by-hand list".
- **The Player's terms line names Twitch's terms for a Twitch item**, instead of YouTube's. (Twitch was then
  dropped from 2.0: see "Twitch: dropped".)
- **`games.ts` genre words:** four `\b` word edges in the game-screen kinds had been saved as backspace characters, so
  "FPS", "car", "ball" and "craft" could never match. Fixed with the Twitch drop.

## Fresh install: pass

On an empty data folder (port 4721):
- The setup card at `http://127.0.0.1:4721` shows the content note ("depicts alcohol and tobacco use…"), and setup
  works. The admin lands in the character builder.
- Setup is refused (403) with `X-Forwarded-For`, with `Forwarded:`, with a rebound `Host:` (`rebind.example`), and from
  this PC's Tailscale address. The LAN address (192.168.x) gets no answer at all, because the server only listens on
  loopback and Tailscale. The server tests cover the same cases.

## v1 upgrade: pass (lower priority: v1 was never handed out)

The real v1 makes two accounts with an invite, a status, a birthday, a pet, a desk, a look, a chat message with a reaction,
a private chat, a used and an open invite, a saved playlist, a stash item and settings (name, °C, time zone). Then v2
opens the same folder. It upgrades the database to schema 1, keeps every v1 row and setting, keeps the v1 sign-ins
signed in, accepts the v1 passwords, and makes a thread reply on an old message. A second start doesn't upgrade again,
and the log has no errors. (v1 has no threads, so there was no v1 thread to carry over.)

## In the browser: pass

These ran in headless Edge over the DevTools protocol, with two signed-in people (Avery, the admin, and Sam). The
browser pane gets no animation frames while hidden. Scripts and screenshots are in the session scratchpad, not the repo.

- **Every floor** rendered with both people and **0 page errors**: the hangout, game room, DnD, karaoke, the unfinished
  basement, campsite, backyard, lake, and mini golf 1, 2 and 3.
- **Two-player games**, played over the socket while both pages watched, with 0 page errors and no server errors. Pool
  (sit 0/1, racked, shots played out), darts (join, start, 12 rounds, scores fall), shuffleboard, bowling, Hold'em (sit,
  hand dealt to showdown), cornhole, beer pong, bocce, horseshoes and mini golf all went turn by turn. Fishing: both
  cast, got a bite, hooked, reeled, landed and kept a catch. Draw & Guess: open, join, begin. Only the drawer sees the
  word, a right guess scores, and stop ends it. The disco switch turns on and off for everybody.
- **Play Games** lists 21 games. Each outdoor or basement entry takes you to its floor (pool, darts, shuffleboard,
  bowling and Hold'em to the game room; cornhole to the campsite; beer pong, horseshoes and bocce to the backyard; mini
  golf; fishing to the lake; sudoku stays upstairs). While you're seated at a card-table game, Play Games opens that
  table first, and "All games" goes back to the list.
- **Karaoke** (UI only): "Sign up to sing" opens its menu. **Sudoku**: the book opens with a puzzle. **Vacuum**
  (`?vacuum`) renders.
- **Settings → Admin → time zone:** the field has 418 zones. Setting `Asia/Tokyo` changed the room's wall clock to
  Tokyo time at once, and "Use the host PC's (…)" puts it back. The house setting covers everybody.
- **Wall photos:** three uploads hang, and the Admin thumbnails show with Take down, Add photos and Take them all down.
- **Seasons and holidays:** `?date=12-25` (tree), `10-31` (pumpkins), `04-20` (spring flowers), `07-04` and
  `01-15&weather=snow`, upstairs and at the campsite and backyard. All render, night at the right hours, snow with
  snow, and 0 page errors.

## Restarts: pass

Avery is a page in a voice chat (fake microphone, LiveKit confirmed). Sam starts a video in the Player. Then:
- **The tray's way** (`POST /local/restart`): the server is back in 5.2 s. Avery is back in the same voice chat
  (LiveKit lists Avery in `vc-2`), and the Player has the same video. The server holds the video's place while it's
  down, so it carries on from where it was.
- **A hard kill**, then start: the same, back in 2.3 s.
- The only page errors were LiveKit's own reconnect messages ("error reading from signal stream", "Failed to fetch",
  "Received leave request while trying to (re)connect"). Those are expected while the server is down.

## Installer: pass (with the owner's go-ahead)

- `desktop\dist\Chatterday-Setup-0.1.9.exe` (157 MB, the generic build with no server address in it) installed
  silently per user to `%LOCALAPPDATA%\Programs\chatterday-desktop` and registered as "Chatterday 0.1.9".
- `resources\ffmpeg\` has `ffmpeg.exe`, its 7 DLLs, `LICENSE-ffmpeg.txt` and `FFMPEG-BUILD.txt`. The app looks there
  first. That `ffmpeg.exe` runs (`n8.1.3-36-ge22a4510c9`, `--enable-version3`, no `--enable-gpl`/`--enable-nonfree`,
  `--disable-libx264 --disable-libx265`) and has the `gfxcapture` filter, which passes the app's first two checks.
- Uninstalled silently afterwards: no folder, registry entry or shortcuts left. The installed app was never launched.
- **Not done:** installing over a v1 app, because v1 was never handed out, so it was skipped. The update offer itself
  passed in `desktop-smoke` as a dry run. (The GPU path was tested afterwards: see the next section.)

## The "by hand" list, done on one PC (with the owner's go-ahead)

Two PCs weren't available. Each check below plays the friend with a second client on this PC: a headless Edge page,
or the desktop app reaching the throwaway server by the PC's own Tailscale name over plain http, as a friend's app does.
Everything was stopped gracefully. The desktop app was quit through its own `app.quit()`, ffmpeg ended when the share
was stopped, and nothing was force-killed.

- **Screen share, GPU path: pass after a fix.** The desktop app (from source, with the packed LGPL ffmpeg) shared a real
  screen. ffmpeg ran `gfxcapture` and **`h264_nvenc`**, and the other person saw it at 2580×1080, 30 fps, decoded in
  hardware. Watching took it to the full rate, and five seconds after the last watcher left it dropped to **2 fps**.
  Stopping the share ended ffmpeg by itself, and the app quit cleanly.
  - **Bug found and fixed:** a share nobody had opened *since it started* stayed at the full rate (30 fps for
    as long as it ran), with another person in the call or with nobody. That's exactly the "share a game nobody watches"
    case. The idle check only trusted LiveKit, which switches a share's layers off only after a subscriber has come and
    gone. It now also counts as idle while nobody's "watching" list names the sharer. Re-run: 2 fps from the start,
    full rate when watched, 2 fps again after.
- **Screen share without the GPU path: pass.** With the app's own capture switched off (`cd_share` `{native:false}`),
  no ffmpeg ran. The browser captured at 29 fps (Chromium's own hardware encoder), the other person saw it, and with
  nobody watching LiveKit sent nothing.
- **Voice through the Tailscale name: pass.** A page reaching the server as `http://<pc>.ts.net:4721` signs in and joins
  voice, and so does the desktop app.
- **YouTube in the Player: pass.** A pasted link plays through the Tailscale name. The embed reports its time moving on.
- **Twitch: dropped for 2.0.** In the desktop app, Twitch's player loaded and talked to the page, but only because
  the app rewrote Twitch's `frame-ancestors` header to accept a plain-http page. In a plain browser the frame was
  refused. Twitch's embed rules ask for an https page, and nobody was around to test a live channel, so the owner
  dropped Twitch. All of these are gone:
  - Twitch links and search (`server/music.ts`), the Player's site switch, and the Theatre-only Twitch player.
  - The Twitch app fields in Settings → Admin, `TWITCH_*` in `.env.example`, and Twitch in the page's `frame-src`.
  - The header rewrite in `desktop/main.cjs`.

  A Twitch link typed into the Player is now searched for on YouTube like any other text. Twitch items saved in the
  Player from before are dropped when the server starts. I checked this on a throwaway server: the YouTube item
  stays, and `/admin/config` has no Twitch fields. "Watching Twitch" as a status, read from a browser's window title,
  went too.
- **Server restart from the tray: pass.** I ran `scripts/server-tray.ps1` itself on the throwaway port and data. Its
  Restart (`/local/restart`) brought the server back in 8.6 s, and a crash of the node process came back in 5.0 s
  through the tray's watcher. Both times the page was back in the same voice call (LiveKit confirmed) and the Player
  kept its video at the right place.
- **Game screens on the projector: pass.** A share with a game in front puts a screen for its kind on the projector:
  racing, rpg, cards, or arcade for an unknown name. The bar TVs in the game room show the small one. When the
  game leaves the front, it goes back to the share's still.
- **A friend's first run from the installer: pass.** I installed the generic installer silently and opened the
  installed app with a scratch profile. It asked for an address. With the PC's Tailscale name, the checklist went
  straight through to the host's sign-in page. Then an invite link, name and password led to "Welcome to Test House,
  Riya" and the character builder. The app quit by itself, the uninstall was clean, and nothing was left behind.
- **Birthday: pass.** With a test account's birthday set to today on the house's clock, the cake (lit, "blow out the
  candles") and the card show, with 0 page errors.
- **Wall photos at the house's midnight:** with 7 photos, all 5 frames are filled. When the house's date moves on,
  everybody is sent a new wall with no photo twice. At a real midnight, on a second throwaway server whose house zone was a UTC+1 zone, the wall turned over by itself 57 s after midnight. That's the once-a-minute check, with nothing else changed. **Pass.**
- **Two people at basement games:** played over the socket with both pages watching (see "In the browser"). Not seen:
  each game's sounds and camera feel with real mouse play.

## Still by hand

- [ ] Two real PCs over Tailscale: voice quality both ways, and a share watched across the network (not the same PC)
- [ ] YouTube search with the host's own key
- [ ] Karaoke with a real YouTube key: search, sign up and sing
- [ ] The friend's checklist when something is missing: Tailscale not installed, or the share not accepted (here,
      Tailscale was already up, so it went straight through)
- [ ] Basement games by mouse: aiming, the camera and the sounds
- [ ] An update from one installed version to the next (the dry run passed; a real install-over was not done)

## Noticed, not fixed

- A second page of the same person can pull them off a floor. While my idle browser-pane tab was open as Avery
  (upstairs, in the first-run character builder), Avery's casts at the lake were ignored. Once it was closed, both people
  fished normally. I didn't trace the cause. It's worth a look if one person with the app open on two PCs reports
  the lake or a game not answering.
- The test servers (`test-server.mjs`, the demo, a plain `npm start`) also listen on this PC's Tailscale address,
  as the real server does. That's fine, but worth knowing when running tests on a PC with friends on its tailnet.
- `scripts/screenshots.mjs` defaults to port 4480. On a PC where that port is taken, pass `PORT=…`.
