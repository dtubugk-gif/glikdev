// Day 5: the atom box (idea by @elenaabrosimova1968: "Add URANIUM and PLUTONIUM... of course they are in a box
// that you can tap (gives you some special tokens you will need to upgrade things or for skins)").
// models/atombox.glb was built in Blender (art/day05/build_atombox.py): the box, its lid on a hinge, a chunk of
// uranium and a lump of plutonium in their nests, the needle of its gauge, and the atom token's coin.
// Tap the box when its gauge is full: the lid swings open, one of the two hops up and turns in the light, an
// atom token flies to your counter, and the box closes and charges again.
// Everything that moves is a pure function of the clock (boxPose), so recordings come out the same every time.
import * as THREE from '../vendor/three/three.module.js';
import { GLTFLoader } from '../vendor/three/addons/loaders/GLTFLoader.js';
import { skyReflections } from './outfits.js';
import { ATOM_BOX } from './tokens.js';

/**
 * Where it stands (metres), how big it is drawn, and which way its front faces. It is right beside where you
 * start (on your right as the camera sees you), so it is in view on a phone held upright as well, above the
 * buttons; its front is turned to the camera and to the sun.
 */
export const ATOMBOX = { x: 12.1, z: 6.3, scale: 14 };
ATOMBOX.rot = Math.atan2(-2.6, 9.6);
/** you and the kitty walk round it */
export const ATOMBOX_CIRCLE = { x: ATOMBOX.x, z: ATOMBOX.z, r: 2.9 };
const FRONT = { x: Math.sin(ATOMBOX.rot), z: Math.cos(ATOMBOX.rot) };
/** where you stand to open it (in front of it), and where the kitty waits and watches (beside you) */
export const ATOMBOX_STAND = { x: ATOMBOX.x + FRONT.x * 6.2, z: ATOMBOX.z + FRONT.z * 6.2 };
export const ATOMBOX_WAIT = { x: ATOMBOX.x + FRONT.x * 7.5 + FRONT.z * 7, z: ATOMBOX.z + FRONT.z * 7.5 - FRONT.x * 7 };
export const nearAtomBox = (x, z, d = 9.5) => Math.hypot(x - ATOMBOX.x, z - ATOMBOX.z) < d;

// the model's own numbers (cat-scale metres and radians, from art/day05/build_atombox.py's report)
export const MODEL = {
  lidOpen: -1.8326,          // Lid.rotation.x when fully open (105 degrees; closed = 0)
  needleEmpty: 0, needleFull: -4.1888,   // Needle.rotation.z from an empty gauge (down-left) to a full one (down-right)
  rise: 0.21,                // how far a chunk rises (its base clears the rim after 0.05; it ends up above the open lid, against the sky)
};

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const easeOutBack = (k, s = 1.70158) => { k = clamp01(k); return 1 + (s + 1) * (k - 1) ** 3 + s * (k - 1) ** 2; };
const easeInOut = (k) => { k = clamp01(k); return k * k * (3 - 2 * k); };
const easeIn = (k) => clamp01(k) ** 3;

/** One opening, second by second: when the token leaves the chunk, when the lid is shut again. */
export const TIMING = { lidUp: 0.34, riseAt: 0.14, riseFor: 0.55, tokenAt: 0.62, hold: 1.65, sink: 0.45, lidDownAt: 1.95, lidDown: 0.42, end: 2.5 };

/** Is the gauge full at time t, given when it was last opened? (`last` null = never: it starts full) */
export const charged = (t, last, recharge = ATOM_BOX.recharge) => last == null || t - last >= TIMING.end + recharge;
/** seconds until it can be opened again (0 = now) */
export const waitFor = (t, last, recharge = ATOM_BOX.recharge) => (last == null ? 0 : Math.max(0, last + TIMING.end + recharge - t));

/**
 * The box at time t. `last` = when it was last opened (null: never), `count` = how many times so far (the one
 * at `last` included): even openings show the uranium, odd ones the plutonium.
 * @returns {{lid:number, which:'uranium'|'plutonium', lift:number, spin:number, pop:number, charge:number, rattle:number}}
 *   lid 0..1 (1 = fully open), lift 0..1 (the chunk's rise), spin (radians), pop (the chunk's scale),
 *   charge 0..1 (the gauge), rattle (a small lid shake, radians, when it is full and waiting)
 */
export function boxPose(t, last = null, count = 0, recharge = ATOM_BOX.recharge) {
  const T = TIMING;
  const which = count % 2 === 1 ? 'uranium' : 'plutonium';        // the first opening (count 1) is the uranium
  if (last == null || t < last) {
    return { lid: 0, which, lift: 0, spin: 0, pop: 1, charge: 1, rattle: rattleAt(t) };
  }
  const a = t - last;
  let lid = 0, lift = 0, pop = 1, spin = 0;
  if (a < T.end) {
    lid = a < T.lidDownAt ? easeOutBack(a / T.lidUp, 1.2) : 1 - easeIn((a - T.lidDownAt) / T.lidDown);
    // the little bounce as the lid shuts
    if (a >= T.lidDownAt + T.lidDown) lid = 0.035 * Math.sin(((a - T.lidDownAt - T.lidDown) / (T.end - T.lidDownAt - T.lidDown)) * Math.PI) * (1 - (a - T.lidDownAt - T.lidDown) / (T.end - T.lidDownAt - T.lidDown));
    const up = easeOutBack((a - T.riseAt) / T.riseFor, 1.5), down = easeInOut((a - T.hold) / T.sink);
    lift = Math.max(0, up * (1 - down));
    lift += 0.035 * Math.sin((a - T.riseAt) * 5.2) * clamp01((a - T.riseAt - T.riseFor) / 0.2) * (1 - down);    // it bobs while it shows
    spin = a > T.riseAt ? (a - T.riseAt) * 2.6 * (1 - 0.6 * down) : 0;
    pop = 1 + 0.14 * Math.sin(clamp01((a - T.tokenAt) / 0.3) * Math.PI);                                          // a small swell as the token leaves it
  }
  const charge = a < 0.3 ? 1 - easeInOut(a / 0.3) : clamp01((a - T.end) / Math.max(0.05, recharge));
  return { lid, which, lift, spin, pop, charge, rattle: charge >= 1 ? rattleAt(t - last - T.end - recharge) : 0 };
}
// full and waiting: every 4.5 s the lid gives two quick little shakes ("tap me")
function rattleAt(t) {
  const u = ((t % 4.5) + 4.5) % 4.5;
  if (u < 3.6) return 0;
  const k = (u - 3.6) / 0.9;
  return 0.07 * Math.sin(k * Math.PI * 4) * Math.sin(k * Math.PI);
}

/** @param {{scene:THREE.Scene, url:string, renderer:THREE.WebGLRenderer, recharge?:number}} o  (recharge: filming charges it in a moment) */
export async function createAtomBox(o) {
  const recharge = o.recharge ?? ATOM_BOX.recharge;
  const gltf = await new GLTFLoader().loadAsync(o.url);
  const env = skyReflections(o.renderer);
  const aniso = Math.min(8, o.renderer.capabilities.getMaxAnisotropy());
  const body = gltf.scene.getObjectByName('AtomBox');
  const need = (n) => { const x = gltf.scene.getObjectByName(n); if (!x) throw new Error(`atombox.glb has no ${n}`); return x; };
  if (!body) throw new Error('atombox.glb has no AtomBox');
  const lid = need('Lid'), needle = need('Needle'), token = need('AtomToken');
  const chunks = { uranium: need('Uranium'), plutonium: need('Plutonium') };
  const rest = { uranium: chunks.uranium.position.clone(), plutonium: chunks.plutonium.position.clone() };
  const lidRest = lid.rotation.x, needleRest = needle.rotation.z;
  const nrm = new THREE.Vector3(), tan = new THREE.Vector3();
  gltf.scene.traverse((m) => {
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
  token.removeFromParent();
  const group = new THREE.Group();
  group.name = 'AtomBoxPlace';
  group.position.set(ATOMBOX.x, 0, ATOMBOX.z);
  group.rotation.y = ATOMBOX.rot;
  group.scale.setScalar(ATOMBOX.scale);
  group.add(body);
  o.scene.add(group);
  // a soft patch of shade on the ground round it (the sun's shadow map follows the player and the kitty)
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 26, 64, 64, 63);
  gr.addColorStop(0, 'rgba(38,32,28,0.5)'); gr.addColorStop(0.7, 'rgba(38,32,28,0.22)'); gr.addColorStop(1, 'rgba(38,32,28,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const shade = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
    map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
  shade.rotation.x = -Math.PI / 2;
  shade.rotation.z = ATOMBOX.rot;
  shade.scale.set(7.2, 5.6, 1);
  shade.position.set(ATOMBOX.x, 0.03, ATOMBOX.z);
  shade.renderOrder = 1;
  o.scene.add(shade);

  // tapping: a box a little bigger than the model, in its own frame
  const size = new THREE.Box3().setFromObject(body);       // world space, at rest
  const hit = new THREE.Vector3(), local = new THREE.Ray();
  const frame = new THREE.Matrix4().makeRotationY(ATOMBOX.rot).setPosition(ATOMBOX.x, 0, ATOMBOX.z);
  const inv = frame.clone().invert();
  const half = new THREE.Vector3().subVectors(size.max, size.min).multiplyScalar(0.5);
  const hx = Math.max(2.2, Math.hypot(half.x, half.z) * 0.78), top = Math.max(3.2, size.max.y + 0.6);
  const pickBox = new THREE.Box3(new THREE.Vector3(-hx, 0, -hx), new THREE.Vector3(hx, top, hx));

  let last = null, count = 0;
  const v = new THREE.Vector3();
  return {
    group, token,
    /** does this ray (world space) hit the box? */
    pick(ray) { local.copy(ray).applyMatrix4(inv); return !!local.intersectBox(pickBox, hit); },
    /** can it be opened at t? */
    ready: (t) => charged(t, last, recharge),
    wait: (t) => waitFor(t, last, recharge),
    /** open it at t (true), or false while it is charging */
    open(t) {
      if (!charged(t, last, recharge)) return false;
      last = t; count++;
      return true;
    },
    /** a recording starting over */
    reset() { last = null; count = 0; },
    get count() { return count; },
    /** which chunk the opening at `last` shows */
    get showing() { return boxPose(last ?? 0, last, count, recharge).which; },
    /** where the token leaves from at t (world space): the top of the chunk that is up */
    tokenFrom(t, out = v) {
      const p = boxPose(t, last, count, recharge);
      const ch = chunks[p.which];
      ch.updateWorldMatrix(true, false);
      return out.setFromMatrixPosition(ch.matrixWorld).setY(out.y + 1.3);
    },
    /** the box's own place (for the camera and the lens) */
    position: (out = v) => out.set(ATOMBOX.x, 1.6, ATOMBOX.z),
    update(t) {
      const p = boxPose(t, last, count, recharge);
      lid.rotation.x = lidRest + MODEL.lidOpen * p.lid + p.rattle;
      needle.rotation.z = needleRest + MODEL.needleEmpty + (MODEL.needleFull - MODEL.needleEmpty) * p.charge;
      for (const [k, ch] of Object.entries(chunks)) {
        const up = k === p.which;
        ch.position.copy(rest[k]);
        if (up) ch.position.y += MODEL.rise * p.lift;
        ch.rotation.y = up ? p.spin : 0;
        ch.scale.setScalar(up ? p.pop : 1);
      }
    },
    /** true while it is opening or shutting (the page then renders every frame) */
    busy: (t) => last != null && t - last < TIMING.end,
  };
}
