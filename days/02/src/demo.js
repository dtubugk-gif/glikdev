// Scripted cameras for filming (?demo=<name>). Each pose is a pure function of t (seconds since
// the world was ready) and, for the kitty shots, of the kitty's own state at t (which is itself
// deterministic: kittybrain.js is seeded and stepped at a fixed rate), so a recorder that controls
// requestAnimationFrame / performance.now gets identical frames on every run.

export const DEMOS = ['orbit', 'reveal', 'kitty', 'kittycall', 'kittypet', 'kittywalk'];

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
 * @param {{x:number, z:number, heading:number, head:number[]}|null} [kitty]  the kitty at t
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
    const h = lerp(70, 4.2, k);
    const pos = [kx + Math.sin(a) * d, h, kz + Math.cos(a) * d];
    const look = [kx, lerp(0, 3.6, easeInOut(t / 4.5)), kz];
    return { position: pos, look, shift: 0 };
  }
  if (name === 'kittycall') {
    // a low camera by the spot she is called to; it keeps her in frame as she runs up and sits
    const pos = [3 + 0.4 * Math.sin(t * 0.3), 3.2, 24 - 0.4 * t];
    const head = kitty.head;
    const near = clamp01((40 - Math.hypot(kx - pos[0], kz - pos[2])) / 25);
    const look = [lerp(kx, head[0], near), lerp(2.2, head[1] - 0.6, near), lerp(kz, head[2], near)];
    return { position: pos, look, shift: 0 };
  }
  if (name === 'kittypet') {
    // close and low, pushing in a little while she purrs
    const a = 0.2 + 0.42 - 0.05 * easeInOut(t / 6);
    const d = lerp(14.5, 11.5, easeInOut(t / 6));
    const pos = [kx + Math.sin(a) * d, 4.0, kz + Math.cos(a) * d];
    return { position: pos, look: [kx, 3.5, kz], shift: 0 };
  }
  if (name === 'kittywalk') {
    // tracking alongside, a little ahead of her
    const pos = [kx + 3, 4.0, kz + 23];
    return { position: pos, look: [kx + 1, 2.9, kz], shift: 0 };
  }
  return null;
}
