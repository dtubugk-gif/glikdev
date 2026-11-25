// Day 6: the kitty's friend in the world (idea by @2warp-e8u). Loads models/friend.glb (built in Blender:
// art/day06/build_friend.py), plays its clips as friendbrain.js decides, turns its head toward her face (or
// toward you when you pet it), and draws what goes with it: soft contact shadows, hearts, a Zzz, little dust
// puffs when it lands or pulls up.
//
// It is stepped in lockstep with the kitty (main.js calls stepTo with her clock), so recordings are frame exact.
import * as THREE from '../vendor/three/three.module.js';
import { GLTFLoader } from '../vendor/three/addons/loaders/GLTFLoader.js';
import { createFriendBrain, FRIEND, STEP, setFriendInfo } from './friendbrain.js';

const FADE = 0.26;
const FOOTFALLS = { Walk: [0, 0.25, 0.5, 0.75], Trot: [0, 0.5], Run: [0, 0.44, 0.53, 0.91] };
const LOOK = { idle: 1, sit: 1, face: 0.7, purr: 0.5, sitdown: 0.4, groom: 0.1, eat: 0, walk: 0.2, trot: 0.15, run: 0.1,
  playbow: 0.6, hop: 0.3, boop: 0.3, nuzzle: 0.15 };

function spriteTexture(draw, size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const blobTexture = () => spriteTexture((g) => {
  const r = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  r.addColorStop(0, 'rgba(38,32,28,0.9)'); r.addColorStop(0.55, 'rgba(38,32,28,0.45)'); r.addColorStop(1, 'rgba(38,32,28,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
});
const heartTexture = () => spriteTexture((g) => {
  g.translate(64, 68);
  const heart = () => { g.beginPath(); g.moveTo(0, 38); g.bezierCurveTo(-58, 2, -46, -48, 0, -22); g.bezierCurveTo(46, -48, 58, 2, 0, 38); g.closePath(); };
  g.lineJoin = 'round';
  heart(); g.lineWidth = 12; g.strokeStyle = '#fff8ec'; g.stroke();
  heart(); g.fillStyle = '#f48aa6'; g.fill();
  g.lineWidth = 5; g.strokeStyle = '#2f2620'; g.stroke();
  g.beginPath(); g.ellipse(-20, -14, 9, 6, -0.6, 0, Math.PI * 2); g.fillStyle = 'rgba(255,255,255,0.7)'; g.fill();
});
const zTexture = () => spriteTexture((g, s) => {
  g.font = `700 ${s * 0.7}px Fredoka, 'Rubik', sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  g.lineWidth = 14; g.strokeStyle = '#2f2620'; g.strokeText('z', s / 2, s / 2 + 4);
  g.fillStyle = '#eaf4ff'; g.fillText('z', s / 2, s / 2 + 4);
});
const puffTexture = () => spriteTexture((g) => {
  const r = g.createRadialGradient(64, 64, 6, 64, 64, 60);
  r.addColorStop(0, 'rgba(250,244,234,0.95)'); r.addColorStop(0.6, 'rgba(236,228,214,0.55)'); r.addColorStop(1, 'rgba(236,228,214,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
});

const CLIPS = ['Idle', 'Walk', 'Trot', 'Run', 'Sit', 'SitIdle', 'Purr', 'Eat', 'Groom', 'Stretch', 'Sleep'];

/**
 * @param {{scene:THREE.Scene, url:string, infoUrl?:string, renderer?:THREE.WebGLRenderer, start?:object, seed?:number, hello?:boolean}} o
 */
export async function createFriend(o) {
  const loader = new GLTFLoader();
  const [gltf, info] = await Promise.all([loader.loadAsync(o.url),
    o.infoUrl ? fetch(o.infoUrl).then((r) => (r.ok ? r.json() : null)).catch(() => null) : null]);
  setFriendInfo(info);
  const clips = Object.fromEntries(gltf.animations.map((c) => [c.name, c]));
  for (const need of CLIPS) if (!clips[need]) throw new Error(`friend.glb has no ${need} clip`);
  for (const [k, c] of Object.entries(clips)) FRIEND.clips[k] = c.duration;
  const S = FRIEND.scale;
  const aniso = Math.min(8, o.renderer?.capabilities.getMaxAnisotropy() ?? 1);

  const root = new THREE.Group();
  root.name = 'Friend';
  const model = gltf.scene;
  model.scale.setScalar(S);
  root.add(model);
  model.traverse((m) => {
    if (!m.isMesh) return;
    m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
    if (/whisker/i.test(m.name)) m.castShadow = false;
    for (const mat of [].concat(m.material)) { if (mat.map) mat.map.anisotropy = aniso; }
  });
  o.scene.add(root);
  const bone = (n) => model.getObjectByName(n);
  const B = { head: bone('head'), neck: bone('neck'), chest: bone('chest'), spine: bone('spine'), ears: [bone('ear_L'), bone('ear_R')],
    paws: ['frontpaw_L', 'frontpaw_R', 'hindpaw_L', 'hindpaw_R'].map(bone) };
  if (!B.head || !B.neck) throw new Error('friend.glb has no head or neck bone');

  // ---------------------------------------------------------------- effects
  const fx = new THREE.Group();
  fx.name = 'FriendFX';
  o.scene.add(fx);
  const pool = (tex, k) => Array.from({ length: k }, () => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
    s.visible = false; fx.add(s); return s;
  });
  const hearts = pool(heartTexture(), 8), zees = pool(zTexture(), 4), puffs = pool(puffTexture(), 10);
  const blobTex = blobTexture();
  const blob = (w, d, op) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({
      map: blobTex, transparent: true, opacity: op, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
    m.rotation.x = -Math.PI / 2; m.renderOrder = 1; fx.add(m); return m;
  };
  const bodyBlob = blob(1, 1, 0.4);
  const pawBlobs = B.paws.map(() => blob(0.045 * S, 0.055 * S, 0.5));

  // ---------------------------------------------------------------- state
  let brain, mixer, actions, cur, curKey, heartLog, puffLog, look;
  const listeners = [];
  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion();
  const startOpts = { seed: o.seed ?? 11, ...(o.start || {}), hello: !!o.hello, helloDelay: o.helloDelay ?? 0, scripted: !!o.script };
  const emitOut = (e) => { for (const fn of listeners) fn(e); };

  function play(a, instant = false) {
    const name = actions[a.name] ? a.name : 'Idle';
    const key = `${name}${a.rate < 0 ? '<' : '>'}`;
    const act = actions[name];
    if (key === curKey) { if (!a.once) act.timeScale = a.rate; return; }
    if (cur === act) {
      act.paused = false; act.timeScale = a.rate;
      act.setLoop(a.once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
      curKey = key; return;
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
  function place() { root.position.set(brain.x, 0, brain.z); root.rotation.y = brain.heading; }
  function reset() {
    brain = createFriendBrain(startOpts);
    if (mixer) { mixer.stopAllAction(); mixer.uncacheRoot(model); }
    mixer = new THREE.AnimationMixer(model);
    actions = Object.fromEntries(Object.entries(clips).map(([n, c]) => [n, mixer.clipAction(c)]));
    cur = null; curKey = '';
    heartLog = []; puffLog = []; scriptAt = 0;
    look = { yaw: 0, pitch: 0, w: 0 };
    play(brain.anim(), true);
    mixer.update(0);
    place();
  }
  function footsteps(prevT) {
    const name = cur?.getClip().name, marks = FOOTFALLS[name];
    if (!marks || cur.getEffectiveWeight() < 0.5) return;
    const d = cur.getClip().duration, a = (prevT % d) / d, b = (cur.time % d) / d;
    for (const m of marks) if (a <= b ? (m > a && m <= b) : (m > a || m <= b)) emitOut({ t: brain.t, type: 'step', who: 'friend', strong: name !== 'Walk' });
  }
  function onEvent(e) {
    if (e.type === 'pet' || e.type === 'friend-hello') addHearts(e.t, e.type === 'friend-hello' ? 4 : 3);
    if (e.type === 'nuzzle') addHearts(e.t + 0.9, 2);
    if (e.type === 'boop') addHearts(e.t + 0.5, 1);
    if (e.type === 'land') puff(e.t + (e.delay || 0), 4, 0.9);
    if (e.type === 'tumble') puff(e.t + (e.delay || 0), 3, 1.1);
    if (e.type === 'arrive' && brain.mode === 'face') puff(e.t, 2, 0.6);
    emitOut(e);
  }
  function addHearts(t, n) {
    root.updateMatrixWorld(true);
    B.head.getWorldPosition(v1);
    for (let k = 0; k < n; k++) heartLog.push({ t: t + k * 0.24, x: v1.x, y: v1.y + 0.9, z: v1.z, k: heartLog.length });
  }
  function puff(t, n, size) {
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + brain.heading;
      puffLog.push({ t, x: brain.x + Math.sin(a) * 0.8, z: brain.z + Math.cos(a) * 0.8, vx: Math.sin(a), vz: Math.cos(a), size });
    }
  }
  let scriptAt = 0;
  function tick(world) {
    while (o.script && scriptAt < o.script.length && o.script[scriptAt].t <= brain.t + 1e-6) { const s = o.script[scriptAt++]; brain.doNow(s.type, world, s); }
    brain.step(STEP, world);
    play(brain.anim());
    const prevT = cur.time;
    mixer.update(STEP);
    footsteps(prevT);
    place();
    for (const e of brain.drain()) onEvent(e);
  }

  // the head turns toward her face (or you), after the clip has posed the skeleton
  function lookAt(dt) {
    const p = brain.pal;
    const want = p ? (LOOK[brain.mode] ?? 0) : 0;
    look.w += (want - look.w) * (1 - Math.exp(-dt * 3));
    if (look.w < 0.01 || !p) return;
    root.updateMatrixWorld(true);
    B.head.getWorldPosition(v1);
    let yaw = Math.atan2(p.x - v1.x, p.z - v1.z) - brain.heading;
    yaw = ((yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    const pitch = Math.atan2(p.y - v1.y, Math.hypot(p.x - v1.x, p.z - v1.z));
    const ty = Math.max(-0.9, Math.min(0.9, yaw)) * (Math.abs(yaw) > 2.3 ? 0 : 1);
    const tp = Math.max(-0.4, Math.min(0.55, pitch * 0.85));
    const k = 1 - Math.exp(-dt * 5);
    look.yaw += (ty - look.yaw) * k; look.pitch += (tp - look.pitch) * k;
    const up = v2.set(0, 1, 0);
    const right = new THREE.Vector3(Math.cos(brain.heading), 0, -Math.sin(brain.heading));
    const turn = (b, ya, pa) => {
      q1.setFromAxisAngle(up, ya * look.w).multiply(q2.setFromAxisAngle(right, -pa * look.w));
      b.parent.getWorldQuaternion(q2);
      b.quaternion.premultiply(q2.clone().invert().multiply(q1).multiply(q2));
      b.updateMatrixWorld(true);
    };
    turn(B.neck, look.yaw * 0.4, look.pitch * 0.35);
    turn(B.head, look.yaw * 0.6, look.pitch * 0.65);
  }
  function earFlicks() {
    const t = brain.t;
    if (brain.mode === 'sleep' && t % 6 > 0.4) return;
    const slot = Math.floor(t / 2.7), h = Math.sin(slot * 57.3 + 3) * 43758.5453, r = h - Math.floor(h);
    const a = t - (slot * 2.7 + r * 1.4);
    if (a < 0 || a > 0.26) return;
    const ear = B.ears[r < 0.5 ? 0 : 1];
    if (!ear) return;
    q1.setFromAxisAngle(v2.set(r < 0.5 ? -1 : 1, 0.2, 0).normalize(), Math.sin((a / 0.26) * Math.PI) * 0.5);
    ear.quaternion.multiply(q1);
    ear.updateMatrixWorld(true);
  }
  function drawFX() {
    const now = brain.t;
    root.updateMatrixWorld(true);
    const low = ['sit', 'sitdown', 'purr', 'groom', 'liedown', 'sleep', 'tumble'].includes(brain.mode);
    bodyBlob.position.set(brain.x, 0.04, brain.z);
    bodyBlob.rotation.z = brain.heading;
    bodyBlob.scale.set((low ? 0.22 : 0.17) * S, (low ? 0.3 : 0.42) * S, 1);
    B.paws.forEach((b, k) => {
      const pb = pawBlobs[k];
      if (!b) { pb.visible = false; return; }
      b.getWorldPosition(v1);
      const h = Math.max(0, v1.y - 0.025 * S);
      pb.position.set(v1.x, 0.045, v1.z);
      pb.material.opacity = 0.5 * Math.max(0, 1 - h / (0.045 * S));
      pb.visible = pb.material.opacity > 0.02;
    });
    let i = 0;
    for (const h of heartLog) {
      const a = now - h.t;
      if (a < 0 || a > 1.7 || i >= hearts.length) continue;
      const s = hearts[i++];
      s.visible = true;
      const side = ((h.k * 7) % 5 - 2) * 0.45;
      s.position.set(h.x + side + Math.sin(a * 5 + h.k) * 0.22, h.y + a * 2.8, h.z);
      const pop = Math.min(1, a / 0.18);
      s.scale.setScalar((0.55 + 0.8 * pop - 0.15 * Math.max(0, a - 1.1)) * 1.25);
      s.material.opacity = Math.min(1, 1.6 - a);
    }
    for (; i < hearts.length; i++) hearts[i].visible = false;
    heartLog = heartLog.filter((h) => now - h.t < 2);
    const asleep = brain.mode === 'sleep';
    B.head.getWorldPosition(v1);
    zees.forEach((z, k) => {
      const a = ((now + k * 1.2) % 4.8) / 4.8;
      z.visible = asleep;
      if (!asleep) return;
      z.position.set(v1.x - 1.6 - a * 2.4 + Math.sin(a * 9 + k) * 0.3, v1.y + 0.6 + a * 3.4, v1.z);
      z.scale.setScalar(0.8 + a * 1.2);
      z.material.opacity = Math.min(1, a * 6) * (1 - a);
    });
    i = 0;
    for (const p of puffLog) {
      const a = now - p.t;
      if (a < 0 || a > 0.9 || i >= puffs.length) continue;
      const s = puffs[i++], k = 1 - (1 - a / 0.9) ** 2;
      s.visible = true;
      s.position.set(p.x + p.vx * k * 1.8, 0.35 + k * 0.6, p.z + p.vz * k * 1.8);
      s.scale.setScalar((0.6 + k * 1.3) * p.size);
      s.material.opacity = 0.75 * (1 - a / 0.9);
    }
    for (; i < puffs.length; i++) puffs[i].visible = false;
    puffLog = puffLog.filter((p) => now - p.t < 1);
  }

  reset();
  let acc = 0;
  const pick = new THREE.Vector3();
  return {
    root,
    get brain() { return brain; },
    get t() { return brain.t; },
    on(fn) { listeners.push(fn); },
    reset,
    /** live play: real time, in fixed steps */
    advance(dt, world) {
      acc = Math.min(acc + dt, 0.25);
      let n = 0;
      while (acc >= STEP) { tick(world); acc -= STEP; n++; }
      return n;
    },
    /** in lockstep with the kitty: step until its clock reaches t (back in time: start over) */
    stepTo(t, world) {
      if (t < brain.t - STEP * 0.5) reset();
      let n = 0;
      while (brain.t < t - STEP * 0.5) { tick(world()); n++; }
      return n;
    },
    finish(steps) { if (steps) { lookAt(steps * STEP); earFlicks(); } drawFX(); },
    pet(from) { return brain.pet(from); },
    meet() { brain.meet(); },
    onKitty(e) { brain.onKitty(e); },
    headPosition(out = new THREE.Vector3()) { root.updateMatrixWorld(true); return B.head.getWorldPosition(out); },
    /** does this ray hit it? (two generous spheres: body and head) */
    pick(ray) {
      root.updateMatrixWorld(true);
      for (const [b, r] of [[B.chest || B.spine, 0.13 * S], [B.spine || B.chest, 0.13 * S], [B.head, 0.1 * S]]) {
        if (!b) continue;
        b.getWorldPosition(pick);
        if (ray.distanceSqToPoint(pick) < r * r) return true;
      }
      return false;
    },
    circle() { return { x: brain.x, z: brain.z, r: FRIEND.radius + 0.6 }; },
    busy() { return brain.busy() || heartLog.length > 0 || puffLog.length > 0; },
  };
}
