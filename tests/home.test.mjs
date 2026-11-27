// Day 8: the home. Nobody walks through a wall: in and out is through the door, and round the corners outside.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HOME, HOUSE, homeFrame, toLocal, route, collide, inHouse, WALL_BOXES, OWNER_BED, BASKET, HER_BED_AT, DOOR_IN, DOOR_OUT, outOfHome } from '../src/homelogic.js';

/** is this local point inside a wall (the outer box, not the room, not the doorway)? */
function inWall(p, r = 0) {
  const ax = Math.abs(p.x), az = Math.abs(p.z);
  if (ax >= HOUSE.ox + r || az >= HOUSE.oz + r) return false;           // outside
  if (ax < HOUSE.ix - r && az < HOUSE.iz - r) return false;             // in the room
  if (ax < HOUSE.door - r && p.z > 0) return false;                     // in the doorway
  return true;
}
/** walk a point of radius r from a to b the way a cat does: head for route()'s next spot, then collide() */
function walk(from, to, r = 2.4, speed = 5, max = 120) {
  let { x, z } = from;
  const path = [];
  for (let i = 0; i < max * 60; i++) {
    const w = route(x, z, to.x, to.z, r);
    const dx = w.x - x, dz = w.z - z, d = Math.hypot(dx, dz);
    if (Math.hypot(to.x - x, to.z - z) < 0.3) return { x, z, path, ok: true };
    const s = Math.min(d, speed / 60);
    if (d > 1e-6) { x += (dx / d) * s; z += (dz / d) * s; }
    [x, z] = collide(x, z, r);
    path.push(toLocal(x, z));
  }
  return { x, z, path, ok: false };
}

test('local and world frames are each other\'s inverse; the front of the house faces the start view', () => {
  for (const [lx, lz] of [[0, 0], [10, -3], [-18, 9]]) {
    const w = homeFrame(lx, lz), b = toLocal(w.x, w.z);
    assert.ok(Math.abs(b.x - lx) < 1e-9 && Math.abs(b.z - lz) < 1e-9);
  }
  const out = homeFrame(0, 1);
  const fx = out.x - HOME.x, fz = out.z - HOME.z;
  assert.ok(fx > 0.5 && fz > 0.4, `out of the door is toward the middle and the camera (${fx.toFixed(2)}, ${fz.toFixed(2)})`);
});

test('from all round the house, a cat walks in through the door to her bed, never through a wall', () => {
  const starts = [];
  for (let a = 0; a < 16; a++) { const k = (a / 16) * Math.PI * 2; starts.push(homeFrame(Math.sin(k) * 34, Math.cos(k) * 26)); }
  for (const s of starts) {
    const res = walk(s, HER_BED_AT);
    assert.ok(res.ok, `from (${s.x.toFixed(1)}, ${s.z.toFixed(1)}) she gets there`);
    const bad = res.path.find((p) => inWall(p, -0.05));
    assert.ok(!bad, `never in a wall (from ${s.x.toFixed(1)}, ${s.z.toFixed(1)}: ${bad && `${bad.x.toFixed(2)}, ${bad.z.toFixed(2)}`})`);
  }
});

test('and back out again, to anywhere outside, and round the house to its back', () => {
  for (const t of [homeFrame(0, 30), homeFrame(30, 0), homeFrame(-30, -5), homeFrame(0, -25), homeFrame(25, -20)]) {
    const res = walk(homeFrame(-6, -6), t);
    assert.ok(res.ok, `out to (${t.x.toFixed(1)}, ${t.z.toFixed(1)})`);
    assert.ok(!res.path.find((p) => inWall(p, -0.05)), 'never through a wall');
  }
  const round = walk(homeFrame(0, 25), homeFrame(0, -25));
  assert.ok(round.ok && !round.path.find((p) => inWall(p, -0.05)), 'front to back goes round the side');
});

test('outside, far from the house, a walk is a straight line (route does nothing)', () => {
  const r = route(0, 0, 20, 20, 2);
  assert.deepEqual(r, { x: 20, z: 20 });
  const q = route(10, 30, 40, -10, 2);
  assert.deepEqual(q, { x: 40, z: -10 });
});

test('collide keeps the room\'s edges, the outside and the doorway apart', () => {
  // standing in a wall: pushed to one side of it
  for (const [lx, lz] of [[0, -11], [-19, 0], [19, 4], [-12, 11], [12, 11.3]]) {
    const w = homeFrame(lx, lz), [x, z] = collide(w.x, w.z, 2), p = toLocal(x, z);
    assert.ok(!inWall(p, -0.01), `out of the wall at (${lx}, ${lz}) → (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`);
  }
  // in the doorway: left alone
  const d = homeFrame(0, 11), [x, z] = collide(d.x, d.z, 2);
  assert.ok(Math.abs(x - d.x) < 1e-9 && Math.abs(z - d.z) < 1e-9);
  assert.ok(inHouse(DOOR_IN.x, DOOR_IN.z) && !inHouse(DOOR_OUT.x, DOOR_OUT.z));
});

test('the beds fit: hers, the basket and yours do not overlap and are in the room', () => {
  const her = toLocal(HER_BED_AT.x, HER_BED_AT.z), bk = toLocal(BASKET.x, BASKET.z), ob = OWNER_BED.local;
  assert.ok(Math.hypot(her.x - bk.x, her.z - bk.z) > 6.02 + BASKET.outer, 'her bed and the basket');
  assert.ok(her.x - 6.02 > ob.x + OWNER_BED.w / 2, 'her bed and yours');
  for (const [x, z, r] of [[her.x, her.z, 6.02], [bk.x, bk.z, BASKET.outer]]) assert.ok(Math.abs(x) + r < HOUSE.ix && Math.abs(z) + r < HOUSE.iz, 'inside the walls');
  assert.ok(Math.abs(ob.x) + OWNER_BED.w / 2 < HOUSE.ix && Math.abs(ob.z) + OWNER_BED.l / 2 < HOUSE.iz);
  const side = toLocal(OWNER_BED.side.x, OWNER_BED.side.z);
  assert.ok(side.x > ob.x + OWNER_BED.w / 2 && side.x < her.x - 6.02, 'there is room to stand beside your bed');
  assert.equal(WALL_BOXES.length, 5);
});

test('a spot sent into the walls or onto your bed is moved off them', () => {
  for (const [lx, lz] of [[-11.5, -5.6], [13.2, -5.2], [0, -10.9]]) {
    const w = homeFrame(lx, lz), q = outOfHome(w.x, w.z, 3), p = toLocal(q.x, q.z);
    assert.ok(!inWall(p, -0.01), 'not in a wall');
    const ob = OWNER_BED.local;
    assert.ok(!(Math.abs(p.x - ob.x) < OWNER_BED.w / 2 && Math.abs(p.z - ob.z) < OWNER_BED.l / 2), 'not on your bed');
  }
});

import { createWalker, JUMP, PLAYER } from '../src/player.js';
import { WALL_BOXES as WB, OWNER_BED_BOX } from '../src/homelogic.js';
const BEDSPEC = { lie: OWNER_BED.lie, side: OWNER_BED.side, heading: OWNER_BED.heading, top: OWNER_BED.top };

test('you walk in through the door to your bed, hop in, lie on it, and hop back out', () => {
  const start = homeFrame(-4, 30);
  const w = createWalker({ x: start.x, z: start.z, boxes: [...WB, OWNER_BED_BOX], route });
  w.goToBed(BEDSPEC);
  let walled = 0, t = 0;
  for (; t < 40 && !w.asleep(); t += 1 / 60) { w.step(1 / 60); if (inWall(toLocal(w.x, w.z), -0.05)) walled++; }
  assert.ok(w.asleep(), `in bed (${w.bedState}) after ${t.toFixed(1)} s`);
  assert.equal(walled, 0, 'never through a wall');
  assert.ok(Math.hypot(w.x - OWNER_BED.lie.x, w.z - OWNER_BED.lie.z) < 1e-6 && Math.abs(w.y() - OWNER_BED.top) < 1e-9, 'lying on the mattress');
  assert.equal(w.anim().name, 'Sleep');
  // moving gets you up: a hop back out to the side, then off you go
  w.steer(0, 1);
  w.step(1 / 60);
  assert.equal(w.bedState, 'hop');
  for (let i = 0; i < (JUMP.total + 0.1) * 60; i++) w.step(1 / 60);
  assert.equal(w.bedState, null);
  assert.ok(Math.abs(w.y()) < 1e-9, 'back on the floor');
});

test('the hop into bed is a smooth arc from the floor to the mattress', () => {
  const w = createWalker({ x: OWNER_BED.side.x, z: OWNER_BED.side.z, boxes: [...WB, OWNER_BED_BOX], route });
  w.goToBed(BEDSPEC);
  let last = 0, top = 0;
  for (let i = 0; i < (JUMP.total + 0.2) * 60; i++) {
    w.step(1 / 60);
    const y = w.y();
    assert.ok(Math.abs(y - last) < 0.4, `no jumps in height (${last.toFixed(2)} → ${y.toFixed(2)})`);
    last = y; top = Math.max(top, y);
  }
  assert.ok(w.asleep() && top > OWNER_BED.top + 1, `up and over, then down onto it (top ${top.toFixed(2)})`);
});

test('300 random trips (in, out, round, to the doorway) all arrive, never through a wall', () => {
  let s = 7;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const spot = () => {
    const k = rnd();
    if (k < 0.35) return homeFrame((rnd() - 0.5) * 2 * (HOUSE.ix - 3), (rnd() - 0.5) * 2 * (HOUSE.iz - 3));   // in the room
    if (k < 0.5) return homeFrame((rnd() - 0.5) * 12, HOUSE.oz + 1 + rnd() * 6);                           // just out of the door
    const a = rnd() * Math.PI * 2, d = 30 + rnd() * 25;
    return homeFrame(Math.sin(a) * d, Math.cos(a) * d * 0.8);                                                // all round
  };
  let fails = 0;
  for (let i = 0; i < 300; i++) {
    const r = [1.5, 1.8, 2.4][i % 3];
    const from = spot(), to = spot();
    const [fx, fz] = collide(from.x, from.z, r), [tx, tz] = collide(to.x, to.z, r);
    const res = walk({ x: fx, z: fz }, { x: tx, z: tz }, r, 6, 60);
    const bad = res.path.find((p) => inWall(p, -0.05));
    if (!res.ok || bad) { fails++; if (fails < 4) console.log('trip', i, toLocal(fx, fz), '->', toLocal(tx, tz), res.ok ? 'through a wall' : 'never got there', toLocal(res.x, res.z)); }
  }
  assert.equal(fails, 0);
});

import { createBrain, STEP as KSTEP } from '../src/kittybrain.js';
import { createMind } from '../src/kittymind.js';
import { createFriendBrain } from '../src/friendbrain.js';
import { outOfHome as keepOff } from '../src/homelogic.js';
const HERBED = { x: HER_BED_AT.x, z: HER_BED_AT.z, r: 0.292 * 14, outer: 0.43 * 14, h: 0.062 * 14, ex: Math.sin(HER_BED_AT.rot), ez: Math.cos(HER_BED_AT.rot) };
function homeKitty(x, z, seed = 4) {
  const mind = createMind({ seed });
  const b = createBrain({ seed: 2, mind, mode: 'sit', timer: 99, x, z });
  b.bed = HERBED; b.friend = [x + 8, z + 8];
  b.route = (a, c, tx, tz) => route(a, c, tx, tz, 2.4);
  b.collide = (a, c) => collide(a, c, 2.4, { bed: true, basket: true });
  b.keep = (p) => keepOff(p.x, p.z, 3.2);
  return { b, mind };
}

test('bedtime: from outside she walks in at the door to her bed, and sleeps there until you get up', () => {
  for (const [lx, lz] of [[0, 34], [30, -20], [-34, 10]]) {
    const s = homeFrame(lx, lz), { b } = homeKitty(s.x, s.z);
    assert.ok(b.toBed());
    let walled = 0;
    for (let i = 0; i < 60 / KSTEP && b.mode !== 'sleep'; i++) { b.step(KSTEP); b.drain(); if (inWall(toLocal(b.x, b.z), -0.05)) walled++; }
    assert.equal(b.mode, 'sleep', `from (${lx}, ${lz}) asleep`);
    assert.equal(walled, 0, 'never through a wall');
    assert.ok(Math.hypot(b.x - HERBED.x, b.z - HERBED.z) < HERBED.r * 0.4, 'in the middle of her bed');
    // long after she would have woken by herself, she is still asleep: you are still in bed
    for (let i = 0; i < 240 / KSTEP; i++) { b.step(KSTEP); b.drain(); }
    assert.equal(b.mode, 'sleep', 'still asleep with you');
    assert.ok(b.wakeUp());
    const ev = [];
    for (let i = 0; i < 3 / KSTEP; i++) { b.step(KSTEP); ev.push(...b.drain()); }
    assert.ok(ev.some((e) => e.type === 'wake') && !ev.some((e) => e.type === 'woken'), 'up with a stretch, and not cross');
  }
});

test('she will not leave her dinner for bed', () => {
  const s = homeFrame(0, 30), { b } = homeKitty(s.x, s.z);
  b.mode = 'eat';
  assert.equal(b.toBed(), false);
});

test('Mochi sleeps in its basket while she sleeps in her bed, and goes there when you tap it', () => {
  const asleepInBed = { x: HERBED.x, z: HERBED.z, heading: HER_BED_AT.rot, head: [HERBED.x, 2, HERBED.z], mode: 'sleep', asleep: true, moving: false, playing: false, eating: false, yarn: null, bowl: null };
  const start = homeFrame(0, 28);
  const f = createFriendBrain({ seed: 3, x: start.x, z: start.z, mode: 'sit' });
  const world = { kitty: asleepInBed, player: null, bed: HERBED, basket: BASKET,
    route: (a, c, tx, tz) => route(a, c, tx, tz, 1.6), collide: (a, c, r, ok) => collide(a, c, r, { bed: true, basket: !ok }) };
  let walled = 0;
  for (let i = 0; i < 40 * 60 && !(f.isAsleep() && f.mode === 'sleep'); i++) { f.step(1 / 60, world); f.drain(); if (inWall(toLocal(f.x, f.z), -0.05)) walled++; }
  assert.equal(f.mode, 'sleep');
  assert.equal(walled, 0, 'never through a wall');
  assert.ok(Math.hypot(f.x - BASKET.x, f.z - BASKET.z) < 1.2, `in its basket (${Math.hypot(f.x - BASKET.x, f.z - BASKET.z).toFixed(2)} m off)`);
  const out = Math.sin(f.heading) * BASKET.ex + Math.cos(f.heading) * BASKET.ez;
  assert.ok(out > 0.85, 'facing out of the basket');
  // she wakes and goes out: so does it
  world.kitty = { ...asleepInBed, mode: 'sit', asleep: false, x: start.x, z: start.z, head: [start.x, 2, start.z] };
  for (let i = 0; i < 4 * 60; i++) { f.step(1 / 60, world); f.drain(); }
  assert.notEqual(f.mode, 'sleep', 'up again');
  // tap the basket: in it goes, even though she is awake, for its nap
  assert.ok(f.toBasket(30));
  for (let i = 0; i < 30 * 60 && f.mode !== 'sleep'; i++) { f.step(1 / 60, world); f.drain(); }
  assert.equal(f.mode, 'sleep');
  assert.ok(Math.hypot(f.x - BASKET.x, f.z - BASKET.z) < 1.2, 'in the basket');
});
