// Day 8 (idea by @Darkbacon155: "a place for both cats and a owner"): the home. A cottage with a wide arched door;
// inside are her bed (the Day 3 bolster bed, moved in: town.js places it), Mochi's basket and your own bed.
// models/home.glb (art/day08/build_home.py, built in Blender by Fable 5.2) is drawn x14, like the shop.
//
// So that you always see in: while you are inside, the roof lifts off (a dollhouse view); and any wall (or the
// roof) between the camera and you fades away. Everything here moves smoothly toward where it should be, from the
// frame's own time step, so recordings come out the same every time.
//
// The rules (where things are, the walls, the way in and out) are in homelogic.js, which needs no three.js.
import * as THREE from '../vendor/three/three.module.js';
import { GLTFLoader } from '../vendor/three/addons/loaders/GLTFLoader.js';
import { skyReflections } from './outfits.js';
import { HOME, HOUSE, OWNER_BED, BASKET, HER_BED_AT, toLocal, inHouse } from './homelogic.js';
export * from './homelogic.js';

/** how it looks while it gets out of your way: the roof's lift (m), a faded wall's opacity, how fast (1/s) */
export const LOOK = { lift: 9, faded: 0.16, cut: 0.04, roofSpeed: 3.2, wallSpeed: 6, near: 46 };

// the walls and the roof as boxes in the house's own frame (metres), for "is it between the camera and you?"
const PIECES = {
  WallBack: { x0: -HOUSE.ox, x1: HOUSE.ox, z0: -HOUSE.oz, z1: -HOUSE.iz, y1: HOUSE.eave },
  WallLeft: { x0: -HOUSE.ox, x1: -HOUSE.ix, z0: -HOUSE.oz, z1: HOUSE.oz, y1: HOUSE.eave },
  WallRight: { x0: HOUSE.ix, x1: HOUSE.ox, z0: -HOUSE.oz, z1: HOUSE.oz, y1: HOUSE.eave },
  WallFront: { x0: -HOUSE.ox, x1: HOUSE.ox, z0: HOUSE.iz, z1: HOUSE.oz, y1: HOUSE.eave },
  Roof: { x0: -HOUSE.ox - 1.5, x1: HOUSE.ox + 1.5, z0: -HOUSE.oz - 1.5, z1: HOUSE.oz + 1.5, y0: HOUSE.eave - 0.5, y1: HOUSE.ridge + 1 },
};

/** Does the segment from a to b (house frame, metres, {x, y, z}) pass through box p (y from y0, default 0)? */
export function blocks(a, b, p) {
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dz = b.z - a.z;
  for (const [q, r] of [[-dx, a.x - p.x0], [dx, p.x1 - a.x], [-dz, a.z - p.z0], [dz, p.z1 - a.z]]) {
    if (Math.abs(q) < 1e-12) { if (r < 0) return false; continue; }
    const s = r / q;
    if (q < 0) { if (s > t1) return false; if (s > t0) t0 = s; } else { if (s < t0) return false; if (s < t1) t1 = s; }
  }
  if (t1 <= t0) return false;
  // in the box's footprint between t0 and t1: is the line low enough there (or high enough, for the roof)?
  const y0 = a.y + (b.y - a.y) * t0, y1 = a.y + (b.y - a.y) * t1;
  return Math.min(y0, y1) < p.y1 && Math.max(y0, y1) > (p.y0 ?? 0);
}

/** the white 'z' with a dark rim, the kitty's own (kitty.js) */
function zTexture() {
  const s = 128, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  g.font = `700 ${s * 0.78}px Fredoka, 'Rubik', sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  g.lineWidth = 14; g.strokeStyle = '#2f2620'; g.strokeText('z', s / 2, s / 2 + 4);
  g.fillStyle = '#fff8ec'; g.fillText('z', s / 2, s / 2 + 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** @param {{scene:THREE.Scene, url:string, renderer:THREE.WebGLRenderer}} o */
export async function createHome(o) {
  const gltf = await new GLTFLoader().loadAsync(o.url);
  const env = skyReflections(o.renderer);
  const aniso = Math.min(8, o.renderer.capabilities.getMaxAnisotropy());
  const group = gltf.scene;
  group.name = 'Home';
  group.position.set(HOME.x, 0, HOME.z);
  group.rotation.y = HOME.rot;
  group.scale.setScalar(HOME.scale);
  // each piece that can get out of the way: its meshes, and their own materials (so one fades without the others)
  const parts = {};
  for (const name of Object.keys(PIECES)) {
    const node = group.getObjectByName(name);
    if (!node) { console.warn(`Glikdev: home.glb has no ${name}`); continue; }
    const meshes = [];
    node.traverse((m) => { if (m.isMesh) meshes.push(m); });
    for (const m of meshes) {
      m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone();
      for (const mat of [].concat(m.material)) { mat.userData.base = mat.opacity; mat.userData.baseT = mat.transparent; mat.userData.baseDW = mat.depthWrite; }
    }
    parts[name] = { node, meshes, v: 1, baseY: node.position.y };
  }
  group.traverse((m) => {
    if (!m.isMesh) return;
    m.castShadow = true; m.receiveShadow = true;
    for (const mat of [].concat(m.material)) {
      if (mat.map) mat.map.anisotropy = aniso;
      mat.envMap = env; mat.envMapIntensity = mat.metalness > 0.5 ? 1.0 : 0.45;
      if (mat.transparent) { mat.depthWrite = false; m.castShadow = false; }
    }
  });
  o.scene.add(group);
  // a soft patch of shade on the ground round it
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 26, 64, 64, 63);
  gr.addColorStop(0, 'rgba(38,32,28,0.42)'); gr.addColorStop(0.72, 'rgba(38,32,28,0.2)'); gr.addColorStop(1, 'rgba(38,32,28,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const shade = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
    map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
  shade.rotation.x = -Math.PI / 2;
  shade.rotation.z = HOME.rot;
  shade.scale.set((HOUSE.ox + 5) * 2, (HOUSE.oz + 5) * 2, 1);
  shade.position.set(HOME.x, 0.025, HOME.z);
  shade.renderOrder = 1;
  o.scene.add(shade);

  // your z's while you sleep (the kitty and Mochi have their own)
  const zt = zTexture();
  const zees = [0, 1, 2].map(() => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: zt, transparent: true, depthWrite: false }));
    s.scale.setScalar(1.6); s.visible = false; s.renderOrder = 5;
    o.scene.add(s);
    return s;
  });

  // picking, in the house's own frame (metres, no scale)
  const frame = new THREE.Matrix4().makeRotationY(HOME.rot).setPosition(HOME.x, 0, HOME.z);
  const inv = frame.clone().invert(), local = new THREE.Ray(), hit = new THREE.Vector3();
  const lb = (x, z, hx, hz, y1) => new THREE.Box3(new THREE.Vector3(x - hx, 0, z - hz), new THREE.Vector3(x + hx, y1, z + hz));
  const her = toLocal(HER_BED_AT.x, HER_BED_AT.z);
  const BOXES = {
    ownerbed: lb(OWNER_BED.local.x, OWNER_BED.local.z - 0.3, OWNER_BED.w / 2 + 0.3, OWNER_BED.l / 2 + 0.6, 4.8),
    basket: lb(BASKET.local.x, BASKET.local.z, BASKET.outer, BASKET.outer, 2.2),
    herbed: lb(her.x, her.z, 6.1, 6.1, 1.8),
  };
  const shell = new THREE.Box3(new THREE.Vector3(-HOUSE.ox, 0, -HOUSE.oz), new THREE.Vector3(HOUSE.ox, HOUSE.ridge, HOUSE.oz));
  let lift = 0;                                            // 0 = roof on, 1 = right up and out of the way
  const camL = new THREE.Vector3(), focL = new THREE.Vector3();
  const toL = (p, out) => out.set(p.x, p.y, p.z).applyMatrix4(inv);
  /** fade a piece toward opacity v */
  function paint(part, v) {
    part.v = v;
    const solid = v > 0.995;
    for (const m of part.meshes) {
      m.visible = v > 0.02;
      m.castShadow = v > 0.5;
      for (const mat of [].concat(m.material)) {
        const t = solid ? mat.userData.baseT : true;
        if (mat.transparent !== t) { mat.transparent = t; mat.needsUpdate = true; }
        mat.opacity = (mat.userData.base ?? 1) * v;
        mat.depthWrite = solid ? mat.userData.baseDW !== false : v > 0.6;
      }
    }
  }
  let moving = false;
  return {
    group,
    /** how far the roof is lifted (0..1) */
    get lift() { return lift; },
    /**
     * Each frame: `cam` is the camera, `focus` what must be seen ({x, y, z}: you, or in a recording the kitty);
     * `open` true lifts the roof (you are inside). Pieces between them fade; the rest come back.
     */
    update(dt, cam, focus, open, liftAt = null) {
      toL(cam, camL); toL(focus, focL);
      const near = Math.hypot(focus.x - HOME.x, focus.z - HOME.z) < LOOK.near;
      const kr = 1 - Math.exp(-dt * LOOK.roofSpeed), kw = 1 - Math.exp(-dt * LOOK.wallSpeed);
      moving = false;
      const roofGoal = open ? 1 : 0;
      if (liftAt != null) lift = liftAt;                   // (a recording: exactly where its clock says)
      else { lift += (roofGoal - lift) * kr; if (Math.abs(roofGoal - lift) < 1e-3) lift = roofGoal; else moving = true; }
      // the dollhouse view: with the roof off, the walls on the camera's side go too, so the whole room shows
      const cut = lift > 0.3 ? { WallFront: camL.z > HOUSE.oz, WallBack: camL.z < -HOUSE.oz, WallLeft: camL.x < -HOUSE.ox, WallRight: camL.x > HOUSE.ox } : {};
      for (const [name, part] of Object.entries(parts)) {
        const inWay = near && blocks(camL, focL, PIECES[name]);
        let goal = cut[name] ? LOOK.cut : inWay ? LOOK.faded : 1;
        if (name === 'Roof') goal = Math.min(goal, 1 - lift);
        let v = part.v + (goal - part.v) * kw;
        if (Math.abs(goal - v) < 2e-3) v = goal; else moving = true;
        if (v !== part.v) paint(part, v);
        if (name === 'Roof') part.node.position.y = part.baseY + (lift * LOOK.lift) / HOME.scale;
      }
    },
    /** your z's, while you sleep: `head` is where your head is ({x, y, z}) or null (awake) */
    zzz(t, head) {
      zees.forEach((z, k) => {
        z.visible = !!head;
        if (!head) return;
        const a = ((t + k * 1.3) % 3.9) / 3.9;
        z.position.set(head.x + Math.sin(a * 8 + k) * 0.35, head.y + 0.7 + a * 3.6, head.z);
        z.scale.setScalar(1.0 + a * 1.4);
        z.material.opacity = Math.min(1, a * 6) * (1 - a);
      });
    },
    /** what this ray hits: 'ownerbed' | 'basket' | 'herbed' (when you can see in) | 'house' | null */
    pick(ray) {
      local.copy(ray).applyMatrix4(inv);
      const seeIn = lift > 0.5 || (parts.WallFront?.v ?? 1) < 0.5 || inHouse(ray.origin.x, ray.origin.z);
      if (seeIn) {
        let best = null, bd = Infinity;
        for (const [k, b] of Object.entries(BOXES)) if (local.intersectBox(b, hit)) { const d = hit.distanceTo(local.origin); if (d < bd) { bd = d; best = k; } }
        if (best) return best;
      }
      return local.intersectBox(shell, hit) ? 'house' : null;
    },
    /** is something still fading or lifting? (the frame loop keeps going) */
    busy() { return moving; },
  };
}
