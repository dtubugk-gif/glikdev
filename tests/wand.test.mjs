// Day 4: the fish on a stick (idea by @Darkbacon155). The fish on its line (kittybrain.js), the rod in your
// hand (the walker in player.js, without three.js), buying it in the shop, the model file and the demos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ITEMS, NEW_ITEM, itemById, createWallet, rewardFor } from '../src/tokens.js';
import { createBrain, YARN, WAND, STEP, KITTY } from '../src/kittybrain.js';
import { DEMOS, KITTY_DEMOS, demoPose } from '../src/demo.js';

const GAME = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => readFileSync(join(GAME, 'src', f), 'utf8').replace(/\r\n/g, '\n');
const walkerSrc = src('player.js').split('/**\n * @param {{scene:THREE.Scene')[0].replace(/^import .*$/gm, '').replace(/export /g, '');
const { PLAYER, HOLD, flick, createWalker } = new Function(`${walkerSrc}; return { PLAYER, HOLD, flick, createWalker };`)();

const TIP = [3, 6.6, 8];
const far = (y, A) => Math.hypot(y.x - A[0], y.y - A[1], y.z - A[2]);
/** a kitty with the wand out; `each` runs after every step */
function wandBrain(o = {}) {
  const b = createBrain({ x: 0, z: -8, ...o });
  b.wandTip = TIP.slice();
  b.setWand(true);
  return b;
}
function run(b, seconds, each) {
  const events = [];
  for (let i = 0; i < Math.round(seconds / STEP); i++) { b.step(STEP); for (const e of b.drain()) events.push(e); each?.(b); }
  return events;
}

test('the fish on a stick is in the shop, has a price, is the new thing, and rings', () => {
  const it = itemById('toywand');
  assert.ok(it && it.wand && it.slot === 'toy' && it.jingle);
  assert.ok(it.price >= 8 && it.price <= 20, 'a few minutes of looking after her');
  assert.equal(NEW_ITEM, 'toywand');
  assert.equal(ITEMS.filter((i) => i.wand).length, 1);
});

test('wallet: the fish on a stick has to be bought; then it is yours, out, and stays yours', () => {
  const price = itemById('toywand').price;
  const w = createWallet();
  assert.equal(w.owns('toywand'), false, 'nobody starts with it');
  assert.equal(w.wearing.toy, null);
  assert.equal(w.buy('toywand'), false, 'not without tokens');
  w.earn(price - 1);
  assert.equal(w.canBuy('toywand'), false);
  assert.equal(w.buy('toywand'), false, 'one token short');
  w.earn(1);
  assert.equal(w.canBuy('toywand'), true);
  assert.equal(w.buy('toywand'), true);
  assert.equal(w.tokens, 0, 'it cost its price');
  assert.equal(w.wearing.toy, 'toywand', 'bought, it is in your hand');
  assert.equal(w.buy('toywand'), false, 'not twice');
  // put away, saved, loaded again: it stays away, and is still yours
  w.takeOff('toy');
  const again = createWallet(JSON.parse(JSON.stringify(w)));
  assert.equal(again.wearing.toy, null);
  assert.equal(again.owns('toywand'), true);
  assert.equal(again.wear('toywand'), true);
  assert.equal(createWallet(JSON.parse(JSON.stringify(again))).wearing.toy, 'toywand');
});

test('wallet: a save from when it was a present gives it back, keeps everything else, and can buy it', () => {
  const gifted = { tokens: 9, earned: 30, owned: ['toyball', 'toywand', 'bowtie'], wearing: { toy: 'toywand', neck: 'bowtie' }, gifts: ['toywand'] };
  const w = createWallet(gifted);
  assert.equal(w.owns('toywand'), false);
  assert.equal(w.wearing.toy, null, 'no rod in your hand');
  assert.equal(w.owns('toyball') && w.owns('bowtie'), true);
  assert.equal(w.wearing.neck, 'bowtie');
  assert.equal(w.tokens, 9);
  assert.equal(w.earned, 30);
  assert.equal('gifts' in w.toJSON(), false, 'the old list is not written again');
  w.earn(10);
  assert.equal(w.buy('toywand'), true);
  const again = createWallet(JSON.parse(JSON.stringify(w)));
  assert.equal(again.owns('toywand'), true, 'bought: it stays');
  assert.equal(again.wearing.toy, 'toywand');
  // a broken list of presents never throws, and never gives anything away
  for (const bad of [{ gifts: 'all' }, { gifts: ['nope', 7] }, { gifts: null }]) assert.equal(createWallet(bad).owns('toywand'), false);
  assert.equal(createWallet({ owned: ['toywand'], gifts: 'all' }).owns('toywand'), true, 'only a real list takes it back');
});

test('out of its bag, the fish hangs under the tip of the stick and she does not chase it', () => {
  const b = wandBrain();
  const y = b.yarn;
  assert.ok(y.wand && y.hang);
  run(b, 3, () => assert.ok(Math.abs(far(b.yarn, TIP) - WAND.rest) < 0.05, 'a line length under the tip'));
  assert.ok(Math.hypot(y.x - TIP[0], y.z - TIP[2]) < 0.05, 'straight under it when you stand still');
  assert.equal(b.mode, 'sit', 'she just watches it');
  assert.equal(b.goal, null);
  // the tip moves (you walk): the fish swings after it, never further than its line
  for (let i = 0; i < 240; i++) { b.wandTip = [TIP[0] + i * 0.08, TIP[1], TIP[2]]; b.step(STEP); assert.ok(far(b.yarn, b.wandTip) < WAND.rest + 0.05); }
  assert.ok(b.yarn.x < b.wandTip[0], 'it trails behind the tip');
});

test('cast: it flies out, lands where it was sent, she pounces and bats it three times, then it is reeled in', () => {
  const b = wandBrain();
  run(b, 0.5);
  assert.equal(b.cast(1, -1), true);
  assert.equal(b.yarn.hang, false);
  assert.equal(b.yarn.air, true);
  let top = 0, landed = null;
  const ev = run(b, 30, (k) => {
    const y = k.yarn;
    top = Math.max(top, y.y);
    assert.ok(far(y, k.wandTip) <= y.line + 0.02, 'never further from the tip than its line');
    assert.ok(y.y >= YARN.radius - 1e-6, 'never under the floor');
    if (!landed && !y.air) landed = { x: y.x, z: y.z };
  });
  const types = ev.map((e) => e.type);
  assert.ok(types.includes('cast'));
  assert.ok(top > TIP[1] - WAND.rest, 'it rises on the way out');
  assert.ok(Math.hypot(landed.x - 1, landed.z + 1) < 3, `landed near the spot (${landed.x.toFixed(1)}, ${landed.z.toFixed(1)})`);
  assert.equal(types.filter((t) => t === 'swat').length, 3);
  assert.ok(types.includes('reeled'), 'when her game is over the line is wound in');
  assert.ok(types.indexOf('reeled') > types.lastIndexOf('swat'));
  assert.equal(b.yarn.hang, true);
  assert.ok(Math.abs(far(b.yarn, TIP) - WAND.rest) < 0.3);
  // every swat that is not her own game earns a token
  const state = {};
  assert.equal(ev.reduce((n, e) => n + rewardFor(e, state), 0), 3);
});

test('a cast lands no nearer and no further than the line allows, and never off the plate', () => {
  for (const [x, z] of [[TIP[0] + 0.5, TIP[2]], [300, 0], [0, -400]]) {
    const b = wandBrain({ x: 60, z: 60 });
    b.cast(x, z);
    let landed = null;
    run(b, 2.5, (k) => { if (!landed && !k.yarn.air) landed = [k.yarn.x, k.yarn.z]; });
    const d = Math.hypot(landed[0] - TIP[0], landed[1] - TIP[2]);
    assert.ok(d > WAND.castMin - 2.5 && d < WAND.castMax + 2.5, `landed ${d.toFixed(1)} m from the tip`);
    assert.ok(Math.hypot(...landed) <= KITTY.limit + 0.01);
  }
});

test('Play casts the fish to her; a second cast in mid game sends her after it again', () => {
  const b = wandBrain();
  b.play();
  assert.equal(b.yarn.air, true, 'Play is a cast when the stick is out');
  const first = run(b, 6);
  assert.ok(first.some((e) => e.type === 'leap'), 'she pounced');
  const before = { x: b.yarn.x, z: b.yarn.z };
  assert.equal(b.cast(TIP[0] + 9, TIP[2] - 6), true);
  const ev = run(b, 12);
  assert.ok(Math.hypot(b.yarn.x - before.x, b.yarn.z - before.z) > 2 || b.yarn.hang, 'the fish went somewhere new');
  assert.ok(ev.some((e) => e.type === 'swat'), 'and she batted it there');
});

test('dangle: she is close, the fish stays on your rod and she pounces at it and bats it so it swings', () => {
  const b = createBrain({ x: 5, z: 2.5 });                  // close to the hanging fish
  b.wandTip = TIP.slice();
  b.setWand(true);
  run(b, 0.5);
  b.play();                                                 // Play, with her this near, dangles it
  assert.equal(b.yarn.hang, true, 'the fish is not cast: it stays on the rod');
  assert.equal(b.yarn.dangle, true);
  let swung = 0;
  const ev = run(b, 26, (k) => {
    assert.ok(far(k.yarn, TIP) <= WAND.rest + 0.05, 'always on the end of the rod');
    swung = Math.max(swung, Math.hypot(k.yarn.x - TIP[0], k.yarn.z - TIP[2]));
  });
  const types = ev.map((e) => e.type);
  assert.ok(types.includes('dangle') && types.includes('leap'));
  assert.equal(types.filter((t) => t === 'swat').length, 3);
  assert.ok(swung > 0.8, `a swat makes it swing (${swung.toFixed(2)} m)`);
  assert.ok(types.includes('dangle-end'));
  assert.equal(b.yarn.dangle, false, 'her game over, the rod comes up again');
  assert.equal(b.yarn.hang, true);
  // from far away the same button casts it
  const c = wandBrain();
  c.play();
  assert.equal(c.yarn.air, true);
  assert.ok(!c.yarn.dangle);
});

test('walk away and the fish is dragged along behind you on its line; she follows it', () => {
  const b = wandBrain();
  b.cast(0, -1);
  run(b, 1.6);
  const start = { x: b.yarn.x, z: b.yarn.z, kx: b.x, kz: b.z };
  let pulled = 0;
  for (let i = 0; i < 60 * 5; i++) {                       // you run off at 9 m/s
    b.wandTip = [TIP[0] + i * STEP * 9, TIP[1], TIP[2]];
    b.step(STEP); b.drain();
    assert.ok(far(b.yarn, b.wandTip) <= b.yarn.line + 0.05);
    pulled = Math.max(pulled, Math.hypot(b.yarn.vx, b.yarn.vz));
  }
  assert.ok(b.yarn.x - start.x > 25, 'the fish came along');
  assert.ok(pulled > 6, 'and it moves at about your speed');
  assert.ok(b.x - start.kx > 12, 'and she ran after it');
});

test('in your fingers: the fish can be carried and flung, but never beyond its line; she never bats it there', () => {
  const b = wandBrain();
  assert.equal(b.grabYarn(), true);
  assert.equal(b.yarn.hang, false);
  b.holdYarn(TIP[0] + 60, TIP[2]);                         // far past the end of the line
  run(b, 1.5, (k) => assert.ok(far(k.yarn, TIP) <= WAND.max + 0.05));
  assert.equal(b.cast(0, 0), false, 'not while it is in your fingers');
  b.throwYarn(30, 0, 12);
  const ev = run(b, 3, (k) => assert.ok(far(k.yarn, TIP) <= k.yarn.line + 0.05));
  assert.ok(ev.some((e) => e.type === 'toss'));
  assert.ok(!b.yarn.held);
});

test('put away: the fish is gone, a game in progress stops, and Play is the yarn ball again', () => {
  const b = wandBrain();
  b.play();
  run(b, 2.5);
  b.setWand(false);
  assert.equal(b.yarn, null);
  run(b, 2);
  assert.notEqual(b.goal, 'yarn');
  b.play();
  assert.ok(b.yarn && !b.yarn.wand, 'the yarn ball comes out');
  b.setWand(true);
  assert.ok(b.yarn.wand && b.yarn.hang, 'the stick takes the yarn\'s place');
});

test('the same seed and the same casts give the very same game (recordings depend on it)', () => {
  const play = () => {
    const b = wandBrain({ seed: 5 });
    run(b, 1); b.castNear(); run(b, 7); b.cast(-6, -2);
    return JSON.stringify([run(b, 10).map((e) => [e.t.toFixed(4), e.type]), b.x, b.z, b.yarn.x, b.yarn.z]);
  };
  assert.equal(play(), play());
});

test('your arm: the rod is as long as the model says, rests up and to your right, and flicks on a cast', () => {
  const w = createWalker({ x: 4, z: -2, heading: 0.7 });
  w.setWand(true);
  for (let i = 0; i < 120; i++) w.step(1 / 60);
  const r = w.rod();
  assert.ok(Math.abs(Math.hypot(...r.dir) - 1) < 1e-9 && Math.abs(Math.hypot(...r.lean) - 1) < 1e-9);
  assert.ok(Math.abs(r.dir[0] * r.lean[0] + r.dir[1] * r.lean[1] + r.dir[2] * r.lean[2]) < 1e-9, 'the lean is square to the rod');
  assert.ok(r.dir[1] > 0.6, 'held up');
  assert.ok(r.dir[0] < -0.1, 'and out to your right (your right is -x)');
  const tip = w.tip();
  const c = Math.cos(w.heading), s = Math.sin(w.heading);
  const grip = [w.x + r.grip[0] * c + r.grip[2] * s, r.grip[1], w.z - r.grip[0] * s + r.grip[2] * c];
  assert.ok(Math.abs(Math.hypot(tip[0] - grip[0], tip[1] - grip[1], tip[2] - grip[2]) - Math.hypot(HOLD.len, HOLD.droop)) < 1e-6);
  assert.ok(tip[1] > PLAYER.eye, 'the tip is over your head');
  // the flick: back first, then forward and down, then still
  assert.equal(flick(-1), 0);
  assert.ok(flick(0.08) > 0.6);
  assert.ok(flick(0.24) < -0.2);
  assert.equal(flick(HOLD.swing), 0);
  const before = w.tip()[1];
  w.cast(w.x + 10 * Math.sin(w.heading), w.z + 10 * Math.cos(w.heading));
  let low = Infinity;
  for (let i = 0; i < 40; i++) { w.step(1 / 60); low = Math.min(low, w.tip()[1]); }
  assert.ok(low < before - 0.8, 'the tip whips down');
  // the fish is out on the floor to your left: the rod comes down and turns toward it
  w.setAim([w.x + 9 * Math.sin(w.heading + 1), YARN.radius, w.z + 9 * Math.cos(w.heading + 1)], true);
  for (let i = 0; i < 120; i++) w.step(1 / 60);
  assert.ok(w.rod().dir[1] < 0.45 && w.rod().dir[0] > 0.5);
  // you cannot wave with the stick in your hand
  w.wave();
  assert.equal(w.anim().name, 'Idle');
});

test('the model file has the rod, its tip, the fish and her loop, where the game expects them', () => {
  const buf = readFileSync(join(GAME, 'models', 'wand.glb'));
  const gltf = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8'));
  const node = (n) => gltf.nodes.find((x) => x.name === n);
  for (const n of ['WandRod', 'WandTip', 'WandFish', 'FishLoop', 'FishTail', 'FishDorsal', 'FishFinP', 'FishFinN']) assert.ok(node(n), n);
  const tip = node('WandTip').translation;                  // glTF is Y up: the rod stands along +Y, its tip leans to +Z
  assert.ok(Math.abs(tip[1] * HOLD.scale - HOLD.len) < 0.02 && Math.abs(tip[2] * HOLD.scale - HOLD.droop) < 0.02, `tip at ${tip}`);
  assert.ok(Math.abs(tip[0]) < 1e-4);
  const loop = node('FishLoop').translation;
  assert.ok(loop[1] > 0.02 && loop[1] < 0.05, 'the loop is on her back');
  assert.ok(buf.length < 2 * 1024 * 1024, 'under 2 MB');
  assert.ok(src('wand.js').includes("'WandRod'") && src('wand.js').includes("'FishLoop'"));
});

test('the Day 4 demos exist, give you the stick and have a camera', () => {
  const home = { az: 0.32, pol: 1.05, dist: 32, target: [0, 0, 0], shift: 0, fov: 60, horizon: 0.42 };
  for (const d of ['kittyfish', 'fishwalk', 'fishdangle']) {
    assert.ok(DEMOS.includes(d) && KITTY_DEMOS[d], d);
    assert.ok(KITTY_DEMOS[d].player, 'you are in the shot (the stick is in your hand)');
    assert.ok(KITTY_DEMOS[d].script.some((s) => s.type === 'wear' && s.id === 'toywand'));
    assert.ok(KITTY_DEMOS[d].script.some((s) => ['cast', 'castnear', 'dangle'].includes(s.type)));
    const pose = demoPose(d, 2, home, { x: 0, z: 0, heading: 0, head: [0, 5, 0], bowl: null, yarn: { x: 3, z: 3 }, player: { x: -3, z: 4 } });
    assert.ok(pose && pose.position.every(Number.isFinite) && pose.look.every(Number.isFinite));
  }
});
