import { Adaptation, TYPES, updateEnemy } from './ai.js';
import { FlowField, T, TS, WALL_HP, World, createRng } from './world.js';

export const DAY = 100; // seconds per day/night cycle
export const COSTS = {
  fire: { wood: 5 },
  spear: { wood: 3, stone: 2 },
  wall: { wood: 3 },
};
export const SPEAR_USES = 30;
export const MAX_FIRE_FUEL = 120;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Game {
  constructor({ seed = (Math.random() * 1e9) | 0 } = {}) {
    this.seed = seed | 0;
    this.rand = createRng(this.seed ^ 0x9e3779b9);
    this.world = new World(this.seed);
    this.flow = new FlowField(this.world);
    this.ai = new Adaptation();
    this.player = {
      x: 0.5 * TS,
      y: 0.5 * TS,
      r: 9,
      hp: 100,
      food: 100,
      wood: 0,
      stone: 0,
      rations: 1,
      cd: 0,
      tcd: 0,
      hcd: 0,
      spear: 0,
      vx: 0,
      vy: 0,
      face: 0,
      inv: 0,
    };
    this.enemies = [];
    this.projs = [];
    this.fires = [];
    this.parts = [];
    this.swings = [];
    this.time = 0;
    this.day = 1;
    this.kills = 0;
    this.killScore = 0;
    this.spawnT = 6;
    this.adaptT = 20;
    this.wallsVersion = 0;
    this.wasNight = false;
    this.over = false;
    this.cause = null;
    this.shake = 0;
    this.flash = { msg: '', t: 0 };
    this.log = [];
    this.events = [];
    this.nextId = 1;
    this.stats = {
      swings: 0,
      stones: 0,
      hits: 0,
      damageDealt: 0,
      damageTaken: 0,
      wood: 0,
      stoneGathered: 0,
      food: 0,
      fires: 0,
      walls: 0,
      spears: 0,
      dodges: 0,
      killsBy: { chaser: 0, flanker: 0, spitter: 0, brute: 0 },
    };
    this.addLog('You wake in a quiet meadow. Dawn.');
  }

  /* ---------------- events & messages ---------------- */

  emit(type, data = {}) {
    this.events.push({ type, ...data });
    if (this.events.length > 200) this.events.shift();
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  addLog(msg) {
    this.log.unshift(msg);
    if (this.log.length > 6) this.log.pop();
    this.emit('log', { msg });
  }

  notify(msg) {
    this.flash = { msg, t: 1.4 };
  }

  // Cosmetic particles use Math.random so they never disturb the seeded game logic.
  fx(x, y, c, n = 6, sp = 60) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = Math.random() * sp;
      this.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5 + Math.random() * 0.3, c });
    }
    if (this.parts.length > 600) this.parts.splice(0, this.parts.length - 600);
  }

  /* ---------------- queries ---------------- */

  get score() {
    return Math.floor(this.time) + this.killScore;
  }

  nightFactor() {
    const p = (this.time / DAY) % 1;
    return clamp(0.5 - 0.9 * Math.sin(2 * Math.PI * (p + 0.1)), 0, 1);
  }

  timeOfDay() {
    const nf = this.nightFactor();
    const p = (this.time / DAY) % 1;
    if (nf > 0.7) return 'night';
    if (nf > 0.25) return p < 0.65 ? 'dusk' : 'dawn'; // darkest point is at 65% of the cycle
    return 'daylight';
  }

  nearestFire(x, y, maxd) {
    let best = null;
    let bd = maxd;
    for (const f of this.fires) {
      const d = Math.hypot(f.x - x, f.y - y);
      if (d < bd) ((bd = d), (best = f));
    }
    return best;
  }

  nearestEnemy(x, y, maxd = Infinity) {
    let best = null;
    let bd = maxd;
    for (const e of this.enemies) {
      const d = Math.hypot(e.x - x, e.y - y);
      if (d < bd) ((bd = d), (best = e));
    }
    return best;
  }

  spawnCap() {
    return 5 + this.day * 2 + Math.round(this.nightFactor() * 5);
  }

  /* ---------------- player actions ---------------- */

  attack() {
    const P = this.player;
    if (P.cd > 0 || this.over) return false;
    const spear = P.spear > 0;
    P.cd = spear ? 0.36 : 0.46;
    const reach = spear ? 66 : 48;
    const dmg = spear ? 2 : 1;
    let near = false;
    this.swings.push({ x: P.x, y: P.y, a: P.face, reach, t: 0 });
    this.stats.swings++;
    let hits = 0;
    for (const e of [...this.enemies]) {
      const d = Math.hypot(e.x - P.x, e.y - P.y);
      if (d < 150) near = true;
      if (d > reach + e.r) continue;
      let da = Math.atan2(e.y - P.y, e.x - P.x) - P.face;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      if (Math.abs(da) > 1.1) continue;
      this.hurtEnemy(e, dmg, P.face);
      hits++;
    }
    if (spear) {
      P.spear--;
      if (P.spear === 0) this.notify('Your spear broke');
    }
    if (near) this.ai.observe('melee', 1.2);
    this.emit('swing', { hit: hits > 0 });
    return true;
  }

  throwStone() {
    const P = this.player;
    if (P.tcd > 0 || this.over) return false;
    if (P.stone < 1) {
      P.tcd = 0.4;
      this.notify('No stones. Harvest rocks with E');
      return false;
    }
    P.stone--;
    P.tcd = 0.55;
    const a = P.face;
    this.projs.push({ x: P.x, y: P.y, vx: Math.cos(a) * 440, vy: Math.sin(a) * 440, dmg: 1.6, from: 'p', life: 1.1, r: 4 });
    this.ai.observe('ranged', 1.5);
    this.stats.stones++;
    this.emit('throw');
    return true;
  }

  // Harvest the nearest tree / rock / bush, or feed a nearby fire.
  harvest() {
    const P = this.player;
    if (P.hcd > 0 || this.over) return null;
    for (const f of this.fires) {
      if (Math.hypot(f.x - P.x, f.y - P.y) < 50 && P.wood >= 2 && f.fuel < MAX_FIRE_FUEL - 5) {
        P.wood -= 2;
        f.fuel = Math.min(MAX_FIRE_FUEL, f.fuel + 35);
        P.hcd = 0.3;
        this.fx(f.x, f.y, '#ffb347', 8);
        this.emit('feed');
        return 'fire';
      }
    }
    const tx = Math.floor(P.x / TS);
    const ty = Math.floor(P.y / TS);
    let best = null;
    let bd = 60;
    for (let y = ty - 2; y <= ty + 2; y++) {
      for (let x = tx - 2; x <= tx + 2; x++) {
        const t = this.world.tileAt(x, y);
        if (t !== T.TREE && t !== T.ROCK && t !== T.BUSH) continue;
        const d = Math.hypot(x * TS + 16 - P.x, y * TS + 16 - P.y);
        if (d < bd) ((bd = d), (best = { x, y, t }));
      }
    }
    if (!best) {
      P.hcd = 0.2;
      this.notify('Nothing to harvest here');
      return null;
    }
    P.hcd = 0.3;
    this.world.remove(best.x, best.y);
    this.wallsVersion++; // passability changed
    const cx = best.x * TS + 16;
    const cy = best.y * TS + 16;
    let kind;
    if (best.t === T.TREE) {
      const n = 2 + (this.rand() < 0.5 ? 1 : 0);
      P.wood += n;
      this.stats.wood += n;
      this.fx(cx, cy, '#7a5230', 8);
      kind = 'wood';
    } else if (best.t === T.ROCK) {
      P.stone += 2;
      this.stats.stoneGathered += 2;
      this.fx(cx, cy, '#aab', 8);
      kind = 'stone';
    } else {
      P.rations += 2;
      this.stats.food += 2;
      this.fx(cx, cy, '#c33', 8);
      kind = 'food';
    }
    this.emit('harvest', { kind });
    return kind;
  }

  eat() {
    const P = this.player;
    if (this.over) return false;
    if (P.rations <= 0) {
      this.notify('No food. Pick berries from bushes');
      return false;
    }
    if (P.food >= 100) {
      this.notify('Not hungry');
      return false;
    }
    P.rations--;
    P.food = Math.min(100, P.food + 28);
    this.fx(P.x, P.y, '#8fbf4a', 6);
    this.emit('eat');
    return true;
  }

  canAfford(kind) {
    const c = COSTS[kind];
    return (c.wood || 0) <= this.player.wood && (c.stone || 0) <= this.player.stone;
  }

  pay(kind) {
    const c = COSTS[kind];
    this.player.wood -= c.wood || 0;
    this.player.stone -= c.stone || 0;
  }

  // aim: world-space point used for wall placement
  craft(kind, aim) {
    const P = this.player;
    if (this.over) return false;
    const fail = (m) => (this.notify(m), false);
    if (!COSTS[kind]) return false;
    if (!this.canAfford(kind)) {
      const c = COSTS[kind];
      return fail(`Need ${c.wood} wood${c.stone ? ` + ${c.stone} stone` : ''}`);
    }
    if (kind === 'fire') {
      const x = P.x + Math.cos(P.face) * 30;
      const y = P.y + Math.sin(P.face) * 30;
      if (this.world.blockedAt(x, y, 8)) return fail("Can't light a fire there");
      this.pay(kind);
      this.fires.push({ x, y, fuel: 70, t: 0 });
      this.stats.fires++;
      this.addLog('Campfire lit.');
    } else if (kind === 'spear') {
      this.pay(kind);
      P.spear = SPEAR_USES;
      this.stats.spears++;
      this.addLog(`Spear crafted (${SPEAR_USES} uses).`);
    } else if (kind === 'wall') {
      const a = aim || { x: P.x + Math.cos(P.face) * 48, y: P.y + Math.sin(P.face) * 48 };
      if (Math.hypot(a.x - P.x, a.y - P.y) > 150) return fail('Too far away');
      const x = Math.floor(a.x / TS);
      const y = Math.floor(a.y / TS);
      if (this.world.solid(x, y) || this.world.tileAt(x, y) === T.WATER) return fail("Can't build there");
      // never build on top of the player or an enemy
      const occupied = (e) => e.x + e.r > x * TS && e.x - e.r < (x + 1) * TS && e.y + e.r > y * TS && e.y - e.r < (y + 1) * TS;
      if (occupied(P) || this.enemies.some(occupied)) return fail("Can't build there");
      this.pay(kind);
      this.world.walls.set(`${x},${y}`, { hp: WALL_HP });
      this.wallsVersion++;
      this.ai.observe('build', 2);
      this.stats.walls++;
      this.fx(x * TS + 16, y * TS + 16, '#b9824a', 6);
    }
    this.emit('craft', { kind });
    return true;
  }

  destroyWall(key) {
    this.world.walls.delete(key);
    this.wallsVersion++;
    this.emit('wallBreak');
  }

  /* ---------------- damage ---------------- */

  hurtEnemy(e, dmg, ang) {
    const dealt = Math.min(dmg, e.hp);
    e.hp -= dmg;
    e.flash = 0.15;
    this.stats.hits++;
    this.stats.damageDealt += dealt;
    const kb = e.type === 'brute' ? 60 : 140;
    this.world.move(e, Math.cos(ang) * kb * 0.1, Math.sin(ang) * kb * 0.1);
    this.fx(e.x, e.y, '#d44', 5);
    this.emit('hit');
    if (e.hp <= 0) {
      const i = this.enemies.indexOf(e);
      if (i >= 0) this.enemies.splice(i, 1);
      this.kills++;
      this.stats.killsBy[e.type]++;
      this.killScore += TYPES[e.type].score;
      this.fx(e.x, e.y, e.col, 14, 90);
      if (this.rand() < 0.4) this.player.rations++;
      this.emit('kill', { type: e.type });
    }
  }

  hurtPlayer(d, source) {
    const P = this.player;
    if (P.inv > 0 || this.over) return;
    P.hp -= d;
    P.inv = 0.25;
    this.stats.damageTaken += d;
    this.shake = 6;
    this.fx(P.x, P.y, '#e44', 6);
    this.emit('hurt');
    if (P.hp <= 0) this.die(source);
  }

  die(cause) {
    if (this.over) return;
    this.player.hp = 0;
    this.over = true;
    this.cause = cause;
    this.emit('death', { cause });
  }

  /* ---------------- spawning ---------------- */

  spawnEnemy(type = this.ai.pickType(this.rand)) {
    const T0 = TYPES[type];
    const G = this.ai.genes;
    const P = this.player;
    for (let i = 0; i < 14; i++) {
      const a = this.rand() * Math.PI * 2;
      const d = 430 + this.rand() * 120;
      const x = P.x + Math.cos(a) * d;
      const y = P.y + Math.sin(a) * d;
      if (this.world.blockedAt(x, y, T0.r + 2)) continue;
      const jitter = () => 1 + (this.rand() - 0.5) * 0.2;
      const hp = T0.hp * (1 + G.armor) * (1 + 0.06 * (this.day - 1));
      const e = {
        id: this.nextId++,
        type,
        x,
        y,
        r: T0.r,
        hp,
        maxhp: hp,
        col: T0.col,
        spd: T0.spd * G.spd * jitter(),
        side: this.rand() < 0.5 ? -1 : 1,
        ph: this.rand() * Math.PI * 2,
        cd: 0,
        flash: 0,
        ret: 0,
        stuck: 0,
        lx: x,
        ly: y,
        wander: 0,
        wa: 0,
        los: true,
        losT: 0,
        dodgeT: 0,
        dodgeCd: 0,
        dodgeDir: { x: 0, y: 0 },
        state: 'chase',
        flank: clamp(G.flank + (this.rand() - 0.5) * 0.2, 0, 1),
        dodge: clamp(G.dodge + (this.rand() - 0.5) * 0.2, 0, 1),
        range: G.range + (this.rand() - 0.5) * 30,
      };
      this.enemies.push(e);
      return e;
    }
    return null;
  }

  /* ---------------- main update ---------------- */

  /**
   * input: { mx, my } movement in [-1, 1], sprint, attack, throw (held buttons),
   * aim: world point the player faces.
   */
  update(dt, input = {}) {
    if (this.over) return;
    const P = this.player;
    this.time += dt;
    this.world.time = this.time;
    const nf = this.nightFactor();
    const day = Math.floor(this.time / DAY) + 1;
    if (day !== this.day) {
      this.day = day;
      const msg = this.ai.adapt(day, true);
      if (msg) this.addLog(msg);
      this.emit('newDay', { day });
    }
    const night = nf > 0.6;
    if (night && !this.wasNight) {
      this.addLog('Night falls. Stay near the light.');
      this.emit('nightfall');
    }
    this.wasNight = night;

    // movement
    let ix = input.mx || 0;
    let iy = input.my || 0;
    const il = Math.hypot(ix, iy);
    if (il > 1) ((ix /= il), (iy /= il));
    const moving = il > 0.1;
    const sprint = !!input.sprint && moving;
    const speed = sprint ? 175 : 118;
    const ox = P.x;
    const oy = P.y;
    this.world.move(P, ix * speed * dt, iy * speed * dt);
    P.vx = (P.x - ox) / dt;
    P.vy = (P.y - oy) / dt;
    if (input.aim) P.face = Math.atan2(input.aim.y - P.y, input.aim.x - P.x);
    else if (moving) P.face = Math.atan2(iy, ix);
    P.cd -= dt;
    P.tcd -= dt;
    P.hcd -= dt;
    P.inv -= dt;
    if (input.attack) this.attack();
    if (input.throw) this.throwStone();

    // needs
    P.food -= dt * (sprint ? 0.55 : 0.3);
    if (P.food <= 0) {
      P.food = 0;
      P.hp -= dt * 2.5;
      if (P.hp <= 0) return this.die('starvation');
    }
    const nearFire = this.nearestFire(P.x, P.y, 140);
    if (P.food > 35) P.hp = Math.min(100, P.hp + dt * (nearFire ? 3.2 : 0.9));
    if (night && !nearFire) {
      P.hp -= dt * 0.35;
      if (P.hp <= 0) return this.die('cold');
    }

    // behaviour profile
    const ne = this.nearestEnemy(P.x, P.y);
    const nd = ne ? Math.hypot(ne.x - P.x, ne.y - P.y) : Infinity;
    const spd = Math.hypot(P.vx, P.vy);
    if (ne && nd < 240 && nd > 70 && spd > 70) {
      const dot = ((P.x - ne.x) * P.vx + (P.y - ne.y) * P.vy) / (nd * spd);
      if (dot > 0.45) this.ai.observe('kite', dt * 1.6); // moving away from a nearby enemy
    }
    if (nearFire && spd < 40) this.ai.observe('camp', dt * (ne && nd < 350 ? 1.6 : 0.6));
    else if (spd < 12 && ne && nd < 350) this.ai.observe('camp', dt * 0.5);
    this.ai.decay(dt);
    this.adaptT -= dt;
    if (this.adaptT <= 0) {
      this.adaptT = 15;
      this.ai.adapt(this.day, false);
    }

    // spawning: faster at night, more over the days
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = Math.max(1.4, (7 - this.day * 0.4) / (1 + nf * 2.2));
      if (this.enemies.length < this.spawnCap()) this.spawnEnemy();
    }

    this.flow.update(P.x, P.y, dt, this.wallsVersion);
    for (const e of [...this.enemies]) {
      updateEnemy(this, e, dt);
      if (this.over) return;
    }
    // separation
    const es = this.enemies;
    for (let i = 0; i < es.length; i++) {
      for (let j = i + 1; j < es.length; j++) {
        const a = es[i];
        const b = es[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        const m = a.r + b.r;
        if (d > 0 && d < m) {
          const p = (m - d) / 2 / d;
          this.world.move(a, -dx * p, -dy * p);
          this.world.move(b, dx * p, dy * p);
        }
      }
    }
    for (let i = es.length - 1; i >= 0; i--) if (Math.hypot(es[i].x - P.x, es[i].y - P.y) > 900) es.splice(i, 1);

    // fires
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.fuel -= dt;
      f.t += dt;
      if (f.fuel <= 0) {
        this.fx(f.x, f.y, '#555', 8);
        this.fires.splice(i, 1);
        this.addLog('A fire burned out.');
      }
    }

    // projectiles
    for (let i = this.projs.length - 1; i >= 0; i--) {
      const p = this.projs[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      let dead = p.life <= 0;
      const tx = Math.floor(p.x / TS);
      const ty = Math.floor(p.y / TS);
      const key = `${tx},${ty}`;
      const t = this.world.tileAt(tx, ty);
      if (this.world.walls.has(key)) {
        if (p.from === 'e') {
          const w = this.world.walls.get(key);
          w.hp -= 1;
          if (w.hp <= 0) this.destroyWall(key);
        }
        dead = true;
      } else if (t === T.TREE || t === T.ROCK) dead = true;
      if (!dead && p.from === 'p') {
        for (const e of this.enemies) {
          if (Math.hypot(e.x - p.x, e.y - p.y) < e.r + p.r) {
            this.hurtEnemy(e, p.dmg, Math.atan2(p.vy, p.vx));
            dead = true;
            break;
          }
        }
      }
      if (!dead && p.from === 'e') {
        if (Math.hypot(P.x - p.x, P.y - p.y) < P.r + p.r) {
          this.hurtPlayer(p.dmg, 'spitter');
          dead = true;
        }
        for (const f of this.fires) {
          if (Math.hypot(f.x - p.x, f.y - p.y) < 14) {
            f.fuel -= 5;
            dead = true;
          }
        }
      }
      if (dead) {
        this.fx(p.x, p.y, p.from === 'e' ? '#a6f' : '#ccc', 4, 40);
        this.projs.splice(i, 1);
      }
      if (this.over) return;
    }

    for (let i = this.parts.length - 1; i >= 0; i--) {
      const q = this.parts[i];
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.life -= dt;
      if (q.life <= 0) this.parts.splice(i, 1);
    }
    for (let i = this.swings.length - 1; i >= 0; i--) {
      this.swings[i].t += dt;
      if (this.swings[i].t > 0.16) this.swings.splice(i, 1);
    }
    this.shake = Math.max(0, this.shake - dt * 30);
    this.flash.t -= dt;
  }
}
