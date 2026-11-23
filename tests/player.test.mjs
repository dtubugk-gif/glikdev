// Day 3: you (the walker's logic, without three.js), the shop's place on the plate, and the toys.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ITEMS, createWallet } from '../src/tokens.js';
import { createBrain, YARN, STEP } from '../src/kittybrain.js';

const GAME = join(dirname(fileURLToPath(import.meta.url)), '..');
// player.js and town.js import three.js for their drawing halves; the logic under test is plain maths, so
// the tests read the sources and run just those parts.
const src = (f) => readFileSync(join(GAME, 'src', f), 'utf8').replace(/\r\n/g, '\n');
const walkerSrc = src('player.js').split('/**\n * @param {{scene:THREE.Scene')[0].replace(/^import .*$/gm, '').replace(/export /g, '');
const { PLAYER, createWalker, outOfBox } = new Function(`${walkerSrc}; return { PLAYER, createWalker, outOfBox };`)();
const run = (w, seconds) => { for (let i = 0; i < seconds * 60; i++) w.step(1 / 60); };

test('walks to a tapped spot and stops there; far spots are run to', () => {
  const w = createWalker({ x: 0, z: 0 });
  w.goTo(3, 0);
  let top = 0;
  for (let i = 0; i < 240; i++) { w.step(1 / 60); top = Math.max(top, w.speed); }
  assert.ok(Math.hypot(w.x - 3, w.z) < 0.3, `stopped at ${w.x.toFixed(2)}, ${w.z.toFixed(2)}`);
  assert.equal(w.target, null);
  assert.ok(top <= PLAYER.walk + 0.01, 'a short trip is walked');
  w.goTo(40, 10);
  top = 0;
  for (let i = 0; i < 600; i++) { w.step(1 / 60); top = Math.max(top, w.speed); }
  assert.ok(top > PLAYER.walk * 1.5, 'a long trip is run');
  assert.ok(Math.hypot(w.x - 40, w.z - 10) < 0.3);
  assert.equal(w.anim().name, 'Idle');
});

test('keys: walks while a direction is held, stops when it is let go', () => {
  const w = createWalker({});
  w.steer(1, 0);
  run(w, 1);
  assert.ok(w.x > 4 && Math.abs(w.z) < 0.5);
  assert.equal(w.anim().name, 'Run');
  w.steer(0, 0);
  run(w, 1);
  assert.equal(w.speed, 0);
});

test('never leaves the plate, never walks through a wall or the kitty', () => {
  const box = { x: 10, z: 0, hx: 3, hz: 2, rot: 0.6 };
  const w = createWalker({ x: 0, z: 0, boxes: [box], circles: [() => ({ x: -8, z: 0, r: 2.4 })] });
  const inside = (x, z) => { const [ox, oz] = outOfBox(x, z, box, PLAYER.radius - 0.01); return ox !== x || oz !== z; };
  w.goTo(20, 0);                                            // straight through the box
  for (let i = 0; i < 600; i++) { w.step(1 / 60); assert.ok(!inside(w.x, w.z), 'inside the wall'); }
  w.goTo(10, 0);                                            // a spot inside it: she ends up outside
  run(w, 6);
  assert.ok(!inside(w.x, w.z));
  w.goTo(-16, 0);                                           // through the kitty
  for (let i = 0; i < 900; i++) { w.step(1 / 60); assert.ok(Math.hypot(w.x + 8, w.z) >= 2.4 + PLAYER.radius - 0.05, 'inside the kitty'); }
  w.steer(1, 0.2);
  run(w, 40);
  assert.ok(Math.hypot(w.x, w.z) <= PLAYER.limit + 0.01);
});

test('waving happens only while standing', () => {
  const w = createWalker({});
  w.wave();
  run(w, 0.2);
  assert.equal(w.anim().name, 'Wave');
  run(w, 3);
  assert.equal(w.anim().name, 'Idle');
  w.goTo(9, 9); w.wave();
  run(w, 0.5);
  assert.notEqual(w.anim().name, 'Wave');
});

test('the shop: its doormat is in front of the counter, outside its walls, and the demo knows where it is', () => {
  const t = src('town.js');
  const m = /export const SHOP = \{ x: (-?[\d.]+), z: (-?[\d.]+)/.exec(t);
  const SHOP = { x: +m[1], z: +m[2] };
  SHOP.rot = Math.atan2(-SHOP.x, -SHOP.z);
  const B = /const BOX = \{ cz: (-?[\d.]+), hx: ([\d.]+), hz: ([\d.]+) \}/.exec(t), stand = +/const STAND = ([\d.]+)/.exec(t)[1];
  const c = Math.cos(SHOP.rot), s = Math.sin(SHOP.rot);
  const toWorld = (lx, lz) => ({ x: SHOP.x + c * lx + s * lz, z: SHOP.z - s * lx + c * lz });
  const door = toWorld(0, stand), mid = toWorld(0, +B[1]);
  const box = { ...mid, hx: +B[2], hz: +B[3], rot: SHOP.rot };
  const [ox, oz] = outOfBox(door.x, door.z, box, PLAYER.radius);
  assert.ok(ox === door.x && oz === door.z, 'the doormat is outside the walls');
  assert.ok(Math.hypot(door.x, door.z) < Math.hypot(SHOP.x, SHOP.z), 'the counter faces the middle of the plate');
  assert.ok(Math.hypot(SHOP.x, SHOP.z) > 24 + 9, 'outside where the kitty wanders');
  const d = /const SHOP_DOOR = \[(-?[\d.]+), (-?[\d.]+)\]/.exec(src('demo.js'));
  assert.ok(Math.hypot(+d[1] - door.x, +d[2] - door.z) < 0.05, `demo.js SHOP_DOOR should be ${door.x.toFixed(2)}, ${door.z.toFixed(2)}`);
  for (const f of ['player.glb', 'shop.glb']) assert.ok(existsSync(join(GAME, 'models', f)), f);
});

test('toys: one is out at a time, and putting it away brings the yarn back', () => {
  const toys = ITEMS.filter((i) => i.slot === 'toy');
  assert.equal(toys.length, 5);                           // four from Day 3, and Day 4's fish on a stick
  for (const t of toys) {
    assert.equal(typeof t.roll, 'boolean');
    assert.ok(t.bounce > 0 && t.bounce < 0.9);
    assert.ok(existsSync(join(GAME, 'models', 'shop', `${t.id}.webp`)), `${t.id}.webp`);
  }
  const w = createWallet({ tokens: 40 });
  assert.equal(w.buy('toymouse'), true);
  assert.equal(w.wearing.toy, 'toymouse');
  assert.equal(w.buy('toyball'), true);
  assert.equal(w.wearing.toy, 'toyball', 'the new toy is the one that is out');
  assert.equal(w.wear('toymouse'), true);
  assert.equal(w.takeOff('toy'), true);
  assert.equal(w.wearing.toy, null);
});

test('a bouncier toy really bounces higher than the yarn', () => {
  const peak = (bounce) => {
    const b = createBrain({ seed: 2, mode: 'sit' });
    b.toyBounce = bounce;
    b.play();
    for (let i = 0; i < 90; i++) b.step(STEP);
    b.grabYarn(); b.holdYarn(20, 0);
    for (let i = 0; i < 40; i++) b.step(STEP);
    b.throwYarn(4, 0, 12);
    let hit = false, top = 0;
    for (let i = 0; i < 400; i++) {
      const before = b.yarn.vy;
      b.step(STEP);
      const y = b.yarn;
      if (!hit && before < 0 && y.vy > 0) hit = true;
      else if (hit && y.air) top = Math.max(top, y.y);
    }
    return top;
  };
  assert.ok(peak(0.66) > peak(undefined) * 1.5, `${peak(0.66)} vs ${peak(undefined)}`);
});
