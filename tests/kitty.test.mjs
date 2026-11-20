import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBrain, KITTY, STEP, rng, headingTo } from '../src/kittybrain.js';
import { meow, purr, bell } from '../src/kittysound.js';

const run = (b, seconds, onStep) => {
  const n = Math.round(seconds / STEP);
  for (let i = 0; i < n; i++) { b.step(STEP); onStep?.(b); }
};

test('the random generator is seeded and in [0, 1)', () => {
  const a = rng(5), b = rng(5), c = rng(6);
  const xs = Array.from({ length: 50 }, a);
  assert.deepEqual(xs, Array.from({ length: 50 }, b));
  assert.notDeepEqual(xs, Array.from({ length: 50 }, c));
  assert.ok(xs.every((x) => x >= 0 && x < 1));
});

test('same seed and same calls: the very same kitty (recordings depend on it)', () => {
  const trace = (seed) => {
    const b = createBrain({ seed });
    const out = [];
    run(b, 40, (k) => { if (Math.abs(k.t - 12) < STEP / 2) k.call(20, -15); if (Math.abs(k.t - 25) < STEP / 2) k.pet(); });
    out.push(b.x, b.z, b.heading, b.mode);
    return out;
  };
  assert.deepEqual(trace(9), trace(9));
});

test('on her own she wanders, but stays near the middle of the plate', () => {
  const b = createBrain({ seed: 4 });
  let far = 0;
  const modes = new Set();
  run(b, 300, (k) => { far = Math.max(far, Math.hypot(k.x, k.z)); modes.add(k.mode); });
  assert.ok(far > 5, 'she moved');
  assert.ok(far < KITTY.roam + 8, `she stayed near the middle (max ${far.toFixed(1)} m)`);
  for (const m of ['sit', 'standup', 'walk']) assert.ok(modes.has(m), `she did ${m}`);
});

test('called: she stands, trots there, faces the caller, sits and meows', () => {
  const b = createBrain({ seed: 1, x: 0, z: 0, mode: 'sit', viewer: [40, 40] });
  b.call(30, 30);
  const seen = [];
  run(b, 12, (k) => { if (seen[seen.length - 1] !== k.mode) seen.push(k.mode); });
  assert.deepEqual(seen.slice(0, 2), ['standup', 'trot']);
  assert.ok(seen.includes('face') && seen.includes('sitdown') && seen.includes('meow'), seen.join(' > '));
  assert.ok(Math.hypot(b.x - 30, b.z - 30) < 5, 'she got there');
  const want = headingTo(b.x, b.z, 40, 40);
  assert.ok(Math.abs(Math.atan2(Math.sin(want - b.heading), Math.cos(want - b.heading))) < 0.15, 'she faces the caller');
});

test('a call far off the plate is pulled back inside it', () => {
  const b = createBrain({ seed: 1, mode: 'idle' });
  b.call(1000, 0);
  assert.ok(b.target.x <= KITTY.limit + 1e-9);
});

test('petted while walking: she sits down and purrs; petting again keeps her purring', () => {
  const b = createBrain({ seed: 3, mode: 'idle' });
  b.walkTo(30, 0);
  run(b, 1.5);
  assert.equal(b.mode, 'walk');
  b.pet();
  assert.equal(b.mode, 'sitdown');
  run(b, 1.0);
  assert.equal(b.mode, 'purr');
  const ev = b.drain().map((e) => e.type);
  assert.ok(ev.includes('pet') && ev.includes('purr'));
  run(b, 3.0);
  b.pet();
  run(b, 3.0);
  assert.equal(b.mode, 'purr', 'still purring 6 s in, after a second pet');
  run(b, 1.0);
  assert.equal(b.mode, 'sit');
});

test('the clip follows the mode, and the walk clip speeds up with her', () => {
  const b = createBrain({ seed: 3, mode: 'idle' });
  assert.equal(b.anim().name, 'Idle');
  b.walkTo(40, 0);
  run(b, 3);
  const a = b.anim();
  assert.equal(a.name, 'Walk');
  assert.ok(a.rate > 0.8 && a.rate < 1.25, `walk rate ${a.rate}`);
  b.pet();
  assert.deepEqual(b.anim(), { name: 'Sit', rate: 1, once: true });
});

test('the synthesised sounds are clean: right length, finite, not clipping', () => {
  for (const [name, f, secs] of [['meow', meow(48000, 1), [0.6, 0.8]], ['purr', purr(48000, 3), [3, 3]], ['bell', bell(48000, 0), [0.9, 0.9]]]) {
    const s = f.length / 48000;
    assert.ok(s >= secs[0] - 0.01 && s <= secs[1] + 0.01, `${name} length ${s}`);
    let peak = 0;
    for (const x of f) { assert.ok(Number.isFinite(x)); peak = Math.max(peak, Math.abs(x)); }
    assert.ok(peak > 0.3 && peak <= 0.81, `${name} peak ${peak}`);
  }
  assert.deepEqual(meow(48000, 2), meow(48000, 2), 'deterministic');
});
