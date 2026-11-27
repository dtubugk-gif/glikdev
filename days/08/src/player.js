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
  scale: 20,                // bigger than the kitty's x14 (the owner: "make me bigger"): 26 cm at cat size, 5.2 m here
  eye: 4.15,                // where your eyes are (m): the first-person camera sits here
  walk: 4.6, run: 11.0,     // m/s
  runFrom: 8,               // a trip longer than this is run
  radius: 1.8,
  limit: 118,               // the plate is 128 m from the middle to its edge
};
// Day 4 (idea by @Darkbacon155): the fish on a stick, in your right hand. In models/wand.glb the rod's tip is
// 0.1552 m up from the grip and leans 0.0087 m to one side (art/day04/build_wand.py prints both). The rod is
// drawn x34 (as long as you are tall, so it reads from across the plate), the fish x24.
export const HOLD = {
  scale: 34, fishScale: 24,
  len: 0.1552 * 34, droop: 0.0087 * 34,
  grip: [-0.86, 2.42, 0.98],        // where the grip is, in your own frame (x: your right is -x; y up; z ahead), metres
  restElev: 0.95,                   // the rod's tilt above level while the fish just hangs (radians)
  restYaw: -0.5,                    // ...and its turn: out to your right, so the fish hangs beside you, not over your face
  outElev: 0.34,                    // ...and while the fish is out on the floor: lower, pointing at it
  lowElev: 0.27,                    // ...and while you dangle it in front of her: right down, so it dances on the floor
  swing: 0.5,                       // a cast's flick lasts this long (s)
};
const STEP = 1 / 60;
const CLIPS = ['Idle', 'Walk', 'Run', 'Wave'];
// Day 6: two more, played once each (from Idle back to Idle): a jump for joy, and a crouch to stroke a cat
const ONCE = { Cheer: 1.4, Pet: 2.4 };
/** Day 7 (the owner: "a jump button"): a jump, second by second, and how high it goes (m). The 'Jump' clip in
 *  player.glb is timed to it: it crouches for `crouch`, leaves the ground, lands `air` later, and recovers. */
export const JUMP = { crouch: 0.1, air: 0.62, land: 0.18, height: 2.6 };
JUMP.total = JUMP.crouch + JUMP.air + JUMP.land;
/** Day 8 (the home): you hop into your bed and flop down (the Jump clip turns into 'Sleep' near the top of the hop),
 *  and hop back out. `sleepAt`: how far through the air the Sleep clip takes over; `fade`: its cross-fade (s). */
export const BEDTIME = { sleepAt: 0.42, fade: 0.38, wakeFade: 0.3 };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const easeOut = (k) => 1 - (1 - clamp(k, 0, 1)) ** 3;
const easeInOut = (k) => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); };
/** The flick of a cast, s seconds in: the rod tips back over your shoulder (+), whips forward and down (-), settles (0). */
export function flick(s) {
  if (s < 0 || s >= HOLD.swing) return 0;
  if (s < 0.09) return 0.9 * easeOut(s / 0.09);
  if (s < 0.24) return 0.9 - 1.2 * easeInOut((s - 0.09) / 0.15);
  return -0.3 * (1 - easeOut((s - 0.24) / (HOLD.swing - 0.24)));
}
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
    target: null, dir: null, waveUntil: -1, arrived: 0, actName: null, actUntil: -1,
    boxes: o.boxes || [], circles: o.circles || [],
    wand: false, castAt: -10, aim: null, aimOut: false, rodYaw: HOLD.restYaw, rodElev: HOLD.restElev,
    jumpAt: -10, jumps: 0, mag: 1,
    // Day 8: the way round the house (route(x, z, tx, tz, r) -> {x, z}); your bed, and where you are with it:
    // bed { lie: {x, z}, side: {x, z}, heading, top }; bedState null | 'going' | 'flop' | 'in' | 'hop'
    route: o.route || null, bed: null, bedState: null, bedAt: -10,
  };
  const clampIn = (x, z) => {
    const r = Math.hypot(x, z);
    if (r > PLAYER.limit) { x *= PLAYER.limit / r; z *= PLAYER.limit / r; }
    for (const b of w.boxes) [x, z] = outOfBox(x, z, b, PLAYER.radius);
    return [x, z];
  };
  w.goTo = (x, z) => {
    if (w.bedState === 'going') w.bedState = null;          // somewhere else after all
    const [tx, tz] = clampIn(x, z); w.target = { x: tx, z: tz }; w.dir = null; w.waveUntil = -1; w.actUntil = -1;
  };
  // ---- Day 8: your bed
  const inOrOn = () => w.bedState === 'flop' || w.bedState === 'in' || w.bedState === 'hop';
  /** off to bed: you walk to its side, then hop in and flop down */
  w.goToBed = (bed) => {
    if (inOrOn()) return false;
    w.goTo(bed.side.x, bed.side.z);
    w.bed = bed; w.bedState = 'going';
    return true;
  };
  /** in it (or on the way down into it) */
  w.inBed = () => w.bedState === 'flop' || w.bedState === 'in';
  /** asleep: lying still in it */
  w.asleep = () => w.bedState === 'in';
  /** up you get: a hop back out to its side (false if you are not in it) */
  w.getUp = () => {
    if (!w.inBed()) return false;
    w.bedState = 'hop'; w.bedAt = w.t; w.jumpAt = w.t; w.jumps++;
    return true;
  };
  const flopping = () => w.t - w.bedAt;
  /** how far through the hop's air time (0..1) */
  const hopK = () => clamp((flopping() - JUMP.crouch) / JUMP.air, 0, 1);
  /** the keyboard or the move stick: a direction to keep going; `mag` 0..1 (the stick pushed part way walks) */
  w.steer = (dx, dz, mag = 1) => {
    const d = Math.hypot(dx, dz);
    if (d > 1e-3 && w.bedState === 'going') w.bedState = null;
    w.dir = d > 1e-3 ? { x: dx / d, z: dz / d } : null;
    w.mag = Math.max(0, Math.min(1, mag));
    if (w.dir) { w.target = null; w.waveUntil = -1; w.actUntil = -1; }
  };
  w.stop = () => { w.target = null; w.dir = null; };
  // ---- Day 7: the jump. You keep going the way you were going; only up and down are added.
  /** jumps, unless you are already in the air (a new one may start as the last one lands) */
  w.jump = () => {
    const a = w.t - w.jumpAt;
    if (a >= 0 && a < JUMP.crouch + JUMP.air) return false;
    w.jumpAt = w.t; w.jumps++; w.waveUntil = -1; w.actUntil = -1;
    return true;
  };
  /** how high your feet are off the ground (m) */
  w.y = () => {
    if (w.bedState === 'in') return w.bed.top;
    if (w.bedState === 'flop' || w.bedState === 'hop') {
      const k = hopK(), up = w.bedState === 'flop' ? easeInOut(k) : 1 - easeInOut(k);
      return JUMP.height * 4 * k * (1 - k) + w.bed.top * up;
    }
    const a = w.t - w.jumpAt - JUMP.crouch;
    if (a <= 0 || a >= JUMP.air) return 0;
    const k = a / JUMP.air;
    return JUMP.height * 4 * k * (1 - k);
  };
  w.airborne = () => w.y() > 0;
  /** squash and stretch (height, and the width that keeps your volume): down in the crouch, long as you leave, flat as you land */
  w.squash = () => {
    const a = w.t - w.jumpAt;
    let y = 1;
    // (gentle: the 'Jump' clip crouches and lands with the body itself; this only adds a little spring)
    if (a >= 0 && a < JUMP.crouch) y = 1 - 0.04 * Math.sin((a / JUMP.crouch) * Math.PI / 2);
    else if (a >= JUMP.crouch && a < JUMP.crouch + 0.16) y = 1 + 0.05 * Math.sin(((a - JUMP.crouch) / 0.16) * Math.PI);
    else if (a >= JUMP.crouch + JUMP.air && a < JUMP.total) y = 1 - 0.05 * Math.sin(((a - JUMP.crouch - JUMP.air) / JUMP.land) * Math.PI);
    return { y, xz: 1 / Math.sqrt(y) };
  };
  w.wave = () => { if (!w.target && !w.dir && !w.wand) w.waveUntil = w.t + 2.0; };   // (your waving hand holds the stick)
  /** Day 6: 'Cheer' (a jump for joy) or 'Pet' (crouch and stroke the cat in front of you), when you are standing still */
  w.act = (name, faceX, faceZ) => {
    if (!ONCE[name] || w.target || w.dir || w.speed > 0.3 || w.t < w.actUntil) return false;
    w.actName = name; w.actUntil = w.t + ONCE[name]; w.waveUntil = -1;
    if (faceX != null) w.face = { x: faceX, z: faceZ };
    return true;
  };
  // ---- the fish on a stick
  w.setWand = (on) => { w.wand = !!on; if (!on) { w.aim = null; w.aimOut = false; w.castAt = -10; } };
  /**
   * where the fish is ([x, y, z]); whether it is out (cast, lying on the floor) rather than hanging from the tip;
   * and whether you are dangling it in front of her (the rod comes right down, so it dances on the floor)
   */
  w.setAim = (p, out, low) => { w.aim = p; w.aimOut = !!out; w.aimLow = !!low; };
  /** the flick of a cast toward (x, z): you turn to face it, unless you are walking */
  w.cast = (x, z) => { w.castAt = w.t; if (!w.target && !w.dir) w.face = { x, z }; };
  /** The rod right now, in your own frame: where the grip is, which way the rod points, which way its tip leans. */
  w.rod = () => {
    const e = flick(w.t - w.castAt);
    const sway = w.speed > 0.3 ? 0.05 * Math.sin(w.t * (w.speed > PLAYER.walk * 1.35 ? 15 : 9)) : 0.025 * Math.sin(w.t * 1.7);
    const elev = w.rodElev + e + sway, yaw = w.rodYaw;
    const back = Math.max(0, e), fore = Math.max(0, -e);
    const grip = [HOLD.grip[0], HOLD.grip[1] + 0.85 * back - 0.25 * fore, HOLD.grip[2] - 0.55 * back + 0.9 * fore];
    const ce = Math.cos(elev), dir = [Math.sin(yaw) * ce, Math.sin(elev), Math.cos(yaw) * ce];
    // the tip leans the way gravity pulls it: straight down, less the part along the rod
    let lx = dir[0] * dir[1], ly = dir[1] * dir[1] - 1, lz = dir[2] * dir[1];
    let ll = Math.hypot(lx, ly, lz);
    if (ll < 1e-3) { lx = Math.sin(yaw); ly = 0; lz = Math.cos(yaw); ll = 1; }
    return { grip, dir, lean: [lx / ll, ly / ll, lz / ll] };
  };
  /** Where the rod's tip is in the world: [x, y, z]. The line to the fish starts here. */
  w.tip = () => {
    const r = w.rod(), c = Math.cos(w.heading), s = Math.sin(w.heading);
    const lx = r.grip[0] + HOLD.len * r.dir[0] + HOLD.droop * r.lean[0];
    const ly = r.grip[1] + HOLD.len * r.dir[1] + HOLD.droop * r.lean[1];
    const lz = r.grip[2] + HOLD.len * r.dir[2] + HOLD.droop * r.lean[2];
    return [w.x + lx * c + lz * s, ly, w.z - lx * s + lz * c];
  };
  w.faceTo = (x, z) => { w.face = { x, z }; };
  w.step = (dt = STEP) => {
    w.t += dt;
    // Day 8: arrived beside your bed: in you hop
    if (w.bedState === 'going' && !w.target) {
      if (Math.hypot(w.x - w.bed.side.x, w.z - w.bed.side.z) < 1.2) { w.bedState = 'flop'; w.bedAt = w.t; w.jumpAt = w.t; w.jumps++; w.speed = 0; w.face = null; w.onJump?.('bed-up'); }
      else w.bedState = null;                               // (it could not be reached)
    }
    if (inOrOn()) { bedStep(dt); if (inOrOn()) return; }
    let want = 0, hx = 0, hz = 0;
    // Day 8: a tapped spot round the house or through its door: head for the next corner (or the door) first
    const way = w.target && w.route ? w.route(w.x, w.z, w.target.x, w.target.z, PLAYER.radius) : w.target;
    if (w.dir) { hx = w.dir.x; hz = w.dir.z; want = PLAYER.walk * 0.55 + (PLAYER.run - PLAYER.walk * 0.55) * w.mag; }
    else if (w.target) {
      const dx = w.target.x - w.x, dz = w.target.z - w.z, d = Math.hypot(dx, dz);
      if (d < 0.25) { w.target = null; w.arrived = w.t; }
      else {
        const wx = way.x - w.x, wz = way.z - w.z, wd = Math.hypot(wx, wz) || 1;
        hx = wx / wd; hz = wz / wd;
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
    // the rod: up while the fish hangs from it; lower and turned toward the fish once it is out
    let yawT = HOLD.restYaw, elevT = HOLD.restElev;
    if (w.wand && w.aimOut && w.aim) {
      const d = Math.hypot(w.aim[0] - w.x, w.aim[2] - w.z);
      yawT = clamp(wrap(Math.atan2(w.aim[0] - w.x, w.aim[2] - w.z) - w.heading), -1.25, 1.25);
      elevT = HOLD.outElev + (HOLD.restElev - HOLD.outElev) * clamp(1 - (d - 3) / 4, 0, 1);
    }
    if (w.wand && w.aimLow) { yawT = -0.15; elevT = HOLD.lowElev + 0.05 * Math.sin(w.t * 7); }   // dangling: low, with a jiggle
    const kr = 1 - Math.exp(-dt * 8);
    w.rodYaw += (yawT - w.rodYaw) * kr;
    w.rodElev += (elevT - w.rodElev) * kr;
    // the jump's two moments: off the ground, and back on it
    const ja = w.t - w.jumpAt - JUMP.crouch;
    if (ja >= 0 && ja - dt < 0) w.onJump?.('up');
    if (ja >= JUMP.air && ja - dt < JUMP.air) w.onJump?.('land');
    // footfalls: one every stride's length (longer strides when running), for the sound of your steps
    if (w.speed > 0.6 && !w.airborne()) {
      const run = w.speed > PLAYER.walk * 1.35;
      w.stride = (w.stride ?? 1.2) + w.speed * dt;
      const len = run ? 3.3 : 2.05;
      if (w.stride >= len) { w.stride -= len; w.onStep?.(run); }
    } else w.stride = 1.2;                                   // the first step lands soon after setting off
  };
  /** in bed, flopping into it, or hopping out: you are moved here, not walked */
  function bedStep(dt) {
    const B = w.bed, k = hopK();
    w.speed = 0; w.stride = 1.2;
    if (w.bedState === 'in') {
      w.x = B.lie.x; w.z = B.lie.z; w.heading = B.heading;
      if (w.dir || w.target) w.getUp();                     // you want to go somewhere: up first
      return;
    }
    const a = w.bedState === 'flop' ? B.side : B.lie, b = w.bedState === 'flop' ? B.lie : B.side, e = easeInOut(k);
    w.x = a.x + (b.x - a.x) * e; w.z = a.z + (b.z - a.z) * e;
    // into bed: turn to lie along it; out of it: turn to face the way you hop
    const want = w.bedState === 'flop' ? B.heading : Math.atan2(B.side.x - B.lie.x, B.side.z - B.lie.z);
    w.heading = wrap(w.heading + wrap(want - w.heading) * Math.min(1, dt * 9));
    const ja = flopping() - JUMP.crouch;
    if (ja >= JUMP.air && ja - dt < JUMP.air) w.onJump?.(w.bedState === 'flop' ? 'bed-land' : 'land');
    if (flopping() >= JUMP.total) {
      if (w.bedState === 'flop') { w.bedState = 'in'; w.x = B.lie.x; w.z = B.lie.z; w.heading = B.heading; }
      else { w.bedState = null; w.x = B.side.x; w.z = B.side.z; w.jumpAt = -10; }
    }
  }
  w.moving = () => w.speed > 0.3;
  /** which clip, and how fast it plays */
  w.anim = () => {
    if (w.bedState === 'in') return { name: 'Sleep', rate: 1, fade: BEDTIME.fade };
    if (w.bedState === 'flop') return hopK() >= BEDTIME.sleepAt ? { name: 'Sleep', rate: 1, fade: BEDTIME.fade } : { name: 'Jump', rate: 1, once: true, key: w.jumps };
    if (w.bedState === 'hop') return { name: 'Jump', rate: 1, once: true, key: w.jumps, fade: BEDTIME.wakeFade };
    if (w.t - w.jumpAt < JUMP.total) return { name: 'Jump', rate: 1, once: true, key: w.jumps };
    if (w.speed > PLAYER.walk * 1.35) return { name: 'Run', rate: Math.min(1.5, Math.max(0.8, w.speed / 9.4)) };
    if (w.speed > 0.3) return { name: 'Walk', rate: Math.min(1.6, Math.max(0.6, w.speed / 4.1)) };
    if (w.t < w.actUntil) return { name: w.actName, rate: 1, once: true };
    if (w.t < w.waveUntil) return { name: 'Wave', rate: 1 };
    return { name: 'Idle', rate: 1 };
  };
  return w;
}

/**
 * @param {{scene:THREE.Scene, url:string, start?:object, boxes?:object[], circles?:Function[],
 *          script?:{t:number, type:string, x?:number, z?:number}[], renderer?:THREE.WebGLRenderer,
 *          onStep?:(running:boolean)=>void}} o
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
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(3.7, 3.7), new THREE.MeshBasicMaterial({
    map: new THREE.CanvasTexture(c), transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.04;
  blob.renderOrder = 1;
  root.add(blob);

  const startOpts = { ...o.start, boxes: o.boxes, circles: o.circles, route: o.route };
  // Day 8: asleep, your eyes are shut. The eyes are painted (M_PlayerEye's map): a closed-eyes picture on the same
  // layout (models/player_eye_closed.webp, by Fable 5.2) takes its place while the Sleep clip shows
  const eyeMats = [];
  model.traverse((m) => { if (m.isMesh) for (const mat of [].concat(m.material)) if (/PlayerEye/i.test(mat.name) && mat.map && !eyeMats.includes(mat)) eyeMats.push(mat); });
  let eyesShut = null, eyesShown = false;
  if (o.sleepEyesUrl && eyeMats.length) {
    new THREE.TextureLoader().loadAsync(o.sleepEyesUrl).then((tex) => {
      const src = eyeMats[0].map;
      tex.flipY = src.flipY; tex.colorSpace = src.colorSpace; tex.channel = src.channel;
      tex.wrapS = src.wrapS; tex.wrapT = src.wrapT; tex.anisotropy = src.anisotropy;
      tex.offset.copy(src.offset); tex.repeat.copy(src.repeat); tex.rotation = src.rotation; tex.center.copy(src.center);
      for (const mat of eyeMats) mat.userData.openEyes = mat.map;
      eyesShut = tex;
    }).catch((err) => console.warn('Glikdev: the closed eyes did not load', err));
  }
  function eyes() {
    const shut = !!eyesShut && curName === 'Sleep';
    if (shut === eyesShown) return;
    eyesShown = shut;
    for (const mat of eyeMats) { mat.map = shut ? eyesShut : mat.userData.openEyes; mat.needsUpdate = true; }
  }
  let walker, mixer, actions, cur, curName, curKey = null, scriptAt, acc = 0;
  // ---- Day 4: the stick in your right hand. The clips know nothing of it: after each one has posed you, your
  // right arm is bent (two-bone IK) so the hand is on the grip, and the rod is laid in it.
  const arm = ['upperarm_R', 'forearm_R', 'hand_R'].map((n) => model.getObjectByName(n));
  const armOK = arm.every(Boolean);
  const body = ['spine', 'chest'].map((n) => model.getObjectByName(n)).filter(Boolean);   // they lean into a cast
  const kept = arm.map(() => new THREE.Quaternion()), keptBody = body.map(() => new THREE.Quaternion());
  const lean = new THREE.Quaternion(), leanAxis = new THREE.Vector3();
  let bent = false, rod = null, wandOn = false;
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vS = new THREE.Vector3(), vG = new THREE.Vector3(), vW = new THREE.Vector3(),
    vE = new THREE.Vector3(), vn = new THREE.Vector3(), vp = new THREE.Vector3();
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), qd = new THREE.Quaternion(), mB = new THREE.Matrix4();
  const bx = new THREE.Vector3(), by = new THREE.Vector3(), bz = new THREE.Vector3();
  /** turn `bone` so that the way to `child` points at `target` (all in the world) */
  function point(bone, child, target) {
    bone.getWorldPosition(va); child.getWorldPosition(vb);
    vb.sub(va).normalize();
    vn.copy(target).sub(va).normalize();
    qd.setFromUnitVectors(vb, vn);
    bone.getWorldQuaternion(qa).premultiply(qd);
    bone.parent.getWorldQuaternion(qb).invert();
    bone.quaternion.copy(qb.multiply(qa));
    bone.updateMatrixWorld(true);
  }
  function unbend() {
    if (!bent) return;
    arm.forEach((b, k) => b.quaternion.copy(kept[k]));
    body.forEach((b, k) => b.quaternion.copy(keptBody[k]));
    bent = false;
  }
  /** lean a bone by `angle` about your own left-right axis (forward is positive), in the world */
  function leanBone(bone, angle) {
    leanAxis.set(1, 0, 0).applyQuaternion(root.quaternion);
    lean.setFromAxisAngle(leanAxis, angle);
    bone.getWorldQuaternion(qa).premultiply(lean);
    bone.parent.getWorldQuaternion(qb).invert();
    bone.quaternion.copy(qb.multiply(qa));
    bone.updateMatrixWorld(true);
  }
  function holdRod() {
    if (!rod) return;
    rod.visible = wandOn && model.visible;
    if (!wandOn) return;
    const r = walker.rod();
    rod.position.set(r.grip[0], r.grip[1], r.grip[2]);
    by.set(r.dir[0], r.dir[1], r.dir[2]); bz.set(r.lean[0], r.lean[1], r.lean[2]); bx.crossVectors(by, bz);
    rod.quaternion.setFromRotationMatrix(mB.makeBasis(bx, by, bz));
    if (!armOK) return;
    root.updateMatrixWorld(true);
    arm.forEach((b, k) => kept[k].copy(b.quaternion));
    body.forEach((b, k) => keptBody[k].copy(b.quaternion));
    bent = true;
    // your body goes with the cast: back as the rod tips back, forward as it whips out
    const e = flick(walker.t - walker.castAt);
    if (e) for (const b of body) leanBone(b, -0.16 * e);
    vG.set(r.grip[0], r.grip[1], r.grip[2]).applyMatrix4(root.matrixWorld);      // the grip, in the world
    arm[0].getWorldPosition(vS);
    arm[1].getWorldPosition(va); arm[2].getWorldPosition(vb);
    const l1 = va.distanceTo(vS), l2 = vb.distanceTo(va);
    vW.copy(vG).sub(vS);
    vW.setLength(Math.max(0.01, vW.length() - 0.22)).add(vS);                    // the wrist: a palm's length short of the grip
    vn.copy(vW).sub(vS);
    const d = clamp(vn.length(), Math.abs(l1 - l2) + 0.02, l1 + l2 - 0.02);
    vn.normalize();
    const a = (l1 * l1 + d * d - l2 * l2) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    vp.set(-0.5, -1, -0.3).applyQuaternion(root.quaternion);                     // the elbow: down, out and a little back
    vp.addScaledVector(vn, -vp.dot(vn)).normalize();
    vE.copy(vS).addScaledVector(vn, a).addScaledVector(vp, h);
    vW.copy(vS).addScaledVector(vn, d);
    point(arm[0], arm[1], vE);
    point(arm[1], arm[2], vW);
  }
  function reset() {
    unbend();
    walker = createWalker(startOpts);
    walker.onStep = o.onStep || null;
    walker.setWand(wandOn);
    if (mixer) { mixer.stopAllAction(); mixer.uncacheRoot(mixer.getRoot()); }
    mixer = new THREE.AnimationMixer(model);
    actions = Object.fromEntries([...CLIPS, ...Object.keys(ONCE), 'Jump', 'Sleep'].filter((n) => clips[n]).map((n) => [n, mixer.clipAction(clips[n])]));
    cur = null; curName = ''; curKey = null; scriptAt = 0;
    walker.onJump = (what) => o.onJump?.(what, walker);
    show(walker.anim(), true);
    mixer.update(0);
    place();
    holdRod();
  }
  function show(a, instant = false) {
    // (no 'Jump' clip in an older player.glb: you keep the clip you had, and the jump is only the leap itself)
    const name = actions[a.name] ? a.name : a.name === 'Jump' ? (curName || 'Idle') : 'Idle';
    const act = actions[name];
    if (name === curName && (a.key == null || a.key === curKey)) { act.timeScale = a.rate; return; }
    curKey = a.key ?? null;
    act.reset();
    act.setLoop(a.once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    act.clampWhenFinished = true;
    act.timeScale = a.rate;
    act.setEffectiveWeight(1);
    act.play();
    if (cur && !instant) act.crossFadeFrom(cur, a.fade ?? (name === 'Jump' ? 0.06 : 0.18), false); else if (cur) cur.stop();   // (a jump's crouch is only 0.1 s: a quick blend keeps it)
    cur = act; curName = name;
  }
  function place() {
    const y = walker.y();
    root.position.set(walker.x, y, walker.z); root.rotation.y = walker.heading;
    blob.position.y = 0.04 - y;                            // your shadow stays on the ground, smaller and paler as you rise
    blob.scale.setScalar(1 - Math.min(0.45, y / 8));
    blob.material.opacity = walker.inBed() || walker.bedState === 'hop' ? 0 : 0.5 * (1 - Math.min(0.6, y / 6));   // (in bed: the bed has its own shade)
  }
  function tick() {
    if (o.script) {
      while (scriptAt < o.script.length && o.script[scriptAt].t <= walker.t + 1e-6) {
        const s = o.script[scriptAt++];
        if (s.type === 'go') walker.goTo(s.x, s.z);
        else if (s.type === 'wave') walker.wave();
        else if (s.type === 'jump') walker.jump();
        else if (s.type === 'face') walker.faceTo(s.x, s.z);
        else if (s.type === 'cheer' || s.type === 'pet') walker.act(s.type === 'cheer' ? 'Cheer' : 'Pet', s.x, s.z);
        else if (s.type === 'bed' && o.bed) walker.goToBed(o.bed);      // Day 8
        else if (s.type === 'getup') walker.getUp();
      }
    }
    walker.step(STEP);
    show(walker.anim());
    eyes();
    unbend();                                              // the clips pose your arm as they always did...
    mixer.update(STEP);
    place();
    holdRod();                                             // ...and then it takes hold of the stick
  }
  reset();
  return {
    root,
    get walker() { return walker; },
    get x() { return walker.x; }, get z() { return walker.z; }, get t() { return walker.t; },
    goTo(x, z) { walker.goTo(x, z); },
    steer(dx, dz, mag = 1) { walker.steer(dx, dz, mag); },
    /** Day 7: jump (false while you are already in the air); the squash and stretch to draw it with */
    jump() { return walker.jump(); },
    squash() { return walker.squash(); },
    get airborne() { return walker.airborne(); },
    stop() { walker.stop(); },
    wave() { walker.wave(); },
    /** Day 6: a jump for joy; or crouch and stroke the cat at (x, z) */
    cheer() { return walker.act('Cheer'); },
    petAt(x, z) { return walker.act('Pet', x, z); },
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
    /** first person: you do not see your own body (your shadow stays) */
    setBodyVisible(v) { model.visible = v; if (rod) rod.visible = wandOn && v; },
    /** Day 8: your bed (homelogic.js OWNER_BED, as the walker wants it): go to bed, get up, where you are with it */
    goToBed(bed = o.bed) { return bed ? walker.goToBed(bed) : false; },
    getUp() { return walker.getUp(); },
    get inBed() { return walker.inBed(); },
    get asleep() { return walker.asleep(); },
    get bedState() { return walker.bedState; },
    busy() { return walker.inBed() || walker.bedState === 'hop' || walker.moving() || !!walker.target || !!walker.dir || !!walker.face || walker.t < walker.waveUntil || walker.t < walker.actUntil || walker.t - walker.castAt < HOLD.swing + 0.1 || walker.t - walker.jumpAt < JUMP.total; },
    /** Day 4: the fish on a stick. giveRod: the rod's model (a group, drawn at HOLD.scale); setWand: in your hand or put away */
    giveRod(obj) { rod = obj; root.add(obj); holdRod(); },
    setWand(on) { wandOn = !!on; walker.setWand(wandOn); if (!wandOn) unbend(); holdRod(); },
    get wand() { return wandOn; },
    cast(x, z) { walker.cast(x, z); },
    setAim(p, out, low) { walker.setAim(p, out, low); },
    /** where the rod's tip is in the world: [x, y, z] */
    tip() { return walker.tip(); },
    get heading() { return walker.heading; },
  };
}
