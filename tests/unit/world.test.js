import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUSH_REGROW, FlowField, T, TS, World } from '../../src/game/world.js';

test('terrain is deterministic per seed and differs between seeds', () => {
  const a = new World(123);
  const b = new World(123);
  const c = new World(124);
  let same = 0;
  let diff = 0;
  for (let y = -30; y < 30; y++) {
    for (let x = -30; x < 30; x++) {
      if (a.tileAt(x, y) === b.tileAt(x, y)) same++;
      if (a.tileAt(x, y) !== c.tileAt(x, y)) diff++;
    }
  }
  assert.equal(same, 3600);
  assert.ok(diff > 300);
});

test('the spawn area is always walkable land', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const w = new World(seed);
    for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) assert.ok(!w.solid(x, y), `seed ${seed} tile ${x},${y}`);
  }
});

test('collision blocks solid tiles and movement slides along them', () => {
  const w = new World(1);
  w.walls.set('3,0', { hp: 8 });
  const e = { x: 2 * TS + 16, y: 16, r: 9 };
  const hit = w.move(e, 40, 0);
  assert.equal(hit, true);
  assert.ok(e.x + e.r <= 3 * TS + 0.01, 'stopped at wall');
  // sliding: diagonal move keeps the free axis
  const y0 = e.y;
  w.move(e, 20, 10);
  assert.ok(e.y > y0);
  // large steps cannot tunnel through a wall
  const f = { x: 2 * TS + 16, y: 16, r: 9 };
  w.move(f, 200, 0);
  assert.ok(f.x < 3 * TS);
});

test('line of sight is blocked by walls but not open ground', () => {
  const w = new World(1);
  assert.equal(w.lineOfSight(16, 16, 16 + 3 * TS, 16), true);
  w.walls.set('1,0', { hp: 8 });
  assert.equal(w.lineOfSight(16, 16, 16 + 3 * TS, 16), false);
});

test('harvested bushes regrow, trees and rocks do not', () => {
  const w = new World(5);
  let bush = null;
  let tree = null;
  for (let y = -40; y < 40 && (!bush || !tree); y++) {
    for (let x = -40; x < 40; x++) {
      const t = w.tileAt(x, y);
      if (t === T.BUSH && !bush) bush = [x, y];
      if (t === T.TREE && !tree) tree = [x, y];
    }
  }
  w.remove(...bush);
  w.remove(...tree);
  assert.equal(w.tileAt(...bush), T.GRASS);
  w.time = BUSH_REGROW + 1;
  assert.equal(w.tileAt(...bush), T.BUSH);
  assert.equal(w.tileAt(...tree), T.GRASS);
});

test('flow field routes around a wall instead of through it', () => {
  const w = new World(1);
  // clear a test area of natural obstacles by checking it, then build a wall line at x=3, y=-3..3
  for (let y = -3; y <= 3; y++) w.walls.set(`3,${y}`, { hp: 8 });
  const f = new FlowField(w, 12);
  f.compute(0, 0);
  // directly behind the wall the path must be longer than the straight-line distance
  const d = f.distanceAt(5 * TS + 16, 16);
  assert.ok(d > 5, `distance ${d}`);
  // following the gradient from behind the wall reaches the player without touching wall tiles
  let x = 5 * TS + 16;
  let y = 16;
  for (let k = 0; k < 400; k++) {
    const dir = f.direction(x, y);
    if (!dir) break;
    x += dir.x * 4;
    y += dir.y * 4;
    assert.ok(!w.walls.has(`${Math.floor(x / TS)},${Math.floor(y / TS)}`), 'walked into wall');
  }
  assert.ok(Math.hypot(x - 16, y - 16) < TS * 1.5, `ended at ${x},${y}`);
});

test('flow field marks an enclosed player as unreachable from outside', () => {
  const w = new World(1);
  for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) if (x || y) w.walls.set(`${x},${y}`, { hp: 8 });
  const f = new FlowField(w, 8);
  f.compute(0, 0);
  assert.equal(f.distanceAt(4 * TS, 4 * TS), -1);
  assert.equal(f.direction(4 * TS, 4 * TS), null);
});
