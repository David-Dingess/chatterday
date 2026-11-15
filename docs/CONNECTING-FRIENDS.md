# Connecting friends

Chatterday isn't on the open internet. Friends reach the host's PC over [Tailscale](https://tailscale.com), a free private network. Nothing is opened on your router, and the server ignores anything that isn't the host PC or Tailscale.

**Chatterday does not include or install Tailscale.** Each friend installs it themselves from Tailscale's own site, with their own free account, and agrees to Tailscale's terms themselves. The host then **shares just the host PC** with each friend. Friends see that one machine and nothing else of yours, and they stay on their own Tailscale account.

> Chatterday is not part of Tailscale and is not affiliated with it. Tailscale is a trademark of Tailscale Inc. Tailscale's own terms and plans apply to everyone who uses it, and its free Personal plan is for non-commercial use.

## What the host does (once)

1. **Install Tailscale on the host PC** from [tailscale.com/download](https://tailscale.com/download) and sign in. Leave this PC **untagged**, because Tailscale can't share a tagged machine.
2. **Open the firewall to Tailscale only.** From an *administrator* PowerShell in the Chatterday folder:

   ```
   powershell -ExecutionPolicy Bypass -File scripts\firewall.ps1
   ```

   It lets Tailscale addresses (`100.64.0.0/10`), and nothing else, reach Chatterday's ports: web `4477`, and media `7881` TCP and `7882` UDP. `-Remove` undoes it.
3. **Limit what friends can reach.** In the [admin console](https://login.tailscale.com/admin/acls), under **Access controls**, add these rules and keep any of your own. **Settings → Admin → Getting friends connected** shows this with your PC's address and ports filled in.

   ```jsonc
   {
     "hosts": { "chatterday-host": "100.x.y.z" },          // this PC's Tailscale address
     "grants": [
       // you: everything, as before
       { "src": ["autogroup:member"], "dst": ["*"], "ip": ["*"] },
       // friends you shared this PC with: only Chatterday
       { "src": ["autogroup:shared"], "dst": ["chatterday-host"],
         "ip": ["tcp:4477", "tcp:7881", "udp:7882"] }
     ]
   }
   ```

   Once you replace the default policy, anything not listed is blocked. That's why the first rule must stay.
4. **Save the address friends connect to** in **Settings → Admin**. Use this PC's full Tailscale name with the port, like `http://my-pc.tail1234.ts.net:4477`. `tailscale status` shows the name. Use the full `.ts.net` name, not the `100.x` number: a friend's own network may show your PC at a different number.
5. **Build the installer** (same page, or `Build installer.bat`). It's a Windows app with your address packed in, and nothing else.

## For each friend

**Host:**

1. In the admin console, open **[Machines](https://login.tailscale.com/admin/machines)**, then the host PC's **⋯** menu, then **Share**, then **Copy link**. A single-use link per friend is the tidy way.
2. Send that link, the installer, and a Chatterday **invite** (**Settings → Admin → People**) to your friend, privately.

**Friend:**

1. Run the Chatterday installer and open the app. If it can't reach the host yet, it shows a short checklist:
   1. **Install Tailscale** from Tailscale's site (the app has a button that opens the download page) and sign in with your own free account. That's where you agree to Tailscale's terms.
   2. **Open the share link** the host sent, sign in with the same account, and accept.
   3. The app notices the host answering and carries on by itself.
2. Use the invite link to pick a name and password, and build a character.

To take a share back: **Machines → ⋯ → Share → Revoke**. To remove someone from Chatterday itself: **Settings → Admin → People**.

## Why sharing, not inviting friends into your network

- **No user limit.** Shares don't count as users. Tailscale's free plan allows a handful of users, but sharing doesn't use them up.
- **Friends see only this PC,** not your phone, NAS or anything else.
- **Friends keep their own Tailscale.** A PC can only be on one Tailscale network at a time, so joining yours would cut them off from their own.

Inviting friends as users of your network also works if you prefer it, for a small group that doesn't use Tailscale otherwise. Change the second rule's `src` to their email addresses.

## If something doesn't connect

| What happens | Likely cause |
|---|---|
| The checklist never gets past step 2 | The share wasn't accepted, or was accepted with a different account than the one signed in on that PC |
| Text works but voice never connects | `7882` UDP isn't allowed: check the firewall script ran, and the `udp:7882` rule is in your policy |
| The app can't find the address | Use the full `name.tailXXXX.ts.net` name. Check that Chatterday is running on the host |
| Video stutters | Tailscale is relaying (`tailscale status` says "relay"). Forwarding UDP 41641 on the host's router usually fixes it |
