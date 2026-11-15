# AGENTS.md: setting up Chatterday with an AI agent

Written for AI coding agents (Claude Code, Codex, Cursor, Copilot, Gemini and the like). A person points their agent at this repository, says "set this up for me", and the agent follows this file.

You may be working for one of two people:

- **The host:** runs the server on their own Windows PC and invites friends. Start at [Host setup](#host-setup).
- **A friend:** connects to someone else's server. Start at [Friend setup](#friend-setup).

If it isn't clear which one, ask. Everything here is **Windows 10/11**, and commands are for **PowerShell** in the repo folder.

---

## Ground rules (read first)

These keep the project within its licences and third parties' terms. Don't break them, even if asked to "just make it work".

1. **Never bundle, redistribute or silently install Tailscale for someone else.** Tailscale licenses its client to each person for their own use. Each person installs Tailscale on their own PC and signs in with their own account, and that's where they accept Tailscale's terms. You may install it on the PC of the person you're working for, with their go-ahead, from Tailscale's official source (see below). **They** sign in.
2. **Never add a way to read YouTube's search pages, or to play YouTube audio without its video.** Search goes through the official YouTube Data API with the host's own key only. The player stays visible (at least 200×200) whenever it plays. See `server/music.ts` and `client/src/components/Music.tsx`.
3. **Never commit or print secrets.** `.env`, `data/` (database, uploads, `secrets.json`), `desktop/server.txt` and `desktop/update-key.txt` are gitignored and must stay out of git. Don't echo API keys back in chat.
4. **First-run setup must happen at `http://127.0.0.1:<PORT>` on the host PC itself.** The server refuses it from anywhere else, including through a proxy or `tailscale serve`, so whoever claims a new server is the person at the host PC. Don't work around this.
5. **Leave the human steps to the human.** Signing in to Tailscale, accepting terms, changing the Tailscale admin console, creating API keys and sending invites are theirs. Tell them exactly what to click, then wait.

---

## Host setup

### 1. Prerequisites

```powershell
node --version            # must be v24 or newer (the server runs TypeScript directly)
winget --version          # used below; present on current Windows 10/11
```

If Node is missing or old, ask before installing it: `winget install --id OpenJS.NodeJS -e`. Then reopen the terminal.

### 2. Install, fetch the voice engine, build

```powershell
npm install
npm run setup             # downloads LiveKit into bin\ and checks its published checksum
npm run build             # type-checks and builds the web UI into client\dist
```

All three must finish without errors. `npm run setup` is safe to run again.

### 3. Optional settings

Copy `.env.example` to `.env` **only if** something needs changing (port, data folder, API keys). Every setting is optional, and keys can also be pasted into the app later (**Settings → Admin**).

### 4. Start it

```powershell
npm start                 # foreground, shows the log
```

For normal use the host double-clicks **`Chatterday Server.vbs`** instead (a tray icon, restarts by itself). To start with Windows: `powershell -ExecutionPolicy Bypass -File scripts\autostart.ps1`.

Check it's up: `Invoke-RestMethod http://127.0.0.1:4477/api/hello` returns `needsSetup: true` on a fresh server.

### 5. Claim the server (human step)

Tell the host: open **`http://127.0.0.1:4477`** in a browser **on this PC**, name the place, and choose a name and password. That account becomes the admin. Wait until they've done it.

### 6. Tailscale on the host PC

Friends reach the host only over Tailscale. With the host's go-ahead:

```powershell
winget install --id Tailscale.Tailscale -e     # Tailscale's official package
```

Then **the host** signs in from the Tailscale icon by the clock, with their own account. Leave the PC **untagged**: Tailscale can't share a tagged machine. Then:

```powershell
& "$env:ProgramFiles\Tailscale\tailscale.exe" status --json | ConvertFrom-Json | ForEach-Object { $_.Self.DNSName.TrimEnd('.') }
# e.g. my-pc.tail1234.ts.net  -> the address friends use: http://my-pc.tail1234.ts.net:4477
```

Open the Windows firewall to Tailscale addresses only. This needs an **administrator** PowerShell; ask the host to run it, or to approve the elevation:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\firewall.ps1
```

### 7. Lock friends down to Chatterday (human step)

The host opens **Settings → Admin → Getting friends connected** in the app. It shows the exact access rules, with this PC's address and ports filled in. They paste them into the Tailscale admin console (**Access controls**), keeping any rules of their own. For reference, the shape is:

```jsonc
{
  "hosts": { "chatterday-host": "100.x.y.z" },
  "grants": [
    { "src": ["autogroup:member"], "dst": ["*"], "ip": ["*"] },
    { "src": ["autogroup:shared"], "dst": ["chatterday-host"], "ip": ["tcp:4477", "tcp:7881", "udp:7882"] }
  ]
}
```

### 8. Build the friends' installer

Save the address friends use, then build:

```powershell
Set-Content -Path desktop\server.txt -Value 'http://my-pc.tail1234.ts.net:4477' -Encoding ascii   # the host's real address
powershell -ExecutionPolicy Bypass -File scripts\build-installer.ps1
```

Or press **Build the installer** in **Settings → Admin**, which does the same. The output is `desktop\dist\Chatterday-Setup-<version>.exe`, built from `version` in `desktop\package.json`.

- **Generic build:** without `desktop\server.txt`, the installer is generic and asks for an address on first run.
- **Not code-signed:** Windows will warn "unknown publisher" (**More info → Run anyway**).
- **Updates:** raise `version` in `desktop\package.json` so installed apps offer the update. Signing updates is optional; see `docs/SIGNED-UPDATES.md`.
- **No Tailscale inside:** the installer never contains Tailscale. If you're tempted to add it, re-read the ground rules.

### 9. Invite each friend (human step, partly)

For each friend, the host needs three things to send privately:

1. **A Tailscale share link.** Admin console → **Machines** → this PC's **⋯** → **Share** → **Copy link** (human step).
2. **A Chatterday invite:** `npm run invite`, which prints a single-use link, or **Settings → Admin → People**.
3. **The installer** from step 8.

### 10. Optional extras

| Feature | What it needs | Where |
|---|---|---|
| GIF search | A free Giphy key (developers.giphy.com) | Settings → Admin, or `GIPHY_KEY` in `.env` |
| Searching the Player by name | The host's own YouTube Data API v3 key (Google Cloud console, free, about 100 searches a day). Without it, pasted links still work | Settings → Admin, or `YOUTUBE_KEY` in `.env` |
| Weather and the house clock | Nothing, just a town name | Settings → Admin |
| Picture on the lounge wall, soundboard, entrance sounds | Nothing | Settings → Admin; `soundboard\` and `entrance sounds\` folders |

The host creates the API keys themselves, since that's where they agree to Giphy's and YouTube's terms. You may paste them into `.env` once they give them to you.

---

## Friend setup

You're on the **friend's** PC. They should have received an installer, a Tailscale share link and a Chatterday invite link from their host.

1. **Install Tailscale on this PC**, with the friend's go-ahead: `winget install --id Tailscale.Tailscale -e`. **The friend** signs in with their own free account and accepts Tailscale's terms.
2. **The friend opens the share link** in a browser, signs in with the same Tailscale account, and accepts.
3. **Run the Chatterday installer.** The app shows a three-step checklist and connects by itself once the host's PC answers.
4. **The friend opens the invite link** to choose a name and password, then builds a character.

No installer? A browser works too: open the host's address (`http://<host>.ts.net:4477`). The microphone only works in the desktop app over plain `http`.

---

## Verify your work

```powershell
npm run build                                                        # client type-check and build
npm test                                                             # draws and checks hundreds of characters, pets, desks
node --test server/test/invite.test.mjs server/test/admin-setup.test.mjs   # 40 server tests on a throwaway server
node scripts/test-server.mjs                                         # a throwaway server on port 4478 (Ctrl+C to stop)
```

Never test against the real `data/` folder. The test scripts use temporary data and their own ports.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `npm start` fails with a syntax error on types | Node is older than v24 |
| "Voice is not running on the server" | `npm run setup` (LiveKit missing from `bin\`) |
| "Set the server up from the PC it runs on" | First run must be at `http://127.0.0.1:4477` on the host, not a Tailscale name or proxy |
| A friend's checklist stops at step 2 | The share wasn't accepted, or was accepted with a different Tailscale account than the one signed in |
| Text works, voice doesn't | `scripts\firewall.ps1` wasn't run, or `udp:7882` is missing from the Tailscale rules. If it still fails, set `LIVEKIT_NODE_IP` in `.env` to the host's Tailscale IP |
| Locked out as admin | `node server/accounts.ts reset <name>` on the host PC |

## Where things are

- `server/`: Node server (no framework). Entry point `server/index.ts`; config and env in `server/config.ts`.
- `client/`: React UI, built into `client/dist`. Pixel art is drawn in code in `client/src/draw/`.
- `desktop/`: the Electron app friends install. `desktop/connect.html` is the first-run Tailscale checklist.
- `scripts/`: setup, installer build, firewall, demo, tests, art generators.
- More: [README.md](README.md), [docs/ADMIN-GUIDE.md](docs/ADMIN-GUIDE.md), [docs/CONNECTING-FRIENDS.md](docs/CONNECTING-FRIENDS.md), [DISCLAIMER.md](DISCLAIMER.md), [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

This repository is shared as-is and isn't maintained. If you change it for your person, change it in their fork.
