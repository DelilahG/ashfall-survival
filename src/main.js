import './styles.css';
import {
  BrickWall,
  Brain,
  Crosshair,
  Drumstick,
  Flame,
  Hand,
  Moon,
  Mountain,
  Pause,
  Play,
  Sun,
  Sword,
  Swords,
  TreePine,
  Volume2,
  VolumeX,
  createElement,
  createIcons,
} from 'lucide';
import { Sfx } from './audio.js';
import { BEHAVIOURS, COUNTER_MESSAGES, TYPES } from './game/ai.js';
import { Game } from './game/game.js';
import { Renderer } from './render.js';

const ICONS = { BrickWall, Brain, Crosshair, Drumstick, Flame, Hand, Moon, Mountain, Pause, Play, Sun, Sword, Swords, TreePine, Volume2, VolumeX };
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pct = (v) => `${Math.round(v * 100)}%`;
const icon = (Ic) => createElement(Ic);

let game = null;
let renderer;
let state = 'start'; // start | playing | paused | over
const sfx = new Sfx();
const keys = {};
const mouse = { x: innerWidth / 2, y: innerHeight / 2, l: false, r: false, seen: false };
const touch = { active: false, mx: 0, my: 0, attack: false, id: null };
let touchMode = false;

/* ---------------- best score ---------------- */

function loadBest() {
  try {
    return JSON.parse(localStorage.getItem('ashfall.best') || 'null');
  } catch {
    return null;
  }
}
function saveBest(rec) {
  try {
    localStorage.setItem('ashfall.best', JSON.stringify(rec));
  } catch {
    /* storage unavailable */
  }
}
function showBestOnStart() {
  const b = loadBest();
  $('bestStart').textContent = b ? `Best: ${b.score} points · ${fmtTime(b.time)} survived · ${b.kills} kills` : '';
}

/* ---------------- game state ---------------- */

function seedFromUrl() {
  const s = new URLSearchParams(location.search).get('seed');
  return s && /^-?\d+$/.test(s) ? Number(s) : undefined;
}

function newGame(seed = seedFromUrl()) {
  game = new Game(seed === undefined ? {} : { seed });
  renderer.snapCamera(game);
  renderLog();
}

function setState(s) {
  state = s;
  $('start').classList.toggle('hide', s !== 'start');
  $('paused').classList.toggle('hide', s !== 'paused');
  $('over').classList.toggle('hide', s !== 'over');
  const pb = $('pbtn');
  pb.replaceChildren(icon(s === 'paused' ? Play : Pause));
  pb.setAttribute('aria-label', s === 'paused' ? 'Resume' : 'Pause');
  if (s === 'paused') {
    $('pauseInfo').textContent = `Day ${game.day} · ${fmtTime(game.time)} survived · score ${game.score}`;
    $('resume').focus();
  }
  document.body.dataset.state = s;
}

function begin() {
  sfx.unlock();
  newGame();
  setState('playing');
}

function togglePause() {
  if (state === 'playing') setState('paused');
  else if (state === 'paused') setState('playing');
}

function gameOver() {
  const g = game;
  const best = loadBest();
  const rec = { score: g.score, time: g.time, kills: g.kills, day: g.day };
  const isBest = !best || rec.score > best.score;
  if (isBest) saveBest(rec);
  const causes = {
    starvation: 'You starved.',
    cold: 'The cold night took you.',
    chaser: 'A chaser ran you down.',
    flanker: 'A flanker cut you off.',
    spitter: 'A spitter wore you down from range.',
    brute: 'A brute crushed you.',
  };
  $('osum').innerHTML = `${causes[g.cause] || 'You fell.'} You lasted <b>${fmtTime(g.time)}</b> (day ${g.day}) and scored <b>${g.score}</b>${
    isBest ? ', a new best' : best ? `. Best: ${best.score}` : ''
  }.`;
  const kb = Object.entries(g.stats.killsBy)
    .filter(([, n]) => n)
    .map(([t, n]) => `${n} ${TYPES[t].name.toLowerCase()}${n > 1 ? 's' : ''}`)
    .join(', ');
  const acc = g.stats.stones ? ` · ${g.stats.stones} stones thrown` : '';
  $('ostats').innerHTML = `
    <tr><td>Kills</td><td>${g.kills}${kb ? ` (${kb})` : ''}</td></tr>
    <tr><td>Damage</td><td>${g.stats.damageDealt.toFixed(0)} dealt · ${g.stats.damageTaken.toFixed(0)} taken</td></tr>
    <tr><td>Gathered</td><td>${g.stats.wood} wood · ${g.stats.stoneGathered} stone · ${g.stats.food} food</td></tr>
    <tr><td>Built</td><td>${g.stats.fires} fires · ${g.stats.walls} walls · ${g.stats.spears} spears${acc}</td></tr>
    <tr><td>Enemy dodges</td><td>${g.stats.dodges}</td></tr>`;
  const s = g.ai.shares();
  const learned = g.ai.history.length
    ? g.ai.history.slice(-3).map((h) => {
        const top = BEHAVIOURS.reduce((a, b) => (h.shares[b] > h.shares[a] ? b : a));
        return `<div>Day ${h.day}: ${h.shares[top] > 0.28 ? COUNTER_MESSAGES[top] : 'They were still studying you.'}</div>`;
      })
    : [];
  $('olearn').innerHTML =
    `<div>You were seen fighting up close ${pct(s.melee)}, throwing ${pct(s.ranged)}, kiting ${pct(s.kite)}, camping ${pct(s.camp)} and building ${pct(s.build)} of the time.</div>` +
    learned.join('');
  setState('over');
}

const fmtTime = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/* ---------------- input ---------------- */

function aimPoint() {
  if (touchMode) {
    const P = game.player;
    const e = game.nearestEnemy(P.x, P.y, 320);
    return e ? { x: e.x, y: e.y } : null; // null: face movement direction
  }
  return renderer.screenToWorld(mouse.x, mouse.y);
}

function readInput() {
  if (touchMode) {
    return { mx: touch.mx, my: touch.my, sprint: Math.hypot(touch.mx, touch.my) > 0.92, attack: touch.attack, aim: aimPoint() };
  }
  const mx = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  const my = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0);
  return { mx, my, sprint: keys.ShiftLeft || keys.ShiftRight, attack: mouse.l, throw: mouse.r, aim: aimPoint() };
}

function act(name) {
  if (state !== 'playing') return;
  if (name === 'harvest') game.harvest();
  else if (name === 'eat') game.eat();
  else if (name === 'throw') {
    const a = aimPoint();
    if (a) game.player.face = Math.atan2(a.y - game.player.y, a.x - game.player.x);
    game.throwStone();
  } else if (name === 'fire' || name === 'spear') game.craft(name);
  else if (name === 'wall') game.craft('wall', touchMode ? null : aimPoint());
}

function setSound(muted) {
  sfx.setMuted(muted);
  $('soundBtn').replaceChildren(icon(muted ? VolumeX : Volume2));
  $('soundBtn').setAttribute('aria-pressed', String(!muted));
}

function wireInput() {
  addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (e.code === 'KeyM') setSound(!sfx.muted);
    if (state === 'start' && (e.code === 'Enter' || e.code === 'Space')) return begin();
    if (e.code === 'KeyP' || e.code === 'Escape') return togglePause();
    if (state !== 'playing') return;
    if (e.code === 'KeyE') act('harvest');
    if (e.code === 'KeyQ') act('eat');
    if (e.code === 'Digit1') act('fire');
    if (e.code === 'Digit2') act('spear');
    if (e.code === 'Digit3') act('wall');
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  });
  addEventListener('keyup', (e) => (keys[e.code] = false));
  addEventListener('blur', () => {
    for (const k in keys) keys[k] = false;
    mouse.l = mouse.r = false;
    if (state === 'playing') setState('paused');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state === 'playing') setState('paused');
  });
  const cv = $('cv');
  cv.addEventListener('mousemove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.seen = true;
  });
  cv.addEventListener('mousedown', (e) => {
    if (e.button === 0) mouse.l = true;
    if (e.button === 2) mouse.r = true;
  });
  addEventListener('mouseup', (e) => {
    if (e.button === 0) mouse.l = false;
    if (e.button === 2) mouse.r = false;
  });
  cv.addEventListener('contextmenu', (e) => e.preventDefault());

  $('go').addEventListener('click', begin);
  $('again').addEventListener('click', begin);
  $('resume').addEventListener('click', () => setState('playing'));
  $('restart').addEventListener('click', begin);
  $('pbtn').addEventListener('click', togglePause);
  $('soundBtn').addEventListener('click', () => {
    sfx.unlock();
    setSound(!sfx.muted);
  });
  $('intelBtn').addEventListener('click', () => $('tr').classList.toggle('open'));

  // Touch: a virtual stick on the left and action buttons on the right.
  const enableTouch = () => {
    if (touchMode) return;
    touchMode = true;
    $('touch').hidden = false;
    document.body.classList.add('touchmode');
  };
  addEventListener('touchstart', enableTouch, { passive: true, once: true });
  if (matchMedia('(pointer: coarse)').matches) enableTouch();

  const stick = $('stick');
  const knob = $('knob');
  const moveStick = (t) => {
    const r = stick.getBoundingClientRect();
    let dx = (t.clientX - (r.left + r.width / 2)) / (r.width / 2);
    let dy = (t.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const l = Math.hypot(dx, dy);
    if (l > 1) ((dx /= l), (dy /= l));
    touch.mx = dx;
    touch.my = dy;
    knob.style.transform = `translate(${dx * 38}px, ${dy * 38}px)`;
  };
  stick.addEventListener('pointerdown', (e) => {
    touch.id = e.pointerId;
    try {
      stick.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already gone; moves still arrive while the finger is on the stick */
    }
    moveStick(e);
  });
  stick.addEventListener('pointermove', (e) => e.pointerId === touch.id && moveStick(e));
  const release = (e) => {
    if (e.pointerId !== touch.id) return;
    touch.id = null;
    touch.mx = touch.my = 0;
    knob.style.transform = '';
  };
  stick.addEventListener('pointerup', release);
  stick.addEventListener('pointercancel', release);
  for (const b of document.querySelectorAll('.tbtns button')) {
    const a = b.dataset.act;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      sfx.unlock();
      b.classList.add('on');
      if (a === 'attack') touch.attack = true;
      else act(a);
    });
    const up = () => {
      b.classList.remove('on');
      if (a === 'attack') touch.attack = false;
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointerleave', up);
    b.addEventListener('pointercancel', up);
  }
}

/* ---------------- HUD ---------------- */

const PROFILE_ROWS = [
  ['melee', 'Close combat', '#d9453b'],
  ['ranged', 'Throwing', '#9aa3ad'],
  ['kite', 'Kiting', '#e8a33d'],
  ['camp', 'Camping', '#6fd0c8'],
  ['build', 'Building', '#b9824a'],
];
const GENE_ROWS = [
  ['flank', 'Flanking', '#e0b04a', (v) => v],
  ['lead', 'Intercept aim', '#e0b04a', (v) => v],
  ['armor', 'Armour', '#5a6b4a', (v) => v / 0.9],
  ['retreat', 'Hit and run', '#6fd0c8', (v) => v],
  ['dodge', 'Dodging', '#c0504d', (v) => v / 0.85],
  ['spd', 'Speed', '#c0504d', (v) => (v - 1) / 0.4],
  ['range', 'Siege range', '#8b5fbf', (v) => (v - 190) / 140],
];

function buildHud() {
  const row = (prefix, [k, name, col]) =>
    `<div class="pr"><span>${name}</span><div class="bar"><i id="${prefix}_${k}" style="background:${col};width:0"></i></div><em id="${prefix}v_${k}">0%</em></div>`;
  $('prof').innerHTML = PROFILE_ROWS.map((r) => row('p', r)).join('');
  $('genes').innerHTML = GENE_ROWS.map((r) => row('g', r)).join('');
}

function renderLog() {
  $('log').innerHTML = game.log.map((l) => `<div>${l}</div>`).join('');
}

let lastTod = '';
function hud() {
  const g = game;
  const P = g.player;
  $('hpb').style.width = `${clamp(P.hp, 0, 100)}%`;
  $('hpv').textContent = Math.ceil(Math.max(0, P.hp));
  $('fb').style.width = `${clamp(P.food, 0, 100)}%`;
  $('fv').textContent = Math.ceil(P.food);
  $('iw').textContent = P.wood;
  $('is').textContent = P.stone;
  $('ifd').textContent = P.rations;
  $('spv').textContent = P.spear > 0 ? `Spear · ${P.spear} uses` : 'Club';
  $('day').textContent = g.day;
  const tod = g.timeOfDay();
  $('tod').textContent = tod;
  if (tod !== lastTod) {
    $('todIcon').replaceChildren(icon(tod === 'night' ? Moon : Sun));
    lastTod = tod;
  }
  $('kills').textContent = g.kills;
  $('foes').textContent = g.enemies.length;
  $('score').textContent = g.score;
  const s = g.ai.shares();
  for (const [k] of PROFILE_ROWS) {
    const v = s.tot < 2 ? 0 : s[k];
    $(`p_${k}`).style.width = pct(v);
    $(`pv_${k}`).textContent = pct(v);
  }
  for (const [k, , , f] of GENE_ROWS) {
    const v = clamp(f(g.ai.genes[k]), 0, 1);
    $(`g_${k}`).style.width = pct(v);
    $(`gv_${k}`).textContent = pct(v);
  }
}

/* ---------------- loop ---------------- */

let last = performance.now();
let hudT = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  try {
    if (state === 'playing') game.update(dt, readInput());
    for (const ev of game.drainEvents()) {
      if (ev.type === 'log') renderLog();
      else sfx.play(ev.type);
      if (ev.type === 'death') gameOver();
    }
    renderer.render(game, { cursor: touchMode || !mouse.seen ? null : renderer.screenToWorld(mouse.x, mouse.y), showGhost: state === 'playing' });
    hudT += dt;
    if (hudT > 0.1 || state !== 'playing') {
      hudT = 0;
      hud();
    }
  } catch (err) {
    console.error(err);
    $('errMsg').textContent = `Something went wrong: ${err.message}. Reload the page to start again.`;
    $('err').classList.remove('hide');
    return;
  }
  requestAnimationFrame(frame);
}

function init() {
  createIcons({ icons: ICONS });
  try {
    renderer = new Renderer($('cv'));
  } catch (err) {
    $('errMsg').textContent = err.message;
    $('err').classList.remove('hide');
    return;
  }
  addEventListener('resize', () => renderer.resize());
  buildHud();
  newGame(); // idle world behind the start screen
  wireInput();
  setSound(sfx.muted);
  showBestOnStart();
  setState('start');
  // Hook for automated browser tests.
  window.__ashfall = {
    get game() {
      return game;
    },
    get state() {
      return state;
    },
    begin,
    newGame: (seed) => {
      newGame(seed);
      setState('playing');
    },
  };
  requestAnimationFrame(frame);
}

init();
