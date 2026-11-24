// Day 5: atom bombs and atom boxes (idea by @elenaabrosimova1968: "Add URANIUM and PLUTONIUM... of course they are
// in a box that you can tap (gives you some special tokens you will need to upgrade things or for skins)"; the
// owner: "to get them, I would need to not touch things that are falling from the sky, like an atom bomb ... for
// every single one of the boxes. And where the things fell, the boxes would appear").
//
// A cartoon atom bomb drops from the sky at the spot where you stand; a dark ring on the ground shows where it will
// land. Step out of the ring in time and, where it landed, an atom box pops out of the dust. Tap the box: its lid
// swings open, the uranium or the plutonium hops up, an atom token flies to your counter, and the box is gone.
// Still standing in the ring when it lands? A bonk and a cloud of dust, and no box.
//
// models/atombox.glb (art/day05/build_atombox.py): the box, its lid on a hinge, the two chunks in their nests, the
// needle of its gauge, and the atom token's coin. models/atombomb.glb (art/day05/build_atombomb.py): the bomb,
// nose down, its origin at the tip of its nose.
// Everything that moves is a pure function of the clock (bombPose, boxPose, boxLife), so recordings come out the
// same every time.
import * as THREE from '../vendor/three/three.module.js';
import { GLTFLoader } from '../vendor/three/addons/loaders/GLTFLoader.js';
import { skyReflections } from './outfits.js';
import { ATOM_BOX } from './tokens.js';

export const SCALE = 14;                 // both models are drawn this much bigger than their cat-scale metres
/** how big a box is on the ground (you and the kitty walk round it), how near you stand to open it, how near counts as there */
export const BOX_R = 2.9, STAND = 5.6, NEAR = 8.2;
// the box model's own numbers (cat-scale metres and radians, from art/day05/check_atombox.py)
export const MODEL = {
  lidOpen: -1.8326,          // Lid.rotation.x when fully open (105 degrees; closed = 0)
  needleEmpty: 0, needleFull: -4.1888,   // Needle.rotation.z from an empty gauge (down-left) to a full one (down-right)
  rise: 0.21,                // how far a chunk rises (its base clears the rim after 0.05; it ends up above the open lid)
};
/** the fall: how high it starts (m), and how long the dust hangs about after it lands (s) */
export const BOMB = { height: 46, dust: 0.9 };

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const easeOutBack = (k, s = 1.70158) => { k = clamp01(k); return 1 + (s + 1) * (k - 1) ** 3 + s * (k - 1) ** 2; };
const easeInOut = (k) => { k = clamp01(k); return k * k * (3 - 2 * k); };
const easeIn = (k) => clamp01(k) ** 3;
const easeOut = (k) => 1 - (1 - clamp01(k)) ** 3;

/** One opening, second by second (when the token leaves the chunk, when the lid is shut again), and a box's coming and going. */
export const TIMING = { lidUp: 0.34, riseAt: 0.14, riseFor: 0.55, tokenAt: 0.62, hold: 1.65, sink: 0.45, lidDownAt: 1.95, lidDown: 0.42, end: 2.5,
  appear: 0.5, vanish: 0.45 };

/**
 * A bomb `a` seconds after it was let go (it lands at a = fall).
 * @returns {{y:number, ring:number, wobble:number, spin:number, landed:boolean, dust:number}}
 *   y: its nose above the ground (m); ring 0..1: how strong the warning ring is; wobble and spin (radians);
 *   dust 0..1: how far the cloud of dust has got after it lands (1 = gone)
 */
export function bombPose(a, fall = ATOM_BOX.fall) {
  const k = clamp01(a / fall);
  return {
    y: BOMB.height * (1 - k ** 1.5),                                // it gathers speed
    ring: a < 0 ? 0 : a < fall ? 0.35 + 0.65 * k : 1 - clamp01((a - fall) / 0.25),
    wobble: 0.13 * Math.sin(a * 9.5) * (1 - k * 0.6),
    spin: a * 1.6,
    landed: a >= fall,
    dust: a < fall ? 0 : clamp01((a - fall) / BOMB.dust),
  };
}
/** Did it get you? You are hit when you are still inside the ring as it lands. */
export const wasHit = (px, pz, x, z, blast = ATOM_BOX.blast) => Math.hypot(px - x, pz - z) < blast;

/**
 * Where a bomb aimed at (x, z) really lands: on the plate, and never on something that stands there
 * (`keepOut`: round things {x, z, r}; it is pushed to their edge).
 */
export function landSpot(x, z, keepOut = [], limit = 104) {
  let px = Math.max(-limit, Math.min(limit, x)), pz = Math.max(-limit, Math.min(limit, z));
  for (let pass = 0; pass < 3; pass++) {
    for (const c of keepOut) {
      const dx = px - c.x, dz = pz - c.z, d = Math.hypot(dx, dz);
      if (d >= c.r) continue;
      const ux = d > 0.01 ? dx / d : 1, uz = d > 0.01 ? dz / d : 0;
      px = c.x + ux * c.r; pz = c.z + uz * c.r;
    }
  }
  return { x: Math.max(-limit, Math.min(limit, px)), z: Math.max(-limit, Math.min(limit, pz)) };
}

/**
 * A box at time t. `opened` = when it was tapped (null: not yet), `count` = which opening this is over the whole
 * game (odd: the uranium, even: the plutonium).
 * @returns {{lid:number, which:'uranium'|'plutonium', lift:number, spin:number, pop:number, charge:number, rattle:number}}
 *   lid 0..1 (1 = fully open), lift 0..1 (the chunk's rise), spin (radians), pop (the chunk's scale),
 *   charge 0..1 (the gauge: full until it is opened), rattle (a small lid shake, radians, while it waits)
 */
export function boxPose(t, opened = null, count = 0) {
  const T = TIMING;
  const which = count % 2 === 1 ? 'uranium' : 'plutonium';        // the first opening (count 1) is the uranium
  if (opened == null || t < opened) return { lid: 0, which, lift: 0, spin: 0, pop: 1, charge: 1, rattle: rattleAt(t) };
  const a = t - opened;
  let lid = 0, lift = 0, pop = 1, spin = 0;
  if (a < T.end) {
    lid = a < T.lidDownAt ? easeOutBack(a / T.lidUp, 1.2) : 1 - easeIn((a - T.lidDownAt) / T.lidDown);
    if (a >= T.lidDownAt + T.lidDown) lid = 0;
    const up = easeOutBack((a - T.riseAt) / T.riseFor, 1.5), down = easeInOut((a - T.hold) / T.sink);
    lift = Math.max(0, up * (1 - down));
    lift += 0.035 * Math.sin((a - T.riseAt) * 5.2) * clamp01((a - T.riseAt - T.riseFor) / 0.2) * (1 - down);    // it bobs while it shows
    spin = a > T.riseAt ? (a - T.riseAt) * 2.6 * (1 - 0.6 * down) : 0;
    pop = 1 + 0.14 * Math.sin(clamp01((a - T.tokenAt) / 0.3) * Math.PI);                                          // a small swell as the token leaves it
  }
  return { lid, which, lift, spin, pop, charge: 1 - easeInOut(a / 0.3), rattle: 0 };
}
// waiting to be tapped: every 3.5 s its lid gives two quick little shakes ("tap me")
function rattleAt(t) {
  const u = ((t % 3.5) + 3.5) % 3.5;
  if (u < 2.6) return 0;
  const k = (u - 2.6) / 0.9;
  return 0.07 * Math.sin(k * Math.PI * 4) * Math.sin(k * Math.PI);
}

/**
 * A box's whole life: it pops out of the dust where a bomb landed (`born`), waits to be tapped, opens (`opened`),
 * and is gone once it has shut again.
 * @returns {{scale:number, hop:number, ready:boolean, gone:boolean}}  hop: metres off the ground
 */
export function boxLife(t, born, opened = null) {
  const T = TIMING;
  const a = t - born;
  if (a < 0) return { scale: 0, hop: 0, ready: false, gone: false };
  let scale = Math.max(0.001, easeOutBack(a / T.appear, 2.2));
  let hop = 1.4 * Math.sin(clamp01(a / T.appear) * Math.PI) * (1 - clamp01(a / T.appear) * 0.4);
  let gone = false;
  if (opened != null && t >= opened + T.end) {
    const k = (t - opened - T.end) / T.vanish;
    scale *= 1 - easeIn(k);
    hop = 0.9 * Math.sin(clamp01(k) * Math.PI);
    gone = k >= 1;
  }
  return { scale, hop, ready: opened == null && a >= T.appear * 0.6, gone };
}

function softDisc(inner, stops) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, inner, 64, 64, 63);
  for (const [k, col] of stops) gr.addColorStop(k, col);
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/** @param {{scene:THREE.Scene, url:string, bombUrl:string, renderer:THREE.WebGLRenderer}} o */
export async function createAtomField(o) {
  const loader = new GLTFLoader();
  const [gltf, bombGltf] = await Promise.all([loader.loadAsync(o.url), loader.loadAsync(o.bombUrl)]);
  const env = skyReflections(o.renderer);
  const aniso = Math.min(8, o.renderer.capabilities.getMaxAnisotropy());
  const need = (root, n) => { const x = root.getObjectByName(n); if (!x) throw new Error(`the model has no ${n}`); return x; };
  const body = need(gltf.scene, 'AtomBox'), token = need(gltf.scene, 'AtomToken'), bombModel = need(bombGltf.scene, 'AtomBomb');
  const nrm = new THREE.Vector3(), tan = new THREE.Vector3();
  for (const root of [gltf.scene, bombGltf.scene]) {
    root.traverse((m) => {
      if (!m.isMesh) return;
      m.castShadow = true; m.receiveShadow = true;
      // a tangent of no length (a face whose texture coordinates collapse to a point) shades its faces black:
      // give every such vertex any direction across its normal
      const T = m.geometry.attributes.tangent, N = m.geometry.attributes.normal;
      if (T && N) {
        for (let i = 0; i < T.count; i++) {
          const len = Math.hypot(T.getX(i), T.getY(i), T.getZ(i));
          if (len > 0.5 && Number.isFinite(len)) continue;
          nrm.fromBufferAttribute(N, i);
          tan.set(Math.abs(nrm.y) < 0.9 ? 0 : 1, Math.abs(nrm.y) < 0.9 ? 1 : 0, 0).cross(nrm).normalize();
          T.setXYZW(i, tan.x, tan.y, tan.z, 1);
        }
        T.needsUpdate = true;
      }
      for (const mat of [].concat(m.material)) {
        if (mat.map) mat.map.anisotropy = aniso;
        mat.envMap = env; mat.envMapIntensity = mat.metalness > 0.5 ? 1.1 : 0.5;
        mat.emissiveIntensity = 0;                           // nothing in this game glows
      }
    });
  }
  token.removeFromParent();
  body.removeFromParent();
  bombModel.removeFromParent();
  const size = new THREE.Box3().setFromObject(body);       // cat scale
  const top = Math.max(3.2, size.max.y * SCALE + 0.8), reach = Math.max(2.3, Math.hypot(size.max.x, size.max.z) * SCALE * 0.8);

  const group = new THREE.Group();
  group.name = 'AtomField';
  o.scene.add(group);
  const shadeTex = softDisc(26, [[0, 'rgba(38,32,28,0.5)'], [0.7, 'rgba(38,32,28,0.22)'], [1, 'rgba(38,32,28,0)']]);
  const ringTex = softDisc(8, [[0, 'rgba(60,30,24,0.20)'], [0.62, 'rgba(60,30,24,0.34)'], [0.8, 'rgba(60,30,24,0.78)'], [0.9, 'rgba(60,30,24,0.78)'], [1, 'rgba(60,30,24,0)']]);
  const dustTex = softDisc(4, [[0, 'rgba(238,228,212,0.95)'], [0.55, 'rgba(226,214,196,0.7)'], [1, 'rgba(226,214,196,0)']]);
  const flat = (tex, order) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
    m.rotation.x = -Math.PI / 2; m.renderOrder = order; m.visible = false;
    group.add(m);
    return m;
  };

  // the boxes: as many as may wait on the plate at once
  const slots = Array.from({ length: ATOM_BOX.max }, () => {
    const g = new THREE.Group();
    const b = body.clone(true);
    g.add(b);
    g.visible = false;
    group.add(g);
    const lid = need(b, 'Lid'), needle = need(b, 'Needle');
    const chunks = { uranium: need(b, 'Uranium'), plutonium: need(b, 'Plutonium') };
    return { g, lid, needle, chunks, rest: { uranium: chunks.uranium.position.clone(), plutonium: chunks.plutonium.position.clone() },
      lidRest: lid.rotation.x, needleRest: needle.rotation.z, shade: flat(shadeTex, 1), box: null };
  });
  // the bombs in the air (two at most), each with its warning ring and its puffs of dust
  const bombs = Array.from({ length: 2 }, () => {
    const g = new THREE.Group();
    const m = bombModel.clone(true);
    m.scale.setScalar(SCALE);
    g.add(m);
    g.visible = false;
    group.add(g);
    const puffs = Array.from({ length: 7 }, () => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dustTex, transparent: true, depthWrite: false }));
      s.visible = false; s.renderOrder = 4;
      group.add(s);
      return s;
    });
    return { g, ring: flat(ringTex, 2), puffs, drop: null };
  });

  let total = 0, events = [];
  const v = new THREE.Vector3(), local = new THREE.Ray(), hit = new THREE.Vector3(), inv = new THREE.Matrix4(), frame = new THREE.Matrix4();
  const pickBox = new THREE.Box3(new THREE.Vector3(-reach, 0, -reach), new THREE.Vector3(reach, top, reach));
  const waiting = () => slots.filter((s) => s.box).length + bombs.filter((b) => b.drop && !b.drop.done).length;

  return {
    group, token,
    /** may another bomb fall now? (not while as many boxes as the plate holds are waiting or on their way) */
    canDrop: () => waiting() < ATOM_BOX.max && bombs.some((b) => !b.drop),
    /**
     * A bomb is let go at t, to land at (x, z) `fall` seconds later. `rot`: which way the box it leaves will face
     * (default: toward where you are when it lands). False when no more may fall just now.
     */
    drop(t, x, z, rot = null) {
      const b = bombs.find((k) => !k.drop);
      if (!b || waiting() >= ATOM_BOX.max) return false;
      b.drop = { t, x, z, rot, done: false, hit: false };
      return true;
    },
    /** the box under this ray that can be tapped: its number, or -1 */
    pick(ray) {
      let best = -1, bestD = Infinity;
      slots.forEach((s, i) => {
        if (!s.box || s.box.opened != null) return;
        frame.makeRotationY(s.box.rot).setPosition(s.box.x, 0, s.box.z);
        local.copy(ray).applyMatrix4(inv.copy(frame).invert());
        if (!local.intersectBox(pickBox, hit)) return;
        const d = hit.distanceToSquared(local.origin);
        if (d < bestD) { bestD = d; best = i; }
      });
      return best;
    },
    /** box number i: where it is, or null when there is none */
    box(i) { const b = slots[i]?.box; return b ? { x: b.x, z: b.z, rot: b.rot, opened: b.opened != null } : null; },
    /** the first box that waits to be tapped (-1: none) */
    firstReady: () => slots.findIndex((s) => s.box && s.box.opened == null),
    /** you and the kitty walk round a box (r 0 when slot i is empty) */
    circle(i) { const b = slots[i]?.box; return b ? { x: b.x, z: b.z, r: BOX_R } : { x: 0, z: 0, r: 0 }; },
    /** every bomb on its way down: {x, z, at} (at = when it lands) */
    falling: () => bombs.filter((b) => b.drop && !b.drop.done).map((b) => ({ x: b.drop.x, z: b.drop.z, at: b.drop.t + ATOM_BOX.fall })),
    /** open box i at t: true, or false when it is not there to be opened */
    open(i, t) {
      const b = slots[i]?.box;
      if (!b || b.opened != null || t < b.born) return false;
      b.opened = t; b.count = ++total;
      return true;
    },
    /** a recording starting over */
    reset() { total = 0; events = []; for (const s of slots) s.box = null; for (const b of bombs) b.drop = null; },
    get count() { return total; },
    /** where box i's token leaves from at t (world space): the top of the chunk that is up */
    tokenFrom(i, t, out = v) {
      const s = slots[i];
      if (!s?.box) return out.set(0, 3, 0);
      const ch = s.chunks[boxPose(t, s.box.opened, s.box.count).which];
      ch.updateWorldMatrix(true, false);
      return out.setFromMatrixPosition(ch.matrixWorld).setY(out.y + 1.3);
    },
    /** what the lens should keep sharp: the boxes, and the bombs' landing spots */
    subjects() {
      const list = [];
      for (const s of slots) if (s.box) list.push([s.box.x, 2.2, s.box.z]);
      for (const b of bombs) if (b.drop) list.push([b.drop.x, 1.5, b.drop.z]);
      return list;
    },
    /**
     * Every frame. `you` = {x, z} (or null): where you stand, to see whether a landing bomb got you.
     * @returns {{type:'land', t:number, x:number, z:number, hit:boolean, box:number}[]} what happened since the last call
     */
    update(t, you = null) {
      events = [];
      for (const b of bombs) {
        const d = b.drop;
        if (!d) { b.g.visible = false; b.ring.visible = false; for (const p of b.puffs) p.visible = false; continue; }
        const a = t - d.t, p = bombPose(a);
        if (p.landed && !d.done) {                           // it lands: did it get you? if not, it leaves a box
          d.done = true;
          d.hit = !!you && wasHit(you.x, you.z, d.x, d.z);
          let slot = -1;
          if (!d.hit) {
            slot = slots.findIndex((s) => !s.box);
            if (slot >= 0) slots[slot].box = { x: d.x, z: d.z, born: d.t + ATOM_BOX.fall, opened: null, count: 0,
              rot: d.rot ?? (you ? Math.atan2(you.x - d.x, you.z - d.z) : 0) };
          }
          events.push({ type: 'land', t: d.t + ATOM_BOX.fall, x: d.x, z: d.z, hit: d.hit, box: slot });
        }
        b.g.visible = a >= 0 && !p.landed;
        if (b.g.visible) {
          b.g.position.set(d.x, p.y, d.z);
          b.g.rotation.set(p.wobble, p.spin, p.wobble * 0.7);
        }
        b.ring.visible = p.ring > 0.01;
        if (b.ring.visible) {
          const r = ATOM_BOX.blast * 2 * (1.25 - 0.25 * clamp01(a / ATOM_BOX.fall));     // it closes in on the spot
          b.ring.scale.set(r, r, 1);
          b.ring.position.set(d.x, 0.05, d.z);
          b.ring.material.opacity = p.ring;
        }
        b.puffs.forEach((s, k) => {
          s.visible = p.landed && p.dust < 1;
          if (!s.visible) return;
          const ang = (k / b.puffs.length) * Math.PI * 2 + 0.6, out = easeOut(p.dust) * (k === 0 ? 0 : 3.4 + (k % 3) * 0.7);
          s.position.set(d.x + Math.sin(ang) * out, 1.3 + easeOut(p.dust) * (k === 0 ? 2.6 : 1.1 + (k % 2) * 0.8), d.z + Math.cos(ang) * out);
          s.scale.setScalar((k === 0 ? 5.5 : 3.2 + (k % 3) * 0.6) * (0.55 + 0.75 * easeOut(p.dust)));
          s.material.opacity = (1 - p.dust) ** 1.5;
        });
        if (p.landed && p.dust >= 1) b.drop = null;
      }
      for (const s of slots) {
        const bx = s.box;
        if (!bx) { s.g.visible = false; s.shade.visible = false; continue; }
        const life = boxLife(t, bx.born, bx.opened);
        if (life.gone) { s.box = null; s.g.visible = false; s.shade.visible = false; continue; }
        const p = boxPose(t - bx.born, bx.opened == null ? null : bx.opened - bx.born, bx.count);
        s.g.visible = life.scale > 0.002;
        s.g.position.set(bx.x, life.hop, bx.z);
        s.g.rotation.y = bx.rot;
        s.g.scale.setScalar(SCALE * life.scale);
        s.shade.visible = s.g.visible;
        s.shade.position.set(bx.x, 0.03, bx.z);
        s.shade.rotation.z = bx.rot;
        s.shade.scale.set(7.2 * life.scale, 5.6 * life.scale, 1);
        s.lid.rotation.x = s.lidRest + MODEL.lidOpen * p.lid + p.rattle;
        s.needle.rotation.z = s.needleRest + MODEL.needleEmpty + (MODEL.needleFull - MODEL.needleEmpty) * p.charge;
        for (const [k, ch] of Object.entries(s.chunks)) {
          const up = k === p.which;
          ch.position.copy(s.rest[k]);
          if (up) ch.position.y += MODEL.rise * p.lift;
          ch.rotation.y = up ? p.spin : 0;
          ch.scale.setScalar(up ? p.pop : 1);
        }
      }
      return events;
    },
    /** true while anything of this is moving (the page then renders every frame) */
    busy: (t) => bombs.some((b) => b.drop) || slots.some((s) => s.box && (t - s.box.born < TIMING.appear || (s.box.opened != null && t - s.box.opened < TIMING.end + TIMING.vanish))),
  };
}
