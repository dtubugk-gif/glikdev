// Scripted cameras for filming (?demo=<name>). Each pose is a pure function of t (seconds since
// the world was ready) and, for the kitty shots, of the kitty's own state at t (which is itself
// deterministic: kittybrain.js is seeded and stepped at a fixed rate), so a recorder that controls
// requestAnimationFrame / performance.now gets identical frames on every run.

export const DEMOS = ['orbit', 'reveal', 'kitty', 'kittycall', 'kittypet', 'kittywalk', 'kittyname', 'kittyfeed', 'kittyplay', 'kittynap',
  'kittytoken', 'kittydress', 'shopwalk', 'kittytoy', 'kittywake', 'kittyfish', 'fishwalk', 'fishshow', 'fishdangle',
  'atombox', 'atomhit', 'atomshow', 'friendmeet', 'friendcuddle', 'friendplay', 'friendfeed', 'friendnap', 'friendtricks',
  'parrotseed', 'gardenplant', 'gardenmutate', 'gardenpick', 'gardenshow', 'gardenposter',
  'homebed', 'homewalk', 'homebasket', 'homeposter'];

// Day 7: the garden (gardenlogic.js places it), its plots, the parrots' perch, and the ways out of their fronts
const GF = [Math.sin(GARDEN_AT.rot), Math.cos(GARDEN_AT.rot)];            // out of the bed's front
const GR = [Math.cos(GARDEN_AT.rot), -Math.sin(GARDEN_AT.rot)];           // along the bed (its own +x)
const PF = [Math.sin(PERCH_AT.rot), Math.cos(PERCH_AT.rot)];
/** a spot near the garden: f metres out of its front, s along it */
const byGarden = (f, s = 0) => { const q = gardenFrame(s, f); return [q.x, q.z]; };
const byPerch = (f, s = 0) => [PERCH_AT.x + PF[0] * f + GR[0] * s, PERCH_AT.z + PF[1] * f + GR[1] * s];
const facing = (from, to) => Math.atan2(to[0] - from[0], to[1] - from[1]);
const plot = (i) => { const q = plotAt(i); return [q.x, q.z]; };
/** where you stand to tend plot i: in front of the bed, straight out from the plot */
const tendSpot = (i) => {
  const [x, z] = plot(i), o = gardenFrame(0, 0);
  const out = GBED.d / 2 + 3.2 - ((x - o.x) * GF[0] + (z - o.z) * GF[1]);
  return [x + GF[0] * out, z + GF[1] * out];
};
// a full garden for the shots that need one (ages in seconds: well past ripe)
const MUT_BOMB = byGarden(14.5, 9);                      // (on the perch's side: her bed stays out of the shot)                     // where the filmed bomb lands: to the side of the bed's front
const GROWN = (list) => list.map((q) => (q ? { age: 400, ...q } : null));

import { GARDEN_AT, PERCH_AT, gardenFrame, plotAt, BED as GBED } from './gardenlogic.js';
import { HOME, HER_BED_AT, OWNER_BED, BASKET, homeFrame, DOOR_OUT } from './homelogic.js';

// Day 3: where the shop's doormat is, and where the kitty waits beside it (town.js works these out from SHOP)
const SHOP_DOOR = [19.97, -21.57], SHOP_WAIT = [12.84, -23.42];
// you, standing just behind her shoulder, turned to the camera (used by the close shots: in frame, not in her way)
const BESIDE = { start: { x: -3.81, z: -0.78, heading: 0.75 } };
// Day 3: her bed (town.js BED) and the way out of its front; you, standing beside it. Day 8: it is in the home.
const BED = [HER_BED_AT.x, HER_BED_AT.z], BED_OUT = HER_BED_AT.rot;
const BY_BED = { start: { ...homeFrame(-5.5, 1.5), heading: BED_OUT + 0.55 } };
// Day 8: the home. A spot in it, in its own frame (+z out of the door), as [x, z]; and the way out of its door
const H = (lx, lz) => { const q = homeFrame(lx, lz); return [q.x, q.z]; };
const HP = (lx, ly, lz) => { const q = homeFrame(lx, lz); return [q.x, ly, q.z]; };
const OUT = HOME.rot;                                    // heading out of the door

// Day 5: where the filmed atom bomb lands and leaves its box, the way the box's front faces (F: toward the camera
// and the sun) and its right-hand side (S)
const ABOX = [12.1, 6.3], ABOX_F = [-0.2614, 0.9652], ABOX_S = [0.9652, 0.2614], ABOX_ROT = Math.atan2(-0.2614, 0.9652);
const byBox = (f, s) => [ABOX[0] + ABOX_F[0] * f + ABOX_S[0] * s, ABOX[1] + ABOX_F[1] * f + ABOX_S[1] * s];
const lerp = (a, b, k) => a + (b - a) * k;
const xz = ([x, z]) => ({ x, z });
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
  // Day 7 (idea by @elenaabrosimova1968: "Parrots? Yes they give you seeds"): a parrot flies in to the perch with a
  // dragon fruit seed, squawks, and when you come over it drops the packet at your feet; you pick it up.
  parrotseed: {
    start: () => { const [x, z] = byPerch(7.5, -10); return { x, z, heading: facing([x, z], byPerch(2, 0)), mode: 'sit', timer: 60 }; },
    script: [{ t: 0.1, type: 'parrot', seed: 'dragonfruit' }, { t: 8.9, type: 'give' }, { t: 11.0, type: 'pickup' }],
    viewer: () => byPerch(20, 3),
    player: { start: (() => { const [x, z] = byPerch(9.5, -8.5); return { x, z, heading: facing([x, z], byPerch(0, 0)) }; })(),
      script: [{ t: 7.6, type: 'wave' }, { t: 9.9, type: 'go', x: byPerch(5.0, -3.2)[0], z: byPerch(5.0, -3.2)[1] }] },
    garden: { plots: GROWN([null, { fruit: 'pineapple' }, null, { fruit: 'mangosteen', age: 22 }, null, { fruit: 'dragonfruit', age: 30 }]) },
  },
  // you plant a pineapple seed; the garden runs as a time-lapse (x10): it sprouts, grows, and the fruit ripens
  gardenplant: {
    start: () => { const [x, z] = byGarden(13.5, 13); return { x, z, heading: facing([x, z], plot(1)), mode: 'sit', timer: 60 }; },
    script: [{ t: 0.55, type: 'plant', i: 1, fruit: 'pineapple' }],
    viewer: () => byGarden(26, 0),
    player: { start: (() => { const [x, z] = tendSpot(1); return { x: x + GR[0] * 2.2, z: z + GR[1] * 2.2, heading: facing([x, z], plot(1)) }; })(),
      script: [{ t: 0.15, type: 'pet', x: plot(1)[0], z: plot(1)[1] }, { t: 5.6, type: 'cheer' }] },
    garden: { rate: 10, plots: GROWN([{ fruit: 'dragonfruit', age: 30 }, null, { fruit: 'mangosteen', age: 12 }, null, null, null]) },
  },
  // an atom bomb comes down right in front of the garden; you step out of the ring; it lands, its wave runs over the
  // plants, and all three mutate: Irradiated, Cherenkov Glow, Atomic
  gardenmutate: {
    start: () => { const [x, z] = byGarden(16, -15); return { x, z, heading: facing([x, z], byGarden(0, 0)), mode: 'sit', timer: 60 }; },
    script: [{ t: 0.2, type: 'bomb', x: MUT_BOMB[0], z: MUT_BOMB[1], rot: GARDEN_AT.rot + 0.5,
      mutate: [[0, 'irradiated'], [1, 'cherenkov'], [2, 'atomic']] }],
    viewer: () => byGarden(32, 0),
    player: { start: (() => { const [x, z] = byGarden(14.2, 8.5); return { x, z, heading: GARDEN_AT.rot + Math.PI }; })(),
      script: [{ t: 0.95, type: 'go', x: byGarden(20, 19)[0], z: byGarden(20, 19)[1] }, { t: 3.3, type: 'face', x: GARDEN_AT.x, z: GARDEN_AT.z }, { t: 4.3, type: 'cheer' }] },
    garden: { plots: GROWN([{ fruit: 'pineapple' }, { fruit: 'dragonfruit' }, { fruit: 'mangosteen' }, null, null, null]) },
  },
  // the Atomic mangosteen tree is picked: its fruit hops off one by one, tokens fly to the counter, and an atom token
  gardenpick: {
    start: () => { const [x, z] = byGarden(13.5, 13); return { x, z, heading: facing([x, z], plot(1)), mode: 'sit', timer: 60 }; },
    script: [{ t: 0.75, type: 'pick', i: 1 }],
    viewer: () => byGarden(26, 0),
    player: { start: (() => { const [x, z] = tendSpot(1); return { x: x + GR[0] * 1.6, z: z + GR[1] * 1.6, heading: facing([x, z], plot(1)) }; })(),
      script: [{ t: 0.35, type: 'pet', x: plot(1)[0], z: plot(1)[1] }, { t: 2.6, type: 'cheer' }] },
    garden: { plots: GROWN([{ fruit: 'pineapple', mutation: 'cherenkov' }, { fruit: 'mangosteen', mutation: 'atomic' }, { fruit: 'dragonfruit', mutation: 'irradiated' },
      { fruit: 'dragonfruit' }, { fruit: 'pineapple', mutation: 'atomic' }, { fruit: 'mangosteen', mutation: 'cherenkov' }]) },
  },
  // the whole garden, mutated, with the parrot on its perch: a slow sweep past it (the opening shot)
  gardenshow: {
    start: () => { const [x, z] = byGarden(15, -12); return { x, z, heading: facing([x, z], byGarden(0, 0)), mode: 'sit', timer: 60 }; },
    script: [{ t: 0, type: 'parrot', seed: 'mangosteen', early: 7.4 }],
    viewer: () => byGarden(30, 0),
    garden: { plots: GROWN([{ fruit: 'pineapple', mutation: 'atomic' }, { fruit: 'mangosteen', mutation: 'cherenkov' }, { fruit: 'dragonfruit', mutation: 'irradiated' },
      { fruit: 'dragonfruit', mutation: 'cherenkov' }, { fruit: 'mangosteen', mutation: 'atomic' }, { fruit: 'pineapple', mutation: 'irradiated' }]) },
  },
  // the posters: past the parrot on its perch, into the mutated garden (fits an upright picture as well as a wide one)
  gardenposter: { start: (...a) => KITTY_DEMOS.gardenshow.start(...a), script: [{ t: 0, type: 'parrot', seed: 'mangosteen', early: 7.4 }],
    viewer: () => byGarden(30, 0), garden: { plots: GROWN([{ fruit: 'pineapple', mutation: 'atomic' }, { fruit: 'mangosteen', mutation: 'cherenkov' }, { fruit: 'dragonfruit', mutation: 'irradiated' },
      { fruit: 'dragonfruit', mutation: 'cherenkov' }, { fruit: 'mangosteen', mutation: 'atomic' }, { fruit: 'pineapple', mutation: 'irradiated' }]) } },
  // Day 6 (idea by @2warp-e8u: "Add another cat so the cat has an friend"): her friend, a cream kitten.
  // It comes galloping in from far away, pulls up in front of her and touches noses; she purrs
  friendmeet: {
    start: () => ({ x: 0, z: 0, heading: 0.55, mode: 'sit', timer: 60 }),
    script: [],
    viewer: () => [Math.sin(0.55) * 20, Math.cos(0.55) * 20],
    friend: { start: { x: -44, z: 30, heading: Math.atan2(44, -30), mode: 'idle', timer: 0.3 }, hello: true, script: [{ t: 6.4, type: 'nuzzle' }] },
  },
  // the two of them, close: it rubs its cheek along hers, then a nose boop
  friendcuddle: {
    start: () => ({ x: 0, z: 0, heading: 0.35, mode: 'sit', timer: 60 }),
    script: [],
    viewer: () => [Math.sin(0.35) * 20, Math.cos(0.35) * 20],
    friend: { start: { x: 6.6, z: 2.4, heading: -1.9, mode: 'sit', timer: 60 }, script: [{ t: 0.4, type: 'nuzzle' }, { t: 4.4, type: 'boop' }] },
  },
  // it shows off in front of her: a play bow, a happy hop, a flop onto its back
  friendtricks: {
    start: () => ({ x: 0, z: 0, heading: 0.4, mode: 'sit', timer: 60 }),
    script: [],
    viewer: () => [Math.sin(0.4) * 20, Math.cos(0.4) * 20],
    friend: { start: { x: 6.5, z: 6.5, heading: 0.45, mode: 'idle', timer: 60 },
      script: [{ t: 0.3, type: 'playbow', face: false }, { t: 2.0, type: 'hop', face: false }, { t: 3.1, type: 'tumble', face: false }] },
  },
  // she chases the yarn; it hops and bows at every swat, from out of her way
  friendplay: {
    start: () => ({ x: 0, z: 0, heading: 0.35, mode: 'sit' }),
    script: [{ t: 0.3, type: 'play' }],
    viewer: () => [Math.sin(0.35) * 30, Math.cos(0.35) * 30],
    friend: { start: { x: 9, z: 6, heading: -0.6, mode: 'sit', timer: 60 }, script: [] },
  },
  // dinner for two: one bowl, a kitty on each side
  friendfeed: {
    start: () => ({ x: 0, z: 0, heading: 0.35, mode: 'sit' }),
    script: [{ t: 0.3, type: 'feed' }],
    viewer: () => [Math.sin(0.35) * 30, Math.cos(0.35) * 30],
    needs: { hunger: 0.9, happy: 0.5 },
    friend: { start: { x: 8, z: 7, heading: -0.9, mode: 'sit', timer: 60 }, script: [] },
  },
  // she curls up for a nap, and it curls up right beside her
  friendnap: {
    start: () => ({ x: 0, z: 0, heading: 0.25, mode: 'sit', timer: 60 }),
    script: [{ t: 0.2, type: 'nap' }],
    viewer: () => [Math.sin(0.25) * 20, Math.cos(0.25) * 20],
    friend: { start: { x: 8.5, z: 4.5, heading: -1.2, mode: 'sit', timer: 60 }, script: [] },
  },
  // Day 8: bedtime, seen dollhouse-style (the roof is off): you hop into your bed and flop down, she goes to hers,
  // Mochi curls up in its basket, and everyone sleeps
  homebed: {
    start: () => ({ ...xz(H(1.5, 6.5)), heading: OUT + 0.25, mode: 'sit', timer: 60 }),
    script: [{ t: 0.5, type: 'tobed' }],
    viewer: () => H(0, 40),
    player: { start: { ...OWNER_BED.side, heading: OUT - 0.3 }, script: [{ t: 0.15, type: 'bed' }] },
    friend: { start: { ...xz(H(8.5, 5.5)), heading: OUT - 0.4, mode: 'sit', timer: 60 }, script: [{ t: 1.6, type: 'basket' }] },
    homeOpen: -10, napCoinsAt: 10.4,                     // (all three asleep by 9 s: the nap pays)
  },
  // Day 8: home time: you run in at the door with the two cats behind you, and the roof lifts off as you go in
  homewalk: {
    start: () => ({ ...xz(H(7, 31)), heading: OUT + Math.PI, mode: 'idle', timer: 60 }),
    script: [{ t: 0.4, type: 'call', ...xz(H(4.5, 4)) }],     // (called: she trots in with you)
    viewer: () => H(0, 40),
    player: { start: { ...xz(H(-2.5, 33)), heading: OUT + Math.PI }, script: [{ t: 0.2, type: 'go', ...xz(H(-6, -1)) }] },
    friend: { start: { ...xz(H(12, 35)), heading: OUT + Math.PI, mode: 'idle', timer: 60 }, script: [] },
    homeOpen: 2.1,
  },
  // Day 8: Mochi trots into its basket, turns round and curls up; she is asleep in her bed beside it
  homebasket: {
    start: () => ({ x: HER_BED_AT.x, z: HER_BED_AT.z, heading: OUT, mode: 'sleep', timer: 60, energy: 0.3 }),
    script: [{ t: 0, type: 'tobed' }],
    viewer: () => H(6, 40),
    friend: { start: { ...xz(H(9.5, 4.5)), heading: OUT + 2.6, mode: 'sit', timer: 60 }, script: [{ t: 0.4, type: 'basket' }] },
    homeOpen: -10, homeFocus: 'friend',
  },
  // Day 8: the poster: the cottage from the front, the two cats sitting at its door, you beside them
  homeposter: {
    start: () => ({ ...xz(H(-3, 17)), heading: OUT + 0.35, mode: 'sit', timer: 60 }),
    script: [],
    viewer: () => H(-6, 50),
    player: { start: { ...xz(H(-11, 17.5)), heading: OUT + 0.25 }, script: [] },
    friend: { start: { ...xz(H(4.5, 16.5)), heading: OUT - 0.2, mode: 'sit', timer: 60 }, script: [] },
    homeFocus: 'kitty',
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
  if (name === 'parrotseed') {
    // low in front of the perch: up at the sky as the parrot comes in, down onto the perch as it lands, then the
    // packet dropping to the ground in front of you
    const bird = kitty?.parrot;
    const [px, pz] = byPerch(lerp(18, 14.5, easeInOut((t - 5) / 3)), lerp(8.5, 6.5, easeInOut((t - 5) / 3)));
    const perchY = 5.2, near = clamp01((t - 4.6) / 2.2), down = easeInOut((t - 8.6) / 1.4);
    let look = [PERCH_AT.x, perchY, PERCH_AT.z];
    if (bird && t < 7.2) look = [lerp(bird.x, PERCH_AT.x, easeInOut(near)), lerp(bird.y, perchY, easeInOut(near)), lerp(bird.z, PERCH_AT.z, easeInOut(near))];
    const drop = byPerch(3.6, -1.2);
    look = [lerp(look[0], drop[0], down * 0.6), lerp(look[1], 2.2, down), lerp(look[2], drop[1], down * 0.6)];
    return { position: [px, lerp(3.2, 4.4, near), pz], look, shift: 0 };
  }
  if (name === 'gardenplant' || name === 'gardenpick') {
    // close on the plot from in front of the bed, a little to the side, pushing in; looking up as it grows
    const [qx, qz] = plot(1);
    const k = easeInOut(t / 6);
    const f = lerp(19, 16, k), sd = lerp(-2.2, -1.2, k);   // (just to the side of you: you crouch at the right, the plant in the middle)
    const pos = [qx + GF[0] * f + GR[0] * sd, lerp(5.8, 6.4, k), qz + GF[1] * f + GR[1] * sd];
    const up = name === 'gardenplant' ? lerp(1.6, 4.4, easeInOut((t - 1.5) / 4)) : lerp(4.8, 5.6, k);
    return { position: pos, look: [qx, up, qz], shift: 0 };
  }
  if (name === 'gardenmutate') {
    // in front of the garden and up a little: the bomb comes down into the frame between you and the plants, then the
    // camera settles on the three plants as they change
    // (it follows the bomb down onto its spot, then turns to the three plants as the wave reaches them)
    // (it rides down with the bomb: the bomb stays in the upper middle as the ring on the ground comes into view)
    const over = easeInOut((t - 2.9) / 1.3), close = easeInOut((t - 3.4) / 2.6);
    const [cx, cz] = byGarden(lerp(37, 29, close), lerp(10, 3, close));
    const [px, pz] = byGarden(2.5, 0);
    const fallK = clamp01((t - 0.2) / 2.8), bombY = 46 * (1 - fallK ** 1.5);
    const follow = Math.max(3.2, bombY * 0.72 + 1.5);
    const look = [lerp(MUT_BOMB[0], px, over), lerp(follow, 3.9, over), lerp(MUT_BOMB[1], pz, over)];
    return { position: [cx, lerp(8.5, 8.0, close), cz], look, shift: 0 };
  }
  if (name === 'gardenposter') {
    const [cx, cz] = byPerch(13, 9);
    const [lx, lz] = byGarden(2, 3);
    return { position: [cx, 7.2, cz], look: [lerp(lx, PERCH_AT.x, 0.42), 4.2, lerp(lz, PERCH_AT.z, 0.42)], shift: 0 };
  }
  if (name === 'gardenshow') {
    // a slow sweep round the front of the garden, the perch and its parrot on the right
    const a = -0.55 + 0.11 * t, d = lerp(30, 26, easeInOut(t / 6));
    const pos = [GARDEN_AT.x + Math.sin(GARDEN_AT.rot + a) * d, lerp(9, 7, easeInOut(t / 6)), GARDEN_AT.z + Math.cos(GARDEN_AT.rot + a) * d];
    const [lx, lz] = byGarden(1.5, 3);
    return { position: pos, look: [lx, 3.6, lz], shift: 0 };
  }
  if (name === 'homebed') {
    // the dollhouse view: high in front of the open front, looking down into the room; a slow push in and across,
    // from your bed and hers to the basket as Mochi curls up
    const k = easeInOut(t / 8), across = easeInOut((t - 2.2) / 4.5);
    const pos = HP(lerp(-5, -1, across), lerp(33, 30, k), lerp(40, 36, k));
    return { position: pos, look: HP(lerp(-4.5, 0, across), 0.5, -5.4), shift: 0 };
  }
  if (name === 'homebasket') {
    // close on the basket from the room's middle, a little above: Mochi in, round, and down
    const k = easeInOut(t / 6);
    return { position: HP(lerp(4, 5.5, k), lerp(9.5, 8.6, k), lerp(9.5, 7.8, k)), look: HP(12.2, 1.1, -5), shift: 0 };
  }
  if (name === 'homeposter') {
    // (wide or tall: the camera is a little to the left and well back, so you, her and Mochi all fit in a phone's frame)
    const tall = home.fov > 58;
    return { position: tall ? HP(-9, 10, 64) : HP(-17, 10.5, 52), look: tall ? HP(-2.5, 7.4, 0) : HP(-2, 8.5, 0), shift: 0 };
  }
  if (name === 'homewalk' && kitty?.player) {
    // behind you and up, as you run for the door; then up over the front wall as the roof lifts, looking in
    const p = kitty.player, inK = easeInOut((t - 2.2) / 2.6);
    const [bx, bz] = H(0, 1), [ox, oz] = [bx - HOME.x, bz - HOME.z];                      // out of the door, as a direction
    const back = lerp(17, 30, inK), up = lerp(8, 24, inK);
    const pos = [p.x + ox * back + oz * 3, up, p.z + oz * back - ox * 3];
    return { position: pos, look: [p.x - ox * lerp(6, 3, inK), lerp(3.6, 1.4, inK), p.z - oz * lerp(6, 3, inK)], shift: 0 };
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
  if (name.startsWith('friend') && kitty.friend) {
    // the two cats together: the camera frames the pair, a little lower than her eyes, drifting slowly round them
    const fr = kitty.friend;
    const near = clamp01((30 - Math.hypot(fr.x - kx, fr.z - kz)) / 18);              // the friend still far off: frame her
    const mx = lerp(kx, (kx + fr.x) / 2, near), mz = lerp(kz, (kz + fr.z) / 2, near);
    const span = lerp(0, Math.hypot(fr.x - kx, fr.z - kz), near);
    const base = { friendmeet: 1.75, friendcuddle: -0.2, friendtricks: 0.42, friendplay: 0.65, friendfeed: 0.65, friendnap: 0.55 }[name];
    const a = base + 0.03 * t;
    const d = { friendmeet: lerp(22, 15.5, easeInOut((t - 2) / 4)), friendplay: 21, friendfeed: lerp(21, 16.5, easeInOut((t - 1) / 2)) }[name] ?? 13.5 + span * 0.55;
    const h = name === 'friendnap' ? 3.4 : 3.9;
    const pos = [mx + Math.sin(a) * d, h, mz + Math.cos(a) * d];
    const look = [mx, name === 'friendnap' ? 3.6 : 4.6, mz];
    // the meeting: it starts on the friend galloping in, far off to the side, then settles on the two of them
    if (name === 'friendmeet') {
      const k = easeInOut((t - 0.4) / 3.2);
      const sx = lerp(fr.x, kx, 0.42), sz = lerp(fr.z, kz, 0.42);        // both of them in the picture from the start
      look[0] = lerp(sx, mx, k); look[2] = lerp(sz, mz, k);
      look[1] = lerp(3.2, 4.6, k);
    }
    return { position: pos, look, shift: 0 };
  }
  if (name === 'kittywalk') {
    // tracking alongside, a little ahead of her
    const pos = [kx + 3, 3.0, kz + 24];                             // low, so she walks along the lower half
    return { position: pos, look: [kx + 1, 7.0, kz], shift: 0 };
  }
  return null;
}
