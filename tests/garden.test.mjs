// Day 7: parrots, seeds, the garden and its mutations (pure logic) + the files they need.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { FRUITS, MUTATIONS, fruitById, mutationById, mutationFor, stageAt, harvestValue, createPlots, hash01, GARDEN, PARROT, seedFor,
  GARDEN_AT, PERCH_AT, gardenFrame, plotAt, PLOT_LOCAL, BED, SCALE } from '../src/gardenlogic.js';
import { createWallet, SEED_IDS, MAX_SEEDS } from '../src/tokens.js';
import { planVisit, parrotPose, perchedAt, releaseAt, leaveTimes, packetPose, PACKET, INFO, FLIGHT } from '../src/parrots.js';
import { KITTY_DEMOS, DEMOS, demoPose } from '../src/demo.js';

const GAME = join(dirname(fileURLToPath(import.meta.url)), '..');

test('the three fruit and the three mutations are well formed', () => {
  assert.deepEqual(FRUITS.map((f) => f.id), SEED_IDS, 'the seed bag holds exactly the fruit that grow');
  for (const f of FRUITS) {
    assert.ok(f.grow.sprout > 0 && f.grow.sprout < f.grow.young && f.grow.young < f.grow.grown, `${f.id} grows in order`);
    assert.ok(f.grow.grown <= 90, `${f.id} is ripe within a minute and a half of live play`);
    assert.ok(Number.isInteger(f.fruit) && f.fruit >= 1 && Number.isInteger(f.each) && f.each >= 1);
  }
  assert.deepEqual(MUTATIONS.map((m) => m.id), ['irradiated', 'cherenkov', 'atomic'], "the viewer's three, rarest last");
  assert.deepEqual(MUTATIONS.map((m) => m.name), ['Irradiated', 'Cherenkov Glow', 'Atomic']);
  assert.ok(Math.abs(MUTATIONS.reduce((n, m) => n + m.odds, 0) - 1) < 1e-9, 'the odds add up to one');
  for (let k = 1; k < MUTATIONS.length; k++) {
    assert.ok(MUTATIONS[k].mult > MUTATIONS[k - 1].mult, 'a rarer one is worth more');
    assert.ok(MUTATIONS[k].odds < MUTATIONS[k - 1].odds, 'and is rarer');
  }
  assert.equal(fruitById('nope'), null);
  assert.equal(mutationById('nope'), null);
});

test('a plant grows: mound, sprout, young, grown (ripe), springing into each stage', () => {
  const f = fruitById('pineapple');
  assert.equal(stageAt(f, 0).stage, 'mound');
  assert.equal(stageAt(f, f.grow.sprout + 0.01).stage, 'sprout');
  assert.equal(stageAt(f, f.grow.young + 0.01).stage, 'young');
  const g = stageAt(f, f.grow.grown + 0.01);
  assert.equal(g.stage, 'grown');
  assert.ok(g.ripe);
  assert.ok(!stageAt(f, f.grow.grown - 0.01).ripe);
  // it springs up: tiny at first, overshoots a little, settles at exactly 1
  assert.ok(stageAt(f, f.grow.young).pop < 0.05);
  let max = 0;
  for (let a = 0; a < 0.6; a += 0.01) max = Math.max(max, stageAt(f, f.grow.young + a).pop);
  assert.ok(max > 1.02 && max < 1.25, `overshoot ${max}`);
  assert.equal(stageAt(f, f.grow.young + 2).pop, 1);
  for (let a = 0; a < 80; a += 0.37) { const s = stageAt(f, a); assert.ok(s.k >= 0 && s.k <= 1); }
});

test('mutations: only ever up, closer bombs give rarer ones, the same roll always gives the same', () => {
  assert.equal(mutationFor(0.0, 0), 'irradiated');
  assert.equal(mutationFor(0.99, 0), 'atomic');
  assert.equal(mutationFor(0.5, 0), mutationFor(0.5, 0));
  // closeness helps
  const count = (close) => { const n = { irradiated: 0, cherenkov: 0, atomic: 0 }; for (let k = 0; k < 4000; k++) n[mutationFor(hash01(k, 3), close)]++; return n; };
  const far = count(0), near = count(1);
  assert.ok(near.atomic > far.atomic && near.irradiated < far.irradiated, JSON.stringify({ far, near }));
  assert.ok(far.irradiated > far.cherenkov && far.cherenkov > far.atomic, 'far off, the common one is the common one');
  // never down: an atomic plant stays atomic; a cherenkov one can go up to atomic but not down
  for (let k = 0; k < 200; k++) {
    assert.equal(mutationFor(hash01(k), 1, 'atomic'), null);
    const m = mutationFor(hash01(k), Math.random(), 'cherenkov');
    assert.ok(m === null || m === 'atomic');
  }
  for (let k = 0; k < 200; k++) { const u = hash01(k, k * 7); assert.ok(u >= 0 && u < 1); }
});

test('harvests pay by fruit, times the mutation; Atomic adds an atom token', () => {
  assert.deepEqual(harvestValue('pineapple'), { tokens: 4, atoms: 0 });
  assert.deepEqual(harvestValue('dragonfruit', 'irradiated'), { tokens: 2 * 3 * 2, atoms: 0 });
  assert.deepEqual(harvestValue('mangosteen', 'cherenkov'), { tokens: 2 * 4 * 3, atoms: 0 });
  assert.deepEqual(harvestValue('mangosteen', 'atomic'), { tokens: 2 * 4 * 5, atoms: 1 });
  assert.deepEqual(harvestValue('nope', 'atomic'), { tokens: 0, atoms: 0 });
});

test('plots: plant, grow, blast, harvest, save and load', () => {
  const where = (i) => plotAt(i);
  const p = createPlots(null, 0);
  assert.equal(p.size, GARDEN.plots);
  assert.equal(p.firstEmpty(), 0);
  assert.ok(p.plant(0, 'pineapple', 0));
  assert.ok(!p.plant(0, 'mangosteen', 1), 'a plot holds one plant');
  assert.ok(!p.plant(1, 'banana', 1), 'only the three fruit grow');
  assert.ok(!p.plant(99, 'pineapple', 1));
  assert.equal(p.harvest(0, 5), null, 'not ripe yet');
  assert.ok(p.ripeIn(0, 5) > 0);
  // a bomb far away changes nothing; one close by mutates it
  const far = where(0);
  assert.deepEqual(p.blast(far.x + GARDEN.reach + 5, far.z, 10, where), []);
  const ch = p.blast(far.x + 8, far.z, 11, where);
  assert.equal(ch.length, 1);
  assert.equal(ch[0].i, 0);
  assert.ok(mutationById(p.at(0).mutation));
  assert.equal(p.at(0).mutatedAt, 11);
  // ripe: picked, paid, and the plot is free again
  const t = fruitById('pineapple').grow.grown + 1;
  assert.equal(p.ripeIn(0, t), 0);
  const got = p.harvest(0, t);
  assert.equal(got.fruit, 'pineapple');
  assert.deepEqual({ tokens: got.tokens, atoms: got.atoms }, harvestValue('pineapple', got.mutation));
  assert.ok(p.isEmpty(0));
  // a save keeps ages, mutations and the visit count; broken bits are dropped one by one
  p.plant(2, 'dragonfruit', 100); p.setMutation(2, 'atomic', 100); p.visits = 4;
  const saved = JSON.parse(JSON.stringify(p.toJSON(130)));
  const q = createPlots(saved, 7);
  assert.equal(q.at(2).fruit, 'dragonfruit');
  assert.equal(q.at(2).mutation, 'atomic');
  assert.ok(Math.abs(q.age(2, 7) - 30) < 0.11);
  assert.equal(q.visits, 4);
  for (const bad of [null, 'x', { plots: 'all' }, { plots: [{ fruit: 'nope' }, { fruit: 'pineapple', age: 'old', mutation: 'glowy' }, 7] }]) {
    const r = createPlots(bad, 0);
    for (let i = 0; i < r.size; i++) { const a = r.at(i); if (a) { assert.ok(fruitById(a.fruit)); assert.ok(a.mutation === null || mutationById(a.mutation)); } }
  }
  // a time-lapse garden grows faster, and saves the same ages as it shows
  const fast = createPlots({ plots: [{ fruit: 'mangosteen', age: 10 }] }, 0, 6, 10);
  assert.ok(Math.abs(fast.age(0, 1) - 20) < 1e-9);
  assert.equal(fast.toJSON(1).plots[0].age, 20);
  fast.load(null, 0);
  assert.ok(fast.isEmpty(0));
});

test('the seed bag: parrot seeds come round in turn and are kept with the purse', () => {
  assert.deepEqual([0, 1, 2, 3].map(seedFor), ['pineapple', 'dragonfruit', 'mangosteen', 'pineapple']);
  const w = createWallet({ tokens: 3 });
  assert.equal(w.seedTotal, 0);
  assert.equal(w.useSeed('pineapple'), false);
  assert.equal(w.addSeed('pineapple'), 1);
  assert.equal(w.addSeed('mangosteen', 2), 2);
  assert.equal(w.addSeed('banana'), 0);
  assert.equal(w.seedTotal, 3);
  assert.ok(w.useSeed('mangosteen'));
  const again = createWallet(JSON.parse(JSON.stringify(w)));
  assert.equal(again.seeds('pineapple'), 1);
  assert.equal(again.seeds('mangosteen'), 1);
  assert.equal(again.tokens, 3);
  for (const bad of [{ seeds: 'lots' }, { seeds: { pineapple: -4, dragonfruit: 1e9, mangosteen: 'x' } }]) {
    const b = createWallet(bad);
    for (const id of SEED_IDS) assert.ok(b.seeds(id) >= 0 && b.seeds(id) <= MAX_SEEDS);
  }
  assert.equal(createWallet({ tokens: 2 }).seedTotal, 0, 'a save from before Day 7 has none');
});

test('a parrot visit: it flies in, lands on the bar, waits, drops the seed, hops, flies off', () => {
  const grip = { x: PERCH_AT.x, y: 5.2, z: PERCH_AT.z };
  const v = planVisit({ t: 10, grip, face: PERCH_AT.rot, seed: 'mangosteen' });
  assert.equal(parrotPose(v, 9.9), null, 'not there before it sets off');
  const start = parrotPose(v, 10);
  assert.ok(Math.hypot(start.pos[0] - grip.x, start.pos[2] - grip.z) > 80, 'it starts far off');
  assert.ok(start.pos[1] > 30, 'and high up');
  // the path is smooth (no jumps from one frame to the next)
  let prev = start.pos, maxStep = 0;
  for (let t = 10; t < perchedAt(v) + 2; t += 1 / 30) {
    const p = parrotPose(v, t);
    maxStep = Math.max(maxStep, Math.hypot(p.pos[0] - prev[0], p.pos[1] - prev[1], p.pos[2] - prev[2]));
    prev = p.pos;
    const w = p.clips.reduce((n, c) => n + c[2], 0);
    assert.ok(Math.abs(w - 1) < 1e-6, `clip weights add to one at ${t.toFixed(2)} (${w})`);
    for (const [name, time] of p.clips) assert.ok(time >= 0 && time <= INFO.clips[name] + 1e-6, `${name} ${time}`);
  }
  assert.ok(maxStep < 2.2, `largest step in a frame: ${maxStep.toFixed(2)} m`);
  // on the bar: feet on the grip, facing out of the perch; it squawks while it waits
  const sat = parrotPose(v, perchedAt(v) + 0.1);
  assert.deepEqual(sat.pos, [grip.x, grip.y, grip.z]);
  assert.ok(Math.abs(Math.atan2(Math.sin(sat.heading - PERCH_AT.rot), Math.cos(sat.heading - PERCH_AT.rot))) < 1e-9);
  assert.ok(sat.beak, 'the seed is still in its beak');
  const sq = parrotPose(v, perchedAt(v) + FLIGHT.squawkFirst + 0.4);
  assert.ok(sq.clips.some((c) => c[0] === 'Squawk'));
  assert.equal(leaveTimes(v), null, 'it waits until it is asked');
  // you come over: it drops the packet, hops, takes off and is gone
  v.giveAt = perchedAt(v) + 3;
  assert.equal(releaseAt(v), v.giveAt + INFO.dropRelease);
  assert.ok(parrotPose(v, releaseAt(v) - 0.01).beak);
  assert.ok(!parrotPose(v, releaseAt(v) + 0.01).beak);
  const L = leaveTimes(v);
  assert.equal(parrotPose(v, v.giveAt + 0.2).phase, 'drop');
  assert.equal(parrotPose(v, L.hop + 0.1).phase, 'hop');
  assert.equal(parrotPose(v, L.off + 0.1).phase, 'off');
  assert.equal(parrotPose(v, L.gone - 1).phase, 'out');
  assert.equal(parrotPose(v, L.gone + 0.01), null);
  const away = parrotPose(v, L.gone - 0.05);
  assert.ok(Math.hypot(away.pos[0] - grip.x, away.pos[2] - grip.z) > 80, 'it flies far away');
  prev = parrotPose(v, L.off).pos;
  for (let t = L.off; t < L.gone; t += 1 / 30) { const p = parrotPose(v, t); assert.ok(Math.hypot(p.pos[0] - prev[0], p.pos[1] - prev[1], p.pos[2] - prev[2]) < 2.6); prev = p.pos; }
});

test('the seed packet falls, bounces once and lies still', () => {
  const from = { x: 0, y: 5, z: 0 }, to = { x: 1, y: 0, z: 2 };
  assert.deepEqual(packetPose(from, to, 0).pos, [0, 5 + 0 * PACKET.lie, 0]);
  const land = packetPose(from, to, PACKET.fall);
  assert.ok(Math.abs(land.pos[1] - PACKET.lie) < 1e-9);
  const rest = packetPose(from, to, PACKET.fall + PACKET.bounce + 1);
  assert.ok(rest.landed);
  assert.deepEqual(rest.pos, [1, PACKET.lie, 2]);
});

test('where it all is: on the plate, clear of the shop and her bed, the perch beside the bed', () => {
  for (const p of [GARDEN_AT, PERCH_AT, ...PLOT_LOCAL.map((_, i) => plotAt(i))]) assert.ok(Math.abs(p.x) < 100 && Math.abs(p.z) < 100);
  const shop = { x: 25, z: -27 }, bed = { x: -19, z: -13 };
  assert.ok(Math.hypot(GARDEN_AT.x - shop.x, GARDEN_AT.z - shop.z) > 40);
  assert.ok(Math.hypot(GARDEN_AT.x - bed.x, GARDEN_AT.z - bed.z) > 25);
  assert.ok(Math.hypot(PERCH_AT.x - bed.x, PERCH_AT.z - bed.z) > 18, 'the perch is clear of her bed');
  assert.ok(Math.hypot(PERCH_AT.x - GARDEN_AT.x, PERCH_AT.z - GARDEN_AT.z) > BED.w / 2 + 2, 'the perch stands beside the bed, not in it');
  // the bed's front faces the middle of the plate
  const front = gardenFrame(0, 5);
  assert.ok(Math.hypot(front.x, front.z) < Math.hypot(GARDEN_AT.x, GARDEN_AT.z));
  assert.ok(PARROT.near > 5 && PARROT.wait > 10 && PARROT.first > 0);
});

test('the Day 7 recordings exist and their cameras are well formed', () => {
  const home = { az: 0.32, pol: 1.0, dist: 30, height: 16, target: [0, 0, 0], shift: 0, fov: 62, horizon: 0.44, horizonAt: () => 0.4, edgeDip: () => 0 };
  for (const name of ['parrotseed', 'gardenplant', 'gardenmutate', 'gardenpick', 'gardenshow']) {
    assert.ok(DEMOS.includes(name), name);
    const d = KITTY_DEMOS[name];
    assert.ok(d && d.garden, `${name} has a garden`);
    for (let t = 0; t < 12; t += 0.5) {
      const p = demoPose(name, t, home, { x: 0, z: 0, head: [0, 4, 0], parrot: { x: -60, y: 30, z: 0 } });
      assert.ok(p && p.position.every(Number.isFinite) && p.look.every(Number.isFinite), `${name} at ${t}`);
      assert.ok(p.position[1] > 1.5, `${name} stays above the ground`);
    }
  }
});

test('every file the garden and the parrots need is there', () => {
  const need = ['models/garden.glb', 'models/garden.json', 'models/parrot.glb', 'models/parrot.json', 'models/perch.glb'];
  for (const f of FRUITS) {
    need.push(`models/garden/thumb_seed_${f.id}.webp`, `models/garden/thumb_fruit_${f.id}.webp`, `models/garden/${f.id}_base.webp`);
    for (const m of MUTATIONS) need.push(`models/garden/${f.id}_${m.id}.webp`, `models/garden/thumb_fruit_${f.id}_${m.id}.webp`);
  }
  for (const n of ['squawk1', 'squawk2', 'squawk3', 'squawk4', 'flap1', 'flap2', 'flap3', 'flap4', 'flapbig1', 'flapbig2', 'seeddrop', 'seedland1', 'seedland2',
    'seedget', 'plant1', 'plant2', 'sprout1', 'sprout2', 'sprout3', 'ripe', 'pick', 'fruitpop1', 'fruitpop2', 'fruitpop3', 'mut_irradiated', 'mut_cherenkov', 'mut_atomic']) need.push(`sounds/${n}.mp3`);
  for (const f of need) assert.ok(existsSync(join(GAME, f)), `missing ${f}`);
  const info = JSON.parse(readFileSync(join(GAME, 'models/garden.json'), 'utf8'));
  assert.equal(info.scale, SCALE);
  assert.equal(info.plots.length, GARDEN.plots);
  // the planned spots (used by the recordings) are the model's own
  info.plots.forEach((p, i) => {
    assert.ok(Math.abs(p[0] - PLOT_LOCAL[i][0]) < 0.02 && Math.abs(-p[2] - PLOT_LOCAL[i][1]) < 0.02 || Math.abs(p[2] - PLOT_LOCAL[i][1]) < 0.02, `plot ${i} ${p} vs ${PLOT_LOCAL[i]}`);
  });
  const pinfo = JSON.parse(readFileSync(join(GAME, 'models/parrot.json'), 'utf8'));
  for (const c of ['Perch', 'Squawk', 'Drop', 'Hop', 'TakeOff', 'Fly', 'Glide', 'Land']) assert.ok(pinfo.clips[c] > 0, `parrot clip ${c}`);
  assert.ok(pinfo.dropRelease > 0 && pinfo.dropRelease < pinfo.clips.Drop);
  assert.ok(pinfo.landTouch > 0 && pinfo.landTouch <= pinfo.clips.Land);
  // the page knows the new modules, and the audio engine every new sound
  const html = readFileSync(join(GAME, 'index.html'), 'utf8');
  for (const m of ['gardenlogic', 'garden', 'parrots']) assert.ok(html.includes(`"./src/${m}.js"`), `${m}.js in the import map`);
  assert.ok(html.includes('Day 7') && /id="seeds"/.test(html) && /id="seedbag"/.test(html));
  const days = JSON.parse(readFileSync(join(GAME, 'days.json'), 'utf8'));
  const last = days[days.length - 1];
  assert.equal(last.day, 7);
  assert.equal(last.by, 'elenaabrosimova1968');
  const audio = readFileSync(join(GAME, 'src/kittyaudio.js'), 'utf8');
  for (const n of ['squawk1', 'flap1', 'mut_atomic', 'fruitpop3']) assert.ok(audio.includes(`sounds/${n}.mp3`));
});
