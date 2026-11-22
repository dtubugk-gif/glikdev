// Day 3: the kitty has a bed. Sleepy means bed: she walks to it, steps in at the front, lies down on the cushion.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrain, STEP } from '../src/kittybrain.js';
import { createMind } from '../src/kittymind.js';

// the bed as town.js describes it (kept in step with it by the last test)
const BED = { x: -19, z: -13, r: 0.292 * 14, outer: 0.43 * 14, h: 0.062 * 14 };
{ const rot = Math.atan2(19, 13); BED.ex = Math.sin(rot); BED.ez = Math.cos(rot); }

function kittyAt(x, z, over = {}) {
  const mind = createMind({ seed: over.seed ?? 5 });
  const b = createBrain({ seed: 2, mind, mode: 'sit', timer: 99, x, z });
  b.bed = BED;
  b.friend = [30, 30];
  return { b, mind };
}
/** run, collecting events and where she crossed the bolster (the ring between the cushion and the outside) */
function run(b, seconds, until) {
  const ev = [], ring = [];
  for (let i = 0; i < seconds / STEP; i++) {
    b.step(STEP);
    for (const e of b.drain()) ev.push(e);
    const dx = b.x - BED.x, dz = b.z - BED.z, d = Math.hypot(dx, dz);
    if (d > BED.r && d < BED.outer) ring.push((dx * BED.ex + dz * BED.ez) / d);   // 1 = straight out of the front
    if (until && until(b, ev)) break;
  }
  return { ev, ring };
}
const types = (ev) => ev.map((e) => e.type);

test('a sleepy kitty goes to her bed and sleeps on the cushion, facing out', () => {
  for (const [x, z] of [[0, 0], [20, 10], [-40, -30], [-19, -40], [-45, 5], [10, -45]]) {
    const { b, mind } = kittyAt(x, z);
    mind.sleepy = 0.9;
    const { ev, ring } = run(b, 90, (k) => k.mode === 'sleep');
    assert.equal(b.mode, 'sleep', `from (${x}, ${z}) she is asleep`);
    assert.ok(Math.hypot(b.x - BED.x, b.z - BED.z) < BED.r * 0.35, `in the middle of her bed (${b.x.toFixed(1)}, ${b.z.toFixed(1)})`);
    const out = Math.sin(b.heading) * BED.ex + Math.cos(b.heading) * BED.ez;
    assert.ok(out > 0.95, `facing out of the front (${out.toFixed(2)})`);
    assert.ok(ring.length > 0 && Math.min(...ring) > 0.6, `she stepped in at the front, not through the bolster (from (${x}, ${z}): ${Math.min(...ring).toFixed(2)})`);
    assert.ok(types(ev).includes('asleep'));
  }
});

test('sleepy does not last: she is on her way to bed within moments, and asleep soon after', () => {
  const { b, mind } = kittyAt(6, 4);
  mind.sleepy = 0.86;
  const { ev } = run(b, 4);
  assert.ok(ev.some((e) => e.type === 'mind' && e.does === 'nap'), 'she decided to go to bed');
  assert.ok(b.sense().bedtime, 'and is on her way');
  run(b, 60, (k) => k.mode === 'sleep');
  assert.equal(b.mode, 'sleep');
});

test('left alone for a quarter of an hour she is never sleepy for long without sleeping', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const { b, mind } = kittyAt(0, 0, { seed });
    let sleepyAwake = 0, worst = 0, naps = 0, was = false;
    for (let i = 0; i < 15 * 60 / STEP; i++) {
      b.step(STEP);
      b.drain();
      const asleep = b.mode === 'sleep';
      if (asleep && !was) naps++;
      was = asleep;
      if (!asleep && mind.sleepy >= 0.85) { sleepyAwake += STEP; worst = Math.max(worst, sleepyAwake); } else sleepyAwake = 0;
    }
    assert.ok(naps >= 1, `cat ${seed} slept`);
    assert.ok(worst < 45, `cat ${seed} was sleepy and awake for at most ${worst.toFixed(0)} s at a stretch`);
  }
});

test('on her way to bed she does not tag along with you, but a pet she still takes', () => {
  const { b, mind } = kittyAt(20, 20);
  mind.sleepy = 0.9;
  mind.bond = 0.9;
  run(b, 3);
  assert.ok(b.sense().bedtime);
  for (let i = 0; i < 4; i++) { assert.equal(b.call(60, 60, { quiet: true }), false); run(b, 0.5); }
  assert.equal(mind.lastDecision.why, 'tired');
  assert.ok(b.sense().bedtime, 'still on her way');
  assert.notEqual(b.pet(), false);
  run(b, 120, (k) => k.mode === 'sleep');
  assert.equal(b.mode, 'sleep', 'and then to bed all the same');
  assert.ok(Math.hypot(b.x - BED.x, b.z - BED.z) < BED.r * 0.35);
});

test('a worn-out kitty turns a game down and goes to her bed', () => {
  const { b } = kittyAt(5, 5);
  b.energy = 0.05;
  b.play();
  const { ev } = run(b, 90, (k) => k.mode === 'sleep');
  assert.ok(types(ev).includes('refuse'));
  assert.equal(b.mode, 'sleep');
  assert.ok(Math.hypot(b.x - BED.x, b.z - BED.z) < BED.r * 0.35);
});

test('woken on her bed she is cross, and when she has calmed down she goes back to it', () => {
  const { b, mind } = kittyAt(BED.x + BED.ex * 20, BED.z + BED.ez * 20);
  mind.sleepy = 0.9;
  run(b, 60, (k) => k.mode === 'sleep');
  run(b, 2);
  assert.equal(b.pet(), false);
  assert.ok(b.drain().some((e) => e.type === 'woken' && e.angry));
  const { ev } = run(b, 150, (k, all) => k.mode === 'sleep' && all.some((e) => e.type === 'asleep'));
  assert.equal(b.mode, 'sleep', 'back asleep');
  assert.ok(Math.hypot(b.x - BED.x, b.z - BED.z) < BED.r * 0.35, 'in her bed again');
  assert.ok(types(ev).includes('asleep'));
});

test('a stroll and the food bowl keep off her bed', () => {
  const { b, mind } = kittyAt(BED.x + 9, BED.z + 2);
  mind.sleepy = 0;
  b.hunger = 0.9;
  b.feed();
  assert.ok(Math.hypot(b.bowl.x - BED.x, b.bowl.z - BED.z) >= BED.outer + 2.9, 'the bowl is beside the bed, not on it');
  const k2 = kittyAt(0, 0, { seed: 4 });
  k2.mind.sleepy = 0;
  for (let i = 0; i < 6 * 60 / STEP; i++) {
    k2.b.step(STEP);
    k2.b.drain();
    k2.mind.sleepy = 0; k2.b.energy = 1;
    if (!k2.b.goal && k2.b.target) assert.ok(Math.hypot(k2.b.target.x - BED.x, k2.b.target.z - BED.z) >= BED.outer + 3.9, 'a stroll does not end on her bed');
  }
});

test('without a bed she still naps in her own spot (nothing else changed)', () => {
  const mind = createMind({ seed: 2 });
  mind.napAt(16, -9); mind.napAt(16, -9);
  mind.sleepy = 0.9;
  const b = createBrain({ seed: 2, mind, mode: 'sit', timer: 99 });
  for (let i = 0; i < 60 / STEP && b.mode !== 'sleep'; i++) { b.step(STEP); b.drain(); }
  assert.equal(b.mode, 'sleep');
  assert.ok(Math.hypot(b.x - 16, b.z + 9) < 7);
});

test('the bed in the world is the bed these tests use', async () => {
  // town.js needs three.js, which node cannot load from the import map: read its numbers from the source
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/town.js', import.meta.url), 'utf8');
  assert.match(src, /export const BED = \{ x: -19, z: -13, scale: 14 \};/);
  assert.match(src, /const BED_MODEL = \{ outer: 0\.43, cushion: 0\.292, top: 0\.062 \};/);
  const demo = readFileSync(new URL('../src/demo.js', import.meta.url), 'utf8');
  assert.match(demo, /const BED = \[-19, -13\]/);
});
