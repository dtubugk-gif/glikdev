// The kitty's mind (asked for by the owner: "make it have an AI mind, but a quick one, so it could decide
// things really fast if it wants or doesn't want", "an actual something" with habits).
//
// Pure logic, no three.js, seeded: the same seed and the same calls always give the same cat, so it runs the
// same in the browser and in node tests. It is small on purpose: every decision is a handful of sums through
// one squashing function (a single layer of little "neurons"), so she makes up her mind in about a millionth
// of a second, on the spot, with no waiting and nothing sent anywhere.
//
// What is in her head:
//   temper   who she is, fixed for life: playful, cuddly, greedy, lazy, independent (each 0-1, from her seed)
//   urges    what builds up while it is not satisfied: play, company, curiosity (hunger, energy and happiness
//            are her body's and live in kittybrain.js; the mind reads them)
//   bond     how much she trusts you (0-1). It grows when things go well and when you answer her; it shrinks a
//            little when you push her after she said no, or ignore her when she asks.
//   likes    what she has learned to enjoy: one number per thing you can do with her (come, pet, feed, play),
//            nudged up by every good time and down when it is forced on her. This is the learning part.
//   feelings anger, joy, love and sadness: they flare up from what happens to her (woken from a nap, a good
//            cuddle, a game, being ignored when she asked) and fade with time. They colour every decision (a
//            cross cat wants to be left alone) and show on her face (emotion(s), drawn by emotes.js).
//            Sleepiness builds while she is awake: when she has had enough of the day she goes for a nap.
//   habits   how often she has done one thing after another. The more often, the more she does it again:
//            her own routines. And her spot: where she has napped before is where she goes to nap.
//
// decide(verb, s)  -> does she want to? { yes, want 0-1, mood 'eager'|'ok'|'reluctant'|'no', why }
// choose(s)        -> what she does next on her own
// thought(s)       -> what is on her mind right now (for the thought bubble)
// emotion(s)       -> how she feels right now: { id, word } (id is one of EMOTIONS)
// feel(what)       -> something happened to her feelings ('woken', 'rested', ...)
// `s` is what she senses this instant (see sense() in kittybrain.js).

/** mulberry32: small, fast, seedable (the same generator as kittybrain.js; her mind draws from its own). */
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

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const squash = (z) => 1 / (1 + Math.exp(-z));              // any sum -> how much she wants it, 0-1
const num = (v, d) => (Number.isFinite(v) ? v : d);

export const TRAITS = ['playful', 'cuddly', 'greedy', 'lazy', 'independent'];
export const VERBS = ['call', 'pet', 'feed', 'play'];
/** the things she can choose to do on her own */
export const DOINGS = ['sit', 'groom', 'nap', 'wander', 'eat', 'cuddle', 'playask', 'follow'];

/** Who she is: five traits from her seed, each 0.15-0.9, never all the same. */
export function temperFromSeed(seed) {
  const r = rng((seed >>> 0) ^ 0x51ed270b);
  const t = {};
  for (const k of TRAITS) t[k] = +(0.15 + 0.75 * r()).toFixed(3);
  if (t.lazy > 0.7 && t.playful > 0.7) t.lazy = +(t.lazy - 0.35).toFixed(3);   // not both at once
  return t;
}

/** Her two strongest traits, in words (for the "her mind" card). */
export function describeTemper(t) {
  const words = { playful: 'Playful', cuddly: 'Cuddly', greedy: 'Loves her food', lazy: 'Sleepyhead', independent: 'Independent' };
  return TRAITS.slice().sort((a, b) => t[b] - t[a]).slice(0, 2).map((k) => words[k]);
}

/** every feeling she can show, and the word for it */
export const EMOTIONS = { content: 'Content', happy: 'Happy', loving: 'Full of love', playful: 'Playful', sleepy: 'Sleepy',
  asleep: 'Asleep', hungry: 'Hungry', grumpy: 'A bit cross', angry: 'Angry', furious: 'Furious', sad: 'Sad' };

const WHY = {
  angry: 'Leave me alone',
  asleep: 'Sleeping', eating: 'Still eating', playing: 'Busy playing', mood: 'Not now', tired: 'Too sleepy',
  enough: 'Enough pets', wantsplay: 'Wants to play', full: 'Not hungry', hungry: 'Too hungry', justate: 'Just ate',
};
/** A short line for the screen: why she said no (or that she gave in). */
export function sayWhy(d) {
  if (!d) return '';
  if (d.yes) return d.mood === 'reluctant' ? 'Oh, all right' : '';
  return WHY[d.why] || 'Not now';
}

/**
 * @param {{seed?:number, saved?:object}} [o]  saved: what toJSON() gave last time (she remembers)
 */
export function createMind(o = {}) {
  const sv = o.saved && typeof o.saved === 'object' ? o.saved : {};
  const seed = (Number.isFinite(sv.seed) ? sv.seed : (o.seed ?? 7)) >>> 0;
  const rand = rng(seed ^ 0x9e3779b9);
  const temper = temperFromSeed(seed);

  const m = {
    seed, temper,
    bond: clamp(num(sv.bond, 0.35)),
    play: clamp(num(sv.play, 0.35)),                       // urge to play
    social: clamp(num(sv.social, 0.4)),                    // urge for company
    curious: 0.3,
    sleepy: clamp(num(sv.sleepy, 0.2)),                    // builds while she is awake; a nap takes it away
    mood: { anger: 0, joy: 0.2, love: 0, sad: 0 },         // her feelings just now (this visit only)
    likes: {}, habit: {},
    spot: sv.spot && Number.isFinite(sv.spot.x) && Number.isFinite(sv.spot.z) ? { x: sv.spot.x, z: sv.spot.z, n: Math.max(1, Math.min(8, sv.spot.n | 0)) } : null,
    last: 'sit',                                           // the last thing she chose to do
    decisions: 0,
    pets: [],                                              // when she was petted lately (this visit only)
    refused: {},                                           // verb -> { t, n }: she said no, and how often in a row
    fedUp: -1e9,                                           // had enough petting: hands off until this time
    lastDecision: null,
  };
  for (const v of VERBS) m.likes[v] = clamp(num(sv.likes?.[v], 0), -1, 1);
  if (sv.habit && typeof sv.habit === 'object') {
    for (const [k, n] of Object.entries(sv.habit)) {
      const [a, b] = k.split('>');
      if (DOINGS.includes(a) && DOINGS.includes(b) && Number.isFinite(n) && n > 0) m.habit[k] = Math.min(40, n);
    }
  }

  /** Urges build up over time and drain while they are being met. */
  m.step = (dt, s) => {
    const T = temper;
    m.play = clamp(m.play + (s.playing ? -dt / 5 : (dt / 190) * (0.4 + T.playful)));
    m.social = clamp(m.social + (s.mode === 'purr' ? -dt / 3 : (dt / 130) * (0.4 + T.cuddly)));
    m.curious = clamp(m.curious + (s.moving ? -dt / 6 : dt / 70));
    m.sleepy = clamp(m.sleepy + (s.asleep ? -dt / 26 : (dt / 260) * (0.6 + 0.8 * T.lazy)));
    // feelings fade: a cuddly cat forgives sooner, an independent one sulks longer
    const M = m.mood;
    M.anger = clamp(M.anger - dt / (24 + 26 * T.independent - 10 * T.cuddly));
    M.joy = clamp(M.joy - dt / 45);
    M.love = clamp(M.love - dt / 28);
    M.sad = clamp(M.sad - dt / 50);
    while (m.pets.length && s.t - m.pets[0] > 10) m.pets.shift();
  };

  /**
   * Does she want to? One sum per question, squashed to 0-1, with a little chance in it.
   * You can talk her round: each no makes the next ask (within 8 s) a bit more likely to work, but she
   * likes that thing a little less for it. Some things she will not do however often you ask.
   */
  m.decide = (verb, s) => {
    const T = temper, B = m.bond;
    const ask = s.asking;                                  // what she herself came to ask for, if anything
    let z = 0, why = 'mood', hard = false;
    if (verb === 'call') {
      z = 1.2 + 2.0 * B + 1.2 * m.social * T.cuddly - 2.2 * T.independent * (1 - B) - 1.0 * (1 - s.energy) * T.lazy;
      if (s.asleep) { z -= 2.6 - 1.4 * B; why = 'asleep'; }
      else if (s.mode === 'eat' && s.hunger > 0.25) { z -= 3.2; why = 'eating'; }
      else if (s.playing) { z -= 1.6 + m.play; why = 'playing'; }
      else if (s.energy < 0.2) why = 'tired';
    } else if (verb === 'pet') {
      while (m.pets.length && s.t - m.pets[0] > 10) m.pets.shift();
      const tol = 3 + Math.round(5 * T.cuddly);            // pets in ten seconds before she has had enough
      const over = Math.max(0, m.pets.length + 1 - tol);
      z = 1.4 + 1.6 * m.social + 1.2 * T.cuddly + 1.0 * B - 1.5 * over;
      if (ask === 'cuddle') z += 2.5;                      // she asked for it
      if (over > 0) why = 'enough';
      if (s.t < m.fedUp) { hard = true; why = 'enough'; }   // she has just walked off: no means no for a moment
      else if (s.asleep) { z -= 2.4 - 2.0 * B; why = 'asleep'; }
      else if (m.play > 0.8 && T.playful > 0.5 && ask !== 'cuddle') { z -= 2.6; why = 'wantsplay'; }
    } else if (verb === 'feed') {
      z = -0.8 + 6 * s.hunger + 1.5 * T.greedy;
      why = 'full';
      if (s.hunger < 0.04) hard = true;                    // truly full: no talking her into it
      if (s.playing && m.play > 0.3 && s.hunger < 0.6) { z -= 2.2; why = 'playing'; }
    } else if (verb === 'play') {
      z = 0.3 + 2.5 * (s.energy - 0.3) + 1.5 * m.play + 1.2 * T.playful - 1.5 * T.lazy * (1 - s.energy);
      why = 'tired';
      if (ask === 'play') z += 2.5;
      if (s.energy < 0.12) hard = true;                    // worn out: she needs her nap
      if (s.hunger > 0.85) { z -= 1.6; why = 'hungry'; }
      else if (s.ateAgo < 12) { z -= 0.9; if (s.energy > 0.4) why = 'justate'; }
    }
    const M = m.mood;                                      // how she feels colours every answer
    if (verb === 'pet') z += -4.5 * M.anger + 0.8 * M.love + 0.5 * M.sad;
    else if (verb === 'call') z += -4 * M.anger + 0.4 * M.love;
    else if (verb === 'play') z += -4 * M.anger - 0.8 * M.sad + 0.6 * Math.max(0, M.joy - 0.2);
    // properly angry: she wants to be left alone, and asking again only makes it worse. Time mends it; so does dinner.
    const cross = M.anger >= 0.45 && verb !== 'feed';
    if (cross) hard = true;
    if (M.anger >= 0.3 && verb !== 'feed' && (cross || !hard)) why = 'angry';
    z += 0.9 * m.likes[verb] + (rand() - 0.5) * 0.5;
    const r = m.refused[verb];
    const pushed = r && s.t - r.t < 8 ? r.n : 0;           // you asked again right after a no
    const gaveIn = pushed > 0 && squash(z) <= 0.5;         // without the pushing it would still be a no
    z += 0.9 * pushed;
    const want = hard ? Math.min(0.2, squash(z)) : squash(z);
    const yes = want > 0.5;
    const mood = !yes ? 'no' : gaveIn || want < 0.64 ? 'reluctant' : want > 0.86 ? 'eager' : 'ok';
    if (yes) {
      if (gaveIn) m.likes[verb] = clamp(m.likes[verb] - 0.04, -1, 1);          // she gave in; she did not love it
      delete m.refused[verb];
      if (verb === 'pet') m.pets.push(s.t);
    } else {
      m.refused[verb] = { t: s.t, n: pushed + 1 };
      if (verb === 'pet' && why === 'enough' && s.t >= m.fedUp) m.fedUp = s.t + 6;
      if (pushed && !hard) { m.bond = clamp(m.bond - 0.01); m.likes[verb] = clamp(m.likes[verb] - 0.03, -1, 1); M.anger = clamp(M.anger + 0.1); }
      if (pushed && cross) M.anger = clamp(M.anger + 0.06);
    }
    m.decisions++;
    m.lastDecision = { verb, yes, want, mood, why: yes ? null : why, t: s.t };
    return m.lastDecision;
  };

  /** Something happened: she learns from it. */
  m.outcome = (kind) => {
    const like = (v, d) => { m.likes[v] = clamp(m.likes[v] + d * (1 - Math.abs(m.likes[v]) * 0.5), -1, 1); };
    m.feel(kind);
    switch (kind) {
      case 'purred': like('pet', 0.025); m.bond = clamp(m.bond + 0.005); break;
      case 'ate': like('feed', 0.03); m.bond = clamp(m.bond + 0.007); break;
      case 'played': like('play', 0.03); m.bond = clamp(m.bond + 0.007); break;
      case 'came': like('call', 0.02); m.bond = clamp(m.bond + 0.003); break;
      case 'answered': m.bond = clamp(m.bond + 0.02); break;             // she asked, you did it
      case 'ignored': m.bond = clamp(m.bond - 0.012); break;             // she asked, nothing happened
      default:
    }
  };

  /**
   * Something touched her feelings. `k` scales it (1 = the usual amount).
   *   woken: you got her up before she had slept enough    rested: she woke by herself
   *   and the outcomes above: a good cuddle, dinner, a game, being answered or ignored
   */
  m.feel = (what, k = 1) => {
    const M = m.mood;
    const up = (key, d) => { M[key] = clamp(M[key] + d * k); };
    switch (what) {
      case 'woken': up('anger', 0.95 - 0.3 * m.bond); M.joy *= 0.4; M.love *= 0.4; break;   // the better she knows you, the less cross
      case 'rested': up('joy', 0.3); break;
      case 'purred': up('love', 0.45); up('joy', 0.15); up('anger', -0.2); up('sad', -0.3); break;
      case 'ate': up('joy', 0.4); up('anger', -0.5); up('sad', -0.2); break;               // dinner mends most things
      case 'played': up('joy', 0.5); up('sad', -0.3); break;
      case 'came': up('joy', 0.05); break;
      case 'answered': up('love', 0.5); up('sad', -0.5); break;
      case 'ignored': up('sad', 0.55); break;
      default:
    }
  };

  /** How she feels right now: { id, word }. The strongest thing wins: anger first, then sadness, love, ... */
  m.emotion = (s) => {
    const M = m.mood;
    let id = 'content';
    if (s.asleep) id = 'asleep';
    else if (M.anger >= 0.75) id = 'furious';
    else if (M.anger >= 0.45) id = 'angry';
    else if (M.anger >= 0.18) id = 'grumpy';
    else if (M.sad >= 0.4 || s.happy < 0.22) id = 'sad';
    else if (M.love >= 0.4) id = 'loving';
    else if (s.playing) id = 'playful';
    else if (s.hunger > 0.7) id = 'hungry';
    else if (s.energy < 0.25 || m.sleepy > 0.85) id = 'sleepy';
    else if (M.joy >= 0.45) id = 'happy';
    else if (m.play > 0.78 && s.energy > 0.4) id = 'playful';
    else if (s.happy > 0.8) id = 'happy';
    return { id, word: EMOTIONS[id] };
  };

  /** How strong the habit "after a, do b" is: 0 (never) towards 1 (always). */
  m.habitOf = (a, b) => {
    let row = 0;
    for (const d of DOINGS) row += m.habit[`${a}>${d}`] || 0;
    return (m.habit[`${a}>${b}`] || 0) / (row + 3);
  };

  /** She did this (of her own accord): the habit of doing it after the last thing grows. */
  m.did = (doing) => {
    if (!DOINGS.includes(doing)) return;
    const k = `${m.last}>${doing}`;
    m.habit[k] = Math.min(40, (m.habit[k] || 0) + 1);
    for (const d of DOINGS) {                              // other habits from the same start fade a little
      const o2 = `${m.last}>${d}`;
      if (o2 !== k && m.habit[o2]) { m.habit[o2] *= 0.97; if (m.habit[o2] < 0.05) delete m.habit[o2]; }
    }
    m.last = doing;
    if (doing === 'wander' || doing === 'follow') m.curious = 0;
  };

  /** She napped here: her spot drifts toward it (the first nap chooses it). */
  m.napAt = (x, z) => {
    if (!m.spot) { m.spot = { x, z, n: 1 }; return; }
    const n = Math.min(m.spot.n, 5);
    m.spot = { x: (m.spot.x * n + x) / (n + 1), z: (m.spot.z * n + z) / (n + 1), n: Math.min(8, m.spot.n + 1) };
  };

  /**
   * What next, on her own? Every option gets a score from what she feels, who she is and her habits; the best
   * one wins. (Scores, for anyone who wants to look, come back in m.lastScores.)
   */
  m.choose = (s) => {
    const T = temper, B = m.bond;
    const far = s.friendDist ?? 0;
    const u = {
      sit: 0.45,
      groom: 0.5 + (s.ateAgo < 20 ? 0.7 : 0),
      nap: 0.15 + 2.3 * (1 - s.energy) + 0.5 * T.lazy + 2.4 * Math.max(0, m.sleepy - 0.45),
      wander: 0.45 + 0.9 * m.curious * (0.5 + s.energy * 0.5),
      eat: s.food && s.hunger > 0.15 ? 3.2 * s.hunger + T.greedy - 0.2 : -9,
      cuddle: s.friend ? 2.4 * m.social * (0.4 + T.cuddly) * (0.35 + B) - (far > 45 ? 0.4 : 0) : -9,
      playask: s.energy > 0.4 ? 2.1 * m.play * (0.4 + T.playful) * (s.toy ? 0.8 : 0.35 + B) : -9,
      follow: s.friend && far > 26 ? 0.25 + 1.7 * B - 0.8 * T.independent : -9,
    };
    if (s.hunger > 0.75) { u.nap -= 1; u.playask -= 1.2; }                 // a hungry cat thinks of food
    let best = 'sit', top = -Infinity;
    for (const d of DOINGS) {
      if (u[d] < -5) continue;
      u[d] += 0.7 * m.habitOf(m.last, d) + (rand() - 0.5) * 0.45;
      if (d === m.last && d !== 'sit') u[d] -= 0.35;                       // not the same thing twice running
      if (u[d] > top) { top = u[d]; best = d; }
    }
    m.lastScores = u;
    m.decisions++;
    return best;
  };

  /** What is on her mind: { want, text } or null when she is content. */
  m.thought = (s) => {
    if (s.asleep) return null;
    if (m.mood.anger >= 0.45) return { want: 'alone', kind: 'no', text: m.mood.anger >= 0.75 ? 'Leave me alone!' : 'Cross with you' };
    if (s.asking === 'cuddle') return { want: 'cuddle', text: 'Wants a cuddle' };
    if (s.asking === 'play') return { want: 'play', text: 'Wants to play' };
    if (s.hunger > 0.7) return { want: 'food', text: 'Hungry' };
    if (s.energy < 0.25 || m.sleepy > 0.85) return { want: 'nap', text: 'Sleepy' };
    if (m.mood.sad >= 0.4) return { want: 'comfort', text: 'Feeling sad' };
    if (s.playing || s.mode === 'eat' || s.mode === 'purr') return null;
    if (m.play > 0.78 && s.energy > 0.4) return { want: 'play', text: 'Wants to play' };
    if (m.social > 0.8) return { want: 'cuddle', text: 'Wants a cuddle' };
    return null;
  };

  /** Her strongest routines in words, for the card: [{ after, then, strength }] (only real habits). */
  m.routines = () => {
    const out = [];
    for (const [k, n] of Object.entries(m.habit)) {
      const [a, b] = k.split('>');
      if (n >= 3 && a !== b) out.push({ after: a, then: b, n, strength: m.habitOf(a, b) });
    }
    return out.sort((p, q) => q.strength - p.strength || q.n - p.n).slice(0, 2);
  };

  m.toJSON = () => ({
    seed, bond: +m.bond.toFixed(3), play: +m.play.toFixed(3), social: +m.social.toFixed(3), sleepy: +m.sleepy.toFixed(3),
    likes: Object.fromEntries(VERBS.map((v) => [v, +m.likes[v].toFixed(3)])),
    habit: Object.fromEntries(Object.entries(m.habit).map(([k, n]) => [k, +n.toFixed(2)])),
    spot: m.spot ? { x: +m.spot.x.toFixed(2), z: +m.spot.z.toFixed(2), n: m.spot.n } : null,
  });

  return m;
}

const AFTER = { sit: 'sitting about', groom: 'a wash', nap: 'a nap', wander: 'a stroll', eat: 'dinner', cuddle: 'a cuddle', playask: 'a game', follow: 'following you' };
const THEN = { sit: 'sits a while', groom: 'has a wash', nap: 'naps', wander: 'goes exploring', eat: 'eats', cuddle: 'comes for a cuddle', playask: 'wants a game', follow: 'follows you' };
const LIKES = { call: 'Coming along with you', pet: 'Being petted', feed: 'Dinner', play: 'Playing' };

/**
 * Her mind in words, for the card under her name.
 * @returns {{temper:string[], feels:string, trust:number, likes:string, habits:string[]}}  trust: 1-5
 */
export function describeMind(m, s) {
  const feeling = m.emotion(s);
  const feels = feeling.word;
  let best = null;
  for (const v of VERBS) if (m.likes[v] > 0.08 && (!best || m.likes[v] > m.likes[best])) best = v;
  const habits = [];
  if (m.spot && m.spot.n >= 2) habits.push('Naps in her own spot');
  for (const r of m.routines()) habits.push(`After ${AFTER[r.after]} she usually ${THEN[r.then]}`);
  return { temper: describeTemper(m.temper), feels, feeling: feeling.id, trust: Math.max(1, Math.min(5, Math.round(m.bond * 5))),
    likes: best ? LIKES[best] : 'Still finding out', habits };
}
