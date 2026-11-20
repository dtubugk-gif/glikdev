import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBrain, KITTY, STEP, YARN, rng, headingTo } from '../src/kittybrain.js';
import { meow, purr, bell, trill, chirp, mew, yawn, sigh, bite, step, thud, swat } from '../src/kittysound.js';

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

test('called: she stands, comes running, faces the caller, sits and meows', () => {
  const b = createBrain({ seed: 1, x: 0, z: 0, mode: 'sit', viewer: [40, 40] });
  b.call(30, 30);
  const seen = [];
  run(b, 12, (k) => { if (seen[seen.length - 1] !== k.mode) seen.push(k.mode); });
  assert.deepEqual(seen.slice(0, 3), ['standup', 'run', 'trot']);   // 42 m: a run, then a trot to finish
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

test('fed: a bowl appears, she runs over, eats all three layers, is full and happier, then washes', () => {
  const b = createBrain({ seed: 5, x: 0, z: 0, mode: 'sit', viewer: [0, 40], hunger: 0.9, happy: 0.4 });
  b.feed();
  const ev = [];
  const modes = [];
  run(b, 16, (k) => { ev.push(...k.drain()); if (modes[modes.length - 1] !== k.mode) modes.push(k.mode); });
  const types = ev.map((e) => e.type);
  const bowl = ev.find((e) => e.type === 'bowl');
  assert.ok(bowl && Math.abs(Math.hypot(bowl.x, bowl.z) - Math.hypot(10, 3)) < 0.5 && Math.abs(bowl.x) > 9,
    `the bowl lands beside her, across the view (${bowl?.x}, ${bowl?.z})`);
  for (const m of ['standup', 'trot', 'face', 'eat', 'sitdown', 'groom']) assert.ok(modes.includes(m), `${m} in ${modes.join(' > ')}`);
  assert.deepEqual(ev.filter((e) => e.type === 'kibble').map((e) => e.left), [2, 1, 0]);
  assert.ok(types.filter((t) => t === 'bite').length >= 9, 'she crunches all the way through');
  assert.ok(types.includes('eaten') && types.includes('bowl-gone'));
  assert.ok(b.hunger < 0.1 && b.happy > 0.55, `hunger ${b.hunger.toFixed(2)}, happy ${b.happy.toFixed(2)}`);
  assert.equal(b.bowl, null);
});

test('play: the yarn lands, she chases, pounces and bats it three times, then sits and washes', () => {
  const b = createBrain({ seed: 8, x: 0, z: 0, mode: 'sit', viewer: [0, 40] });
  b.play();
  const ev = [];
  const modes = new Set();
  const seq = [];
  let tired = 1;
  run(b, 40, (k) => {
    const got = k.drain();
    if (got.some((e) => e.type === 'swat' && e.round === 3)) tired = k.energy;
    ev.push(...got); modes.add(k.mode); if (seq[seq.length - 1] !== k.mode) seq.push(k.mode);
  });
  const swats = ev.filter((e) => e.type === 'swat');
  assert.equal(swats.length, 3, `three rounds (got ${swats.length})`);
  for (const m of ['trot', 'pounce', 'bat']) assert.ok(modes.has(m), m);
  assert.ok(ev.some((e) => e.type === 'thud') && ev.some((e) => e.type === 'leap'));
  const after = seq.slice(seq.lastIndexOf('bat') + 1);
  assert.deepEqual(after.slice(0, 2), ['sitdown', 'groom'], `after the last swat: ${after.join(' > ')}`);
  assert.ok(b.yarn && Math.hypot(b.yarn.vx, b.yarn.vz) === 0, 'the yarn comes to rest');
  assert.ok(tired < 0.5, `playing tires her out (energy ${tired})`);
});

test('nap: she lies down and sleeps; a pet wakes her with a stretch, then she purrs', () => {
  const b = createBrain({ seed: 3, mode: 'sit' });
  b.nap();
  run(b, 2);
  assert.equal(b.mode, 'sleep');
  assert.ok(b.isAsleep());
  b.pet();
  assert.equal(b.mode, 'stretch');
  const ev = b.drain().map((e) => e.type);
  assert.ok(ev.includes('wake') && ev.includes('yawn'));
  run(b, 3.5);
  assert.equal(b.mode, 'purr');
});

test('tapping the yarn on the floor starts a new game without a new toss', () => {
  const b = createBrain({ seed: 8, mode: 'sit', viewer: [0, 40] });
  b.play();
  run(b, 40);
  const yarn = b.yarn;
  b.drain();
  b.play();
  assert.equal(b.yarn, yarn, 'same ball');
  assert.equal(b.yarn.rounds, 0);
  assert.ok(!b.drain().some((e) => e.type === 'yarn'), 'no new toss');
});

// a yarn ball on the floor in front of her, her game with it over
function yarnOnFloor(seed = 8) {
  const b = createBrain({ seed, mode: 'sit', viewer: [0, 40] });
  b.play();
  run(b, 40);
  b.drain();
  return b;
}

test('picked up: the yarn lifts into your hand and follows it; she stops and watches', () => {
  const b = yarnOnFloor();
  b.play();                                              // she is after it again...
  run(b, 0.3);
  assert.ok(b.goal === 'yarn' || ['face', 'pounce', 'standup'].includes(b.mode), `she is after it (${b.mode})`);
  assert.ok(b.grabYarn());                               // ...until you pick it up
  assert.equal(b.goal, null);
  assert.equal(b.face, null);
  b.holdYarn(10, -6);
  run(b, 2);                                             // (a leap already under way lands first)
  assert.ok(Math.hypot(b.yarn.x - 10, b.yarn.z + 6) < 0.05, 'it is where your hand is');
  assert.ok(b.yarn.y > YARN.radius + YARN.hold * 0.95, 'held up off the floor');
  assert.ok(!['walk', 'trot', 'pounce', 'bat'].includes(b.mode), `she waits (${b.mode})`);
  b.play();                                              // tapping Play while you hold it changes nothing
  assert.ok(b.yarn.held);
});

test('thrown: it flies, falls, bounces, rolls to a stop, and she chases it, pounces and bats it', () => {
  const b = yarnOnFloor();
  b.grabYarn();
  b.holdYarn(b.yarn.x, b.yarn.z);
  run(b, 0.5);
  b.throwYarn(25, 0, 10);
  const ev = [];
  let top = 0, flew = 0;
  run(b, 25, (k) => { ev.push(...k.drain()); top = Math.max(top, k.yarn.y); flew = Math.max(flew, k.yarn.x); });
  const types = ev.map((e) => e.type);
  assert.ok(types.includes('toss'), 'a whoosh');
  assert.ok(types.filter((t) => t === 'thud').length >= 2, 'it bounced');
  assert.ok(top > YARN.radius + YARN.hold + 1, 'it went up before it came down');
  assert.ok(flew > 30, `it went far (${flew.toFixed(1)} m)`);
  assert.ok(types.includes('swat'), 'she caught up with it and batted it');
  assert.ok(!b.yarn.air && Math.abs(b.yarn.y - YARN.radius) < 1e-6, 'back on the floor');
});

test('a throw can cross the plate but never leaves it; the hardest throw is capped', () => {
  const b = yarnOnFloor(3);
  b.grabYarn();
  b.holdYarn(500, 0);                                    // your hand off the edge: it stops at the limit
  run(b, 1);
  assert.ok(Math.hypot(b.yarn.x, b.yarn.z) <= KITTY.limit + 1e-6);
  b.throwYarn(900, 300, 12);
  assert.ok(Math.hypot(b.yarn.vx, b.yarn.vz) <= YARN.maxThrow + 1e-6, 'capped');
  let far = 0;
  run(b, 30, (k) => { far = Math.max(far, Math.hypot(k.yarn.x, k.yarn.z)); });
  assert.ok(far < KITTY.limit + 3, `it stayed on the plate (${far.toFixed(1)} m)`);
});

test('she never bats a ball that is in your hand', () => {
  const b = yarnOnFloor(5);
  b.play();
  let grabbed = false;
  const swats = [];
  run(b, 15, (k) => {
    if (!grabbed && k.mode === 'pounce') { k.grabYarn(); grabbed = true; }
    for (const e of k.drain()) if (e.type === 'swat') swats.push(e);
  });
  assert.ok(grabbed, 'caught her mid-pounce');
  assert.equal(swats.length, 0);
  assert.ok(b.yarn.held);
});

test('called from far away she runs, and trots the last stretch before she arrives', () => {
  const b = createBrain({ seed: 6, mode: 'idle', timer: 99, x: 0, z: 0, viewer: [0, 40] });
  b.call(0, -60);
  const modes = [];
  let top = 0;
  run(b, 12, (k) => { if (modes[modes.length - 1] !== k.mode) modes.push(k.mode); top = Math.max(top, k.speed); });
  assert.ok(modes.includes('run'), `she ran (${modes.join(' > ')})`);
  assert.ok(modes.indexOf('trot') > modes.indexOf('run'), 'and slowed to a trot near the end');
  assert.ok(top > KITTY.trotSpeed * 1.3 && top <= KITTY.runSpeed + 1e-6, `top speed ${top.toFixed(1)} m/s`);
  assert.ok(Math.hypot(b.x, b.z + 60) < 6, 'she got there');
  assert.equal(b.anim().name === 'Run' || modes.at(-1) !== 'run', true);
});

test('a short call is still a trot, and a stroll is still a walk', () => {
  const b = createBrain({ seed: 6, mode: 'idle', timer: 99, viewer: [0, 40] });
  b.call(0, -10);
  const modes = new Set();
  run(b, 4, (k) => modes.add(k.mode));
  assert.ok(modes.has('trot') && !modes.has('run'), [...modes].join(','));
  const c = createBrain({ seed: 6, mode: 'idle', timer: 99 });
  c.walkTo(0, -60);
  const m2 = new Set();
  run(c, 6, (k) => m2.add(k.mode));
  assert.ok(m2.has('walk') && !m2.has('run'), [...m2].join(','));
});

test('a ball thrown far away: she runs after it', () => {
  const b = yarnOnFloor(4);
  b.grabYarn();
  b.holdYarn(b.yarn.x, b.yarn.z);
  run(b, 0.5);
  b.throwYarn(0, -34, 12);
  const modes = new Set();
  run(b, 6, (k) => modes.add(k.mode));
  assert.ok(modes.has('run'), [...modes].join(','));
});

test('the run clip shows while running', () => {
  const b = createBrain({ seed: 1 });
  b.mode = 'run'; b.speed = KITTY.runSpeed;
  assert.equal(b.anim().name, 'Run');
  assert.ok(Math.abs(b.anim().rate - 1) < 1e-9);
});

// a kitty at her bowl, eating
function eating(seed = 3) {
  const b = createBrain({ seed, mode: 'sit', timer: 99, viewer: [0, 40] });
  b.feed();
  for (let i = 0; i < 1200 && b.mode !== 'eat'; i++) b.step(STEP);
  assert.equal(b.mode, 'eat');
  return b;
}

test('Feed while she is eating tops the same bowl up, and she eats on', () => {
  const b = eating();
  run(b, 2);
  const bowl = { x: b.bowl.x, z: b.bowl.z };
  assert.ok(b.bowl.left < 3, 'she has eaten some');
  b.drain();
  b.feed();
  const ev = b.drain().map((e) => e.type);
  assert.ok(ev.includes('refill') && !ev.includes('bowl'), `the same bowl, topped up (${ev.join(',')})`);
  assert.equal(b.bowl.left, 3);
  assert.deepEqual({ x: b.bowl.x, z: b.bowl.z }, bowl, 'it did not move');
  assert.equal(b.mode, 'eat', 'she eats on');
  let eaten = null;
  run(b, 12, (k) => { for (const e of k.drain()) if (e.type === 'eaten') eaten = e.t; });
  assert.ok(eaten != null && eaten > 5, 'she finished the top-up too');
});

test('Feed just after she finished: the bowl fills again and she comes back to it', () => {
  const b = eating();
  run(b, 6);
  assert.notEqual(b.mode, 'eat');
  assert.ok(b.bowl && b.bowl.eatenAt != null, 'empty bowl still out');
  b.drain();
  b.feed();
  const modes = new Set();
  let eaten = 0;
  run(b, 15, (k) => { modes.add(k.mode); for (const e of k.drain()) if (e.type === 'eaten') eaten++; });
  assert.ok(modes.has('eat') && eaten === 1, [...modes].join(','));
});

test('Play at dinner: she leaves the bowl to play, then goes back and finishes it', () => {
  const b = eating();
  run(b, 1.5);
  const leftBefore = b.bowl.left;
  b.drain();
  b.play();
  const order = [];
  run(b, 40, (k) => { for (const e of k.drain()) if (['swat', 'eat', 'eaten'].includes(e.type)) order.push(e.type); });
  assert.ok(leftBefore > 0);
  const firstSwat = order.indexOf('swat'), eaten = order.indexOf('eaten');
  assert.ok(firstSwat >= 0, `she played (${order.join(',')})`);
  assert.ok(eaten > firstSwat, 'and finished her dinner after the game');
  assert.equal(order.filter((t) => t === 'eaten').length, 1);
});

test('a ball thrown at dinner: she goes after it', () => {
  const b = eating(5);
  b.play();                                              // the yarn arrives...
  run(b, 1.2);
  if (!b.yarn.held) b.grabYarn();                        // ...and you pick it up and throw it
  b.holdYarn(b.yarn.x, b.yarn.z);
  run(b, 0.5);
  b.throwYarn(10, -20, 9);
  const modes = new Set();
  run(b, 5, (k) => modes.add(k.mode));
  assert.ok(modes.has('trot') || modes.has('run'), [...modes].join(','));
});

test('Feed and Play always do something, whatever she is doing', () => {
  for (const mode of ['sit', 'idle', 'sleep', 'groom', 'purr', 'walk', 'stretch']) {
    for (const what of ['feed', 'play']) {
      const b = createBrain({ seed: 9, mode: mode === 'walk' || mode === 'stretch' ? 'idle' : mode, timer: 99, viewer: [0, 40] });
      if (mode === 'walk') b.walkTo(20, 0);
      run(b, 0.3);
      b.drain();
      b[what]();
      const ev = [];
      run(b, 20, (k) => ev.push(...k.drain().map((e) => e.type)));
      if (what === 'feed') assert.ok(ev.includes('eaten'), `${mode}: fed -> she ate (${[...new Set(ev)].join(',')})`);
      else assert.ok(ev.includes('swat'), `${mode}: play -> she played (${[...new Set(ev)].join(',')})`);
    }
  }
});

test('hungry: every so often she asks for food with a little mew', () => {
  const b = createBrain({ seed: 2, mode: 'sit', timer: 999, hunger: 0.95 });
  const mews = [];
  run(b, 70, (k) => { for (const e of k.drain()) if (e.type === 'mew') mews.push(e.t); });
  assert.ok(mews.length >= 2 && mews.length <= 4, `${mews.length} mews in 70 s`);
});

test('every new clip has a mode that shows it', () => {
  const b = createBrain({ seed: 1 });
  const want = { eat: 'Eat', groom: 'Groom', stretch: 'Stretch', sleep: 'Sleep', liedown: 'Sleep', pounce: 'Pounce', bat: 'Bat' };
  for (const [mode, clip] of Object.entries(want)) { b.mode = mode; assert.equal(b.anim().name, clip); }
});

test('all her voices and sounds render clean', () => {
  for (const [name, fn] of Object.entries({ trill, chirp, mew, yawn, sigh, bite, step, thud, swat })) {
    const f = fn(48000, 1);
    assert.ok(f.length > 48000 * 0.05, name);
    let peak = 0;
    for (const x of f) { assert.ok(Number.isFinite(x), name); peak = Math.max(peak, Math.abs(x)); }
    assert.ok(peak > 0.2 && peak <= 0.81, `${name} peak ${peak}`);
  }
});
