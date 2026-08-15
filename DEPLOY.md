# Hosting HSC Overlay

Two things need solving, and they pull in opposite directions:

- **OBS needs a URL that never fails.** A browser source that can't load is dead air.
- **Operators need to reach the panel from anywhere**, several at once.

The answer isn't the same for both, so read the first section before picking.

---

## The one decision that matters

**Where the server runs decides what breaks when the internet drops.**

| | OBS points at | Venue internet dies |
|---|---|---|
| **A. Server on the streaming PC** | `http://localhost:8787/overlay` | Overlay keeps working. Remote operators drop off; the local one carries on. |
| **B. Server on a VPS** | `https://overlay.example.com/overlay` | **Overlay goes blank on stream.** |

`localhost` is the only genuinely 100%-reliable URL — it has no network in the path
at all. So unless OBS itself lives in the cloud, **option A is the safer build**, and
you still get a public panel URL by tunnelling out.

Pick **B** only if OBS runs somewhere other than the machine you can host on.

---

## Free hosting — what works and what doesn't

### Vercel / Netlify won't run this

Not a configuration problem — the architecture is incompatible. Both are serverless
platforms, and this app needs a single long-lived process:

| What the app does | Why serverless breaks it |
|---|---|
| Holds the live match in memory (`let state`) | Every request may hit a different instance, each with its own copy. The panel and the overlay would disagree. |
| Keeps an SSE connection open for hours | Functions are capped at seconds-to-minutes. The stream would drop constantly. |
| Pushes updates to every connected client | One instance can't write to a stream held by another. Kills would never reach the overlay. |
| Writes `data/match.json`, logo uploads | The filesystem is read-only apart from `/tmp`, which is per-instance and wiped. |

You *could* force it: move state into Redis, replace SSE with a pub/sub service, put uploads
in blob storage. That's a rewrite, it adds a network hop to every keystroke, and it gives you
a **less** reliable overlay than running it locally. Not worth it for a broadcast tool.

### Genuinely free options, ranked

### No credit card? Render is the only real option

Oracle, Fly.io and Railway all want a card, even on their free tiers. **Render's free
web service does not** — a GitHub account is the whole signup.

Its weakness is the 15-minute idle sleep and ~50 second cold start, which would be
fatal on stream. That is fixable, and worth doing properly:

**Keep it permanently awake with a free uptime pinger.** Render's free tier includes
750 instance-hours per month; a calendar month is about 730 hours, so *one* service
can legitimately run 24/7 inside the allowance. Point a free cron/monitor at it every
5–10 minutes and it never sleeps:

| Service | Card needed | Set-up |
|---|---|---|
| [cron-job.org](https://cron-job.org) | no | New cronjob → your URL → every 10 min |
| [UptimeRobot](https://uptimerobot.com) | no | New monitor → HTTP(s) → 5 min interval |

Point it at **`https://your-app.onrender.com/api/gamedata`** — a tiny JSON response,
no state touched, no side effects. Don't ping `/api/stream`: that's the SSE endpoint
and a monitor would hold connections open.

Run only this one service on the account, or the hours get split and it will start
sleeping again.

The wiped-disk limit still applies and has no workaround, so:

- Put team logos in `assets/teams/` in the repo instead of uploading them in the panel
- Set operators via the `OPERATORS` env var, not `npm run operator`
- Set `AUTH_SECRET` so sessions survive restarts
- Use **Export match JSON** between maps if you want a restore point

### Hosting it away from your own machine

If running it on the streaming PC isn't an option, there are exactly two free paths
worth using, and they trade off against each other:

|  | Render free | Oracle Cloud Always Free |
|---|---|---|
| Effort | ~10 min, connect a repo | ~30 min, real server setup |
| Always on | ✗ sleeps after 15 min idle | ✓ |
| Cold start | ~50s | none |
| Disk survives restarts | ✗ | ✓ |
| Uploaded team logos survive | ✗ commit them instead | ✓ |
| Card required | no | yes (identity check only) |

**Render** is the fast one. Its two limits both bite a live broadcast: a 50-second
cold start if the overlay is the first thing to touch it after a quiet spell, and a
wiped disk on every restart — so logos uploaded through the panel disappear. Work
around both: keep the panel open before going live (the SSE connection holds the
service awake), and commit team logos into `assets/teams/` rather than uploading them.

**Oracle Always Free** is the better host once it's up — always on, nothing wiped, so
uploads and match state persist. `tools/vm-setup.sh` does the whole build in one
command: Node, the app under systemd, and Caddy in front for automatic HTTPS.

```bash
export REPO=https://github.com/you/hsc-overlay.git
sudo bash vm-setup.sh overlay.example.com
```

**1. Your streaming PC + Cloudflare Tunnel — free, and the most reliable.**
Costs nothing, no sleeping, no cold starts, and OBS points at `localhost` so the overlay
survives an internet outage. Setup is in Option A below. **This is what I'd use.**

**2. Oracle Cloud Always Free — free always-on VM.**
A genuine always-free ARM VM (generous specs) with a persistent disk. It's a real VPS, so
follow Option B. More setup, but nothing sleeps and nothing gets wiped.

**3. Render free tier — easiest, with real caveats.**
`render.yaml` is included, so it's Blueprint → pick repo → deploy. But:

- **It sleeps after 15 minutes idle and takes ~50 seconds to wake.** If your overlay is the
  first thing to hit it after a quiet spell, that's 50 seconds of nothing on stream. Load the
  panel a few minutes before going live and keep it open — an active SSE connection keeps the
  service awake for the whole broadcast.
- **The disk is ephemeral.** Every restart or redeploy wipes `data/` and `assets/` — the
  match, operator accounts, uploaded logos and fetched artwork all go. Mitigate with the env
  vars below, and use **EXPORT MATCH JSON** between maps.
- Free instances also have limited monthly hours.

Set these in the Render dashboard so auth survives restarts:

| Variable | Value |
|---|---|
| `OPERATORS` | `sreejith:some-password,caster2:another-password` |
| `AUTH_SECRET` | any long random string (keeps sessions valid across restarts) |
| `TRUST_PROXY` | `1` |
| `INGEST_KEY` | something long, if the URL is public |

`OPERATORS` seeds accounts at boot without touching the disk. Passwords set this way are
visible to anyone with dashboard access to the host, so wherever the disk persists, prefer
`npm run operator -- add`.

Because the disk is wiped, run `npm run assets` locally and **commit `assets/` and
`data/gamedata.json`** to the repo — otherwise the deployed overlay has no agent portraits
or weapon art, and falls back to the built-in silhouettes.

---

## Option A — local server + Cloudflare Tunnel (recommended)

The server runs on the streaming PC. OBS uses `localhost`. A tunnel gives remote
operators a real HTTPS URL. Free, and no ports opened on your router.

### 1. Run the server as a service

So it survives reboots and starts before you do. On Windows, the simplest reliable
approach is Task Scheduler:

```bash
schtasks /create /tn "HSC Overlay" /tr "node \"E:\Claude App Builds\Valo UII\server\index.js\"" /sc onstart /ru SYSTEM
```

Or just leave `START.bat` running for the event — fine for a one-off.

### 2. Install cloudflared and create a *named* tunnel

A named tunnel keeps the **same hostname forever**. (The quick `trycloudflare.com`
tunnels hand you a random URL that changes every restart — useless for a fixed OBS
or operator link.)

```bash
cloudflared tunnel login
cloudflared tunnel create hsc-overlay
cloudflared tunnel route dns hsc-overlay overlay.yourdomain.com
```

`~/.cloudflared/config.yml`:

```yaml
tunnel: hsc-overlay
credentials-file: C:\Users\you\.cloudflared\<tunnel-id>.json
ingress:
  - hostname: overlay.yourdomain.com
    service: http://localhost:8787
  - service: http_status:404
```

```bash
cloudflared tunnel run hsc-overlay
cloudflared service install      # keeps it running across reboots
```

### 3. Point things at the right URLs

| Who | URL |
|---|---|
| **OBS browser source** | `http://localhost:8787/overlay` |
| Operators (anywhere) | `https://overlay.yourdomain.com/admin` |
| A second OBS elsewhere | `https://overlay.yourdomain.com/overlay` |

Set `TRUST_PROXY=1` so cookies get the `Secure` flag and rate limiting sees real IPs:

```bash
set TRUST_PROXY=1 && node server/index.js
```

---

## Option B — VPS with a permanent URL

Any $4–6/month box (Hetzner, DigitalOcean, Vultr) is far more than this needs — it's a
zero-dependency Node process serving static files and a JSON blob.

### With Docker

```bash
docker build -t hsc-overlay .
docker run -d --name hsc-overlay --restart unless-stopped \
  -p 127.0.0.1:8787:8787 \
  -v hsc-data:/app/data \
  -v hsc-assets:/app/assets \
  -e TRUST_PROXY=1 \
  -e INGEST_KEY=pick-something-long \
  hsc-overlay
```

The volumes matter: `data/` holds the live match, operator accounts and your game-data
overrides; `assets/` holds team logos and the fetched artwork. Without them a rebuild
wipes both.

### Without Docker (systemd)

`/etc/systemd/system/hsc-overlay.service`:

```ini
[Unit]
Description=HSC Overlay
After=network.target

[Service]
Type=simple
User=hsc
WorkingDirectory=/opt/hsc-overlay
Environment=PORT=8787
Environment=HOST=127.0.0.1
Environment=TRUST_PROXY=1
Environment=INGEST_KEY=pick-something-long
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
systemctl enable --now hsc-overlay
```

### TLS in front (Caddy — two lines, auto-renewing certificates)

`/etc/caddy/Caddyfile`:

```
overlay.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

**HTTPS is not optional here.** Sign-in cookies only get the `Secure` flag over HTTPS,
and without it operator passwords cross the network in the clear.

---

## Operator accounts

With **no** operators configured the panel is **open to anyone who can reach it**. That's
fine on localhost, and it's what makes a fresh clone work with zero setup — but it is not
safe the moment you expose the server. The server prints a warning on boot when it's in
this state.

```bash
npm run operator -- add sreejith    # prompts for a password, hidden
npm run operator -- list
npm run operator -- passwd sreejith
npm run operator -- remove sreejith
```

Passwords are stored as scrypt hashes with per-account salts. Sessions are signed
cookies (HttpOnly, SameSite=Lax, `Secure` behind HTTPS) valid for 7 days, so a server
restart mid-event doesn't sign everyone out. Failed logins are rate-limited to 10 per
5 minutes per IP.

Add an account **before** starting the tunnel or pointing DNS at the box.

### What's protected

| Route | Access |
|---|---|
| `/overlay`, `/api/stream`, `/api/state` | **Open** — OBS can't complete a sign-in, and a browser source has to come up unattended |
| `/admin` | Redirects to `/login` |
| `/api/action`, `/api/upload` | 401 without a session |
| `/api/ingest` | Separate `?key=` token, for adapters |

The overlay being readable is deliberate: it carries no secrets, just the scoreboard
you're already broadcasting. If the URL being guessable bothers you, put the tunnel
hostname behind Cloudflare Access, or serve the overlay only on the LAN.

---

## Several operators at once

This already works — state lives on the server and is pushed to every connected client
over SSE, so two people on two laptops stay in lockstep with no "who has control"
handoff. Sign in on each machine and split the work:

- One on **LIVE OPS** logging kills and calling rounds (the time-critical part)
- One on **SCREENS / MAP VETO / BROADCAST** driving graphics and sponsors

The panel's top bar shows who else is signed in, and the event feed tags each entry
with the operator who caused it, so you can see at a glance whether a round has already
been called.

**Latency note:** every operator action is a round trip to the server. On the same LAN
that's sub-millisecond. Through a tunnel to a remote operator it's whatever their
connection is — typically 20–80 ms, which is imperceptible for this. But if you host on
a VPS in another region, *every* operator pays that cost on *every* keystroke. Another
reason to keep the server near the people using it.

---

## Before an event — checklist

- [ ] `npm run operator -- add <name>` for each person on the desk
- [ ] `npm run assets` to refresh weapon prices and artwork for the current patch
- [ ] Change `INGEST_KEY` if the server is reachable publicly
- [ ] `TRUST_PROXY=1` if behind a tunnel or reverse proxy
- [ ] Confirm the OBS browser source loads and shows the scorebar
- [ ] Back up `data/match.json` between maps if you want a restore point
