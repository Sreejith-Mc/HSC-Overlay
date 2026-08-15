/* ==========================================================================
   HSC Overlay control panel.

   Everything the operator does becomes an action POSTed to /api/action.
   The server is the single source of truth and pushes state back over SSE,
   so two operators on two laptops stay in lockstep automatically.
   ========================================================================== */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

let S = null, D = null, GD = null, UNDO = 0;

const num = (n) => (n ?? 0).toLocaleString('en-US');
/** Riot's own spelling once assets are fetched (KAY/O, etc.), else the key. */
const AGENT_LABEL = (k) => (GD?.AGENTS?.[k]?.label || k).toUpperCase();

/* ------------------------------------------------------------------ *
 * Transport
 * ------------------------------------------------------------------ */

async function send(action) {
  try {
    const r = await fetch('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action),
    });
    if (r.status === 401) {
      // Session expired mid-shift — bounce to sign-in rather than silently
      // dropping the operator's input.
      toast('SESSION EXPIRED — SIGNING IN AGAIN');
      setTimeout(() => { location.href = `/login?next=${encodeURIComponent(location.pathname)}`; }, 900);
      return;
    }
    if (!r.ok) toast('ACTION FAILED');
  } catch { toast('SERVER UNREACHABLE'); }
}

/** Turns "broadcast.seriesA" + value into a nested patch action. */
function patchPath(path, value) {
  const keys = path.split('.');
  const patch = {};
  let cur = patch;
  keys.forEach((k, i) => {
    if (i === keys.length - 1) cur[k] = value;
    else cur = (cur[k] = {});
  });
  return send({ type: 'patch', patch });
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 1400);
}

/* ------------------------------------------------------------------ *
 * Option builders
 * ------------------------------------------------------------------ */

function weaponOptions(includeNone = true) {
  const groups = {};
  for (const [k, w] of Object.entries(GD.WEAPONS)) {
    if (k === 'none') continue;
    (groups[w.class] ||= []).push([k, w]);
  }
  let html = includeNone ? '<option value="none">— none —</option>' : '';
  for (const [cls, list] of Object.entries(groups)) {
    html += `<optgroup label="${cls.toUpperCase()}">`;
    for (const [k, w] of list) html += `<option value="${k}">${w.label} · ${num(w.price)}</option>`;
    html += '</optgroup>';
  }
  return html;
}

const shieldOptions = () => Object.entries(GD.SHIELDS)
  .map(([k, s]) => `<option value="${k}">${s.label}${s.price ? ` · ${num(s.price)}` : ''}</option>`).join('');

const agentOptions = () => '<option value="">— agent —</option>' + Object.keys(GD.AGENTS).sort()
  .map((k) => `<option value="${k}">${AGENT_LABEL(k)}</option>`).join('');

const mapOptions = () => GD.MAPS.map((m) => `<option value="${m}">${m}</option>`).join('');

/* ------------------------------------------------------------------ *
 * Kill logger selection state
 * ------------------------------------------------------------------ */

const sel = { killer: null, assists: new Set() };
let armed = null;   // 'A' | 'B' — winner armed, waiting on a condition

function clearSel() {
  sel.killer = null;
  sel.assists.clear();
  armed = null;
  paintSelection();
}

function paintSelection() {
  $$('.pcard').forEach((c) => {
    c.classList.toggle('killer', c.dataset.pid === sel.killer);
    c.classList.toggle('assist', sel.assists.has(c.dataset.pid));
  });
  $$('.btn.winner').forEach((b) => b.classList.toggle('armed', armed === b.dataset.v));
  $('#condRow').classList.toggle('armed', !!armed);
  $('#killHint').textContent = sel.killer
    ? `KILLER ${nameOf(sel.killer)} — now click the VICTIM (shift-click teammates = assist, Esc cancels)`
    : 'click KILLER → click VICTIM · shift-click teammates for assists · right-click = toggle alive';
}

const nameOf = (pid) => {
  const p = S?.teams[pid[0]]?.players.find((x) => x.id === pid);
  return p ? p.name : pid;
};

function pick(pid, shift) {
  if (!sel.killer) { sel.killer = pid; paintSelection(); return; }
  const sameTeam = pid[0] === sel.killer[0];
  if (pid === sel.killer) { clearSel(); return; }
  if (sameTeam) {
    if (shift) {
      sel.assists.has(pid) ? sel.assists.delete(pid) : sel.assists.add(pid);
      paintSelection();
    } else { sel.killer = pid; sel.assists.clear(); paintSelection(); }
    return;
  }
  send({ type: 'kill', killer: sel.killer, victim: pid, assists: [...sel.assists] });
  clearSel();
}

/* ------------------------------------------------------------------ *
 * LIVE OPS — player cards
 * ------------------------------------------------------------------ */

const KEYCAP = { A: ['1', '2', '3', '4', '5'], B: ['6', '7', '8', '9', '0'] };

function buildOps() {
  for (const t of ['A', 'B']) {
    const col = $(`#ops${t}`);
    col.innerHTML = '';
    for (let i = 0; i < 5; i++) {
      const pid = `${t}${i + 1}`;
      const card = document.createElement('div');
      card.className = 'pcard';
      card.dataset.pid = pid;
      card.innerHTML = `
        <div class="pc-head">
          <span class="pc-key">${KEYCAP[t][i]}</span>
          <div>
            <div class="pc-name">—</div>
            <div class="pc-agent">—</div>
          </div>
          <div class="pc-kda"><b class="k">0</b>/<span class="d">0</span>/<span class="a">0</span></div>
          <span class="pc-alive"></span>
        </div>
        <div class="pc-buy">
          <select class="w-primary" title="Primary weapon">${weaponOptions()}</select>
          <select class="w-secondary" title="Sidearm">${weaponOptions()}</select>
          <select class="w-shield" title="Shield">${shieldOptions()}</select>
          <div class="chg-group" title="Ability charges and ult points">
            <button class="chg" data-slot="c">C</button>
            <button class="chg" data-slot="q">Q</button>
            <button class="chg" data-slot="e">E</button>
            <button class="chg ult" data-slot="x">0/7</button>
          </div>
        </div>`;

      card.querySelector('.pc-head').addEventListener('click', (e) => pick(pid, e.shiftKey));
      card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const p = playerOf(pid);
        if (p.alive) send({ type: 'kill', killer: null, victim: pid });
        else send({ type: 'revive', id: pid });
      });

      card.querySelector('.w-primary').addEventListener('change', (e) =>
        send({ type: 'player.patch', id: pid, patch: { weapons: { primary: e.target.value } } }));
      card.querySelector('.w-secondary').addEventListener('change', (e) =>
        send({ type: 'player.patch', id: pid, patch: { weapons: { secondary: e.target.value } } }));
      card.querySelector('.w-shield').addEventListener('change', (e) =>
        send({ type: 'player.patch', id: pid, patch: { shield: e.target.value } }));

      card.querySelectorAll('.chg').forEach((b) => b.addEventListener('click', () => {
        const p = playerOf(pid);
        const slot = b.dataset.slot;
        if (slot === 'x') {
          send({ type: 'player.patch', id: pid, patch: { ult: { pts: p.ult.pts >= p.ult.max ? 0 : p.ult.pts + 1 } } });
        } else {
          const max = D.teams[t].players[i].maxCharges[slot];
          send({ type: 'player.patch', id: pid, patch: { charges: { [slot]: (p.charges[slot] + 1) % (max + 1) } } });
        }
      }));

      col.appendChild(card);
    }

    const presets = $(`#presets${t}`);
    presets.innerHTML = Object.entries(GD.BUY_PRESETS)
      .map(([k, v]) => `<button class="btn" data-preset="${k}" data-team="${t}">${v.label.toUpperCase()}</button>`).join('');
    presets.querySelectorAll('.btn').forEach((b) => b.addEventListener('click', () =>
      send({ type: 'buy.preset', team: t, preset: b.dataset.preset })));
  }
}

const playerOf = (pid) => S.teams[pid[0]].players.find((p) => p.id === pid);

function paintOps() {
  for (const t of ['A', 'B']) {
    S.teams[t].players.forEach((p, i) => {
      const card = $(`#ops${t}`).children[i];
      const dp = D.teams[t].players[i];
      card.classList.toggle('dead', !p.alive);
      card.querySelector('.pc-name').textContent = p.name;
      card.querySelector('.pc-agent').textContent = p.agent ? AGENT_LABEL(p.agent) : '—';
      card.querySelector('.pc-kda .k').textContent = p.k;
      card.querySelector('.pc-kda .d').textContent = p.d;
      card.querySelector('.pc-kda .a').textContent = p.a;
      setVal(card.querySelector('.w-primary'), p.weapons.primary);
      setVal(card.querySelector('.w-secondary'), p.weapons.secondary);
      setVal(card.querySelector('.w-shield'), p.shield);
      ['c', 'q', 'e'].forEach((slot) => {
        const b = card.querySelector(`.chg[data-slot="${slot}"]`);
        const have = p.charges[slot] || 0;
        b.classList.toggle('on', have > 0);
        b.textContent = have > 0 ? `${slot.toUpperCase()}${have}` : slot.toUpperCase();
      });
      const ub = card.querySelector('.chg.ult');
      ub.textContent = `${p.ult.pts}/${p.ult.max}`;
      ub.classList.toggle('ready', dp.ultReady);
    });
  }
}

function setVal(node, v) {
  if (document.activeElement !== node && node.value !== String(v)) node.value = v;
}

/* ------------------------------------------------------------------ *
 * ROSTERS
 * ------------------------------------------------------------------ */

function buildRoster(t) {
  const card = $(`#teamCard${t}`);
  card.innerHTML = `
    <h3>Team ${t} <span class="hint">${t === 'A' ? 'left side of the overlay' : 'right side of the overlay'}</span></h3>
    <p class="note">Name, tag, colour and logo feed every screen. Agents set here also drive the
      agent-select screen.</p>
    <div class="team-head">
      <div class="logo-drop" data-logo="${t}">LOGO</div>
      <label>Team name<input data-bind="teams.${t}.name" /></label>
      <label>Tag<input data-bind="teams.${t}.tag" maxlength="5" /></label>
      <label>Colour<input type="color" data-bind="teams.${t}.color" /></label>
    </div>
    <div class="row">
      <label style="flex:1">Side<select data-bind="teams.${t}.side"><option value="attack">ATTACK</option><option value="defense">DEFENSE</option></select></label>
      <label style="flex:1">Score (manual)<input type="number" data-bind="teams.${t}.score" data-num="1" /></label>
      <label style="flex:1">Loadout override<input type="number" placeholder="auto" data-bind="teams.${t}.loadoutLock" data-num="1" data-null="1" /></label>
    </div>
    <h3>Players</h3>
    <div class="rplayer rhead"><span></span><span>NAME</span><span>AGENT</span><span>PRIMARY</span><span>SIDEARM</span><span>CREDS (BANK)</span><span>HP</span><span>ULT</span></div>
    <div id="roster${t}"></div>`;

  const box = $(`#roster${t}`, card);
  for (let i = 0; i < 5; i++) {
    const pid = `${t}${i + 1}`;
    const row = document.createElement('div');
    row.className = 'rplayer';
    row.dataset.pid = pid;
    row.innerHTML = `
      <span class="idx">${i + 1}</span>
      <input class="f-name" />
      <select class="f-agent">${agentOptions()}</select>
      <select class="f-primary">${weaponOptions()}</select>
      <select class="f-secondary">${weaponOptions()}</select>
      <input class="f-credits" type="number" />
      <input class="f-hp" type="number" />
      <input class="f-ult" type="number" />`;

    const bind = (cls, fn) => row.querySelector(cls).addEventListener('change', (e) => send(fn(e.target.value)));
    bind('.f-name', (v) => ({ type: 'player.patch', id: pid, patch: { name: v } }));
    bind('.f-agent', (v) => ({ type: 'player.patch', id: pid, patch: { agent: v } }));
    bind('.f-primary', (v) => ({ type: 'player.patch', id: pid, patch: { weapons: { primary: v } } }));
    bind('.f-secondary', (v) => ({ type: 'player.patch', id: pid, patch: { weapons: { secondary: v } } }));
    bind('.f-credits', (v) => ({ type: 'player.patch', id: pid, patch: { credits: +v } }));
    bind('.f-hp', (v) => ({ type: 'player.patch', id: pid, patch: { hp: +v } }));
    bind('.f-ult', (v) => ({ type: 'player.patch', id: pid, patch: { ult: { pts: +v } } }));
    box.appendChild(row);
  }

  $(`.logo-drop[data-logo="${t}"]`, card).addEventListener('click', () => uploadImage('teams', (path) => patchPath(`teams.${t}.logo`, path)));
}

function paintRoster() {
  for (const t of ['A', 'B']) {
    const box = $(`#roster${t}`);
    if (!box) continue;
    S.teams[t].players.forEach((p, i) => {
      const row = box.children[i];
      setVal(row.querySelector('.f-name'), p.name);
      setVal(row.querySelector('.f-agent'), p.agent);
      setVal(row.querySelector('.f-primary'), p.weapons.primary);
      setVal(row.querySelector('.f-secondary'), p.weapons.secondary);
      setVal(row.querySelector('.f-credits'), p.credits);
      setVal(row.querySelector('.f-hp'), p.hp);
      setVal(row.querySelector('.f-ult'), p.ult.pts);
    });
    const drop = $(`.logo-drop[data-logo="${t}"]`);
    if (drop) drop.style.backgroundImage = S.teams[t].logo ? `url("${S.teams[t].logo}")` : '';
  }
}

/* ------------------------------------------------------------------ *
 * MAP VETO
 * ------------------------------------------------------------------ */

const VETO_ACTIONS = { '': '— in pool —', ban: 'BAN', pick: 'PICK', decider: 'DECIDER' };

/** Sends the whole pool back, mirroring how sponsors are edited. */
const setVetoMaps = (maps) => patchPath('veto.maps', maps);

function paintVeto() {
  const list = $('#vetoList');
  const maps = S.veto?.maps || [];

  if (list.dataset.n !== String(maps.length)) {
    list.dataset.n = maps.length;
    list.innerHTML = maps.map((_, i) => `
      <div class="vrow" data-i="${i}">
        <span class="vnum">${i + 1}</span>
        <select class="v-map">${mapOptions()}</select>
        <select class="v-action">${Object.entries(VETO_ACTIONS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
        <select class="v-by"><option value="">—</option><option value="A">Team A</option><option value="B">Team B</option></select>
        <select class="v-def"><option value="">—</option><option value="A">Team A</option><option value="B">Team B</option></select>
        <button class="btn ghost v-rev">HIDDEN</button>
        <button class="btn ghost v-del">✕</button>
      </div>`).join('');

    list.querySelectorAll('.vrow').forEach((row) => {
      const i = +row.dataset.i;
      const edit = (field, val) => send({ type: 'veto.set', index: i, patch: { [field]: val } });
      row.querySelector('.v-map').addEventListener('change', (e) => edit('map', e.target.value));
      row.querySelector('.v-action').addEventListener('change', (e) => edit('action', e.target.value));
      row.querySelector('.v-by').addEventListener('change', (e) => edit('by', e.target.value));
      row.querySelector('.v-def').addEventListener('change', (e) => edit('defense', e.target.value));
      row.querySelector('.v-rev').addEventListener('click', () =>
        send({ type: 'veto.reveal', index: i, revealed: !S.veto.maps[i].revealed }));
      row.querySelector('.v-del').addEventListener('click', () =>
        setVetoMaps(S.veto.maps.filter((_, j) => j !== i)));
    });
  }

  list.querySelectorAll('.vrow').forEach((row) => {
    const m = maps[+row.dataset.i];
    if (!m) return;
    setVal(row.querySelector('.v-map'), m.map || '');
    setVal(row.querySelector('.v-action'), m.action || '');
    setVal(row.querySelector('.v-by'), m.by || '');
    setVal(row.querySelector('.v-def'), m.defense || '');
    const rev = row.querySelector('.v-rev');
    rev.textContent = m.revealed ? 'SHOWN' : 'HIDDEN';
    rev.classList.toggle('on', !!m.revealed);
    // Defence only means something once a map is actually being played.
    row.querySelector('.v-def').disabled = m.action === 'ban' || !m.action;
    row.dataset.action = m.action || '';
  });

  $$('[data-act="vetoShow"], [data-act="vetoHide"]').forEach((b) =>
    b.classList.toggle('on', (b.dataset.act === 'vetoShow') === !!S.veto?.on));
}

const blankVetoMap = (map) => ({ map, action: '', by: '', defense: '', revealed: false });

/* ------------------------------------------------------------------ *
 * Broadcast screens (agent select / timeout band)
 * ------------------------------------------------------------------ */

function paintScreens() {
  const ap = S.screens?.agentPick || {};
  const bd = S.screens?.banner || {};
  const team = S.teams[ap.team] || S.teams.A;
  const revealed = Array.isArray(ap.revealed) ? ap.revealed : [];

  // Line-up: agent picker + per-player reveal, without leaving this tab.
  const list = $('#apList');
  if (list) {
    if (list.dataset.team !== ap.team) {
      list.dataset.team = ap.team;
      list.innerHTML = team.players.map((_, i) => `
        <div class="arow" data-i="${i}">
          <span class="aname"></span>
          <select class="a-agent">${agentOptions()}</select>
          <button class="btn ghost a-rev">HIDDEN</button>
        </div>`).join('');
      list.querySelectorAll('.arow').forEach((row) => {
        const i = +row.dataset.i;
        row.querySelector('.a-agent').addEventListener('change', (e) =>
          send({ type: 'player.patch', id: `${list.dataset.team}${i + 1}`, patch: { agent: e.target.value } }));
        row.querySelector('.a-rev').addEventListener('click', () =>
          send({ type: 'agentPick.reveal', index: i, revealed: !(S.screens.agentPick.revealed || [])[i] }));
      });
    }
    list.querySelectorAll('.arow').forEach((row) => {
      const i = +row.dataset.i;
      const p = team.players[i];
      row.querySelector('.aname').textContent = p.name;
      setVal(row.querySelector('.a-agent'), p.agent || '');
      const rev = row.querySelector('.a-rev');
      rev.textContent = revealed[i] ? 'SHOWN' : 'HIDDEN';
      rev.classList.toggle('on', !!revealed[i]);
    });
  }

  // Spotlight buttons follow whichever team's line-up is on screen.
  const row = $('#apFocusRow');
  if (row) {
    const html = ['<button class="btn ghost" data-act="apFocus" data-v="-1">NONE</button>']
      .concat(team.players.map((p, i) => `<button class="btn" data-act="apFocus" data-v="${i}">${escapeHtml(p.name)}</button>`)).join('');
    if (row.dataset.h !== html) { row.dataset.h = html; row.innerHTML = html; }
    row.querySelectorAll('[data-act="apFocus"]').forEach((b) => {
      const i = Number(b.dataset.v);
      b.classList.toggle('on', i === (ap.focus ?? -1));
      // Spotlighting a card that isn't on screen yet does nothing, so say so.
      b.disabled = i >= 0 && !revealed[i];
    });
  }

  const mark = (sel, test) => $$(sel).forEach((b) => b.classList.toggle('on', test(b.dataset.v)));
  mark('[data-act="apTeam"]', (v) => v === ap.team);
  mark('[data-act="bandKind"]', (v) => v === bd.kind);
  mark('[data-act="bandTeam"]', (v) => v === bd.team);
  $$('[data-act="apShow"], [data-act="apHide"]').forEach((b) =>
    b.classList.toggle('on', (b.dataset.act === 'apShow') === !!ap.on));
  $$('[data-act="bandShow"], [data-act="bandHide"]').forEach((b) =>
    b.classList.toggle('on', (b.dataset.act === 'bandShow') === !!bd.on));
}

/* ------------------------------------------------------------------ *
 * Generic data-bind fields
 * ------------------------------------------------------------------ */

function initBindings() {
  $$('[data-maps]').forEach((s) => { s.innerHTML = mapOptions(); });
  $$('[data-bind]').forEach((node) => {
    node.addEventListener('change', () => {
      let v = node.type === 'checkbox' ? node.checked : node.value;
      if (node.dataset.num) v = v === '' && node.dataset.null ? null : Number(v);
      patchPath(node.dataset.bind, v);
    });
  });
}

const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

function paintBindings() {
  $$('[data-bind]').forEach((node) => {
    if (document.activeElement === node) return;
    const v = getPath(S, node.dataset.bind);
    if (node.type === 'checkbox') node.checked = !!v;
    else node.value = v == null ? '' : v;
  });
}

/* ------------------------------------------------------------------ *
 * Overlay toggles / URLs / assets
 * ------------------------------------------------------------------ */

/** Grouped so an operator can find a switch mid-round without reading them all. */
const TOGGLE_GROUPS = [
  ['MAJOR BLOCKS', {
    scorebar: 'Scorebar', buyBoard: 'Buy board', playerRails: 'Player rails',
    seriesStrip: 'Map strip', sponsors: 'Sponsors',
  }],
  ['TOP BAR / CLOCK', {
    timer: 'Timer', roundLabel: 'Round number', phaseLabel: 'Phase label',
    seriesBadge: 'Series score (BOx)', teamLogos: 'Team logos',
    sides: 'ATK / DEF', spike: 'Spike banner',
  }],
  ['PLAYER DATA — BOTH MODES', {
    agentPortraits: 'Agent portraits', kda: 'K / D / A', abilities: 'Abilities',
    ults: 'Ult points', creds: 'Credits', weapons: 'Weapons', shields: 'Shields',
  }],
  ['BUY BOARD', {
    ladder: 'Round ladder', statChips: 'Stat chips',
    economy: 'Loadout value', mapName: 'Map name',
  }],
  ['IN-PLAY', { hpBars: 'Health bars' }],
  ['ROUND END', { roundPopup: 'Round-win popup' }],
];

/** Position nudges. Step is 10px normally, 1px with Shift for fine work. */
const LAYOUT_ROWS = [
  ['railsY', 'Player rails', 'up / down'],
  ['railsX', 'Player rails', 'inset from edges'],
  ['buyY', 'Buy board', 'up / down'],
  ['barY', 'Scorebar', 'up / down'],
  ['stripY', 'Map strip', 'up / down'],
  ['sponsorY', 'Sponsor', 'up / down'],
];

function buildLayout() {
  const box = $('#layoutRows');
  if (!box) return;
  box.innerHTML = `<div class="lrow lhead"><span>ELEMENT</span><span>AXIS</span><span></span><span>PX</span><span></span></div>` +
    LAYOUT_ROWS.map(([key, label, axis]) => `
      <div class="lrow" data-k="${key}">
        <span class="lname">${label}</span>
        <span class="laxis">${axis}</span>
        <button class="btn ghost l-dec" title="Shift-click for 1px">−</button>
        <input class="l-val" type="number" step="1" />
        <button class="btn ghost l-inc" title="Shift-click for 1px">+</button>
      </div>`).join('');

  box.querySelectorAll('.lrow[data-k]').forEach((row) => {
    const key = row.dataset.k;
    const nudge = (dir, e) => {
      const step = e.shiftKey ? 1 : 10;
      patchPath(`overlay.layout.${key}`, (S.overlay.layout?.[key] || 0) + dir * step);
    };
    row.querySelector('.l-dec').addEventListener('click', (e) => nudge(-1, e));
    row.querySelector('.l-inc').addEventListener('click', (e) => nudge(1, e));
    row.querySelector('.l-val').addEventListener('change', (e) =>
      patchPath(`overlay.layout.${key}`, Number(e.target.value) || 0));
  });
}

function paintLayout() {
  const L = S.overlay.layout || {};
  $$('#layoutRows .lrow[data-k]').forEach((row) => {
    setVal(row.querySelector('.l-val'), L[row.dataset.k] || 0);
  });
}

function buildToggles() {
  const box = $('#toggles');
  box.innerHTML = TOGGLE_GROUPS.map(([title, items]) => `
    <div class="tgroup">
      <h4>${title}</h4>
      <div class="tgrid">${Object.entries(items)
        .map(([k, label]) => `<div class="toggle" data-toggle="${k}"><i></i>${label}</div>`).join('')}</div>
    </div>`).join('');
  box.querySelectorAll('.toggle').forEach((el) => el.addEventListener('click', () =>
    patchPath(`overlay.show.${el.dataset.toggle}`, !S.overlay.show[el.dataset.toggle])));
}

function paintToggles() {
  $$('#toggles .toggle').forEach((el) => el.classList.toggle('on', !!S.overlay.show[el.dataset.toggle]));
  $$('[data-act="mode"]').forEach((b) => b.classList.toggle('on', S.overlay.mode === b.dataset.v));
}

function buildUrls() {
  const base = location.origin;
  const rows = [
    ['Full overlay (use this one)', `${base}/overlay`],
    ['Buy board only', `${base}/overlay?mode=buy&bare=1`],
    ['In-play only', `${base}/overlay?mode=live`],
    ['Green screen test', `${base}/overlay?chroma=1`],
  ];
  $('#urls').innerHTML = rows.map(([label, url]) =>
    `<div class="urlrow"><input readonly value="${url}" title="${label}" /><button class="btn ghost" data-copy="${url}">COPY</button></div>`).join('');
  $$('#urls [data-copy]').forEach((b) => b.addEventListener('click', () => {
    navigator.clipboard.writeText(b.dataset.copy); toast('URL COPIED');
  }));
}

/**
 * Ult points and ability costs aren't published by Riot, so any agent added
 * to the game after this build shipped carries placeholder numbers. Say so
 * loudly — a wrong ult meter is the kind of thing viewers notice.
 */
function paintEstimatedWarning() {
  const box = $('#estimatedWarn');
  if (!box) return;
  const guessed = Object.entries(GD.AGENTS).filter(([, a]) => a.estimated).map(([k, a]) => (a.label || k).toUpperCase());
  box.innerHTML = guessed.length ? `
    <h3>⚠ UNVERIFIED AGENT DATA</h3>
    <p class="note">No hand-checked ult-point or ability-cost values for
      <b style="color:var(--gold)">${guessed.join(', ')}</b> — they're using placeholders
      (ult 7, abilities 200). Riot doesn't publish these, so correct them in
      <code>data/gamedata.json</code> and restart before you broadcast a match with them.</p>` : '';
}

async function paintAssets() {
  const list = await fetch('/api/assets').then((r) => r.json()).catch(() => ({}));
  const all = Object.values(list).flat();
  $('#assetList').innerHTML = all.length
    ? all.map((f) => `<img src="${f}" title="${f}" />`).join('')
    : '<span class="note">No assets uploaded yet.</span>';
}

/* ---- image upload helper ---- */
function uploadImage(kind, onDone) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = () => {
    const file = input.files[0];
    if (!file) return;
    const fr = new FileReader();
    fr.onload = async () => {
      const r = await fetch('/api/upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, name: file.name, dataUrl: fr.result }),
      }).then((x) => x.json());
      if (r.ok) { onDone(r.path); toast('IMAGE UPLOADED'); paintAssets(); }
      else toast(r.error || 'UPLOAD FAILED');
    };
    fr.readAsDataURL(file);
  };
  input.click();
}

/* ------------------------------------------------------------------ *
 * Sponsors
 * ------------------------------------------------------------------ */

function paintSponsors() {
  const box = $('#sponsorList');
  const list = S.broadcast.sponsors || [];
  if (box.dataset.n !== String(list.length)) {
    box.dataset.n = list.length;
    box.innerHTML = list.map((_, i) => `
      <div class="sponsor-row" data-i="${i}">
        <div class="thumb"></div>
        <input class="sp-name" placeholder="Sponsor name (used if no logo)" />
        <label class="chk"><input type="checkbox" class="sp-on" /> on</label>
        <button class="btn ghost sp-del">✕</button>
      </div>`).join('');

    box.querySelectorAll('.sponsor-row').forEach((row) => {
      const i = +row.dataset.i;
      row.querySelector('.sp-name').addEventListener('change', (e) => updateSponsor(i, { name: e.target.value }));
      row.querySelector('.sp-on').addEventListener('change', (e) => updateSponsor(i, { enabled: e.target.checked }));
      row.querySelector('.thumb').addEventListener('click', () => uploadImage('sponsors', (p) => updateSponsor(i, { logo: p })));
      row.querySelector('.sp-del').addEventListener('click', () => {
        const next = S.broadcast.sponsors.filter((_, j) => j !== i);
        patchPath('broadcast.sponsors', next);
      });
    });
  }
  box.querySelectorAll('.sponsor-row').forEach((row) => {
    const sp = list[+row.dataset.i] || {};
    setVal(row.querySelector('.sp-name'), sp.name || '');
    row.querySelector('.sp-on').checked = !!sp.enabled;
    row.querySelector('.thumb').style.backgroundImage = sp.logo ? `url("${sp.logo}")` : '';
  });
}

function updateSponsor(i, patch) {
  const next = (S.broadcast.sponsors || []).map((sp, j) => (j === i ? { ...sp, ...patch } : sp));
  patchPath('broadcast.sponsors', next);
}

/* ------------------------------------------------------------------ *
 * Feed + derived readout
 * ------------------------------------------------------------------ */

function paintFeed() {
  $('#log').innerHTML = (S.log || []).slice(0, 40).map((e) =>
    `<div class="log-item" data-k="${e.kind}"><span class="r">R${e.round}</span><span>${escapeHtml(e.text)}${
      e.by && e.by !== ME ? `<i class="by">${escapeHtml(e.by)}</i>` : ''}</span></div>`).join('');

  const rows = [
    ['Alive', `${D.teams.A.alive} v ${D.teams.B.alive}`],
    ['Loadout', `${num(D.teams.A.loadout)} / ${num(D.teams.B.loadout)}`],
    ['Team credits', `${num(D.teams.A.credits)} / ${num(D.teams.B.credits)}`],
    ['Loss streak', `${S.teams.A.lossStreak} / ${S.teams.B.lossStreak}`],
    ['Clutch watch', ['A', 'B'].map((t) => {
      const c = S.round.clutch?.[t];
      return c ? `${nameOf(c.playerId)} 1v${c.vs}` : null;
    }).filter(Boolean).join(' · ') || '—'],
    ['Thrifty / Clutch', `${S.teams.A.stats.thrifties}·${S.teams.A.stats.clutches} / ${S.teams.B.stats.thrifties}·${S.teams.B.stats.clutches}`],
  ];
  $('#derivedBox').innerHTML = rows.map(([k, v]) => `<div class="dstat"><span>${k}</span><b>${v}</b></div>`).join('');
}

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ------------------------------------------------------------------ *
 * Header
 * ------------------------------------------------------------------ */

function paintHeader() {
  $('#hTagA').textContent = S.teams.A.tag;
  $('#hTagB').textContent = S.teams.B.tag;
  $('#hScoreA').textContent = S.teams.A.score;
  $('#hScoreB').textContent = S.teams.B.score;
  $('#hRound').textContent = `R${S.round.number}`;
  const ph = $('#hPhase');
  ph.textContent = S.clock.phase.toUpperCase();
  ph.dataset.p = S.clock.phase;
  $('#undoCount').textContent = UNDO;
  $('#btnClock').textContent = S.clock.running ? '❚❚ PAUSE' : '▶ START';
  $$('[data-act="phase"]').forEach((b) => b.classList.toggle('on', S.clock.phase === b.dataset.v));
  document.documentElement.style.setProperty('--tA', S.teams.A.color);
  document.documentElement.style.setProperty('--tB', S.teams.B.color);
}

function tick() {
  if (!S) return;
  const c = S.clock;
  const ms = c.running ? Math.max(0, c.endsAt - Date.now()) : c.remainingMs;
  const s = Math.ceil(ms / 1000);
  $('#hTimer').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
setInterval(tick, 100);

/* ------------------------------------------------------------------ *
 * Actions wiring
 * ------------------------------------------------------------------ */

function endRound(condition) {
  if (!armed) { toast('ARM A WINNER FIRST'); return; }
  send({ type: 'round.end', winner: armed, condition });
  armed = null;
  paintSelection();
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const { act, v } = btn.dataset;

  switch (act) {
    case 'phase': send({ type: 'clock.phase', phase: v }); break;
    case 'time':
      if (v === 'reset') {
        const ms = S.clock.phase === 'buy' ? GD.RULES.buyPhaseMs : GD.RULES.roundMs;
        send({ type: 'clock.set', ms });
      } else {
        const cur = S.clock.running ? Math.max(0, S.clock.endsAt - Date.now()) : S.clock.remainingMs;
        send({ type: 'clock.set', ms: Math.max(0, cur + Number(v) * 1000) });
      }
      break;
    case 'spike':
      send({ type: v === 'plant' ? 'spike.plant' : v === 'defuse' ? 'spike.defuse' : 'spike.clear' });
      break;
    case 'arm': armed = armed === v ? null : v; paintSelection(); break;
    case 'end': endRound(v); break;
    case 'next': send({ type: 'round.next' }); clearSel(); break;
    case 'undoRound': send({ type: 'round.undo' }); break;
    case 'swapSides': send({ type: 'team.swapSides' }); break;
    case 'swapAll': send({ type: 'team.swapAll' }); break;
    case 'mode': patchPath('overlay.mode', v); break;
    case 'layoutReset':
      patchPath('overlay.layout', { railsY: 0, railsX: 0, buyY: 0, barY: 0, stripY: 0, sponsorY: 0 });
      toast('POSITIONS RESET');
      break;
    case 'testPopup':
      // Fires the popup with the live scoreline without touching the match.
      patchPath('roundResult', {
        at: Date.now(), round: S.round.number, winner: 'A', condition: 'elim',
        score: { A: S.teams.A.score, B: S.teams.B.score },
        badges: ['TEST'], detail: '',
      });
      toast('POPUP FIRED');
      break;
    /* --- broadcast screens --- */
    case 'apShow': patchPath('screens.agentPick.on', true); break;
    case 'apHide': patchPath('screens.agentPick.on', false); break;
    case 'apTeam': patchPath('screens.agentPick.team', v); break;
    case 'apFocus': patchPath('screens.agentPick.focus', Number(v)); break;
    case 'apRevealNext': send({ type: 'agentPick.reveal', mode: 'next' }); break;
    case 'apRevealAll': send({ type: 'agentPick.reveal', mode: 'all' }); break;
    case 'apRevealNone': send({ type: 'agentPick.reveal', mode: 'none' }); break;
    case 'bandKind': patchPath('screens.banner.kind', v); break;
    case 'bandTeam': patchPath('screens.banner.team', v); break;
    case 'bandShow': patchPath('screens.banner.on', true); break;
    case 'bandHide': patchPath('screens.banner.on', false); break;

    case 'vetoShow': patchPath('veto.on', true); break;
    case 'vetoHide': patchPath('veto.on', false); break;
    case 'revealNext': send({ type: 'veto.reveal', mode: 'next' }); break;
    case 'revealAll': send({ type: 'veto.reveal', mode: 'all' }); break;
    case 'revealNone': send({ type: 'veto.reveal', mode: 'none' }); break;
    case 'vetoAdd':
      setVetoMaps([...(S.veto.maps || []), blankVetoMap(GD.MAPS[0] || '')]);
      break;
    case 'vetoPreset': {
      const n = Number(v);
      setVetoMaps(GD.MAPS.slice(0, n).map(blankVetoMap));
      toast(`POOL SET TO ${n} MAPS`);
      break;
    }
    case 'vetoClear':
      if (confirm('Clear the whole map pool?')) setVetoMaps([]);
      break;
    case 'addSponsor':
      patchPath('broadcast.sponsors', [...(S.broadcast.sponsors || []), { name: 'NEW SPONSOR', logo: '', enabled: true }]);
      break;
    case 'newMap':
      if (confirm('Start a new map? Score and stats reset, rosters are kept.')) send({ type: 'match.newMap' });
      break;
    case 'resetMatch':
      if (confirm('FULL RESET — wipes teams, rosters and stats. Continue?')) send({ type: 'match.reset' });
      break;
    case 'export': {
      const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `hsc-${S.teams.A.tag}-vs-${S.teams.B.tag}-${S.maps.current}.json`;
      a.click();
      break;
    }
  }
});

$('#btnClock').addEventListener('click', () => send({ type: 'clock.toggle' }));
$('#btnUndo').addEventListener('click', () => send({ type: 'undo' }));

$('#importFile').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const fr = new FileReader();
  fr.onload = () => {
    try { send({ type: 'match.import', state: JSON.parse(fr.result) }); toast('MATCH IMPORTED'); }
    catch { toast('BAD JSON'); }
  };
  fr.readAsText(f);
});

$$('.tab').forEach((t) => t.addEventListener('click', () => {
  $$('.tab').forEach((x) => x.classList.toggle('on', x === t));
  $$('.panel').forEach((p) => p.classList.toggle('on', p.dataset.panel === t.dataset.tab));
  if (t.dataset.tab === 'overlay') paintAssets();
}));

/* ---- hotkeys ---- */
addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (e.ctrlKey && e.key.toLowerCase() === 'z') { e.preventDefault(); send({ type: 'undo' }); return; }
  if (e.ctrlKey || e.altKey || e.metaKey) return;

  const k = e.key.toLowerCase();
  const idxA = KEYCAP.A.indexOf(e.key);
  const idxB = KEYCAP.B.indexOf(e.key);
  if (idxA >= 0) { e.preventDefault(); pick(`A${idxA + 1}`, e.shiftKey); return; }
  if (idxB >= 0) { e.preventDefault(); pick(`B${idxB + 1}`, e.shiftKey); return; }

  const map = {
    ' ': () => send({ type: 'clock.toggle' }),
    b: () => send({ type: 'clock.phase', phase: 'buy' }),
    l: () => send({ type: 'clock.phase', phase: 'live' }),
    p: () => send({ type: 'clock.phase', phase: 'post' }),
    s: () => send({ type: 'spike.plant' }),
    d: () => send({ type: 'spike.defuse' }),
    n: () => { send({ type: 'round.next' }); clearSel(); },
    z: () => send({ type: 'undo' }),
    a: () => { armed = armed === 'A' ? null : 'A'; paintSelection(); },
    ';': () => { armed = armed === 'B' ? null : 'B'; paintSelection(); },
    e: () => endRound('elim'),
    k: () => endRound('spike'),
    f: () => endRound('defuse'),
    t: () => endRound('time'),
    escape: () => clearSel(),
  };
  const fn = map[k === 'escape' ? 'escape' : k];
  if (fn) { e.preventDefault(); fn(); }
});

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

function renderAll() {
  paintHeader();
  paintOps();
  paintRoster();
  paintBindings();
  paintToggles();
  paintLayout();
  paintSponsors();
  paintVeto();
  paintScreens();
  paintFeed();
  paintSelection();
  tick();
}

/** Shows who else is on the desk, so two operators don't duplicate work. */
function paintPresence(operators) {
  const box = $('#who');
  if (!box) return;
  const others = (operators || []).filter((n) => n && n !== ME);
  box.innerHTML = ME
    ? `<b>${escapeHtml(ME)}</b>${others.length ? ` +${others.length}` : ''}`
    : '';
  box.title = (operators || []).length
    ? `Signed in: ${(operators || []).join(', ')}`
    : 'No other operators connected';
}

let ME = '';

/**
 * Lufga is a commercial font, so it can't ship here. Drop the woff2 files into
 * assets/fonts/ and this picks them up automatically; until then the stack
 * falls back to Century Gothic, which is the closest geometric sans that
 * ships with Windows. Probed rather than declared so a missing font doesn't
 * spray 404s through the console on every load.
 */
async function loadBrandFont() {
  try {
    const probe = await fetch('/assets/fonts/Lufga-Regular.woff2', { method: 'HEAD' });
    if (!probe.ok) return;
    const weights = [['Regular', 400], ['Medium', 500], ['SemiBold', 600], ['Bold', 700]];
    const css = weights.map(([file, weight]) => `
      @font-face {
        font-family: 'Lufga';
        src: url('/assets/fonts/Lufga-${file}.woff2') format('woff2');
        font-weight: ${weight}; font-style: normal; font-display: swap;
      }`).join('');
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  } catch { /* no brand font available — the fallback stack is fine */ }
}

/**
 * Light by default, matching the design system. Broadcast desks are often dark
 * rooms, so the choice is remembered per machine.
 */
function initTheme() {
  const apply = (mode) => {
    document.body.classList.toggle('dark', mode === 'dark');
    const btn = $('#btnTheme');
    if (btn) btn.textContent = mode === 'dark' ? '☀' : '◐';
  };
  apply(localStorage.getItem('hsc-theme') || 'light');
  $('#btnTheme')?.addEventListener('click', () => {
    const next = document.body.classList.contains('dark') ? 'light' : 'dark';
    localStorage.setItem('hsc-theme', next);
    apply(next);
  });
}

(async function boot() {
  initTheme();
  loadBrandFont();
  const me = await fetch('/api/me').then((r) => r.json()).catch(() => ({}));
  ME = me.name || '';
  if (me.authRequired) {
    const out = $('#btnLogout');
    out.hidden = false;
    out.addEventListener('click', async () => {
      await fetch('/api/logout');
      location.href = '/login';
    });
  }

  GD = await fetch('/api/gamedata').then((r) => r.json());
  buildOps();
  buildRoster('A');
  buildRoster('B');
  buildToggles();
  buildLayout();
  buildUrls();
  initBindings();
  paintAssets();
  paintEstimatedWarning();

  // `as=panel` marks this connection as an operator for the presence list.
  const es = new EventSource('/api/stream?as=panel');
  es.onopen = () => { $('#conn').textContent = 'live'; $('#conn').className = 'conn ok'; };
  es.onerror = () => { $('#conn').textContent = 'disconnected'; $('#conn').className = 'conn bad'; };
  es.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    S = msg.state; D = msg.derived; UNDO = msg.undo;
    paintPresence(msg.operators);
    renderAll();
  };
})();
