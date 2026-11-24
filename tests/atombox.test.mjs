// Day 5: atom bombs, atom boxes, atom tokens and fur skins (pure logic) + the files they need.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ATOM_BOX, SKINS, skinById, createWallet } from '../src/tokens.js';
import { boxPose, boxLife, bombPose, wasHit, landSpot, TIMING, MODEL, BOMB, BOX_R, STAND, NEAR } from '../src/atombox.js';
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

test('a bomb falls for a set time, faster and faster, with its warning ring on the ground all the way', () => {
  const F = ATOM_BOX.fall;
  assert.ok(F >= 2 && F <= 4, 'time enough to step away, not time enough to forget it');
  assert.equal(bombPose(0).y, BOMB.height);
  assert.ok(bombPose(0).ring > 0.2, 'the ring shows from the moment it is let go');
  let last = Infinity, lastStep = 0;
  for (let a = 0; a < F; a += 0.1) {
    const p = bombPose(a);
    assert.ok(p.y <= last, 'it only comes down');
    if (a > 0.15) assert.ok(last - p.y >= lastStep - 1e-9, 'and gathers speed');
    lastStep = last === Infinity ? 0 : last - p.y;
    last = p.y;
    assert.equal(p.landed, false);
    assert.ok(p.ring > 0.2 && p.ring <= 1);
    assert.ok(Math.abs(p.wobble) < 0.2);
  }
  assert.ok(bombPose(F - 0.001).y < 0.2, 'its nose is on the ground as it lands');
  assert.equal(bombPose(F).landed, true);
  assert.equal(bombPose(F).y, 0);
  assert.ok(bombPose(F + BOMB.dust + 0.01).dust === 1, 'the dust is gone a moment later');
  assert.equal(bombPose(F + 1).ring, 0);
  // walking (4.6 m/s) from the middle of the ring, you are out of it with time to spare
  assert.ok(ATOM_BOX.blast / 4.6 < F - 1, 'a walk gets you clear');
});

test('standing in the ring when it lands gets you; a step outside does not', () => {
  assert.equal(wasHit(0, 0, 0, 0), true);
  assert.equal(wasHit(ATOM_BOX.blast - 0.1, 0, 0, 0), true);
  assert.equal(wasHit(ATOM_BOX.blast + 0.1, 0, 0, 0), false);
  assert.equal(wasHit(3, 4, 0, 0, 5.01), true);
  assert.equal(wasHit(3, 4, 0, 0, 4.99), false);
  assert.ok(STAND > BOX_R + 1.8 && NEAR > STAND, 'you stand clear of the box you open, and standing there counts as being at it');
});

test('a bomb never lands on the shop, the bed, the kitty or off the plate', () => {
  const keep = [{ x: 25, z: -27, r: 15 }, { x: -19, z: -13, r: 9 }];
  for (const [x, z] of [[25, -27], [24, -20], [-19, -13], [-15, -10], [500, 0], [0, -500], [7.5, 7]]) {
    const p = landSpot(x, z, keep);
    assert.ok(Math.abs(p.x) <= 104 && Math.abs(p.z) <= 104);
    for (const c of keep) assert.ok(Math.hypot(p.x - c.x, p.z - c.z) >= c.r - 1e-6, `(${x}, ${z}) -> (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`);
  }
  assert.deepEqual(landSpot(7.5, 7, keep), { x: 7.5, z: 7 }, 'in the open it lands where it was aimed');
  const mid = landSpot(25, -27, keep);
  assert.ok(Number.isFinite(mid.x) && Number.isFinite(mid.z), 'dead centre of a thing is still pushed out somewhere');
});

test('a box pops out where the bomb landed, waits, opens once and is gone', () => {
  const T = TIMING, born = 10;
  assert.equal(boxLife(born - 0.1, born).scale, 0);
  assert.equal(boxLife(born + 0.05, born).ready, false, 'not while it is still popping out');
  const up = boxLife(born + T.appear + 0.01, born);
  assert.ok(Math.abs(up.scale - 1) < 0.01 && up.ready && !up.gone);
  assert.ok(Math.abs(up.hop) < 0.01, 'it has landed');
  assert.equal(boxLife(born + 500, born).ready, true, 'it waits as long as you like');
  for (let a = 0; a < 2; a += 1 / 60) { const l = boxLife(born + a, born); assert.ok(l.scale > 0 && l.scale < 1.35 && l.hop >= 0 && l.hop < 2); }
  const opened = born + 3;
  assert.equal(boxLife(opened + 1, born, opened).ready, false, 'an open box cannot be tapped again');
  assert.ok(Math.abs(boxLife(opened + T.end - 0.01, born, opened).scale - 1) < 0.01, 'it stays while it shows its chunk');
  assert.equal(boxLife(opened + T.end + T.vanish + 0.01, born, opened).gone, true);
  assert.ok(boxLife(opened + T.end + T.vanish * 0.9, born, opened).scale < 0.3);
  // the opening itself
  assert.ok(Math.abs(boxPose(opened, opened, 1).lid) < 1e-6, 'shut on the frame it is tapped');
  const open = boxPose(opened + T.tokenAt, opened, 1);
  assert.ok(open.lid > 0.95 && open.lid < 1.1, `lid ${open.lid}`);
  assert.ok(open.lift > 0.6, `the chunk is up when its token leaves (${open.lift})`);
  assert.equal(open.which, 'uranium', 'the first box holds the uranium');
  assert.equal(boxPose(opened + 1, opened, 2).which, 'plutonium');
  assert.equal(boxPose(opened + 1, opened, 3).which, 'uranium');
  assert.equal(boxPose(5, null, 0).charge, 1, 'its gauge is full while it waits');
  assert.ok(open.charge < 0.05, 'and drops as it opens');
  for (let a = 0; a <= T.end + 1; a += 1 / 60) {
    const p = boxPose(opened + a, opened, 1);
    assert.ok(p.lid > -0.05 && p.lid < 1.12, `lid ${p.lid} at ${a}`);
    assert.ok(p.lift >= 0 && p.lift < 1.25, `lift ${p.lift} at ${a}`);
  }
  assert.equal(boxPose(opened + T.end + 0.01, opened, 1).lid, 0);
  let shook = false;
  for (let t = 0; t < 10; t += 1 / 30) { const r = boxPose(t, null, 0).rattle; assert.ok(Math.abs(r) < 0.1); if (Math.abs(r) > 0.02) shook = true; }
  assert.ok(shook, 'waiting, its lid gives a little shake now and then');
  assert.ok(ATOM_BOX.max >= 1 && ATOM_BOX.max <= 3 && ATOM_BOX.gives >= 1 && ATOM_BOX.every > ATOM_BOX.fall + 3);
});

function glb(file) {
  const buf = readFileSync(file);
  assert.equal(buf.toString('latin1', 0, 4), 'glTF');
  return { buf, json: JSON.parse(buf.toString('utf8', 20, 20 + buf.readUInt32LE(12))) };
}
const noGlow = (json) => { for (const m of json.materials || []) {
  const e = m.emissiveFactor || [0, 0, 0];
  assert.ok(e.every((x) => x === 0) || (m.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? 1) === 0, `${m.name} must not glow`);
} };

test('the box model has every part the game moves', () => {
  const file = join(GAME, 'models', 'atombox.glb');
  assert.ok(existsSync(file), 'models/atombox.glb');
  const { buf, json } = glb(file);
  const names = json.nodes.map((n) => n.name);
  for (const n of ['AtomBox', 'Lid', 'Uranium', 'Plutonium', 'Needle', 'AtomToken']) assert.ok(names.includes(n), `node ${n}`);
  const kids = (name) => (json.nodes.find((n) => n.name === name).children || []).map((i) => json.nodes[i].name);
  for (const n of ['Lid', 'Uranium', 'Plutonium', 'Needle']) assert.ok(kids('AtomBox').includes(n), `${n} is a child of AtomBox`);
  assert.ok(!kids('AtomBox').includes('AtomToken'));
  assert.ok(!json.animations && !json.skins, 'no animations, no armature');
  noGlow(json);
  assert.ok(buf.length < 1.7e6, `atombox.glb is ${(buf.length / 1e6).toFixed(2)} MB`);
  assert.ok(existsSync(join(GAME, 'models', 'shop', 'atomtoken.webp')), 'the picture on the atom counter');
  assert.ok(Math.abs(MODEL.lidOpen) > 1.3 && Math.abs(MODEL.lidOpen) < 2.3 && MODEL.rise > 0.05);
});

test('the bomb model is there, nose down, and does not glow', () => {
  const file = join(GAME, 'models', 'atombomb.glb');
  assert.ok(existsSync(file), 'models/atombomb.glb');
  const { buf, json } = glb(file);
  const node = json.nodes.find((n) => n.name === 'AtomBomb');
  assert.ok(node && node.mesh != null, 'node AtomBomb is a mesh');
  assert.ok(!json.animations && !json.skins);
  noGlow(json);
  assert.ok(buf.length < 7e5, `atombomb.glb is ${(buf.length / 1e6).toFixed(2)} MB`);
  // its nose is at the origin and it stands up along +Y (the game puts the origin on the ground as it lands)
  let lo = Infinity, hi = -Infinity;
  for (const p of json.meshes[node.mesh].primitives) { const a = json.accessors[p.attributes.POSITION]; lo = Math.min(lo, a.min[1]); hi = Math.max(hi, a.max[1]); }
  assert.ok(Math.abs(lo) < 0.004, `nose at the origin (lowest point ${lo})`);
  assert.ok(hi > 0.15 && hi < 0.3, `about 0.21 long (${hi})`);
});

test('the Day 5 shots: a bomb falls, you dodge it or you do not, the box is opened', () => {
  const home = { az: 0.32, pol: 1.05, dist: 32, target: [0, 0, 0], shift: 0, fov: 60, horizon: 0.42, horizonAt: () => 0.42, edgeDip: () => 0 };
  for (const name of ['atombox', 'atomhit', 'atomshow']) {
    assert.ok(DEMOS.includes(name) && KITTY_DEMOS[name], name);
    const bomb = KITTY_DEMOS[name].script.find((s) => s.type === 'bomb');
    assert.ok(bomb && Number.isFinite(bomb.x) && Number.isFinite(bomb.z) && Number.isFinite(bomb.rot), `${name}: a bomb falls`);
    const s = KITTY_DEMOS[name].start(home);
    assert.ok(Math.hypot(s.x - bomb.x, s.z - bomb.z) > ATOM_BOX.blast + 2, 'she sits clear of where it lands');
    for (const t of [0, 2, 6]) {
      const p = demoPose(name, t, home, { x: s.x, z: s.z });
      assert.ok(p && p.position && p.look);
      assert.ok(Math.hypot(p.look[0] - bomb.x, p.look[2] - bomb.z) < 0.01, 'the camera looks at the spot');
      const d = Math.hypot(p.position[0] - bomb.x, p.position[2] - bomb.z);
      assert.ok(d > 6 && d < 20, `camera ${d.toFixed(1)} m from the spot`);
    }
    const lands = bomb.t + ATOM_BOX.fall;
    const open = KITTY_DEMOS[name].script.find((s) => s.type === 'atom');
    const pl = KITTY_DEMOS[name].player;
    if (name === 'atomhit') {
      assert.ok(!open, 'no box to open');
      assert.ok(wasHit(pl.start.x, pl.start.z, bomb.x, bomb.z) && !pl.script.some((s) => s.type === 'go'), 'you stay in the ring');
      continue;
    }
    assert.ok(open && open.t > lands + TIMING.appear, 'the box is tapped once it is there');
    if (!pl) continue;
    assert.ok(wasHit(pl.start.x, pl.start.z, bomb.x, bomb.z), 'it is aimed at where you stand');
    const go = pl.script.find((s) => s.type === 'go');
    const far = Math.hypot(go.x - bomb.x, go.z - bomb.z), walk = Math.hypot(go.x - pl.start.x, go.z - pl.start.z);
    assert.ok(far > ATOM_BOX.blast + 0.8, `you step ${far.toFixed(1)} m clear`);
    assert.ok(go.t + walk / 4.6 < lands - 0.3, 'and get there before it lands');
    assert.ok(far < NEAR, 'near enough to open the box from there');
  }
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
