// Day 5: the atom box, atom tokens and fur skins (pure logic) + the files they need.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ATOM_BOX, SKINS, skinById, createWallet } from '../src/tokens.js';
import { boxPose, charged, waitFor, TIMING, ATOMBOX, ATOMBOX_STAND, ATOMBOX_WAIT, ATOMBOX_CIRCLE, nearAtomBox, MODEL } from '../src/atombox.js';
import { SHOP_BOX, BED_SPOT } from '../src/town.js';
import { KITTY_DEMOS, DEMOS, demoPose } from '../src/demo.js';

const GAME = join(dirname(fileURLToPath(import.meta.url)), '..');

test('atom tokens: a second purse, kept with the first', () => {
  const w = createWallet({ tokens: 4 });
  assert.equal(w.atoms, 0);
  assert.equal(w.earnAtoms(1), 1);
  assert.equal(w.earnAtoms(-3), 0);
  assert.equal(w.earnAtoms('x'), 0);
  assert.equal(w.atoms, 1);
  assert.equal(w.tokens, 4, 'friendship tokens are untouched');
  const again = createWallet(JSON.parse(JSON.stringify(w)));
  assert.equal(again.atoms, 1);
  assert.equal(again.tokens, 4);
  // a save from before Day 5 has none; a broken one never breaks the rest
  assert.equal(createWallet({ tokens: 9, owned: ['bowtie'] }).atoms, 0);
  for (const bad of [{ atoms: -2 }, { atoms: 'lots', skins: 'all' }, { atoms: 1e12, skins: ['nope', 7, null] }]) {
    const b = createWallet(bad);
    assert.ok(b.atoms >= 0 && b.atoms <= 9999);
    assert.ok(!SKINS.some((k) => b.ownsSkin(k.id)));
  }
});

test('fur skins are bought with atom tokens, once, and stay hers', () => {
  assert.ok(SKINS.length >= 2);
  const ids = new Set();
  for (const k of SKINS) {
    assert.ok(/^[a-z]+$/.test(k.id) && !ids.has(k.id), k.id);
    ids.add(k.id);
    assert.ok(k.name && Number.isInteger(k.price) && k.price > 0);
    assert.equal(skinById(k.id), k);
    assert.ok(existsSync(join(GAME, 'models', 'skins', `${k.id}.webp`)), `${k.id}.webp`);
    assert.ok(existsSync(join(GAME, 'models', 'skins', `thumb_${k.id}.webp`)), `thumb_${k.id}.webp`);
  }
  assert.equal(skinById('nope'), null);
  const cheap = [...SKINS].sort((a, b) => a.price - b.price)[0];
  const w = createWallet();
  assert.equal(w.canBuySkin(cheap.id), false);
  assert.equal(w.buySkin(cheap.id), false, 'no atom tokens yet');
  for (let i = 0; i < cheap.price; i++) w.earnAtoms(ATOM_BOX.gives);
  assert.equal(w.canBuySkin(cheap.id), true);
  assert.equal(w.buySkin('nope'), false);
  assert.equal(w.buySkin(cheap.id), true);
  assert.equal(w.atoms, 0);
  assert.equal(w.ownsSkin(cheap.id), true);
  assert.equal(w.buySkin(cheap.id), false, 'not twice');
  const again = createWallet(JSON.parse(JSON.stringify(w)));
  assert.equal(again.ownsSkin(cheap.id), true);
  // friendship tokens cannot buy a skin, and atom tokens cannot buy from the shop
  const rich = createWallet({ tokens: 500 });
  assert.equal(rich.buySkin(cheap.id), false);
  const atomic = createWallet({ atoms: 500 });
  assert.equal(atomic.buy('bowtie'), false);
});

test('the box opens, shows a chunk, gives its token and shuts again', () => {
  const T = TIMING, R = ATOM_BOX.recharge;
  const idle = boxPose(3, null, 0);
  assert.equal(idle.lid, 0);
  assert.equal(idle.lift, 0);
  assert.equal(idle.charge, 1, 'it starts full');
  const t0 = 10;
  assert.ok(Math.abs(boxPose(t0, t0, 1).lid) < 1e-6, 'shut on the frame it is tapped');
  const open = boxPose(t0 + T.tokenAt, t0, 1);
  assert.ok(open.lid > 0.95 && open.lid < 1.1, `lid ${open.lid}`);
  assert.ok(open.lift > 0.6, `the chunk is up when its token leaves (${open.lift})`);
  assert.equal(open.which, 'uranium', 'the first one is the uranium');
  assert.equal(boxPose(t0 + 1, t0, 2).which, 'plutonium');
  assert.equal(boxPose(t0 + 1, t0, 3).which, 'uranium');
  assert.ok(open.charge < 0.05, 'the gauge drops when it opens');
  const shut = boxPose(t0 + T.end + 0.01, t0, 1);
  assert.ok(Math.abs(shut.lid) < 1e-3 && shut.lift === 0);
  // never open past its stop, never below shut (but for the tiny bounce), the chunk never sinks under its nest
  for (let a = 0; a <= T.end + 1; a += 1 / 60) {
    const p = boxPose(t0 + a, t0, 1);
    assert.ok(p.lid > -0.05 && p.lid < 1.12, `lid ${p.lid} at ${a}`);
    assert.ok(p.lift >= 0 && p.lift < 1.25, `lift ${p.lift} at ${a}`);
    assert.ok(p.charge >= 0 && p.charge <= 1);
  }
  // charging: empty right after, half way half way through, full (and tappable) at the end
  assert.equal(charged(t0 + 1, t0), false);
  assert.ok(Math.abs(boxPose(t0 + T.end + R / 2, t0, 1).charge - 0.5) < 0.02);
  assert.equal(charged(t0 + T.end + R - 0.01, t0), false);
  assert.equal(charged(t0 + T.end + R, t0), true);
  assert.equal(charged(0, null), true);
  assert.ok(Math.abs(waitFor(t0 + 5, t0) - (T.end + R - 5)) < 1e-9);
  assert.equal(waitFor(t0 + 999, t0), 0);
  // filming: a short recharge
  assert.equal(charged(t0 + T.end + 0.5, t0, 0.4), true);
  // waiting, it gives a small shake now and then, never a big one
  let shook = false;
  for (let t = 0; t < 10; t += 1 / 30) { const r = boxPose(t, null, 0).rattle; assert.ok(Math.abs(r) < 0.1); if (Math.abs(r) > 0.02) shook = true; }
  assert.ok(shook);
});

test('the box stands clear of the shop, the bed and the middle; you and the kitty have room beside it', () => {
  assert.ok(Math.hypot(ATOMBOX.x, ATOMBOX.z) > 9, 'not where the kitty sits');
  assert.ok(Math.hypot(ATOMBOX.x - SHOP_BOX.x, ATOMBOX.z - SHOP_BOX.z) > 25);
  assert.ok(Math.hypot(ATOMBOX.x - BED_SPOT.x, ATOMBOX.z - BED_SPOT.z) > 15);
  assert.ok(Math.abs(ATOMBOX.x) < 110 && Math.abs(ATOMBOX.z) < 110);
  const d = (p) => Math.hypot(p.x - ATOMBOX.x, p.z - ATOMBOX.z);
  assert.ok(d(ATOMBOX_STAND) > ATOMBOX_CIRCLE.r + 1.8, 'you stand outside its circle');
  assert.ok(nearAtomBox(ATOMBOX_STAND.x, ATOMBOX_STAND.z, 7.6), 'and standing there counts as being at the box');
  assert.ok(d(ATOMBOX_WAIT) > ATOMBOX_CIRCLE.r + 4, 'the kitty waits well clear of it');
  assert.ok(Math.hypot(ATOMBOX_WAIT.x - ATOMBOX_STAND.x, ATOMBOX_WAIT.z - ATOMBOX_STAND.z) > 4.5, 'and not on top of you');
});

test('the model has every part the game moves', () => {
  const file = join(GAME, 'models', 'atombox.glb');
  assert.ok(existsSync(file), 'models/atombox.glb');
  const buf = readFileSync(file);
  assert.equal(buf.toString('latin1', 0, 4), 'glTF');
  const json = JSON.parse(buf.toString('utf8', 20, 20 + buf.readUInt32LE(12)));
  const names = json.nodes.map((n) => n.name);
  for (const n of ['AtomBox', 'Lid', 'Uranium', 'Plutonium', 'Needle', 'AtomToken']) assert.ok(names.includes(n), `node ${n}`);
  const kids = (name) => (json.nodes.find((n) => n.name === name).children || []).map((i) => json.nodes[i].name);
  for (const n of ['Lid', 'Uranium', 'Plutonium', 'Needle']) assert.ok(kids('AtomBox').includes(n), `${n} is a child of AtomBox`);
  assert.ok(!kids('AtomBox').includes('AtomToken'));
  assert.ok(!json.animations && !json.skins, 'no animations, no armature');
  for (const m of json.materials || []) {
    const e = m.emissiveFactor || [0, 0, 0];
    assert.ok(e.every((x) => x === 0) || (m.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? 1) === 0, `${m.name} must not glow`);
  }
  assert.ok(buf.length < 1.7e6, `atombox.glb is ${(buf.length / 1e6).toFixed(2)} MB`);
  assert.ok(existsSync(join(GAME, 'models', 'shop', 'atomtoken.webp')), 'the atom counter\'s picture');
  assert.ok(Math.abs(MODEL.lidOpen) > 1.3 && Math.abs(MODEL.lidOpen) < 2.3 && MODEL.rise > 0.05);
});

test('the Day 5 shots exist and their cameras look at the box', () => {
  const home = { az: 0.32, pol: 1.05, dist: 32, target: [0, 0, 0], shift: 0, fov: 60, horizon: 0.42, horizonAt: () => 0.42, edgeDip: () => 0 };
  for (const name of ['atombox', 'atomshow']) {
    assert.ok(DEMOS.includes(name) && KITTY_DEMOS[name], name);
    assert.ok(KITTY_DEMOS[name].script.filter((s) => s.type === 'atom').length >= 2, 'it is tapped twice: both chunks show');
    const s = KITTY_DEMOS[name].start(home);
    assert.ok(Math.hypot(s.x - ATOMBOX.x, s.z - ATOMBOX.z) > ATOMBOX_CIRCLE.r + 2.9, 'she sits clear of the box');
    for (const t of [0, 2, 6]) {
      const p = demoPose(name, t, home, { x: s.x, z: s.z });
      assert.ok(p && p.position && p.look);
      assert.ok(Math.hypot(p.look[0] - ATOMBOX.x, p.look[2] - ATOMBOX.z) < 0.01);
      const d = Math.hypot(p.position[0] - ATOMBOX.x, p.position[2] - ATOMBOX.z);
      assert.ok(d > 6 && d < 20, `camera ${d.toFixed(1)} m from the box`);
    }
  }
  const pl = KITTY_DEMOS.atombox.player.start;
  assert.ok(nearAtomBox(pl.x, pl.z), 'you stand at the box');
  assert.ok(Math.hypot(pl.x - ATOMBOX.x, pl.z - ATOMBOX.z) > ATOMBOX_CIRCLE.r + 1.8);
});

test('the page knows about Day 5', () => {
  const html = readFileSync(join(GAME, 'index.html'), 'utf8');
  assert.ok(/"\.\/src\/atombox\.js": "\.\/src\/atombox\.js\?v=/.test(html), 'atombox.js is in the import map');
  assert.ok(/id="atoms"/.test(html) && /id="atoms-count"/.test(html) && /id="atoms-icon"/.test(html));
  const days = JSON.parse(readFileSync(join(GAME, 'days.json'), 'utf8'));
  const last = days[days.length - 1];
  assert.equal(last.day, 5);
  assert.equal(last.by, 'elenaabrosimova1968');
  assert.ok(html.includes('Day 5'));
});
