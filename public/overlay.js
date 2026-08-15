/* ==========================================================================
   HSC Overlay renderer.

   Builds its DOM once (10 buy-board rows + 10 live cards), then patches
   values in place on every state push. Nothing is torn down, so CSS
   transitions survive and OBS never sees a flash.

   URL flags:  ?mode=buy|live|auto   force a mode (ignores match phase)
               ?chroma=1             green-screen background
               ?scale=0.75           scale the 1920x1080 stage
               ?bare=1               hide topbar chrome (clean buy board only)
   ========================================================================== */

const Q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const stage = $('stage');

if (Q.get('chroma')) document.body.classList.add('chroma');
if (Q.has('scale')) stage.style.setProperty('--scale', Q.get('scale'));
else {
  const fit = () => stage.style.setProperty('--scale', Math.min(innerWidth / 1920, innerHeight / 1080));
  addEventListener('resize', fit); fit();
}

let S = null;        // state
let D = null;        // derived
let GD = null;       // game data
let ASSETS = {};     // { agents:{jett:'/assets/agents/jett.png'}, weapons:{}, ... }

const num = (n) => (n ?? 0).toLocaleString('en-US');
const initials = (s) => (s || '?').replace(/[^a-z0-9 ]/gi, '').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

/** Riot's own spelling ("KAY/O") once assets have been fetched, else the key. */
const agentLabel = (k) => (k ? (GD?.AGENTS?.[k]?.label || k).toUpperCase() : '');

const WEAPON_ICON = {
  rifle: '#ic-rifle', smg: '#ic-smg', sniper: '#ic-sniper', shotgun: '#ic-shotgun',
  sidearm: '#ic-sidearm', heavy: '#ic-heavy', melee: '#ic-melee', none: '#ic-none',
};
const COND_ICON = { elim: '#ic-skull', spike: '#ic-spike', defuse: '#ic-defuse', time: '#ic-clock' };

function assetFor(kind, key) {
  if (!key) return '';
  const map = ASSETS[kind] || {};
  return map[String(key).toLowerCase()] || '';
}

/* ------------------------------------------------------------------ *
 * DOM construction (once)
 * ------------------------------------------------------------------ */

const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
const svg = (href, cls = 'i') => `<svg class="${cls}"><use href="${href}"/></svg>`;

const abilityBlock = (slot) => `
  <div class="abil" data-slot="${slot}">
    <div class="ab">${slot.toUpperCase()}</div>
    <div class="ab-dots"></div>
  </div>`;

function buildBuyRow(team, i) {
  const row = el('div', 'bb-row');
  row.dataset.pid = `${team}${i + 1}`;

  const player = el('div', 'pl', `
    <div class="pl-face"></div>
    <div class="pl-id"><div class="pl-name">—</div><div class="pl-role">—</div></div>`);
  const k = el('div', 'st k', '0');
  const d = el('div', 'st d', '0');
  const a = el('div', 'st a', '0');
  const abils = el('div', 'abils', ['c', 'q', 'e'].map(abilityBlock).join('') + abilityBlock('x'));
  const sh = el('div', 'sh', svg('#ic-shield'));
  const gun = el('div', 'gun', `<span class="wgfx">${svg('#ic-none')}</span><small>—</small>`);
  const creds = el('div', 'creds', `<div class="spend"></div><div class="have">${svg('#ic-cred')}<span>0</span></div>`);

  const order = team === 'A' ? [player, k, d, a, abils, sh, gun, creds]
                             : [creds, gun, sh, abils, a, d, k, player];
  order.forEach((n) => row.appendChild(n));
  return row;
}

function buildLiveCard(team, i) {
  const card = el('div', 'pc');
  card.dataset.pid = `${team}${i + 1}`;
  card.innerHTML = `
    <div class="pc-portrait"><span class="pf-txt">—</span><div class="pc-skull">${svg('#ic-skull')}</div></div>
    <div class="pc-main">
      <div class="pc-top">
        <div class="pc-name">—</div>
        <div class="pc-ult"></div>
        <div class="pc-kda"><b class="k">0</b>/<span class="d">0</span>/<span class="a">0</span></div>
      </div>
      <div class="pc-mid">
        <div class="pc-hp">100</div>
        <div class="pc-armor">${svg('#ic-shield')}<span>0</span></div>
        <div class="pc-abils">${['c', 'q', 'e'].map((s) => `<div class="ab" data-slot="${s}">${s.toUpperCase()}</div>`).join('')}</div>
        <div class="pc-weapon"><span class="wgfx">${svg('#ic-none')}</span></div>
        <div class="pc-creds">${svg('#ic-cred')}<span>0</span></div>
      </div>
      <div class="pc-hpbar"><span style="width:100%"></span><i style="width:0"></i></div>
    </div>`;
  return card;
}

for (const t of ['A', 'B']) {
  const rows = $(`bbRows${t}`);
  const rail = $(`rail${t}`);
  for (let i = 0; i < 5; i++) {
    const row = buildBuyRow(t, i);
    const card = buildLiveCard(t, i);
    row.style.setProperty('--i', i);      // drives the staggered mode switch
    card.style.setProperty('--i', i);
    rows.appendChild(row);
    rail.appendChild(card);
  }
}

/**
 * Writes a value and flashes it when it actually changed. Skipped on the very
 * first paint, otherwise every field would flare at once on connect.
 */
let firstPaint = true;
function setText(el, value) {
  const s = String(value);
  if (el.textContent === s) return;
  el.textContent = s;
  if (firstPaint) return;
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

/* ------------------------------------------------------------------ *
 * Render
 * ------------------------------------------------------------------ */

function render() {
  if (!S || !D) return;
  const R = GD.RULES;

  document.documentElement.style.setProperty('--tA', S.teams.A.color);
  document.documentElement.style.setProperty('--tB', S.teams.B.color);

  // Operator layout nudges, in canvas pixels.
  const L = S.overlay.layout || {};
  for (const k of ['railsY', 'railsX', 'buyY', 'barY', 'stripY', 'sponsorY']) {
    stage.style.setProperty(`--${k}`, `${Number(L[k]) || 0}px`);
  }

  // ---- mode ----
  const forced = Q.get('mode');
  let mode = forced && forced !== 'auto' ? forced : S.overlay.mode;
  if (mode === 'auto') mode = S.clock.phase === 'buy' ? 'buy' : 'live';
  stage.dataset.mode = mode;
  stage.dataset.spike = S.clock.spike.planted && !S.clock.spike.defused ? '1' : '0';
  stage.dataset.lt = S.overlay.lowerThird.on ? '1' : '0';
  stage.dataset.ready = '1';

  // Each falsy toggle becomes an `off-<key>` class on the stage; the
  // stylesheet does the hiding. One place to add a switch, no DOM hunting.
  const show = { ...S.overlay.show };
  if (Q.get('bare')) { show.seriesStrip = false; show.sponsors = false; }
  for (const [key, on] of Object.entries(show)) stage.classList.toggle(`off-${key}`, !on);

  // ---- scorebar ----
  for (const t of ['A', 'B']) {
    const team = S.teams[t];
    $(`sbTag${t}`).textContent = team.tag || team.name;
    const side = $(`sbSide${t}`);
    side.textContent = team.side === 'attack' ? 'ATTACK' : 'DEFENSE';
    side.dataset.side = team.side;
    const sc = $(`sbScore${t}`);
    if (sc.textContent !== String(team.score)) {
      sc.textContent = team.score;
      sc.classList.remove('bump'); void sc.offsetWidth; sc.classList.add('bump');
    }
    const logo = assetOrRaw(team.logo);
    $(`sbLogo${t}`).style.backgroundImage = logo ? `url("${logo}")` : '';
    $(`bbLogo${t}`).style.backgroundImage = logo ? `url("${logo}")` : '';
    $(`bbName${t}`).textContent = team.name;
    $(`bbLoad${t}`).textContent = num(D.teams[t].loadout);
    const econ = $(`bbEcon${t}`);
    econ.textContent = D.teams[t].econ;
    econ.dataset.e = D.teams[t].econ;
  }

  $('sbRound').textContent = D.overtime ? `OVERTIME · R${S.round.number}` : `ROUND ${S.round.number}`;
  $('sbPhaseText').textContent =
    D.matchPoint ? `MATCH POINT · ${S.teams[D.matchPoint].tag}`
    : S.clock.phase === 'buy' ? 'BUY PHASE'
    : S.clock.phase === 'post' ? 'ROUND OVER' : 'LIVE';
  $('sbSeriesA').textContent = S.broadcast.seriesA;
  $('sbSeriesB').textContent = S.broadcast.seriesB;
  $('sbSeries').querySelector('i').textContent = `BO${S.broadcast.bestOf}`;

  $('ssCurrent').textContent = S.maps.current || '—';
  $('ssNext').textContent = S.maps.next || '—';
  $('ssDecider').textContent = S.maps.decider || '—';
  $('bbMap').textContent = (S.maps.current || '').toUpperCase();

  $('ltTitle').textContent = S.overlay.lowerThird.title;
  $('ltSub').textContent = S.overlay.lowerThird.subtitle;

  renderLadder();
  renderChips();
  renderRoundPopup();
  renderVeto();
  renderAgentPick();
  renderBand();
  firstPaint = false;

  // ---- players ----
  for (const t of ['A', 'B']) {
    S.teams[t].players.forEach((p, i) => {
      const dp = D.teams[t].players[i];
      paintBuyRow($(`bbRows${t}`).children[i], p, dp, show);
      paintLiveCard($(`rail${t}`).children[i], p, dp, show);
    });
  }

  tickClock();
}

function assetOrRaw(v) {
  if (!v) return '';
  return v;
}

function paintBuyRow(row, p, dp, show) {
  const face = row.querySelector('.pl-face');
  const img = show.agentPortraits ? assetFor('agents', p.agent) : '';
  face.style.backgroundImage = img ? `url("${img}")` : '';
  face.textContent = img ? '' : initials(agentLabel(p.agent) || p.name);

  row.querySelector('.pl-name').textContent = p.name;
  row.querySelector('.pl-role').textContent =
    p.agent ? `${(GD.AGENTS[p.agent]?.role || '').toUpperCase()} · ${agentLabel(p.agent)}` : '—';

  setText(row.querySelector('.st.k'), p.k);
  setText(row.querySelector('.st.d'), p.d);
  setText(row.querySelector('.st.a'), p.a);

  paintAbilities(row.querySelectorAll('.abil'), p, dp, true);

  const sh = row.querySelector('.sh');
  sh.dataset.s = p.shield;
  sh.style.opacity = p.shield === 'none' ? .25 : 1;

  const gun = row.querySelector('.gun');
  const wKey = p.weapons.primary && p.weapons.primary !== 'none' ? p.weapons.primary : p.weapons.secondary;
  const w = GD.WEAPONS[wKey] || GD.WEAPONS.none;
  gun.classList.toggle('empty', !wKey || wKey === 'none');
  paintWeaponIcon(gun, wKey, w);
  gun.querySelector('small').textContent = (w.label || '—').toUpperCase();

  row.querySelector('.spend').textContent = dp.spend > 0 ? `-${num(dp.spend)}` : '';
  setText(row.querySelector('.have span'), num(dp.remaining));
  row.style.opacity = p.alive ? 1 : .55;
}

function paintLiveCard(card, p, dp, show) {
  card.classList.toggle('dead', !p.alive);

  const face = card.querySelector('.pc-portrait');
  const img = show.agentPortraits ? assetFor('agents', p.agent) : '';
  face.style.backgroundImage = img ? `url("${img}")` : '';
  face.querySelector('.pf-txt').textContent = img ? '' : initials(agentLabel(p.agent) || p.name);

  card.querySelector('.pc-name').textContent = p.name;
  setText(card.querySelector('.pc-kda .k'), p.k);
  setText(card.querySelector('.pc-kda .d'), p.d);
  setText(card.querySelector('.pc-kda .a'), p.a);

  card.querySelector('.pc-hp').textContent = p.alive ? p.hp : 0;
  card.querySelector('.pc-armor span').textContent = p.alive ? dp.armor : 0;
  card.querySelector('.pc-hpbar span').style.width = `${p.alive ? p.hp : 0}%`;
  card.querySelector('.pc-hpbar i').style.width = `${p.alive ? Math.min(100, dp.armor * 2) : 0}%`;

  const wKey = p.weapons.primary !== 'none' ? p.weapons.primary : p.weapons.secondary;
  const w = GD.WEAPONS[wKey] || GD.WEAPONS.none;
  paintWeaponIcon(card.querySelector('.pc-weapon'), wKey, w);
  card.querySelector('.pc-creds span').textContent = num(dp.remaining);

  const abils = card.querySelector('.pc-abils');
  ['c', 'q', 'e'].forEach((slot) => {
    abils.querySelector(`.ab[data-slot="${slot}"]`).classList.toggle('on', (p.charges[slot] || 0) > 0);
  });

  const ult = card.querySelector('.pc-ult');
  if (ult.children.length !== p.ult.max) ult.innerHTML = '<b></b>'.repeat(p.ult.max);
  [...ult.children].forEach((b, i) => b.classList.toggle('on', i < p.ult.pts));
  ult.classList.toggle('ready', dp.ultReady);
}

/** Real weapon art from /assets/weapons wins; otherwise the inline silhouette. */
function paintWeaponIcon(container, wKey, w) {
  const img = assetFor('weapons', wKey);
  const key = img || `svg:${w.class}`;
  const gfx = container.querySelector('.wgfx');
  if (gfx.dataset.wk === key) return;
  gfx.dataset.wk = key;
  gfx.innerHTML = img ? `<img src="${img}" alt="">` : svg(WEAPON_ICON[w.class] || '#ic-none');
}

function paintAbilities(nodes, p, dp, withUlt) {
  nodes.forEach((node) => {
    const slot = node.dataset.slot;
    const dots = node.querySelector('.ab-dots');
    if (slot === 'x') {
      node.querySelector('.ab').classList.toggle('on', dp.ultReady);
      const max = p.ult.max, have = p.ult.pts;
      if (dots.children.length !== max) dots.innerHTML = '<i></i>'.repeat(max);
      [...dots.children].forEach((d, i) => d.classList.toggle('on', i < have));
    } else {
      const max = dp.maxCharges[slot];
      const have = p.charges[slot] || 0;
      node.querySelector('.ab').classList.toggle('on', have > 0);
      if (dots.children.length !== max) dots.innerHTML = '<i></i>'.repeat(max);
      [...dots.children].forEach((d, i) => d.classList.toggle('on', i < have));
    }
  });
}

/* ---- round ladder ---- */
function renderLadder() {
  const ladder = $('ladder');
  const R = GD.RULES;
  const total = Math.max(R.halfLength * 2, S.history.length + 1);
  const key = `${total}|${S.round.number}|${S.history.map((h) => h.winner + h.condition + (h.thrifty ? 't' : '')).join('')}`;
  if (ladder.dataset.key === key) return;
  ladder.dataset.key = key;

  const pipw = total <= 24 ? 26 : Math.max(16, Math.floor(660 / total));
  ladder.style.setProperty('--pipw', `${pipw}px`);
  ladder.innerHTML = '';

  for (let n = 1; n <= total; n++) {
    if (n === R.halfLength + 1) ladder.appendChild(el('div', 'ladder-half'));
    const h = S.history.find((x) => x.n === n);
    const pip = el('div', 'pip');
    if (h) pip.dataset.w = h.winner;
    if (n === S.round.number) pip.classList.add('current');
    pip.innerHTML = `<div class="n">${String(n).padStart(2, '0')}</div>
      <div class="bar">${h ? svg(COND_ICON[h.condition] || '#ic-skull') : ''}</div>
      ${h && (h.thrifty || h.ace || h.clutch) ? '<span class="flag"></span>' : ''}`;
    ladder.appendChild(pip);
  }
}

/* ---- agent pick screen ----
   One team's five agents with the player's name under each. Cards are only
   rebuilt when the line-up actually changes, so re-focusing doesn't replay
   the entrance animation. */
function renderAgentPick() {
  const ap = S.screens?.agentPick || { on: false };
  stage.dataset.apick = ap.on ? '1' : '0';
  const row = $('apRow');
  if (!ap.on && !row.children.length) return;

  const team = S.teams[ap.team] || S.teams.A;
  $('apTeam').textContent = team.name;
  $('apTitle').textContent = ap.title || 'AGENT SELECT';
  $('agentPick').style.setProperty('--team', team.color);

  const key = `${ap.team}|${team.players.map((p) => `${p.name}:${p.agent}`).join('~')}`;
  if (row.dataset.key !== key) {
    row.dataset.key = key;
    row.innerHTML = team.players.map((p, i) => {
      const art = assetFor('agents', `${p.agent}-full`) || assetFor('agents', p.agent);
      // The frame flies in with the screen; .ap-inner holds everything that
      // swipes up when this player is revealed.
      return `
        <div class="ap-card" style="--i:${i}" data-revealed="0">
          <div class="ap-pending"><span>${escapeHtml(p.name)}</span></div>
          <div class="ap-inner">
            <div class="ap-art" style="${art ? `background-image:url('${art}')` : ''}"></div>
            <div class="ap-foot">
              <div class="ap-agent">${escapeHtml(agentLabel(p.agent) || '—')}</div>
              <div class="ap-player">${escapeHtml(p.name)}</div>
            </div>
          </div>
        </div>`;
    }).join('');
  }

  const revealed = Array.isArray(ap.revealed) ? ap.revealed : [];
  [...row.children].forEach((el, i) => {
    el.dataset.revealed = revealed[i] ? '1' : '0';
    // Only a revealed card can hold the spotlight.
    el.classList.toggle('on', i === ap.focus && !!revealed[i]);
  });
}

/* ---- timeout / result band ---- */
function renderBand() {
  const b = S.screens?.banner || { on: false };
  stage.dataset.band = b.on ? '1' : '0';
  if (!b.on) return;

  const team = S.teams[b.team] || S.teams.A;
  const el = $('band');
  el.dataset.kind = b.kind;
  el.style.setProperty('--wteam', team.color);

  $('bandWord').textContent = b.kind === 'win' ? 'VICTORY' : b.kind === 'loss' ? 'DEFEAT' : 'TIMEOUT';
  $('bandTeam').textContent = team.name;
  $('bandLogo').style.backgroundImage = team.logo ? `url("${team.logo}")` : '';
  // Score is meaningful on a result, not on a timeout.
  $('bandScore').textContent =
    b.showScore && b.kind !== 'timeout' ? `${S.teams.A.score} – ${S.teams.B.score}` : '';
}

/* ---- map veto screen ----
   Cards are rebuilt only when the pool actually changes; reveal flags are
   patched in place so the swipe-up animation is never restarted by an
   unrelated state push. */
function renderVeto() {
  const v = S.veto || { on: false, maps: [] };
  stage.dataset.veto = v.on ? '1' : '0';
  if (!v.on && !$('vetoMaps').children.length) return;

  $('vhTeamA').textContent = S.teams.A.name;
  $('vhTeamB').textContent = S.teams.B.name;
  $('vhTitle').textContent = v.title || 'MAP SELECTION';

  const box = $('vetoMaps');
  box.dataset.dense = v.maps.length >= 6 ? '1' : '0';
  // Structure key: rebuild only if the pool or any label changed.
  const key = v.maps.map((m) => `${m.map}|${m.action}|${m.by}|${m.defense}`).join('~');
  if (box.dataset.key !== key) {
    box.dataset.key = key;
    box.innerHTML = v.maps.map((m, i) => vetoCard(m, i)).join('');
    // Background uses the first decided pick, else the first map in the pool.
    const hero = v.maps.find((m) => m.action === 'pick' || m.action === 'decider') || v.maps[0];
    const bg = hero ? (assetFor('maps', `${mapKey(hero.map)}-splash`) || assetFor('maps', mapKey(hero.map))) : '';
    $('vetoBg').style.backgroundImage = bg ? `url("${bg}")` : '';
  }

  // Reveal flags patched separately so cards don't re-animate on every push.
  [...box.children].forEach((el, i) => {
    el.dataset.revealed = v.maps[i]?.revealed ? '1' : '0';
  });
}

const mapKey = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function vetoCard(m, i) {
  const art = assetFor('maps', `${mapKey(m.map)}-splash`) || assetFor('maps', mapKey(m.map));
  const teamName = (t) => (t === 'A' || t === 'B' ? S.teams[t].name : '');
  const teamCls = (t) => (t === 'A' ? 'team-a' : t === 'B' ? 'team-b' : '');
  const pickCol = m.by === 'A' ? 'var(--tA)' : m.by === 'B' ? 'var(--tB)' : 'var(--ink)';

  // Banned maps show who banned them; picked maps show who picked and which
  // side starts on defence.
  let foot = '';
  if (m.action === 'ban') {
    foot = `<div class="vf-row ${teamCls(m.by)}"><b>BANNED BY</b><span>${escapeHtml(teamName(m.by) || '—')}</span></div>`;
  } else if (m.action === 'pick' || m.action === 'decider') {
    const label = m.action === 'decider' ? 'DECIDER' : 'SELECTED BY';
    const who = m.action === 'decider' ? (teamName(m.by) || 'REMAINING MAP') : (teamName(m.by) || '—');
    foot = `<div class="vf-row ${teamCls(m.by)}"><b>${label}</b><span>${escapeHtml(who)}</span></div>`;
    if (m.defense) {
      foot += `<div class="vf-row ${teamCls(m.defense)}"><b>DEFENSE</b><span>${escapeHtml(teamName(m.defense))}</span></div>`;
    }
  }

  return `
    <div class="vmap" data-action="${m.action || ''}" data-revealed="0" style="--i:${i};--pickcol:${pickCol}">
      <div class="vmap-inner">
        <div class="vmap-art" style="${art ? `background-image:url('${art}')` : ''}"></div>
        <div class="vmap-ban"></div>
        <div class="vmap-name">${escapeHtml((m.map || '').toUpperCase())}</div>
        ${m.action === 'ban' ? '<div class="vmap-banmark"><span>BANNED</span></div>' : ''}
        ${foot ? `<div class="vmap-foot">${foot}</div>` : ''}
      </div>
    </div>`;
}

/* ---- round win popup ----
   Triggered by a new `roundResult.at`. A late-joining or reconnecting client
   won't replay an old result, because anything older than the display window
   is ignored. */
let lastResultAt = 0;
let rwinTimer = null;

function renderRoundPopup() {
  const rr = S.roundResult;
  if (!rr) { lastResultAt = 0; hideRoundPopup(); return; }
  if (rr.at === lastResultAt) return;

  lastResultAt = rr.at;
  const dur = Math.max(1500, S.overlay.roundPopupMs || 6000);
  const age = Date.now() - rr.at;
  if (age > dur) return;                       // stale — don't flash it on reconnect

  const team = S.teams[rr.winner];
  const box = $('roundWin');
  box.dataset.w = rr.winner;
  $('rwRound').textContent = rr.round;
  $('rwTeam').textContent = team.name;
  $('rwLogo').style.backgroundImage = team.logo ? `url("${team.logo}")` : '';
  $('rwScoreA').textContent = rr.score.A;
  $('rwScoreB').textContent = rr.score.B;
  $('rwCond').textContent = (GD.WIN_CONDITIONS?.[rr.condition]?.label || rr.condition).toUpperCase();
  $('rwCondIcon').querySelector('use').setAttribute('href', COND_ICON[rr.condition] || '#ic-skull');
  $('rwBadges').innerHTML = (rr.badges || []).map((b) => `<div class="rw-badge">${b}</div>`).join('');

  // Sponsor lock-up: only rendered when one is actually configured — an empty
  // box would otherwise sit there as a blank strip on stream.
  const sp = (S.broadcast.sponsors || []).find((x) => x.enabled && (x.logo || x.name));
  $('rwSponsor').innerHTML = sp
    ? `<span class="rw-sp-label">PRESENTED BY</span>${sp.logo
        ? `<img src="${sp.logo}" alt="">`
        : `<span class="rw-sp-name">${escapeHtml(sp.name)}</span>`}`
    : '';

  stage.dataset.rwin = '1';
  clearTimeout(rwinTimer);
  rwinTimer = setTimeout(hideRoundPopup, dur - age);
}

function hideRoundPopup() {
  clearTimeout(rwinTimer);
  stage.dataset.rwin = '0';
}

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---- stat chips ---- */
function renderChips() {
  for (const t of ['A', 'B']) {
    const s = S.teams[t].stats;
    const box = $(`chips${t}`);
    const defs = [
      ['THRIFTY', s.thrifties], ['CLUTCH', s.clutches], ['FLAWLESS', s.flawless],
      ['ACE', s.aces], ['PISTOL', s.pistols], ['PLANTS', s.plants],
    ];
    const html = defs.map(([label, v]) => `<div class="chip${v > 0 ? ' hot' : ''}"><b>${v}</b>${label}</div>`).join('');
    if (box.dataset.h !== html) { box.dataset.h = html; box.innerHTML = html; }
  }
}

/* ---- local clock tick ---- */
function tickClock() {
  if (!S) return;
  const c = S.clock;
  const ms = c.running ? Math.max(0, c.endsAt - Date.now()) : c.remainingMs;
  const s = Math.ceil(ms / 1000);
  const t = $('sbTimer');
  t.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  // Amber in the last 10s, and once expired — a frozen 0:00 in plain white
  // reads as a broken overlay rather than "the round needs calling".
  t.classList.toggle('warn', (s <= 10 && c.running) || ms === 0);
}
setInterval(tickClock, 100);

/* ---- sponsor rotation (cadence follows broadcast.sponsorMs) ---- */
let spIdx = -1;
function rotateSponsor() {
  const slot = $('sponsorSlot');
  const list = S ? (S.broadcast.sponsors || []).filter((x) => x.enabled && (x.name || x.logo)) : [];
  if (!list.length) {
    slot.textContent = '';
  } else {
    spIdx = (spIdx + 1) % list.length;
    const sp = list[spIdx];
    slot.innerHTML = sp.logo ? `<img src="${sp.logo}" alt="">` : sp.name;
    slot.style.animation = 'none'; void slot.offsetWidth; slot.style.animation = '';
  }
  setTimeout(rotateSponsor, Math.max(2000, S?.broadcast.sponsorMs || 8000));
}
rotateSponsor();

/* ------------------------------------------------------------------ *
 * Transport
 * ------------------------------------------------------------------ */

async function loadStatics() {
  const [gd, list] = await Promise.all([
    fetch('/api/gamedata').then((r) => r.json()),
    fetch('/api/assets').then((r) => r.json()).catch(() => ({})),
  ]);
  GD = gd;
  ASSETS = {};
  for (const [kind, files] of Object.entries(list)) {
    ASSETS[kind] = {};
    for (const f of files) {
      const base = f.split('/').pop().replace(/\.[^.]+$/, '').toLowerCase();
      ASSETS[kind][base] = f;
    }
  }
}

function connect() {
  const es = new EventSource('/api/stream');
  es.onmessage = (e) => {
    stage.dataset.offline = '0';
    const msg = JSON.parse(e.data);
    S = msg.state; D = msg.derived;
    render();
  };
  es.onerror = () => { stage.dataset.offline = '1'; };
}

loadStatics().then(connect);
