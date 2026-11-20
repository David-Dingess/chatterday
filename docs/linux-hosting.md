# Hosting Chatterday on Linux (optional notes)

Chatterday is written and tested for a Windows host PC. These are notes for anybody who would rather run the server on
a small Linux machine (a spare box at home or a cloud VM) so the PC can sleep. They are not a supported setup: nothing
here is tested as part of a release.

## What carries over

- **The server runs unchanged.** It is plain Node 24 with no compiled packages, and LiveKit publishes Linux builds
  (`amd64` and `arm64`). Before moving, run `node scripts/linux-check.mjs` on the PC: it finds file names and imports
  whose capital letters don't match, which Windows forgives and Linux doesn't.
- **The data folder moves by copy, not git.** Copy `data/` (stop the server first, or take the database with
  `node --no-warnings scripts/snapshot-db.mjs <out.db>` while it runs), plus `soundboard/`, `entrance sounds/`, the
  newest desktop installer if you offer updates, and `.env`.
- **What changes:** the Windows tray becomes a systemd service (below), and `scripts/restart.ps1` becomes
  `systemctl restart`. The server's own `/local/restart` exits with code 0 on purpose, so the service must restart it
  whatever the exit code.

## Setting up (Ubuntu 24.04 as the example)

1. Install Node 24 (NodeSource's packages or your distribution's), `git`, and Tailscale from
   [tailscale.com/download](https://tailscale.com/download). Sign the machine in to **your own** tailnet.
2. Create a system user for the service, for example `chatterday`, and clone your fork into `/opt/chatterday`.
3. Fetch LiveKit into `bin/`. `npm run setup` is Windows-only, so download `livekit_<version>_linux_<arch>.tar.gz`
   and `checksums.txt` from LiveKit's GitHub releases (use the version in `scripts/setup.ps1`), check it with
   `sha256sum -c`, and put `livekit-server` in `bin/`.
4. `npm ci` and `npm run build` as that user.
5. Firewall: allow traffic on the `tailscale0` interface and UDP 41641 (Tailscale's direct connections). Nothing else
   needs to be open to the internet.
6. **First-run setup still has to happen at `http://127.0.0.1:4477` on the machine itself.** Over SSH, forward the
   port (`ssh -L 4477:127.0.0.1:4477 <host>`) and open it in your own browser. Don't work around the check.
7. In the Tailscale admin console, give the new machine the same access rules the Windows host had (Settings → Admin →
   Getting friends connected shows them), and point `desktop\server.txt` at the new address before building the
   friends' installer.

## A systemd service

`/etc/systemd/system/chatterday.service`:

```ini
[Unit]
Description=Chatterday server
After=network-online.target tailscaled.service
Wants=network-online.target tailscaled.service

[Service]
User=chatterday
WorkingDirectory=/opt/chatterday
# The server listens on its Tailscale address only if it has one when it starts: wait for it, up to a minute.
ExecStartPre=/bin/bash -c 'for i in $(seq 60); do ip -4 addr show tailscale0 2>/dev/null | grep -q "inet 100\\." && exit 0; sleep 1; done; exit 0'
ExecStart=/usr/bin/node server/index.ts
Restart=always
RestartSec=2
TimeoutStopSec=15
StandardOutput=append:/opt/chatterday/data/server.log
StandardError=append:/opt/chatterday/data/server.log
NoNewPrivileges=true
ProtectSystem=full
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

Then `sudo systemctl enable --now chatterday`. Rotate `data/server.log` with logrotate's `copytruncate`, since the
server keeps the file open.

## Backups

A nightly timer that runs something like this keeps two weeks of backups:

```bash
set -euo pipefail
cd /opt/chatterday
OUT=/var/backups/chatterday; STAMP=$(date -u +%Y-%m-%d); T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
node --no-warnings scripts/snapshot-db.mjs "$T/chatterday.db"
tar -czf "$OUT/chatterday-$STAMP.tar.gz" --exclude='data/chatterday.db*' --exclude='data/*.log' --exclude='data/livekit.yaml' data -C "$T" chatterday.db
find "$OUT" -name 'chatterday-*.tar.gz' -mtime +14 -delete
```

The backups hold everyone's accounts and the `secrets.json` keys: keep them private, and copy one off the machine now
and then.

## Free cloud tiers

Some providers reclaim free VMs that look idle. A hangout for a few friends uses very little CPU or network, so read
your provider's idle rules before relying on one, and keep backups off the machine.
