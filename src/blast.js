// Day 5: what happens when an atom bomb lands on you (the owner: "if the bomb hits me, I will die and the whole
// world will just explode and then reload like nothing had happened. Make me have a really good version when I'm
// dead").
//
// The bomb goes off: a white flash and a big BOOM, a ring of dust races out over the plate, and everything on it
// (the kitty, the shop, her bed, any atom boxes) is thrown up into the sky, turning over and over, while the plate
// itself tips and drops away. You are gone; in your place your little angel-ghost floats up (models/
// player_ghost.glb, art/day05/build_ghost.py: the same kid with wings and a halo), flapping, quite content.
// The picture goes white, and then the world is back exactly as it was, and so are you.
// Everything is a pure function of the time since the bomb landed (blastPose, flyPose, ghostPose), so recordings
// come out the same every time.
import * as THREE from '../vendor/three/three.module.js';
import { GLTFLoader } from '../vendor/three/addons/loaders/GLTFLoader.js';
import { skyReflections } from './outfits.js';

/** seconds after the bomb lands: the picture starts to go white, the world is back, the white has cleared */
export const BLAST = { whiteAt: 1.8, whiteFor: 0.6, reloadAt: 2.5, end: 3.4, wave: 70, ghostScale: 20 };

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (k) => { k = clamp01(k); return k * k * (3 - 2 * k); };
const easeOut = (k) => 1 - (1 - clamp01(k)) ** 3;
const easeOutBack = (k, s = 1.70158) => { k = clamp01(k); return 1 + (s + 1) * (k - 1) ** 3 + s * (k - 1) ** 2; };

/**
 * The explosion `a` seconds after the bomb landed on you.
 * @returns {{on:boolean, dead:boolean, cover:number, shake:number, word:number, wordFade:number, plate:number, dust:number}}
 *   dead: you are gone (your ghost is up) until the world is back; cover 0..1: how white the picture is;
 *   shake: how hard the camera shakes (m); word: the size of the BOOM (0 = not there) and wordFade its opacity;
 *   plate 0..1: how far the plate has tipped and dropped; dust 0..1: how far the cloud has spread
 */
export function blastPose(a) {
  if (!(a >= 0) || a >= BLAST.end) return { on: false, dead: false, cover: 0, shake: 0, word: 0, wordFade: 0, plate: 0, dust: 0 };
  const before = a < BLAST.reloadAt;
  const flash = a < 0.05 ? a / 0.05 : Math.max(0, 1 - (a - 0.05) / 0.5);
  const white = before ? smooth((a - BLAST.whiteAt) / BLAST.whiteFor) : 1 - smooth((a - BLAST.reloadAt) / (BLAST.end - BLAST.reloadAt));
  return {
    on: true, dead: before,
    cover: Math.max(flash * 0.85, white),
    shake: before ? 1.6 * Math.exp(-a * 1.5) + 0.35 * clamp01((a - 0.5) / 1.2) : 0,
    word: before && a > 0.04 ? easeOutBack((a - 0.04) / 0.3, 2.4) * (1 + 0.06 * Math.sin(a * 30) * Math.exp(-a * 3)) : 0,
    wordFade: before ? 1 - smooth((a - 0.6) / 0.35) : 0,
    plate: before ? smooth((a - 0.45) / 1.5) : 0,
    dust: before ? easeOut(a / 1.7) : 0,
  };
}

/**
 * How far a thing `dist` metres from the bomb has been thrown, `a` seconds after it landed (thing number k: each
 * goes its own way a little). The ring of dust reaches it first; then it is off, out and up, turning over.
 * @returns {{on:boolean, out:number, up:number, spin:number}}  metres outward, metres up, radians
 */
export function flyPose(a, dist, k = 0) {
  const b = a - dist / BLAST.wave;
  if (!(a >= 0) || a >= BLAST.reloadAt || b <= 0) return { on: false, out: 0, up: 0, spin: 0 };
  return { on: true, out: (8 + (k % 4) * 2.5) * b, up: (11 + (k % 3) * 3) * b - 1.6 * b * b, spin: b * (2.3 + (k % 3) * 0.9) };
}

/**
 * Your ghost `a` seconds after the bomb landed: it pops up out of the flash and floats away upward, swaying.
 * @returns {{on:boolean, y:number, sway:number, scale:number, flap:number, halo:number, turn:number}}
 */
export function ghostPose(a) {
  if (!(a >= 0.1) || a >= BLAST.reloadAt) return { on: false, y: 0, sway: 0, scale: 0, flap: 0, halo: 0, turn: 0 };
  const b = a - 0.1;
  return { on: true, y: 0.9 + 3.4 * easeOut(b / 2.0) + 0.25 * Math.sin(b * 3.1), sway: 0.9 * Math.sin(b * 2.2), scale: Math.max(0.001, easeOutBack(b / 0.4, 2)),
    flap: 0.34 * Math.sin(b * 13), halo: 0.1 * Math.sin(b * 4.2), turn: 0.22 * Math.sin(b * 1.7) };
}

function softDisc(inner, stops) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, inner, 64, 64, 63);
  for (const [k, col] of stops) gr.addColorStop(k, col);
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/**
 * @param {{scene:THREE.Scene, renderer:THREE.WebGLRenderer, ghostUrl?:string, cover?:HTMLElement, word?:HTMLElement}} o
 *   cover: an element over the whole picture (its opacity is the white); word: the BOOM inside it
 */
export function createBlast(o) {
  const group = new THREE.Group();
  group.name = 'Blast';
  o.scene.add(group);
  const dustTex = softDisc(4, [[0, 'rgba(250,244,232,0.98)'], [0.5, 'rgba(232,220,202,0.8)'], [1, 'rgba(214,200,184,0)']]);
  const ringTex = softDisc(40, [[0, 'rgba(240,232,216,0)'], [0.55, 'rgba(240,232,216,0.0)'], [0.82, 'rgba(240,232,216,0.9)'], [0.93, 'rgba(226,212,192,0.75)'], [1, 'rgba(226,212,192,0)']]);
  const puffs = Array.from({ length: 12 }, () => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dustTex, transparent: true, depthWrite: false }));
    s.visible = false; s.renderOrder = 6;
    group.add(s);
    return s;
  });
  const ring = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: ringTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  ring.rotation.x = -Math.PI / 2; ring.renderOrder = 3; ring.visible = false;
  group.add(ring);

  // your ghost (the game still explodes without it, should the file not load)
  let ghost = null, halo = null, wings = [], haloRest = 0;
  if (o.ghostUrl) {
    new GLTFLoader().loadAsync(o.ghostUrl).then((gltf) => {
      const g = gltf.scene.getObjectByName('PlayerGhost');
      if (!g) throw new Error('player_ghost.glb has no PlayerGhost');
      const env = skyReflections(o.renderer), aniso = Math.min(8, o.renderer.capabilities.getMaxAnisotropy());
      gltf.scene.traverse((m) => {
        if (!m.isMesh) return;
        m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false; m.renderOrder = 7;
        for (const mat of [].concat(m.material)) {
          if (mat.map) mat.map.anisotropy = aniso;
          mat.envMap = env; mat.envMapIntensity = mat.metalness > 0.5 ? 1.1 : 0.45;
          mat.emissiveIntensity = 0;                         // nothing in this game glows, a halo included
        }
      });
      halo = g.getObjectByName('Halo') || null;
      haloRest = halo ? halo.position.y : 0;
      wings = [g.getObjectByName('Wing_L'), g.getObjectByName('Wing_R')].map((w) => (w ? { w, rest: w.rotation.clone() } : null));
      const holder = new THREE.Group();
      holder.name = 'GhostPlace';
      holder.add(g);
      holder.visible = false;
      group.add(holder);
      ghost = holder;
    }).catch((err) => console.warn('Glikdev: your ghost did not load', err));
  }

  let at = null, origin = { x: 0, z: 0 }, you = { x: 0, z: 0 }, things = [], reloaded = true;
  const q = new THREE.Quaternion(), ax = new THREE.Vector3();

  function restore() {
    for (const th of things) {
      if (th.live) { th.obj.rotation.x = 0; th.obj.rotation.z = 0; continue; }     // (its own code places it every frame)
      th.obj.position.copy(th.pos); th.obj.quaternion.copy(th.quat);
    }
    things = [];
    for (const s of puffs) s.visible = false;
    ring.visible = false;
    if (ghost) ghost.visible = false;
  }

  return {
    group,
    /**
     * The bomb landed on you at t, at (x, z); you stood at (px, pz). `list`: what is thrown about:
     * [{obj, live?, plate?}] (live: something that is placed again every frame by its own code, like the kitty;
     * plate: the ground itself, which tips and drops away instead of flying).
     */
    start(t, x, z, px, pz, list = []) {
      if (at != null && t - at < BLAST.end) return false;
      at = t; origin = { x, z }; you = { x: px, z: pz }; reloaded = false;
      things = list.filter((th) => th && th.obj).map((th, k) => ({ ...th, k, pos: th.obj.position.clone(), quat: th.obj.quaternion.clone() }));
      return true;
    },
    /** a recording starting over */
    reset() { restore(); at = null; reloaded = true; if (o.cover) { o.cover.hidden = true; o.cover.style.opacity = '0'; } },
    /** true from the moment it lands until the white has cleared */
    active: (t) => at != null && t >= at && t - at < BLAST.end,
    /** where your ghost is just now ([x, y, z]), for the lens */
    ghostAt: (t) => [you.x, ghostPose(at == null ? -1 : t - at).y + 3.2, you.z],
    /** true while you are gone (nothing you tap or press does anything) */
    dead: (t) => at != null && t >= at && t - at < BLAST.reloadAt,
    /**
     * Every frame, after everything else has been placed and before the picture is drawn.
     * @returns {{dead:boolean, reload:boolean}}  reload: true once, on the frame the world is back
     */
    update(t, camera) {
      const a = at == null ? -1 : t - at;
      const p = blastPose(a);
      if (o.cover) {
        const show = p.cover > 0.003 || p.word > 0;
        if (o.cover.hidden === show) o.cover.hidden = !show;
        if (show) {
          o.cover.style.backgroundColor = `rgba(255,252,246,${p.cover.toFixed(3)})`;
          if (o.word) { o.word.style.transform = `scale(${p.word.toFixed(3)}) rotate(-4deg)`; o.word.style.opacity = (p.word > 0 ? p.wordFade : 0).toFixed(3); }
        }
      }
      let reload = false;
      if (at != null && a >= BLAST.reloadAt && !reloaded) { reloaded = true; reload = true; restore(); }
      if (!p.on || !p.dead) { if (at != null && a >= BLAST.end) at = null; return { dead: false, reload }; }

      // everything is thrown outward from where it landed
      for (const th of things) {
        const base = th.live ? th.obj.position : th.pos;
        if (th.plate) {
          const e = p.plate, s = p.shake * 0.35;
          th.obj.position.set(th.pos.x + s * Math.sin(a * 53), th.pos.y - 90 * e * e + s * Math.cos(a * 41), th.pos.z);
          th.obj.quaternion.copy(th.quat).multiply(q.setFromAxisAngle(ax.set(0.5, 0, 0.86), 0.55 * e * e));
          continue;
        }
        const dx = base.x - origin.x, dz = base.z - origin.z, d = Math.hypot(dx, dz);
        const f = flyPose(a, d, th.k);
        const ux = d > 0.5 ? dx / d : Math.sin(th.k * 2.4), uz = d > 0.5 ? dz / d : Math.cos(th.k * 2.4);
        if (th.live) {
          th.obj.position.x += ux * f.out; th.obj.position.z += uz * f.out; th.obj.position.y += f.up;
          th.obj.rotation.x = f.spin * 0.9; th.obj.rotation.z = f.spin * 0.5;
        } else {
          th.obj.position.set(th.pos.x + ux * f.out, th.pos.y + f.up, th.pos.z + uz * f.out);
          th.obj.quaternion.copy(th.quat).multiply(q.setFromAxisAngle(ax.set(uz, 0.3, -ux).normalize(), f.spin));
        }
      }
      // the cloud, and the ring of dust racing out over the plate
      puffs.forEach((s, k) => {
        s.visible = true;
        // three big puffs go up in a column over the spot, the rest roll out low along the ground
        const ang = (k / puffs.length) * Math.PI * 2 + 0.4, out = p.dust * (k < 3 ? 1 + k * 2 : 11 + (k % 4) * 6);
        s.position.set(origin.x + Math.sin(ang) * out, 2 + p.dust * (k < 3 ? 9 + k * 8 : 1.5 + (k % 3) * 2), origin.z + Math.cos(ang) * out);
        s.scale.setScalar((k < 3 ? 11 - k * 1.5 : 6 + (k % 3) * 2) * (0.4 + 0.9 * p.dust));
        s.material.opacity = 0.9 * (1 - clamp01((a - 0.5) / 1.0));
      });
      ring.visible = a < 1.5;
      if (ring.visible) {
        const r = Math.max(1, 2 * BLAST.wave * a);
        ring.scale.set(r, r, 1);
        ring.position.set(origin.x, 0.12, origin.z);
        ring.material.opacity = 1 - clamp01(a / 1.5);
      }
      // your ghost, turned to the camera
      if (ghost) {
        const gp = ghostPose(a);
        ghost.visible = gp.on;
        if (gp.on) {
          const face = camera ? Math.atan2(camera.position.x - you.x, camera.position.z - you.z) : 0;
          ghost.position.set(you.x + gp.sway * Math.cos(face), gp.y, you.z - gp.sway * Math.sin(face));
          ghost.rotation.set(0, face + gp.turn, 0.12 * Math.sin((a - 0.1) * 2.2));
          ghost.scale.setScalar(BLAST.ghostScale * gp.scale);
          if (halo) { halo.position.y = haloRest + gp.halo * 0.02; halo.rotation.y = a * 1.4; }
          wings.forEach((wg, k) => { if (wg) { wg.w.rotation.copy(wg.rest); wg.w.rotateY((k === 0 ? 1 : -1) * gp.flap); } });
        }
      }
      // the camera shakes
      if (camera && p.shake > 0) {
        camera.position.x += p.shake * Math.sin(a * 61) * 0.7;
        camera.position.y += p.shake * Math.cos(a * 47) * 0.5;
      }
      return { dead: true, reload };
    },
  };
}
