// Day 3: the kitty has feelings. She sleeps when she wants, is cross when you get her up, and it shows on her face.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrain, STEP } from '../src/kittybrain.js';
import { createMind, EMOTIONS, describeMind } from '../src/kittymind.js';
import { EMOTES, emoteSVG } from '../src/emotes.js';

const calm = (over = {}) => ({ t: 0, hunger: 0.4, energy: 0.8, happy: 0.6, mode: 'sit', asleep: false, playing: false, moving: false,
  food: false, ateAgo: 999, toy: false, asking: null, friend: true, friendDist: 12, ...over });
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
/** a kitty fast asleep and still tired */
function sleeper(seed = 6) {
  const mind = createMind({ seed });
  mind.sleepy = 0.9;
  const b = createBrain({ seed: 2, mind, mode: 'sleep', timer: 30 });
  b.energy = 0.3;
  b.friend = [4, 6];
  run(b, 0.5);
  return { b, mind };
}

test('there is a face for every feeling, and a feeling for every face', () => {
  assert.deepEqual(Object.keys(EMOTIONS).sort(), EMOTES.slice().sort());
  for (const id of EMOTES) {
    const svg = emoteSVG(id);
    assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>') && svg.includes(`emote-${id}`), id);
    assert.ok(!/NaN|undefined/.test(svg), id);
    assert.equal((svg.match(/<svg/g) || []).length, 1);
  }
  assert.ok(emoteSVG('no-such-feeling').includes('emote-content'));
  assert.notEqual(emoteSVG('angry'), emoteSVG('furious'));
});

test('her feelings follow what happens to her', () => {
  const m = createMind({ seed: 5 });
  assert.equal(m.emotion(calm()).id, 'content');
  assert.equal(m.emotion(calm({ asleep: true })).id, 'asleep');
  assert.equal(m.emotion(calm({ hunger: 0.9 })).id, 'hungry');
  assert.equal(m.emotion(calm({ energy: 0.1 })).id, 'sleepy');
  assert.equal(m.emotion(calm({ playing: true })).id, 'playful');
  m.outcome('purred');
  assert.equal(m.emotion(calm()).id, 'loving');
  const sad = createMind({ seed: 5 });
  sad.outcome('ignored');
  assert.equal(sad.emotion(calm()).id, 'sad');
  assert.equal(sad.thought(calm()).text, 'Feeling sad');
  sad.outcome('answered');
  assert.notEqual(sad.emotion(calm()).id, 'sad');
  const glad = createMind({ seed: 5 });
  glad.outcome('played');
  assert.equal(glad.emotion(calm()).id, 'happy');
  for (const id of ['content', 'asleep', 'hungry', 'sleepy', 'playful', 'loving', 'sad', 'happy']) assert.ok(EMOTIONS[id]);
});

test('get her up before she has slept enough and she is angry with you', () => {
  const { b, mind } = sleeper();
  assert.equal(b.mode, 'sleep');
  assert.equal(b.pet(), false, 'no purring for that');
  const ev = b.drain();
  const woken = ev.find((e) => e.type === 'woken');
  assert.ok(woken && woken.angry === true);
  assert.ok(types(ev).includes('grumble'), 'a cross meow');
  assert.ok(!types(ev).includes('pet') && !types(ev).includes('purr'));
  assert.equal(b.mode, 'stretch', 'but she does get up');
  const after = run(b, 0.6);
  const feel = after.find((e) => e.type === 'feel');
  assert.ok(feel && ['angry', 'furious'].includes(feel.id), `she feels ${feel?.id}`);
  assert.ok(['angry', 'furious'].includes(mind.emotion(b.sense()).id));
  assert.match(mind.thought(b.sense()).text, /Cross with you|Leave me alone!/);
  assert.equal(mind.thought(b.sense()).kind, 'no');
  assert.ok(b.snub > b.t, 'her nose is turned away');
  assert.equal(describeMind(mind, b.sense()).feeling, mind.emotion(b.sense()).id);
});

test('while she is angry she wants to be left alone, however often you try', () => {
  const { b, mind } = sleeper();
  b.pet();
  run(b, 4);
  for (let i = 0; i < 5; i++) {
    assert.equal(b.pet(), false, `pet ${i + 1}`);
    assert.equal(mind.lastDecision.why, 'angry');
    run(b, 0.6);
  }
  assert.equal(mind.decide('play', b.sense()).yes, false);
  assert.equal(mind.decide('call', b.sense()).yes, false);
  assert.ok(mind.mood.anger > 0.45, 'pestering does not calm her');
});

test('a furious kitty stalks off, away from you', () => {
  const { b, mind } = sleeper(6);                          // an independent cat she hardly knows: furious
  b.pet();
  assert.ok(mind.mood.anger >= 0.75);
  const start = Math.hypot(b.x - 4, b.z - 6);
  const ev = run(b, 14);
  assert.ok(types(ev).filter((t) => t === 'grumble').length >= 1);
  assert.ok(Math.hypot(b.x - 4, b.z - 6) > start + 4, 'she has put some distance between you');
});

test('her anger passes with time, and dinner mends it sooner', () => {
  const { b, mind } = sleeper();
  b.pet();
  const anger0 = mind.mood.anger;
  const ev = run(b, 90, () => mind.mood.anger < 0.1);
  assert.ok(mind.mood.anger < 0.1, 'it wears off');
  const seen = ev.filter((e) => e.type === 'feel').map((e) => e.id);
  assert.ok(seen.includes('grumpy') || seen.includes('asleep'), `on the way down she is a bit cross, or she went back to sleep (${seen.join(', ')})`);
  assert.notEqual(mind.emotion(b.sense()).id, 'angry');
  const half = createMind({ seed: 6 });
  half.mood.anger = 0.3;
  assert.equal(half.emotion({ ...b.sense(), asleep: false }).id, 'grumpy');
  half.mood.anger = 0.6;
  assert.equal(half.emotion({ ...b.sense(), asleep: false }).id, 'angry');
  half.mood.anger = 0.9;
  assert.equal(half.emotion({ ...b.sense(), asleep: false }).id, 'furious');
  const fed = createMind({ seed: 6 });
  fed.feel('woken');
  const before = fed.mood.anger;
  fed.outcome('ate');
  assert.ok(fed.mood.anger <= before - 0.45 && before >= anger0 - 0.01);
});

test('the better she knows you, the less cross she is at being woken', () => {
  const stranger = createMind({ seed: 3 }), friend = createMind({ seed: 3 });
  friend.bond = 1;
  stranger.feel('woken'); friend.feel('woken');
  assert.ok(friend.mood.anger < stranger.mood.anger - 0.15);
});

test('wake her when she has slept enough and she does not mind at all', () => {
  const mind = createMind({ seed: 3 });
  mind.sleepy = 0;
  const b = createBrain({ seed: 2, mind, mode: 'sleep', timer: 30 });
  b.energy = 1;
  b.friend = [4, 6];
  assert.notEqual(b.pet(), false);
  const ev = [...b.drain(), ...run(b, 6)];
  assert.equal(ev.find((e) => e.type === 'woken').angry, false);
  assert.ok(types(ev).includes('purr'), 'she purrs');
  assert.ok(mind.mood.anger < 0.05);
});

test('left to herself she goes to sleep when she has had enough, and wakes when she is rested', () => {
  const mind = createMind({ seed: 5 });
  const b = createBrain({ seed: 2, mind, mode: 'sit' });
  b.friend = [40, 40];
  const ev = run(b, 8 * 60);
  const naps = ev.filter((e) => e.type === 'asleep').length, wakes = ev.filter((e) => e.type === 'wake').length;
  assert.ok(naps >= 1, 'she slept without being told to');
  assert.ok(wakes >= 1 || b.isAsleep(), 'and got up again by herself');
  const feels = new Set(ev.filter((e) => e.type === 'feel').map((e) => e.id));
  assert.ok(feels.has('asleep') && feels.size >= 3, `she felt ${[...feels].join(', ')}`);
  for (const id of feels) assert.ok(EMOTIONS[id], id);
  assert.ok(!ev.some((e) => e.type === 'woken'), 'nobody woke her');
});

test('her sleep lasts until she has slept enough', () => {
  const mind = createMind({ seed: 5 });
  mind.sleepy = 1;
  const b = createBrain({ seed: 2, mind, mode: 'sleep', timer: 5 });
  b.energy = 0.1;
  const ev = run(b, 120, (x) => !x.isAsleep());
  assert.ok(b.t > 20, `a proper sleep (${b.t.toFixed(0)} s)`);
  assert.ok(b.t < 100, 'not for ever');
  assert.ok(b.energy > 0.95);
  assert.ok(types(ev).includes('wake'));
  assert.ok(mind.mood.joy > 0.2, 'she wakes in a good mood');
});
