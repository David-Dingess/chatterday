# The admin's walkthrough

So you're hosting. Good news: you can't really break anything, and almost every setting can wait.

This guide goes in the order you'll actually meet things. The **must-dos** are marked. Everything else is optional, and the app runs fine without it.

At the end there's a short list of things we deliberately don't explain. Finding those is half the fun.

---

## 0. Before you start (must-do)

You need:

- A Windows 10 or 11 PC that stays on while people hang out.
- [Node.js](https://nodejs.org) 24 or newer.
- About ten minutes.

Then, in the Chatterday folder:

```
npm install
npm run setup
npm run build
npm start
```

`npm run setup` fetches LiveKit, the voice engine, and checks its checksum. If voice ever says "not running", run this again.

## 1. Claim the place (must-do)

Open **`http://127.0.0.1:4477`** on the host PC itself. Type it exactly like that, not your Tailscale name, and not through `tailscale serve`.

Why so strict? Whoever does this step becomes the admin. The server only lets the PC it runs on do it, so nobody else on your network can grab a fresh server first.

You'll be asked for:

- **A name for the place.** It shows on the sign-in page and in invites. You can change it later.
- **Your name and a password.** You sign in by name, so pick one your friends will recognise.

Then you make your character. Take your time, nobody can see it yet.

> **Locked yourself out later?** On the host PC: `node server/accounts.ts reset <your name>`.

## 2. Get friends in (must-do, eventually)

A hangout of one is a quiet hangout. Friends need two things: a way to **reach** your PC, and an **invite**.

### Reaching your PC: Tailscale

Chatterday is never on the open internet. Friends reach you over [Tailscale](https://tailscale.com), a free private network. Nothing gets opened on your router.

1. Install Tailscale on the host PC and sign in.
2. Run `scripts\firewall.ps1` once from an **administrator** PowerShell.
3. Go to **Settings → Admin → Getting friends connected**. It shows the access rules to paste into the Tailscale console, with your own addresses filled in, so friends can reach Chatterday and nothing else of yours.
4. Save **the address friends connect to**: your PC's full Tailscale name with the port, like `http://my-pc.tail1234.ts.net:4477`.
5. Press **Build the installer**.
6. For each friend, **share this PC** from the Tailscale console (**Machines → ⋯ → Share → Copy link**). Send them that link, the installer and an invite.

Chatterday doesn't include or install Tailscale. Each friend installs it from Tailscale's own site with their own free account, which is where they agree to Tailscale's terms. Then they accept your share link. The app shows them a three-step checklist and connects by itself once it can reach you.

The long version, with screenshots of the Tailscale side, is in [CONNECTING-FRIENDS.md](CONNECTING-FRIENDS.md).

> The installer isn't code-signed, so Windows will grumble about an unknown publisher. **More info → Run anyway.**

### Invites

**Settings → Admin → People → Invite somebody.**

- An invite is a link that works **once**. It expires after a day, three days, a week or a month, whichever you pick.
- Give it a label ("for Sam") so you remember who it was for.
- The newcomer picks their own name and password, then builds a character.
- You can make an invite that creates another **admin**. Use that sparingly.
- Cancel unused invites any time. Codes are long and random, and only a fingerprint of each one is stored.

Under **Who is in** you can reset somebody's password, promote somebody, or remove them. Removing someone signs them out and keeps them out. What they said in chat stays.

## 3. Make it yours (all optional)

Everything below lives in **Settings → Admin**, and every bit of it can be skipped.

### The picture on the lounge wall

There's a gold frame in the lounge. Put a group photo in it. Anything wider than it is tall fits best.

### Weather and the clock

Type a town. The yard and the windows then show **that town's real weather**, and the house keeps its time for everybody: day, night and seasons. Pick °F or °C while you're there.

- **Key needed?** No. It uses [Open-Meteo](https://open-meteo.com), which is free.
- **Skip it?** The house just keeps the host PC's time, with no weather.

### GIF search

The GIF button in chat searches Giphy.

- **Key needed?** Yes, but it's free. At [developers.giphy.com](https://developers.giphy.com), make an account, create an app (choose **API**), and paste the key.
- **Skip it?** People can still paste GIF links. They just can't search.
- **Heads up:** the free tier allows about 100 searches an hour for the whole group.

### The Player's search

The shared Player plays YouTube for everyone in voice, in sync.

- **Key needed?** Only to search by name. Without one, people paste YouTube links and those play fine.
- **Getting one:** in the Google Cloud console, make a project, turn on **YouTube Data API v3**, and create an API key. It's free, with about 100 searches a day for the whole group. Using it means agreeing to YouTube's API terms.
- **How it plays:** in YouTube's own player, on screen. YouTube's rules don't allow sound without the picture, so folding the Player away stops it for that person.

### Soundboard

The soundboard belongs to everyone, and anyone can add a sound. The admin page is for bulk adds and for tidying up the ones nobody wants.

You can also drop audio files into the `soundboard` folder next to the app on the host PC. They show up as buttons within about 20 seconds.

### Personal entrance sounds

Make a folder called `entrance sounds` next to the app. Put in an audio file named after a person: `Sam.mp3` for Sam. When Sam joins voice, everyone hears it, at most once an hour. It never appears on the soundboard. No restart needed.

Use this power responsibly. Or don't.

### Keys in a file instead

If you'd rather not paste keys into the page, copy `.env.example` to `.env` and fill them in there. Everything in that file is optional.

## 4. Keeping it running

- **No console window:** `Chatterday Server.vbs` runs it as an icon by the clock. Right-click the icon for the log, restart or stop.
- **With a window:** `Start Chatterday.bat` runs the same server where you can watch it.
- **Start with Windows:** run `scripts\autostart.ps1` once.
- **Before a restart,** open `http://127.0.0.1:4477/local/status` and check `inVoice` is 0. A restart drops everyone's call.
- **Back up the `data` folder.** It holds the database, the uploads and the secret keys: all of your group's history. It's not in git, so if you lose it, it's gone.

## 5. Things we're not going to explain

Some things in the house are better found than read about. A few hints, and no answers:

- The kitchen bin keeps count. Of what, and for whom, is between you and the bin.
- Birthdays are worth filling in.
- October and December are not like other months.
- Cats like high places.
- The arcade's high-score board is very public.
- Click the people, not just the furniture.
- There is a football. The house keeps count of that too.
- Some places in the house finish what you're doing for you, eventually. Some don't.

If a friend asks how you knew about any of this, just say you're the admin.

---

That's it. If you got through step 2, you're done. The rest is decorating.
