import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TYPES } from '../../src/game/ai.js';
import { COSTS, DAY, Game, MAX_FIRE_FUEL, SPEAR_USES } from '../../src/game/game.js';
import { T, TS } from '../../src/game/world.js';

const DT = 1 / 60;
const run = (g, secs, input = {}) => {
  for (let k = 0; k < secs / DT && !g.over; k++) g.update(DT, input);
};

// A game with no spawns, for testing rules in isolation.
function quiet(seed = 1) {
  const g = new Game({ seed });
  g.spawnT = Infinity;
  return g;
}

function standNextTo(g, tileType) {
  for (let r = 1; r < 40; r++) {
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        if (g.world.tileAt(x, y) !== tileType) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (!g.world.solid(x + dx, y + dy)) {
            g.player.x = (x + dx) * TS + 16;
            g.player.y = (y + dy) * TS + 16;
            return [x, y];
          }
        }
      }
    }
  }
  throw new Error('tile not found');
}

function placeEnemy(g, type, dx, dy) {
  const e = g.spawnEnemy(type);
  e.x = g.player.x + dx;
  e.y = g.player.y + dy;
  e.lx = e.x;
  e.ly = e.y;
  return e;
}

test('same seed gives the same game; different seeds diverge', () => {
  const a = new Game({ seed: 9 });
  const b = new Game({ seed: 9 });
  const c = new Game({ seed: 10 });
  const input = { mx: 1, my: 0.3, attack: true };
  run(a, 30, input);
  run(b, 30, input);
  run(c, 30, input);
  const sig = (g) => JSON.stringify([g.player.x, g.player.hp, g.enemies.map((e) => [e.type, e.x.toFixed(3)])]);
  assert.equal(sig(a), sig(b));
  assert.notEqual(sig(a), sig(c));
});

test('harvesting trees, rocks and bushes yields wood, stone and food', () => {
  const g = quiet(3);
  standNextTo(g, T.TREE);
  assert.equal(g.harvest(), 'wood');
  assert.ok(g.player.wood >= 2);
  assert.equal(g.world.removed.size, 1, 'the harvested tree is gone');
  g.player.hcd = 0;
  standNextTo(g, T.ROCK);
  assert.equal(g.harvest(), 'stone');
  assert.equal(g.player.stone, 2);
  g.player.hcd = 0;
  standNextTo(g, T.BUSH);
  const before = g.player.rations;
  assert.equal(g.harvest(), 'food');
  assert.equal(g.player.rations, before + 2);
});

test('crafting checks and deducts costs', () => {
  const g = quiet();
  assert.equal(g.craft('fire'), false);
  assert.match(g.flash.msg, /Need 5 wood/);
  g.player.wood = 20;
  g.player.stone = 2;
  assert.equal(g.craft('fire'), true);
  assert.equal(g.fires.length, 1);
  assert.equal(g.player.wood, 20 - COSTS.fire.wood);
  assert.equal(g.craft('spear'), true);
  assert.equal(g.player.spear, SPEAR_USES);
  assert.equal(g.player.stone, 0);
  assert.equal(g.craft('spear'), false);
  const aim = { x: g.player.x + 2 * TS, y: g.player.y };
  assert.equal(g.craft('wall', aim), true);
  assert.equal(g.world.walls.size, 1);
  assert.equal(g.craft('wall', aim), false, 'cannot stack walls');
  assert.equal(g.craft('wall', { x: g.player.x + 400, y: g.player.y }), false, 'too far');
  assert.equal(g.craft('wall', { x: g.player.x, y: g.player.y }), false, 'not on the player');
});

test('fires burn down, can be fed, and heal faster nearby', () => {
  const g = quiet();
  g.player.wood = 7;
  g.craft('fire');
  const f = g.fires[0];
  run(g, 10);
  assert.ok(f.fuel < 61);
  g.player.x = f.x + 20;
  g.player.y = f.y;
  g.player.hcd = 0;
  assert.equal(g.harvest(), 'fire');
  assert.ok(f.fuel > 90 && f.fuel <= MAX_FIRE_FUEL);
  g.player.hp = 50;
  run(g, 5);
  assert.ok(g.player.hp > 60, `hp ${g.player.hp}`);
  f.fuel = 0.01;
  run(g, 0.1);
  assert.equal(g.fires.length, 0);
});

test('hunger drains over time; eating restores it; starvation kills', () => {
  const g = quiet();
  run(g, 60);
  assert.ok(g.player.food < 85);
  g.player.rations = 1;
  const f0 = g.player.food;
  assert.equal(g.eat(), true);
  assert.ok(g.player.food > f0);
  assert.equal(g.eat(), false, 'no rations left');
  g.player.food = 0;
  g.player.hp = 5;
  run(g, 5);
  assert.equal(g.over, true);
  assert.equal(g.cause, 'starvation');
});

test('time of day follows the light cycle', () => {
  const g = quiet();
  const at = (p) => ((g.time = p * DAY), g.timeOfDay());
  assert.equal(at(0.1), 'daylight');
  assert.equal(at(0.4), 'dusk');
  assert.equal(at(0.65), 'night');
  assert.equal(at(0.9), 'dawn');
});

test('night exposure hurts away from fire', () => {
  const g = quiet();
  g.time = DAY * 0.6; // deep night
  assert.ok(g.nightFactor() > 0.6);
  g.player.food = 30; // no regeneration
  const hp = g.player.hp;
  run(g, 5);
  assert.ok(g.player.hp < hp);
});

test('enemy melee damages the player, with brief invulnerability', () => {
  const g = quiet();
  placeEnemy(g, 'chaser', 15, 0);
  run(g, 0.1);
  assert.ok(g.player.hp < 100);
  const hp = g.player.hp;
  g.hurtPlayer(10, 'test');
  assert.ok(g.player.hp === hp || g.player.inv > 0);
});

test('striking kills enemies and awards score; spear increases reach', () => {
  const g = quiet();
  const e = placeEnemy(g, 'flanker', 30, 0);
  g.player.face = 0;
  for (let i = 0; i < 5 && g.enemies.includes(e); i++) {
    g.player.cd = 0;
    g.attack();
  }
  assert.equal(g.kills, 1);
  assert.equal(g.killScore, TYPES.flanker.score);
  assert.equal(g.stats.killsBy.flanker, 1);
  // 60px away: out of club reach, inside spear reach
  const far = placeEnemy(g, 'chaser', 60, 0);
  g.player.cd = 0;
  g.attack();
  assert.equal(far.hp, far.maxhp);
  g.player.spear = 5;
  g.player.cd = 0;
  g.attack();
  assert.ok(far.hp < far.maxhp || !g.enemies.includes(far));
  assert.equal(g.player.spear, 4);
});

test('thrown stones travel and hit enemies', () => {
  const g = quiet();
  const e = placeEnemy(g, 'brute', 150, 0);
  e.spd = 0;
  g.player.stone = 3;
  g.player.face = 0;
  assert.equal(g.throwStone(), true);
  assert.equal(g.player.stone, 2);
  run(g, 0.6, { aim: { x: e.x, y: e.y } });
  assert.ok(e.hp < e.maxhp);
  g.player.stone = 0;
  g.player.tcd = 0;
  assert.equal(g.throwStone(), false);
});

test('enemies that learned to dodge evade more stones', () => {
  const hitRate = (dodge) => {
    let hits = 0;
    for (let trial = 0; trial < 40; trial++) {
      const g = quiet(100 + trial);
      g.ai.genes.dodge = dodge;
      // inside the guaranteed-clear spawn meadow, so no tree can block the stone
      const e = placeEnemy(g, 'chaser', 100, 0);
      e.dodge = dodge;
      g.player.stone = 1;
      g.player.face = 0;
      g.throwStone();
      run(g, 0.5, { aim: { x: g.player.x + 200, y: g.player.y } });
      if (g.stats.hits > 0) hits++;
    }
    return hits / 40;
  };
  const naive = hitRate(0);
  const trained = hitRate(0.85);
  assert.ok(naive > 0.8, `naive hit rate ${naive}`);
  assert.ok(trained < naive - 0.3, `trained ${trained} vs naive ${naive}`);
});

test('enemies path around walls to reach the player', () => {
  const g = quiet(1);
  // wall line between enemy and player
  for (let y = -4; y <= 4; y++) g.world.walls.set(`4,${y}`, { hp: 99 });
  g.wallsVersion++;
  const e = placeEnemy(g, 'chaser', 7 * TS, 0);
  let reached = false;
  for (let k = 0; k < 60 * 20 && !reached; k++) {
    g.update(DT, {});
    g.player.hp = 100;
    if (Math.hypot(e.x - g.player.x, e.y - g.player.y) < 40) reached = true;
  }
  assert.ok(reached, 'enemy should reach the player around the wall');
});

test('brutes smash walls that enclose the player', () => {
  const g = quiet(1);
  for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) if (x || y) g.world.walls.set(`${x},${y}`, { hp: 8 });
  g.wallsVersion++;
  placeEnemy(g, 'brute', 4 * TS, 0);
  run(g, 20);
  assert.ok(g.world.walls.size < 8, `walls left ${g.world.walls.size}`);
});

test('a new day announces the adaptation and difficulty rises', () => {
  const g = quiet();
  const cap1 = g.spawnCap();
  g.ai.observe('melee', 30);
  g.time = DAY - 0.01;
  g.update(DT, {});
  assert.equal(g.day, 2);
  assert.match(g.log[0], /Day 2/);
  assert.ok(g.ai.genes.armor > 0);
  g.time = 0.5 * DAY + DAY; // compare at equal time of day
  assert.ok(g.spawnCap() >= cap1 + 2);
  const e = g.spawnEnemy('chaser');
  assert.ok(e.maxhp > TYPES.chaser.hp);
});

test('behaviour tracking recognises kiting', () => {
  const g = quiet();
  const e = placeEnemy(g, 'chaser', -120, 0);
  e.spd = 165; // keeps pace, so the player stays in kiting range
  run(g, 4, { mx: 1, my: 0, sprint: true });
  assert.ok(g.ai.profile.kite > 2, `kite ${g.ai.profile.kite}`);
});

test('long headless sessions stay finite and spawn every enemy type', () => {
  const g = new Game({ seed: 77 });
  const seen = new Set();
  for (let k = 0; k < 60 * 240; k++) {
    g.update(DT, { mx: Math.cos(k / 200), my: Math.sin(k / 200), attack: k % 20 === 0 });
    g.player.hp = 100; // keep the run alive
    g.player.food = 100;
    for (const e of g.enemies) {
      seen.add(e.type);
      assert.ok(Number.isFinite(e.x) && Number.isFinite(e.y) && Number.isFinite(e.hp));
    }
    if (k % 600 === 0) g.ai.observe(['melee', 'camp', 'kite', 'ranged'][(k / 600) % 4], 10);
  }
  assert.ok(g.day >= 3);
  assert.ok(seen.size === 4, `types seen: ${[...seen]}`);
});

test('performance: an update with 40 enemies stays well under a frame', () => {
  const g = new Game({ seed: 5 });
  g.spawnT = Infinity;
  for (let i = 0; i < 40; i++) g.spawnEnemy(['chaser', 'flanker', 'spitter', 'brute'][i % 4]);
  const t0 = performance.now();
  const N = 600;
  for (let k = 0; k < N; k++) {
    g.update(DT, { mx: 1, my: 0 });
    g.player.hp = 100;
  }
  const per = (performance.now() - t0) / N;
  assert.ok(per < 2, `${per.toFixed(3)} ms per update`);
});

test('actions are ignored after game over', () => {
  const g = quiet();
  g.die('test');
  assert.equal(g.attack(), false);
  assert.equal(g.harvest(), null);
  const t = g.time;
  g.update(DT, {});
  assert.equal(g.time, t);
});
