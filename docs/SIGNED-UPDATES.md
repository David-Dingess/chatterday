# Signed updates

The desktop app updates itself by fetching an installer from the server and running it. The app's window shows
whatever answers at the server's address, often over plain HTTP inside a private network such as Tailscale. So the question is: what stops whoever
answers at that address from running a program on every friend's PC?

Two things, both in the app itself (`desktop/main.cjs`, "updating itself"):

1. **The app asks.** Before anything is fetched or run, the app puts up a box of Windows' own: "Install Chatterday
   x.y.z from http://…?" The page cannot draw it, click it or skip it. "Not now" is the button Enter and Escape
   press, the box is not shown while the window is closed to the tray, and after a "Not now" it is not shown again
   for half a minute.
2. **The installer is signed.** An app with the host's public key inside runs an installer only if it carries a
   signature made with the host's private key. The server cannot make one, because the private key is not on the
   server's side of anything: it is a file only whoever runs the server has.

Signing is optional. Until you make a key (below), apps are built without one and take updates on the app's own
question alone.

## What is signed, and where the pieces live

| Piece | Where | Secret? |
| --- | --- | --- |
| Private key (Ed25519) | `%USERPROFILE%\.chatterday-signing\update-key.pem`, or wherever `CHATTERDAY_SIGNING_KEY` points | **Yes.** Never in the repo, never in `data\`. The script refuses both. |
| Public key | `desktop/update-key.txt` (one line), packed into the app by the build | No. It is yours alone (every server has its own), so this repository ignores it; keep a copy with your key. |
| Signature | `desktop/dist/Chatterday-Setup-x.y.z.exe.sig`, written by `scripts/sign-installer.mjs` | No. |

The signature is over one short text, `chatterday-update`, the version and the installer's SHA-256, each on its own
line. The version is in it so that an old installer, signed in its day, cannot be offered again under a newer
number. The server sends the signature in an `X-Signature` header beside the `X-Sha256` it already sent
(`serveInstaller` in `server/index.ts`).

What the app does on "Install":

1. Asks the server for the installer and reads only the answer's headers: version, size, SHA-256, signature.
2. Stops if the version is not newer than its own.
3. With a key inside: checks the signature against the version and SHA-256. No signature, or a wrong one, ends it
   here with a message, before anybody is asked anything.
4. Asks the person (the box above).
5. Fetches the file. It must be the same version and SHA-256 that were just checked and agreed to.
6. Checks the bytes against that SHA-256, then runs the installer.

A server that stops answering, at the start or half-way through the file, is given up on after 30 seconds, and
the installer request is not followed to any other address.

## Old and new together

| App | Server | Result |
| --- | --- | --- |
| No key (built before the key was made) | Any | Updates on the app's own question alone. |
| Has a key | Sends a good signature | Updates. |
| Has a key | Sends no signature (old server code, or an installer nobody signed) | Refuses: "The installer on the server is not signed". Everything else in the app works. |
| Any | New server code, no `.sig` file | The header is simply left out. |

## One-time setup (whoever runs the server)

```
node scripts/sign-installer.mjs --new-key
```

This makes the pair of keys. It will not overwrite either file. Then:

- **Copy the private key somewhere safe and off this PC** (a USB stick, a password manager's file attachment).
  The server runs on this PC under the same Windows account, so a key left only here is no better protected than
  the server is. The strongest arrangement is to keep it only on a USB stick and set `CHATTERDAY_SIGNING_KEY` to
  its path there; the stick is then plugged in for the minute it takes to sign.
- Keep `desktop/update-key.txt` where it is: **Build installer.bat** packs it into every app it builds from now on.

## Every release

1. Raise `version` in `desktop/package.json`.
2. Run **Build installer.bat**. When `desktop/update-key.txt` exists, its last step runs the signing script on the
   new installer. If the private key is not there (the stick is not plugged in), it says so: plug it in and run
   `node scripts/sign-installer.mjs`.
3. The script says "Signed Chatterday x.y.z". If it adds a NOTE that the app in this build has no public key inside,
   the installer was built before the key was made: build again.

## How the first signed version gets out

Apps that were installed before you made a key have none and cannot check anything. They take the first
signed version the way they take every update today: on the server's word. That one step cannot be protected from
inside those apps. Two ways to do it:

- **Let them update themselves, once more, as now.** Do it at a time of your choosing, with the server known good.
  From then on every app checks.
- **Hand the installer over yourself**, the way the first one was handed over, if you would rather not rely on
  that last unsigned step.

Either way, make the key *before* building that version, so the app in it carries the key.

## If the private key is lost or leaks

- **Lost:** installed apps will refuse every later installer. Make a new pair (move the old
  `desktop/update-key.txt` away first), build, and hand the new installer to each friend to run by hand. It
  installs over the old one.
- **Leaked:** the same, promptly. Whoever has the key can sign an installer, though they would still have to be
  the one answering at the server's address, and the person would still have to say yes to the box.

## What this does not cover

The page itself still comes from the server unsigned. A hostile server can show a false page, and the page may use
the microphone and capture the screen without a prompt (that is how voice and screenshare work without asking each
time). Signing stops the step from "controls the page" to "runs a program on the PC".

## Testing

`CHATTERDAY_UPDATE_DRY=0.0.1` makes the app pretend to be that old version and stop just short of running the
installer. In that mode only, `CHATTERDAY_UPDATE_KEY` names the public key to check against, and
`CHATTERDAY_UPDATE_STALL` (milliseconds) shortens the 30-second wait. The server offers installers from
`CHATTERDAY_INSTALLERS` instead of `desktop/dist` when that is set, so a test server need not offer the real one.
`scripts/desktop-smoke.mjs` answers the app's box from inside the app's main process.
