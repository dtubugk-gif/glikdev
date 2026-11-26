// Day 4: the fish on a stick (idea by @Darkbacon155: "Can you please make a fish toy on a stick").
// models/wand.glb was built in Blender (art/day04/build_wand.py, wand_fish.py): WandRod (with WandTip, the ring
// the line leaves from) and WandFish (with FishLoop, where the line ties on, and four parts that move:
// FishTail, FishDorsal, FishFinP, FishFinN).
//
// Who does what:
//   player.js    holds the rod in your right hand (createWand().rod is handed to player.giveRod)
//   kittybrain   moves the fish: it is her toy (brain.yarn with wand: true), tied to the rod's tip by a line
//   this file    draws it all: the fish where the brain says it is (upright, nose first, her back up the line
//                when she hangs or flies; her tail wags, her fins flap, she squashes when she lands), the line
//                from the rod's tip to the loop on her back, the rod bending under the pull of the line, and
//                the little effects: a ring where a cast will land, a puff of stars when she lands or is batted,
//                a trail of dots behind her as she flies.
// Everything here is worked out from the kitty's clock and her events, so recordings come out the same.
import * as THREE from '../vendor/three/three.module.js';
import { GLTFLoader } from '../vendor/three/addons/loaders/GLTFLoader.js';
import { YARN } from './kittybrain.js';
import { HOLD } from './player.js';
import { skyReflections } from './outfits.js';

const S = HOLD.scale, SF = HOLD.fishScale;
const FISH_LOW = 0.0268 * SF;       // her lowest point below the middle of her body (build_wand.py prints it)
const SEG = 22, SIDES = 5, LINE_R = 0.036;
const SHAFT0 = 0.034, SHAFT_LEN = 0.121;   // where the rod's shaft starts and how long it is (model units): only the shaft bends
const wrap = (a) => ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const easeOutBack = (k) => { const x = clamp01(k) - 1; return 1 + 2.7 * x ** 3 + 1.7 * x ** 2; };

function canvasTexture(draw, size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const starTexture = () => canvasTexture((g, s) => {
  g.translate(s / 2, s / 2 + 3);
  const star = () => {
    g.beginPath();
    for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + (k * Math.PI) / 5, r = k % 2 ? 20 : 46; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    g.closePath();
  };
  g.lineJoin = 'round';
  star(); g.lineWidth = 14; g.strokeStyle = '#fff8ec'; g.stroke();
  star(); g.fillStyle = '#ffd35e'; g.fill();
  g.lineWidth = 5; g.strokeStyle = '#2f2620'; g.stroke();
});
const dotTexture = () => canvasTexture((g, s) => {
  const r = g.createRadialGradient(s / 2, s / 2, 2, s / 2, s / 2, s / 2 - 2);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.6, 'rgba(255,255,255,0.75)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, s, s);
}, 64);
const ringTexture = () => canvasTexture((g, s) => {
  g.lineWidth = 16; g.strokeStyle = 'rgba(47,38,32,0.55)';
  g.beginPath(); g.arc(s / 2, s / 2, s / 2 - 18, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 9; g.strokeStyle = '#fff8ec';
  g.beginPath(); g.arc(s / 2, s / 2, s / 2 - 18, 0, Math.PI * 2); g.stroke();
}, 256);

/**
 * @param {{scene:THREE.Scene, url:string, renderer?:THREE.WebGLRenderer}} o
 */
export async function createWand(o) {
  const gltf = await new GLTFLoader().loadAsync(o.url);
  const need = (n) => { const x = gltf.scene.getObjectByName(n); if (!x) throw new Error(`wand.glb has no ${n}`); return x; };
  const rodMesh = need('WandRod'), tipNode = need('WandTip'), fishMesh = need('WandFish'), loopNode = need('FishLoop');
  const tail = need('FishTail'), dorsal = need('FishDorsal'), finP = need('FishFinP'), finN = need('FishFinN');
  const aniso = Math.min(8, o.renderer?.capabilities.getMaxAnisotropy() ?? 1);
  const env = o.renderer ? skyReflections(o.renderer) : null;
  gltf.scene.traverse((m) => {
    if (!m.isMesh) return;
    m.castShadow = true; m.receiveShadow = true;
    m.frustumCulled = false;                       // they move with your hand and the line
    for (const mat of [].concat(m.material)) {
      if (mat.map) mat.map.anisotropy = aniso;
      if (env) { mat.envMap = env; mat.envMapIntensity = mat.metalness > 0.5 ? 1.15 : 0.5; }
    }
  });
  // the rod bends: its shaft leans by uBend (model units), more and more toward the tip
  const uBend = { value: new THREE.Vector3() };
  const tipRest = tipNode.position.clone();
  rodMesh.traverse((m) => {
    if (!m.isMesh) return;
    for (const mat of [].concat(m.material)) {
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uBend = uBend;
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nuniform vec3 uBend;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
{ float kBend = clamp((position.y - ${SHAFT0.toFixed(4)}) / ${SHAFT_LEN.toFixed(4)}, 0.0, 1.0); transformed += uBend * kBend * kBend; }`);
      };
      mat.customProgramCacheKey = () => 'wand-bend';
    }
  });
  const rod = new THREE.Group();
  rod.name = 'Wand';
  rod.scale.setScalar(S);
  rodMesh.position.set(0, 0, 0);
  rod.add(rodMesh);
  rod.visible = false;
  const fish = new THREE.Group();
  fish.name = 'WandFish';
  fish.scale.setScalar(SF);
  fishMesh.position.set(0, 0, 0);
  fish.add(fishMesh);
  fish.visible = false;
  o.scene.add(fish);
  const stub = new THREE.Group();                  // takes the yarn ball's place in kitty.js (the fish is drawn here instead)
  stub.name = 'WandFishStub';

  // the line: a thin tube from the tip to the loop, rebuilt every frame (it sags when it is slack)
  const pos = new Float32Array((SEG + 1) * SIDES * 3), idx = [];
  for (let i = 0; i < SEG; i++) {
    for (let k = 0; k < SIDES; k++) {
      const a = i * SIDES + k, b = i * SIDES + (k + 1) % SIDES, c = a + SIDES, d = b + SIDES;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  const line = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#f0705a', roughness: 0.75 }));
  line.name = 'WandLine';
  line.frustumCulled = false;
  line.castShadow = false;
  line.visible = false;
  o.scene.add(line);

  // ---------------------------------------------------------------- effects
  const fx = new THREE.Group();
  fx.name = 'WandFX';
  o.scene.add(fx);
  const sprites = (tex, n) => Array.from({ length: n }, () => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
    s.visible = false;
    fx.add(s);
    return s;
  });
  const stars = sprites(starTexture(), 14), dots = sprites(dotTexture(), 8);
  const ringTex = ringTexture();
  const flat = (n) => Array.from({ length: n }, () => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: ringTex, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, fog: false }));
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = 2;
    m.visible = false;
    fx.add(m);
    return m;
  });
  const rings = flat(3);
  let bursts = [];                                  // {t, x, y, z, n, up, size}: puffs of stars
  let puffs = [];                                   // {t, x, z}: a ring spreading on the floor where she landed
  let mark = null;                                  // {t, x, z, end}: where the cast will land
  let trail = [];                                   // {t, x, y, z}: where she has just been (while she flies)
  let squashAt = -10, squashBy = 0, kickAt = -10;

  let on = false, yaw = 0, started = false;
  const up = new THREE.Vector3(0, 1, 0);
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), P = new THREE.Vector3(), Q = new THREE.Vector3();
  const tan = new THREE.Vector3(), side = new THREE.Vector3(), nrm = new THREE.Vector3(), want = new THREE.Vector3();
  const bx = new THREE.Vector3(), bz = new THREE.Vector3(), basis = new THREE.Matrix4();
  const axis = new THREE.Vector3(), pull = new THREE.Vector3(), bend = new THREE.Vector3(), bendV = new THREE.Vector3(), q = new THREE.Quaternion();
  const WORLD_UP = new THREE.Vector3(0, 1, 0);
  const curve = (s, sag, out) => {
    out.lerpVectors(A, B, s);
    out.y = Math.max(0.07, out.y - sag * 4 * s * (1 - s));
    return out;
  };
  function clearFX() {
    bursts = []; puffs = []; mark = null; trail = []; squashAt = -10; kickAt = -10;
    for (const s of [...stars, ...dots, ...rings]) s.visible = false;
  }

  /** the little effects, all from the kitty's clock */
  function drawFX(t, y) {
    // stars: each burst throws its stars out and up, they spin, shrink and fade
    let si = 0;
    bursts = bursts.filter((b) => t - b.t < 0.8);
    for (const b of bursts) {
      const a = t - b.t;
      if (a < 0) continue;
      for (let k = 0; k < b.n && si < stars.length; k++) {
        const s = stars[si++], ang = (k / b.n) * Math.PI * 2 + b.t * 7, out = (1.1 + 1.5 * ((k * 37) % 5) / 5) * b.size;
        const e = 1 - (1 - clamp01(a / 0.6)) ** 2;
        s.visible = true;
        s.position.set(b.x + Math.cos(ang) * out * e, b.y + b.up * e + 1.2 * Math.sin(clamp01(a / 0.75) * Math.PI) * b.size - 1.6 * a * a, b.z + Math.sin(ang) * out * e);
        s.scale.setScalar(Math.max(0.01, (0.75 + 0.35 * ((k * 13) % 3)) * b.size * easeOutBack(a / 0.16) * (1 - clamp01((a - 0.45) / 0.35))));
        s.material.rotation = ang + a * 5 * (k % 2 ? 1 : -1);
        s.material.opacity = 1 - clamp01((a - 0.5) / 0.3);
      }
    }
    for (; si < stars.length; si++) stars[si].visible = false;
    // rings on the floor: where a cast will land (it pulses until she lands), and a ripple where she landed
    let ri = 0;
    if (mark && t >= mark.t && t < mark.end + 0.25) {
      const r = rings[ri++], a = t - mark.t, gone = clamp01((t - mark.end) / 0.25);
      r.visible = true;
      r.position.set(mark.x, 0.06, mark.z);
      r.scale.setScalar((2.6 + 0.25 * Math.sin(a * 16)) * easeOutBack(a / 0.2) * (1 + 0.5 * gone));
      r.material.opacity = 0.8 * (1 - gone);
    } else if (mark && t >= mark.end + 0.25) mark = null;
    puffs = puffs.filter((p) => t - p.t < 0.5);
    for (const p of puffs) {
      if (ri >= rings.length || t < p.t) continue;
      const r = rings[ri++], a = (t - p.t) / 0.5;
      r.visible = true;
      r.position.set(p.x, 0.07, p.z);
      r.scale.setScalar(1.4 + 4.2 * (1 - (1 - a) ** 2));
      r.material.opacity = 0.7 * (1 - a);
    }
    for (; ri < rings.length; ri++) rings[ri].visible = false;
    // a trail of dots behind her while she flies
    const flying = !!y && y.air && !y.held && !y.reel;
    if (flying) trail.push({ t, x: C.x, y: C.y, z: C.z });
    trail = trail.filter((p) => t - p.t < 0.42);
    for (let k = 0; k < dots.length; k++) {
      const d = dots[k], age = 0.05 * (k + 1);
      let hit = null;
      for (let j = trail.length - 1; j >= 0; j--) if (t - trail[j].t >= age - 1e-6) { hit = trail[j]; break; }
      d.visible = !!hit && (flying || t - trail[trail.length - 1].t < 0.3);
      if (!d.visible) continue;
      d.position.set(hit.x, hit.y, hit.z);
      d.scale.setScalar(0.85 * (1 - k / (dots.length + 2)));
      d.material.opacity = 0.75 * (1 - k / dots.length);
    }
  }

  return {
    /** the rod's model: hand it to player.giveRod() */
    rod,
    /** what kitty.setToy() gets while the fish is out (the fish itself is drawn by this file) */
    stub,
    fish,
    setOn(v) { on = !!v; started = false; if (!on) { fish.visible = false; line.visible = false; clearFX(); } },
    get on() { return on; },
    /** her events (from kitty.on): a cast, a landing, a swat; and 'reset' when a recording starts over */
    event(e, y) {
      if (e.type === 'reset') { clearFX(); started = false; return; }
      if (!on || !y?.wand) return;
      if (e.type === 'cast') { mark = { t: e.t, x: e.x, z: e.z, end: e.t + 1.2 }; kickAt = e.t; }
      else if (e.type === 'thud') {
        if (mark) mark.end = Math.min(mark.end, e.t);
        puffs.push({ t: e.t, x: e.x, z: e.z });
        bursts.push({ t: e.t, x: e.x, y: 0.5, z: e.z, n: e.soft ? 3 : 5, up: 0.9, size: e.soft ? 0.7 : 1 });
        squashAt = e.t; squashBy = e.soft ? 0.16 : 0.3;
      } else if (e.type === 'swat') {
        bursts.push({ t: e.t, x: y.x, y: y.y + 0.2, z: y.z, n: 6, up: 1.8, size: 1.25 });
        squashAt = e.t; squashBy = 0.24;
      }
    },
    /**
     * Every frame, after the player and the kitty have moved.
     * @param {number} dt       seconds since the last frame
     * @param {number} t        the kitty's clock (s)
     * @param {object|null} y   brain.yarn
     * @param {number} heading  the way you are facing (radians)
     */
    update(dt, t, y, heading) {
      const show = on && !!y?.wand && rod.visible;
      fish.visible = show;
      line.visible = show;
      fx.visible = show;
      if (!show) return;
      rod.updateWorldMatrix(true, true);
      C.set(y.x, y.y - YARN.radius + FISH_LOW, y.z);
      // which way she faces: nose first when she moves; hanging, she turns slowly this way and that
      const speed = Math.hypot(y.vx, y.vz);
      let wantYaw = yaw;
      if (y.hang && !y.dangle) wantYaw = heading + 1.15 + 0.45 * Math.sin(t * 0.7);
      else if (speed > 0.8) wantYaw = Math.atan2(y.vx, y.vz);
      if (!started) { yaw = wantYaw; up.set(0, 1, 0); bend.set(0, 0, 0); bendV.set(0, 0, 0); started = true; }
      yaw += wrap(wantYaw - yaw) * (1 - Math.exp(-dt * (y.hang ? 2.5 : 10)));
      // the rod bends toward the pull of the line (a spring, so it wobbles after a cast); the line starts at the bent tip
      rod.getWorldQuaternion(q);
      axis.set(0, 1, 0).applyQuaternion(q);
      A.copy(tipRest).applyMatrix4(rod.matrixWorld);
      pull.copy(C).sub(A);
      const far0 = pull.length();
      pull.addScaledVector(axis, -pull.dot(axis));
      const taut0 = far0 > y.line - 0.9;
      const load = y.hang ? 0.3 : y.reel ? 1.0 : y.air ? 0.35 : taut0 ? 0.85 : 0.14;   // metres the tip gives
      if (pull.lengthSq() > 1e-6) pull.setLength(load); else pull.set(0, 0, 0);
      const kick = t - kickAt;
      if (kick >= 0 && kick < 0.12) pull.addScaledVector(side.copy(axis).cross(WORLD_UP).cross(axis).normalize(), 1.3);   // the flick: the tip lags behind the whip
      const steps = Math.max(1, Math.round(dt / (1 / 120)));
      for (let i = 0; i < steps; i++) {
        const h = dt / steps;
        bendV.addScaledVector(want.copy(pull).sub(bend), 170 * h).multiplyScalar(Math.exp(-9 * h));
        bend.addScaledVector(bendV, h);
      }
      if (bend.length() > 1.6) bend.setLength(1.6);
      uBend.value.copy(bend).applyQuaternion(q.invert()).multiplyScalar(1 / S);
      A.copy(tipRest).add(uBend.value).applyMatrix4(rod.matrixWorld);
      // her back points up the line when she hangs from it or flies on it; on the floor she sits upright
      want.copy(A).sub(C);
      const far = want.length();
      want.normalize();
      const taut = far > y.line - 1.4;
      const w = y.hang ? 1 : (y.air || y.held) ? (taut ? 0.8 : 0.3) : 0.1;
      want.multiplyScalar(w).addScaledVector(WORLD_UP, 1 - w).normalize();
      up.lerp(want, 1 - Math.exp(-dt * 12)).normalize();
      const swim = y.hang ? (y.dangle ? 0.6 : 0.25) : Math.min(1, 0.12 + speed / 6);   // how hard she swims
      const wig = y.hang ? 0 : 0.22 * Math.sin(t * 15) * Math.min(1, speed / 6);       // she wriggles as she goes
      bz.set(Math.sin(yaw + wig), 0, Math.cos(yaw + wig));
      bz.addScaledVector(up, -bz.dot(up)).normalize();
      bx.crossVectors(up, bz);
      fish.quaternion.setFromRotationMatrix(basis.makeBasis(bx, up, bz));
      fish.position.copy(C);
      // squash and stretch: she squashes flat as she lands or is batted, and springs back
      const sq = t - squashAt, s = sq >= 0 && sq < 0.7 ? squashBy * Math.exp(-sq * 8) * Math.cos(sq * 24) : 0;
      fish.scale.set(SF * (1 + s * 0.6), SF * (1 - s), SF * (1 + s * 0.6));
      // her tail wags, the sail on her back sways, her side fins flap
      const beat = t * (5 + 9 * swim);
      tail.rotation.y = (0.22 + 0.5 * swim) * Math.sin(beat);
      dorsal.rotation.z = 0.16 * (0.4 + swim) * Math.sin(beat * 0.5 + 1);
      const flap = (0.22 + 0.4 * swim) * Math.sin(beat * 1.3 + 0.6);
      finP.rotation.z = 0.12 + flap;
      finN.rotation.z = -0.12 - flap;
      fish.updateWorldMatrix(false, true);
      loopNode.getWorldPosition(B);
      // the line: straight when it is taut, hanging in a curve when there is slack
      const d = A.distanceTo(B), slack = Math.max(0, y.line - 0.75 - d);
      const sag = y.hang ? 0 : Math.min(5, 0.42 * Math.sqrt(slack * (slack + 2 * d)));
      for (let i = 0; i <= SEG; i++) {
        const u = i / SEG;
        curve(u, sag, P);
        curve(Math.min(1, u + 0.02), sag, Q);
        tan.copy(Q);
        curve(Math.max(0, u - 0.02), sag, Q);
        tan.sub(Q).normalize();
        side.crossVectors(tan, WORLD_UP);
        if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
        side.normalize();
        nrm.crossVectors(side, tan);
        for (let k = 0; k < SIDES; k++) {
          const a = (k / SIDES) * Math.PI * 2, ca = Math.cos(a) * LINE_R, sa = Math.sin(a) * LINE_R, j = (i * SIDES + k) * 3;
          pos[j] = P.x + side.x * ca + nrm.x * sa;
          pos[j + 1] = P.y + side.y * ca + nrm.y * sa;
          pos[j + 2] = P.z + side.z * ca + nrm.z * sa;
        }
      }
      geo.attributes.position.needsUpdate = true;
      geo.computeVertexNormals();
      drawFX(t, y);
    },
    /** true while an effect is playing (the page then renders every frame) */
    busy() { return bursts.length > 0 || puffs.length > 0 || !!mark || trail.length > 0; },
    /** the middle of the fish in the world (for sounds and pictures) */
    fishPosition(out = new THREE.Vector3()) { return out.copy(fish.position); },
  };
}
