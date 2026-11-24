// Day 3: friendship tokens (idea by @Kowffe). Pure logic, no three.js and no DOM, so it runs the same
// in the browser, in node tests and in frame-exact recordings.
//
// Looking after the kitty earns tokens:
//   she starts to purr (you petted her)         +1
//   she finishes a bowl of food                 +3
//   she bats the yarn (three times a game)      +1 each
//   she comes when you call her                 +1 (at most once every 20 s)
// Upsetting her loses them again (the owner's rule, Day 4: "if the cat is angry at me, I lose coins"):
//   she gets a bit cross with you               -1
//   she gets angry                              -2 (in all)
//   she gets furious (woken from her nap)       -4 (in all)
//   she gets sad (she asked, you ignored her)   -1
// Tokens buy things for her to wear, and toys. One thing per slot (hat, face, neck, back, and the toy she
// plays with); what she owns and what is out stay on this device.

/** What the shop sells. `node` is the object's name in models/outfits.glb, `fit` the fitting frame it uses. */
export const ITEMS = [
  { id: 'bowtie', name: 'Bow tie', node: 'BowTie', slot: 'neck', fit: 'neck', price: 5 },
  { id: 'strawhat', name: 'Straw hat', node: 'StrawHat', slot: 'hat', fit: 'hat', price: 8 },
  { id: 'flowercrown', name: 'Flower crown', node: 'FlowerCrown', slot: 'hat', fit: 'hat', price: 10 },
  { id: 'scarf', name: 'Cosy scarf', node: 'Scarf', slot: 'neck', fit: 'neck', price: 12 },
  { id: 'shades', name: 'Heart shades', node: 'Shades', slot: 'face', fit: 'shades', price: 15 },
  { id: 'wizardhat', name: 'Wizard hat', node: 'WizardHat', slot: 'hat', fit: 'hat', price: 20 },
  { id: 'wings', name: 'Angel wings', node: 'Wings', slot: 'back', fit: 'back', price: 30 },
  { id: 'crown', name: 'Royal crown', node: 'Crown', slot: 'hat', fit: 'hat', price: 40 },
  // toys: the one that is out takes the yarn ball's place in her game (roll: it rolls like a ball;
  // bounce: how much of its fall it keeps; jingle: it rings when it lands or is batted)
  { id: 'toyball', name: 'Rainbow ball', node: 'ToyBall', slot: 'toy', price: 6, roll: true, bounce: 0.66 },
  { id: 'toymouse', name: 'Felt mouse', node: 'ToyMouse', slot: 'toy', price: 10, roll: false, bounce: 0.2 },
  { id: 'toyjingle', name: 'Jingle ball', node: 'ToyJingle', slot: 'toy', price: 14, roll: true, bounce: 0.5, jingle: true },
  { id: 'toyfish', name: 'Plush fish', node: 'ToyFish', slot: 'toy', price: 18, roll: false, bounce: 0.25 },
  // Day 4 (idea by @Darkbacon155): a fish on a stick. You hold the stick; the fish hangs from it on a line and
  // you cast it about for her to chase (models/wand.glb, not outfits.glb: `wand` marks it). It is bought in the
  // shop like every other toy (the owner's choice; for its first hours it was a present: see createWallet).
  { id: 'toywand', name: 'Fish on a stick', slot: 'toy', price: 12, roll: false, bounce: 0.15, wand: true, jingle: true },
];
/** The day's new thing: the shop shows it first among the toys, with a "New" badge, until it is yours. */
export const NEW_ITEM = 'toywand';
export const SLOTS = ['hat', 'face', 'neck', 'back', 'toy'];
export const itemById = (id) => ITEMS.find((i) => i.id === id) || null;

// Day 5 (idea by @elenaabrosimova1968: "Add URANIUM and PLUTONIUM... in a box that you can tap (gives you some
// special tokens you will need to upgrade things or for skins)"). The atom box stands on the plate; tapping it
// when its gauge is full pops a chunk of uranium or plutonium out and gives one atom token, then it charges
// again. Atom tokens are a second purse: they buy fur skins for the ginger kitty (her coat in another colour).
export const ATOM_BOX = { recharge: 20, gives: 1 };
/** Fur skins: the ginger kitty's own coat, recoloured (models/skins/<id>.webp, made by art/day05/make_skins.py). */
export const SKINS = [
  { id: 'silver', name: 'Silver', price: 3 },
  { id: 'tuxedo', name: 'Tuxedo', price: 5 },
  { id: 'atomic', name: 'Atomic', price: 8 },
];
export const skinById = (id) => SKINS.find((k) => k.id === id) || null;

export const CALL_COOLDOWN = 20;
export const MAX_TOKENS = 9999;

/**
 * How many tokens one of the kitty's events is worth. `state` remembers the last paid call
 * (`state.callAt`, seconds on her clock) and is updated here.
 * @param {{type:string, t:number, goal?:string}} e
 * @param {{callAt?:number}} state
 */
export function rewardFor(e, state = {}) {
  switch (e.type) {
    case 'purr': return 1;
    case 'eaten': return 3;
    case 'swat': return e.solo ? 0 : 1;                  // her own game, played by herself, earns nothing
    case 'answered': return 2;                           // she came to ask you for something, and you did it
    case 'arrive':
      if (e.goal !== 'call') return 0;
      if (state.callAt != null && e.t - state.callAt < CALL_COOLDOWN) return 0;
      state.callAt = e.t;
      return 1;
    default: return 0;
  }
}

/** What her bad feelings cost, in all (a kitty who goes from a bit cross to angry costs one more, not two more). */
export const LOSS = { grumpy: 1, angry: 2, furious: 4, sad: 1 };
const CROSS = { grumpy: 1, angry: 2, furious: 3 };       // how cross she is

/**
 * How many tokens one of her 'feel' events costs you. Getting crosser costs the difference; calming down costs
 * nothing; sadness costs when it starts (not when it is only her anger wearing off). Falling asleep changes
 * nothing. `state` remembers how she felt last (`state.felt`) and is updated here.
 * @param {{type:string, id?:string}} e
 * @param {{felt?:string}} state
 */
export function penaltyFor(e, state = {}) {
  if (e.type !== 'feel' || e.id === 'asleep') return 0;
  const was = state.felt || 'content';
  state.felt = e.id;
  if (CROSS[e.id]) return CROSS[e.id] > (CROSS[was] || 0) ? LOSS[e.id] - (CROSS[was] ? LOSS[was] : 0) : 0;
  if (e.id === 'sad') return CROSS[was] || was === 'sad' ? 0 : LOSS.sad;
  return 0;
}

const int = (n) => (Number.isFinite(Number(n)) ? Math.max(0, Math.min(MAX_TOKENS, Math.floor(Number(n)))) : 0);

/**
 * The purse and the wardrobe. `saved` is whatever toJSON() returned earlier (anything else is ignored,
 * piece by piece: a broken save never loses the rest).
 * A save from Day 4's first hours, when the fish on a stick was a present (it lists it under `gifts`), gives it
 * back: now it has to be bought. Nothing else in such a save changes.
 */
export function createWallet(saved = null) {
  const s = saved && typeof saved === 'object' ? saved : {};
  let tokens = int(s.tokens);
  let earned = Math.max(tokens, int(s.earned));
  let atoms = int(s.atoms);
  const skins = new Set((Array.isArray(s.skins) ? s.skins : []).filter((id) => skinById(id)));
  const given = new Set(Array.isArray(s.gifts) ? s.gifts : []);
  const owned = new Set((Array.isArray(s.owned) ? s.owned : []).filter((id) => itemById(id) && !given.has(id)));
  const wearing = {};
  for (const slot of SLOTS) {
    const id = s.wearing && typeof s.wearing === 'object' ? s.wearing[slot] : null;
    const it = itemById(id);
    wearing[slot] = it && it.slot === slot && owned.has(id) ? id : null;
  }
  return {
    get tokens() { return tokens; },
    /** every token ever earned (spending does not lower it) */
    get earned() { return earned; },
    owns: (id) => owned.has(id),
    /** a copy: {hat, face, neck, back} -> item id or null */
    get wearing() { return { ...wearing }; },
    isWearing: (id) => { const it = itemById(id); return !!it && wearing[it.slot] === id; },
    canBuy: (id) => { const it = itemById(id); return !!it && !owned.has(id) && tokens >= it.price; },
    earn(n) {
      const k = int(n);
      tokens = Math.min(MAX_TOKENS, tokens + k);
      earned = Math.min(MAX_TOKENS * 100, earned + k);
      return k;
    },
    /** takes tokens away (never below none); returns how many really went. What was earned in all stays. */
    lose(n) {
      const k = Math.min(tokens, int(n));
      tokens -= k;
      return k;
    },
    /** atom tokens (Day 5): from the atom box, spent on fur skins */
    get atoms() { return atoms; },
    earnAtoms(n) { const k = int(n); atoms = Math.min(MAX_TOKENS, atoms + k); return k; },
    ownsSkin: (id) => skins.has(id),
    canBuySkin: (id) => { const k = skinById(id); return !!k && !skins.has(id) && atoms >= k.price; },
    /** buys a fur skin with atom tokens; false when it is unknown, already hers or too dear */
    buySkin(id) {
      const k = skinById(id);
      if (!k || skins.has(id) || atoms < k.price) return false;
      atoms -= k.price;
      skins.add(id);
      return true;
    },
    /** buys it and puts it on; false when it is unknown, already hers or too dear */
    buy(id) {
      const it = itemById(id);
      if (!it || owned.has(id) || tokens < it.price) return false;
      tokens -= it.price;
      owned.add(id);
      wearing[it.slot] = id;
      return true;
    },
    /** puts on something she owns (taking off what was in that slot); false otherwise */
    wear(id) {
      const it = itemById(id);
      if (!it || !owned.has(id)) return false;
      wearing[it.slot] = id;
      return true;
    },
    takeOff(slot) {
      if (!SLOTS.includes(slot) || !wearing[slot]) return false;
      wearing[slot] = null;
      return true;
    },
    toJSON: () => ({ tokens, earned, owned: [...owned], wearing: { ...wearing }, atoms, skins: [...skins] }),
  };
}
