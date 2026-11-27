// Day 7 (idea by @elenaabrosimova1968): parrots bring you seeds (pineapple, pitahaya = dragon fruit, mangosteen);
// you plant them in the garden; they grow and fruit. And "special mutations if a nuke explodes near the plant":
// an atom bomb that lands close to a plant turns it Irradiated, Cherenkov Glow or Atomic, and its fruit is worth
// more. Pure logic, no three.js and no DOM, so it runs the same in the browser, in node tests and in recordings.
//
// Times are seconds on the kitty's clock (main.js passes kitty.t), the clock every recording is stepped on.

/** The three fruit. grow: seconds from planting to each stage; fruit: how many hang on a grown plant; each: the
 *  friendship tokens one fruit is worth (before a mutation). `node` is the plant's name in models/garden.glb. */
export const FRUITS = [
  { id: 'pineapple', name: 'Pineapple', node: 'Pineapple', grow: { sprout: 2.5, young: 20, grown: 42 }, fruit: 1, each: 4 },
  { id: 'dragonfruit', name: 'Dragon fruit', node: 'Dragonfruit', grow: { sprout: 2.5, young: 24, grown: 52 }, fruit: 3, each: 2 },
  { id: 'mangosteen', name: 'Mangosteen', node: 'Mangosteen', grow: { sprout: 2.5, young: 28, grown: 64 }, fruit: 4, each: 2 },
];
export const fruitById = (id) => FRUITS.find((f) => f.id === id) || null;

/** The viewer's three mutations, rarest last. mult: what each fruit is worth, times; atoms: atom tokens a whole
 *  harvest of it gives as well. */
export const MUTATIONS = [
  { id: 'irradiated', name: 'Irradiated', rank: 1, mult: 2, atoms: 0, odds: 0.55 },
  { id: 'cherenkov', name: 'Cherenkov Glow', rank: 2, mult: 3, atoms: 0, odds: 0.3 },
  { id: 'atomic', name: 'Atomic', rank: 3, mult: 5, atoms: 1, odds: 0.15 },
];
export const mutationById = (id) => MUTATIONS.find((m) => m.id === id) || null;

/** How far from where a bomb lands a plant still gets it (m), and the plots the garden has. */
export const GARDEN = { reach: 19, plots: 6 };

// ---------------------------------------------------------------- where it all is (metres in the world)
export const SCALE = 14;                                  // the models are drawn this much bigger than their cat-scale metres
/** The middle of the garden's bed, and which way its front faces (toward the middle of the plate). */
export const GARDEN_AT = { x: -14, z: -42 };              // (straight ahead of where you start, so it is seen at once)
GARDEN_AT.rot = Math.atan2(-GARDEN_AT.x, -GARDEN_AT.z);
/** A point in the bed's own frame (lx to its right as you face its front, lz out of its front) in the world. */
export function gardenFrame(lx, lz) {
  const c = Math.cos(GARDEN_AT.rot), s = Math.sin(GARDEN_AT.rot);
  return { x: GARDEN_AT.x + c * lx + s * lz, z: GARDEN_AT.z - s * lx + c * lz };
}
/** The bed's size in the world (garden.js sets it from garden.json once it has loaded) and its six spots, in its
 *  own frame (cat-scale metres from garden.json, [x, z] with z out of the front: front row 0-2, back row 3-5). */
export const BED = { w: 1.45 * SCALE, d: 0.95 * SCALE };
export const PLOT_LOCAL = [[-0.45, 0.205], [0, 0.205], [0.45, 0.205], [-0.45, -0.205], [0, -0.205], [0.45, -0.205]];
/** plot i in the world (as planned; garden.js uses the model's own spots) */
export const plotAt = (i) => gardenFrame(PLOT_LOCAL[i][0] * SCALE, PLOT_LOCAL[i][1] * SCALE);
/** The parrots' perch: beside the bed, on its right as you look at its front; it faces the same way. */
export const PERCH_AT = { ...gardenFrame(15.5, 3.5), rot: GARDEN_AT.rot };

const STAGES = ['mound', 'sprout', 'young', 'grown'];
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const easeOutBack = (k, s = 2.1) => { k = clamp01(k); return 1 + (s + 1) * (k - 1) ** 3 + s * (k - 1) ** 2; };

/** A number 0..1 from two integers (the same pair always gives the same number). */
export function hash01(a, b = 0) {
  let h = (Math.imul(a | 0, 0x9e3779b1) + Math.imul((b | 0) ^ 0x632be5ab, 0x85ebca77) + 0x6a09e667) | 0;
  for (let k = 0; k < 2; k++) {                          // murmur3's finaliser, twice: neighbouring inputs land far apart
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  }
  return (h >>> 0) / 4294967296;
}

/**
 * Which mutation a bomb gives. `roll` is 0..1 (the luck of it), `close` 0..1 (1 = it landed right beside the plant:
 * a closer bomb is likelier to give a rarer one). `had` is the plant's mutation so far: a plant only ever moves up
 * (an Atomic plant stays Atomic); null when this bomb changes nothing.
 */
export function mutationFor(roll, close = 0, had = null) {
  const r = clamp01(roll) * 0.999999, u = r + (1 - r) * 0.35 * clamp01(close);   // close by: pushed toward the rarer end
  let pick = MUTATIONS[0], acc = 0;
  for (const m of MUTATIONS) { acc += m.odds; pick = m; if (u < acc) break; }
  const before = mutationById(had);
  if (before && before.rank >= pick.rank) {
    // already that or better: a second bomb still has a fair chance to push it one step up
    if (before.rank >= MUTATIONS.length) return null;
    return u > 0.5 ? MUTATIONS[before.rank].id : null;
  }
  return pick.id;
}

/**
 * A plant `age` seconds after it was planted.
 * @returns {{stage:'mound'|'sprout'|'young'|'grown', k:number, pop:number, ripe:boolean}}
 *   k 0..1: how far it is to the next stage (1 when grown); pop: its scale as it springs up into the stage it has
 *   just reached (overshoots a little, then settles at 1); ripe: grown, fruit ready to pick
 */
export function stageAt(fruit, age) {
  const f = typeof fruit === 'string' ? fruitById(fruit) : fruit;
  const g = f ? f.grow : { sprout: 1, young: 2, grown: 3 };
  const at = [0, g.sprout, g.young, g.grown];
  let i = 0;
  while (i < 3 && age >= at[i + 1]) i++;
  const k = i < 3 ? clamp01((age - at[i]) / (at[i + 1] - at[i])) : 1;
  const pop = Math.max(0.001, easeOutBack((age - at[i]) / 0.55));
  return { stage: STAGES[i], k, pop, ripe: i === 3 };
}

/** What a harvest gives: friendship tokens (every fruit, times the mutation) and atom tokens (Atomic). */
export function harvestValue(fruit, mutation = null, count = null) {
  const f = typeof fruit === 'string' ? fruitById(fruit) : fruit;
  if (!f) return { tokens: 0, atoms: 0 };
  const m = mutationById(mutation);
  const n = count == null ? f.fruit : Math.max(0, Math.min(f.fruit, count | 0));
  return { tokens: f.each * n * (m ? m.mult : 1), atoms: m && n > 0 ? m.atoms : 0 };
}

/**
 * The garden's plots: what grows where, since when, and how it mutated. `saved` is what toJSON() gave earlier
 * (ages in seconds; anything broken is dropped, plot by plot). `t` is the clock now. `rate`: how fast things
 * grow (1 = live play; a recording may run its garden as a time-lapse). A plant's `planted` time is on the clock
 * as if it grew at that rate, so ages are always (t - planted) * rate.
 */
export function createPlots(saved = null, t = 0, n = GARDEN.plots, rate = 1, seed = 1) {
  const plots = Array.from({ length: n }, () => null);
  let rolls = 0, visits = 0;
  const ageOf = (p, t) => Math.max(0, (t - p.planted) * rate);
  function load(saved, t) {
    plots.fill(null); rolls = 0; visits = 0;
    if (!saved || typeof saved !== 'object') return;
    rolls = Number.isInteger(saved.rolls) && saved.rolls >= 0 ? saved.rolls : 0;
    if (Number.isInteger(saved.seed)) seed = saved.seed;                // this garden's own luck (kept with it)
    visits = Number.isInteger(saved.visits) && saved.visits >= 0 ? saved.visits : 0;
    const list = Array.isArray(saved.plots) ? saved.plots : [];
    for (let i = 0; i < n; i++) {
      const p = list[i];
      if (!p || !fruitById(p.fruit)) continue;
      const age = Number.isFinite(Number(p.age)) ? Math.max(0, Math.min(36000, Number(p.age))) : 0;
      plots[i] = { fruit: p.fruit, planted: t - age / rate, mutation: mutationById(p.mutation) ? p.mutation : null, mutatedAt: -1e9 };
    }
  }
  load(saved, t);
  const api = {
    load,
    get rate() { return rate; },
    /** parrot visits so far (so the seeds come round in turn, across visits to the page) */
    get visits() { return visits; },
    set visits(v) { visits = Math.max(0, v | 0); },
    get size() { return n; },
    /** plot i: {fruit, planted, mutation, mutatedAt} or null when it is empty */
    at: (i) => plots[i] || null,
    isEmpty: (i) => i >= 0 && i < n && !plots[i],
    firstEmpty: () => plots.findIndex((p) => !p),
    /** plants it (false when the plot is taken or the fruit is unknown) */
    plant(i, fruit, t) {
      if (i < 0 || i >= n || plots[i] || !fruitById(fruit)) return false;
      plots[i] = { fruit, planted: t, mutation: null, mutatedAt: -1e9 };
      return true;
    },
    age: (i, t) => (plots[i] ? ageOf(plots[i], t) : 0),
    stage: (i, t) => (plots[i] ? stageAt(plots[i].fruit, ageOf(plots[i], t)) : null),
    ripe: (i, t) => !!plots[i] && stageAt(plots[i].fruit, ageOf(plots[i], t)).ripe,
    /** seconds (live) until plot i is ripe: 0 when it is, null when nothing grows there */
    ripeIn: (i, t) => (plots[i] ? Math.max(0, (fruitById(plots[i].fruit).grow.grown - ageOf(plots[i], t)) / rate) : null),
    /**
     * A bomb landed at (x, z) at t; `where(i)` gives plot i's {x, z} in the world. Every plant in reach rolls for a
     * mutation. @returns {{i:number, mutation:string, from:string|null, close:number}[]} the plants that changed
     */
    blast(x, z, t, where, reach = GARDEN.reach) {
      const out = [];
      for (let i = 0; i < n; i++) {
        const p = plots[i];
        if (!p) continue;
        const w = where(i), d = Math.hypot(w.x - x, w.z - z);
        if (d > reach) continue;
        const close = 1 - d / reach;
        const m = mutationFor(hash01(++rolls + seed * 7919, i + 1), close, p.mutation);
        if (!m) continue;
        out.push({ i, mutation: m, from: p.mutation, close });
        p.mutation = m; p.mutatedAt = t;
      }
      return out;
    },
    /** a recording: this plot gets this mutation, now */
    setMutation(i, m, t) { if (plots[i] && mutationById(m)) { plots[i].mutation = m; plots[i].mutatedAt = t; return true; } return false; },
    /** picks a ripe plant: what it gave, and the plot is empty again (null when it is not ripe) */
    harvest(i, t) {
      const p = plots[i];
      if (!p || !stageAt(p.fruit, ageOf(p, t)).ripe) return null;
      plots[i] = null;
      return { fruit: p.fruit, mutation: p.mutation, ...harvestValue(p.fruit, p.mutation) };
    },
    /** a recording starting over */
    clear() { plots.fill(null); rolls = 0; visits = 0; },
    toJSON: (t) => ({ rolls, visits, seed, plots: plots.map((p) => (p ? { fruit: p.fruit, age: +ageOf(p, t).toFixed(1), ...(p.mutation ? { mutation: p.mutation } : {}) } : null)) }),
  };
  return api;
}

/** Parrots (Day 7): when the first one comes, how long from one visit to the next, and how long one waits on the
 *  perch for you before it flies off anyway (leaving its seed on the tray). The seeds come round in turn. */
export const PARROT = { first: 9, every: 32, wait: 40, near: 13 };
export const seedFor = (visit) => FRUITS[((visit % FRUITS.length) + FRUITS.length) % FRUITS.length].id;
