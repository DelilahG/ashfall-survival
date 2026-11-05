import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Adaptation, GENES_DEF, PROFILE_HALF_LIFE, WEIGHTS_DEF } from '../../src/game/ai.js';
import { createRng } from '../../src/game/world.js';

function trained(behaviour, days = 3) {
  const a = new Adaptation();
  for (let d = 2; d < 2 + days; d++) {
    a.observe(behaviour, 20);
    a.adapt(d, true);
  }
  return a;
}

test('profile decays with the configured half-life', () => {
  const a = new Adaptation();
  a.observe('melee', 10);
  for (let t = 0; t < PROFILE_HALF_LIFE; t += 0.1) a.decay(0.1);
  assert.ok(Math.abs(a.profile.melee - 5) < 0.05, `${a.profile.melee}`);
});

test('shares are normalised and dominant behaviour is identified', () => {
  const a = new Adaptation();
  a.observe('kite', 6);
  a.observe('melee', 2);
  const s = a.shares();
  const sum = ['melee', 'ranged', 'kite', 'camp', 'build'].reduce((n, k) => n + s[k], 0);
  assert.ok(Math.abs(sum - 1) < 0.001);
  assert.equal(a.dominant().behaviour, 'kite');
});

test('no adaptation until enough has been observed', () => {
  const a = new Adaptation();
  a.observe('melee', 1);
  const msg = a.adapt(2, true);
  assert.match(msg, /still studying/);
  assert.deepEqual(a.genes, GENES_DEF);
});

test('melee players face armour, hit-and-run and more brutes', () => {
  const a = trained('melee');
  assert.ok(a.genes.armor > 0.5);
  assert.ok(a.genes.retreat > 0.8);
  assert.ok(a.weights.brute > WEIGHTS_DEF.brute * 10);
  assert.equal(a.genes.dodge, 0);
});

test('kiting players face flanking, interception and flankers', () => {
  const a = trained('kite');
  assert.ok(a.genes.flank > 0.85);
  assert.ok(a.genes.lead > 0.8);
  assert.ok(a.genes.spd > 1.2);
  assert.ok(a.weights.flanker > 2);
});

test('campers face long-range spitters and fire-raiding brutes', () => {
  const a = trained('camp');
  assert.ok(a.genes.range > 290);
  assert.ok(a.weights.spitter > 2);
  assert.ok(a.weights.brute > 1);
});

test('stone throwers face dodging enemies', () => {
  const a = trained('ranged');
  assert.ok(a.genes.dodge > 0.7);
  assert.ok(a.genes.armor < 0.01);
});

test('wall builders face brutes', () => {
  const a = trained('build');
  assert.ok(a.weights.brute > 1.8);
  const msg = a.adapt(9, true);
  assert.match(msg, /wall/i);
});

test('adaptation messages name the counter for the dominant behaviour', () => {
  const a = new Adaptation();
  a.observe('kite', 20);
  assert.match(a.adapt(2, true), /Flankers/);
  assert.equal(a.history.length, 1);
});

test('spawn type selection follows the weights', () => {
  const a = new Adaptation();
  a.weights = { chaser: 1, flanker: 0, spitter: 0, brute: 3 };
  const rand = createRng(1);
  const n = { chaser: 0, flanker: 0, spitter: 0, brute: 0 };
  for (let i = 0; i < 4000; i++) n[a.pickType(rand)]++;
  assert.equal(n.flanker + n.spitter, 0);
  assert.ok(Math.abs(n.brute / 4000 - 0.75) < 0.03);
});
