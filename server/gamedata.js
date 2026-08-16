/**
 * Static game data: weapons, shields, agents, maps, economy rules.
 *
 * Everything here is a DEFAULT. On boot the server merges `data/gamedata.json`
 * over the top of it, so a balance patch never requires a code change — edit
 * the JSON, restart, done. `npm run assets` will also rewrite this file's
 * JSON twin with live agent/map names + icons from valorant-api.com.
 */

export const WEAPONS = {
  // key            label          class       price
  none: { label: '—', class: 'none', price: 0 },
  melee: { label: 'Melee', class: 'melee', price: 0 },
  classic: { label: 'Classic', class: 'sidearm', price: 0 },
  shorty: { label: 'Shorty', class: 'sidearm', price: 300 },
  frenzy: { label: 'Frenzy', class: 'sidearm', price: 450 },
  ghost: { label: 'Ghost', class: 'sidearm', price: 500 },
  sheriff: { label: 'Sheriff', class: 'sidearm', price: 800 },
  stinger: { label: 'Stinger', class: 'smg', price: 950 },
  spectre: { label: 'Spectre', class: 'smg', price: 1600 },
  bucky: { label: 'Bucky', class: 'shotgun', price: 850 },
  judge: { label: 'Judge', class: 'shotgun', price: 1850 },
  bulldog: { label: 'Bulldog', class: 'rifle', price: 2050 },
  guardian: { label: 'Guardian', class: 'rifle', price: 2250 },
  phantom: { label: 'Phantom', class: 'rifle', price: 2900 },
  vandal: { label: 'Vandal', class: 'rifle', price: 2900 },
  marshal: { label: 'Marshal', class: 'sniper', price: 950 },
  outlaw: { label: 'Outlaw', class: 'sniper', price: 2400 },
  operator: { label: 'Operator', class: 'sniper', price: 4700 },
  ares: { label: 'Ares', class: 'heavy', price: 1550 },
  odin: { label: 'Odin', class: 'heavy', price: 3200 },
};

export const SHIELDS = {
  none: { label: 'None', price: 0, armor: 0 },
  light: { label: 'Light', price: 400, armor: 25 },
  regen: { label: 'Regen', price: 650, armor: 25 },
  heavy: { label: 'Heavy', price: 1000, armor: 50 },
};

/**
 * Agents. `ult` = ult points required. `abil` = default credit cost per
 * charge for the C / Q / E signature slots (E is usually the free signature).
 * `max` = default max charges shown as pips on the overlay.
 *
 * These are broadcast-facing numbers — verify against the live patch before
 * a big event and correct them in data/gamedata.json if Riot has moved them.
 */
const A = (role, ult, c, q, e, max) => ({ role, ult, abil: { c, q, e }, max });

export const AGENTS = {
  astra:      A('Controller', 7, 150, 200, 0, [1, 1, 1]),
  breach:     A('Initiator', 9, 300, 250, 0, [2, 2, 3]),
  brimstone:  A('Controller', 7, 100, 200, 0, [2, 1, 1]),
  chamber:    A('Sentinel', 8, 150, 500, 0, [1, 1, 1]),
  clove:      A('Controller', 8, 100, 200, 0, [2, 1, 1]),
  cypher:     A('Sentinel', 7, 200, 200, 0, [2, 1, 1]),
  deadlock:   A('Sentinel', 8, 200, 200, 0, [1, 2, 2]),
  fade:       A('Initiator', 8, 250, 200, 0, [1, 2, 1]),
  gekko:      A('Initiator', 7, 300, 250, 0, [1, 1, 1]),
  harbor:     A('Controller', 8, 150, 200, 0, [2, 1, 1]),
  iso:        A('Duelist', 7, 200, 250, 0, [1, 2, 1]),
  jett:       A('Duelist', 7, 150, 200, 0, [2, 2, 1]),
  kayo:       A('Initiator', 8, 200, 250, 0, [1, 2, 1]),
  killjoy:    A('Sentinel', 8, 200, 200, 0, [1, 1, 1]),
  neon:       A('Duelist', 7, 200, 200, 0, [2, 2, 1]),
  omen:       A('Controller', 7, 150, 100, 0, [1, 2, 2]),
  phoenix:    A('Duelist', 6, 200, 250, 0, [1, 1, 2]),
  raze:       A('Duelist', 8, 200, 300, 0, [2, 1, 1]),
  reyna:      A('Duelist', 6, 200, 200, 0, [2, 2, 2]),
  sage:       A('Sentinel', 8, 400, 300, 0, [1, 1, 1]),
  skye:       A('Initiator', 8, 250, 200, 0, [1, 2, 1]),
  sova:       A('Initiator', 8, 200, 250, 0, [2, 2, 1]),
  tejo:       A('Initiator', 8, 200, 250, 0, [1, 1, 1]),
  viper:      A('Controller', 7, 200, 200, 0, [1, 1, 1]),
  vyse:       A('Sentinel', 7, 200, 300, 0, [1, 1, 1]),
  waylay:     A('Duelist', 7, 200, 250, 0, [1, 2, 1]),
  yoru:       A('Duelist', 7, 200, 150, 0, [1, 2, 1]),
};

export const MAPS = [
  'Abyss', 'Ascent', 'Bind', 'Breeze', 'Corrode', 'Fracture',
  'Haven', 'Icebox', 'Lotus', 'Pearl', 'Split', 'Sunset',
];

/**
 * Map pools per game mode. Taken from Riot's own map list: the 5v5 maps are
 * the ones carrying a tactical description, while TDM and Skirmish ship their
 * own smaller arenas. `npm run assets` regenerates these.
 */
export const MAP_POOLS = {
  standard: MAPS,
  retake: MAPS,                                                   // retakes play on the 5v5 maps
  tdm: ['District', 'Drift', 'Glitch', 'Kasbah', 'Piazza'],
  skirmish: ['Skirmish A', 'Skirmish B', 'Skirmish C', 'Skirmish D', 'Skirmish E'],
};

/**
 * Formats the suite can run. `roster` is how many players a side fields by
 * default — the panel still lets you go up to 5 on any mode, because scrims
 * and showmatches don't always follow the book.
 */
export const MODES = {
  standard: { label: 'Standard', roster: 5, pool: 'standard' },
  retake: { label: 'Retake', roster: 3, pool: 'retake' },
  tdm: { label: 'Team Deathmatch', roster: 5, pool: 'tdm' },
  skirmish: { label: 'Skirmish', roster: 2, pool: 'skirmish' },
};

export const MAX_ROSTER = 5;

/** Round win conditions — drive the pip icons on the scorebar. */
export const WIN_CONDITIONS = {
  elim: { label: 'Elimination', icon: 'skull' },
  spike: { label: 'Spike Detonated', icon: 'spike' },
  defuse: { label: 'Spike Defused', icon: 'defuse' },
  time: { label: 'Time Expired', icon: 'clock' },
};

export const RULES = {
  // Credits
  startCredits: 800,
  maxCredits: 9000,
  killReward: 200,
  winReward: 3000,
  lossBonus: [1900, 2400, 2900], // 1st / 2nd / 3rd+ consecutive loss
  plantReward: 300,              // to the attacking team, win or lose
  survivorKeepsLoadout: true,

  // Clock (ms)
  buyPhaseMs: 30_000,
  roundMs: 100_000,
  spikeMs: 45_000,

  // Format
  roundsToWin: 13,
  overtimeWinBy: 2,
  sideSwapRound: 13,   // sides switch at the start of this round
  halfLength: 12,      // rounds per half

  /**
   * Thrifty detection. `ratio` = winner's loadout was at most this fraction of
   * the loser's. `diff` = or the loser out-spent the winner by this much.
   * Either condition firing marks the round thrifty.
   */
  thrifty: { ratio: 0.5, diff: 4000 },

  // Bonus/eco round labels shown in the buy board
  ecoThreshold: 5000,   // team loadout below this = "ECO"
  fullBuyThreshold: 20000,
};

/** Quick-buy presets the operator can slam onto a whole team in one click. */
export const BUY_PRESETS = {
  pistol: { label: 'Pistol', primary: 'none', secondary: 'classic', shield: 'light', abilities: 1 },
  eco: { label: 'Eco', primary: 'none', secondary: 'ghost', shield: 'none', abilities: 0 },
  half: { label: 'Half Buy', primary: 'spectre', secondary: 'classic', shield: 'light', abilities: 1 },
  full: { label: 'Full Buy', primary: 'vandal', secondary: 'classic', shield: 'heavy', abilities: 2 },
  fullOp: { label: 'Full + Op', primary: 'operator', secondary: 'sheriff', shield: 'heavy', abilities: 2 },
};

export const DEFAULT_GAMEDATA = {
  WEAPONS, SHIELDS, AGENTS, MAPS, MAP_POOLS, MODES, MAX_ROSTER, RULES, BUY_PRESETS, WIN_CONDITIONS,
};
