// Day 2: the kitty in the world (idea by @lifediamond888). Loads models/kitty.glb and models/toys.glb
// (both built in Blender: art/day02), plays her clips as kittybrain.js decides, turns her head toward
// the camera, and draws everything around her: the food bowl emptying as she eats, the rolling yarn,
// hearts when she is happy, Zzz while she naps, a paw print where she was called.
//
// Two ways to run it:
//   advance(dt)     live play: real time, stepped in fixed STEPs
//   simulateTo(t)   recordings: the kitty at exactly t seconds (re-simulated from 0 when t goes back)
// then finish(viewer, steps) once the camera is placed (head turn + effects).
import * as THREE from '../vendor/three/three.module.js';
import { GLTFLoader } from '../vendor/three/addons/loaders/GLTFLoader.js';
import { createBrain, KITTY, STEP, YARN } from './kittybrain.js';

const FADE = 0.28;                 // seconds of crossfade between clips (a clip may ask for its own)
const LIFT = 0.0008;               // the paw pads' depth below the toe joints at real size (m)
const LOOK = { idle: 1, sit: 1, face: 0.8, sitdown: 0.45, meow: 0.35, purr: 0.2, standup: 0.3, groom: 0.1,
  trot: 0.35, walk: 0.25, pounce: 0.6, bat: 0.5, stretch: 0 };

function blobTexture() {                       // a soft round contact shadow
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  r.addColorStop(0, 'rgba(38,32,28,0.9)');
  r.addColorStop(0.55, 'rgba(38,32,28,0.45)');
  r.addColorStop(1, 'rgba(38,32,28,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// footfalls within each gait clip (fraction of the loop): walk = one paw at a time, trot = diagonal pairs
const FOOTFALLS = { Walk: [0, 0.25, 0.5, 0.75], Trot: [0, 0.5] };

function spriteTexture(draw, size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const heartTexture = () => spriteTexture((g) => {
  g.translate(64, 68);
  const heart = () => {
    g.beginPath();
    g.moveTo(0, 38);
    g.bezierCurveTo(-58, 2, -46, -48, 0, -22);
    g.bezierCurveTo(46, -48, 58, 2, 0, 38);
    g.closePath();
  };
  g.lineJoin = 'round';
  heart(); g.lineWidth = 12; g.strokeStyle = '#fff8ec'; g.stroke();
  heart(); g.fillStyle = '#f06b78'; g.fill();
  g.lineWidth = 5; g.strokeStyle = '#2f2620'; g.stroke();
  g.beginPath(); g.ellipse(-20, -14, 9, 6, -0.6, 0, Math.PI * 2); g.fillStyle = 'rgba(255,255,255,0.7)'; g.fill();
});

const zTexture = () => spriteTexture((g, s) => {
  g.font = `700 ${s * 0.78}px Fredoka, 'Rubik', sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = 14; g.strokeStyle = '#2f2620'; g.strokeText('z', s / 2, s / 2 + 4);
  g.fillStyle = '#fff8ec'; g.fillText('z', s / 2, s / 2 + 4);
});

const pawTexture = () => spriteTexture((g) => {
  const blob = (x, y, rx, ry, rot) => { g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); };
  const shapes = [[128, 160, 52, 44, 0], [64, 96, 21, 27, -0.35], [104, 66, 22, 29, -0.12], [152, 66, 22, 29, 0.12], [192, 96, 21, 27, 0.35]];
  for (const pass of [0, 1]) {
    for (const s of shapes) {
      blob(...s);
      if (pass === 0) { g.lineWidth = 16; g.strokeStyle = 'rgba(47,38,32,0.9)'; g.stroke(); }
      else { g.fillStyle = '#fff8ec'; g.fill(); }
    }
  }
}, 256);

const easeOutBack = (k) => { const x = Math.min(1, Math.max(0, k)) - 1; return 1 + 2.7 * x ** 3 + 1.7 * x ** 2; };

/**
 * Fur: `layers` thin shells of her body, each pushed out along the (skinned) normal and drawing only
 * the strands that reach that height. Strands are cells on a UV grid with their own length and lean;
 * they taper to the tip, are darker at the root and a touch lighter at the tip, and lean back and down
 * with gravity. kitty_fur.png says how long the fur is everywhere (none on the nose, round the eyes,
 * inside the ears or under the paws). Shells use a plain standard material and cast no shadows.
 */
function addFur(body, furMap, layers) {
  const base = body.material;
  const shells = [];
  for (let i = 1; i <= layers; i++) {
    const h = i / layers;
    const m = new THREE.MeshStandardMaterial({
      map: base.map, normalMap: base.normalMap, normalScale: base.normalScale, roughness: 1,
      roughnessMap: base.roughnessMap, alphaTest: 0.5, alphaToCoverage: true,
    });
    const uni = { uFurH: { value: h }, uFurLen: { value: 0.0072 }, uFurMap: { value: furMap }, uDensity: { value: 240 } };
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uni);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
uniform float uFurH; uniform float uFurLen; uniform sampler2D uFurMap; varying float vFurL;`)
        .replace('#include <skinning_vertex>', `#include <skinning_vertex>
{
  float L = texture2D(uFurMap, uv).r * 1.5;
  vFurL = L;
  float d = uFurLen * L * uFurH;
  vec3 n = normalize(objectNormal);
  // combed back and down a little more toward the tips (model space: +Z is her front, +Y up)
  vec3 comb = normalize(vec3(0.0, -0.55, -1.0));
  transformed += n * d + comb * d * uFurH * 0.55;
}`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
uniform float uFurH; uniform float uDensity; varying float vFurL;
float furHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
        .replace('#include <map_fragment>', `#include <map_fragment>
{
  vec2 g = vMapUv * uDensity;
  vec2 c = floor(g);
  vec2 f = fract(g) - 0.5;
  vec2 off = (vec2(furHash(c), furHash(c + 17.3)) - 0.5) * 0.45;
  float len = 0.45 + 0.55 * furHash(c + 5.1);           // every strand its own length
  float rad = 0.5 * (1.0 - uFurH / max(len, 0.01));      // tapering to a point
  float dist = length(f - off);
  float a = (uFurH > len || vFurL < 0.03) ? 0.0 : smoothstep(rad, rad * 0.4, dist);
  // fur reads at the outline: full strength where the surface turns away, faint where it faces you
  float facing = abs(dot(normalize(vNormal), normalize(vViewPosition)));
  a *= mix(1.0, 0.22, smoothstep(0.15, 0.85, facing));
  diffuseColor.a *= a;
  diffuseColor.rgb *= mix(0.74, 0.97, uFurH);            // shade at the roots, never brighter than the coat
}`);
    };
    m.customProgramCacheKey = () => 'kitty-fur';
    const shell = new THREE.SkinnedMesh(body.geometry, m);
    shell.name = `Fur${i}`;
    shell.bind(body.skeleton, body.bindMatrix);
    shell.position.copy(body.position); shell.quaternion.copy(body.quaternion); shell.scale.copy(body.scale);
    shell.castShadow = false;
    shell.receiveShadow = true;
    shell.frustumCulled = false;
    shell.renderOrder = i;
    body.parent.add(shell);
    shells.push(shell);
  }
  return shells;
}

/**
 * @param {{scene:THREE.Scene, url:string, toysUrl:string, start?:object, seed?:number,
 *          script?:{t:number,type:string,x?:number,z?:number}[], viewer?:number[], renderer?:THREE.WebGLRenderer,
 *          needs?:{hunger:number, happy:number}}} o
 */
export async function createKitty(o) {
  const loader = new GLTFLoader();
  const [gltf, toys, furMap] = await Promise.all([
    loader.loadAsync(o.url), loader.loadAsync(o.toysUrl),
    o.furUrl ? new THREE.TextureLoader().loadAsync(o.furUrl).catch(() => null) : Promise.resolve(null),
  ]);
  const S = KITTY.scale;
  const aniso = Math.min(8, o.renderer?.capabilities.getMaxAnisotropy() ?? 1);
  const shadowy = (obj) => obj.traverse((m) => {
    if (!m.isMesh) return;
    m.castShadow = true; m.receiveShadow = true;
    for (const mat of [].concat(m.material)) if (mat.map) mat.map.anisotropy = aniso;
  });

  const root = new THREE.Group();
  root.name = 'Kitty';
  const model = gltf.scene;
  model.scale.setScalar(S);
  model.position.y = LIFT * S;
  root.add(model);
  shadowy(model);
  let body = null;
  model.traverse((m) => {
    if (!m.isMesh) return;
    m.frustumCulled = false;                     // skinned: the bind-pose bounds do not follow her
    if (m.name === 'Whiskers') m.castShadow = false;
    if (m.isSkinnedMesh && m.material?.name === 'M_Kitty') body = m;
  });
  if (body && furMap && (o.furLayers ?? 10) > 0) {
    furMap.flipY = false;                        // same UV convention as the glTF's own textures
    furMap.colorSpace = THREE.NoColorSpace;
    addFur(body, furMap, o.furLayers ?? 10);
  }
  o.scene.add(root);

  // her things
  const bowl = new THREE.Group();
  bowl.name = 'BowlSet';
  const kibble = [];
  for (const n of ['Bowl', 'Kibble_1', 'Kibble_2', 'Kibble_3']) {
    const m = toys.scene.getObjectByName(n);
    if (!m) throw new Error(`toys.glb has no ${n}`);
    bowl.add(m);
    if (n !== 'Bowl') kibble.push(m);
  }
  bowl.scale.setScalar(S);
  bowl.visible = false;
  shadowy(bowl);
  o.scene.add(bowl);
  const yarn = toys.scene.getObjectByName('Yarn');
  if (!yarn) throw new Error('toys.glb has no Yarn');
  yarn.position.set(0, 0, 0);
  const yarnRoot = new THREE.Group();
  yarnRoot.name = 'YarnBall';
  yarnRoot.add(yarn);
  yarnRoot.scale.setScalar(S * YARN.scale);
  yarnRoot.visible = false;
  shadowy(yarnRoot);
  o.scene.add(yarnRoot);

  const bone = (n) => model.getObjectByName(n);
  const B = { head: bone('head'), neck: bone('neck'), spine: bone('spine'), chest: bone('chest'),
    ears: [bone('ear_L'), bone('ear_R')], paws: ['frontpaw_L', 'frontpaw_R', 'hindpaw_L', 'hindpaw_R'].map(bone) };
  const clips = Object.fromEntries(gltf.animations.map((c) => [c.name, c]));
  for (const need of ['Idle', 'Walk', 'Trot', 'Sit', 'SitIdle', 'Purr', 'Meow', 'Eat', 'Groom', 'Stretch', 'Sleep', 'Pounce', 'Bat']) {
    if (!clips[need]) throw new Error(`kitty.glb has no ${need} clip`);
  }

  // ---------------------------------------------------------------- effects
  const fx = new THREE.Group();
  fx.name = 'KittyFX';
  o.scene.add(fx);
  const pool = (tex, k) => Array.from({ length: k }, () => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
    s.visible = false;
    fx.add(s);
    return s;
  });
  const hearts = pool(heartTexture(), 12);
  // contact shadows: one soft blob under her body, one under each paw (they fade as a paw lifts)
  const blobTex = blobTexture();
  const blob = (w, d, o) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({
      map: blobTex, transparent: true, opacity: o, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, fog: true }));
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = 1;
    fx.add(m);
    return m;
  };
  const bodyBlob = blob(1, 1, 0.42);
  const pawBlobs = B.paws.map(() => blob(0.05 * KITTY.scale, 0.06 * KITTY.scale, 0.5));
  const zees = pool(zTexture(), 4);
  const paw = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 4.2), new THREE.MeshBasicMaterial({
    map: pawTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
  }));
  paw.rotation.x = -Math.PI / 2;
  paw.position.y = 0.05;
  paw.visible = false;
  paw.renderOrder = 2;
  fx.add(paw);

  // ---------------------------------------------------------------- state
  let brain, mixer, actions, cur, curKey, heartLog, callLog, bowlLog, scriptAt, look, lastSpin;
  const listeners = [];
  const startOpts = { seed: o.seed ?? 2, ...o.start, viewer: o.viewer, ...(o.needs || {}) };
  const yq = new THREE.Quaternion(), dq = new THREE.Quaternion(), axis = new THREE.Vector3();

  function reset() {
    brain = createBrain(startOpts);
    mixer?.stopAllAction();
    mixer = new THREE.AnimationMixer(model);
    actions = Object.fromEntries(Object.entries(clips).map(([n, c]) => [n, mixer.clipAction(c)]));
    cur = null; curKey = '';
    heartLog = []; callLog = null; bowlLog = null; scriptAt = 0; lastSpin = 0;
    look = { yaw: 0, pitch: 0, w: 0 };
    yq.identity();
    play(brain.anim(), true);
    mixer.update(0);
    place();
  }

  function play(a, instant = false) {
    const key = `${a.name}${a.rate < 0 ? '<' : '>'}`;
    const act = actions[a.name];
    if (key === curKey) { if (!a.once) act.timeScale = a.rate; return; }
    if (cur === act) {                           // the same clip changing direction (sitting down -> standing up)
      act.paused = false;
      act.timeScale = a.rate;
      act.setLoop(a.once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
      curKey = key;
      return;
    }
    act.reset();
    act.setLoop(a.once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    act.clampWhenFinished = true;
    act.timeScale = a.rate;
    act.setEffectiveWeight(1);
    if (a.rate < 0) act.time = act.getClip().duration;
    act.play();
    if (cur && !instant) act.crossFadeFrom(cur, a.fade ?? FADE, false);
    else if (cur) cur.stop();
    cur = act; curKey = key;
  }

  function place() {
    root.position.set(brain.x, 0, brain.z);
    root.rotation.y = brain.heading;
  }

  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion();
  const emitOut = (e) => { for (const fn of listeners) fn(e); };

  function addHearts(t, n = 3) {
    root.updateMatrixWorld(true);
    B.head.getWorldPosition(v1);
    for (let k = 0; k < n; k++) heartLog.push({ t: t + k * 0.22, x: v1.x, y: v1.y + 1.2, z: v1.z, k: heartLog.length });
  }

  function onEvent(e) {
    if (e.type === 'pet' || e.type === 'eaten') addHearts(e.t);
    if (e.type === 'swat' && e.round >= 3) addHearts(e.t, 2);
    if (e.type === 'call') callLog = { t: e.t, x: e.x, z: e.z, end: Infinity };
    if (e.type === 'arrive' && callLog && callLog.end === Infinity) callLog.end = e.t + 0.6;
    if (e.type === 'bowl') bowlLog = { t: e.t, x: e.x, z: e.z, gone: Infinity };
    if (e.type === 'bowl-gone' && bowlLog) bowlLog.gone = e.t;
    emitOut(e);
  }

  function footsteps(prevT) {                    // paw contacts inside the gait clips -> 'step' events
    const name = cur?.getClip().name;
    const marks = FOOTFALLS[name];
    if (!marks || cur.getEffectiveWeight() < 0.5) return;
    const d = cur.getClip().duration;
    const a = (prevT % d) / d, b2 = (cur.time % d) / d;
    for (const m of marks) {
      const hit = a <= b2 ? (m > a && m <= b2) : (m > a || m <= b2);
      if (hit) emitOut({ t: brain.t, type: 'step', strong: name === 'Trot' });
    }
  }

  function tick() {                              // one fixed step of brain + animation
    if (o.script) {
      while (scriptAt < o.script.length && o.script[scriptAt].t <= brain.t + 1e-6) {
        const s = o.script[scriptAt++];
        if (s.type === 'call') brain.call(s.x, s.z);
        else if (s.type === 'pet') brain.pet();
        else if (s.type === 'meow') brain.meow();
        else if (s.type === 'walk') brain.walkTo(s.x, s.z);
        else if (s.type === 'feed') brain.feed();
        else if (s.type === 'play') brain.play();
        else if (s.type === 'nap') brain.nap();
      }
    }
    brain.step(STEP);
    play(brain.anim());
    const prevT = cur.time;
    mixer.update(STEP);
    footsteps(prevT);
    place();
    // the yarn rolls: turn it by the distance it travelled, about the axis across its path
    const y = brain.yarn;
    if (y) {
      const d = y.spin - lastSpin;
      lastSpin = y.spin;
      if (d) { axis.set(y.ax, 0, y.az).normalize(); dq.setFromAxisAngle(axis, d); yq.premultiply(dq); }
    }
    for (const e of brain.drain()) onEvent(e);
  }

  // head and neck turn toward what she is interested in: the bowl or the yarn when she is after them,
  // otherwise the camera (after the clip has posed the skeleton)
  const tgt = new THREE.Vector3();
  function lookTarget(viewer) {
    const y = brain.yarn, bw = brain.bowl;
    const chasing = y && (brain.goal === 'yarn' || ['pounce', 'bat'].includes(brain.mode) || brain.face?.then === 'pounce');
    if (chasing) return tgt.set(y.x, y.y, y.z);
    if (bw && bw.eatenAt == null && (brain.goal === 'eat' || brain.face?.then === 'eat')) return tgt.set(bw.x, 0.6, bw.z);
    if (['walk', 'trot'].includes(brain.mode)) return null;     // walking: eyes ahead
    return viewer;
  }
  function lookAt(viewer, dt) {
    const target = lookTarget(viewer);
    const wantW = target ? (LOOK[brain.mode] ?? 0) : 0;
    look.w += (wantW - look.w) * (1 - Math.exp(-dt * 3));
    if (look.w < 0.01) return;
    const t = target || viewer;
    if (!t) return;
    root.updateMatrixWorld(true);
    B.head.getWorldPosition(v1);
    let yaw = Math.atan2(t.x - v1.x, t.z - v1.z) - brain.heading;
    yaw = ((yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    const pitch = Math.atan2(t.y - v1.y, Math.hypot(t.x - v1.x, t.z - v1.z));
    const ty = Math.max(-0.95, Math.min(0.95, yaw)) * (Math.abs(yaw) > 2.4 ? 0 : 1);
    const tp = Math.max(-0.45, Math.min(0.45, pitch * 0.8));
    const k = 1 - Math.exp(-dt * 5);
    look.yaw += (ty - look.yaw) * k;
    look.pitch += (tp - look.pitch) * k;
    const up = v2.set(0, 1, 0);
    const right = new THREE.Vector3(Math.cos(brain.heading), 0, -Math.sin(brain.heading));
    const turn = (b, yawAmt, pitchAmt) => {
      q1.setFromAxisAngle(up, yawAmt * look.w).multiply(q2.setFromAxisAngle(right, -pitchAmt * look.w));
      b.parent.getWorldQuaternion(q2);
      const d = q2.clone().invert().multiply(q1).multiply(q2);
      b.quaternion.premultiply(d);
      b.updateMatrixWorld(true);
    };
    turn(B.neck, look.yaw * 0.4, look.pitch * 0.35);
    turn(B.head, look.yaw * 0.6, look.pitch * 0.65);
  }

  // every few seconds one ear flicks (timing from her own clock, so recordings stay identical)
  function earFlicks() {
    const t = brain.t;
    if (brain.mode === 'sleep' && t % 7 > 0.4) return;
    const slot = Math.floor(t / 3.1);
    const h = Math.sin(slot * 91.7) * 43758.5453;
    const r = h - Math.floor(h);
    const start = slot * 3.1 + r * 1.6, a = t - start;
    if (a < 0 || a > 0.28) return;
    const ear = B.ears[r < 0.5 ? 0 : 1];
    if (!ear) return;
    const amt = Math.sin((a / 0.28) * Math.PI) * 0.45;
    ear.getWorldQuaternion(q2);
    const axis = v2.set(r < 0.5 ? -1 : 1, 0.2, 0).normalize();
    q1.setFromAxisAngle(axis, amt);
    ear.quaternion.multiply(q1);
    ear.updateMatrixWorld(true);
  }

  function drawFX() {
    const now = brain.t;
    root.updateMatrixWorld(true);
    const S2 = KITTY.scale;
    const lowBody = ['sit', 'sitdown', 'purr', 'meow', 'groom', 'liedown', 'sleep'].includes(brain.mode);
    bodyBlob.position.set(brain.x, 0.04, brain.z);
    bodyBlob.rotation.z = brain.heading;
    bodyBlob.scale.set(lowBody ? 0.26 * S2 : 0.2 * S2, lowBody ? 0.36 * S2 : 0.52 * S2, 1);
    B.paws.forEach((b, k) => {
      const pb = pawBlobs[k];
      if (!b) { pb.visible = false; return; }
      b.getWorldPosition(v1);
      const h = Math.max(0, v1.y - 0.03 * S2);
      pb.position.set(v1.x, 0.045, v1.z);
      pb.material.opacity = 0.5 * Math.max(0, 1 - h / (0.05 * S2));
      pb.visible = pb.material.opacity > 0.02;
    });
    // hearts
    let i = 0;
    for (const h of heartLog) {
      const a = now - h.t;
      if (a < 0 || a > 1.7 || i >= hearts.length) continue;
      const s = hearts[i++];
      const side = ((h.k * 7) % 5 - 2) * 0.55;
      s.visible = true;
      s.position.set(h.x + side + Math.sin(a * 5 + h.k) * 0.25, h.y + a * 3.2, h.z);
      const pop = Math.min(1, a / 0.18);
      s.scale.setScalar((0.6 + 0.9 * pop - 0.15 * Math.max(0, a - 1.1)) * 1.5);
      s.material.opacity = Math.min(1, 1.6 - a);
    }
    for (; i < hearts.length; i++) hearts[i].visible = false;
    heartLog = heartLog.filter((h) => now - h.t < 2);
    // Zzz: one every 1.1 s while she sleeps, drifting up and away from her head
    const asleep = brain.mode === 'sleep';
    root.updateMatrixWorld(true);
    B.head.getWorldPosition(v1);
    zees.forEach((z, k) => {
      const a = ((now + k * 1.1) % 4.4) / 4.4;
      z.visible = asleep;
      if (!asleep) return;
      z.position.set(v1.x + 2.2 + a * 3.0 + Math.sin(a * 9 + k) * 0.4, v1.y + 0.8 + a * 4.2, v1.z);
      z.scale.setScalar(1.1 + a * 1.6);
      z.material.opacity = Math.min(1, a * 6) * (1 - a);
    });
    // the paw print where she was called
    if (callLog && now - callLog.t < 8) {
      const a = now - callLog.t, out = now - callLog.end;
      paw.visible = out < 0.6;
      paw.position.set(callLog.x, 0.05, callLog.z);
      paw.scale.setScalar(Math.max(0.01, easeOutBack(a / 0.3)));
      paw.material.opacity = 0.92 * (out > 0 ? Math.max(0, 1 - out / 0.6) : 1);
      paw.rotation.z = -Math.atan2(callLog.x - brain.x, callLog.z - brain.z) + Math.PI;
    } else paw.visible = false;
    // the bowl: pops in, empties as she eats, pops out
    if (bowlLog) {
      const a = now - bowlLog.t, out = now - bowlLog.gone;
      bowl.visible = out < 0.45;
      bowl.position.set(bowlLog.x, 0, bowlLog.z);
      const s = out > 0 ? 1 - out / 0.45 : easeOutBack(a / 0.35);
      bowl.scale.setScalar(S * Math.max(0.001, s));
      bowl.rotation.y = Math.atan2(bowlLog.x, bowlLog.z) * 0.5;
      const left = brain.bowl ? brain.bowl.left : 0;
      kibble.forEach((k, n) => { k.visible = n < left; });
      if (out > 1) bowlLog = null;
    } else bowl.visible = false;
    // the yarn
    const y = brain.yarn;
    yarnRoot.visible = !!y;
    if (y) {
      yarnRoot.position.set(y.x, y.y, y.z);
      yarnRoot.quaternion.copy(yq);
    }
  }

  reset();
  let acc = 0;
  return {
    root, model,
    get brain() { return brain; },
    get t() { return brain.t; },
    /** live play: advance by real time; returns the number of fixed steps taken */
    advance(dt, viewer) {
      if (viewer) brain.viewer = [viewer.x, viewer.z];
      acc = Math.min(acc + dt, 0.25);
      let n = 0;
      while (acc >= STEP) { tick(); acc -= STEP; n++; }
      return n;
    },
    /** recordings: the kitty at exactly t seconds; returns the number of fixed steps taken */
    simulateTo(t) {
      if (t < brain.t - STEP * 0.5) reset();
      let n = 0;
      while (brain.t < t - STEP * 0.5) { tick(); n++; }
      return n;
    },
    /** after advance / simulateTo and once the camera is placed: head turn toward it, effects */
    finish(viewer, steps) {
      if (steps) { lookAt(viewer, steps * STEP); earFlicks(); }
      drawFX();
    },
    call(x, z) { brain.call(x, z); },
    pet() { brain.pet(); },
    feed() { brain.feed(); },
    play() { brain.play(); },
    on(fn) { listeners.push(fn); },
    /** what a ray hits: 'kitty' (two generous spheres: body and head), 'yarn', or null */
    pick(ray) {
      root.updateMatrixWorld(true);
      for (const [b, rad] of [[B.chest, 0.15 * S], [B.spine, 0.15 * S], [B.head, 0.11 * S]]) {
        b.getWorldPosition(v1);
        if (ray.distanceSqToPoint(v1) < rad * rad) return 'kitty';
      }
      if (brain.yarn && ray.distanceSqToPoint(yarnRoot.position) < (YARN.radius * 1.5) ** 2) return 'yarn';
      return null;
    },
    headPosition(out = new THREE.Vector3()) { root.updateMatrixWorld(true); return B.head.getWorldPosition(out); },
    focus(out = new THREE.Vector3()) { return out.set(brain.x, 0, brain.z); },
    /** where the camera should look: at her, or between her and the bowl / yarn she is busy with */
    interest(out = new THREE.Vector3()) {
      out.set(brain.x, 0, brain.z);
      const y = brain.yarn, bw = brain.bowl;
      if (bw && bw.eatenAt == null) out.lerp(v2.set(bw.x, 0, bw.z), 0.35);
      else if (y && (brain.goal === 'yarn' || ['face', 'pounce', 'bat'].includes(brain.mode) || y.flying > 0)) out.lerp(v2.set(y.x, 0, y.z), 0.4);
      return out;
    },
    /** true while something is moving (the page then renders every frame) */
    busy() { return !['sit', 'idle', 'sleep'].includes(brain.mode) || heartLog.length > 0 || !!brain.yarn?.flying || bowl.visible; },
  };
}
