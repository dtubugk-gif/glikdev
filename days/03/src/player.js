// Day 3: you. A little person who walks about the plate (the owner's idea: "a model that the player will
// be"). models/player.glb was built in Blender (art/day03/build_player.py): clips Idle, Walk, Run, Wave.
//
// Like the kitty she is stepped at a fixed rate, so recordings come out the same every time:
//   advance(dt)      live play
//   simulateTo(t)    recordings: the player at exactly t seconds, following `script`
// goTo(x, z) walks (runs, when it is far) to a spot; steer(dx, dz) is the keyboard: a direction to keep
// walking in. Walls (`boxes`) and round things (`circles`, e.g. the kitty) are walked around, not through.
import * as THREE from '../vendor/three/three.module.js';
import { GLTFLoader } from '../vendor/three/addons/loaders/GLTFLoader.js';

export const PLAYER = {
  scale: 14,                // the same doll's-house scale as the kitty (she is 23.5 cm at cat size: 3.3 m here)
  walk: 3.4, run: 9.0,      // m/s
  runFrom: 7,               // a trip longer than this is run
  radius: 1.3,
  limit: 118,               // the plate is 128 m from the middle to its edge
};
const STEP = 1 / 60;
const CLIPS = ['Idle', 'Walk', 'Run', 'Wave'];
const wrap = (a) => ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;

/** Push the point (x, z) out of a box {x, z, hx, hz, rot} grown by `pad`; returns [x, z]. */
export function outOfBox(x, z, b, pad = 0) {
  const c = Math.cos(b.rot), s = Math.sin(b.rot);
  const dx = x - b.x, dz = z - b.z;
  const lx = c * dx - s * dz, lz = s * dx + c * dz;        // into the box's own frame
  const hx = b.hx + pad, hz = b.hz + pad;
  if (Math.abs(lx) >= hx || Math.abs(lz) >= hz) return [x, z];
  const px = hx - Math.abs(lx), pz = hz - Math.abs(lz);
  let ox = lx, oz = lz;
  if (px < pz) ox = Math.sign(lx || 1) * hx; else oz = Math.sign(lz || 1) * hz;
  return [b.x + c * ox + s * oz, b.z - s * ox + c * oz];
}

/**
 * The walking itself (no three.js): position, heading, speed and which clip shows.
 * @param {{x?:number, z?:number, heading?:number, boxes?:object[], circles?:Function[]}} o
 */
export function createWalker(o = {}) {
  const w = {
    t: 0, x: o.x ?? 0, z: o.z ?? 0, heading: o.heading ?? 0, speed: 0,
    target: null, dir: null, waveUntil: -1, arrived: 0,
    boxes: o.boxes || [], circles: o.circles || [],
  };
  const clampIn = (x, z) => {
    const r = Math.hypot(x, z);
    if (r > PLAYER.limit) { x *= PLAYER.limit / r; z *= PLAYER.limit / r; }
    for (const b of w.boxes) [x, z] = outOfBox(x, z, b, PLAYER.radius);
    return [x, z];
  };
  w.goTo = (x, z) => { const [tx, tz] = clampIn(x, z); w.target = { x: tx, z: tz }; w.dir = null; w.waveUntil = -1; };
  w.steer = (dx, dz) => {
    const d = Math.hypot(dx, dz);
    w.dir = d > 1e-3 ? { x: dx / d, z: dz / d } : null;
    if (w.dir) { w.target = null; w.waveUntil = -1; }
  };
  w.stop = () => { w.target = null; w.dir = null; };
  w.wave = () => { if (!w.target && !w.dir) w.waveUntil = w.t + 2.0; };
  w.faceTo = (x, z) => { w.face = { x, z }; };
  w.step = (dt = STEP) => {
    w.t += dt;
    let want = 0, hx = 0, hz = 0;
    if (w.dir) { hx = w.dir.x; hz = w.dir.z; want = PLAYER.run; }
    else if (w.target) {
      const dx = w.target.x - w.x, dz = w.target.z - w.z, d = Math.hypot(dx, dz);
      if (d < 0.25) { w.target = null; w.arrived = w.t; }
      else {
        hx = dx / d; hz = dz / d;
        const top = d > PLAYER.runFrom || w.speed > PLAYER.walk * 1.4 ? PLAYER.run : PLAYER.walk;
        want = Math.min(top, Math.max(1.2, d * 3.2));       // ease into the spot
      }
    }
    if (want > 0) {
      const diff = wrap(Math.atan2(hx, hz) - w.heading);
      w.heading = wrap(w.heading + Math.max(-9 * dt, Math.min(9 * dt, diff)));
      want *= Math.max(0.25, Math.cos(diff));                // turn first, then go
      w.face = null;
    } else if (w.face) {
      const diff = wrap(Math.atan2(w.face.x - w.x, w.face.z - w.z) - w.heading);
      w.heading = wrap(w.heading + Math.max(-6 * dt, Math.min(6 * dt, diff)));
      if (Math.abs(diff) < 0.02) w.face = null;
    }
    w.speed += (want - w.speed) * (1 - Math.exp(-dt * (want > w.speed ? 7 : 12)));
    if (w.speed < 0.02) w.speed = 0;
    let nx = w.x + Math.sin(w.heading) * w.speed * dt, nz = w.z + Math.cos(w.heading) * w.speed * dt;
    for (const c of w.circles) {                             // round things: slide round them
      const q = c();
      if (!q) continue;
      const dx = nx - q.x, dz = nz - q.z, d = Math.hypot(dx, dz), r = q.r + PLAYER.radius;
      if (d < r && d > 1e-4) { nx = q.x + (dx / d) * r; nz = q.z + (dz / d) * r; }
    }
    const r = Math.hypot(nx, nz);
    if (r > PLAYER.limit) { nx *= PLAYER.limit / r; nz *= PLAYER.limit / r; }
    for (const b of w.boxes) [nx, nz] = outOfBox(nx, nz, b, PLAYER.radius);
    // a wall in the way of a tapped spot: give up after a moment rather than walk on the spot for ever
    if (w.target && Math.hypot(nx - w.x, nz - w.z) < w.speed * dt * 0.2) { w.stuck = (w.stuck || 0) + dt; if (w.stuck > 0.8) { w.target = null; w.stuck = 0; } } else w.stuck = 0;
    w.x = nx; w.z = nz;
  };
  w.moving = () => w.speed > 0.3;
  /** which clip, and how fast it plays */
  w.anim = () => {
    if (w.speed > PLAYER.walk * 1.35) return { name: 'Run', rate: Math.min(1.5, Math.max(0.8, w.speed / 6.6)) };
    if (w.speed > 0.3) return { name: 'Walk', rate: Math.min(1.6, Math.max(0.6, w.speed / 2.9)) };
    if (w.t < w.waveUntil) return { name: 'Wave', rate: 1 };
    return { name: 'Idle', rate: 1 };
  };
  return w;
}

/**
 * @param {{scene:THREE.Scene, url:string, start?:object, boxes?:object[], circles?:Function[],
 *          script?:{t:number, type:string, x?:number, z?:number}[], renderer?:THREE.WebGLRenderer}} o
 */
export async function createPlayer(o) {
  const gltf = await new GLTFLoader().loadAsync(o.url);
  const clips = Object.fromEntries(gltf.animations.map((c) => [c.name, c]));
  for (const n of CLIPS) if (!clips[n]) throw new Error(`player.glb has no ${n} clip`);
  const root = new THREE.Group();
  root.name = 'Player';
  const model = gltf.scene;
  model.scale.setScalar(PLAYER.scale);
  model.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; } });
  root.add(model);
  o.scene.add(root);
  // a soft contact shadow under her feet
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  gr.addColorStop(0, 'rgba(38,32,28,0.85)'); gr.addColorStop(0.6, 'rgba(38,32,28,0.4)'); gr.addColorStop(1, 'rgba(38,32,28,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), new THREE.MeshBasicMaterial({
    map: new THREE.CanvasTexture(c), transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.04;
  blob.renderOrder = 1;
  root.add(blob);

  const startOpts = { ...o.start, boxes: o.boxes, circles: o.circles };
  let walker, mixer, actions, cur, curName, scriptAt, acc = 0;
  function reset() {
    walker = createWalker(startOpts);
    if (mixer) { mixer.stopAllAction(); mixer.uncacheRoot(mixer.getRoot()); }
    mixer = new THREE.AnimationMixer(model);
    actions = Object.fromEntries(CLIPS.map((n) => [n, mixer.clipAction(clips[n])]));
    cur = null; curName = ''; scriptAt = 0;
    show(walker.anim(), true);
    mixer.update(0);
    place();
  }
  function show(a, instant = false) {
    const act = actions[a.name];
    if (a.name === curName) { act.timeScale = a.rate; return; }
    act.reset();
    act.setLoop(THREE.LoopRepeat, Infinity);
    act.timeScale = a.rate;
    act.setEffectiveWeight(1);
    act.play();
    if (cur && !instant) act.crossFadeFrom(cur, 0.18, false); else if (cur) cur.stop();
    cur = act; curName = a.name;
  }
  function place() { root.position.set(walker.x, 0, walker.z); root.rotation.y = walker.heading; }
  function tick() {
    if (o.script) {
      while (scriptAt < o.script.length && o.script[scriptAt].t <= walker.t + 1e-6) {
        const s = o.script[scriptAt++];
        if (s.type === 'go') walker.goTo(s.x, s.z);
        else if (s.type === 'wave') walker.wave();
        else if (s.type === 'face') walker.faceTo(s.x, s.z);
      }
    }
    walker.step(STEP);
    show(walker.anim());
    mixer.update(STEP);
    place();
  }
  reset();
  return {
    root,
    get walker() { return walker; },
    get x() { return walker.x; }, get z() { return walker.z; }, get t() { return walker.t; },
    goTo(x, z) { walker.goTo(x, z); },
    steer(dx, dz) { walker.steer(dx, dz); },
    stop() { walker.stop(); },
    wave() { walker.wave(); },
    faceTo(x, z) { walker.faceTo(x, z); },
    advance(dt) {
      acc = Math.min(acc + dt, 0.25);
      let n = 0;
      while (acc >= STEP) { tick(); acc -= STEP; n++; }
      return n;
    },
    simulateTo(t) {
      if (t < walker.t - STEP * 0.5) reset();
      while (walker.t < t - STEP * 0.5) tick();
    },
    position(out = new THREE.Vector3()) { return out.set(walker.x, 0, walker.z); },
    busy() { return walker.moving() || !!walker.target || !!walker.dir || !!walker.face || walker.t < walker.waveUntil; },
  };
}
