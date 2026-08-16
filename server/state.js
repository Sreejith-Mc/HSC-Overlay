/**
 * Match state + the reducer that owns every mutation.
 *
 * Design rule: the operator only ever tells the system two hard things —
 * "X killed Y" and "team T won the round, this way". Everything else
 * (K/D/A, alive counts, credits, loadout value, clutches, thrifties,
 * flawless, aces, first bloods, econ labels) is derived here so nothing
 * can go stale on stream.
 */

import { DEFAULT_GAMEDATA } from './gamedata.js';

let GD = DEFAULT_GAMEDATA;
export function setGameData(gd) { GD = gd; }
export function gameData() { return GD; }

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/* ------------------------------------------------------------------ *
 * Initial state
 * ------------------------------------------------------------------ */

function makePlayer(teamId, i) {
  return {
    id: `${teamId}${i + 1}`,
    name: `${teamId === 'A' ? 'Player' : 'Rival'} ${i + 1}`,
    agent: '',
    alive: true,
    hp: 100,
    shield: 'none',
    ult: { pts: 0, max: 7 },
    credits: GD.RULES.startCredits,
    weapons: { primary: 'none', secondary: 'classic' },
    charges: { c: 0, q: 0, e: 0 },
    k: 0, d: 0, a: 0,
    roundKills: 0,
    carried: 0,     // loadout value carried into this round (drives the "-spend" figure)
    fb: 0,          // first bloods
    clutches: 0,
    plants: 0,
    defuses: 0,
    loadoutLock: null, // manual override of this player's loadout value
  };
}

function makeTeam(id, name, tag, color, side) {
  return {
    id, name, tag, color, side,
    logo: '',
    /**
     * How many players this side actually fields. Set from the game mode
     * (Retake 3, Skirmish 2) but adjustable up to 5 on any mode — scrims and
     * showmatches don't always follow the book. Slots beyond this are kept in
     * state so nothing is lost when you switch back.
     */
    rosterSize: 5,
    score: 0,
    lossStreak: 0,
    timeouts: 2,
    stats: { thrifties: 0, clutches: 0, flawless: 0, aces: 0, pistols: 0, plants: 0, defuses: 0 },
    players: Array.from({ length: 5 }, (_, i) => makePlayer(id, i)),
    loadoutLock: null, // manual override of team loadout value
  };
}

export function initialState() {
  return {
    version: 1,
    updatedAt: Date.now(),

    broadcast: {
      event: 'INVITATIONAL',
      stage: 'GROUP STAGE — DAY 1',
      bestOf: 3,
      seriesA: 0,
      seriesB: 0,
      sponsors: [
        { name: 'YOUR SPONSOR', logo: '', enabled: true },
      ],
      sponsorMs: 8000,
      ticker: '',
    },

    /** Game mode. Drives roster size and which maps the veto pool offers. */
    format: { mode: 'standard' },

    maps: { current: 'Ascent', next: 'Pearl', decider: 'Haven' },

    /**
     * Map veto board. `maps` is an ordered list of however many maps the pool
     * holds — 3, 5, 7, whatever the format needs — and the overlay lays them
     * out to fit. Each entry:
     *   map      display name, e.g. "Ascent"
     *   action   'ban' | 'pick' | 'decider' | ''   ('' = not yet acted on)
     *   by       'A' | 'B' | ''    who banned or picked it
     *   defense  'A' | 'B' | ''    which side starts on defence
     *   revealed reveal animation gate, flipped one at a time by the operator
     */
    veto: {
      on: false,
      title: 'MAP SELECTION',
      maps: [],
    },

    /** Full-frame broadcast screens, each independent of the match state. */
    screens: {
      /**
       * Agent line-up reveal. `focus` highlights one card (-1 for none) and
       * `revealed` gates each card's swipe-up, one player at a time.
       */
      agentPick: {
        on: false, team: 'A', focus: -1, title: 'AGENT SELECT',
        revealed: [false, false, false, false, false],
      },
      /** Timeout / result band. kind: 'timeout' | 'win' | 'loss' */
      banner: { on: false, kind: 'timeout', team: 'A', showScore: true },
    },

    overlay: {
      mode: 'auto',                 // auto | buy | live | off
      /**
       * Every visual element is switchable from the OVERLAY tab. Each key
       * becomes an `off-<key>` class on the stage, which the stylesheet acts
       * on — so adding a toggle is one entry here plus one CSS rule.
       */
      show: {
        // major blocks
        scorebar: true,
        buyBoard: true,
        playerRails: true,
        seriesStrip: true,
        sponsors: true,
        // top bar / clock
        timer: true,
        roundLabel: true,
        phaseLabel: true,
        seriesBadge: true,
        teamLogos: true,
        sides: true,
        spike: true,
        // player data (both modes)
        agentPortraits: true,
        kda: true,
        abilities: true,
        ults: true,
        creds: true,
        weapons: true,
        shields: true,
        // buy board only
        ladder: true,
        statChips: true,
        economy: true,
        mapName: true,
        // in-play only
        hpBars: true,
        // round-end popup
        roundPopup: true,
      },
      roundPopupMs: 6000,
      lowerThird: { on: false, title: '', subtitle: '' },

      /**
       * Per-element nudges in 1920x1080 canvas pixels. Positive Y moves an
       * element DOWN, positive X pushes the side rails inward. Lets an
       * operator dodge whatever the game is drawing without touching CSS.
       */
      layout: {
        railsY: 0, railsX: 0,
        buyY: 0,
        barY: 0,
        stripY: 0,
        sponsorY: 0,
      },
    },

    clock: {
      phase: 'buy',                 // buy | live | post
      running: false,
      endsAt: 0,
      remainingMs: GD.RULES.buyPhaseMs,
      spike: { planted: false, defused: false, by: null, endsAt: 0 },
    },

    round: {
      number: 1,
      startLoadout: { A: 0, B: 0 },  // captured at buy → live
      firstBloodTaken: false,
      // Tracked per side: a 1v1 puts BOTH teams in a clutch, and only the
      // side that goes on to win the round gets credited.
      clutch: { A: null, B: null },  // { playerId, vs }
    },

    teams: {
      A: makeTeam('A', 'TEAM ALPHA', 'ALP', '#22d3a6', 'attack'),
      B: makeTeam('B', 'TEAM BRAVO', 'BRV', '#ff4655', 'defense'),
    },

    /** Drives the centre-screen round-win popup. Null when nothing to show. */
    roundResult: null,

    history: [],   // one entry per completed round
    log: [],       // operator-facing event feed (newest first, capped)
  };
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

const other = (t) => (t === 'A' ? 'B' : 'A');

function findPlayer(state, pid) {
  if (!pid) return null;
  const team = state.teams[pid[0]];
  return team ? team.players.find((p) => p.id === pid) || null : null;
}

/**
 * Whoever is driving the current action. Set by the server before each
 * dispatch so the event feed can attribute entries when several operators
 * are working the same match.
 */
let ACTOR = '';
export function setActor(name) { ACTOR = name || ''; }

function pushLog(state, kind, text) {
  state.log.unshift({ t: Date.now(), round: state.round.number, kind, text, by: ACTOR });
  if (state.log.length > 120) state.log.length = 120;
}

function abilityCost(agentKey, slot) {
  const ag = GD.AGENTS[agentKey];
  if (!ag) return 200;
  return ag.abil?.[slot] ?? 200;
}

/**
 * Value of a player's kit. Deliberately NOT zeroed on death — the money they
 * spent this round is still spent, so their remaining credits stay correct.
 * It's `teamLoadout` that only counts players still standing.
 */
export function playerLoadout(p) {
  if (p.loadoutLock != null) return p.loadoutLock;
  const w = GD.WEAPONS;
  let v = (w[p.weapons.primary]?.price || 0) + (w[p.weapons.secondary]?.price || 0);
  v += GD.SHIELDS[p.shield]?.price || 0;
  for (const slot of ['c', 'q', 'e']) v += (p.charges[slot] || 0) * abilityCost(p.agent, slot);
  return v;
}

/**
 * The players actually fielded this mode. Slots past the roster size still
 * exist in state — so switching Skirmish → Standard brings them back intact —
 * but they must not count toward alive counts, loadout, flawless or aces.
 */
export const activePlayers = (team) => team.players.slice(0, team.rosterSize ?? 5);

export function teamLoadout(team) {
  if (team.loadoutLock != null) return team.loadoutLock;
  return activePlayers(team).reduce((s, p) => s + (p.alive ? playerLoadout(p) : 0), 0);
}

const aliveCount = (team) => activePlayers(team).filter((p) => p.alive).length;

function maxCharges(p, slot) {
  const ag = GD.AGENTS[p.agent];
  const idx = { c: 0, q: 1, e: 2 }[slot];
  return ag?.max?.[idx] ?? 2;
}

/* ------------------------------------------------------------------ *
 * Round lifecycle
 * ------------------------------------------------------------------ */

function captureStartLoadout(state) {
  state.round.startLoadout = {
    A: teamLoadout(state.teams.A),
    B: teamLoadout(state.teams.B),
  };
}

function setPhase(state, phase, { autostart = true } = {}) {
  const R = GD.RULES;
  state.clock.phase = phase;
  if (phase === 'buy') {
    state.clock.remainingMs = R.buyPhaseMs;
  } else if (phase === 'live') {
    captureStartLoadout(state);
    state.clock.remainingMs = R.roundMs;
  } else {
    state.clock.running = false;
    return;
  }
  state.clock.running = autostart;
  state.clock.endsAt = autostart ? Date.now() + state.clock.remainingMs : 0;
}

function applyEconomy(state, winner, planted) {
  const R = GD.RULES;
  const loser = other(winner);

  state.teams[winner].lossStreak = 0;
  state.teams[loser].lossStreak = clamp(state.teams[loser].lossStreak + 1, 1, R.lossBonus.length);
  const bonus = R.lossBonus[state.teams[loser].lossStreak - 1];

  for (const p of state.teams[winner].players) p.credits = clamp(p.credits + R.winReward, 0, R.maxCredits);
  for (const p of state.teams[loser].players) p.credits = clamp(p.credits + bonus, 0, R.maxCredits);

  // Plant bonus goes to the attacking side whether they won or lost.
  if (planted) {
    const atk = state.teams.A.side === 'attack' ? 'A' : 'B';
    for (const p of state.teams[atk].players) p.credits = clamp(p.credits + R.plantReward, 0, R.maxCredits);
  }
}

function endRound(state, winner, condition) {
  const R = GD.RULES;
  const loser = other(winner);
  const w = state.teams[winner];
  const l = state.teams[loser];
  const start = state.round.startLoadout;

  w.score += 1;

  // --- Thrifty: won while heavily out-bought at the start of the round.
  const wl = start[winner] || 0;
  const ll = start[loser] || 0;
  const thrifty = ll > 0 && (wl <= ll * R.thrifty.ratio || ll - wl >= R.thrifty.diff);
  if (thrifty) w.stats.thrifties += 1;

  // --- Flawless: winning team lost nobody. Scales with the roster.
  const flawless = aliveCount(w) === (w.rosterSize ?? 5);
  if (flawless) w.stats.flawless += 1;

  // --- Ace: a single player took the whole enemy side, however big it is.
  const acePlayer = [...activePlayers(w), ...activePlayers(l)]
    .find((p) => p.roundKills >= (state.teams[other(p.id[0])].rosterSize ?? 5));
  if (acePlayer) state.teams[acePlayer.id[0]].stats.aces += 1;

  // --- Clutch: the flagged 1vX survivor's team took the round.
  let clutch = null;
  const flag = state.round.clutch?.[winner];
  if (flag) {
    const p = findPlayer(state, flag.playerId);
    if (p && p.alive) {
      p.clutches += 1;
      w.stats.clutches += 1;
      clutch = { team: winner, ...flag, playerName: p.name };
    }
  }

  // --- Pistol rounds.
  if (state.round.number === 1 || state.round.number === R.halfLength + 1) w.stats.pistols += 1;

  applyEconomy(state, winner, state.clock.spike.planted);

  state.history.push({
    n: state.round.number,
    winner, loser, condition,
    thrifty, flawless,
    ace: acePlayer ? { id: acePlayer.id, name: acePlayer.name } : null,
    clutch,
    loadout: { A: start.A, B: start.B },
    side: { A: state.teams.A.side, B: state.teams.B.side },
  });

  state.clock.phase = 'post';
  state.clock.running = false;

  const bits = [thrifty && 'THRIFTY', flawless && 'FLAWLESS', acePlayer && 'ACE', clutch && 'CLUTCH'].filter(Boolean);

  // Fires the centre-screen popup. `at` is what the overlay watches, so an
  // identical result later still re-triggers it.
  state.roundResult = {
    at: Date.now(),
    round: state.round.number,
    winner, condition,
    score: { A: state.teams.A.score, B: state.teams.B.score },
    badges: bits,
    detail: clutch ? `${clutch.playerName} 1v${clutch.vs}` : acePlayer ? `${acePlayer.name} ACE` : '',
  };
  pushLog(state, 'round', `R${state.round.number} → ${w.tag} (${GD.WIN_CONDITIONS[condition]?.label || condition})${bits.length ? ' · ' + bits.join(' · ') : ''}`);
}

function nextRound(state) {
  const R = GD.RULES;
  state.round.number += 1;
  state.round.firstBloodTaken = false;
  state.round.clutch = { A: null, B: null };
  state.roundResult = null;   // popup never bleeds into the next round
  state.clock.spike = { planted: false, defused: false, by: null, endsAt: 0 };

  // Side swap at the half, and every two rounds once overtime starts.
  const n = state.round.number;
  const inOT = n > R.halfLength * 2;
  const swap = n === R.sideSwapRound || (inOT && (n - R.halfLength * 2 - 1) % 2 === 0);
  if (swap) {
    state.teams.A.side = state.teams.A.side === 'attack' ? 'defense' : 'attack';
    state.teams.B.side = state.teams.B.side === 'attack' ? 'defense' : 'attack';
    pushLog(state, 'sides', `Sides switched — ${state.teams.A.tag} now ${state.teams.A.side.toUpperCase()}`);
  }

  for (const t of ['A', 'B']) {
    for (const p of state.teams[t].players) {
      p.roundKills = 0;
      p.carried = p.alive ? playerLoadout(p) : 0;
      if (!p.alive) {
        // Dead players drop everything; unused abilities are lost too.
        p.weapons = { primary: 'none', secondary: 'classic' };
        p.shield = 'none';
        p.charges = { c: 0, q: 0, e: 0 };
      }
      // Survivors keep weapons, shields and unused ability charges.
      p.alive = true;
      p.hp = 100;
      p.loadoutLock = null;
    }
    state.teams[t].loadoutLock = null;
  }

  setPhase(state, 'buy');
}

/* ------------------------------------------------------------------ *
 * Full-frame screens
 * ------------------------------------------------------------------ */

/** The takeover screens. Only one may be up at a time. */
const SCREENS = ['veto', 'agentPick', 'banner'];

const screenLabel = { veto: 'Map selection', agentPick: 'Agent select', banner: 'Timeout / result band' };

const screenIsOn = (state, which) =>
  which === 'veto' ? !!state.veto.on : !!state.screens[which]?.on;

function setScreen(state, which, on) {
  if (which === 'veto') state.veto.on = on;
  else if (state.screens[which]) state.screens[which].on = on;
}

/**
 * Shows one takeover and closes the others. They all cover the whole frame, so
 * leaving a previous one on would stack two graphics on stream — easy to do
 * when an operator moves between tabs without hiding the first.
 */
function showOnlyScreen(state, which) {
  const evicted = SCREENS.filter((s) => s !== which && screenIsOn(state, s));
  for (const s of SCREENS) setScreen(state, s, s === which);
  if (evicted.length) {
    pushLog(state, 'screen', `${screenLabel[which]} shown — auto-hid ${evicted.map((e) => screenLabel[e]).join(' + ')}`);
  }
}

/* ------------------------------------------------------------------ *
 * Reducer
 * ------------------------------------------------------------------ */

/** Deep-merges a plain-object patch into the state (arrays are replaced). */
function deepPatch(target, patch) {
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) {
      deepPatch(target[k], v);
    } else {
      target[k] = v;
    }
  }
  return target;
}

export function reduce(state, action) {
  const R = GD.RULES;
  const a = action || {};

  switch (a.type) {
    /* ---- generic edit surface used by most admin fields ---- */
    case 'patch': {
      deepPatch(state, a.patch);
      // Turning a takeover on via a plain patch still evicts the others, so
      // the rule holds however the change arrives — panel button, second
      // operator, or an ingest adapter.
      const p = a.patch || {};
      if (p.veto?.on === true) showOnlyScreen(state, 'veto');
      else if (p.screens?.agentPick?.on === true) showOnlyScreen(state, 'agentPick');
      else if (p.screens?.banner?.on === true) showOnlyScreen(state, 'banner');
      break;
    }

    /* ---- explicit screen control, for adapters and hotkeys ---- */
    case 'screen.show':
      if (SCREENS.includes(a.screen)) showOnlyScreen(state, a.screen);
      break;

    case 'screen.hide':
      if (a.screen) setScreen(state, a.screen, false);
      else for (const s of SCREENS) setScreen(state, s, false);   // clear the frame
      break;

    case 'player.patch': {
      const p = findPlayer(state, a.id);
      if (p) {
        deepPatch(p, a.patch);
        if (a.patch.agent) {
          const ag = GD.AGENTS[a.patch.agent];
          if (ag) p.ult.max = ag.ult;
        }
        for (const slot of ['c', 'q', 'e']) p.charges[slot] = clamp(p.charges[slot], 0, maxCharges(p, slot));
        p.hp = clamp(p.hp, 0, 100);
        p.credits = clamp(p.credits, 0, R.maxCredits);
        p.ult.pts = clamp(p.ult.pts, 0, p.ult.max);
      }
      break;
    }

    /* ---- the two things the operator actually types ---- */
    case 'kill': {
      const killer = findPlayer(state, a.killer);
      const victim = findPlayer(state, a.victim);
      if (!victim || !victim.alive) break;

      victim.alive = false;
      victim.hp = 0;
      victim.d += 1;

      if (killer && killer.id[0] !== victim.id[0]) {
        killer.k += 1;
        killer.roundKills += 1;
        killer.credits = clamp(killer.credits + R.killReward, 0, R.maxCredits);
        if (!state.round.firstBloodTaken) { killer.fb += 1; state.round.firstBloodTaken = true; }
      } else if (killer) {
        // Team kill: no reward, and the shooter eats the negative.
        killer.k -= 1;
      }
      for (const aid of a.assists || []) {
        const ap = findPlayer(state, aid);
        if (ap && ap.id !== killer?.id) ap.a += 1;
      }

      // Flag a 1vX the moment a side drops to its last player. First flag
      // wins, so the headline number stays the biggest deficit they faced.
      for (const t of ['A', 'B']) {
        if (state.round.clutch[t]) continue;
        const theirs = aliveCount(state.teams[other(t)]);
        if (aliveCount(state.teams[t]) === 1 && theirs >= 1) {
          const survivor = activePlayers(state.teams[t]).find((p) => p.alive);
          if (survivor) state.round.clutch[t] = { playerId: survivor.id, vs: theirs };
        }
      }

      pushLog(state, 'kill', `${killer ? killer.name : '—'} ⟶ ${victim.name}${a.weapon ? ` (${GD.WEAPONS[a.weapon]?.label || a.weapon})` : ''}`);
      break;
    }

    case 'revive': { // undo-a-death without rewinding the whole state
      const p = findPlayer(state, a.id);
      if (p) {
        if (!p.alive) p.d = Math.max(0, p.d - 1);   // only a real death gets given back
        p.alive = true;
        p.hp = a.hp ?? 100;
      }
      break;
    }

    case 'round.end':
      if (state.clock.phase !== 'post' && (a.winner === 'A' || a.winner === 'B')) {
        endRound(state, a.winner, a.condition || 'elim');
      }
      break;

    case 'round.next':
      nextRound(state);
      break;

    case 'round.undo': { // pop the last completed round and rewind the score
      const last = state.history.pop();
      if (last) {
        state.teams[last.winner].score = Math.max(0, state.teams[last.winner].score - 1);
        if (last.thrifty) state.teams[last.winner].stats.thrifties--;
        if (last.flawless) state.teams[last.winner].stats.flawless--;
        if (last.clutch) state.teams[last.winner].stats.clutches--;
        state.clock.phase = 'live';
        state.roundResult = null;
        pushLog(state, 'undo', `Round ${last.n} result reverted`);
      }
      break;
    }

    /* ---- clock ---- */
    case 'clock.phase':
      setPhase(state, a.phase, { autostart: a.autostart !== false });
      break;

    case 'clock.toggle':
      if (state.clock.running) {
        state.clock.remainingMs = Math.max(0, state.clock.endsAt - Date.now());
        state.clock.running = false;
      } else {
        state.clock.endsAt = Date.now() + state.clock.remainingMs;
        state.clock.running = true;
      }
      break;

    case 'clock.set':
      state.clock.remainingMs = Math.max(0, a.ms | 0);
      if (state.clock.running) state.clock.endsAt = Date.now() + state.clock.remainingMs;
      break;

    case 'spike.plant': {
      const atk = state.teams.A.side === 'attack' ? 'A' : 'B';
      state.clock.spike = { planted: true, defused: false, by: atk, endsAt: Date.now() + R.spikeMs };
      state.clock.remainingMs = R.spikeMs;
      state.clock.endsAt = Date.now() + R.spikeMs;
      state.clock.running = true;
      state.teams[atk].stats.plants += 1;
      const planter = findPlayer(state, a.by);
      if (planter && planter.id[0] === atk) planter.plants += 1;   // only attackers plant
      pushLog(state, 'spike', `Spike planted${planter ? ` — ${planter.name}` : ''}`);
      break;
    }

    case 'spike.defuse': {
      state.clock.spike.defused = true;
      state.clock.running = false;
      const def = state.teams.A.side === 'defense' ? 'A' : 'B';
      state.teams[def].stats.defuses += 1;
      const p = findPlayer(state, a.by);
      if (p) p.defuses += 1;
      pushLog(state, 'spike', `Spike defused${p ? ` — ${p.name}` : ''}`);
      break;
    }

    case 'spike.clear':
      state.clock.spike = { planted: false, defused: false, by: null, endsAt: 0 };
      break;

    /* ---- economy / buy helpers ---- */
    case 'buy.preset': {
      const preset = GD.BUY_PRESETS[a.preset];
      if (!preset) break;
      const targets = a.id ? [findPlayer(state, a.id)] : state.teams[a.team]?.players || [];
      for (const p of targets) {
        if (!p) continue;
        p.weapons = { primary: preset.primary, secondary: preset.secondary };
        p.shield = preset.shield;
        for (const slot of ['c', 'q', 'e']) {
          p.charges[slot] = clamp(preset.abilities, 0, maxCharges(p, slot));
        }
      }
      break;
    }

    /* ---- agent select reveal ---- */
    case 'agentPick.reveal': {
      const ap = state.screens.agentPick;
      if (!Array.isArray(ap.revealed) || ap.revealed.length !== 5) ap.revealed = [false, false, false, false, false];
      const names = state.teams[ap.team]?.players || [];
      if (a.mode === 'all') ap.revealed = ap.revealed.map(() => true);
      else if (a.mode === 'none') ap.revealed = ap.revealed.map(() => false);
      else if (a.mode === 'next') {
        const i = ap.revealed.findIndex((r) => !r);
        if (i >= 0) {
          ap.revealed[i] = true;
          pushLog(state, 'agents', `Revealed ${names[i]?.name || `player ${i + 1}`}`);
        }
      } else if (typeof a.index === 'number' && a.index >= 0 && a.index < 5) {
        ap.revealed[a.index] = a.revealed !== false;
      }
      break;
    }

    /* ---- game mode ---- */
    case 'format.mode': {
      const mode = GD.MODES?.[a.mode] ? a.mode : 'standard';
      state.format.mode = mode;
      const def = GD.MODES[mode];

      // Roster size follows the mode unless the operator has pinned it.
      if (a.keepRoster !== true) {
        for (const t of ['A', 'B']) state.teams[t].rosterSize = def.roster;
      }

      // Swap the veto pool to this mode's maps. Only when asked, so changing
      // mode mid-veto doesn't wipe a board someone has already built.
      if (a.loadPool) {
        const pool = GD.MAP_POOLS?.[def.pool] || GD.MAPS;
        state.veto.maps = pool.map((map) => ({ map, action: '', by: '', defense: '', revealed: false }));
        state.maps.current = pool[0] || state.maps.current;
      }

      pushLog(state, 'match', `Mode set to ${def.label}${a.loadPool ? ` — pool loaded (${(GD.MAP_POOLS?.[def.pool] || []).length} maps)` : ''}`);
      break;
    }

    case 'team.rosterSize': {
      const n = clamp(a.size | 0, 1, GD.MAX_ROSTER || 5);
      if (a.team) state.teams[a.team].rosterSize = n;
      else for (const t of ['A', 'B']) state.teams[t].rosterSize = n;
      break;
    }

    /* ---- map veto ---- */
    case 'veto.reveal': {
      const list = state.veto.maps;
      if (a.mode === 'all') list.forEach((m) => { m.revealed = true; });
      else if (a.mode === 'none') list.forEach((m) => { m.revealed = false; });
      else if (a.mode === 'next') {
        const next = list.find((m) => !m.revealed);
        if (next) { next.revealed = true; pushLog(state, 'veto', `Revealed ${next.map}`); }
      } else if (typeof a.index === 'number' && list[a.index]) {
        list[a.index].revealed = a.revealed !== false;
      }
      break;
    }

    case 'veto.set': {
      const m = state.veto.maps[a.index];
      if (m) Object.assign(m, a.patch || {});
      break;
    }

    case 'team.swapSides':
      state.teams.A.side = state.teams.A.side === 'attack' ? 'defense' : 'attack';
      state.teams.B.side = state.teams.B.side === 'attack' ? 'defense' : 'attack';
      break;

    case 'team.swapAll': { // full left/right flip, logos and all
      const A = state.teams.A, B = state.teams.B;
      const reId = (team, id) => team.players.forEach((p, i) => { p.id = `${id}${i + 1}`; });
      state.teams.A = { ...B, id: 'A' };
      state.teams.B = { ...A, id: 'B' };
      reId(state.teams.A, 'A');
      reId(state.teams.B, 'B');
      const sa = state.broadcast.seriesA;
      state.broadcast.seriesA = state.broadcast.seriesB;
      state.broadcast.seriesB = sa;
      break;
    }

    /* ---- match management ---- */
    case 'match.newMap': {
      const keep = {
        broadcast: state.broadcast,
        maps: state.maps,
        overlay: state.overlay,
        teamsMeta: ['A', 'B'].map((t) => {
          const { name, tag, color, logo, side, players } = state.teams[t];
          return { name, tag, color, logo, side, players: players.map((p) => ({ name: p.name, agent: p.agent })) };
        }),
      };
      const fresh = initialState();
      fresh.broadcast = keep.broadcast;
      fresh.maps = keep.maps;
      fresh.overlay = keep.overlay;
      ['A', 'B'].forEach((t, i) => {
        const m = keep.teamsMeta[i];
        Object.assign(fresh.teams[t], { name: m.name, tag: m.tag, color: m.color, logo: m.logo, side: m.side });
        fresh.teams[t].players.forEach((p, j) => {
          p.name = m.players[j].name;
          p.agent = m.players[j].agent;
          const ag = GD.AGENTS[p.agent];
          if (ag) p.ult.max = ag.ult;
        });
      });
      pushLog(fresh, 'match', 'New map loaded — rosters kept, score reset');
      return fresh;
    }

    case 'match.reset':
      return initialState();

    case 'match.import':
      if (a.state && typeof a.state === 'object') return a.state;
      break;

    default:
      break;
  }

  state.updatedAt = Date.now();
  return state;
}

/* ------------------------------------------------------------------ *
 * Derived view — what the overlay actually renders
 * ------------------------------------------------------------------ */

export function derive(state) {
  const R = GD.RULES;
  const now = Date.now();
  const remaining = state.clock.running ? Math.max(0, state.clock.endsAt - now) : state.clock.remainingMs;

  const teams = {};
  for (const t of ['A', 'B']) {
    const team = state.teams[t];
    const loadout = teamLoadout(team);
    teams[t] = {
      loadout,
      alive: aliveCount(team),
      econ: loadout < R.ecoThreshold ? 'ECO' : loadout >= R.fullBuyThreshold ? 'FULL BUY' : 'HALF BUY',
      rosterSize: team.rosterSize ?? 5,
      credits: activePlayers(team).reduce((s, p) => s + Math.max(0, p.credits - Math.max(0, playerLoadout(p) - (p.carried || 0))), 0),
      players: team.players.map((p) => {
        const lv = playerLoadout(p);
        // What this round's shopping cost them, and what's left in the bank.
        const spend = Math.max(0, lv - (p.carried || 0));
        return {
          id: p.id,
          loadout: lv,
          spend,
          remaining: Math.max(0, p.credits - spend),
          armor: GD.SHIELDS[p.shield]?.armor || 0,
          ultReady: p.ult.pts >= p.ult.max,
          maxCharges: { c: maxCharges(p, 'c'), q: maxCharges(p, 'q'), e: maxCharges(p, 'e') },
        };
      }),
    };
  }

  // Per-round pip strip: index 0 = round 1.
  const pips = state.history.map((h) => ({
    n: h.n, winner: h.winner, condition: h.condition,
    thrifty: h.thrifty, ace: !!h.ace, clutch: !!h.clutch,
  }));

  const matchPoint = ['A', 'B'].filter((t) =>
    state.teams[t].score >= R.roundsToWin - 1 && state.teams[t].score > state.teams[other(t)].score);

  return {
    remainingMs: remaining,
    clockLabel: formatClock(remaining),
    phase: state.clock.phase,
    teams,
    pips,
    matchPoint: matchPoint[0] || null,
    overtime: state.round.number > R.halfLength * 2,
  };
}

export function formatClock(ms) {
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export { other, findPlayer, aliveCount };
