// Procedural, infinite tile world. Terrain is derived from seeded value noise,
// so only player modifications (harvested tiles, walls) need storing.

export const TS = 32; // tile size in px
export const T = { WATER: 0, SAND: 1, GRASS: 2, TREE: 3, ROCK: 4, BUSH: 5 };
export const BUSH_REGROW = 120; // seconds before a picked bush fruits again
export const WALL_HP = 8;

export function createRng(seed) {
  let s = seed >>> 0;
  return function next() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class World {
  constructor(seed) {
    this.seed = seed | 0;
    this.cache = new Map();
    this.removed = new Map(); // "x,y" -> game time when harvested
    this.walls = new Map(); // "x,y" -> { hp }
    this.time = 0;
  }

  hash(x, y, s = 0) {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + this.seed + Math.imul(s, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  vnoise(x, y, s) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = this.hash(xi, yi, s);
    const b = this.hash(xi + 1, yi, s);
    const c = this.hash(xi, yi + 1, s);
    const d = this.hash(xi + 1, yi + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  fbm(x, y, s) {
    let t = 0;
    let a = 0.5;
    let f = 1;
    for (let i = 0; i < 4; i++) {
      t += a * this.vnoise(x * f, y * f, s + i);
      a *= 0.5;
      f *= 2;
    }
    return t / 0.9375;
  }

  generate(x, y) {
    const d = Math.hypot(x, y);
    let h = this.fbm(x * 0.06, y * 0.06, 1);
    if (d < 16) h += (1 - d / 16) * 0.3; // guarantee land around spawn
    const m = this.fbm(x * 0.09, y * 0.09, 7);
    const r = this.hash(x, y, 3);
    if (h < 0.37) return T.WATER;
    if (h < 0.42) return T.SAND;
    if (d < 4) return d > 2.5 && r < 0.18 ? T.BUSH : T.GRASS; // a few berries near spawn
    if (m > 0.55 && r < 0.6) return T.TREE;
    if (this.fbm(x * 0.14, y * 0.14, 11) > 0.62 && r < 0.7) return T.ROCK;
    if (r < 0.03) return T.BUSH;
    return T.GRASS;
  }

  baseTile(x, y) {
    const k = `${x},${y}`;
    let t = this.cache.get(k);
    if (t === undefined) {
      if (this.cache.size > 60000) this.cache.clear();
      t = this.generate(x, y);
      this.cache.set(k, t);
    }
    return t;
  }

  tileAt(x, y) {
    const t = this.baseTile(x, y);
    if (t === T.TREE || t === T.ROCK || t === T.BUSH) {
      const when = this.removed.get(`${x},${y}`);
      if (when !== undefined) {
        if (t === T.BUSH && this.time - when >= BUSH_REGROW) this.removed.delete(`${x},${y}`);
        else return T.GRASS;
      }
    }
    return t;
  }

  remove(x, y) {
    this.removed.set(`${x},${y}`, this.time);
  }

  solid(x, y) {
    const t = this.tileAt(x, y);
    return t === T.WATER || t === T.TREE || t === T.ROCK || this.walls.has(`${x},${y}`);
  }

  // Circle-vs-tile collision. Trees and rocks are drawn smaller than a tile, so they collide smaller too.
  blockedAt(px, py, r) {
    const x0 = Math.floor((px - r) / TS);
    const x1 = Math.floor((px + r) / TS);
    const y0 = Math.floor((py - r) / TS);
    const y1 = Math.floor((py + r) / TS);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!this.solid(x, y)) continue;
        const t = this.tileAt(x, y);
        const pad = (t === T.TREE || t === T.ROCK) && !this.walls.has(`${x},${y}`) ? 6 : 0;
        const rx = x * TS + pad;
        const ry = y * TS + pad;
        const rw = TS - 2 * pad;
        const cx = Math.max(rx, Math.min(px, rx + rw));
        const cy = Math.max(ry, Math.min(py, ry + rw));
        if ((px - cx) ** 2 + (py - cy) ** 2 < r * r) return true;
      }
    }
    return false;
  }

  // Axis-separated movement so entities slide along obstacles. Returns true on contact.
  move(e, dx, dy) {
    let hit = false;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / (e.r * 0.8)));
    const sx = dx / steps;
    const sy = dy / steps;
    for (let i = 0; i < steps; i++) {
      if (sx && !this.blockedAt(e.x + sx, e.y, e.r)) e.x += sx;
      else if (sx) hit = true;
      if (sy && !this.blockedAt(e.x, e.y + sy, e.r)) e.y += sy;
      else if (sy) hit = true;
    }
    return hit;
  }

  // Straight-line visibility between two points (trees, rocks and walls block it; water does not).
  lineOfSight(ax, ay, bx, by) {
    const d = Math.hypot(bx - ax, by - ay);
    const n = Math.ceil(d / 10);
    for (let i = 1; i < n; i++) {
      const x = ax + ((bx - ax) * i) / n;
      const y = ay + ((by - ay) * i) / n;
      const tx = Math.floor(x / TS);
      const ty = Math.floor(y / TS);
      const t = this.tileAt(tx, ty);
      if (t === T.TREE || t === T.ROCK || this.walls.has(`${tx},${ty}`)) return false;
    }
    return true;
  }
}

/**
 * Breadth-first flow field towards the player over a window of tiles. Enemies
 * without a clear line of sight follow its gradient, so they route around
 * trees, water and player-built walls instead of getting stuck.
 */
export class FlowField {
  constructor(world, radius = 22) {
    this.world = world;
    this.R = radius;
    this.N = 2 * radius + 1;
    this.dist = new Int16Array(this.N * this.N);
    this.queue = new Int32Array(this.N * this.N);
    this.ox = 0;
    this.oy = 0;
    this.age = Infinity;
    this.wallsVersion = -1;
  }

  update(px, py, dt, wallsVersion) {
    const tx = Math.floor(px / TS);
    const ty = Math.floor(py / TS);
    this.age += dt;
    if (tx === this.ox && ty === this.oy && this.age < 0.5 && wallsVersion === this.wallsVersion) return;
    this.compute(tx, ty);
    this.wallsVersion = wallsVersion;
  }

  compute(tx, ty) {
    const { N, R, dist, queue, world } = this;
    this.ox = tx;
    this.oy = ty;
    this.age = 0;
    dist.fill(-1);
    const start = R * N + R;
    dist[start] = 0;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    while (head < tail) {
      const cur = queue[head++];
      const cx = cur % N;
      const cy = (cur - cx) / N;
      const nd = dist[cur] + 1;
      for (let k = 0; k < 4; k++) {
        const nx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0);
        const ny = cy + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const idx = ny * N + nx;
        if (dist[idx] !== -1) continue;
        if (world.solid(tx - R + nx, ty - R + ny)) {
          dist[idx] = -2; // blocked
          continue;
        }
        dist[idx] = nd;
        queue[tail++] = idx;
      }
    }
  }

  distanceAt(x, y) {
    const lx = Math.floor(x / TS) - this.ox + this.R;
    const ly = Math.floor(y / TS) - this.oy + this.R;
    if (lx < 0 || ly < 0 || lx >= this.N || ly >= this.N) return -1;
    return this.dist[ly * this.N + lx];
  }

  // Unit vector towards the neighbouring tile closest to the player, or null.
  direction(x, y) {
    const { N, R, dist } = this;
    const lx = Math.floor(x / TS) - this.ox + R;
    const ly = Math.floor(y / TS) - this.oy + R;
    if (lx < 0 || ly < 0 || lx >= N || ly >= N) return null;
    const here = dist[ly * N + lx];
    let best = here >= 0 ? here : 1e9;
    let bx = 0;
    let by = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = lx + dx;
        const ny = ly + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const d = dist[ny * N + nx];
        if (d < 0) continue;
        // no corner cutting
        if (dx && dy && (dist[ly * N + nx] < 0 || dist[ny * N + lx] < 0)) continue;
        const score = d + (dx && dy ? 0.4 : 0);
        if (score < best) {
          best = score;
          bx = dx;
          by = dy;
        }
      }
    }
    if (!bx && !by) return null;
    // aim at the centre of the chosen tile
    const cx = (Math.floor(x / TS) + bx + 0.5) * TS - x;
    const cy = (Math.floor(y / TS) + by + 0.5) * TS - y;
    const l = Math.hypot(cx, cy) || 1;
    return { x: cx / l, y: cy / l };
  }
}
