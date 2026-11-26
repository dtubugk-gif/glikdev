// Day 7: the parrots (idea by @elenaabrosimova1968: "Parrots? Yes they give you seeds"). A parrot flies in from far
// off with a seed packet in its beak, glides down onto the perch by the garden, squawks, and waits. Come close (or
// tap it) and it bends down and lets the packet drop at your feet; a hop, and it takes off and flies away. If you
// never come, it drops the packet anyway after a while and leaves. The packet waits on the ground until you pick
// it up (walk over it or tap it): then it flies into your seed bag.
//
// models/parrot.glb + parrot.json (art/day07/build_parrot.py: the bird, its 8 clips, `SeedSocket` in its beak)
// models/perch.glb (art/day07/build_perch.py: `PerchGrip` on the top bar). The seed packets are in garden.glb.
// Everything that moves is a pure function of the clock (parrotPose, packetPose), so recordings come out the same
// every time; the clips are not played, they are SET to the time the pose asks for.
import * as THREE from '../vendor/three/three.module.js';
import { GLTFLoader } from '../vendor/three/addons/loaders/GLTFLoader.js';
import { skyReflections } from './outfits.js';

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (k) => { k = clamp01(k); return k * k * (3 - 2 * k); };
const easeOut = (k) => 1 - (1 - clamp01(k)) ** 3;
const lerp = (a, b, k) => a + (b - a) * k;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** The bird's clips (parrot.json overrides these with the real ones once it has loaded). */
export const INFO = {
  scale: 14,
  clips: { Perch: 3, Squawk: 1, Drop: 0.9, Hop: 0.5, TakeOff: 0.6, Fly: 0.4, Glide: 1.2, Land: 0.7 },
  dropRelease: 0.45, landTouch: 0.4, takeOffLift: 0.02,
};
export function setParrotInfo(info) {
  if (!info || typeof info !== 'object') return;
  if (info.clips) for (const [k, v] of Object.entries(info.clips)) if (Number.isFinite(v) && v > 0) INFO.clips[k] = v;
  for (const k of ['scale', 'dropRelease', 'landTouch', 'takeOffLift']) if (Number.isFinite(info[k])) INFO[k] = info[k];
}

/** A visit's timing (seconds): flying in, how often it squawks while it waits, the little pause before it leaves. */
export const FLIGHT = { inFor: 6.4, outFor: 6.0, far: 120, high: 44, squawkFirst: 0.5, squawkEvery: 6.5, afterDrop: 0.9, afterHop: 0.7 };

const EASE_IN = 0.4;                                       // the flight in: this much quicker at the start than the end
/** cubic Bezier, one axis */
const bez = (a, b, c, d, u) => { const v = 1 - u; return v * v * v * a + 3 * v * v * u * b + 3 * v * u * u * c + u * u * u * d; };

/**
 * The flight paths of one visit, worked out once. `grip` = where its feet hold the bar (world), `face` = the way it
 * faces on the perch (heading, radians: 0 = +Z), `from`/`to` = the compass bearings it comes from and leaves to.
 */
export function planVisit({ t, grip, face, from = 2.4, to = -0.6, seed = 'pineapple', id = 0 }) {
  const fx = Math.sin(face), fz = Math.cos(face);
  const G = [grip.x, grip.y, grip.z];
  // in: from far away and high, round in a wide arc, and in from behind the perch, gliding down onto it
  const S = [G[0] + Math.sin(from) * FLIGHT.far, G[1] + FLIGHT.high, G[2] + Math.cos(from) * FLIGHT.far];
  const L0 = [G[0] - fx * 4.2, G[1] + 1.7, G[2] - fz * 4.2];          // where the landing clip takes over (it brakes from here)
  const C2 = [L0[0] - fx * 26, L0[1] + 6, L0[2] - fz * 26];
  const C1 = [lerp(S[0], C2[0], 0.3) + Math.cos(from) * 26, S[1] - 4, lerp(S[2], C2[2], 0.3) - Math.sin(from) * 26];
  // out: off forward, climbing, and away
  const E = [G[0] + Math.sin(to) * FLIGHT.far * 1.1, G[1] + FLIGHT.high + 10, G[2] + Math.cos(to) * FLIGHT.far * 1.1];
  const O1 = [G[0] + fx * 14, G[1] + 7, G[2] + fz * 14];
  const O2 = [lerp(O1[0], E[0], 0.45), lerp(O1[1], E[1], 0.6), lerp(O1[2], E[2], 0.45)];
  return { id, t, seed, face, G, S, C1, C2, L0, E, O1, O2, giveAt: null, done: false };
}

/** When it is on the perch, ready to hand the seed over. */
export const perchedAt = (v) => v.t + FLIGHT.inFor + INFO.clips.Land;
/** When it lets go of the packet (null: it has not been asked yet). */
export const releaseAt = (v) => (v.giveAt == null ? null : v.giveAt + INFO.dropRelease);
/** When it takes off again, and when it is gone. */
export function leaveTimes(v) {
  if (v.giveAt == null) return null;
  const hop = v.giveAt + INFO.clips.Drop + FLIGHT.afterDrop;
  const off = hop + INFO.clips.Hop + FLIGHT.afterHop;
  return { hop, off, gone: off + INFO.clips.TakeOff + FLIGHT.outFor };
}

function pathAt(v, u, inbound) {
  const [a, b, c, d] = inbound ? [v.S, v.C1, v.C2, v.L0] : [v.O1, v.O1, v.O2, v.E];
  return [bez(a[0], b[0], c[0], d[0], u), bez(a[1], b[1], c[1], d[1], u), bez(a[2], b[2], c[2], d[2], u)];
}

/**
 * Where the parrot is at t and what it is doing.
 * @returns {null | {pos:number[], heading:number, bank:number, pitch:number, clips:[string, number, number][],
 *   phase:'in'|'land'|'perch'|'drop'|'hop'|'off'|'out', beak:boolean, flapping:boolean}}
 *   clips: [clip name, time in it, weight]; beak: the packet is still in its beak; null = not there (before or after)
 */
export function parrotPose(v, t) {
  const C = INFO.clips, a = t - v.t;
  if (a < 0) return null;
  const P0 = FLIGHT.inFor + C.Land;                        // seconds after it set off that it sits on the bar
  const lv = leaveTimes(v);
  const beak = v.giveAt == null || t < releaseAt(v);
  let pos, heading = v.face, bank = 0, pitch = 0, phase, clips;
  const flightHeading = (p, q) => Math.atan2(q[0] - p[0], q[2] - p[2]);
  if (a < FLIGHT.inFor) {
    // flying in: flaps, with glides between; the last stretch is all glide
    const k = a / FLIGHT.inFor, u = k + EASE_IN * k * (1 - k);      // quicker at first, slower toward the end
    pos = pathAt(v, u, true);
    const ahead = pathAt(v, Math.min(1, u + 0.02), true), behind = pathAt(v, Math.max(0, u - 0.02), true);
    heading = flightHeading(behind, ahead);
    const h2 = flightHeading(pathAt(v, Math.min(1, u + 0.06), true), pathAt(v, Math.min(1, u + 0.08), true));
    bank = Math.max(-0.65, Math.min(0.65, -wrap(h2 - heading) * 4));
    pitch = Math.max(-0.35, Math.min(0.3, Math.atan2(behind[1] - ahead[1], Math.hypot(ahead[0] - behind[0], ahead[2] - behind[2])) * 0.6));
    const glide = Math.max(smooth((k - 0.34) / 0.06) * (1 - smooth((k - 0.52) / 0.06)), smooth((k - 0.7) / 0.08));
    clips = [['Fly', a % C.Fly, 1 - glide], ['Glide', a % C.Glide, glide]];
    phase = 'in';
  } else if (a < P0) {
    // landing: the clip brakes and reaches; the bird is brought onto the bar so its feet touch it on the clip's beat
    // it arrives at the speed it was flying and brakes to a stop as its feet touch the bar (a Hermite curve)
    const b = a - FLIGHT.inFor, tau = clamp01(b / INFO.landTouch);
    const dist = Math.hypot(v.G[0] - v.L0[0], v.G[1] - v.L0[1], v.G[2] - v.L0[2]) || 1;
    const vEnd = 3 * Math.hypot(v.L0[0] - v.C2[0], v.L0[1] - v.C2[1], v.L0[2] - v.C2[2]) * (1 - EASE_IN) / FLIGHT.inFor;
    const m0 = Math.min(2.5, (vEnd * INFO.landTouch) / dist);
    const k = -2 * tau ** 3 + 3 * tau ** 2 + m0 * (tau ** 3 - 2 * tau ** 2 + tau);
    pos = [lerp(v.L0[0], v.G[0], k), lerp(v.L0[1], v.G[1], k), lerp(v.L0[2], v.G[2], k)];
    heading = v.face;
    pitch = 0.18 * (1 - smooth(b / INFO.landTouch));
    const w = smooth(b / 0.15);
    clips = [['Glide', a % C.Glide, 1 - w], ['Land', Math.min(b, C.Land - 1e-3), w]];
    phase = 'land';
  } else if (!lv || t < lv.off) {
    pos = [...v.G];
    const p = a - P0;
    clips = [['Perch', p % C.Perch, 1]];
    phase = 'perch';
    // one-shots on top of the perch loop: a squawk now and then while it waits; the drop; the hop
    const shot = (name, at) => {
      const s = t - at, L = C[name];
      if (s < 0 || s >= L) return false;
      const w = Math.min(smooth(s / 0.12), 1 - smooth((s - (L - 0.12)) / 0.12));
      clips[0][2] = 1 - w;
      clips.push([name, s, w]);
      return true;
    };
    if (v.giveAt == null || t < v.giveAt) {
      const s = p - FLIGHT.squawkFirst;
      if (s >= 0) shot('Squawk', perchedAt(v) + FLIGHT.squawkFirst + Math.floor(s / FLIGHT.squawkEvery) * FLIGHT.squawkEvery);
    } else if (shot('Drop', v.giveAt)) phase = 'drop';
    else if (lv && shot('Hop', lv.hop)) phase = 'hop';
  } else if (t < lv.off + C.TakeOff) {
    const b = t - lv.off;
    pos = [...v.G];                                         // (the clip itself crouches, jumps and lifts the body)
    clips = [['TakeOff', b, 1]];
    phase = 'off';
  } else if (t < lv.gone) {
    const b = t - lv.off - C.TakeOff, k = b / FLIGHT.outFor, u = k ** 1.25;
    const start = v.G;
    const path = pathAt(v, u, false);
    const blend = smooth(b / 0.5);                           // from the spot it took off at onto the path
    pos = [lerp(start[0], path[0], blend), lerp(start[1], path[1], blend), lerp(start[2], path[2], blend)];
    const ahead = pathAt(v, Math.min(1, u + 0.02), false), behind = pathAt(v, Math.max(0, u - 0.02), false);
    heading = b < 0.5 ? v.face + wrap(flightHeading(behind, ahead) - v.face) * smooth(b / 0.5) : flightHeading(behind, ahead);
    pitch = -0.18 * (1 - k);
    const glide = smooth((k - 0.55) / 0.1) * (1 - smooth((k - 0.75) / 0.1));
    clips = [['Fly', b % C.Fly, 1 - glide], ['Glide', b % C.Glide, glide]];
    phase = 'out';
  } else return null;
  const flapping = clips.some(([n, , w]) => (n === 'Fly' || n === 'TakeOff') && w > 0.5);
  return { pos, heading, bank, pitch, clips, phase, beak, flapping };
}

/** The seed packet once it has left the beak: it falls, bounces and lies there (until it is picked up). */
export const PACKET = { fall: 0.5, bounce: 0.3, lie: 0.05, inBeak: 0.72, onGround: 1.35 };   // (sizes: small in the beak, big enough to spot on the ground)
/**
 * @param {{x:number,y:number,z:number}} from where it was let go (world), `to` = where it lands (ground)
 * @returns {{pos:number[], spin:number, tilt:number, landed:boolean}}
 */
export function packetPose(from, to, a) {
  if (a < PACKET.fall) {
    const k = a / PACKET.fall;
    return { pos: [lerp(from.x, to.x, k), lerp(from.y, to.y + PACKET.lie, k * k), lerp(from.z, to.z, k)], spin: k * 2.2, tilt: k * 1.2, landed: false };
  }
  const b = a - PACKET.fall;
  const hop = b < PACKET.bounce ? Math.sin((b / PACKET.bounce) * Math.PI) * 0.9 : 0;
  return { pos: [to.x, to.y + PACKET.lie + hop, to.z], spin: 2.2 + Math.min(1, b / PACKET.bounce) * 0.5, tilt: lerp(1.2, Math.PI / 2, smooth(b / PACKET.bounce)), landed: b >= PACKET.bounce };
}

/**
 * @param {{scene:THREE.Scene, url:string, infoUrl?:string, perchUrl:string, renderer:THREE.WebGLRenderer,
 *   perchAt:{x:number,z:number,rot:number}, packets:Object<string,THREE.Object3D>}} o
 *   packets: the seed packet models by fruit id (from garden.glb), each with its hold point `<name>_Hold`
 */
export async function createParrots(o) {
  const loader = new GLTFLoader();
  const [gltf, perchGltf, info] = await Promise.all([loader.loadAsync(o.url), loader.loadAsync(o.perchUrl),
    o.infoUrl ? fetch(o.infoUrl).then((r) => (r.ok ? r.json() : null)).catch(() => null) : null]);
  setParrotInfo(info);
  const env = skyReflections(o.renderer);
  const S = INFO.scale;
  const prep = (root) => root.traverse((m) => {
    if (!m.isMesh) return;
    m.castShadow = true; m.receiveShadow = true;
    m.frustumCulled = !m.isSkinnedMesh;                      // a skinned bird flies far from its bind box
    for (const mat of [].concat(m.material)) { mat.envMap = env; mat.envMapIntensity = 0.45; mat.emissiveIntensity = 0; }
  });
  prep(gltf.scene); prep(perchGltf.scene);

  // the perch, by the garden
  const perch = perchGltf.scene;
  perch.name = 'Perch';
  perch.position.set(o.perchAt.x, 0, o.perchAt.z);
  perch.rotation.y = o.perchAt.rot;
  perch.scale.setScalar(S);
  o.scene.add(perch);
  perch.updateMatrixWorld(true);
  const gripNode = perch.getObjectByName('PerchGrip');
  const gripW = new THREE.Vector3();
  if (gripNode) gripNode.getWorldPosition(gripW); else gripW.set(o.perchAt.x, 0.38 * S, o.perchAt.z);
  const grip = { x: gripW.x, y: gripW.y, z: gripW.z };
  const face = o.perchAt.rot;                                // it sits facing out of the perch's front (+Z)
  // where a dropped packet lands: on the ground in front of the perch
  const dropSpot = { x: o.perchAt.x + Math.sin(face) * 3.6, y: 0, z: o.perchAt.z + Math.cos(face) * 3.6 };

  // the bird (one: a visit at a time)
  const bird = gltf.scene;
  bird.name = 'Parrot';
  bird.scale.setScalar(S);
  bird.visible = false;
  o.scene.add(bird);
  const mixer = new THREE.AnimationMixer(bird);
  const actions = {};
  for (const clip of gltf.animations) {
    const act = mixer.clipAction(clip);
    act.play(); act.setEffectiveWeight(0);
    actions[clip.name] = act;
    if (!INFO.clips[clip.name]) INFO.clips[clip.name] = clip.duration;
  }
  const socket = bird.getObjectByName('SeedSocket');
  // its soft shadow on the ground while it flies (the sun's shadow map only covers the middle of the plate)
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  gr.addColorStop(0, 'rgba(38,32,28,0.42)'); gr.addColorStop(1, 'rgba(38,32,28,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
  shadow.rotation.x = -Math.PI / 2; shadow.renderOrder = 1; shadow.visible = false;
  o.scene.add(shadow);

  // the packets: one in the beak, and those lying on the ground waiting for you
  const packetModel = (id) => {
    const src = o.packets[id];
    const m = src.clone(true);
    const hold = m.getObjectByName(`${src.name}_Hold`);
    m.userData.hold = hold ? hold.position.clone() : new THREE.Vector3(0, 0.025, 0);
    m.traverse((x) => { if (x.isMesh) { x.castShadow = true; x.receiveShadow = true; } });
    m.visible = false;
    o.scene.add(m);
    return m;
  };
  const inBeak = Object.fromEntries(Object.keys(o.packets).map((id) => [id, packetModel(id)]));
  const ground = [];                                          // {id, seed, from, to, at, picked}
  const groundModels = Object.fromEntries(Object.keys(o.packets).map((id) => [id, Array.from({ length: 3 }, () => packetModel(id))]));

  let visit = null, visits = 0, events = [];
  const sock = new THREE.Vector3(), q = new THREE.Quaternion(), e3 = new THREE.Euler(), m4 = new THREE.Matrix4(), tmp = new THREE.Vector3();
  const box = new THREE.Box3(), hitP = new THREE.Vector3();
  const pickBox = new THREE.Box3(new THREE.Vector3(-2.6, -0.5, -2.6), new THREE.Vector3(2.6, 3.6, 2.6));

  function poseBird(p) {
    bird.position.set(p.pos[0], p.pos[1], p.pos[2]);
    e3.set(p.pitch, p.heading, p.bank, 'YXZ');
    bird.quaternion.setFromEuler(e3);
    for (const a of Object.values(actions)) a.setEffectiveWeight(0);
    for (const [name, time, w] of p.clips) {
      const act = actions[name];
      if (!act) continue;
      act.time = Math.max(0, Math.min(time, act.getClip().duration - 1e-4));
      act.setEffectiveWeight(Math.max(0, w));
    }
    mixer.update(0);
    bird.updateMatrixWorld(true);
  }
  function socketWorld(out) {
    if (socket) return socket.getWorldPosition(out);
    return out.set(bird.position.x + Math.sin(bird.rotation.y) * 1.6, bird.position.y + 1.4, bird.position.z + Math.cos(bird.rotation.y) * 1.6);
  }
  /** puts a packet model so its hold point sits at the socket (hanging from the beak) */
  function hang(m) {
    if (socket) {
      socket.updateWorldMatrix(true, false);
      m4.copy(socket.matrixWorld);
      m4.decompose(tmp, q, sock);
      m.quaternion.copy(q);
      m.scale.setScalar(S * PACKET.inBeak);
      m.position.copy(tmp).sub(m.userData.hold.clone().multiplyScalar(S * PACKET.inBeak).applyQuaternion(q));
    } else {
      socketWorld(m.position);
      m.scale.setScalar(S * PACKET.inBeak);
    }
  }

  return {
    perch, grip, dropSpot,
    get visit() { return visit; },
    /** when the bird now visiting sat down on the bar (Infinity: none is there) */
    get perchedAt() { return visit ? perchedAt(visit) : Infinity; },
    bird,
    get count() { return visits; },
    /** a parrot sets off (it reaches the perch FLIGHT.inFor + Land seconds later); false while one is here */
    send(t, seed, from = null) {
      if (visit) return false;
      const n = visits++;
      visit = planVisit({ t, grip, face, seed, id: n, from: from ?? 1.6 + ((n * 2.39996) % 2.4), to: face + 0.9 - ((n * 1.7) % 1.8) });
      events.push({ type: 'parrot-in', t, seed });
      return true;
    },
    /** it is on the perch with a seed for you (and you may ask for it) */
    waiting: (t) => !!visit && visit.giveAt == null && t >= perchedAt(visit),
    /** you came over (or it got tired of waiting): it drops the packet */
    give(t) {
      if (!visit || visit.giveAt != null || t < perchedAt(visit)) return false;
      visit.giveAt = t;
      events.push({ type: 'parrot-drop', t, seed: visit.seed });
      return true;
    },
    /** does this ray hit the bird (when it is on the perch) or a packet on the ground? */
    pick(ray) {
      if (visit && bird.visible && visit.giveAt == null) {
        box.copy(pickBox).applyMatrix4(m4.makeTranslation(grip.x, grip.y, grip.z));
        if (ray.intersectBox(box, hitP)) return { what: 'parrot' };
      }
      for (let i = 0; i < ground.length; i++) {
        const gp = ground[i];
        if (gp.picked != null) continue;
        box.set(tmp.set(gp.to.x - 2.2, -0.5, gp.to.z - 2.2), sock.set(gp.to.x + 2.2, 2.6, gp.to.z + 2.2));
        if (ray.intersectBox(box, hitP)) return { what: 'packet', i };
      }
      return null;
    },
    /** the packets lying on the ground: {i, id, x, z} */
    lying: (t) => ground.map((g, i) => ({ i, id: g.seed, x: g.to.x, z: g.to.z, ready: g.picked == null && t >= g.at + PACKET.fall + PACKET.bounce })).filter((g) => ground[g.i].picked == null),
    /** you pick packet i up at t: its fruit id (null when there is none); it is gone from the ground */
    pickUp(i, t) {
      const g = ground[i];
      if (!g || g.picked != null || t < g.at + PACKET.fall) return null;
      g.picked = t;
      return { id: g.seed, x: g.to.x, y: g.to.y, z: g.to.z };
    },
    /** what the lens keeps sharp */
    subjects() {
      const list = [];
      if (visit && bird.visible) list.push([bird.position.x, bird.position.y + 1, bird.position.z]);
      for (const g of ground) if (g.picked == null) list.push([g.to.x, 0.4, g.to.z]);
      return list;
    },
    reset() { visit = null; visits = 0; ground.length = 0; events = []; },
    busy: () => !!visit || ground.some((g) => g.picked == null),
    /** every frame: draws it all; returns what happened since the last call */
    update(t) {
      const out = events; events = [];
      // the visit
      for (const m of Object.values(inBeak)) m.visible = false;
      const p = visit ? parrotPose(visit, t) : null;
      if (visit && !p && t > visit.t) { out.push({ type: 'parrot-gone', t }); visit = null; }
      bird.visible = !!p;
      shadow.visible = !!p;
      if (p) {
        poseBird(p);
        // its sounds: a squawk as each squawk clip starts, wing beats while it flaps
        const was = visit.last;
        const fly = p.clips.find((c) => c[0] === 'Fly');
        visit.last = { phase: p.phase, squawk: p.clips.find((c) => c[0] === 'Squawk')?.[1] ?? null, fly: fly && fly[2] > 0.5 ? fly[1] : null };
        if (visit.last.squawk != null && (was?.squawk == null || visit.last.squawk < was.squawk)) out.push({ type: 'squawk', t });
        // a wing beat each time the flapping clip comes round (and one big one as it takes off and lands)
        if (visit.last.fly != null && (was?.fly == null || visit.last.fly < was.fly)) out.push({ type: 'flap', t, x: p.pos[0], y: p.pos[1], z: p.pos[2] });
        if (was && was.phase !== p.phase) out.push({ type: `parrot-${p.phase}`, t });
        if (p.beak && inBeak[visit.seed]) { const m = inBeak[visit.seed]; m.visible = true; hang(m); }
        // the moment it lets go: the packet starts its fall from the beak
        const rel = releaseAt(visit);
        if (rel != null && t >= rel && !visit.released) {
          visit.released = true;
          const from = socketWorld(new THREE.Vector3());
          ground.push({ seed: visit.seed, from: { x: from.x, y: from.y, z: from.z }, to: { ...dropSpot, x: dropSpot.x + (ground.length % 3 - 1) * 2.2 }, at: rel, picked: null });
          out.push({ type: 'packet-drop', t: rel });
        }
        const h = Math.max(0, p.pos[1]);
        shadow.position.set(p.pos[0], 0.04, p.pos[2]);
        const sc = 3.4 * (1 + h / 30);
        shadow.scale.set(sc, sc, 1);
        shadow.material.opacity = Math.max(0.15, 1 - h / 50);
      }
      // the packets on the ground
      const used = { pineapple: 0, dragonfruit: 0, mangosteen: 0 };
      for (const list of Object.values(groundModels)) for (const m of list) m.visible = false;
      for (let i = 0; i < ground.length; i++) {
        const g = ground[i];
        if (g.picked != null && t - g.picked > 0.05) continue;
        const m = groundModels[g.seed]?.[used[g.seed]++];
        if (!m) continue;
        const a = t - g.at, pp = packetPose(g.from, g.to, a);
        m.visible = a >= 0;
        m.scale.setScalar(S * lerp(PACKET.inBeak, PACKET.onGround, smooth(a / PACKET.fall)));
        m.position.set(pp.pos[0], pp.pos[1], pp.pos[2]);
        // lying on its back; every few seconds it gives a little "pick me up" hop
        const wait = pp.landed ? a - PACKET.fall - PACKET.bounce : -1;
        const u = wait > 0 ? wait % 3.2 : 9;
        const nudge = u > 2.6 ? Math.sin(((u - 2.6) / 0.6) * Math.PI) : 0;
        m.position.y += nudge * 0.6;
        m.rotation.set(-pp.tilt, face + pp.spin, nudge * 0.25);
        if (!pp.landed && a >= PACKET.fall && !g.thud) { g.thud = true; out.push({ type: 'packet-land', t: g.at + PACKET.fall, x: g.to.x, z: g.to.z }); }
      }
      return out;
    },
  };
}
