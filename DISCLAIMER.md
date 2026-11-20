# Disclaimer

The short version: **this is a hobby project, shared as-is. Use it at your own risk. Nobody is on the hook for anything.**

The longer version follows. It's written in plain English, not by a lawyer. Where it and the [LICENSE](LICENSE) disagree, the LICENSE wins.

## 1. As-is, and not maintained

Chatterday was built for one small group of friends and published so other people can run their own copy.

- **It is not maintained.** Nobody is watching this repository. Issues, pull requests and messages may never get a reply.
- **There is no support.** No help with setup, no bug fixes, no security patches, no updates on any schedule.
- **Fork it.** If you want something changed, make your own copy and change it. That's what the MIT licence is for.

## 2. No warranty

The software is provided **"as is", without warranty of any kind**, express or implied. That includes, without limitation, any warranty that it is fit for a particular purpose, that it works, that it is secure, that it won't lose your data, or that it won't break your PC, your network, or your friendships.

## 3. No liability

To the fullest extent the law allows, the authors and contributors are **not liable** for any claim, damage, loss or other liability arising from the software or its use, whether in contract, tort or otherwise. That includes, for example:

- lost, leaked or corrupted data, chat history or uploads;
- security incidents, including anyone getting into your server, your PC or your private network;
- anything people say, share, upload or play through a server you run;
- costs, bans or penalties from any outside service (Tailscale, Giphy, YouTube, Google, Open-Meteo, LiveKit or anything else);
- downtime, hardware wear, electricity bills, or a call dropping at the worst possible moment.

## 4. You're the operator

If you host Chatterday, **you** run the server. That means you are responsible for:

- **Who you let in.** Invites are yours to give and yours to cancel.
- **What happens on it.** Content shared on your server is on you and your users, not on the authors of this code.
- **Your own laws.** Recording, privacy, data protection and similar rules differ by country. Make sure your use of it is legal where you and your friends live.
- **Your data.** Everything lives in the `data` folder on your PC. Back it up. Nobody else has a copy.
- **Your network.** Chatterday is designed to stay off the open internet, behind Tailscale. If you change that (`CHATTERDAY_BIND=all`, port forwarding, a public proxy), you take on that risk.
- **The services you connect.** Giphy, YouTube, Google, Tailscale, Open-Meteo and LiveKit each have their own terms of service. By adding their keys or using them through this app, you agree to their terms, not ours. Two to know about in particular:
  - **YouTube.** Searching uses YouTube's official API with your own key, so you're the one agreeing to YouTube's API terms. Videos play only in YouTube's own visible player. If you change the code to work around that, you take that on.
  - **Tailscale.** Chatterday doesn't include or install Tailscale. Each person installs it from Tailscale's site and agrees to Tailscale's terms themselves. The free Personal plan is for non-commercial use.
- **Weather credit.** Weather comes from [Open-Meteo](https://open-meteo.com), whose free API is for non-commercial use and asks for attribution (CC BY 4.0).

## 5. Content note

Chatterday **depicts alcohol and tobacco use**: characters can drink at the bar, play beer pong, and smoke at the smoking table. It's cartoon pixel art, made for a group of adult friends, and none of it is an endorsement. If that isn't right for the people you're inviting, it's yours to change in your fork.

## 6. Other people's work

Chatterday uses open-source software, a font, outside services, and a voice engine and private-network installer that are downloaded during setup and build. Each keeps its own licence and terms. They're all listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

Nothing in this project is endorsed by, affiliated with, or sponsored by any of those projects or companies.

## 7. Trademarks

Names of games, apps, companies and services mentioned in the code or docs belong to their owners. They're used only to describe things, for example to recognise which game someone is playing so their character can sit at a gaming desk. No affiliation or endorsement is implied.

The classic card, board and tile games at the game table (Hearts, Spades, Rummy, Mahjong, Chess, Checkers, Go, Four in a Row, Mancala) are traditional games. The versions here are written from scratch.

## 8. The desktop installer

The Windows installer is **not code-signed**, so Windows will warn about an unknown publisher. Only run installers you built yourself, or ones you got directly from someone you trust. It carries only your server's address: no keys, and no Tailscale.

---

By using, hosting, building or distributing Chatterday, you accept all of the above.
