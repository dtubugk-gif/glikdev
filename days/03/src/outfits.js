// Day 3: what the kitty wears, and the friendship tokens that fly up from her (idea by @Kowffe).
// models/outfits.glb holds the token and every outfit piece (all built in Blender: art/day03).
// models/outfits_fit.json says, for each of the three cats, where each kind of piece sits: the bone it
// rides on and its frame in the model's rest pose (art/day03/fit_cats.py measures the cats for it).
import * as THREE from '../vendor/three/three.module.js';
import { GLTFLoader } from '../vendor/three/addons/loaders/GLTFLoader.js';
import { ITEMS, SLOTS, itemById } from './tokens.js';

const easeOutBack = (k) => { const x = Math.min(1, Math.max(0, k)) - 1; return 1 + 2.7 * x ** 3 + 1.7 * x ** 2; };
const clamp01 = (x) => Math.min(1, Math.max(0, x));

/**
 * Something for the gold, the jewels and the lenses to reflect: the game's own daylight (blue sky, a pale
 * horizon, the grey plate below and a bright sun), prefiltered once. Only the outfits use it.
 */
function skyReflections(renderer) {
  const sky = new THREE.Scene();
  const geo = new THREE.SphereGeometry(50, 32, 16);
  const col = new Float32Array(geo.attributes.position.count * 3);
  const top = new THREE.Color('#7fb2e6'), mid = new THREE.Color('#e9eef2'), low = new THREE.Color('#8a8e92'), c = new THREE.Color();
  for (let i = 0; i < geo.attributes.position.count; i++) {
    const h = geo.attributes.position.getY(i) / 50;
    if (h >= 0) c.copy(mid).lerp(top, Math.min(1, h * 1.6) ** 0.7); else c.copy(mid).lerp(low, Math.min(1, -h * 5));
    c.multiplyScalar(h >= 0 ? 1.25 : 0.8);
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  sky.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const sun = new THREE.Mesh(new THREE.SphereGeometry(5, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(40, 37, 32) }));
  sun.position.set(-22, 34, 18);
  sky.add(sun);
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(sky, 0.03).texture;
  pm.dispose();
  geo.dispose();
  return tex;
}

/**
 * @param {{kitty:object, glbUrl:string, fitUrl:string, cat:string, renderer?:THREE.WebGLRenderer}} o
 * `kitty` is createKitty()'s object: attach(bone, obj, frame), setCollar(visible), on(fn).
 */
export async function createWardrobe(o) {
  const [gltf, fit] = await Promise.all([
    new GLTFLoader().loadAsync(o.glbUrl),
    fetch(o.fitUrl).then((r) => { if (!r.ok) throw new Error(`outfits_fit.json ${r.status}`); return r.json(); }),
  ]);
  const aniso = Math.min(8, o.renderer?.capabilities.getMaxAnisotropy() ?? 1);
  const env = o.renderer ? skyReflections(o.renderer) : null;
  const parts = {};
  for (const it of ITEMS) {
    const node = gltf.scene.getObjectByName(it.node);
    if (!node) throw new Error(`outfits.glb has no ${it.node}`);
    parts[it.id] = node;
  }
  const token = gltf.scene.getObjectByName('Token');
  if (!token) throw new Error('outfits.glb has no Token');
  gltf.scene.traverse((m) => {
    if (!m.isMesh) return;
    m.castShadow = true; m.receiveShadow = true;
    m.frustumCulled = false;                       // they ride on bones: the rest-pose bounds do not follow
    for (const mat of [].concat(m.material)) {
      if (mat.map) mat.map.anisotropy = aniso;
      if (env) { mat.envMap = env; mat.envMapIntensity = mat.metalness > 0.5 ? 1.15 : 0.55; }
    }
  });
  for (const n of Object.values(parts)) n.removeFromParent();
  token.removeFromParent();
  const wings = ['Wing_L', 'Wing_R'].map((n) => parts.wings.getObjectByName(n));
  const temples = ['Temple_L', 'Temple_R'].map((n) => parts.shades.getObjectByName(n));

  let cat = o.cat;
  let wearing = Object.fromEntries(SLOTS.map((s) => [s, null]));
  // one holder per slot: its matrix puts the piece on the bone; the piece inside pops in when put on
  const holders = Object.fromEntries(SLOTS.map((s) => { const g = new THREE.Group(); g.name = `Wear_${s}`; g.matrixAutoUpdate = false; return [s, g]; }));
  const putOnAt = Object.fromEntries(SLOTS.map((s) => [s, -10]));
  const frame = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s3 = new THREE.Vector3();

  function place(slot) {
    const h = holders[slot];
    h.removeFromParent();
    h.clear();
    const it = itemById(wearing[slot]);
    const f = it && fit[cat]?.[it.fit];
    if (!it || !f) return;
    frame.compose(p.fromArray(f.p), q.fromArray(f.q), s3.fromArray(f.s));
    if (!o.kitty.attach(f.bone, h, frame)) return;
    h.add(parts[it.id]);
    if (it.id === 'shades') {
      const a = fit[cat].splay ?? 0.15;
      if (temples[0]) temples[0].rotation.y = -a;
      if (temples[1]) temples[1].rotation.y = a;
    }
  }
  function dressAll() {
    for (const slot of SLOTS) place(slot);
    o.kitty.setCollar(!wearing.neck);              // her own collar and bell come off under a bow tie or a scarf
  }
  function undress() { for (const slot of SLOTS) { holders[slot].removeFromParent(); holders[slot].clear(); } }
  // changing cats: the pieces come off the old skeleton (before it is thrown away) and go on the new one
  o.kitty.on((e) => {
    if (e.type === 'cat-out') undress();
    else if (e.type === 'cat-in') { cat = e.cat || cat; dressAll(); }
  });

  return {
    token,
    /** @param {{hat,face,neck,back}} w item ids or null; `t` = now on the kitty's clock (for the pop-in) */
    dress(w, t = -10) {
      for (const slot of SLOTS) {
        const id = w?.[slot] && itemById(w[slot])?.slot === slot ? w[slot] : null;
        if (id !== wearing[slot]) { wearing[slot] = id; putOnAt[slot] = t; }
      }
      dressAll();
    },
    setCat(c) { cat = c; dressAll(); },
    get wearing() { return { ...wearing }; },
    /** every frame: the pop when something is put on, and the wings' slow beat */
    update(t) {
      for (const slot of SLOTS) {
        const part = holders[slot].children[0];
        if (!part) continue;
        const a = t - putOnAt[slot];
        part.scale.setScalar(a < 0 ? 1 : a < 0.45 ? Math.max(0.001, easeOutBack(a / 0.45)) : 1);
      }
      if (wearing.back === 'wings') {
        const beat = 0.16 * Math.sin(t * 2.4) + 0.05 * Math.sin(t * 5.1 + 1);
        if (wings[0]) wings[0].rotation.z = beat;
        if (wings[1]) wings[1].rotation.z = -beat;
      }
    },
    /** true while a pop-in is playing (the page then renders every frame; the wings' slow beat is fine at 30) */
    busy(t) { return SLOTS.some((s) => t - putOnAt[s] < 0.5); },
  };
}

/**
 * Tokens in the world: each one pops up over her head, spins, then flies to the counter on screen.
 * Everything is a function of the kitty's clock, so recordings come out the same every time.
 * @param {{scene:THREE.Scene, camera:THREE.PerspectiveCamera, token:THREE.Object3D}} o
 */
export function createTokenFX(o) {
  const RISE = 0.62, FLY = 0.5, SIZE = 1.5 / 0.06;           // the coin is 6 cm across at cat size; 1.5 m in the world
  const group = new THREE.Group();
  group.name = 'TokenFX';
  o.scene.add(group);
  const coins = Array.from({ length: 10 }, () => {
    const c = o.token.clone();
    c.visible = false;
    c.traverse((m) => { if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; m.renderOrder = 5; } });
    group.add(c);
    return c;
  });
  let log = [];                                              // {t, x, y, z, k}
  const up = new THREE.Vector3(), tgt = new THREE.Vector3(), dir = new THREE.Vector3();
  return {
    /** n tokens appear at world point `from` at time t (a little apart, one after another) */
    spawn(t, from, n = 1) {
      for (let k = 0; k < n; k++) log.push({ t: t + k * 0.14, x: from.x, y: from.y, z: from.z, k: log.length + k, i: k, n });
    },
    reset() { log = []; for (const c of coins) c.visible = false; },
    /**
     * @param {number} t          now
     * @param {{x:number,y:number}|null} hud   where the counter is on screen (NDC, -1..1), or null to fly straight up
     * @returns {number} tokens still on their way to the counter
     */
    update(t, hud) {
      log = log.filter((c) => t - c.t < RISE + FLY);
      let flying = 0, slot = 0;
      const cam = o.camera;
      const pxWorld = (2 * Math.tan((cam.fov * Math.PI) / 360)) / Math.max(1, innerHeight);   // world units per px at distance 1
      for (const c of log) {
        const a = t - c.t;
        flying++;
        if (a < 0 || slot >= coins.length) continue;
        const coin = coins[slot++];
        coin.visible = true;
        const side = (c.i - (c.n - 1) / 2) * 1.5;
        const lift = 2.6 * easeOutBack(a / 0.4) + 0.5 * Math.sin(clamp01(a / RISE) * Math.PI);
        up.set(c.x + side * clamp01(a / 0.3), c.y + 1.4 + lift, c.z);
        let scale = SIZE * Math.max(0.001, easeOutBack(a / 0.28));
        coin.rotation.set(0, a * 8.5 + c.k, 0);
        if (a > RISE) {
          const k = clamp01((a - RISE) / FLY), e = k * k * (3 - 2 * k) * k;      // slow away, fast into the counter
          const D = 14;
          if (hud) tgt.set(hud.x, hud.y, 0.5).unproject(cam);
          else tgt.set(up.x, up.y + 30, up.z);
          dir.copy(tgt).sub(cam.position).normalize();
          tgt.copy(cam.position).addScaledVector(dir, D);
          up.lerp(tgt, e);
          up.y += 1.2 * Math.sin(k * Math.PI) * (1 - e);
          const end = (26 * pxWorld * D) / 0.06;                                  // as big as the counter's own coin
          scale += (end - scale) * e;
        }
        coin.position.copy(up);
        coin.scale.setScalar(scale);
      }
      for (; slot < coins.length; slot++) coins[slot].visible = false;
      return flying;
    },
    busy() { return log.length > 0; },
  };
}
