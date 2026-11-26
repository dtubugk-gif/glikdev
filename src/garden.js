// Day 7: the garden (idea by @elenaabrosimova1968). A raised wooden bed with six spots to plant the seeds the
// parrots bring. Plants grow on their own (gardenlogic.js stageAt): a mound, a sprout, a young plant, then the grown
// plant with its fruit. Tap a ripe one to pick it: the fruit hops off and pays out in friendship tokens. An atom
// bomb that lands near a plant mutates it (gardenlogic.js plots.blast): Irradiated, Cherenkov Glow or Atomic, each
// with its own painted fruit (models/garden/<fruit>_<mutation>.webp), tinted leaves, and for Atomic little atom
// rings spinning round every fruit. Nothing here is neon: the Cherenkov fruit is deep blue, painted from inside,
// with only the faintest light of its own.
//
// models/garden.glb + garden.json (art/day07/build_garden.py). Everything that moves is a pure function of the
// clock, so recordings come out the same every time.
import * as THREE from '../vendor/three/three.module.js';
import { GLTFLoader } from '../vendor/three/addons/loaders/GLTFLoader.js';
import { skyReflections } from './outfits.js';
import { FRUITS, MUTATIONS, fruitById, mutationById, stageAt, SCALE, GARDEN_AT, PERCH_AT, BED, gardenFrame as frame, plotAt } from './gardenlogic.js';
export { SCALE, GARDEN_AT, PERCH_AT, BED };
/** You walk round the bed (player.js boxes) and round the perch (circles). */
export const BED_BOX = { x: GARDEN_AT.x, z: GARDEN_AT.z, hx: BED.w / 2 + 0.4, hz: BED.d / 2 + 0.4, rot: GARDEN_AT.rot };
export const PERCH_CIRCLE = { x: PERCH_AT.x, z: PERCH_AT.z, r: 2.4 };
/** Bombs never land on the bed or the perch (atombox.js landSpot keepOut); they may land right beside them. */
export const KEEP_OUT = [{ x: GARDEN_AT.x, z: GARDEN_AT.z, r: Math.hypot(BED.w, BED.d) / 2 + 1.5 }, { x: PERCH_AT.x, z: PERCH_AT.z, r: 4.5 }];
/** Is (x, z) by the garden? (the parrot hands its seed over when you are this close to it) */
export const nearGarden = (x, z, r = 22) => Math.hypot(x - GARDEN_AT.x, z - GARDEN_AT.z) < r;
/** Keep a spot the kitty is sent to off the bed and the perch (she is big: a wide berth). */
export function outOfGarden(x, z, berth = 5.5) {
  const c = Math.cos(GARDEN_AT.rot), s = Math.sin(GARDEN_AT.rot);
  const dx = x - GARDEN_AT.x, dz = z - GARDEN_AT.z;
  const lx = c * dx - s * dz, lz = s * dx + c * dz;
  const hx = BED.w / 2 + berth, hz = BED.d / 2 + berth;
  if (Math.abs(lx) < hx && Math.abs(lz) < hz) {
    const px = hx - Math.abs(lx), pz = hz - Math.abs(lz);
    let ox = lx, oz = lz;
    if (px < pz) ox = Math.sign(lx || 1) * hx; else oz = Math.sign(lz || 1) * hz;
    ({ x, z } = frame(ox, oz));
  }
  const d = Math.hypot(x - PERCH_AT.x, z - PERCH_AT.z), r = PERCH_CIRCLE.r + berth;
  if (d < r) { const ux = d > 0.01 ? (x - PERCH_AT.x) / d : Math.sin(PERCH_AT.rot), uz = d > 0.01 ? (z - PERCH_AT.z) / d : Math.cos(PERCH_AT.rot); x = PERCH_AT.x + ux * r; z = PERCH_AT.z + uz * r; }
  return { x, z };
}
/** A spot to stand on to tend plot `p` (world {x, z}): just outside the nearest edge of the bed. */
export function standFor(p) {
  const c = Math.cos(GARDEN_AT.rot), s = Math.sin(GARDEN_AT.rot);
  const dx = p.x - GARDEN_AT.x, dz = p.z - GARDEN_AT.z;
  const lx = c * dx - s * dz, lz = s * dx + c * dz;           // into the bed's own frame
  const hz = BED.d / 2 + 3.2;
  const out = lz >= 0 ? hz : -hz;                             // the front or the back, whichever is nearer
  return frame(Math.max(-BED.w / 2, Math.min(BED.w / 2, lx)) * 0.92, out);
}

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (k) => { k = clamp01(k); return k * k * (3 - 2 * k); };
const easeOutBack = (k, s = 1.7) => { k = clamp01(k); return 1 + (s + 1) * (k - 1) ** 3 + s * (k - 1) ** 2; };

/** How a mutation looks (the leaf tints and textures come from garden.json and models/garden/ when they load). */
export const LOOK = {
  irradiated: { leaf: '#c9e05a', label: '#b7d43a', glow: null },
  cherenkov: { leaf: '#7fa6ff', label: '#3d6cff', glow: '#2f63ff' },
  atomic: { leaf: '#6fd3a4', label: '#2fae78', glow: null, rings: true },
};
/** How long a mutation's name shows over the plant (s). */
export const LABEL = { for: 3.6 };
/** What happens to a plant at harvest, second by second. */
export const PICK = { hop: 0.7, stagger: 0.14, sink: 0.5 };

/** a pill-shaped label as a sprite (the mutation's name over the plant) */
function labelSprite(text, dot) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const font = '700 44px Fredoka, Rubik, sans-serif';
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + 104, h = 76;
  c.width = w; c.height = h;
  g.font = font;
  const r = h / 2 - 5;
  g.beginPath(); g.roundRect(5, 5, w - 10, h - 10, r);
  g.fillStyle = '#fffaf2'; g.fill();
  g.lineWidth = 5; g.strokeStyle = '#2f2620'; g.stroke();
  g.beginPath(); g.arc(5 + r + 4, h / 2, 13, 0, Math.PI * 2); g.fillStyle = dot; g.fill();
  g.lineWidth = 3.5; g.stroke();
  g.fillStyle = '#2f2620'; g.textBaseline = 'middle'; g.fillText(text, 5 + r * 2 + 8, h / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
  s.renderOrder = 8;
  s.userData.aspect = w / h;
  return s;
}

/**
 * @param {{scene:THREE.Scene, url:string, infoUrl?:string, texUrl:(path:string)=>string, renderer:THREE.WebGLRenderer,
 *   plots:ReturnType<import('./gardenlogic.js').createPlots>}} o
 */
export async function createGarden(o) {
  const loader = new GLTFLoader();
  const [gltf, info] = await Promise.all([loader.loadAsync(o.url),
    o.infoUrl ? fetch(o.infoUrl).then((r) => (r.ok ? r.json() : null)).catch(() => null) : null]);
  const env = skyReflections(o.renderer);
  const aniso = Math.min(8, o.renderer.capabilities.getMaxAnisotropy());
  const need = (n) => { const x = gltf.scene.getObjectByName(n); if (!x) throw new Error(`garden.glb has no ${n}`); return x; };
  const nrm = new THREE.Vector3(), tan = new THREE.Vector3();
  gltf.scene.traverse((m) => {
    if (!m.isMesh) return;
    m.castShadow = true; m.receiveShadow = true;
    const T = m.geometry.attributes.tangent, N = m.geometry.attributes.normal;
    if (T && N) {                                            // (a tangent of no length shades its faces black)
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
      mat.envMap = env; mat.envMapIntensity = 0.4;
      mat.emissiveIntensity = 0;
    }
  });
  const heights = Object.fromEntries(Object.entries(info?.plants || {}).map(([k, v]) => [k, v.heights || {}]));
  if (info?.leafTint) for (const [k, v] of Object.entries(info.leafTint)) if (LOOK[k] && /^#[0-9a-f]{6}$/i.test(v)) LOOK[k].leaf = v;

  // the bed itself
  const bed = need('GardenBed');
  bed.removeFromParent();
  const group = new THREE.Group();
  group.name = 'Garden';
  group.position.set(GARDEN_AT.x, 0, GARDEN_AT.z);
  group.rotation.y = GARDEN_AT.rot;
  o.scene.add(group);
  bed.position.set(0, 0, 0); bed.rotation.set(0, 0, 0);
  bed.scale.setScalar(SCALE);
  group.add(bed);
  if (info?.bed?.w && info?.bed?.d) {
    BED.w = info.bed.w * SCALE; BED.d = info.bed.d * SCALE;
    BED_BOX.hx = BED.w / 2 + 0.4; BED_BOX.hz = BED.d / 2 + 0.4;
    KEEP_OUT[0].r = Math.hypot(BED.w, BED.d) / 2 + 1.5;
  }
  // a soft patch of shade round it (the sun's shadow map follows you)
  {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 30, 64, 64, 63);
    gr.addColorStop(0, 'rgba(38,32,28,0.42)'); gr.addColorStop(0.72, 'rgba(38,32,28,0.2)'); gr.addColorStop(1, 'rgba(38,32,28,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    const shade = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
    shade.rotation.x = -Math.PI / 2; shade.renderOrder = 1;
    shade.scale.set(BED.w * 1.35, BED.d * 1.5, 1);
    shade.position.y = 0.03;
    group.add(shade);
  }
  group.updateMatrixWorld(true);
  // the six spots, in the world
  const spots = [];
  for (let i = 0; i < o.plots.size; i++) {
    const e = bed.getObjectByName(`Plot_${i}`);
    const w = new THREE.Vector3();
    if (e) e.getWorldPosition(w);
    else if (info?.plots?.[i]) w.set(...info.plots[i]).multiplyScalar(SCALE).applyMatrix4(group.matrixWorld);
    else { const p = plotAt(i); w.set(p.x, 0.9, p.z); }
    spots.push(w);
  }

  // the models to clone: the mound, every plant's three stages, the loose fruit, the packets, the atom rings
  const take = (n) => { const x = gltf.scene.getObjectByName(n); if (x) x.removeFromParent(); return x || null; };
  const mound = take('Mound');
  const stages = {}, loose = {}, packets = {};
  for (const f of FRUITS) {
    stages[f.id] = { sprout: take(`${f.node}_Sprout`), young: take(`${f.node}_Young`), grown: take(`${f.node}_Grown`) };
    loose[f.id] = take(`${f.node}_Loose`);
    packets[f.id] = take(`Seed_${f.node}`);
  }
  const rings = take('AtomRings');

  // mutation looks: the painted fruit skins (loaded when first needed), and per plant cloned materials
  const texLoader = new THREE.TextureLoader();
  const skins = {}, loadedSkins = {};                        // `${fruit}_${mutation}` -> Promise<Texture>, and the ones that are in
  function skinTex(fruit, m) {
    const k = `${fruit}_${m}`;
    if (!skins[k]) {
      skins[k] = texLoader.loadAsync(o.texUrl(`models/garden/${k}.webp`)).then((t) => {
        t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; t.wrapS = t.wrapT = THREE.RepeatWrapping; loadedSkins[k] = t; return t;
      }).catch(() => null);
    }
    return skins[k];
  }

  // a recording must not wait a frame for a skin: it loads them all first (live play loads each when it is first needed)
  if (o.preload) await Promise.all(FRUITS.flatMap((f) => MUTATIONS.map((m) => skinTex(f.id, m.id))));
  /** dresses one plant model in a mutation: its own copies of the skin and leaf materials */
  function dress(model, fruit, m) {
    const f = fruitById(fruit), look = LOOK[m];
    model.traverse((x) => {
      if (!x.isMesh) return;
      const mats = [].concat(x.material).map((mat) => {
        const isSkin = mat.name === `${f.node}_Skin` || /_Skin$/.test(mat.name);
        const isLeaf = mat.name === `${f.node}_Leaf` || /_Leaf$/.test(mat.name);
        if (!isSkin && !isLeaf) return mat;
        const c = mat.clone();
        c.userData.base = mat.userData.base || mat;
        if (isLeaf && look) c.color.set('#ffffff').lerp(new THREE.Color(look.leaf), 0.7);   // (garden.json's tint, not all the way: the leaves stay leafy)
        if (isSkin && look) {
          const put = (t) => { if (t) { c.map = t; if (look.glow) c.emissiveMap = t; c.needsUpdate = true; } };
          const k = `${fruit}_${m}`;
          if (loadedSkins[k]) put(loadedSkins[k]); else skinTex(fruit, m).then(put);   // (already here: at once, the same frame)
          if (look.glow) { c.emissive = new THREE.Color(look.glow); c.userData.glow = true; }
          const r = info?.mutatedRoughness?.[m];
          if (Number.isFinite(r)) c.roughness = r;
        }
        return c;
      });
      x.material = Array.isArray(x.material) ? mats : mats[0];
    });
  }

  // one slot per plot: what stands there now
  const slots = spots.map((w, i) => {
    const g = new THREE.Group();
    g.position.copy(w);
    g.rotation.y = GARDEN_AT.rot + ((i * 2.4) % 1.2) - 0.6;  // each plant turned a little its own way
    o.scene.add(g);
    const m = mound ? mound.clone(true) : new THREE.Group();
    m.scale.setScalar(SCALE); m.visible = false;
    g.add(m);
    return { g, i, mound: m, key: null, models: null, fruits: [], ringSets: [], label: null, labelFor: null, picking: null };
  });

  /** (re)builds the models standing on slot s for its plant and mutation */
  function build(s, p) {
    const key = p ? `${p.fruit}:${p.mutation || ''}` : null;
    if (key === s.key) return;
    s.key = key;
    if (s.models) for (const m of Object.values(s.models)) if (m) s.g.remove(m);
    for (const r of s.ringSets) s.g.remove(r.obj);
    s.models = null; s.fruits = []; s.ringSets = [];
    if (s.label) { s.g.remove(s.label); s.label = null; }
    if (!p) return;
    const src = stages[p.fruit];
    s.models = {};
    for (const st of ['sprout', 'young', 'grown']) {
      if (!src[st]) continue;
      const m = src[st].clone(true);
      m.position.set(0, 0, 0);
      m.scale.setScalar(SCALE);
      m.visible = false;
      if (p.mutation) dress(m, p.fruit, p.mutation);
      s.g.add(m);
      s.models[st] = m;
    }
    const grown = s.models.grown;
    if (grown) {
      grown.traverse((x) => { if (/_Fruit_\d+$/.test(x.name)) s.fruits.push({ obj: x, rest: x.position.clone(), restQ: x.quaternion.clone(), restS: x.scale.clone() }); });
      s.fruits.sort((a, b) => a.obj.name.localeCompare(b.obj.name));
      if (p.mutation === 'atomic' && rings) {
        for (const fr of s.fruits) {
          const r = rings.clone(true);
          r.position.set(0, 0, 0); r.rotation.set(0, 0, 0);
          r.scale.setScalar(info?.atomRings?.scale?.[fruitById(p.fruit).node] ?? 1.2);   // a little wider than the fruit (garden.json)
          fr.obj.add(r);
          s.ringSets.push({ obj: r, electrons: [0, 1, 2].map((k) => r.getObjectByName(`Electron_${k}`)).filter(Boolean) });
        }
      }
    }
    if (p.mutation) {
      const mm = mutationById(p.mutation);
      s.label = labelSprite(mm.name, LOOK[p.mutation].label);
      s.g.add(s.label);
    }
  }

  let events = [];
  const v = new THREE.Vector3(), box = new THREE.Box3(), hitP = new THREE.Vector3();
  const lastStage = slots.map(() => null);
  const waves = [];                                           // the blast wave on the ground: {t, x, z}
  const waveTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d'), gr = g.createRadialGradient(128, 128, 60, 128, 128, 127);
    gr.addColorStop(0, 'rgba(214,226,150,0)'); gr.addColorStop(0.72, 'rgba(214,226,150,0.05)');
    gr.addColorStop(0.9, 'rgba(232,238,190,0.75)'); gr.addColorStop(1, 'rgba(232,238,190,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(c);
  })();
  const waveMeshes = Array.from({ length: 2 }, () => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: waveTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.rotation.x = -Math.PI / 2; m.renderOrder = 3; m.visible = false;
    o.scene.add(m);
    return m;
  });
  const WAVE = { for: 0.9, reach: 21 };

  return {
    group, packets, loose, spots,
    /** plot i's place in the world ({x, z}) */
    where: (i) => ({ x: spots[i].x, z: spots[i].z }),
    /** a bomb just landed at (x, z): its wave runs out over the ground */
    wave(t, x, z) { waves.push({ t, x, z }); if (waves.length > 2) waves.shift(); },
    /** the plot under this ray: its number, or -1 */
    pick(ray) {
      let best = -1, bestD = Infinity;
      for (const s of slots) {
        const st = o.plots.at(s.i) ? 7.5 : 2.2;
        box.min.set(s.g.position.x - 3.2, 0, s.g.position.z - 3.2);
        box.max.set(s.g.position.x + 3.2, st, s.g.position.z + 3.2);
        if (!ray.intersectBox(box, hitP)) continue;
        const d = hitP.distanceToSquared(ray.origin);
        if (d < bestD) { bestD = d; best = s.i; }
      }
      return best;
    },
    /** fruit of plot i, in the world, for the reward that flies off it */
    fruitAt(i, out = v) { const s = slots[i]; return out.set(s.g.position.x, s.g.position.y + 4.5, s.g.position.z); },
    /** the plant on plot i is picked at t (call after plots.harvest): its fruit hops off, then it sinks away */
    picked(i, t, fruit, mutation) {
      const s = slots[i];
      s.picking = { t, fruit, mutation, key: s.key, models: s.models, fruits: s.fruits, rings: s.ringSets, label: s.label };
      s.key = '__picked'; s.models = null; s.fruits = []; s.ringSets = []; s.label = null;
    },
    /** what an atom bomb that lands on you throws into the sky (blast.js start) */
    throwables: () => [{ obj: group }, ...slots.map((s) => ({ obj: s.g }))],
    /** shows plot i's mutation name for a moment (you tapped it) */
    showLabel(i, t) { if (slots[i]) slots[i].labelAt = t; },
    subjects() { return slots.filter((s) => o.plots.at(s.i)).map((s) => [s.g.position.x, 2.5, s.g.position.z]); },
    reset() { for (const s of slots) { build(s, null); s.picking = null; s.key = null; } lastStage.fill(null); waves.length = 0; events = []; },
    /** something is moving that needs every frame (the plants' sway alone is fine at half the frame rate) */
    busy: (t) => slots.some((s) => s.picking || (o.plots.at(s.i) && t - o.plots.at(s.i).mutatedAt < 1.2)) || waves.some((w) => t - w.t < WAVE.for),
    /** every frame: grows, sways and paints it all; returns what happened since the last call */
    update(t, camera) {
      const out = events; events = [];
      for (const s of slots) {
        const p = o.plots.at(s.i);
        // a plant being picked: its fruit hops off one by one, then what is left sinks into the soil
        if (s.picking) {
          const k = t - s.picking.t, P = s.picking;
          P.fruits.forEach((fr, n) => {
            const a = k - n * PICK.stagger;
            if (a < 0) return;
            const e = clamp01(a / PICK.hop);
            fr.obj.position.copy(fr.rest);
            fr.obj.position.y += (Math.sin(e * Math.PI) * 0.09 + e * 0.04);
            fr.obj.rotation.y = e * 5;
            fr.obj.scale.copy(fr.restS).multiplyScalar(Math.max(0.001, (1 - e) * (1 + 0.3 * Math.sin(e * Math.PI))));
            if (!fr.popped && a >= PICK.hop * 0.55) { fr.popped = true; out.push({ type: 'fruit-pop', t: s.picking.t + n * PICK.stagger + PICK.hop * 0.55, i: s.i, n }); }
          });
          const end = P.fruits.length * PICK.stagger + PICK.hop;
          const sk = clamp01((k - end * 0.6) / PICK.sink);
          if (P.models?.grown) P.models.grown.scale.setScalar(SCALE * Math.max(0.001, 1 - smooth(sk)));
          if (P.label) P.label.visible = false;
          if (sk >= 1) {
            if (P.models) for (const m of Object.values(P.models)) if (m) s.g.remove(m);
            if (P.label) s.g.remove(P.label);
            s.picking = null;
            s.key = null;
          } else continue;
        }
        build(s, p);
        s.mound.visible = !!p;
        if (!p) { lastStage[s.i] = null; continue; }
        const st = o.plots.stage(s.i, t);
        if (lastStage[s.i] !== st.stage) {
          if (lastStage[s.i] != null) out.push({ type: st.stage === 'grown' ? 'ripe' : 'grow', stage: st.stage, i: s.i, t, fruit: p.fruit });
          lastStage[s.i] = st.stage;
        }
        s.mound.scale.setScalar(SCALE * (st.stage === 'mound' ? st.pop : 1) * (st.stage === 'grown' ? 0.85 : 1));
        // the stage it is in: springs up as it gets there, grows a little through it, and sways in the breeze
        const sway = Math.sin(t * 1.3 + s.i * 1.7) * 0.025 + Math.sin(t * 2.9 + s.i) * 0.01;
        for (const name of ['sprout', 'young', 'grown']) {
          const m = s.models[name];
          if (!m) continue;
          m.visible = st.stage === name;
          if (!m.visible) continue;
          const grow = name === 'grown' ? 1 : 0.86 + 0.14 * st.k;
          const age = t - p.mutatedAt, shake = age >= 0 && age < 1.1 ? Math.sin(age * 34) * 0.07 * (1 - age / 1.1) : 0;
          const bump = age >= 0 && age < 0.6 ? 1 + 0.16 * Math.sin((age / 0.6) * Math.PI) : 1;
          m.scale.setScalar(SCALE * st.pop * grow * bump);
          m.rotation.set(sway + shake, 0, sway * 0.6 - shake * 0.7);
        }
        // ripe: the fruit gives a little "pick me" bounce every few seconds
        if (st.ripe) {
          const u = (t + s.i * 0.7) % 3.4, b = u > 2.8 ? Math.sin(((u - 2.8) / 0.6) * Math.PI) : 0;
          for (const fr of s.fruits) { fr.obj.position.copy(fr.rest); fr.obj.position.y += b * 0.006; fr.obj.scale.copy(fr.restS).multiplyScalar(1 + b * 0.08); }
        }
        for (const r of s.ringSets) {
          r.obj.rotation.set(t * 0.9, t * 1.7, t * 0.4);
          r.electrons.forEach((e, k) => { e.rotation.y = t * (2.4 + k * 0.7); });   // (each electron's origin is its ring's middle, its Y the ring's axis)
        }
        // the Cherenkov fruit: a slow, faint breathing of its own light (never bright)
        if (p.mutation === 'cherenkov' && s.models.grown) {
          const glow = 0.22 + 0.1 * Math.sin(t * 1.9 + s.i);
          s.models.grown.traverse((x) => { if (x.isMesh) for (const mat of [].concat(x.material)) if (mat.userData.glow) mat.emissiveIntensity = glow; });
        }
        // its label pops up over it when it mutates (or when you tap it), sits just over its top, then fades
        if (s.label) {
          const from = Math.max(p.mutatedAt, s.labelAt ?? -1e9), age = t - from;
          const on = age >= 0 && age < LABEL.for;
          s.label.visible = on;
          if (on) {
            const pop = age < 0.45 ? easeOutBack(age / 0.45, 2.4) : 1;
            const fade = 1 - smooth((age - (LABEL.for - 0.5)) / 0.5);
            const top = (heights[fruitById(p.fruit).node]?.[{ sprout: 'Sprout', young: 'Young', grown: 'Grown' }[st.stage]] ?? 0.06) * SCALE;
            s.label.position.set(0, top + 1.4 + 0.5 * smooth(age / 0.45), 0);
            const d = camera ? camera.position.distanceTo(v.copy(s.label.position).add(s.g.position)) : 30;
            const sc = Math.max(1.1, Math.min(3.0, d * 0.042)) * pop;
            s.label.scale.set(sc * s.label.userData.aspect, sc, 1);
            s.label.material.opacity = fade;
          }
        }
      }
      // the blast wave
      waveMeshes.forEach((m, k) => {
        const w = waves[k];
        const a = w ? t - w.t : 9;
        m.visible = !!w && a >= 0 && a < WAVE.for;
        if (!m.visible) return;
        const e = 1 - (1 - a / WAVE.for) ** 2;
        const r = 2 + WAVE.reach * 2 * e;
        m.scale.set(r, r, 1);
        m.position.set(w.x, 0.06, w.z);
        m.material.opacity = 1 - smooth((a - WAVE.for * 0.45) / (WAVE.for * 0.55));
      });
      return out;
    },
  };
}
export { MUTATIONS };
