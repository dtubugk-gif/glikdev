// Day 6: the kitty's friend (friendbrain.js). Pure logic: stepped here against a pretend kitty.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFriendBrain, FRIEND, STEP } from '../src/friendbrain.js';

/** a pretend kitty: sitting at (x, z) facing `heading`, with whatever else the test sets */
function kittyAt(x, z, heading = 0, extra = {}) {
  return { x, z, heading, head: [x + Math.sin(heading) * 1.6, 3.4, z + Math.cos(heading) * 1.6], mode: 'sit',
    asleep: false, moving: false, playing: false, eating: false, yarn: null, bowl: null, ...extra };
}
/** run the friend for `seconds`, collecting its events and the closest it came to her body */
function run(f, world, seconds, each) {
  const events = [];
  let closest = Infinity;
  for (let i = 0; i < Math.round(seconds / STEP); i++) {
    each?.(f.t, world);
    f.step(STEP, world);
    events.push(...f.drain());
    const k = world.kitty;
    closest = Math.min(closest, Math.hypot(f.x - k.x, f.z - k.z));
    assert.ok(Number.isFinite(f.x) && Number.isFinite(f.z) && Number.isFinite(f.heading), `finite at ${f.t}`);
  }
  return { events, closest };
}

test('it comes running in to meet her, touches noses, and says hello', () => {
  const f = createFriendBrain({ seed: 3, x: 60, z: 40, heading: 0, mode: 'sit', hello: true });
  const world = { kitty: kittyAt(0, 0, 0.3), player: null, bed: null };
  const { events } = run(f, world, 14);
  const types = events.map((e) => e.type);
  assert.ok(types.includes('friend-hello'), 'says hello');
  assert.ok(types.includes('boop'), 'boops her');
  assert.equal(f.hello, false);
  assert.ok(events.every((e) => e.who === 'friend'));
  // it ran (a long way to go)
  assert.ok(Math.hypot(f.x, f.z) < 9, `ends up beside her (${f.x.toFixed(1)}, ${f.z.toFixed(1)})`);
});

test('it keeps close to her and never walks into her body', () => {
  const f = createFriendBrain({ seed: 5, x: 9, z: 2, mode: 'sit' });
  const world = { kitty: kittyAt(0, 0, 1.0), player: { x: 6, z: 14 }, bed: null };
  const { events, closest } = run(f, world, 120);
  assert.ok(closest > 1.4, `never inside her (closest ${closest.toFixed(2)} m)`);
  const kinds = new Set(events.map((e) => e.type));
  for (const k of ['nuzzle', 'boop', 'playbow']) assert.ok(kinds.has(k), `does ${k} in two minutes`);
});

test('it follows her when she goes off, at a run when she is far', () => {
  const f = createFriendBrain({ seed: 7, x: 6, z: 0, mode: 'sit' });
  const world = { kitty: kittyAt(0, 0), player: null, bed: null };
  run(f, world, 3);
  world.kitty = kittyAt(80, -10, 1.5);
  let ran = false;
  run(f, world, 12, () => { if (f.mode === 'run') ran = true; });
  assert.ok(ran, 'gallops after her');
  assert.ok(Math.hypot(f.x - 80, f.z + 10) < FRIEND.follow + 1, 'catches up');
});

test('when she sleeps it curls up beside her, and wakes when she does', () => {
  const f = createFriendBrain({ seed: 9, x: 12, z: 6, mode: 'idle', timer: 0.5 });
  const world = { kitty: kittyAt(0, 0, 0, { asleep: true, mode: 'sleep' }), player: null, bed: null };
  run(f, world, 12);
  assert.equal(f.mode, 'sleep');
  assert.ok(Math.hypot(f.x, f.z) < 7.5, 'beside her');
  world.kitty = kittyAt(0, 0);
  const { events } = run(f, world, 3);
  assert.ok(events.some((e) => e.type === 'wake'), 'wakes up');
  assert.notEqual(f.mode, 'sleep');
});

test('at dinner it eats from the far side of the same bowl', () => {
  const f = createFriendBrain({ seed: 2, x: 10, z: 10, mode: 'sit' });
  const bowl = { x: 0, z: 4, eatenAt: null };
  const world = { kitty: kittyAt(0, 0, 0, { bowl, eating: true }), player: null, bed: null };
  const { events } = run(f, world, 10);
  assert.equal(f.mode, 'eat');
  assert.ok(Math.hypot(f.x - bowl.x, f.z - bowl.z) < FRIEND.real.mouth * FRIEND.scale + 1.5, 'its nose at the bowl');
  assert.ok(f.z > bowl.z, 'on the far side from her');
  assert.ok(events.some((e) => e.type === 'bite'));
  bowl.eatenAt = 10;
  run(f, world, 2);
  assert.notEqual(f.mode, 'eat');
});

test('petting it makes it purr; the same seed and world give the same kitten', () => {
  const a = createFriendBrain({ seed: 4, x: 7, z: 3, mode: 'sit' });
  const world = { kitty: kittyAt(0, 0), player: { x: 10, z: 10 }, bed: null };
  run(a, world, 1);
  assert.equal(a.pet({ x: 10, z: 10 }), true);
  const { events } = run(a, world, 2);
  assert.ok(events.some((e) => e.type === 'purr'));
  const b = createFriendBrain({ seed: 4, x: 7, z: 3, mode: 'sit' }), c = createFriendBrain({ seed: 4, x: 7, z: 3, mode: 'sit' });
  run(b, { ...world }, 40); run(c, { ...world }, 40);
  assert.deepEqual([b.x, b.z, b.heading, b.mode], [c.x, c.z, c.heading, c.mode]);
});

test('her swats make it hop or bow, from out of her way', () => {
  const f = createFriendBrain({ seed: 8, x: 3, z: 9, mode: 'sit' });
  const world = { kitty: kittyAt(0, 0, 0, { playing: true, yarn: { x: 0, z: 6 } }), player: null, bed: null };
  run(f, world, 6);
  assert.ok(Math.hypot(f.x - 0, f.z - 6) > 8, 'keeps out of the game');
  f.onKitty({ type: 'swat' });
  const { events } = run(f, world, 2);
  assert.ok(events.some((e) => e.type === 'hop' || e.type === 'playbow'));
});
