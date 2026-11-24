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
//
// Day 3: give her a mind (createBrain({ mind: createMind() }), see kittymind.js) and she decides for herself:
// each of the verbs above is then a request she may turn down (a 'decide' event says what she made of it, a
// 'refuse' event that she said no), and between requests she chooses what to do from what she feels, who she
// is and her habits: she naps in her own spot, goes to the bowl when she is hungry, comes over to ask for a
// cuddle or a game ('ask'), follows you about. She has feelings too ('feel' says when they change): she sleeps
// when she has had enough of the day, and if you get her up before she has slept enough ('woken') she is cross
// about it: a grumble, her nose turned away, and when she is furious she stalks off.
// Without a mind she behaves exactly as she did on Day 2.

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
// Day 4 (idea by @Darkbacon155): the fish on a stick. You hold the stick; the fish is on a line from its tip.
export const WAND = { rest: 3.1,   // the line when the fish just hangs from the tip (m, tip to the middle of the fish)
  max: 17,            // the most line there is
  reel: 15,           // how fast the line comes back in (m/s)
  castMin: 5.5, castMax: 14,   // how near and how far a cast lands (m along the ground from the tip)
  near: 7,            // a cast "to her" lands this far in front of her
  trail: 10.5,        // the least line once the fish is out: walk off and it trails this far behind the tip
  wait: 2.4,          // the game is over: this long, then the fish is reeled in
  lost: 6,            // nobody is playing with it: this long, then it is reeled in
  tease: 7.5 };        // she is this near the hanging fish: Play dangles it in front of her instead of casting it

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
 *          viewer?:number[], hunger?:number, happy?:number, mind?:object}} [o]
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
    energy: o.energy ?? 1,            // play tires her out; a nap fills it back up
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

  // ---------------------------------------------------------------- her mind (Day 3): wants, moods, habits
  // Without one (o.mind missing: the recordings and the old tests) she does whatever she is asked, as before.
  const mind = o.mind || null;
  b.mind = mind;
  b.friend = null;                    // [x, z] where you are standing, when you are in the world
  b.asking = null;                    // { what: 'cuddle' | 'play', until } while she is asking you for something
  b.snub = 0;                         // she said no: until this time her nose is turned away
  b.ateAt = -1e9;
  b.solo = false;                     // the game going on is her own idea (nobody threw anything)
  b.feeling = null;                   // how she feels (an id from kittymind's EMOTIONS); 'feel' events say when it changes
  b.feelAt = 0;
  b.stormed = false;                  // furious, and already stalked off for it
  b.bed = null;                       // her bed: { x, z, r (cushion), outer, h (cushion height), ex, ez (unit vector out of its front) }
  b.bedAt = 0;                        // not before this time does she set off for bed again
  const playing = () => !!b.yarn && (b.goal === 'yarn' || ['pounce', 'bat'].includes(b.mode) || ['pounce', 'swipe'].includes(b.face?.then));
  const toyDown = () => !!(b.yarn && !b.yarn.held && !b.yarn.air && !b.yarn.reel && b.yarn.flying === 0);
  const friendSpot = () => b.friend || [b.x + (b.viewer[0] - b.x) * 0.4, b.z + (b.viewer[1] - b.z) * 0.4];
  /** What she senses this instant: all her mind gets to go on. */
  function sense() {
    const f = friendSpot();
    return { t: b.t, hunger: b.hunger, energy: b.energy, happy: b.happy, mode: b.mode, asleep: lying(), playing: playing(),
      moving: ['walk', 'trot', 'run'].includes(b.mode), food: foodLeft(), ateAgo: b.t - b.ateAt, toy: toyDown(),
      bedtime: ['bed', 'bedin', 'bedside', 'spot'].includes(b.goal) || b.face?.then === 'nap' || b.after === 'nap',
      asking: b.asking ? b.asking.what : null, friend: true, friendDist: Math.hypot(f[0] - b.x, f[1] - b.z) };
  }
  b.sense = sense;
  const YES = { yes: true, mood: 'ok', want: 1, why: null };
  /** Ask her mind. `quiet`: nobody asked her out loud (she was only expected to tag along), so a no is not a snub. */
  function wants(verb, quiet) {
    if (!mind) return YES;
    const d = mind.decide(verb, sense());
    emit('decide', { verb, yes: d.yes, mood: d.mood, why: d.why, want: d.want, quiet: !!quiet });
    if (!d.yes && !quiet) { b.snub = b.t + 2.4; cheer(-0.01); emit('refuse', { verb, why: d.why }); }
    return d;
  }
  /** She came to ask for something and you did it. */
  function answered() {
    mind.outcome('answered');
    cheer(0.08);
    emit('answered', { what: b.asking.what });
    b.asking = null;
  }
  /** She was asking for something and is now off doing something else: the asking is over (no hard feelings). */
  function dropAsk() {
    if (!b.asking) return;
    emit('ask-end', { what: b.asking.what, dropped: true });
    b.asking = null;
  }
  /**
   * You got her up (a pet while she slept). If she had slept enough she does not mind; otherwise she is cross:
   * a grumble as she stretches, then she sits with her nose turned away (and may stalk off: see stepNeeds).
   */
  function wakeCross() {
    b.target = null; b.goal = null;
    mind.feel('woken');
    cheer(-0.06);
    emit('woken', { angry: true });
    b.after = 'sulk';
    enter('stretch', KITTY.clips.Stretch);
    emit('wake');
    emit('grumble', { delay: 0.35 });
    b.snub = b.t + KITTY.clips.Stretch + 5;
    b.feelAt = 0;
    return false;
  }
  /** Had enough: up and away, a few metres off, the other way from you. */
  function walkOff() {
    if (b.mode === 'purr') emit('purr-end');
    const f = friendSpot(), dx = b.x - f[0], dz = b.z - f[1], d = Math.hypot(dx, dz) || 1;
    b.after = null;
    go({ x: b.x + (dx / d) * 11 + (rand() - 0.5) * 6, z: b.z + (dz / d) * 11 + (rand() - 0.5) * 6 }, null, false);
  }
  /** She walks over to you and asks (what: 'cuddle' | 'play'), or just comes to be near you (null). */
  function comeAsk(what) {
    const f = friendSpot(), dx = b.x - f[0], dz = b.z - f[1], d = Math.hypot(dx, dz) || 1;
    b.asking = what ? { what, until: b.t + 40 } : null;
    b.after = what ? 'meow' : null;
    if (d < 6.5) {                                         // already beside you: she turns to you and asks
      b.target = null; b.goal = null;
      if (what) { b.asking.until = b.t + 14; emit('ask', { what }); }
      if (b.mode === 'sit') {
        if (what) { b.after = null; enter('meow', KITTY.clips.Meow); emit('meow'); } else enter('sit', 4);
      } else { b.face = { x: f[0], z: f[1], then: 'sit' }; enter('face'); }
      return;
    }
    go({ x: f[0] + (dx / d) * 4.6, z: f[1] + (dz / d) * 4.6 }, 'ask', d > 22);
  }
  /**
   * Bedtime. With a bed (b.bed, Day 3) she walks round to its front, steps in over the low part of the bolster,
   * goes to the middle of the cushion, turns to face out and lies down. Without one she naps in her own spot.
   */
  function goBed() {
    const sat = b.mode === 'sit';
    const lieDown = () => { if (sat) { enter('liedown', 1.4); emit('sigh'); } else { b.after = 'nap'; enter('sitdown', KITTY.clips.Sit); } };
    const bd = b.bed;
    if (!bd) {
      const s = mind.spot;                                 // a nap is taken in her spot, once she has one
      if (s && Math.hypot(s.x - b.x, s.z - b.z) > 7) go({ x: s.x, z: s.z }, 'spot', false);
      else lieDown();
      return;
    }
    const dx = b.x - bd.x, dz = b.z - bd.z, d = Math.hypot(dx, dz);
    if (d < bd.r * 0.4) { b.target = null; b.goal = null; lieDown(); return; }     // on it already
    const front = dx * bd.ex + dz * bd.ez;                 // how far out in front of the bed she is
    const gate = { x: bd.x + bd.ex * (bd.outer + 4.5), z: bd.z + bd.ez * (bd.outer + 4.5) };
    if (d < bd.r || front > d * 0.82) go({ x: bd.x, z: bd.z }, 'bedin', false);   // on the cushion, or straight in front: in she goes
    else if (front < bd.outer * 0.6) {                     // beside or behind it: round the nearer side first, not through it
      const side = (dx * -bd.ez + dz * bd.ex) >= 0 ? 1 : -1;
      go({ x: bd.x - bd.ez * side * (bd.outer + 5) + bd.ex * 2, z: bd.z + bd.ex * side * (bd.outer + 5) + bd.ez * 2 }, 'bedside', d > 34);
    } else go(gate, 'bed', d > 34);
  }
  /** Nobody is telling her what to do: she chooses. */
  function onHerOwn() {
    const sat = b.mode === 'sit';
    if (b.asking) { enter(sat ? 'sit' : 'idle', 2); return; }       // still waiting for your answer
    const a = mind.choose(sense());
    mind.did(a);
    emit('mind', { does: a });
    switch (a) {
      case 'groom':
        if (sat) enter('groom', 4 + rand() * 3); else { b.after = 'groom'; enter('sitdown', KITTY.clips.Sit); }
        break;
      case 'nap': goBed(); break;
      case 'wander': go(pickWander(), null, false); break;
      case 'eat': b.after = null; emit('chirp'); goEat(); break;
      case 'cuddle': comeAsk('cuddle'); break;
      case 'playask':
        if (toyDown()) { b.yarn.rounds = 1; b.solo = true; emit('chirp'); chaseYarn(); }   // her toy is out: she plays by herself
        else comeAsk('play');
        break;
      case 'follow': comeAsk(null); break;
      default: enter(sat ? 'sit' : 'idle', sat ? 4 + rand() * 4 : 2 + rand() * 2);
    }
  }

  function pickWander() {
    for (let i = 0; i < 20; i++) {
      const a = rand() * TAU, r = Math.sqrt(rand()) * KITTY.roam;
      const x = Math.sin(a) * r, z = Math.cos(a) * r;
      const d = Math.hypot(x - b.x, z - b.z);
      if (b.bed && Math.hypot(x - b.bed.x, z - b.bed.z) < b.bed.outer + 4) continue;   // not onto her bed
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
  b.call = (x, z, opt = {}) => {
    const p = inside({ x, z });
    if (mind && opt.quiet && lying()) return false;      // you walking off never wakes her
    const d = wants('call', opt.quiet);
    if (!d.yes) return false;                            // she heard you; she is not coming
    emit('call', p);
    emit('trill');
    b.after = 'meow';
    dropAsk();
    const far = Math.hypot(p.x - b.x, p.z - b.z);
    if (far < 4.5) {                                     // already here: just turn round and sit
      b.target = null; b.goal = null;
      if (lying()) { wake('meow'); return true; }
      if (!sitting()) { b.face = { x: b.viewer[0], z: b.viewer[1], then: 'sit' }; enter('face'); }
      return true;
    }
    go(p, 'call', d.mood !== 'reluctant' || far > 30);   // reluctant: she comes, at a walk
    return true;
  };

  b.pet = (opt = {}) => {
    const asleep = !!mind && !opt.sure && lying();       // a pet while she sleeps gets her up, like it or not
    if (asleep && !(b.energy > 0.9 && mind.sleepy < 0.25)) return wakeCross();
    if (asleep) emit('woken', { angry: false });         // she had slept enough: no harm done
    const d = opt.sure || asleep ? YES : wants('pet');   // sure: she is not asked (her new name: she just likes it)
    if (!d.yes) {
      if (d.why === 'enough' && (sitting() || b.mode === 'idle')) walkOff();
      return false;
    }
    if (mind && b.asking?.what === 'cuddle') answered();
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
    const d = wants('feed');                             // the bowl is put down either way; eating is up to her
    if (d.yes) {
      if (b.yarn) b.yarn.rounds = 3;                     // food beats play
      emit('chirp');
      dropAsk();
    }
    if (b.bowl) {                                        // food is already out: top the bowl up
      b.bowl.left = 3;
      b.bowl.eatenAt = null;
      emit('refill', { x: b.bowl.x, z: b.bowl.z });
      if (!d.yes) return false;                          // it waits there until she is hungry
      if (b.mode === 'eat') { b.timer = EAT.seconds; b.eatStart = b.t; b.bowl.bites = 0; return; }   // she eats on
      if (b.goal === 'eat' || b.face?.then === 'eat') return;      // already on her way
      b.after = null;
      goEat();
      return;
    }
    const bowl = besideHer(10, 3);
    if (b.bed) {                                         // never on her bed
      const ox = bowl.x - b.bed.x, oz = bowl.z - b.bed.z, od = Math.hypot(ox, oz) || 1, need = b.bed.outer + 3;
      if (od < need) { bowl.x = b.bed.x + (ox / od) * need; bowl.z = b.bed.z + (oz / od) * need; }
    }
    b.bowl = { ...bowl, t: b.t, left: 3, bites: 0, eatenAt: null };
    emit('bowl', { x: bowl.x, z: bowl.z });
    if (!d.yes) return false;
    b.after = null;
    goEat();
    return true;
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
    if (mind && !b.solo) mind.outcome('played');
    b.solo = false;
    if (foodLeft() && (!mind || b.hunger > 0.15)) { b.after = null; goEat(); return; }
    b.after = b.after || 'groom';
    enter('sitdown', KITTY.clips.Sit);
  }

  b.play = () => {
    if (b.yarn?.wand) {                                  // Day 4: the fish on a stick is out
      const y = b.yarn;                                  // she is close by: it is dangled in front of her; otherwise cast to her
      if (y.hang && Math.hypot(y.x - b.x, y.z - b.z) < WAND.tease) b.dangle(); else b.castNear();
      return;
    }
    if (b.yarn?.held) return;                            // it is in your hand
    const d = wants('play');
    if (mind && d.yes && b.asking?.what === 'play') answered();
    const start = !d.yes ? 3 : d.mood === 'reluctant' ? 1 : 0;       // not keen: a short game; no: she only watches
    if (d.yes) { b.solo = false; dropAsk(); }
    if (b.yarn && b.yarn.flying === 0) {                 // it is already on the floor: game on again
      if (!d.yes) return;
      b.yarn.rounds = start;
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
      spin: 0, ax: 1, az: 0, rounds: start, rim: KITTY.roam + 8 };
    emit('yarn', { x: land.x, z: land.z });
  };

  // You can pick the yarn up, carry it about and throw it anywhere on the plate (main.js drags it).
  // While you hold it she stops and watches; the moment it leaves your hand she is after it.
  b.grabYarn = () => {
    const y = b.yarn;
    if (!y) return false;
    Object.assign(y, { held: true, air: false, flying: 0, vx: 0, vz: 0, vy: 0, hx: y.x, hz: y.z });
    if (y.wand) Object.assign(y, { hang: false, reel: false, dangle: false, idle: 0, line: WAND.max });
    if (b.goal === 'yarn') { b.target = null; b.goal = null; b.speed = 0; enter('idle', 30); }
    if (b.mode === 'face' && ['pounce', 'swipe'].includes(b.face?.then)) { b.face = null; enter('idle', 30); }
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
    const d = wants('play');
    if (mind && d.yes && b.asking?.what === 'play') answered();
    Object.assign(y, { held: false, air: true, vx: vx * k, vz: vz * k, vy, rounds: d.yes ? 0 : 3, rim: KITTY.limit, drag: YARN.drag });
    if (y.wand) { y.idle = 0; y.line = WAND.max; }
    emit('toss', { speed: sp * k });
    if (!d.yes) return;                                  // she watches it go
    b.solo = false;
    dropAsk();
    emit('chirp');
    chaseYarn();
  };

  // ---------------------------------------------------------------- Day 4: the fish on a stick
  // The fish is her toy (b.yarn, with wand: true), tied by a line to the tip of the stick you hold (b.wandTip,
  // which main.js keeps up to date). It hangs there until you cast it; then she chases it, pounces and bats
  // it about; walk off and it drags along behind you, and she follows; when the game is over it is reeled in.
  const stopChase = () => {
    if (b.goal === 'yarn') { b.target = null; b.goal = null; b.speed = 0; enter('idle', 1.5); }
    if (b.mode === 'face' && ['pounce', 'swipe'].includes(b.face?.then)) { b.face = null; enter('idle', 1.5); }
  };
  const tipNow = () => b.wandTip || [b.x, 5.4, b.z + 6];
  /** The stick comes out (the fish hangs from it) or is put away. */
  b.setWand = (on) => {
    if (!on) {
      if (b.yarn?.wand) { stopChase(); b.yarn = null; }
      return;
    }
    if (b.yarn?.wand) return;
    stopChase();
    const A = tipNow();
    b.yarn = { x: A[0], y: A[1] - WAND.rest, z: A[2], vx: 0, vz: 0, vy: 0, spin: 0, ax: 1, az: 0, rounds: 3, flying: 0,
      wand: true, hang: true, held: true, line: WAND.rest, idle: 0, rim: KITTY.limit, drag: YARN.drag };
  };
  /** Cast the fish to (x, z): it flies out on its line and lands there (as near as the line and the plate allow). */
  b.cast = (x, z) => {
    const y = b.yarn;
    if (!y?.wand || (y.held && !y.hang)) return false;     // no stick, or the fish is in your fingers
    const A = tipNow();
    let dx = x - A[0], dz = z - A[2];
    const d0 = Math.hypot(dx, dz) || 1, d1 = clamp(d0, WAND.castMin, WAND.castMax);
    const p = inside({ x: A[0] + (dx / d0) * d1, z: A[2] + (dz / d0) * d1 });
    const d = wants('play');
    if (mind && d.yes && b.asking?.what === 'play') answered();
    dx = p.x - y.x; dz = p.z - y.z;
    const T = clamp(Math.hypot(dx, dz) / 21, 0.5, 0.85);    // seconds in the air
    Object.assign(y, { hang: false, held: false, reel: false, air: true, idle: 0, line: WAND.max, cast: true, dangle: false,
      vx: dx / T, vz: dz / T, vy: (YARN.radius - y.y) / T + 0.5 * YARN.gravity * T, rounds: d.yes ? 0 : 3, drag: YARN.drag });
    emit('cast', { x: p.x, z: p.z, speed: Math.hypot(dx, dz) / T });
    if (d.yes) { b.solo = false; dropAsk(); emit('chirp'); }
    return true;
  };
  /** Cast it to her: it lands a few steps in front of her, on your side. */
  b.castNear = () => {
    const A = tipNow();
    const dx = A[0] - b.x, dz = A[2] - b.z, d = Math.hypot(dx, dz) || 1;
    return b.cast(b.x + (dx / d) * Math.min(WAND.near, d * 0.6), b.z + (dz / d) * Math.min(WAND.near, d * 0.6));
  };
  /**
   * Dangle it: the fish stays on the end of your rod, lowered to the floor in front of her, and she goes for
   * it: pounces, and bats it so it swings (three times, like any game of hers). Walk about and she follows it.
   */
  b.dangle = () => {
    const y = b.yarn;
    if (!y?.wand || !y.hang) return false;
    const d = wants('play');
    if (mind && d.yes && b.asking?.what === 'play') answered();
    if (!d.yes) return false;
    Object.assign(y, { dangle: true, rounds: 0, idle: 0 });
    b.solo = false;
    dropAsk();
    emit('chirp');
    emit('dangle');
    if (lying()) { b.after = null; wake(null); }
    chaseYarn();
    return true;
  };
  /** Wind the line in: the fish comes back to hang under the tip. */
  b.reel = () => { const y = b.yarn; if (y?.wand && !y.hang && !y.held) { y.reel = true; y.rounds = 3; } };

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
    else if (a === 'nap') { enter('liedown', 1.4); emit('sigh'); }
    else if (a === 'sulk') enter('sit', 5 + rand() * 3);
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
    if (g === 'call') { if (mind) mind.outcome('came'); b.face = { x: b.viewer[0], z: b.viewer[1], then: 'sit' }; enter('face'); return; }
    if (g === 'ask') {                                     // she has come over to you
      const f = friendSpot();
      if (b.asking) { b.asking.until = b.t + 14; b.after = 'meow'; emit('ask', { what: b.asking.what }); }
      b.face = { x: f[0], z: f[1], then: 'sit' }; enter('face');
      return;
    }
    if (g === 'spot') { b.after = 'nap'; enter('sitdown', KITTY.clips.Sit); return; }   // her spot: a nap
    if (b.bed && g === 'bedside') {                        // round the side: now to the front
      go({ x: b.bed.x + b.bed.ex * (b.bed.outer + 4.5), z: b.bed.z + b.bed.ez * (b.bed.outer + 4.5) }, 'bed', false);
      return;
    }
    if (b.bed && g === 'bed') { go({ x: b.bed.x, z: b.bed.z }, 'bedin', false); return; }   // in over the low front
    if (b.bed && g === 'bedin') {                          // on the cushion: turn to face out, then down she goes
      b.face = { x: b.bed.x + b.bed.ex * 40, z: b.bed.z + b.bed.ez * 40, then: 'nap' };
      enter('face');
      return;
    }
    if (g === 'eat' && b.bowl) { b.face = { x: b.bowl.x, z: b.bowl.z, then: 'eat' }; enter('face'); return; }
    if (g === 'yarn' && b.yarn) { b.face = { x: b.yarn.x, z: b.yarn.z, then: 'pounce' }; enter('face'); return; }
    if (b.after) { enter('sitdown', KITTY.clips.Sit); return; }
    if (rand() < 0.45) enter('sitdown', KITTY.clips.Sit);
    else enter('idle', 2.5 + rand() * 2.5);
  }

  const standOff = () => KITTY.pounce + 3.0;             // pounce from here: she lands just short of it
  /** The fish is dangling right in front of her: she turns to it where she stands and bats it again. */
  function swipeAgain() {
    const y = b.yarn, d = Math.hypot(y.x - b.x, y.z - b.z);
    if (d > 7.5 || d < 0.8) { chaseYarn(); return; }     // it has swung (or been walked) out of reach: after it
    b.target = null; b.goal = null;
    b.face = { x: y.x, z: y.z, then: 'swipe' };
    enter('face');
  }

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
    if (!y.wand) { stepFree(dt); return; }
    if (wandBefore(y, dt)) return;
    const px = y.x, pz = y.z, wasAir = y.air;
    stepFree(dt);
    wandAfter(y, dt, px, pz, wasAir);
  }

  /** The fish hanging from the tip, and the line being wound in. True = nothing more to do this step. */
  function wandBefore(y, dt) {
    const A = tipNow();
    if (y.hang) {                                        // it swings under the tip like a little pendulum
      const k = 46, c = 5.5;
      y.vx += ((A[0] - y.x) * k - y.vx * c) * dt;
      y.vz += ((A[2] - y.z) * k - y.vz * c) * dt;
      y.x += y.vx * dt; y.z += y.vz * dt;
      let hx = y.x - A[0], hz = y.z - A[2], h = Math.hypot(hx, hz);
      const most = WAND.rest * 0.8;
      if (h > most) { y.x = A[0] + (hx / h) * most; y.z = A[2] + (hz / h) * most; h = most; }
      y.y = Math.max(YARN.radius, A[1] - Math.sqrt(WAND.rest * WAND.rest - h * h));
      if (h < 0.004 && Math.hypot(y.vx, y.vz) < 0.02) { y.x = A[0]; y.z = A[2]; y.vx = 0; y.vz = 0; }   // still
      y.vy = 0;
      if (y.dangle && y.rounds >= 3 && !playing()) { y.dangle = false; emit('dangle-end'); }   // her game is over: up it goes again
      return true;
    }
    if (y.held) return false;                            // in your fingers
    if (y.reel) {
      y.line = Math.max(WAND.rest, y.line - WAND.reel * dt);
      const d = Math.hypot(y.x - A[0], y.y - A[1], y.z - A[2]);
      if (y.line <= WAND.rest + 1e-6 && d <= WAND.rest + 0.35) {       // home: hanging again
        Object.assign(y, { hang: true, held: true, air: false, reel: false, cast: false, idle: 0, line: WAND.rest, vy: 0 });
        y.vx *= 0.35; y.vz *= 0.35;
        emit('reeled');
        return wandBefore(y, 0);                         // (hung exactly a line's length under the tip, from this step on)
      }
      // it lifts off the floor once the line is too short to let it lie there
      if (!y.air && y.line < Math.hypot(Math.hypot(y.x - A[0], y.z - A[2]) * 0.55, A[1] - YARN.radius)) { y.air = true; y.vy = 3; }
      return false;
    }
    // lying there with nobody after it: in it comes (sooner once her game is over)
    if (!y.air && y.flying === 0) {
      if (playing()) y.idle = 0;
      else { y.idle += dt; if (y.idle > (y.rounds >= 3 ? WAND.wait : WAND.lost)) b.reel(); }
    }
    return false;
  }

  /** The line: the fish can never be further from the tip than the line is long. */
  function wandAfter(y, dt, px, pz, wasAir) {
    const A = tipNow(), R = YARN.radius;
    if (wasAir && !y.air && !y.reel) {                   // it has landed: take up the slack
      y.cast = false;
      y.line = clamp(Math.hypot(y.x - A[0], y.y - A[1], y.z - A[2]) + 0.9, WAND.trail, WAND.max);   // (never so short that it rides at your heels)
    }
    const L = y.line;
    const dx = y.x - A[0], dy = y.y - A[1], dz = y.z - A[2], d = Math.hypot(dx, dy, dz);
    if (d <= L || d < 1e-6) return;
    let nx = A[0] + (dx / d) * L, ny = A[1] + (dy / d) * L, nz = A[2] + (dz / d) * L;
    if (ny < R) {                                        // on the floor: as far out as the line lets it be
      const h = Math.hypot(dx, dz) || 1, far = Math.sqrt(Math.max(0, L * L - (A[1] - R) * (A[1] - R)));
      nx = A[0] + (dx / h) * far; nz = A[2] + (dz / h) * far; ny = R;
    }
    if (y.air || y.held) {                               // taut in the air: it cannot fly on outward
      const ux = dx / d, uy = dy / d, uz = dz / d, out = y.vx * ux + (y.vy || 0) * uy + y.vz * uz;
      if (out > 0) { y.vx -= out * ux; y.vy = (y.vy || 0) - out * uy; y.vz -= out * uz; }
      if (y.held) { y.hx = nx; y.hz = nz; }
    } else {                                             // dragged along the floor: it keeps the speed it is pulled at
      y.vx = clamp((nx - px) / dt, -26, 26); y.vz = clamp((nz - pz) / dt, -26, 26);
      const v = Math.hypot(y.vx, y.vz);
      if (v > 1e-3) { y.ax = y.vz / v; y.az = -y.vx / v; }
    }
    y.x = nx; y.y = ny; y.z = nz;
  }

  function stepFree(dt) {
    const y = b.yarn;
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
          const keep = y.wand ? 0.3 : 0.82;                // (a plush fish on a line flops down where it lands)
          y.vx *= keep; y.vz *= keep;
          emit('thud', { x: y.x, z: y.z, soft: hit < 12 });
        } else {                                         // down: rolling from here
          y.vy = 0; y.air = false;
          if (y.wand) { y.vx *= 0.4; y.vz *= 0.4; }
          if (hit > 2) emit('thud', { x: y.x, z: y.z, soft: true });
          const busy = ['pounce', 'bat', 'face'].includes(b.mode) || b.goal === 'yarn';
          if (!busy && y.rounds < 3) { emit('chirp'); chaseYarn(); }
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
    if (!mind) return;
    mind.step(dt, sense());
    // her feelings: say so when they change; cross = nose away; furious = she stalks off
    if (b.t >= b.feelAt) {
      b.feelAt = b.t + 0.2;
      const f = mind.emotion(sense());
      if (f.id !== b.feeling) { b.feeling = f.id; emit('feel', { id: f.id, word: f.word }); }
    }
    const anger = mind.mood.anger;
    if (anger >= 0.45 && (sitting() || b.mode === 'idle')) b.snub = Math.max(b.snub, b.t + 0.6);
    if (anger >= 0.75 && !b.stormed && (b.mode === 'sit' || b.mode === 'idle')) { b.stormed = true; emit('grumble'); walkOff(); }
    if (anger < 0.3) b.stormed = false;
    // sleepy means bed, and now: she does not sit about being sleepy, hungry or not (unless she is still furious)
    if ((mind.sleepy >= 0.85 || b.energy < 0.18) && (b.mode === 'sit' || b.mode === 'idle') && !b.goal && !b.target && !b.face
      && !b.asking && !(b.yarn?.held && !b.yarn.hang) && anger < 0.75 && b.t >= b.bedAt) {
      b.bedAt = b.t + 3;
      mind.did('nap');
      emit('mind', { does: 'nap' });
      goBed();
    }
    if (sitting() || b.mode === 'idle') b.energy = clamp(b.energy + dt / 100, 0, 1);     // resting helps a little; a nap far more
    if (b.asking && b.t > b.asking.until) {                // she asked and nothing came of it
      mind.outcome('ignored');
      emit('ask-end', { what: b.asking.what });
      b.asking = null;
    }
    // food is out and now she is hungry: she goes and has it, no need to be told
    if (foodLeft() && b.hunger > 0.3 && (b.mode === 'sit' || b.mode === 'idle') && !b.goal && !b.asking) {
      mind.did('eat');
      emit('mind', { does: 'eat' });
      emit('chirp');
      b.after = null;
      goEat();
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
          if (mind) { onHerOwn(); break; }
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
        if (b.timer <= 0) { enter('sleep', 14 + rand() * 10); emit('asleep'); if (mind) mind.napAt(b.x, b.z); }
        break;
      case 'sleep':
        b.energy = clamp(b.energy + dt / (mind ? 30 : 15), 0, 1);
        if (!mind) { if (b.timer <= 0) wake(null); break; }
        // she sleeps until she has had enough (or it has been long enough)
        if (b.timer <= 0 && ((b.energy >= 0.999 && mind.sleepy < 0.12) || b.timer < -75)) {
          mind.feel('rested');
          wake(null);
        }
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
          if (mind) { onHerOwn(); break; }
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
        if (b.goal === 'ask') {                             // coming over to you: you may have moved
          const f = friendSpot(), dx = b.x - f[0], dz = b.z - f[1], d = Math.hypot(dx, dz) || 1;
          b.target = inside({ x: f[0] + (dx / d) * 4.6, z: f[1] + (dz / d) * 4.6 });
        }
        // in a hurry: a long way to go turns the trot into a run; near the end she trots again
        const left = Math.hypot(b.target.x - b.x, b.target.z - b.z);
        if (b.mode === 'trot' && left > KITTY.runFrom) { enter('run'); emit('jingle'); }
        else if (b.mode === 'run' && left < KITTY.runTo) enter('trot');
        const fast = b.mode !== 'walk';
        const exact = b.goal === 'eat' || b.goal === 'yarn' || b.goal === 'bed' || b.goal === 'bedin' || b.goal === 'bedside';
        const top = b.mode === 'run' ? KITTY.runSpeed : fast ? KITTY.trotSpeed : KITTY.walkSpeed;
        const dist = steer(dt, top, b.mode === 'run' ? 2.6 : fast ? 3.2 : 2.0);
        if (dist < (exact ? 0.5 : fast ? 4.5 : 3.0)) arrive();
        break;
      }
      case 'face': {
        b.speed = 0;
        const f = b.face;
        if ((f.then === 'pounce' || f.then === 'swipe') && b.yarn) { f.x = b.yarn.x; f.z = b.yarn.z; }
        if (turnTo(f.x, f.z, dt) < 0.1) {
          b.face = null;
          if (f.then === 'eat' && b.bowl) {
            enter('eat', EAT.seconds * Math.max(1, b.bowl.left) / 3);   // as long as the food left lasts
            b.eatStart = b.t; b.bowl.bites = 0; emit('eat');
          }
          else if (f.then === 'pounce') { enter('pounce', KITTY.clips.Pounce); emit('wiggle'); }
          else if (f.then === 'swipe') { enter('bat', KITTY.clips.Bat); b.batted = false; }
          else if (f.then === 'nap') { b.after = 'nap'; enter('sitdown', KITTY.clips.Sit); }
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
          b.ateAt = b.t;
          if (mind) mind.outcome('ate');
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
          if (y?.held && !y.hang) enter('idle', 30);                  // you picked it up mid-leap: she waits for the throw
          else if (near) { enter('bat', KITTY.clips.Bat); b.batted = false; }
          else if (y && y.rounds < 3) chaseYarn();
          else playOver();
        }
        break;
      }
      case 'bat': {
        const y = b.yarn;
        if (!b.batted && KITTY.clips.Bat - b.timer > 0.2 && y && (!y.held || y.hang) && !y.air) {
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
          if (y.hang) { y.vx *= 1.6; y.vz *= 1.6; }         // on the end of your rod: it swings away and back
          emit('swat', b.solo ? { round: y.rounds, solo: true } : { round: y.rounds });
          emit(y.rounds < 3 ? 'chirp' : 'trill');
        }
        if (b.timer <= 0) {
          if (y?.held && !y.hang) enter('idle', 30);
          else if (y && y.rounds < 3) { if (y.dangle) swipeAgain(); else chaseYarn(); }
          else playOver();
        }
        break;
      }
      case 'purr':
        if (b.t >= b.purrUntil) { emit('purr-end'); if (mind) mind.outcome('purred'); enter('sit', 4 + rand() * 3); }
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
