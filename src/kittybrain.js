// Day 2: the kitty's behaviour (idea by @lifediamond888). Pure logic, no three.js, so it runs the
// same in the browser, in node tests and in frame-exact recordings.
//
// It is stepped with a fixed dt (STEP). Randomness comes from a seeded generator, so the same seed and
// the same calls at the same times always give the same kitty.
//
// What she does on her own: stands around, wanders to a spot, sometimes sits down for a while.
// call(x, z): she trots to that spot, turns to face whoever called, sits and meows.
// pet():      she sits (if she was up) and purrs with her eyes shut; petting again keeps her purring.
// meow(), walkTo(x, z): used by the scripted recordings.

export const STEP = 1 / 60;

/** Real cat sizes from the Blender build times this scale = metres in the world. */
export const KITTY_SCALE = 14;
const REAL = { walk: 0.3427, trot: 0.9694 };            // m/s at real size: paws stay planted at these
export const KITTY = {
  scale: KITTY_SCALE,
  walkSpeed: REAL.walk * KITTY_SCALE,                    // 4.8 m/s
  trotSpeed: REAL.trot * KITTY_SCALE,                    // 13.6 m/s
  roam: 24,                                              // she wanders within this radius of the centre
  limit: 110,                                            // a call never sends her past this (the plate is 128)
  clips: { Idle: 4, Walk: 0.8, Trot: 0.4667, Sit: 0.9, SitIdle: 4, Purr: 3, Meow: 1.2 },
};

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

/**
 * @param {{seed?:number, x?:number, z?:number, heading?:number, mode?:'sit'|'idle', viewer?:number[]}} [o]
 */
export function createBrain(o = {}) {
  const rand = rng(o.seed ?? 2);
  const b = {
    t: 0,
    x: o.x ?? 0, z: o.z ?? 0, heading: o.heading ?? 0,
    speed: 0,                         // current ground speed (m/s)
    mode: o.mode ?? 'sit',            // sit | sitdown | standup | idle | walk | trot | face | purr | meow
    timer: o.timer ?? (o.mode === 'idle' ? 3 : 7),
    target: null,                     // {x, z} while walking or trotting
    called: false,                    // the current trip is a call (sit and meow on arrival)
    after: null,                      // what to do once sat down: 'purr' | 'meow' | null
    purrUntil: 0,
    viewer: o.viewer ? o.viewer.slice() : [0, 30],
    events: [],                       // {t, type, ...} since the last drain()
    call: null, pet: null,
  };

  const emit = (type, extra = {}) => b.events.push({ t: b.t, type, ...extra });
  const sitting = () => ['sit', 'sitdown', 'purr', 'meow'].includes(b.mode);
  function enter(mode, timer = 0) { b.mode = mode; b.timer = timer; }

  function pickWander() {
    for (let i = 0; i < 20; i++) {
      const a = rand() * TAU, r = Math.sqrt(rand()) * KITTY.roam;
      const x = Math.sin(a) * r, z = Math.cos(a) * r;
      const d = Math.hypot(x - b.x, z - b.z);
      if (d > 8 && d < 26) return { x, z };
    }
    return { x: -b.x * 0.5, z: -b.z * 0.5 };
  }

  b.call = (x, z) => {
    const r = Math.hypot(x, z);
    if (r > KITTY.limit) { x *= KITTY.limit / r; z *= KITTY.limit / r; }
    b.target = { x, z };
    b.called = true;
    b.after = 'meow';
    emit('call', { x, z });
    if (Math.hypot(x - b.x, z - b.z) < 4.5) {          // already here: just turn round and sit
      if (!sitting()) enter('face');
      return;
    }
    if (sitting()) enter('standup', KITTY.clips.Sit / 1.25);
    else { enter('trot'); emit('jingle'); }
  };

  b.pet = () => {
    emit('pet');
    b.target = null;
    b.called = false;
    if (b.mode === 'purr') { b.purrUntil = b.t + 3.6; return; }
    if (b.mode === 'sit' || b.mode === 'meow') { startPurr(); return; }
    b.after = 'purr';
    if (b.mode !== 'sitdown') enter('sitdown', KITTY.clips.Sit);
  };

  /** Scripted (recordings): a meow where she sits, or stand up and sit down again first. */
  b.meow = () => {
    if (b.mode === 'sit' || b.mode === 'purr') { enter('meow', KITTY.clips.Meow); emit('meow'); return; }
    b.after = 'meow';
    if (b.mode !== 'sitdown') enter('sitdown', KITTY.clips.Sit);
  };

  /** Scripted (recordings): a calm walk to a spot. */
  b.walkTo = (x, z) => {
    b.target = { x, z };
    b.called = false;
    if (sitting()) enter('standup', KITTY.clips.Sit / 1.25);
    else enter('walk');
  };

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
    else enter('sit', 5 + rand() * 4);
  }

  function steer(dt, speedMax, turnRate) {
    const dx = b.target.x - b.x, dz = b.target.z - b.z;
    const dist = Math.hypot(dx, dz);
    const want = Math.atan2(dx, dz);
    const diff = wrap(want - b.heading);
    b.heading = wrap(b.heading + clamp(diff, -turnRate * dt, turnRate * dt));
    // slow down to turn: a cat never spins on the spot at full speed
    const align = clamp(Math.cos(diff), 0.2, 1);
    const slow = clamp(dist / (speedMax * 0.55), 0.35, 1);
    const goal = speedMax * align * slow;
    b.speed += (goal - b.speed) * (1 - Math.exp(-dt * 6));
    b.x += Math.sin(b.heading) * b.speed * dt;
    b.z += Math.cos(b.heading) * b.speed * dt;
    return dist;
  }

  b.step = (dt = STEP) => {
    b.t += dt;
    b.timer -= dt;
    switch (b.mode) {
      case 'sit':
        b.speed = 0;
        if (b.timer <= 0) { b.target = pickWander(); b.called = false; enter('standup', KITTY.clips.Sit / 1.25); }
        break;
      case 'sitdown':
        b.speed *= Math.exp(-dt * 10);
        if (b.timer <= 0) settle();
        break;
      case 'standup':
        if (b.timer <= 0) {
          if (b.target) { enter(b.called ? 'trot' : 'walk'); if (b.called) emit('jingle'); }
          else enter('idle', 2 + rand() * 2);
        }
        break;
      case 'idle':
        b.speed *= Math.exp(-dt * 8);
        if (b.timer <= 0) { b.target = pickWander(); b.called = false; enter('walk'); }
        break;
      case 'walk':
      case 'trot': {
        const fast = b.mode === 'trot';
        const dist = steer(dt, fast ? KITTY.trotSpeed : KITTY.walkSpeed, fast ? 3.2 : 2.0);
        if (dist < (fast ? 4.5 : 3.0)) {
          emit('arrive', { called: b.called });
          b.target = null;
          if (b.called) enter('face');
          else if (rand() < 0.45) { b.after = null; enter('sitdown', KITTY.clips.Sit); }
          else enter('idle', 2.5 + rand() * 2.5);
        }
        break;
      }
      case 'face': {                                      // turn to the one who called, then sit
        const want = headingTo(b.x, b.z, b.viewer[0], b.viewer[1]);
        const diff = wrap(want - b.heading);
        b.heading = wrap(b.heading + clamp(diff, -2.4 * dt, 2.4 * dt));
        b.speed = 0;
        if (Math.abs(diff) < 0.12) { b.called = false; enter('sitdown', KITTY.clips.Sit); }
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

  /** Which clip should be showing right now, how fast, and (for one-shots) its own time. */
  b.anim = () => {
    switch (b.mode) {
      case 'walk': return { name: 'Walk', rate: clamp(b.speed / KITTY.walkSpeed, 0.35, 1.4) };
      case 'trot': return { name: 'Trot', rate: clamp(b.speed / KITTY.trotSpeed, 0.45, 1.3) };
      case 'face': return { name: 'Walk', rate: 0.55 };
      case 'sitdown': return { name: 'Sit', rate: 1, once: true };
      case 'standup': return { name: 'Sit', rate: -1.25, once: true };
      case 'sit': return { name: 'SitIdle', rate: 1 };
      case 'purr': return { name: 'Purr', rate: 1 };
      case 'meow': return { name: 'Meow', rate: 1, once: true };
      default: return { name: 'Idle', rate: 1 };
    }
  };

  b.drain = () => { const e = b.events; b.events = []; return e; };
  b.isSitting = sitting;
  return b;
}
