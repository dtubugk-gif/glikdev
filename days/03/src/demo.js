// Scripted cameras for filming (?demo=<name>). Each pose is a pure function of t (seconds since
// the world was ready) and, for the kitty shots, of the kitty's own state at t (which is itself
// deterministic: kittybrain.js is seeded and stepped at a fixed rate), so a recorder that controls
// requestAnimationFrame / performance.now gets identical frames on every run.

export const DEMOS = ['orbit', 'reveal', 'kitty', 'kittycall', 'kittypet', 'kittywalk', 'kittyname', 'kittyfeed', 'kittyplay', 'kittynap',
  'kittytoken', 'kittydress'];

const lerp = (a, b, k) => a + (b - a) * k;
const DEG = Math.PI / 180;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const easeOut = (k) => 1 - (1 - clamp01(k)) ** 3;
const easeInOut = (k) => { k = clamp01(k); return k * k * (3 - 2 * k); };

/**
 * Day 2 kitty shots: where she starts, what happens to her and when (the same script plays in every
 * recording), and the camera that films it. Distances are metres in the world (the kitty sits about
 * 5 m tall). `face` is the azimuth the start pose looks along (radians, as in main.js's home.az).
 */
export const KITTY_DEMOS = {
  // the swoop: from high above, down to a low three-quarter view of her sitting there; she meows
  kitty: {
    start: (home) => ({ x: 0, z: 0, heading: home.az + 0.25, mode: 'sit' }),
    script: [{ t: 4.6, type: 'meow' }],
    viewer: (home) => [Math.sin(home.az + 0.25) * 30, Math.cos(home.az + 0.25) * 30],
  },
  // she sits far away; a tap near the camera; she comes running, turns to the camera, sits, meows
  kittycall: {
    start: () => ({ x: -5, z: -30, heading: 0.15, mode: 'sit' }),
    script: [{ t: 0.5, type: 'call', x: 1.5, z: 7 }],
    viewer: () => [3, 24],
  },
  // a close one: petted twice, she purrs with her eyes shut, hearts float up
  kittypet: {
    start: () => ({ x: 0, z: 0, heading: 0.2, mode: 'sit' }),
    script: [{ t: 0.55, type: 'pet' }, { t: 2.7, type: 'pet' }],
    viewer: () => [Math.sin(0.2) * 20, Math.cos(0.2) * 20],
  },
  // her name tag pops up (?tag=Name&tagAt=...), she is petted and loves it
  kittyname: {
    start: () => ({ x: 0, z: 0, heading: 0.2, mode: 'sit' }),
    script: [{ t: 1.0, type: 'pet' }],
    viewer: () => [Math.sin(0.2) * 20, Math.cos(0.2) * 20],
  },
  // dinner: the bowl pops down beside her, she runs over, crunches, washes her face
  kittyfeed: {
    start: () => ({ x: 0, z: 0, heading: 0.35, mode: 'sit' }),
    script: [{ t: 0.3, type: 'feed' }],
    viewer: () => [Math.sin(0.35) * 30, Math.cos(0.35) * 30],
    needs: { hunger: 0.9, happy: 0.5 },
  },
  // the yarn lands beside her: chase, pounce, swat
  kittyplay: {
    start: () => ({ x: 0, z: 0, heading: 0.35, mode: 'sit' }),
    script: [{ t: 0.3, type: 'play' }],
    viewer: () => [Math.sin(0.35) * 30, Math.cos(0.35) * 30],
  },
  // she curls up into a loaf and falls asleep (Zzz)
  kittynap: {
    start: () => ({ x: 0, z: 0, heading: 0.2, mode: 'sit', timer: 60 }),
    script: [{ t: 0.2, type: 'nap' }],
    viewer: () => [Math.sin(0.2) * 20, Math.cos(0.2) * 20],
  },
  // Day 3: petted, she purrs and a friendship token pops out and flies to the counter (?tokens=1 shows it)
  kittytoken: {
    start: () => ({ x: 0, z: 0, heading: 0.2, mode: 'sit' }),
    script: [{ t: 0.7, type: 'pet' }],
    viewer: () => [Math.sin(0.2) * 20, Math.cos(0.2) * 20],
  },
  // Day 3: the wardrobe, one thing after another, then the full royal look and a happy purr
  kittydress: {
    start: () => ({ x: 0, z: 0, heading: 0.2, mode: 'sit' }),
    script: [
      { t: 0.5, type: 'wear', id: 'bowtie' }, { t: 1.3, type: 'wear', id: 'strawhat' }, { t: 2.1, type: 'wear', id: 'shades' },
      { t: 3.2, type: 'wear', id: 'wizardhat' }, { t: 3.2, type: 'wear', id: 'scarf' }, { t: 3.2, type: 'wear', slot: 'face', id: null },
      { t: 4.4, type: 'wear', id: 'flowercrown' }, { t: 4.4, type: 'wear', id: 'wings' }, { t: 4.4, type: 'wear', id: 'bowtie' },
      { t: 5.6, type: 'wear', id: 'crown' }, { t: 6.0, type: 'pet' },
    ],
    viewer: () => [Math.sin(0.2) * 20, Math.cos(0.2) * 20],
    wallet: { tokens: 0 },
  },
  // she strolls across the plate; the camera tracks alongside
  kittywalk: {
    start: () => ({ x: -16, z: 2, heading: Math.PI / 2, mode: 'idle' }),
    script: [{ t: 0.2, type: 'walk', x: 20, z: -4 }],
    viewer: () => [0, 30],
  },
};

/**
 * @param {string} name
 * @param {number} t      seconds
 * @param {{az:number, pol:number, dist:number, target:number[], shift:number, fov:number,
 *          horizon:number, horizonAt:Function, edgeDip:Function}} home  the default framing (main.js)
 * @param {{x:number, z:number, heading:number, head:number[], bowl:object|null, yarn:object|null}|null} [kitty]
 *        the kitty at t (with her bowl and yarn, when they are out)
 * @returns {{az:number, pol:number, dist:number, target:number[], shift:number}
 *          | {position:number[], look:number[], shift:number} | null}
 */
export function demoPose(name, t, home, kitty = null) {
  if (name === 'orbit') {
    // one slow full turn every 36 s around the plate's centre, at the default height
    return { az: home.az + (t / 36) * Math.PI * 2, pol: home.pol, dist: home.dist, target: home.target, shift: home.shift };
  }
  if (name === 'reveal') {
    // 0-6 s, ease-out: high and top-down over the grid, swooping down and levelling out
    // about 3.5 m above the plate, gliding toward the horizon; after 6 s it keeps gliding.
    const u = Math.min(1, Math.max(0, t / 6));
    const k = 1 - (1 - u) ** 3;
    const fx = -Math.sin(home.az), fz = -Math.cos(home.az);       // forward, away from the start view
    const height = lerp(82, 3.5, k);
    const pitch = lerp(82, 4, Math.min(1, k * 1.08)) * DEG;        // degrees below the horizon
    const travel = lerp(-34, 30, k) + 2.5 * Math.max(0, t - 6);     // metres along forward
    const pos = [fx * travel, height, fz * travel];
    const look = [pos[0] + fx * Math.cos(pitch) * 20, height - Math.sin(pitch) * 20, pos[2] + fz * Math.cos(pitch) * 20];
    // lens shift: none while looking down, then the horizon settles at the layout's height
    // (the visible horizon is the plate's far edge, a little below the sky's horizon)
    const endDip = home.edgeDip(3.5, -30, home.az);
    const endShift = home.horizonAt(4 * DEG - endDip, home.fov) - home.horizon;
    return { position: pos, look, shift: lerp(0, endShift, k) };
  }
  if (!kitty) return null;
  const [kx, kz] = [kitty.x, kitty.z];
  if (name === 'kitty') {
    // a spiral down from 70 m over her to 16 m in front, eyes level with her chest; then a slow drift
    const face = home.az + 0.25;
    const k = easeOut(t / 5.4);
    const a = face + lerp(-1.6, 0.42, k) + 0.025 * Math.max(0, t - 5.4);
    const d = lerp(4, 15.5, easeInOut(t / 5.4));
    const h = lerp(70, 4.8, k);
    const pos = [kx + Math.sin(a) * d, h, kz + Math.cos(a) * d];
    const look = [kx, lerp(0, 7.0, easeInOut(t / 4.5)), kz];          // she sits low in the frame, under the captions
    return { position: pos, look, shift: 0 };
  }
  if (name === 'kittycall') {
    // a low camera by the spot she is called to; it keeps her in frame as she runs up and sits
    const pos = [3 + 0.4 * Math.sin(t * 0.3), 3.2, 24 - 0.4 * t];
    const head = kitty.head;
    const near = clamp01((40 - Math.hypot(kx - pos[0], kz - pos[2])) / 25);
    const look = [lerp(kx, head[0], near), lerp(2.2, head[1] + 0.8, near), lerp(kz, head[2], near)];
    return { position: pos, look, shift: 0 };
  }
  if (name === 'kittypet') {
    // close and low, pushing in a little while she purrs
    const a = 0.2 + 0.42 - 0.05 * easeInOut(t / 6);
    const d = lerp(14.5, 12.5, easeInOut(t / 6));
    const pos = [kx + Math.sin(a) * d, 4.0, kz + Math.cos(a) * d];
    return { position: pos, look: [kx, 6.4, kz], shift: 0 };
  }
  if (name === 'kittytoken') {
    // like the pet shot, a little wider and looking higher: room for the token to rise and fly off
    const a = 0.2 + 0.4 - 0.04 * easeInOut(t / 5), d = lerp(16.5, 15, easeInOut(t / 5));
    const pos = [kx + Math.sin(a) * d, 4.2, kz + Math.cos(a) * d];
    return { position: pos, look: [kx, 7.6, kz], shift: 0 };
  }
  if (name === 'kittydress') {
    // front three-quarter, drifting slowly round her so every piece gets its moment
    const a = 0.2 + 0.5 - 0.085 * t, d = lerp(11.5, 10.2, easeInOut(t / 7));
    const pos = [kx + Math.sin(a) * d, 4.9, kz + Math.cos(a) * d];
    return { position: pos, look: [kx, 6.5, kz], shift: 0 };
  }
  if (name === 'kittyname') {
    // close and low, like the pet shot; room above her head for the name tag
    const a = 0.2 + 0.36, d = 14.5 - 0.5 * easeInOut(t / 3);
    const pos = [kx + Math.sin(a) * d, 4.0, kz + Math.cos(a) * d];
    return { position: pos, look: [kx, 6.9, kz], shift: 0 };
  }
  if (name === 'kittynap') {
    // low and close, slowly drifting round her as she settles; room above for the Zzz
    const a = 0.2 + 0.5 + 0.05 * t, dist = lerp(15, 12.5, easeInOut(t / 4.4));
    const pos = [kx + Math.sin(a) * dist, 3.2, kz + Math.cos(a) * dist];
    return { position: pos, look: [kx, 5.2, kz], shift: 0 };
  }
  if (name === 'kittyfeed' || name === 'kittyplay') {
    // a wider shot that keeps her and the bowl (or the yarn) in frame, eased in once it appears
    const thing = name === 'kittyfeed' ? kitty.bowl : kitty.yarn;
    const ramp = easeInOut((t - 0.3) / 1.4) * (name === 'kittyfeed' ? 0.5 : 0.42);
    const fx = thing ? kx + (thing.x - kx) * ramp : kx, fz = thing ? kz + (thing.z - kz) * ramp : kz;
    // feeding: wide while she runs over, then in close while she eats; playing: a little wider throughout
    const k = name === 'kittyfeed' ? easeInOut((t - 1.1) / 1.6) : easeInOut(t / 3) * 0.6;
    const a = 0.35 + 0.3, dist = lerp(22, 12.5, k);
    const pos = [fx + Math.sin(a) * dist, lerp(4.6, 3.4, k), fz + Math.cos(a) * dist];
    return { position: pos, look: [fx, lerp(6.6, 4.4, k), fz], shift: 0 };
  }
  if (name === 'kittywalk') {
    // tracking alongside, a little ahead of her
    const pos = [kx + 3, 3.0, kz + 24];                             // low, so she walks along the lower half
    return { position: pos, look: [kx + 1, 7.0, kz], shift: 0 };
  }
  return null;
}
