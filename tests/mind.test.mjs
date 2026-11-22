// Day 3: the kitty has a mind of her own (kittymind.js) and her brain listens to it (kittybrain.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrain, STEP, KITTY, rng } from '../src/kittybrain.js';
import { createMind, temperFromSeed, describeTemper, describeMind, sayWhy, TRAITS, VERBS, DOINGS } from '../src/kittymind.js';
import { rewardFor } from '../src/tokens.js';

const calm = (over = {}) => ({ t: 0, hunger: 0.4, energy: 0.8, happy: 0.6, mode: 'sit', asleep: false, playing: false, moving: false,
  food: false, ateAgo: 999, toy: false, asking: null, friend: true, friendDist: 12, ...over });

/** run the brain for `seconds`, collecting its events; stop early when `until(b, events)` says so */
function run(b, seconds, until) {
  const all = [];
  for (let i = 0; i < seconds / STEP; i++) {
    b.step(STEP);
    for (const e of b.drain()) all.push(e);
    if (until && until(b, all)) break;
  }
  return all;
}
const types = (ev) => ev.map((e) => e.type);

test('who she is comes from her seed: five traits, the same every time, different from cat to cat', () => {
  const a = temperFromSeed(11), b = temperFromSeed(11), c = temperFromSeed(12);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  for (const k of TRAITS) assert.ok(a[k] >= 0.15 && a[k] <= 0.9, `${k} ${a[k]}`);
  assert.equal(describeTemper(a).length, 2);
});

test('the same cat asked the same things gives the same answers', () => {
  const answers = (seed) => {
    const m = createMind({ seed });
    const out = [];
    for (let i = 0; i < 60; i++) {
      const d = m.decide(VERBS[i % 4], calm({ t: i * 9, hunger: (i * 37 % 100) / 100, energy: (i * 61 % 100) / 100 }));
      out.push(`${d.yes}${d.mood}${d.want.toFixed(4)}`, m.choose(calm({ t: i * 9 })));
    }
    return out.join();
  };
  assert.equal(answers(5), answers(5));
  assert.notEqual(answers(5), answers(6));
});

test('a new kitty in a good state is friendly: she lets you pet her, plays, and eats when she is hungry', () => {
  let came = 0;
  for (let seed = 1; seed <= 40; seed++) {
    assert.equal(createMind({ seed }).decide('pet', calm()).yes, true, `pet, cat ${seed}`);
    assert.equal(createMind({ seed }).decide('play', calm({ energy: 1 })).yes, true, `play, cat ${seed}`);
    assert.equal(createMind({ seed }).decide('feed', calm({ hunger: 0.6 })).yes, true, `feed, cat ${seed}`);
    if (createMind({ seed }).decide('call', calm()).yes) came++;
  }
  assert.ok(came >= 32, `most new cats come when called (${came} of 40)`);
});

test('she says no when she does not want to: full, worn out, fast asleep', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const full = createMind({ seed }).decide('feed', calm({ hunger: 0.01 }));
    assert.equal(full.yes, false);
    assert.equal(full.why, 'full');
    assert.equal(sayWhy(full), 'Not hungry');
    const tired = createMind({ seed }).decide('play', calm({ energy: 0.05 }));
    assert.equal(tired.yes, false);
    assert.equal(tired.why, 'tired');
  }
  let slept = 0;
  for (let seed = 1; seed <= 30; seed++) if (!createMind({ seed }).decide('call', calm({ asleep: true, mode: 'sleep' })).yes) slept++;
  assert.ok(slept >= 15, `a sleeping cat she hardly knows mostly sleeps on (${slept} of 30)`);
});

test('what she will not do, she will not do however often you ask; the rest she can be talked into', () => {
  const m = createMind({ seed: 4 });
  for (let i = 0; i < 8; i++) assert.equal(m.decide('feed', calm({ t: i, hunger: 0 })).yes, false, 'truly full');
  // asleep and called: a no at first for these cats, a grudging yes when you keep on
  let turned = 0, cases = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const c = createMind({ seed });
    const s = calm({ asleep: true, mode: 'sleep' });
    if (c.decide('call', s).yes) continue;
    cases++;
    for (let i = 1; i <= 4; i++) {
      const d = c.decide('call', { ...s, t: i * 2 });
      if (d.yes) { assert.equal(d.mood, 'reluctant'); assert.equal(sayWhy(d), 'Oh, all right'); turned++; break; }
    }
  }
  assert.ok(cases >= 20 && turned >= cases * 0.8, `${turned} of ${cases} gave in`);
  // but leave it a while and the next ask starts fresh
  const c = createMind({ seed: 6 });
  const s = calm({ asleep: true, mode: 'sleep' });
  const first = c.decide('call', s);
  if (!first.yes) assert.ok(c.decide('call', { ...s, t: 60 }).want < 0.75, 'no carry-over after a minute');
});

test('too much petting and she has had enough: she gets up and walks off', () => {
  const mind = createMind({ seed: 6 });                    // not a cuddly cat
  const b = createBrain({ seed: 2, mind, mode: 'sit', timer: 99 });
  b.friend = [0, 8];
  let no = null;
  for (let i = 0; i < 30 && !no; i++) {
    if (b.pet() === false) no = mind.lastDecision;
    run(b, 0.4);
  }
  assert.ok(no, 'she said no in the end');
  assert.equal(no.why, 'enough');
  const ev = run(b, 3);
  assert.ok(['standup', 'walk'].includes(b.mode) || types(ev).includes('arrive'), `she is leaving (${b.mode})`);
  const far0 = Math.hypot(b.x, b.z - 8);
  run(b, 4);
  assert.ok(Math.hypot(b.x, b.z - 8) > far0 - 0.01, 'away from you, not toward you');
});

test('a full kitty leaves the bowl; when she is hungry later she goes to it by herself', () => {
  const mind = createMind({ seed: 3 });
  const b = createBrain({ seed: 2, mind, mode: 'sit', timer: 99, hunger: 0 });
  assert.equal(b.feed(), false);
  const ev = b.drain();
  assert.ok(types(ev).includes('bowl'), 'the bowl is put down');
  assert.ok(types(ev).includes('refuse'));
  assert.equal(ev.find((e) => e.type === 'decide').why, 'full');
  run(b, 5);
  assert.ok(b.bowl && b.bowl.left === 3 && b.bowl.eatenAt == null, 'the food is still there');
  assert.notEqual(b.mode, 'eat');
  b.hunger = 0.5;                                          // some time later
  const later = run(b, 40, (_, all) => all.some((e) => e.type === 'eaten'));
  assert.ok(types(later).includes('eaten'), 'she ate it on her own');
  assert.ok(types(later).some((t) => t === 'mind'), 'because she chose to');
});

test('a worn-out kitty watches the toy instead of chasing it, then naps', () => {
  const mind = createMind({ seed: 5 });
  const b = createBrain({ seed: 2, mind, mode: 'sit', timer: 2 });
  b.energy = 0.03;
  b.play();
  const ev = [...b.drain(), ...run(b, 6)];
  assert.ok(types(ev).includes('yarn'), 'the toy is thrown in all the same');
  assert.ok(types(ev).includes('refuse'));
  assert.ok(!types(ev).includes('wiggle') && !types(ev).includes('swat'), 'no pounce, no swat');
  const more = run(b, 40, (x) => x.mode === 'sleep');
  assert.equal(b.mode, 'sleep', `she went to sleep (${types(more).filter((t) => t === 'mind').length} choices)`);
});

test('she learns: good times make her like a thing more, and she remembers across visits', () => {
  const m = createMind({ seed: 8 });
  const before = { pet: m.likes.pet, bond: m.bond };
  for (let i = 0; i < 10; i++) m.outcome('purred');
  assert.ok(m.likes.pet > before.pet + 0.15);
  assert.ok(m.bond > before.bond);
  m.napAt(10, 4); m.napAt(12, 6);
  m.did('nap'); m.did('wander');
  const again = createMind({ seed: 999, saved: JSON.parse(JSON.stringify(m.toJSON())) });
  assert.deepEqual(again.temper, m.temper, 'the same cat, whatever seed is offered');
  assert.ok(Math.abs(again.likes.pet - m.likes.pet) < 0.001);
  assert.ok(Math.abs(again.bond - m.bond) < 0.001);
  assert.deepEqual(again.spot, { x: 11, z: 5, n: 2 });
  assert.equal(again.habit['nap>wander'], 1);
  // rubbish in the save is ignored
  const odd = createMind({ seed: 2, saved: { bond: 'lots', likes: { pet: 99 }, habit: { 'fly>swim': 5, 'nap>sit': -3 }, spot: { x: 'a' } } });
  assert.equal(odd.bond, 0.35);
  assert.equal(odd.likes.pet, 1);
  assert.deepEqual(odd.habit, {});
  assert.equal(odd.spot, null);
});

test('pushing her after a no costs her liking for it; answering her when she asks earns trust', () => {
  let pushedCats = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const c = createMind({ seed });
    const s = calm({ asleep: true, mode: 'sleep' });
    if (c.decide('call', s).yes) continue;                 // she said no...
    const bond = c.bond;
    const d = c.decide('call', { ...s, t: 2 });            // ...and you call again at once
    assert.ok(c.likes.call < 0, 'she likes being called a little less');
    if (!d.yes) assert.ok(c.bond < bond, 'and trusts you a little less when it is still no');
    pushedCats++;
  }
  assert.ok(pushedCats >= 20);
  // what she simply cannot do (truly full) is no slight on you, however often you ask
  const full = createMind({ seed: 4 });
  const b0 = full.bond;
  for (let i = 0; i < 6; i++) full.decide('feed', calm({ t: i, hunger: 0 }));
  assert.equal(full.bond, b0);
  const m = createMind({ seed: 4 });
  const b1 = m.bond;
  m.outcome('answered');
  assert.ok(m.bond > b1);
  m.outcome('ignored');
  assert.ok(m.bond < b1 + 0.02 && m.bond > b1 - 0.02);
});

test('enough is enough: once she has walked off from petting, tapping again at once does not bring her round', () => {
  const m = createMind({ seed: 6 });
  let t = 0, first = null;
  for (; t < 30 && !first; t += 0.3) { const d = m.decide('pet', calm({ t })); if (!d.yes) first = t; }
  assert.ok(first != null);
  for (let k = 1; k <= 8; k++) assert.equal(m.decide('pet', calm({ t: first + k * 0.5 })).yes, false, `still no after ${k * 0.5} s`);
  assert.equal(m.decide('pet', calm({ t: first + 25 })).yes, true, 'later she is glad of it again');
});

test('habits: what she has often done after something, she tends to do again', () => {
  const m = createMind({ seed: 10 });
  assert.equal(m.habitOf('playask', 'nap'), 0);
  for (let i = 0; i < 6; i++) { m.did('playask'); m.did('nap'); }
  assert.ok(m.habitOf('playask', 'nap') > 0.6);
  assert.ok(m.habitOf('playask', 'groom') === 0);
  const r = m.routines();
  assert.equal(r[0].after, 'playask');
  assert.equal(r[0].then, 'nap');
  // the habit tips an otherwise even choice
  let withHabit = 0, without = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const a = createMind({ seed }), c = createMind({ seed });
    for (let i = 0; i < 8; i++) { a.did('wander'); a.did('groom'); }
    a.last = 'wander'; c.last = 'wander';
    const s = calm({ energy: 1 });
    a.play = c.play = 0; a.social = c.social = 0; a.curious = c.curious = 0;
    if (a.choose(s) === 'groom') withHabit++;
    if (c.choose(s) === 'groom') without++;
  }
  assert.ok(withHabit > without + 30, `groom after a stroll: ${withHabit} with the habit, ${without} without`);
});

test('her spot: where she has napped before is where she goes to nap', () => {
  const mind = createMind({ seed: 2 });
  mind.napAt(16, -9); mind.napAt(16, -9); mind.napAt(16, -9);
  const b = createBrain({ seed: 2, mind, mode: 'sit', timer: 0.2 });
  b.energy = 0.02;
  const ev = run(b, 60, (x) => x.mode === 'sleep');
  assert.equal(b.mode, 'sleep');
  assert.ok(Math.hypot(b.x - 16, b.z + 9) < 7, `asleep in her spot (${b.x.toFixed(1)}, ${b.z.toFixed(1)})`);
  assert.ok(types(ev).includes('asleep'));
  assert.equal(mind.spot.n, 4);
});

test('she comes over and asks for a cuddle; pet her and she is glad you answered', () => {
  const mind = createMind({ seed: 3 });                    // a cuddly cat
  mind.social = 1; mind.bond = 0.8; mind.play = 0;
  const b = createBrain({ seed: 2, mind, mode: 'sit', timer: 0.2 });
  b.friend = [22, 4];
  const ev = run(b, 30, (_, all) => all.some((e) => e.type === 'ask'));
  const ask = ev.find((e) => e.type === 'ask');
  assert.ok(ask, 'she asked');
  assert.equal(ask.what, 'cuddle');
  assert.ok(Math.hypot(b.x - 22, b.z - 4) < 10, 'she is beside you');
  assert.equal(mind.thought(b.sense()).text, 'Wants a cuddle');
  const bond = mind.bond;
  assert.notEqual(b.pet(), false);
  const after = b.drain();
  assert.ok(types(after).includes('answered'));
  assert.equal(rewardFor(after.find((e) => e.type === 'answered'), {}), 2, 'two tokens for answering her');
  assert.ok(mind.bond > bond);
  assert.equal(b.asking, null);
  run(b, 3);
  assert.equal(b.mode, 'purr');
});

test('ask and get no answer: she gives up after a while and trusts you a touch less', () => {
  const mind = createMind({ seed: 3 });
  mind.social = 1; mind.bond = 0.8; mind.play = 0;
  const b = createBrain({ seed: 2, mind, mode: 'sit', timer: 0.2 });
  b.friend = [3, 4];                                       // you are right beside her
  const ev = run(b, 40, (_, all) => all.some((e) => e.type === 'ask-end'));
  assert.ok(types(ev).includes('ask'));
  assert.ok(types(ev).includes('ask-end'));
  assert.ok(mind.bond < 0.8);
  assert.equal(b.asking, null);
});

test('her own game with the toy earns no tokens; yours does', () => {
  assert.equal(rewardFor({ type: 'swat', round: 2, solo: true }, {}), 0);
  assert.equal(rewardFor({ type: 'swat', round: 2 }, {}), 1);
});

test('without a mind she does as she is told, exactly as before (the recordings rely on it)', () => {
  const b = createBrain({ seed: 2, mode: 'sit', hunger: 0 });
  b.feed(); b.pet(); b.call(20, 20); b.play();
  const ev = [...b.drain(), ...run(b, 30)];
  for (const t of ['decide', 'refuse', 'mind', 'ask']) assert.ok(!types(ev).includes(t), t);
  assert.ok(types(ev).includes('bowl'));
  assert.equal(b.mind, null);
});

test('twenty minutes of anything: she never breaks, never leaves the world, and keeps choosing', () => {
  const modes = new Set(['sit', 'idle', 'walk', 'trot', 'run', 'face', 'sitdown', 'standup', 'liedown', 'sleep', 'stretch', 'groom', 'eat', 'pounce', 'bat', 'purr', 'meow']);
  for (const seed of [1, 2, 3]) {
    const mind = createMind({ seed });
    const b = createBrain({ seed: seed + 1, mind, mode: 'sit' });
    const r = rng(seed * 31);
    let next = 3, chose = new Set(), decided = 0;
    for (let i = 0; i < 20 * 60 / STEP; i++) {
      if (i % 420 === 0) b.friend = [(r() - 0.5) * 180, (r() - 0.5) * 180];
      if (b.t >= next) {
        next = b.t + 0.5 + r() * 14;
        const k = r();
        if (k < 0.25) b.pet(); else if (k < 0.45) b.play(); else if (k < 0.6) b.feed();
        else if (k < 0.8) b.call((r() - 0.5) * 220, (r() - 0.5) * 220, { quiet: r() < 0.5 });
        else if (k < 0.9 && b.grabYarn()) { b.holdYarn((r() - 0.5) * 60, (r() - 0.5) * 60); b.throwYarn((r() - 0.5) * 40, (r() - 0.5) * 40, 6); }
      }
      b.step(STEP);
      assert.ok(modes.has(b.mode), b.mode);
      assert.ok(Number.isFinite(b.x + b.z + b.heading + b.speed + b.hunger + b.energy + b.happy + mind.bond + mind.play + mind.social));
      assert.ok(Math.hypot(b.x, b.z) <= KITTY.limit + 6, `in the world (${b.x.toFixed(1)}, ${b.z.toFixed(1)})`);
      for (const e of b.drain()) { if (e.type === 'mind') chose.add(e.does); if (e.type === 'decide') decided++; }
    }
    assert.ok(chose.size >= 2, `cat ${seed} chose ${[...chose].join(', ')}`);     // a player this busy leaves her little time of her own
    for (const d of chose) assert.ok(DOINGS.includes(d));
    assert.ok(decided > 50);
    JSON.stringify(mind.toJSON());
  }
});

test('her mind in words', () => {
  const m = createMind({ seed: 3 });
  let d = describeMind(m, calm());
  assert.equal(d.temper.length, 2);
  assert.equal(d.likes, 'Still finding out');
  assert.deepEqual(d.habits, []);
  assert.ok(d.trust >= 1 && d.trust <= 5);
  for (let i = 0; i < 6; i++) { m.outcome('played'); m.did('playask'); m.did('nap'); }
  m.napAt(1, 1); m.napAt(1, 1);
  d = describeMind(m, calm({ hunger: 0.9 }));
  assert.equal(d.feels, 'Hungry');
  assert.equal(d.likes, 'Playing');
  assert.deepEqual(d.habits.slice(0, 2), ['Naps in her own spot', 'After a game she usually naps']);
  assert.equal(describeMind(m, calm({ asleep: true })).feels, 'Asleep');
});

test('she is quick: she makes up her mind in a few millionths of a second', () => {
  const m = createMind({ seed: 9 });
  const s = calm();
  const N = 100000, t0 = performance.now();
  for (let i = 0; i < N; i++) { s.t = i; m.decide(VERBS[i & 3], s); m.choose(s); }
  const each = (performance.now() - t0) / (N * 2) * 1000;   // microseconds
  assert.ok(each < 50, `${each.toFixed(2)} microseconds a decision`);
});
