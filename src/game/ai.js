// Enemy archetypes, steering, and the adaptation model.
//
// Adaptation is rule-based online learning, not machine learning: the game
// keeps an exponentially decaying profile of how the player fights, and the
// enemy population's parameters ("genes") are blended towards counters for
// whatever the player relies on most.

export const TYPES = {
  chaser: { hp: 3, spd: 78, r: 10, col: '#c0504d', dmg: 8, score: 10, name: 'Chaser' },
  flanker: { hp: 2, spd: 98, r: 9, col: '#e0b04a', dmg: 7, score: 12, name: 'Flanker' },
  spitter: { hp: 2.2, spd: 60, r: 9, col: '#8b5fbf', dmg: 7, score: 15, name: 'Spitter' },
  brute: { hp: 7, spd: 50, r: 14, col: '#5a6b4a', dmg: 16, score: 30, name: 'Brute' },
};

export const GENES_DEF = { spd: 1, flank: 0.15, lead: 0, dodge: 0, armor: 0, range: 190, retreat: 0 };
export const WEIGHTS_DEF = { chaser: 1, flanker: 0.3, spitter: 0.15, brute: 0.05 };
export const PROFILE_HALF_LIFE = 45; // seconds
export const BEHAVIOURS = ['melee', 'ranged', 'kite', 'camp', 'build'];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const COUNTER_MESSAGES = {
  kite: 'You keep your distance. Flankers now lead their targets and cut you off.',
  camp: 'You hole up by the fire. Spitters outrange you and brutes go for your flames.',
  melee: 'You trade blows. Enemies grow armoured and strike, then withdraw.',
  ranged: 'Your stones are a habit. Enemies now watch for them and sidestep.',
  build: 'You wall yourself in. Brutes now come to tear the walls down.',
};

export class Adaptation {
  constructor() {
    this.profile = { melee: 0, ranged: 0, kite: 0, camp: 0, build: 0 };
    this.genes = { ...GENES_DEF };
    this.weights = { ...WEIGHTS_DEF };
    this.history = [];
  }

  observe(kind, amount) {
    this.profile[kind] += amount;
  }

  decay(dt) {
    const k = Math.pow(0.5, dt / PROFILE_HALF_LIFE);
    for (const b of BEHAVIOURS) this.profile[b] *= k;
  }

  shares() {
    let tot = 0.001;
    for (const b of BEHAVIOURS) tot += this.profile[b];
    const s = { tot };
    for (const b of BEHAVIOURS) s[b] = this.profile[b] / tot;
    return s;
  }

  dominant() {
    const s = this.shares();
    let best = null;
    for (const b of BEHAVIOURS) if (!best || s[b] > s[best]) best = b;
    return { behaviour: best, share: s[best], total: s.tot };
  }

  /**
   * Move genes towards the counter-strategy for the current profile. A small
   * step happens every 15 s; a bigger one at each new day, which is also
   * announced. Returns the log message, if any.
   */
  adapt(day, announce) {
    const s = this.shares();
    if (s.tot < 4) return announce ? `Day ${day}: They are still studying you.` : null;
    const k = announce ? 0.5 : 0.25;
    const ease = (c, t) => c + (t - c) * k;
    const G = this.genes;
    G.flank = ease(G.flank, clamp(0.15 + s.kite * 1.6, 0, 1));
    G.lead = ease(G.lead, clamp(s.kite * 1.8, 0, 1));
    G.spd = ease(G.spd, clamp(1 + s.kite * 0.35 + day * 0.012, 1, 1.4));
    G.range = ease(G.range, clamp(190 + s.camp * 140, 190, 330));
    G.armor = ease(G.armor, clamp(s.melee * 0.9, 0, 0.9));
    G.retreat = ease(G.retreat, clamp(s.melee * 1.6, 0, 1));
    G.dodge = ease(G.dodge, clamp(s.ranged * 1.8, 0, 0.85));
    const w = this.weights;
    w.flanker = ease(w.flanker, 0.25 + s.kite * 3);
    w.spitter = ease(w.spitter, 0.15 + s.camp * 2.6 + s.ranged * 0.4);
    w.brute = ease(w.brute, 0.05 + s.melee * 1.4 + s.camp * 1.3 + s.build * 2.2);
    w.chaser = 1;
    if (!announce) return null;
    const top = this.dominant();
    this.history.push({ day, shares: { ...s }, genes: { ...G } });
    if (top.share > 0.28) return `Day ${day}: ${COUNTER_MESSAGES[top.behaviour]}`;
    return `Day ${day}: Your tactics are mixed. They are still studying you.`;
  }

  pickType(rand) {
    let tot = 0;
    for (const k in this.weights) tot += this.weights[k];
    let r = rand() * tot;
    for (const k in this.weights) {
      r -= this.weights[k];
      if (r <= 0) return k;
    }
    return 'chaser';
  }
}

// Reactive dodge: an enemy that sees a player stone about to hit it may sidestep.
function tryDodge(game, e) {
  if (e.dodgeCd > 0 || e.dodge <= 0.01) return;
  for (const p of game.projs) {
    if (p.from !== 'p') continue;
    const rx = e.x - p.x;
    const ry = e.y - p.y;
    const dist = Math.hypot(rx, ry);
    if (dist > 160) continue;
    const v = Math.hypot(p.vx, p.vy) || 1;
    const along = (rx * p.vx + ry * p.vy) / v;
    if (along <= 0) continue; // moving away
    const miss = Math.abs(rx * p.vy - ry * p.vx) / v;
    if (miss > e.r + 12) continue;
    if (game.rand() < e.dodge) {
      // step perpendicular to the stone, towards the side we are already on
      const side = rx * p.vy - ry * p.vx > 0 ? 1 : -1;
      e.dodgeDir = { x: (p.vy / v) * side, y: (-p.vx / v) * side };
      e.dodgeT = 0.3;
      e.dodgeCd = 0.9;
      game.stats.dodges++;
    } else e.dodgeCd = 0.4;
    return;
  }
}

export function updateEnemy(game, e, dt) {
  const P = game.player;
  const G = game.ai.genes;
  const world = game.world;
  const dx = P.x - e.x;
  const dy = P.y - e.y;
  const d = Math.hypot(dx, dy) || 1;
  const nx = dx / d;
  const ny = dy / d;
  e.cd -= dt;
  e.flash -= dt;
  e.ret -= dt;
  e.dodgeT -= dt;
  e.dodgeCd -= dt;
  e.losT -= dt;
  if (e.losT <= 0) {
    e.los = world.lineOfSight(e.x, e.y, P.x, P.y);
    e.losT = 0.15 + game.rand() * 0.1;
  }
  let tx = nx;
  let ty = ny;
  let sp = e.spd;
  let state = 'chase';
  const fire = game.nearestFire(e.x, e.y, 400);
  const retreating = G.retreat > 0.3 && e.ret > 0;

  if (e.type === 'chaser') {
    const w = Math.sin(game.time * 4 + e.ph) * e.dodge * 0.9; // weave when they expect stones
    tx = nx - ny * w;
    ty = ny + nx * w;
  } else if (e.type === 'flanker') {
    // Predict where the player is heading, approach from the side, then commit.
    const lead = 0.35 + G.lead * 1.1;
    const px = P.x + P.vx * lead;
    const py = P.y + P.vy * lead;
    const qx = px - e.x;
    const qy = py - e.y;
    const qd = Math.hypot(qx, qy) || 1;
    if (qd > 150) {
      const ang = Math.atan2(qy, qx) + e.side * e.flank * 1.25 * Math.min(1, (qd - 150) / 200);
      tx = Math.cos(ang);
      ty = Math.sin(ang);
      state = 'flank';
    } else {
      tx = qx / qd;
      ty = qy / qd;
      state = 'commit';
    }
  } else if (e.type === 'spitter') {
    const R = e.range;
    if (d < R - 35) ((tx = -nx), (ty = -ny), (state = 'backoff'));
    else if (d > R + 35) ((tx = nx), (ty = ny));
    else {
      tx = -ny * e.side;
      ty = nx * e.side;
      sp *= 0.6;
      state = 'siege';
    }
    if (e.cd <= 0 && d < R + 90 && e.los) {
      e.cd = 2.3;
      const lead = (G.lead * 0.6 * d) / 230;
      const a = Math.atan2(P.y + P.vy * lead - e.y, P.x + P.vx * lead - e.x);
      game.projs.push({ x: e.x, y: e.y, vx: Math.cos(a) * 235, vy: Math.sin(a) * 235, dmg: 7, from: 'e', life: 2.2, r: 5 });
      game.emit('spit', { x: e.x, y: e.y });
    }
  } else if (e.type === 'brute') {
    // Brutes go for whatever shelters the player: a nearby fire first.
    if (fire && Math.hypot(fire.x - P.x, fire.y - P.y) < 260) {
      const fx = fire.x - e.x;
      const fy = fire.y - e.y;
      const fd = Math.hypot(fx, fy) || 1;
      tx = fx / fd;
      ty = fy / fd;
      state = 'raid fire';
      if (fd < e.r + 16 && e.cd <= 0) {
        e.cd = 0.7;
        fire.fuel -= 7;
        game.fx(fire.x, fire.y, '#ffb347', 6);
        game.emit('fireHit', { x: fire.x, y: fire.y });
      }
    }
  }

  if (retreating) {
    tx = -nx;
    ty = -ny;
    sp *= 0.9;
    state = 'withdraw';
  } else if (!e.los && state !== 'raid fire') {
    // No line of sight: follow the flow field around obstacles.
    const f = game.flow.direction(e.x, e.y);
    if (f) {
      tx = f.x;
      ty = f.y;
      state = 'path';
    }
  }

  // Fear of fire (brutes are not afraid).
  if (e.type !== 'brute' && fire) {
    const fx = e.x - fire.x;
    const fy = e.y - fire.y;
    const fd = Math.hypot(fx, fy) || 1;
    if (fd < 95) {
      tx += (fx / fd) * 2.2;
      ty += (fy / fd) * 2.2;
    }
  }

  tryDodge(game, e);
  if (e.dodgeT > 0) {
    tx = e.dodgeDir.x;
    ty = e.dodgeDir.y;
    sp *= 1.6;
    state = 'dodge';
  }

  // Unstick: if barely moved for a while, wander briefly.
  e.stuck += dt;
  if (e.stuck > 0.8) {
    if (Math.hypot(e.x - e.lx, e.y - e.ly) < 10 && d > 40) {
      e.wander = 0.7;
      e.wa = game.rand() * Math.PI * 2;
    }
    e.lx = e.x;
    e.ly = e.y;
    e.stuck = 0;
  }
  if (e.wander > 0) {
    e.wander -= dt;
    tx = Math.cos(e.wa);
    ty = Math.sin(e.wa);
  }

  const tl = Math.hypot(tx, ty) || 1;
  tx /= tl;
  ty /= tl;
  const hit = world.move(e, tx * sp * dt, ty * sp * dt);
  if (hit && e.type === 'brute') {
    const wx = Math.floor((e.x + tx * (e.r + 6)) / 32);
    const wy = Math.floor((e.y + ty * (e.r + 6)) / 32);
    const key = `${wx},${wy}`;
    const w = world.walls.get(key);
    if (w && e.cd <= 0) {
      e.cd = 0.6;
      w.hp -= 2;
      state = 'smash';
      game.fx(wx * 32 + 16, wy * 32 + 16, '#b9824a', 5);
      game.emit('wallHit', {});
      if (w.hp <= 0) game.destroyWall(key);
    }
  }

  const reach = e.r + P.r + 5;
  if (d < reach && e.cd <= 0 && e.type !== 'spitter') {
    e.cd = e.type === 'brute' ? 1.1 : 0.8;
    game.hurtPlayer(TYPES[e.type].dmg, e.type);
    e.ret = G.retreat > 0.3 ? 0.9 : 0;
  }
  e.state = state;
}
