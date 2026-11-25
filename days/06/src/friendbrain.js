// Day 6: the kitty's friend (idea by @2warp-e8u: "Add another cat so the cat has an friend").
// A cream kitten with a brown mask and blue eyes. This is how it behaves: pure logic, no three.js, stepped at a
// fixed rate with a seeded random generator, so it runs the same in the browser, in node tests and in
// frame-exact recordings (the same seed and the same world at the same times always give the same kitten).
//
// The kitten's life is the kitty: it stays close to her, and it is happiest when it is right beside her.
//   - it follows her about (a walk, a trot, a gallop when she has run off far), never into her body;
//   - when she settles, it comes up and rubs its cheek along hers (Nuzzle), touches noses (Boop), asks her to
//     play (PlayBow), hops about for joy (Hop), flops over and paddles the air (Tumble), washes itself;
//   - when she plays with a toy it stays out of her way and watches, hopping and bowing at every swat;
//   - at dinner it eats from the same bowl, from the other side;
//   - when she goes to sleep it curls up beside her, and wakes when she does;
//   - you can pet it (it purrs), and now and then it comes over to you to say hello;
//   - the very first time it is seen, it comes running in from far away to meet her (hello()).
// Everything it does is reported as events (drain()), with who: 'friend', for the sounds and the effects.
//
// What it needs to know each step (`world`, passed to step()):
//   kitty: { x, z, heading, head: [x, y, z], mode, asleep, moving, playing, eating, yarn: {x, z} | null,
//            bowl: {x, z, eatenAt} | null }
//   player: { x, z } | null        bed: { x, z, r, outer, ex, ez } | null
//   keepOut(x, z) -> [x, z]       pushes a spot out of buildings (optional)

export const STEP = 1 / 60;

/**
 * Sizes and speeds at real size, from the Blender build (art/day06/friend_info.json); the game draws the kitten
 * at SCALE like the kitty, so all the distances below are metres in the world.
 */
export const FRIEND = {
  scale: 14,
  real: { walk: 0.3, trot: 0.85, run: 1.5, mouth: 0.15, shoulder: 0.19 },
  clips: { Idle: 4, Walk: 0.8, Trot: 0.4667, Run: 0.4, Sit: 0.9, SitIdle: 4, Purr: 3, Meow: 1.2, Eat: 1.6, Groom: 3,
    Stretch: 2.2, Sleep: 4, Pounce: 1.3, Bat: 0.7, Nuzzle: 2.6, PlayBow: 1.5, Tumble: 3.2, Hop: 0.9, Boop: 1.1 },
  near: 11,          // within this of her it is "with her" and may do as it likes
  follow: 15,        // further than this from her and it sets off after her
  trotFrom: 22, runFrom: 40,
  radius: 1.5,       // its own body, seen from above
};
/** Real-size measurements from the Blender build replace the defaults (art/day06/friend_info.json). */
export function setFriendInfo(info) {
  if (!info) return;
  if (info.speeds) for (const k of ['walk', 'trot', 'run']) if (Number(info.speeds[k]) > 0) FRIEND.real[k] = Number(info.speeds[k]);
  if (Number(info.mouth) > 0) FRIEND.real.mouth = Number(info.mouth);
  if (info.height && Number(info.height.shoulder) > 0) FRIEND.real.shoulder = Number(info.height.shoulder);
  if (info.clips) for (const [k, v] of Object.entries(info.clips)) if (Number(v) > 0) FRIEND.clips[k] = Number(v);
}
const speed = (k) => FRIEND.real[k] * FRIEND.scale;
const mouth = () => FRIEND.real.mouth * FRIEND.scale;

// the kitty's body seen from above: a capsule along her heading (she is about 6 m nose to tail at x14)
const KITTY_BODY = { back: 2.3, front: 2.4, r: 1.25 };
const TAU = Math.PI * 2;
const wrap = (a) => ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const LIMIT = 108;

/** mulberry32 */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// one-shot clips: they play once, start and end standing; how long each one is the clip's own length
const ACTS = { nuzzle: 'Nuzzle', boop: 'Boop', playbow: 'PlayBow', tumble: 'Tumble', hop: 'Hop', meow: 'Meow', stretch: 'Stretch' };
const SETTLED = ['sit', 'idle', 'groom'];
const MOVING = ['walk', 'trot', 'run'];

/**
 * @param {{seed?:number, x?:number, z?:number, heading?:number, mode?:string, timer?:number}} [o]
 */
export function createFriendBrain(o = {}) {
  const rand = rng(o.seed ?? 11);
  const f = {
    t: 0, x: o.x ?? 8, z: o.z ?? 4, heading: o.heading ?? 0, speed: 0,
    mode: o.mode ?? 'sit', timer: o.timer ?? 3,
    target: null, goal: null, fast: 0, close: false,
    face: null,                 // { x, z, then } while turning on the spot
    next: null,                 // what to do once it is up on its feet
    after: null,                // what to do once it has sat down
    purrUntil: 0,
    events: [],
    hello: false,               // on its way to meet her for the first time
    met: o.met ?? true,
    lastSocial: -1e9, lastPlayer: -1e9, lastCheer: -1e9, lastThink: 0,
    pal: null,                  // { x, y, z, until }: where it is looking (her face, while it is with her)
    happy: 0.7,
  };
  const emit = (type, extra = {}) => f.events.push({ t: f.t, type, who: 'friend', ...extra });
  function enter(mode, timer = 0) { f.mode = mode; f.timer = timer; }
  const sitting = () => ['sit', 'sitdown', 'purr', 'groom'].includes(f.mode);
  const lying = () => ['liedown', 'sleep'].includes(f.mode);
  const committed = () => ['nuzzle', 'boop', 'playbow', 'tumble', 'hop', 'meow', 'stretch', 'purr', 'sitdown', 'standup', 'liedown', 'eat', 'face'].includes(f.mode);

  /** go somewhere: from sitting it stands up first, from lying it wakes up first */
  function go(target, goal, { fast = 0, close = false } = {}) {
    f.target = { x: clamp(target.x, -LIMIT, LIMIT), z: clamp(target.z, -LIMIT, LIMIT) };
    f.goal = goal; f.fast = fast; f.close = close;
    if (lying()) { wake(); return; }
    if (f.mode === 'stretch') return;
    if (sitting()) { if (f.mode === 'purr') emit('purr-end'); enter('standup', FRIEND.clips.Sit / 1.3); return; }
    enter(gait());
  }
  function gait() {
    const d = f.target ? Math.hypot(f.target.x - f.x, f.target.z - f.z) : 0;
    if (f.fast >= 2 || d > FRIEND.runFrom) return 'run';
    if (f.fast >= 1 || d > FRIEND.trotFrom) return 'trot';
    return 'walk';
  }
  function wake() {
    f.target = f.target || null;
    enter('stretch', FRIEND.clips.Stretch);
    emit('wake');
    emit('yawn', { delay: 0.6 });
  }
  /** a one-shot (Nuzzle, Boop, ...): standing up first if it is sat down */
  function act(name, faceTo = null) {
    if (faceTo) { f.face = { x: faceTo.x, z: faceTo.z, then: name }; if (!sitting()) { enter('face'); return; } f.next = 'face'; enter('standup', FRIEND.clips.Sit / 1.3); return; }
    if (sitting()) { f.next = name; if (f.mode === 'purr') emit('purr-end'); enter('standup', FRIEND.clips.Sit / 1.3); return; }
    start(name);
  }
  function start(name) {
    f.target = null; f.goal = null; f.speed = 0;
    enter(name, FRIEND.clips[ACTS[name]]);
    if (name === 'nuzzle') emit('nuzzle');
    else if (name === 'boop') emit('boop', { delay: 0.45 });
    else if (name === 'playbow') { emit('playbow'); emit('chirp', { delay: 0.25 }); }
    else if (name === 'tumble') emit('tumble', { delay: 0.35 });
    else if (name === 'hop') { emit('hop'); emit('land', { delay: FRIEND.clips.Hop * 0.62 }); }
    else if (name === 'meow') emit('meow');
  }

  // ---------------------------------------------------------------- where to stand
  const kfwd = (k) => [Math.sin(k.heading), Math.cos(k.heading)];
  const kright = (k) => [Math.cos(k.heading), -Math.sin(k.heading)];
  /** which side of her it is on (+1 her right, -1 her left) */
  const sideOf = (k) => { const [rx, rz] = kright(k); return (f.x - k.x) * rx + (f.z - k.z) * rz >= 0 ? 1 : -1; };
  /** the place to be when it is just with her: beside and a little behind her, on the side it is already on */
  function besideSpot(k, dist = 7.5) {
    const [fx, fz] = kfwd(k), [rx, rz] = kright(k), s = sideOf(k);
    return { x: k.x + rx * s * dist - fx * 1.8, z: k.z + rz * s * dist - fz * 1.8 };
  }
  /** her cheek, and the spot it stands on to rub its own cheek along it */
  function nuzzleSpot(k) {
    const [rx, rz] = kright(k), [fx, fz] = kfwd(k), s = sideOf(k);
    const h = k.head;
    const m = mouth();
    // its nose at her cheek; it stands facing in, a little turned toward her front
    const nx = h[0] + rx * s * 0.75, nz = h[2] + rz * s * 0.75;
    const dx = rx * s * 0.92 + fx * 0.38, dz = rz * s * 0.92 + fz * 0.38, dl = Math.hypot(dx, dz);
    return { x: nx + (dx / dl) * (m + 0.25), z: nz + (dz / dl) * (m + 0.25), lx: h[0], lz: h[2] };
  }
  /** nose to nose: in front of her face, looking back at her */
  function boopSpot(k) {
    const [fx, fz] = kfwd(k);
    const h = k.head, m = mouth();
    const nx = h[0] + fx * 1.1, nz = h[2] + fz * 1.1;
    return { x: nx + fx * (m + 0.15), z: nz + fz * (m + 0.15), lx: h[0], lz: h[2] };
  }
  /** curled up beside her bed (or beside her, wherever she sleeps) */
  function sleepSpot(k, bed) {
    if (bed && Math.hypot(k.x - bed.x, k.z - bed.z) < bed.outer) {
      const s = (f.x - bed.x) * bed.ez - (f.z - bed.z) * bed.ex >= 0 ? 1 : -1;     // the side it is on
      return { x: bed.x + bed.ex * (bed.outer + 2.2) + bed.ez * s * (bed.outer * 0.75), z: bed.z + bed.ez * (bed.outer + 2.2) - bed.ex * s * (bed.outer * 0.75) };
    }
    const [rx, rz] = kright(k), s = sideOf(k);
    return { x: k.x + rx * s * 4.4, z: k.z + rz * s * 4.4 };
  }
  /** at the bowl, on the far side from her */
  function eatSpot(k) {
    const b = k.bowl, dx = b.x - k.x, dz = b.z - k.z, d = Math.hypot(dx, dz) || 1;
    // across the bowl from her, turned a little so the two of them are not nose to nose
    const a = Math.atan2(dx / d, dz / d) + 0.9 * (sideOf(k) || 1);
    const ux = Math.sin(a), uz = Math.cos(a), m = mouth() + 0.7;
    return { x: b.x + ux * m, z: b.z + uz * m, lx: b.x, lz: b.z };
  }
  /** watching her play: out of her way, nearer to where it is now */
  function watchSpot(k) {
    const y = k.yarn || k;
    const dx = f.x - y.x, dz = f.z - y.z, d = Math.hypot(dx, dz) || 1;
    return { x: y.x + (dx / d) * 11, z: y.z + (dz / d) * 11 };
  }

  // ---------------------------------------------------------------- deciding
  /** what it most wants right now, given what she is doing (or null: nothing urgent) */
  function urgent(w) {
    const k = w.kitty;
    if (!k) return null;
    if (f.hello && f.t >= (o.helloDelay ?? 0)) return 'hello';
    if (k.asleep) return 'sleep';
    if (k.bowl && k.bowl.eatenAt == null && (k.eating || Math.hypot(k.bowl.x - k.x, k.bowl.z - k.z) < 9)) return 'eat';
    if (k.playing) return 'watch';
    const d = Math.hypot(k.x - f.x, k.z - f.z);
    if (d > FRIEND.follow || (k.moving && d > FRIEND.near)) return 'follow';
    return null;
  }
  function pursue(want, w) {
    const k = w.kitty;
    switch (want) {
      case 'hello': { const s = boopSpot(k); go(s, 'hello', { fast: 2, close: true }); break; }
      case 'sleep': {
        const s = sleepSpot(k, w.bed);
        if (Math.hypot(s.x - f.x, s.z - f.z) < 2.5) { if (!lying()) lieDown(k); }
        else go(s, 'sleep', { fast: Math.hypot(s.x - f.x, s.z - f.z) > 25 ? 1 : 0 });
        break;
      }
      case 'eat': { const s = eatSpot(k); go(s, 'eat', { fast: 1, close: true }); break; }
      case 'watch': { const s = watchSpot(k); if (Math.hypot(s.x - f.x, s.z - f.z) > 4) go(s, 'watch', { fast: 1 }); break; }
      case 'follow': {
        const s = besideSpot(k), d = Math.hypot(s.x - f.x, s.z - f.z);
        go(s, 'follow', { fast: d > FRIEND.runFrom ? 2 : d > FRIEND.trotFrom || k.moving ? 1 : 0 });
        break;
      }
      default:
    }
  }
  function lieDown(k) {
    f.target = null; f.goal = null;
    if (k) f.heading = wrap(Math.atan2(k.x - f.x, k.z - f.z) + 1.2 * (rand() - 0.5));
    if (sitting()) { enter('liedown', 1.4); emit('sigh'); }
    else { f.after = 'nap'; enter('sitdown', FRIEND.clips.Sit); }
  }
  /** settled beside her with nothing pressing: it chooses */
  function choose(w) {
    const k = w.kitty, p = w.player, sat = f.mode === 'sit';
    const kSettled = k && !k.moving && !k.asleep && !k.playing;
    const pd = p ? Math.hypot(p.x - f.x, p.z - f.z) : Infinity;
    const r = rand();
    if (kSettled && f.t - f.lastSocial > 9 && r < 0.5) {
      f.lastSocial = f.t;
      const s = r < 0.3 ? nuzzleSpot(k) : boopSpot(k);
      go(s, r < 0.3 ? 'nuzzle' : 'boop', { close: true });
      return;
    }
    if (p && pd < 26 && f.t - f.lastPlayer > 35 && r < 0.62) {
      f.lastPlayer = f.t;
      const dx = f.x - p.x, dz = f.z - p.z, d = Math.hypot(dx, dz) || 1;
      go({ x: p.x + (dx / d) * 5.2, z: p.z + (dz / d) * 5.2 }, 'player', { fast: pd > 14 ? 1 : 0 });
      return;
    }
    if (r < 0.7) { act('playbow', k ? { x: k.x, z: k.z } : null); return; }
    if (r < 0.78) { act('hop'); return; }
    if (r < 0.85) { act('tumble'); return; }
    if (r < 0.93) { if (sat) enter('groom', 3 + rand() * 3); else { f.after = 'groom'; enter('sitdown', FRIEND.clips.Sit); } return; }
    if (sat) enter('sit', 3 + rand() * 4); else { enter('sitdown', FRIEND.clips.Sit); }
  }

  /** arrived where it was going */
  function arrive(w) {
    const g = f.goal, k = w.kitty;
    f.target = null; f.goal = null;
    emit('arrive', { goal: g });
    if (g === 'hello' && k) { f.hello = false; f.met = true; f.lastSocial = f.t; f.face = { x: k.head[0], z: k.head[2], then: 'boop' }; enter('face'); emit('friend-hello'); return; }
    if ((g === 'nuzzle' || g === 'boop') && k) { f.face = { x: k.head[0], z: k.head[2], then: g }; enter('face'); return; }
    if (g === 'eat' && k?.bowl) { f.face = { x: k.bowl.x, z: k.bowl.z, then: 'eat' }; enter('face'); return; }
    if (g === 'sleep') { lieDown(k); return; }
    if (g === 'player' && w.player) { f.face = { x: w.player.x, z: w.player.z, then: rand() < 0.5 ? 'playbow' : 'boop' }; enter('face'); emit('trill'); return; }
    if (g === 'watch' && k) { f.face = { x: (k.yarn || k).x, z: (k.yarn || k).z, then: 'idle' }; enter('face'); return; }
    if (k && (g === 'follow' || g == null)) { f.face = { x: k.x, z: k.z, then: rand() < 0.55 ? 'sit' : 'idle' }; enter('face'); return; }
    enter('idle', 1.5);
  }

  // ---------------------------------------------------------------- moving
  function steer(dt, top, turnRate) {
    const dx = f.target.x - f.x, dz = f.target.z - f.z;
    const dist = Math.hypot(dx, dz);
    const diff = wrap(Math.atan2(dx, dz) - f.heading);
    f.heading = wrap(f.heading + clamp(diff, -turnRate * dt, turnRate * dt));
    const align = clamp(Math.cos(diff), 0.15, 1);
    const slow = clamp(dist / (top * 0.6), 0.3, 1);
    f.speed += (top * align * slow - f.speed) * (1 - Math.exp(-dt * 5));
    const s = Math.min(f.speed * dt, dist);
    f.x += Math.sin(f.heading) * s;
    f.z += Math.cos(f.heading) * s;
    return dist;
  }
  function turnTo(x, z, dt, rate = 3.0) {
    const diff = wrap(Math.atan2(x - f.x, z - f.z) - f.heading);
    f.heading = wrap(f.heading + clamp(diff, -rate * dt, rate * dt));
    return Math.abs(diff);
  }
  /** never inside her (or you, or her bed): slide out to the nearest free spot */
  function keepClear(w) {
    const k = w.kitty;
    if (k) {
      const [fx, fz] = kfwd(k);
      const along = clamp((f.x - k.x) * fx + (f.z - k.z) * fz, -KITTY_BODY.back, KITTY_BODY.front);
      const cx = k.x + fx * along, cz = k.z + fz * along;
      const touching = ['nuzzle', 'boop', 'face', 'eat'].includes(f.mode) || f.close;
      const r = KITTY_BODY.r + FRIEND.radius * (touching ? 0.5 : 1.0);
      const dx = f.x - cx, dz = f.z - cz, d = Math.hypot(dx, dz);
      if (d < r) { const ux = d > 1e-3 ? dx / d : Math.cos(k.heading), uz = d > 1e-3 ? dz / d : -Math.sin(k.heading); f.x = cx + ux * r; f.z = cz + uz * r; }
    }
    if (w.player) {
      const r = 1.8 + FRIEND.radius, dx = f.x - w.player.x, dz = f.z - w.player.z, d = Math.hypot(dx, dz);
      if (d < r && d > 1e-3) { f.x = w.player.x + (dx / d) * r; f.z = w.player.z + (dz / d) * r; }
    }
    if (w.bed && f.goal !== 'sleep' && !lying()) {
      const r = w.bed.outer + FRIEND.radius * 0.6, dx = f.x - w.bed.x, dz = f.z - w.bed.z, d = Math.hypot(dx, dz);
      if (d < r && d > 1e-3) { f.x = w.bed.x + (dx / d) * r; f.z = w.bed.z + (dz / d) * r; }
    }
    if (w.keepOut) [f.x, f.z] = w.keepOut(f.x, f.z);
    f.x = clamp(f.x, -LIMIT, LIMIT); f.z = clamp(f.z, -LIMIT, LIMIT);
  }

  // ---------------------------------------------------------------- the player's verbs, and hers
  /** the first meeting: it comes running in to her from wherever it is */
  f.hello = !!o.hello;
  f.meet = () => { f.hello = true; f.met = false; };
  /** you pet it: it sits, turns to you and purrs (a sleeping kitten just stretches and comes to) */
  f.pet = (from) => {
    if (lying()) { wake(); emit('mew'); return false; }
    f.target = null; f.goal = null; f.next = null;
    f.happy = clamp(f.happy + 0.1, 0, 1);
    emit('pet');
    if (from) f.pal = { x: from.x, y: 4.5, z: from.z, until: f.t + 4, you: true };
    if (sitting() && f.mode !== 'sitdown') { startPurr(); return true; }
    f.after = 'purr'; enter('sitdown', FRIEND.clips.Sit);
    return true;
  };
  function startPurr() { enter('purr'); f.purrUntil = f.t + 3.4; emit('purr'); }
  /**
   * Recordings: do this now (the same thing at the same time in every take). With a script it never picks
   * anything of its own accord, so only the script and her (and you) move it.
   */
  f.scripted = !!o.scripted;
  f.doNow = (kind, w, s = {}) => {
    const k = w.kitty;
    if (kind === 'nuzzle' && k) { f.lastSocial = f.t; go(nuzzleSpot(k), 'nuzzle', { close: true }); return; }
    if (kind === 'boop' && k) { f.lastSocial = f.t; go(boopSpot(k), 'boop', { close: true }); return; }
    if (kind === 'pet') { f.pet(w.player); return; }
    if (kind === 'sit') { if (!sitting()) { f.target = null; f.goal = null; enter('sitdown', FRIEND.clips.Sit); } return; }
    if (ACTS[kind]) act(kind, s.face === false || !k ? null : { x: k.x, z: k.z });   // (face: false = where it is already looking)
  };
  /** something she did: it reacts (her swats make it hop or bow; her dinner makes it come running) */
  f.onKitty = (e) => {
    if (e.type === 'swat' && f.t - f.lastCheer > 1.6 && (SETTLED.includes(f.mode) || f.mode === 'face')) {
      f.lastCheer = f.t;
      act(rand() < 0.55 ? 'hop' : 'playbow');
    }
    if (e.type === 'meow' && SETTLED.includes(f.mode) && rand() < 0.35) emit('trill', { delay: 0.5 });
  };

  // ---------------------------------------------------------------- the step
  f.step = (dt, w) => {
    f.t += dt; f.timer -= dt;
    const k = w.kitty;
    // look at her face while it is near her and not on the move (the renderer turns its head)
    if (k && !MOVING.includes(f.mode) && Math.hypot(k.x - f.x, k.z - f.z) < 16 && !(f.pal && f.pal.until > f.t && f.pal.you)) f.pal = { x: k.head[0], y: k.head[1], z: k.head[2], until: f.t + 0.5 };
    // every quarter second (and never in the middle of something), check whether something more pressing came up
    if (!committed() && f.t - f.lastThink >= 0.25) {
      f.lastThink = f.t;
      const want = urgent(w);
      if (want && want !== f.goal && !(want === 'sleep' && lying())) {
        if (want === 'follow' && f.goal && ['nuzzle', 'boop', 'player'].includes(f.goal) && !k.moving) { /* still on its way to her */ }
        else pursue(want, w);
      }
      if (!want && f.goal === 'follow' && k && Math.hypot(k.x - f.x, k.z - f.z) < FRIEND.near * 0.75 && !k.moving) arrive(w);
    }
    // wake when she wakes
    if (lying() && k && !k.asleep) wake();

    switch (f.mode) {
      case 'sit': case 'idle':
        f.speed *= Math.exp(-dt * 8);
        if (f.timer <= 0) { if (urgent(w)) pursue(urgent(w), w); else if (f.scripted) enter(f.mode, 2); else choose(w); }
        break;
      case 'groom':
        if (f.timer <= 0) enter('sit', 2 + rand() * 3);
        break;
      case 'sitdown':
        f.speed *= Math.exp(-dt * 10);
        if (f.timer <= 0) {
          const a = f.after; f.after = null;
          if (a === 'purr') startPurr();
          else if (a === 'nap') { enter('liedown', 1.4); emit('sigh'); }
          else if (a === 'groom') enter('groom', 3 + rand() * 3);
          else enter('sit', 3 + rand() * 4);
        }
        break;
      case 'standup':
        if (f.timer <= 0) {
          const n = f.next; f.next = null;
          if (n === 'face' && f.face) enter('face');
          else if (n && ACTS[n]) start(n);
          else if (f.target) enter(gait());
          else enter('idle', 1 + rand());
        }
        break;
      case 'liedown':
        if (f.timer <= 0) { enter('sleep', 1e9); emit('asleep'); }
        break;
      case 'sleep':
        break;
      case 'stretch':
        if (f.timer <= 0) { if (f.target) enter(gait()); else enter('idle', 1 + rand() * 1.5); }
        break;
      case 'purr':
        if (f.t >= f.purrUntil) { emit('purr-end'); enter('sit', 3 + rand() * 3); }
        break;
      case 'eat':
        if (!k?.bowl || k.bowl.eatenAt != null) { emit('eaten'); f.after = 'groom'; enter('sitdown', FRIEND.clips.Sit); }
        else if (f.timer <= 0) { f.timer = 0.5 + rand() * 0.25; emit('bite'); }
        break;
      case 'face': {
        f.speed = 0;
        const fc = f.face;
        if (!fc) { enter('idle', 1); break; }
        if (turnTo(fc.x, fc.z, dt) < 0.08) {
          f.face = null;
          if (fc.then === 'eat') { enter('eat', 0.4); emit('eat'); }
          else if (ACTS[fc.then]) start(fc.then);
          else if (fc.then === 'sit') enter('sitdown', FRIEND.clips.Sit);
          else enter('idle', 2 + rand() * 2);
        }
        break;
      }
      case 'walk': case 'trot': case 'run': {
        if (!f.target) { enter('idle', 1); break; }
        // the spots that depend on her move with her
        if (k && f.goal === 'hello') { const s = boopSpot(k); f.target.x = s.x; f.target.z = s.z; }
        else if (k && f.goal === 'nuzzle') { const s = nuzzleSpot(k); f.target.x = s.x; f.target.z = s.z; }
        else if (k && f.goal === 'boop') { const s = boopSpot(k); f.target.x = s.x; f.target.z = s.z; }
        else if (k && f.goal === 'eat' && k.bowl) { const s = eatSpot(k); f.target.x = s.x; f.target.z = s.z; }
        else if (k && f.goal === 'follow') { const s = besideSpot(k); f.target.x = s.x; f.target.z = s.z; }
        else if (w.player && f.goal === 'player') { const p = w.player, dx = f.x - p.x, dz = f.z - p.z, d = Math.hypot(dx, dz) || 1; f.target.x = p.x + (dx / d) * 5.2; f.target.z = p.z + (dz / d) * 5.2; }
        // social trips are called off if she gets up and goes
        if (k && ['nuzzle', 'boop'].includes(f.goal) && (k.moving || k.asleep || k.playing)) { f.goal = 'follow'; f.close = false; }
        const left = Math.hypot(f.target.x - f.x, f.target.z - f.z);
        if (f.mode === 'walk' && left > FRIEND.trotFrom) enter('trot');
        else if (f.mode === 'trot' && left > FRIEND.runFrom) enter('run');
        else if (f.mode === 'run' && left < 9) enter('trot');
        else if (f.mode === 'trot' && left < 3.5 && f.fast < 1) enter('walk');
        const top = f.mode === 'run' ? speed('run') : f.mode === 'trot' ? speed('trot') : speed('walk');
        const dist = steer(dt, top, f.mode === 'run' ? 3.0 : f.mode === 'trot' ? 3.6 : 2.6);
        if (dist < (f.close ? 0.35 : f.mode === 'walk' ? 1.6 : 2.6)) arrive(w);
        break;
      }
      default:
        if (ACTS[f.mode]) {
          f.speed = 0;
          if (f.timer <= 0) {
            if (f.mode === 'nuzzle' || f.mode === 'boop') emit('purr-done');
            if (f.scripted || f.mode === 'nuzzle' || f.mode === 'boop' || rand() < 0.5) enter('idle', 1.5 + rand() * 2);
            else { f.after = null; enter('sitdown', FRIEND.clips.Sit); }
          }
        }
    }
    keepClear(w);
    if (f.pal && f.pal.until < f.t) f.pal = null;
  };

  /** Which clip should show right now, how fast, whether it plays once, and the crossfade. */
  f.anim = () => {
    switch (f.mode) {
      case 'walk': return { name: 'Walk', rate: clamp(f.speed / speed('walk'), 0.35, 1.5) };
      case 'trot': return { name: 'Trot', rate: clamp(f.speed / speed('trot'), 0.45, 1.35) };
      case 'run': return { name: 'Run', rate: clamp(f.speed / speed('run'), 0.6, 1.3), fade: 0.25 };
      case 'face': return { name: 'Walk', rate: 0.6 };
      case 'sitdown': return { name: 'Sit', rate: 1, once: true };
      case 'standup': return { name: 'Sit', rate: -1.3, once: true };
      case 'sit': return { name: 'SitIdle', rate: 1 };
      case 'purr': return { name: 'Purr', rate: 1 };
      case 'groom': return { name: 'Groom', rate: 1, fade: 0.4 };
      case 'eat': return { name: 'Eat', rate: 1, fade: 0.35 };
      case 'liedown': case 'sleep': return { name: 'Sleep', rate: 1, fade: 1.2 };
      case 'stretch': return { name: 'Stretch', rate: 1, once: true, fade: 0.5 };
      case 'idle': return { name: 'Idle', rate: 1 };
      default: return ACTS[f.mode] ? { name: ACTS[f.mode], rate: 1, once: true, fade: 0.22 } : { name: 'Idle', rate: 1 };
    }
  };
  f.drain = () => { const e = f.events; f.events = []; return e; };
  f.isAsleep = lying;
  f.busy = () => !['sit', 'idle', 'sleep'].includes(f.mode);
  return f;
}
