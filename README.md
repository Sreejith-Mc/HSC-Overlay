# HSC Overlay — VALORANT tournament broadcast suite

A stream overlay + operator control panel for running a VALORANT tournament broadcast.
Two overlay modes (**buy phase board** and **round-in-play rails**), one control panel,
zero dependencies, no build step.

```bash
node server/index.js
```

| | |
|---|---|
| Control panel | <http://localhost:8787/admin> |
| Overlay (OBS) | <http://localhost:8787/overlay> |

Add the overlay to OBS as a **Browser Source, 1920×1080**, and untick *"Shutdown source
when not visible"*. The background is transparent. Use `?chroma=1` if you'd rather key it.

The overlay is built on a fixed 1920×1080 canvas and is **full-bleed** — the buy board spans
the entire frame width and sits flush to the bottom edge, the map strip is flush to the
top-left corner and the sponsor slot to the top-right, and the in-play player rails touch the
left and right edges exactly. Nothing paints outside the frame. Any other 16:9 source size
(1280×720, 2560×1440) scales the whole canvas uniformly and stays flush, so set the browser
source to whatever your canvas is and leave it alone.

---

## Read this first: the API question

Riot does **not** publish a live-match API for custom or tournament lobbies. There is no
endpoint you can point at a game and receive kill events from — not for you, and not for
the people running VCT (their data comes from an internal observer pipeline Riot doesn't
license out). Anyone who tells you otherwise is describing either OCR of the video feed or
an unofficial local-client hook that only sees the machine it runs on.

So this suite is **manual-first, but almost everything derives itself**. The operator tells
it only two things:

1. **who killed whom** — two clicks or two keystrokes
2. **who won the round and how** — two keystrokes

Everything below is then computed with no further input:

- K / D / A, first bloods, alive counts
- Credits — kill rewards, win bonus, loss-streak bonus (1900 / 2400 / 2900), plant bonus, 9 000 cap
- Loadout value — weapons + shields + ability charges, per player and per team, plus the
  `-spend / remaining` split you see on the VCT buy board
- **Clutches** — a 1vX is flagged the instant it happens and awarded if that player's side wins
- **Thrifties** — winner was out-bought at round start (ratio *or* flat gap, both configurable)
- Flawless rounds, aces, pistol rounds, plants, defuses
- Econ label (ECO / HALF BUY / FULL BUY), match point, overtime
- Buy phase auto-rolls into the live round; sides swap at the half and each overtime pair

That's what keeps the stream current: there is nothing for the operator to keep in sync by hand.

---

## Running a match

### 1. Before the series
Open **TEAMS & ROSTERS**. Set team names, tags, colours, and upload logos (click the LOGO
box). Type the five player names per side and pick their agents. Under **BROADCAST**, set
the event name, stage, Bo3/Bo5, series score, the map trio, and your sponsors.

### 2. During the buy phase
The **LIVE OPS** tab is the only screen you need. Each player has a card:

- The **top half** is the kill target (click it, or press its number key).
- The **bottom half** is their buy: primary, sidearm, shield, and C/Q/E/ult buttons.

Hit a **team preset** (PISTOL / ECO / HALF BUY / FULL BUY / FULL + OP) to set all five at once,
then fix up the one or two players who differ. That's usually under ten seconds.

### 3. During the round
Log kills: **click the killer, then click the victim** — or press their number keys.
Shift-click teammates first to add assists. Right-click a card toggles alive/dead with no
stat change (for falls, spike deaths, or fixing a mis-click).

Spike planted → <kbd>S</kbd>. Defused → <kbd>D</kbd>.

### 4. Ending the round
Arm the winner (<kbd>A</kbd> for team A, <kbd>;</kbd> for team B), then say how:
<kbd>E</kbd> elim · <kbd>K</kbd> spike · <kbd>F</kbd> defuse · <kbd>T</kbd> time.
Then <kbd>N</kbd> for the next round. Economy, stats and side swaps all apply themselves.

Got something wrong? <kbd>Z</kbd> (or Ctrl+Z) steps back through the last 60 actions.
**REVERT LAST ROUND** undoes a completed round result specifically.

### Hotkeys

| Key | Action |
|---|---|
| <kbd>1</kbd>–<kbd>5</kbd> / <kbd>6</kbd>–<kbd>0</kbd> | Team A / Team B players |
| <kbd>Space</kbd> | Start / pause clock |
| <kbd>B</kbd> <kbd>L</kbd> <kbd>P</kbd> | Phase: buy / live / post |
| <kbd>S</kbd> / <kbd>D</kbd> | Spike planted / defused |
| <kbd>A</kbd> / <kbd>;</kbd> | Arm round winner |
| <kbd>E</kbd> <kbd>K</kbd> <kbd>F</kbd> <kbd>T</kbd> | …then the win condition |
| <kbd>N</kbd> | Next round |
| <kbd>Z</kbd> | Undo |
| <kbd>Esc</kbd> | Cancel pending kill / armed winner |

---

## Map veto screen

The **MAP VETO** tab drives a full-frame map selection takeover — bans, picks, decider,
and which team starts on defence.

1. Set the pool: **BO3 PRESET (3)**, **BO5 PRESET (5)**, **FULL POOL (7)**, or **+ ADD MAP**
   for any size you like. The row lays out evenly whether there are 3 maps or 8.
2. For each map set **ACTION** (BAN / PICK / DECIDER, or blank for still-in-pool),
   **BY** (which team banned or picked it), and **DEFENSE** (which side starts defending).
   Defence is disabled on bans, since it doesn't apply.
3. **SHOW ON STREAM**, then **REVEAL NEXT** once per map — each card swipes up from the
   bottom with a staggered delay. **REVEAL ALL** drops the whole board at once, and
   **RESET** hides them again for a re-run.

Banned maps get a red wash, a desaturated image, a BANNED stamp and the banning team.
Picked maps show who selected them plus the defending team; the decider carries a gold edge.
Card art is the map's splash image, and the background is the first picked map, blurred.

Six or more maps automatically steps the typography down so the plates stay proportionate.

## Broadcast screens

The **SCREENS** tab holds the standalone full-frame screens. Like the veto, each one is a
takeover — the scorebar, buy board and rails hide themselves while it's up, so no extra
browser source is needed.

**Agent select** — five cards with the agent's full-body art, agent name and player name.

Pick each player's agent right in this tab (or in TEAMS & ROSTERS — same thing), then reveal
them **one at a time**, exactly like the map veto: **REVEAL NEXT** walks down the line-up,
or flip any single player with the button on their row. Until a player is revealed their card
shows a placeholder, then the agent swipes up from the bottom.

**SPOTLIGHT** lifts one card in the team colour for talking about a specific player. It's
disabled for players who aren't on screen yet, since spotlighting a hidden card does nothing.

**Timeout / result band** — a centre-screen band with the team logo over a large outlined
word. **TIMEOUT** shows no score; **VICTORY** and **DEFEAT** carry the current scoreline
(switchable off).

**Round-win popup** — fires automatically when you call a round: team logo, name, updated
score, win condition, and any THRIFTY / ACE / CLUTCH / FLAWLESS badges beneath. Hold time is
configurable, and **TEST POPUP** fires it against the live scoreline without touching the match.

## Motion

Nothing on stream snaps between states:

- Switching buy ↔ in-play wipes the roster rows and player cards out in sequence
  (~40ms apart) rather than cutting.
- Any number that changes — kills, deaths, assists, credits — briefly flashes gold, so a
  kill landing reads without the operator doing anything.
- Screens (veto, agent select, bands) fade and lift in; veto cards swipe up from the bottom
  with a stagger; agent cards fly up in sequence.
- Score changes bump; an expiring clock pulses amber.

## Overlay modes

**AUTO** follows the match phase — buy board during the buy phase, player rails once the
round goes live. Force either one from the **OVERLAY** tab when you want to override, or hide
everything for a replay or an interview.

**Every element toggles independently** — 24 switches, grouped in the OVERLAY tab:

| Group | Switches |
|---|---|
| Major blocks | scorebar · buy board · player rails · map strip · sponsors |
| Top bar / clock | **timer** · round number · phase label · series score · team logos · ATK/DEF · spike banner |
| Player data (both modes) | agent portraits · K/D/A · abilities · ult points · credits · weapons · shields |
| Buy board | round ladder · stat chips · loadout value · map name |
| In-play | health bars |

Toggling is instant and live — flip anything mid-round without touching OBS.

### Position

The **POSITION** controls in the same tab nudge elements in canvas pixels, so you can move
anything clear of whatever the game is drawing underneath — player rails up or down and in
from the edges, buy board, scorebar, map strip and sponsor. Down is positive.

Use the − / + buttons for 10px steps, **Shift-click for 1px**, or type an exact value.
Changes apply live, so adjust with the overlay in front of you. **RESET ALL POSITIONS**
puts everything back.

Offsets are saved with the match and survive mode switches, so a nudge you make during the
buy phase stays put when the round goes live.

Extra browser-source URLs (also listed in the OVERLAY tab with copy buttons):

The map veto screen is a takeover: while it's up, the scorebar, buy board and player rails
hide themselves, so it needs no separate browser source.

| URL | Use |
|---|---|
| `/overlay` | the full overlay |
| `/overlay?mode=buy&bare=1` | buy board only, no top chrome |
| `/overlay?mode=live` | in-play rails only |
| `/overlay?chroma=1` | green-screen background |
| `/overlay?scale=0.75` | scale the whole 1920×1080 stage |

---

## Artwork

**Real VALORANT art is already installed** — official agent portraits in the name chips and
genuine in-game weapon renders in the loadout column, for both the buy board and the
in-play rails. It was pulled with:

```bash
npm run assets
```

That fetches agent icons, weapon renders, map images **and the current shop prices** from
valorant-api.com (a free community mirror of Riot's own client data), then writes
`data/gamedata.json`, which the server merges over its built-in defaults at startup.
Re-runs skip art already on disk, so it's cheap to run again after a patch. Delete
`data/gamedata.json` to fall back to the built-in defaults.

Running it is worth doing after every patch — the live fetch already corrected several
prices this build had guessed (Stinger 1100, Ares 1600) and added content released since:
the agents Miks and Veto, the Bandit sidearm, and the map Summit.

The overlay still degrades gracefully: with no assets at all it falls back to built-in
vector weapon silhouettes and initial-based agent chips, so it never renders broken.

To use your own art instead, drop files in — they attach automatically by filename:

```
assets/agents/jett.png      assets/weapons/vandal.png
assets/teams/…              assets/sponsors/…      assets/maps/…
```

> **⚠ Ult points and ability costs are not published in any API.** They use hand-checked
> values in `server/gamedata.js`. Any agent released after this build carries placeholders
> (ult 7, abilities 200) and is flagged both by the fetcher and by a warning in the panel's
> OVERLAY tab. Fix those in `data/gamedata.json` before broadcasting a match with them —
> a wrong ult meter is the kind of thing viewers spot. Weapon prices *are* fetched live.

---

## Automating it later

The control panel drives the server through a plain JSON action API. Anything that can POST
can do the same thing — an OCR script watching the observer feed, a Stream Deck, a second
operator on a phone:

```
POST http://localhost:8787/api/ingest?key=hsc

{"type":"kill","killer":"A1","victim":"B3","assists":["A2"]}
{"type":"round.end","winner":"A","condition":"spike"}
{"type":"player.patch","id":"A1","patch":{"hp":42,"weapons":{"primary":"vandal"}}}
{"type":"spike.plant","by":"A3"}
```

Set the key with `INGEST_KEY=yoursecret node server/index.js`. Player IDs are `A1`–`A5` and
`B1`–`B5`. Mixed operation is fine: an adapter can log kills while a human handles round
results, because both write to the same state.

---

## Operators and hosting

**See [DEPLOY.md](DEPLOY.md)** for hosting, TLS, and the tunnel/VPS trade-off.

Accounts are managed from the command line:

```bash
npm run operator -- add sreejith
```

With no operators configured the panel is **open to anyone who can reach the server** —
convenient on localhost, unsafe the moment you expose it, and the server warns you on boot.
Once an operator exists, `/admin` and every edit require a sign-in. `/overlay` always stays
open, because a browser source can't complete a login and has to come up unattended.

## Multi-operator and recovery

State lives on the server and is pushed to every connected page over Server-Sent Events, so
two operators on two laptops stay in lockstep — open `/admin` on both. The overlay machine
only needs `/overlay`. The top bar shows who else is signed in, and every event-feed entry is
tagged with the operator who caused it, so nobody double-calls a round.

The match is mirrored to `data/match.json` on every change. If the server or a laptop dies
mid-series, restart and it resumes on the same round with all stats intact. **EXPORT MATCH
JSON** / **IMPORT JSON** in the BROADCAST tab moves a match between machines.

**NEW MAP** resets score and stats but keeps both rosters — use it between maps of a series.

---

## Layout

```
server/
  index.js       HTTP + SSE + action API + uploads   (no dependencies)
  state.js       match state, reducer, all derived stats
  gamedata.js    weapons, shields, agents, maps, economy rules — all overridable
public/
  overlay.*      the broadcast overlay
  admin.*        the operator control panel
tools/
  fetch-assets.js  optional art + live weapon prices
assets/          your logos and any art you drop in
data/            match.json (autosaved) · gamedata.json (optional overrides)
```

Tuning lives in one place — `RULES` in `server/gamedata.js`, or `data/gamedata.json` to
override without touching code: round/buy/spike timers, credit rewards, rounds to win, half
length, thrifty thresholds, and the eco/full-buy cutoffs.
