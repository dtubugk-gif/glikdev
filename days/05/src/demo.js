// Scripted cameras for filming (?demo=<name>). Each pose is a pure function of t (seconds since
// the world was ready) and, for the kitty shots, of the kitty's own state at t (which is itself
// deterministic: kittybrain.js is seeded and stepped at a fixed rate), so a recorder that controls
// requestAnimationFrame / performance.now gets identical frames on every run.

export const DEMOS = ['orbit', 'reveal', 'kitty', 'kittycall', 'kittypet', 'kittywalk', 'kittyname', 'kittyfeed', 'kittyplay', 'kittynap',
  'kittytoken', 'kittydress', 'shopwalk', 'kittytoy', 'kittywake', 'kittyfish', 'fishwalk', 'fishshow', 'fishdangle',
  'atombox', 'atomhit', 'atomshow'];

// Day 3: where the shop's doormat is, and where the kitty waits beside it (town.js works these out from SHOP)
const SHOP_DOOR = [19.97, -21.57], SHOP_WAIT = [12.84, -23.42];
// you, standing just behind her shoulder, turned to the camera (used by the close shots: in frame, not in her way)
const BESIDE = { start: { x: -3.81, z: -0.78, heading: 0.75 } };
// Day 3: her bed (town.js BED) and the way out of its front; you, standing beside it
const BED = [-19, -13], BED_OUT = Math.atan2(19, 13);
const BY_BED = { start: { x: BED[0] - 7.4, z: BED[1] + 4.4, heading: BED_OUT + 0.55 } };

// Day 5: where the filmed atom bomb lands and leaves its box, the way the box's front faces (F: toward the camera
// and the sun) and its right-hand side (S)
const ABOX = [12.1, 6.3], ABOX_F = [-0.2614, 0.9652], ABOX_S = [0.9652, 0.2614], ABOX_ROT = Math.atan2(-0.2614, 0.9652);
const byBox = (f, s) => [ABOX[0] + ABOX_F[0] * f + ABOX_S[0] * s, ABOX[1] + ABOX_F[1] * f + ABOX_S[1] * s];
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
    player: { ...BESIDE, script: [{ t: 1.6, type: 'wave' }] },
  },
  // Day 3: she is fast asleep; you pet her awake; she is furious about it (her mind is on in this shot, the same
  // cat every time; ?feel=1 shows her emoji and her thought)
  kittywake: {
    start: () => ({ x: BED[0], z: BED[1], heading: BED_OUT, mode: 'sleep', timer: 60, energy: 0.3 }),
    script: [{ t: 1.7, type: 'pet' }],
    viewer: () => [BED[0] + Math.sin(BED_OUT) * 20, BED[1] + Math.cos(BED_OUT) * 20],
    mind: { seed: 6, sleepy: 0.9 },
    player: { ...BY_BED, script: [{ t: 1.25, type: 'wave' }] },
  },
  // Day 3: you run to the shop, and she trots along and waits by the door
  shopwalk: {
    start: () => ({ x: -1, z: 3, heading: 0.6, mode: 'sit' }),
    script: [{ t: 0.5, type: 'call', x: SHOP_WAIT[0], z: SHOP_WAIT[1] }],
    viewer: () => [8, 20],
    player: { start: { x: 6, z: 8, heading: Math.atan2(SHOP_DOOR[0] - 6, SHOP_DOOR[1] - 8) },
      script: [{ t: 0.35, type: 'go', x: SHOP_DOOR[0], z: SHOP_DOOR[1] }, { t: 4.6, type: 'face', x: 25, z: -27 }] },
  },
  // Day 3: a toy from the shop: the felt mouse comes out and she is after it
  kittytoy: {
    start: () => ({ x: 0, z: 0, heading: 0.35, mode: 'sit' }),
    script: [{ t: 0.05, type: 'wear', id: 'toymouse' }, { t: 0.3, type: 'play' }],
    viewer: () => [Math.sin(0.35) * 30, Math.cos(0.35) * 30],
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
    player: { ...BESIDE, script: [{ t: 5.9, type: 'wave' }] },
  },
  // Day 4: the fish on a stick is in your hand; you cast it to her, she pounces and bats it, you cast it again
  kittyfish: {
    start: () => ({ x: 4.5, z: -9.5, heading: Math.atan2(-7.5, 13.5), mode: 'sit' }),
    script: [{ t: 0.05, type: 'wear', id: 'toywand' }, { t: 1.15, type: 'castnear' }, { t: 7.6, type: 'cast', x: -9, z: -6 }],
    viewer: () => [-3, 4],
    player: { start: { x: -3, z: 4, heading: Math.atan2(7.5, -13.5) } },
  },
  // Day 4: a close look at the fish hanging from your stick (she watches it from behind)
  fishshow: {
    start: () => ({ x: -9.5, z: -6.5, heading: Math.atan2(9.5, 9.5), mode: 'sit', timer: 60 }),
    script: [{ t: 0.05, type: 'wear', id: 'toywand' }],
    viewer: () => [0, 3],
    player: { start: { x: 0, z: 3, heading: 0.35 } },
  },
  // Day 4: she is close by: you dangle the fish in front of her, and she pounces at it and bats it so it swings
  fishdangle: {
    start: () => ({ x: 5.5, z: -5.5, heading: Math.atan2(-6.5, 7.5), mode: 'sit' }),
    script: [{ t: 0.05, type: 'wear', id: 'toywand' }, { t: 0.6, type: 'dangle' }],
    viewer: () => [-1, 2],
    player: { start: { x: -1, z: 2, heading: Math.atan2(6.5, -7.5) } },
  },
  // Day 4: you run off with the fish trailing behind you on its line, and she tears after it
  fishwalk: {
    start: () => ({ x: -30, z: -3, heading: Math.PI / 2, mode: 'sit' }),
    script: [{ t: 0.05, type: 'wear', id: 'toywand' }, { t: 0.35, type: 'cast', x: -24, z: 1 }],
    viewer: () => [-18, 20],
    player: { start: { x: -19, z: 3, heading: -Math.PI / 2 }, script: [{ t: 1.5, type: 'go', x: 34, z: 3 }] },
  },
  // Day 5: an atom bomb falls at the spot where you stand (a dark ring shows where); you step out of the way; it
  // lands in a cloud of dust and leaves an atom box; you tap the box: the uranium hops up and an atom token flies
  // off (?atoms=1 shows the counter). She sits by and watches.
  atombox: {
    start: () => { const [x, z] = byBox(-4.8, 4.6); return { x, z, heading: Math.atan2(ABOX[0] + 9 - x, ABOX[1] - z), mode: 'sit', timer: 60 }; },
    script: [{ t: 0.15, type: 'bomb', x: ABOX[0], z: ABOX[1], rot: ABOX_ROT }, { t: 4.1, type: 'atom' }],
    viewer: () => byBox(14, 1),
    player: { start: (() => { const [x, z] = byBox(0.9, -0.5); return { x, z, heading: ABOX_ROT }; })(),
      script: [{ t: 0.85, type: 'go', x: byBox(3.6, -3.3)[0], z: byBox(3.6, -3.3)[1] }, { t: 3.15, type: 'face', x: ABOX[0], z: ABOX[1] }, { t: 3.85, type: 'wave' }] },
  },
  // Day 5: the same bomb, but you stay where you are: bonk, a cloud of dust, and no box
  atomhit: {
    start: () => { const [x, z] = byBox(-4.8, 4.6); return { x, z, heading: Math.atan2(ABOX[0] + 9 - x, ABOX[1] - z), mode: 'sit', timer: 60 }; },
    script: [{ t: 0.15, type: 'bomb', x: ABOX[0], z: ABOX[1], rot: ABOX_ROT }],
    viewer: () => byBox(14, 1),
    player: { start: (() => { const [x, z] = byBox(0.9, -0.5); return { x, z, heading: ABOX_ROT }; })(), script: [{ t: 1.2, type: 'wave' }] },
  },
  // Day 5: a close look: the bomb comes down, the box pops out of the dust and opens (the uranium)
  atomshow: {
    start: () => { const [x, z] = byBox(-9, 10); return { x, z, heading: Math.atan2(ABOX[0] - x, ABOX[1] - z), mode: 'sit', timer: 60 }; },
    script: [{ t: 0.1, type: 'bomb', x: ABOX[0], z: ABOX[1], rot: ABOX_ROT }, { t: 3.7, type: 'atom' }],
    viewer: () => byBox(9, 0),
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
  if (name === 'atombox' || name === 'atomhit') {
    // in front of the spot, a little above it: it lands in the middle, you step off to the left, she is behind it on
    // the right. The camera looks up at first (the bomb comes down into the frame) and settles on the box.
    const k = easeInOut(t / 6), down = easeInOut((t - 1.3) / 1.6);
    const [px, pz] = byBox(lerp(16.5, 15.0, k), lerp(0.2, 0.6, k));
    // (hit: it then looks up a little, at your ghost)
    const up = name === 'atomhit' ? easeInOut((t - 3.0) / 1.2) * 2.4 : 0;
    return { position: [px, lerp(6.6, 6.2, k), pz], look: [ABOX[0], lerp(8.5, 3.6, down) + up, ABOX[1]], shift: 0 };
  }
  if (name === 'atomshow') {
    // close on the spot, drifting slowly round its front: looking up as the bomb comes down, then at the box
    const a = -0.42 + 0.085 * t, d = lerp(9.6, 8.2, easeInOut(t / 6)), down = easeInOut((t - 1.5) / 1.4);
    const [px, pz] = byBox(Math.cos(a) * d, Math.sin(a) * d);
    return { position: [px, 4.6, pz], look: [ABOX[0], lerp(9, 3.9, down), ABOX[1]], shift: 0 };
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
  if (name === 'shopwalk' && kitty.player) {
    // behind your shoulder as you run: the shop grows ahead, the kitty comes into view beside you
    const p = kitty.player, dx = SHOP_DOOR[0] - 6, dz = SHOP_DOOR[1] - 8, d = Math.hypot(dx, dz), ux = dx / d, uz = dz / d;
    const back = lerp(15, 12.5, easeInOut(t / 5)), sidew = lerp(4.5, 2.5, easeInOut(t / 5));
    const pos = [p.x - ux * back - uz * sidew, lerp(6.4, 5.4, easeInOut(t / 5)), p.z - uz * back + ux * sidew];
    return { position: pos, look: [p.x + ux * 7, 4.6, p.z + uz * 7], shift: 0 };
  }
  if (name === 'kittyfish' && kitty.player) {
    // from your right, a little behind you: the stick in your hand near the camera, the fish out in front, her beyond it
    const p = kitty.player, ux = 0.4856, uz = -0.8742;             // the way you face at the start (toward her)
    const k = easeInOut((t - 1) / 3.5);
    const side = lerp(12.5, 16.5, k), back = lerp(7.5, 7.5, k);
    const pos = [p.x - uz * side - ux * back, lerp(6.4, 7.0, k), p.z + ux * side - uz * back];
    const ahead = lerp(4.5, 4.8, k);
    return { position: pos, look: [p.x + ux * ahead, 3.4, p.z + uz * ahead], shift: 0 };
  }
  if (name === 'fishdangle' && kitty.player) {
    // from your right again, closer: the rod down, the fish dancing on the floor between you, her going for it
    const p = kitty.player, ux = 0.655, uz = -0.756;
    const pos = [p.x - uz * 13.5 - ux * 4.5, 5.6, p.z + ux * 13.5 - uz * 4.5];
    return { position: pos, look: [p.x + ux * 5.5, 3.2, p.z + uz * 5.5], shift: 0 };
  }
  if (name === 'fishshow' && kitty.yarn) {
    // close on the fish as she turns on her line, drifting round her (you, out of focus of attention, behind her)
    const y = kitty.yarn, a = -0.37 + 0.09 * t, d = lerp(8.0, 6.6, easeInOut(t / 5)), h = y.y ?? 3.5;
    const pos = [y.x + Math.sin(a) * d, h + 0.7, y.z + Math.cos(a) * d];
    return { position: pos, look: [y.x, h + 0.9, y.z], shift: 0 };
  }
  if (name === 'fishwalk' && kitty.player) {
    // tracking beside you as you run: you lead, the fish skips along behind you, she gallops after it
    const p = kitty.player;
    const pos = [p.x - 1.5, 4.6, p.z + 25];
    return { position: pos, look: [p.x - 6.5, 3.6, p.z], shift: 0 };
  }
  if (name === 'kittywake') {
    // like the token shot but looking well above her: she sits low in the frame, with room over her head for
    // her name, her thought and the big emoji, all under the caption
    const a = BED_OUT + 0.4 - 0.04 * easeInOut(t / 5), d = lerp(20, 19.2, easeInOut(t / 5));
    const pos = [kx + Math.sin(a) * d, 4.4, kz + Math.cos(a) * d];
    return { position: pos, look: [kx, 11.3, kz], shift: 0 };
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
  if (name === 'kittyfeed' || name === 'kittyplay' || name === 'kittytoy') {
    // a wider shot that keeps her and the bowl (or the yarn) in frame, eased in once it appears
    const thing = name === 'kittyfeed' ? kitty.bowl : kitty.yarn;     // (the yarn's place is the toy's place)
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
