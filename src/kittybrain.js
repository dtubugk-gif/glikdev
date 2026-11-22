// Day 2: the kitty's behaviour (idea by @lifediamond888). Pure logic, no three.js, so it runs the
// same in the browser, in node tests and in frame-exact recordings.
//
// It is stepped with a fixed dt (STEP). Randomness comes from a seeded generator, so the same seed and
// the same calls at the same times always give the same kitty.
//
// On her own she sits, washes her face, wanders, stretches, naps, and asks for food when she is hungry.
//   call(x, z)   she trots there (runs, when it is far), turns to whoever called, sits and meows
//   pet()        she purrs with her eyes shut (petting a sleeping kitty wakes her with a stretch first)
//   feed()       a bowl of kibble appears near her; she runs over, eats it all, then washes her face
//                (food already out: the bowl is topped up, and she eats on - or comes back for more)
//   play()       a ball of yarn lands near her: she chases it, pounces, bats it away - three rounds
//                (even at dinner: she leaves the bowl to play, then goes back to finish it)
//   meow(), walkTo(x, z), nap()   used by the scripted recordings
// Everything she does is also reported as events (drain()): sounds, effects and the UI follow them.

export const STEP = 1 / 60;

/** Real cat sizes from the Blender build times this scale = metres in the world. */
export const KITTY_SCALE = 14;
const REAL = { walk: 0.3427, trot: 0.9694, run: 1.6667 }; // m/s at real size: paws stay planted at these
export const KITTY = {
  scale: KITTY_SCALE,
  walkSpeed: REAL.walk * KITTY_SCALE,                    // 4.8 m/s
  trotSpeed: REAL.trot * KITTY_SCALE,                    // 13.6 m/s
  runSpeed: REAL.run * KITTY_SCALE,                      // 23.3 m/s: the gallop
  runFrom: 18,                                           // a trip longer than this (m) is run...
  runTo: 7,                                              // ...and the last stretch trotted again
  roam: 24,                                              // she wanders within this radius of the centre
  limit: 110,                                            // nothing is ever placed past this (the plate is 128)
  mouth: 0.193 * KITTY_SCALE,                            // nose ahead of her centre while eating (Eat clip)
  pounce: 4.8,                                           // metres covered by a pounce
  clips: { Idle: 4, Walk: 0.8, Trot: 0.4667, Run: 0.4, Sit: 0.9, SitIdle: 4, Purr: 3, Meow: 1.2,
    Eat: 1.6, Groom: 3, Stretch: 2.2, Sleep: 4, Pounce: 1.3, Bat: 0.7 },
};
export const EAT = { seconds: 5.4, bite: 1.6 / 3 };      // three bites per Eat loop
export const YARN = { scale: 1.6, radius: 0.034 * KITTY_SCALE * 1.6, decel: 5.5,   // a big, toy-sized ball
  hold: 3.6,          // how high it hangs while you carry it
  gravity: 30,        // thrown: it falls this fast (m/s²)
  bounce: 0.38,       // ...keeps this much of its fall speed on each bounce
  maxThrow: 36,       // the hardest throw (m/s along the ground)
  drag: 0.32 };       // a thrown ball's extra rolling drag (per m/s): it rolls a way, then settles

const TAU = Math.PI * 2;
const wrap = (a) => ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;   // to [-pi, pi)
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** mulberry32: small, fast, seedable. */
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Heading (radians, rotation about +Y) that faces from (x, z) toward (tx, tz). The model faces +Z. */
export const headingTo = (x, z, tx, tz) => Math.atan2(tx - x, tz - z);

const inside = (p) => {
  const r = Math.hypot(p.x, p.z);
  if (r > KITTY.limit) { p.x *= KITTY.limit / r; p.z *= KITTY.limit / r; }
  return p;
};

/**
 * @param {{seed?:number, x?:number, z?:number, heading?:number, mode?:'sit'|'idle'|'sleep', timer?:number,
 *          viewer?:number[], hunger?:number, happy?:number}} [o]
 */
export function createBrain(o = {}) {
  const rand = rng(o.seed ?? 2);
  const b = {
    t: 0,
    x: o.x ?? 0, z: o.z ?? 0, heading: o.heading ?? 0,
    speed: 0,                         // current ground speed (m/s)
    mode: o.mode ?? 'sit',
    timer: o.timer ?? (o.mode === 'idle' ? 3 : o.mode === 'sleep' ? 20 : 7),
    target: null,                     // {x, z} while walking or trotting
    goal: null,                       // what the trip is for: 'call' | 'eat' | 'yarn' | null (a stroll)
    fast: false,
    face: null,                       // {x, z, then} while turning on the spot
    after: null,                      // what to do once sat down: 'purr' | 'meow' | 'groom' | null
    purrUntil: 0,
    viewer: o.viewer ? o.viewer.slice() : [0, 30],
    hunger: o.hunger ?? 0.2,          // 0 full .. 1 starving
    happy: o.happy ?? 0.6,            // 0 .. 1
    energy: 1,                        // play tires her out; a nap fills it back up
    bowl: null,                       // {x, z, t, left, bites, eatenAt}
    eatStart: 0,                      // when she started on the bowl (bites are counted from here)
    yarn: null,                       // {x, y, z, vx, vz, spin, ax, az, rounds, flying}
    batted: false,
    events: [],
    nextMew: 25,
  };

  const emit = (type, extra = {}) => b.events.push({ t: b.t, type, ...extra });
  const SITTING = ['sit', 'sitdown', 'purr', 'meow', 'groom'];
  const sitting = () => SITTING.includes(b.mode);
  const lying = () => ['liedown', 'sleep'].includes(b.mode);
  function enter(mode, timer = 0) { b.mode = mode; b.timer = timer; }
  const fwd = () => [Math.sin(b.heading), Math.cos(b.heading)];
  const cheer = (d) => { b.happy = clamp(b.happy + d, 0, 1); };

  function pickWander() {
    for (let i = 0; i < 20; i++) {
      const a = rand() * TAU, r = Math.sqrt(rand()) * KITTY.roam;
      const x = Math.sin(a) * r, z = Math.cos(a) * r;
      const d = Math.hypot(x - b.x, z - b.z);
      if (d > 8 && d < 26) return { x, z };
    }
    return { x: -b.x * 0.5, z: -b.z * 0.5 };
  }

  /** Go somewhere: from sitting she stands up first, from lying she wakes up first. */
  function go(target, goal, fast) {
    b.target = inside(target);
    b.goal = goal;
    b.fast = fast;
    if (lying()) { wake(null); return; }
    if (b.mode === 'stretch') return;                    // she sets off when the stretch is done
    if (sitting()) { enter('standup', KITTY.clips.Sit / 1.25); return; }
    enter(gait());
    if (fast) emit('jingle');
  }

  /** How she sets off: a walk for a stroll; in a hurry a trot, or a run when it is far. */
  function gait() {
    if (!b.fast) return 'walk';
    const d = b.target ? Math.hypot(b.target.x - b.x, b.target.z - b.z) : 0;
    return d > KITTY.runFrom ? 'run' : 'trot';
  }

  function wake(after) {                                 // a nap ends with a big stretch
    b.after = after;
    enter('stretch', KITTY.clips.Stretch);
    emit('wake');
    emit('yawn', { delay: 0.75 });
  }

  // ---------------------------------------------------------------- the player's verbs
  b.call = (x, z) => {
    const p = inside({ x, z });
    emit('call', p);
    emit('trill');
    b.after = 'meow';
    if (Math.hypot(p.x - b.x, p.z - b.z) < 4.5) {      // already here: just turn round and sit
      b.target = null; b.goal = null;
      if (lying()) { wake('meow'); return; }
      if (!sitting()) { b.face = { x: b.viewer[0], z: b.viewer[1], then: 'sit' }; enter('face'); }
      return;
    }
    go(p, 'call', true);
  };

  b.pet = () => {
    emit('pet');
    cheer(0.06);
    if (lying()) { b.target = null; b.goal = null; wake('purr'); return; }
    if (['eat', 'pounce', 'bat'].includes(b.mode)) { b.after = b.after || 'purr'; return; }   // she finishes that first
    b.target = null;
    b.goal = null;
    if (b.mode === 'purr') { b.purrUntil = b.t + 3.6; return; }
    emit('trill');
    if (b.mode === 'sit' || b.mode === 'meow' || b.mode === 'groom') { startPurr(); return; }
    b.after = 'purr';
    if (b.mode === 'stretch') return;
    if (b.mode !== 'sitdown') enter('sitdown', KITTY.clips.Sit);
  };

  // across the view, so she stays in the picture: the side of her away from the plate's edge
  function besideHer(dist, towardViewer) {
    const vx = b.viewer[0] - b.x, vz = b.viewer[1] - b.z;
    const d = Math.hypot(vx, vz) || 1;
    const ux = vx / d, uz = vz / d;
    let sx = -uz, sz = ux;                                // across the line of sight
    if (sx * b.x + sz * b.z > 0) { sx = -sx; sz = -sz; }  // pick the side nearer the middle
    if (Math.abs(sx * b.x + sz * b.z) < 4 && rand() < 0.5) { sx = -sx; sz = -sz; }
    return inside({ x: b.x + sx * dist + ux * towardViewer, z: b.z + sz * dist + uz * towardViewer });
  }

  b.feed = () => {
    if (b.yarn) b.yarn.rounds = 3;                       // food beats play
    emit('chirp');
    if (b.bowl) {                                        // food is already out: top the bowl up
      b.bowl.left = 3;
      b.bowl.eatenAt = null;
      emit('refill', { x: b.bowl.x, z: b.bowl.z });
      if (b.mode === 'eat') { b.timer = EAT.seconds; b.eatStart = b.t; b.bowl.bites = 0; return; }   // she eats on
      if (b.goal === 'eat' || b.face?.then === 'eat') return;      // already on her way
      b.after = null;
      goEat();
      return;
    }
    const bowl = besideHer(10, 3);
    b.bowl = { ...bowl, t: b.t, left: 3, bites: 0, eatenAt: null };
    emit('bowl', { x: bowl.x, z: bowl.z });
    b.after = null;
    goEat();
  };

  /** Off to the bowl, to stand with her mouth over it. */
  function goEat() {
    const bowl = b.bowl, dx = b.x - bowl.x, dz = b.z - bowl.z, dd = Math.hypot(dx, dz) || 1;
    go({ x: bowl.x + (dx / dd) * KITTY.mouth, z: bowl.z + (dz / dd) * KITTY.mouth }, 'eat', true);
  }

  /** Food left in the bowl? (she comes back to it after a game) */
  const foodLeft = () => !!(b.bowl && b.bowl.eatenAt == null && b.bowl.left > 0);

  /** A game is over: back to the food if there is some, otherwise a wash. */
  function playOver() {
    if (foodLeft()) { b.after = null; goEat(); return; }
    b.after = b.after || 'groom';
    enter('sitdown', KITTY.clips.Sit);
  }

  b.play = () => {
    if (b.yarn?.held) return;                            // it is in your hand
    if (b.yarn && b.yarn.flying === 0) {                 // it is already on the floor: game on again
      b.yarn.rounds = 0;
      emit('chirp');
      if (['pounce', 'bat', 'face'].includes(b.mode)) return;     // mid-game already: she just plays on
      if (lying()) { b.after = null; wake(null); }
      chaseYarn();
      return;
    }
    // the yarn is tossed in from your side and lands beside her, then rolls on
    const land = besideHer(8, 3);
    const from = { x: (b.viewer[0] + land.x) / 2, z: (b.viewer[1] + land.z) / 2 };
    const ux = land.x - from.x, uz = land.z - from.z, ud = Math.hypot(ux, uz) || 1;
    b.yarn = { x: from.x, y: 9, z: from.z, from, land, flying: 0.75, vx: (ux / ud) * 7, vz: (uz / ud) * 7,
      spin: 0, ax: 1, az: 0, rounds: 0, rim: KITTY.roam + 8 };
    emit('yarn', { x: land.x, z: land.z });
  };

  // You can pick the yarn up, carry it about and throw it anywhere on the plate (main.js drags it).
  // While you hold it she stops and watches; the moment it leaves your hand she is after it.
  b.grabYarn = () => {
    const y = b.yarn;
    if (!y) return false;
    Object.assign(y, { held: true, air: false, flying: 0, vx: 0, vz: 0, vy: 0, hx: y.x, hz: y.z });
    if (b.goal === 'yarn') { b.target = null; b.goal = null; b.speed = 0; enter('idle', 30); }
    if (b.mode === 'face' && b.face?.then === 'pounce') { b.face = null; enter('idle', 30); }
    emit('grab', { x: y.x, z: y.z });
    return true;
  };
  b.holdYarn = (x, z) => {
    const y = b.yarn;
    if (!y?.held) return;
    const p = inside({ x, z });
    y.hx = p.x; y.hz = p.z;
  };
  b.throwYarn = (vx, vz, vy) => {
    const y = b.yarn;
    if (!y?.held) return;
    const sp = Math.hypot(vx, vz), k = sp > YARN.maxThrow ? YARN.maxThrow / sp : 1;
    Object.assign(y, { held: false, air: true, vx: vx * k, vz: vz * k, vy, rounds: 0, rim: KITTY.limit, drag: YARN.drag });
    emit('toss', { speed: sp * k });
    emit('chirp');
    chaseYarn();
  };

  b.meow = () => {
    if (b.mode === 'sit' || b.mode === 'purr' || b.mode === 'groom') { enter('meow', KITTY.clips.Meow); emit('meow'); return; }
    b.after = 'meow';
    if (b.mode !== 'sitdown') enter('sitdown', KITTY.clips.Sit);
  };

  b.walkTo = (x, z) => go({ x, z }, null, false);
  b.nap = () => { if (sitting()) { enter('liedown', 1.4); emit('sigh'); } };

  // ---------------------------------------------------------------- inner workings
  function startPurr() {
    enter('purr');
    b.purrUntil = b.t + 3.6;
    emit('purr');
  }

  function settle() {                                    // just sat down: what next?
    const a = b.after;
    b.after = null;
    if (a === 'purr') startPurr();
    else if (a === 'meow') { enter('meow', KITTY.clips.Meow); emit('meow'); }
    else if (a === 'groom') enter('groom', 4.5 + rand() * 2);
    else enter('sit', 5 + rand() * 4);
  }

  function steer(dt, speedMax, turnRate) {
    const dx = b.target.x - b.x, dz = b.target.z - b.z;
    const dist = Math.hypot(dx, dz);
    const want = Math.atan2(dx, dz);
    const diff = wrap(want - b.heading);
    b.heading = wrap(b.heading + clamp(diff, -turnRate * dt, turnRate * dt));
    const align = clamp(Math.cos(diff), 0.2, 1);       // slow down to turn: never a spin at full speed
    const slow = clamp(dist / (speedMax * 0.55), 0.35, 1);
    const goal = speedMax * align * slow;
    b.speed += (goal - b.speed) * (1 - Math.exp(-dt * 6));
    const stepLen = Math.min(b.speed * dt, dist);         // never overshoot the spot
    b.x += Math.sin(b.heading) * stepLen;
    b.z += Math.cos(b.heading) * stepLen;
    return dist;
  }

  function turnTo(x, z, dt, rate = 2.4) {
    const diff = wrap(headingTo(b.x, b.z, x, z) - b.heading);
    b.heading = wrap(b.heading + clamp(diff, -rate * dt, rate * dt));
    return Math.abs(diff);
  }

  function arrive() {
    emit('arrive', { goal: b.goal });
    b.target = null;
    const g = b.goal;
    b.goal = null;
    if (g === 'call') { b.face = { x: b.viewer[0], z: b.viewer[1], then: 'sit' }; enter('face'); return; }
    if (g === 'eat' && b.bowl) { b.face = { x: b.bowl.x, z: b.bowl.z, then: 'eat' }; enter('face'); return; }
    if (g === 'yarn' && b.yarn) { b.face = { x: b.yarn.x, z: b.yarn.z, then: 'pounce' }; enter('face'); return; }
    if (b.after) { enter('sitdown', KITTY.clips.Sit); return; }
    if (rand() < 0.45) enter('sitdown', KITTY.clips.Sit);
    else enter('idle', 2.5 + rand() * 2.5);
  }

  const standOff = () => KITTY.pounce + 3.0;             // pounce from here: she lands just short of it

  function chaseYarn() {
    const y = b.yarn;
    const dx = b.x - y.x, dz = b.z - y.z, d = Math.hypot(dx, dz) || 1;
    if (d < standOff() + 1.5 && Math.hypot(y.vx, y.vz) < 0.5) {
      b.target = null; b.goal = null; b.face = { x: y.x, z: y.z, then: 'pounce' }; enter('face'); return;
    }
    go({ x: y.x + (dx / d) * standOff(), z: y.z + (dz / d) * standOff() }, 'yarn', true);
  }

  function stepYarn(dt) {
    const y = b.yarn;
    if (!y) return;
    if (y.held) {                                        // in your hand: it follows it, lifted off the floor
      const k = 1 - Math.exp(-dt * 22);
      const dx = (y.hx - y.x) * k, dz = (y.hz - y.z) * k;
      y.x += dx; y.z += dz;
      y.y += (YARN.radius + YARN.hold - y.y) * (1 - Math.exp(-dt * 12));
      const d = Math.hypot(dx, dz);
      if (d > 1e-4) { y.ax = dz / d; y.az = -dx / d; y.spin += d / YARN.radius * 0.5; }
      return;
    }
    if (y.air) {                                         // thrown: it flies, falls, and bounces
      y.vy -= YARN.gravity * dt;
      y.x += y.vx * dt; y.z += y.vz * dt; y.y += y.vy * dt;
      const v = Math.hypot(y.vx, y.vz);
      if (v > 1e-3) { y.ax = y.vz / v; y.az = -y.vx / v; y.spin += (v * dt) / YARN.radius; }
      rim(y);
      if (y.y <= YARN.radius) {
        y.y = YARN.radius;
        const hit = -y.vy;
        if (hit > 5) {                                   // a bounce: loses height and a little speed
          y.vy = hit * (b.toyBounce ?? YARN.bounce);       // Day 3: each toy has its own bounce
          y.vx *= 0.82; y.vz *= 0.82;
          emit('thud', { x: y.x, z: y.z, soft: hit < 12 });
        } else {                                         // down: rolling from here
          y.vy = 0; y.air = false;
          if (hit > 2) emit('thud', { x: y.x, z: y.z, soft: true });
          const busy = ['pounce', 'bat', 'face'].includes(b.mode) || b.goal === 'yarn';
          if (!busy) { emit('chirp'); chaseYarn(); }
        }
      }
      return;
    }
    if (y.flying > 0) {                                  // the toss: an arc onto the floor
      y.flying = Math.max(0, y.flying - dt);
      const k = 1 - y.flying / 0.75;
      y.x = y.from.x + (y.land.x - y.from.x) * k;
      y.z = y.from.z + (y.land.z - y.from.z) * k;
      y.y = YARN.radius + 9 * (1 - k) * (1 - k) + 4 * k * (1 - k);
      y.spin += dt * 9;
      if (y.flying === 0) {
        y.y = YARN.radius;
        emit('thud', { x: y.x, z: y.z });
        if (y.rounds < 3) { emit('chirp'); chaseYarn(); }           // a toss at dinner: the food can wait
      }
      return;
    }
    const v = Math.hypot(y.vx, y.vz);
    if (v > 0) {
      const nv = Math.max(0, v - (YARN.decel + (y.drag || 0) * v) * dt);
      y.ax = y.vz / v; y.az = -y.vx / v;
      y.vx *= nv / v; y.vz *= nv / v;
      y.x += y.vx * dt; y.z += y.vz * dt;
      rim(y);
      y.spin += (nv * dt) / YARN.radius;                 // rolling: angle = distance / radius
    }
  }

  // the play area: it bounces back in at the rim (her own game stays near the middle; a throw can
  // reach almost to the plate's edge)
  function rim(y) {
    const r = Math.hypot(y.x, y.z), R = y.rim ?? KITTY.roam + 8;
    if (r > R && (y.x * y.vx + y.z * y.vz) > 0) {
      const nx = y.x / r, nz = y.z / r, dot = y.vx * nx + y.vz * nz;
      y.vx = (y.vx - 2 * dot * nx) * 0.6; y.vz = (y.vz - 2 * dot * nz) * 0.6;
    }
  }

  function stepNeeds(dt) {
    b.hunger = clamp(b.hunger + dt / 240, 0, 1);         // hungry again after about 4 minutes
    b.happy = clamp(b.happy - dt / 900 - (b.hunger > 0.8 ? dt / 600 : 0), 0, 1);
    if (b.hunger > 0.7 && b.t > b.nextMew && (b.mode === 'sit' || b.mode === 'idle') && !b.bowl) {
      b.nextMew = b.t + 18 + rand() * 12;
      emit('mew', { hungry: true });
      if (b.mode === 'sit') enter('meow', KITTY.clips.Meow);
    }
  }

  function setOff() {                                    // after standing up or a stretch
    if (b.target) { enter(gait()); if (b.fast) emit('jingle'); return true; }
    return false;
  }

  b.step = (dt = STEP) => {
    b.t += dt;
    b.timer -= dt;
    stepNeeds(dt);
    stepYarn(dt);
    if (b.bowl && b.bowl.eatenAt != null && b.t - b.bowl.eatenAt > 2.2) { b.bowl = null; emit('bowl-gone'); }
    switch (b.mode) {
      case 'sit':
        b.speed = 0;
        if (b.timer <= 0) {
          const r = rand();
          if (r < 0.3) { enter('groom', 4 + rand() * 3); break; }
          if (r < 0.3 + (b.energy < 0.5 ? 0.5 : 0.14)) { enter('liedown', 1.4); emit('sigh'); break; }
          b.target = pickWander(); b.goal = null; b.fast = false;
          enter('standup', KITTY.clips.Sit / 1.25);
        }
        break;
      case 'groom':
        if (b.timer <= 0) enter('sit', 3 + rand() * 3);
        break;
      case 'sitdown':
        b.speed *= Math.exp(-dt * 10);
        if (b.timer <= 0) settle();
        break;
      case 'standup':
        if (b.timer <= 0 && !setOff()) enter('idle', 2 + rand() * 2);
        break;
      case 'liedown':
        if (b.timer <= 0) { enter('sleep', 14 + rand() * 10); emit('asleep'); }
        break;
      case 'sleep':
        b.energy = clamp(b.energy + dt / 15, 0, 1);
        if (b.timer <= 0) wake(null);
        break;
      case 'stretch':
        if (b.timer <= 0 && !setOff()) {
          if (b.after) enter('sitdown', KITTY.clips.Sit);
          else enter('idle', 1.5 + rand() * 2);
        }
        break;
      case 'idle':
        b.speed *= Math.exp(-dt * 8);
        if (b.timer <= 0) {
          if (rand() < 0.25) { enter('stretch', KITTY.clips.Stretch); emit('yawn', { delay: 0.75 }); break; }
          b.target = pickWander(); b.goal = null; b.fast = false; enter('walk');
        }
        break;
      case 'walk':
      case 'trot':
      case 'run': {
        if (b.goal === 'yarn' && b.yarn && b.yarn.flying === 0) {   // keep after it while it rolls
          const y = b.yarn, dx = b.x - y.x, dz = b.z - y.z, d = Math.hypot(dx, dz) || 1;
          b.target = { x: y.x + (dx / d) * standOff(), z: y.z + (dz / d) * standOff() };
        }
        // in a hurry: a long way to go turns the trot into a run; near the end she trots again
        const left = Math.hypot(b.target.x - b.x, b.target.z - b.z);
        if (b.mode === 'trot' && left > KITTY.runFrom) { enter('run'); emit('jingle'); }
        else if (b.mode === 'run' && left < KITTY.runTo) enter('trot');
        const fast = b.mode !== 'walk';
        const exact = b.goal === 'eat' || b.goal === 'yarn';
        const top = b.mode === 'run' ? KITTY.runSpeed : fast ? KITTY.trotSpeed : KITTY.walkSpeed;
        const dist = steer(dt, top, b.mode === 'run' ? 2.6 : fast ? 3.2 : 2.0);
        if (dist < (exact ? 0.5 : fast ? 4.5 : 3.0)) arrive();
        break;
      }
      case 'face': {
        b.speed = 0;
        const f = b.face;
        if (f.then === 'pounce' && b.yarn) { f.x = b.yarn.x; f.z = b.yarn.z; }
        if (turnTo(f.x, f.z, dt) < 0.1) {
          b.face = null;
          if (f.then === 'eat' && b.bowl) {
            enter('eat', EAT.seconds * Math.max(1, b.bowl.left) / 3);   // as long as the food left lasts
            b.eatStart = b.t; b.bowl.bites = 0; emit('eat');
          }
          else if (f.then === 'pounce') { enter('pounce', KITTY.clips.Pounce); emit('wiggle'); }
          else enter('sitdown', KITTY.clips.Sit);
        }
        break;
      }
      case 'eat': {
        const e = b.t - b.eatStart;                       // seconds eating
        const bites = Math.floor((e - 0.15) / EAT.bite) + 1;
        if (e > 0.15 && bites > b.bowl.bites) { b.bowl.bites = bites; emit('bite'); }
        const left = Math.max(0, Math.min(3, Math.ceil(b.timer / (EAT.seconds / 3) - 1e-6)));
        if (left < b.bowl.left) { b.bowl.left = left; emit('kibble', { left }); }
        if (b.timer <= 0) {
          b.bowl.left = 0; b.bowl.eatenAt = b.t;
          b.hunger = 0; cheer(0.25);
          emit('eaten'); emit('trill');
          b.after = b.after === 'purr' ? 'purr' : 'groom';
          enter('sitdown', KITTY.clips.Sit);
        }
        break;
      }
      case 'pounce': {
        const u = KITTY.clips.Pounce - b.timer;           // seconds into the pounce
        const j0 = 0.55 * KITTY.clips.Pounce, j1 = 0.86 * KITTY.clips.Pounce;
        if (u >= j0 && u - dt < j0) emit('leap');
        if (u > j0 && u < j1) {
          const v = KITTY.pounce / (j1 - j0);
          b.x += Math.sin(b.heading) * v * dt; b.z += Math.cos(b.heading) * v * dt;
        }
        if (u >= j1 && u - dt < j1) emit('land');
        if (b.timer <= 0) {
          const y = b.yarn;
          const [fx, fz] = fwd();
          const near = y && !y.air && Math.hypot(y.x - (b.x + fx * KITTY.mouth), y.z - (b.z + fz * KITTY.mouth)) < 4.5;
          if (y?.held) enter('idle', 30);                  // you picked it up mid-leap: she waits for the throw
          else if (near) { enter('bat', KITTY.clips.Bat); b.batted = false; }
          else if (y && y.rounds < 3) chaseYarn();
          else playOver();
        }
        break;
      }
      case 'bat': {
        const y = b.yarn;
        if (!b.batted && KITTY.clips.Bat - b.timer > 0.2 && y && !y.held && !y.air) {
          b.batted = true;
          y.rounds += 1;
          y.drag = 0;                                       // her own swats roll on as they always did
          cheer(0.08);
          b.energy = clamp(b.energy - 0.22, 0, 1);
          const toMiddle = Math.atan2(-y.x, -y.z);          // batted along her way, bent toward the middle
          const ahead = b.heading + (rand() - 0.5) * 1.6;
          const w = Math.min(0.6, Math.hypot(y.x, y.z) / 50);
          const a = Math.atan2(Math.sin(ahead) * (1 - w) + Math.sin(toMiddle) * w, Math.cos(ahead) * (1 - w) + Math.cos(toMiddle) * w);
          const sp = y.rounds < 3 ? 8 + rand() * 3 : 5;
          y.vx = Math.sin(a) * sp; y.vz = Math.cos(a) * sp;
          emit('swat', { round: y.rounds });
          emit(y.rounds < 3 ? 'chirp' : 'trill');
        }
        if (b.timer <= 0) {
          if (y?.held) enter('idle', 30);
          else if (y && y.rounds < 3) chaseYarn();
          else playOver();
        }
        break;
      }
      case 'purr':
        if (b.t >= b.purrUntil) { emit('purr-end'); enter('sit', 4 + rand() * 3); }
        break;
      case 'meow':
        if (b.timer <= 0) enter('sit', 4 + rand() * 4);
        break;
      default:
        enter('idle', 2);
    }
  };

  /** Which clip should be showing right now, how fast, whether it plays once, and the crossfade. */
  b.anim = () => {
    switch (b.mode) {
      case 'walk': return { name: 'Walk', rate: clamp(b.speed / KITTY.walkSpeed, 0.35, 1.4) };
      case 'trot': return { name: 'Trot', rate: clamp(b.speed / KITTY.trotSpeed, 0.45, 1.3) };
      case 'run': return { name: 'Run', rate: clamp(b.speed / KITTY.runSpeed, 0.6, 1.25), fade: 0.3 };
      case 'face': return { name: 'Walk', rate: 0.55 };
      case 'sitdown': return { name: 'Sit', rate: 1, once: true };
      case 'standup': return { name: 'Sit', rate: -1.25, once: true };
      case 'sit': return { name: 'SitIdle', rate: 1 };
      case 'purr': return { name: 'Purr', rate: 1 };
      case 'meow': return { name: 'Meow', rate: 1, once: true };
      case 'groom': return { name: 'Groom', rate: 1, fade: 0.45 };
      case 'eat': return { name: 'Eat', rate: 1, fade: 0.35 };
      case 'liedown':
      case 'sleep': return { name: 'Sleep', rate: 1, fade: 1.3 };
      case 'stretch': return { name: 'Stretch', rate: 1, once: true, fade: 0.6 };
      case 'pounce': return { name: 'Pounce', rate: 1, once: true, fade: 0.2 };
      case 'bat': return { name: 'Bat', rate: 1, once: true, fade: 0.15 };
      default: return { name: 'Idle', rate: 1 };
    }
  };

  b.drain = () => { const e = b.events; b.events = []; return e; };
  b.isSitting = sitting;
  b.isAsleep = lying;
  return b;
}
