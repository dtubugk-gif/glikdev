// The game's sounds in the browser (Day 6 redesign). Nothing plays until the player has tapped once (browsers
// require a gesture), and nothing keeps playing behind a hidden page.
//
//   - Every effect is a designed recording (sounds/*.mp3, built by art/day06/sounds/build_sounds.py: layered,
//     EQ'd for phone speakers, levelled by family). Anything that repeats has 2-5 takes; a different take plays
//     each time (never the same one twice in a row), with a small random spread of pitch and level.
//   - The cats are real cats only: meows, trills and chirps cut from the owner's recording, and a real purr.
//     The friend kitten is the same voice played higher (about +3.5 semitones, so also a little shorter), and the
//     two cats can purr at the same time. If a voice recording cannot load, that voice stays silent: there is
//     no synthesised cat anywhere. Other effects have a synthesised stand-in (kittysound.js) until they load.
//   - The mix: each sound -> its gain (distance: further = quieter) -> a low-pass (further = duller) -> its place
//     left/right -> the effects bus, plus a send into a short, bright "small room" (a generated impulse response;
//     rewards and voices get a little, UI none) -> a limiter. A cap on how many of one sound may overlap (the
//     oldest fades out, never cut). The music (sounds/music.mp3, tools/gamemusic.mjs) goes round all of that and
//     only dips 2-4 dB, gently, under the big moments (the explosion, a purchase, a bomb landing, big rewards).
import * as S from './kittysound.js';

// (written out in full so the deploy check sees every file the game needs)
const FILES = {
  // the cats (real recordings only)
  meow: ['sounds/meow1.mp3', 'sounds/meow2.mp3', 'sounds/meow3.mp3'],
  trill: ['sounds/trill1.mp3', 'sounds/trill2.mp3', 'sounds/trill3.mp3'],
  chirp: ['sounds/chirp1.mp3', 'sounds/chirp2.mp3', 'sounds/chirp3.mp3'],
  purr: ['sounds/purr.mp3'], sigh: ['sounds/sigh.mp3'], hello: ['sounds/hello.mp3'],
  // buttons and dialogs
  click: ['sounds/click1.mp3', 'sounds/click2.mp3', 'sounds/click3.mp3', 'sounds/click4.mp3'],
  tick: ['sounds/tick1.mp3', 'sounds/tick2.mp3', 'sounds/tick3.mp3'],
  uiOpen: ['sounds/uiopen.mp3'], uiClose: ['sounds/uiclose.mp3'], uiOk: ['sounds/uiok.mp3'], nope: ['sounds/nope.mp3'],
  // you, and the cats moving
  footstep: ['sounds/footstep1.mp3', 'sounds/footstep2.mp3', 'sounds/footstep3.mp3', 'sounds/footstep4.mp3', 'sounds/footstep5.mp3'],
  paw: ['sounds/paw1.mp3', 'sounds/paw2.mp3', 'sounds/paw3.mp3', 'sounds/paw4.mp3'],
  land: ['sounds/land1.mp3', 'sounds/land2.mp3', 'sounds/land3.mp3'],
  leap: ['sounds/leap1.mp3', 'sounds/leap2.mp3', 'sounds/leap3.mp3'],
  hop: ['sounds/hop1.mp3', 'sounds/hop2.mp3', 'sounds/hop3.mp3'],
  dust: ['sounds/dust1.mp3', 'sounds/dust2.mp3', 'sounds/dust3.mp3'],
  tumble: ['sounds/tumble1.mp3', 'sounds/tumble2.mp3'],
  playbow: ['sounds/playbow1.mp3', 'sounds/playbow2.mp3'],
  nuzzle: ['sounds/nuzzle1.mp3', 'sounds/nuzzle2.mp3'],
  pet: ['sounds/pet1.mp3', 'sounds/pet2.mp3', 'sounds/pet3.mp3'],
  boop: ['sounds/boop1.mp3', 'sounds/boop2.mp3', 'sounds/boop3.mp3'],
  heart: ['sounds/heart1.mp3', 'sounds/heart2.mp3', 'sounds/heart3.mp3'],
  // toys, food, her bell
  thud: ['sounds/thud1.mp3', 'sounds/thud2.mp3', 'sounds/thud3.mp3'],
  swat: ['sounds/swat1.mp3', 'sounds/swat2.mp3', 'sounds/swat3.mp3'],
  toss: ['sounds/toss1.mp3', 'sounds/toss2.mp3'],
  squeak: ['sounds/squeak1.mp3', 'sounds/squeak2.mp3', 'sounds/squeak3.mp3'],
  crunch: ['sounds/crunch1.mp3', 'sounds/crunch2.mp3', 'sounds/crunch3.mp3', 'sounds/crunch4.mp3'],
  bowl: ['sounds/bowl.mp3'], refill: ['sounds/refill1.mp3', 'sounds/refill2.mp3'],
  jingle: ['sounds/jingle1.mp3', 'sounds/jingle2.mp3', 'sounds/jingle3.mp3'],
  // tokens, the shop, rewards
  token: ['sounds/token1.mp3', 'sounds/token2.mp3', 'sounds/token3.mp3'],
  buy: ['sounds/buy.mp3'], wear: ['sounds/wear1.mp3', 'sounds/wear2.mp3'],
  sparkle: ['sounds/sparkle1.mp3', 'sounds/sparkle2.mp3', 'sounds/sparkle3.mp3'],
  shopOpen: ['sounds/shopopen.mp3'], shopClose: ['sounds/shopclose.mp3'], lose: ['sounds/lose.mp3'],
  // the atom bombs (Day 5) and their boxes
  bombFall: ['sounds/bombfall.mp3'], bombLand: ['sounds/bombland1.mp3', 'sounds/bombland2.mp3'],
  boxOpen: ['sounds/boxopen.mp3'], atom: ['sounds/atom.mp3'],
  boom: ['sounds/boom.mp3'],                               // Day 5: an atom bomb landed on you
  music: ['sounds/music.mp3'],
};

/** The music file holds the tune and then its first two seconds again; looping from `start` for `seconds`
 *  (24 bars at 84 bpm) lands on the same sound at both ends, whatever padding the MP3 decoder adds. */
export const MUSIC = { start: 0.5, seconds: 24 * 4 * 60 / 84, level: 0.5 };

/** The cats' voices: never replaced by a synthesised stand-in. */
const VOICE = new Set(['meow', 'trill', 'chirp', 'purr', 'sigh', 'hello']);

/**
 * How each family plays. The files carry the balance between families (art/day06/sounds/build_sounds.py, the
 * loudness table T), so gains sit near 1. pitch: random spread, +- semitones; level: random spread, +- dB;
 * send: how much goes to the small room; cap: how many may sound at once (the oldest fades out).
 */
const FAM = {
  meow: { pitch: 0.35, level: 1, send: 0.12, cap: 2 }, trill: { pitch: 0.35, level: 1, send: 0.12, cap: 2 },
  chirp: { pitch: 0.5, level: 1, send: 0.1, cap: 2 }, sigh: { send: 0.1, cap: 2 }, hello: { send: 0.14, cap: 1 },
  purr: { send: 0.06, cap: 2 },
  click: { pitch: 0.6, level: 1, send: 0, cap: 2 }, tick: { pitch: 0.6, level: 1, send: 0, cap: 2 },
  uiOpen: { pitch: 0.3, send: 0, cap: 1 }, uiClose: { pitch: 0.3, send: 0, cap: 1 }, uiOk: { send: 0.04, cap: 1 },
  nope: { send: 0.04, cap: 1 },
  footstep: { pitch: 0.7, level: 1.5, send: 0.04, cap: 2 }, paw: { pitch: 0.8, level: 1.5, send: 0.04, cap: 4 },
  land: { pitch: 0.6, level: 1, send: 0.06, cap: 2 }, leap: { pitch: 0.8, level: 1, send: 0.05, cap: 2 },
  hop: { pitch: 0.8, level: 1, send: 0.05, cap: 2 }, dust: { pitch: 1, level: 1.5, send: 0.04, cap: 2 },
  tumble: { pitch: 0.6, level: 1, send: 0.06, cap: 2 }, playbow: { pitch: 0.7, level: 1, send: 0.05, cap: 2 },
  nuzzle: { pitch: 0.5, level: 1, send: 0.06, cap: 2 }, pet: { pitch: 0.6, level: 1, send: 0.05, cap: 2 },
  boop: { pitch: 0.7, level: 1, send: 0.08, cap: 2 }, heart: { pitch: 0.15, level: 1, send: 0.12, cap: 4 },
  thud: { pitch: 0.8, level: 1, send: 0.07, cap: 3 }, swat: { pitch: 0.8, level: 1, send: 0.05, cap: 2 },
  toss: { pitch: 0.6, level: 1, send: 0.05, cap: 2 }, squeak: { pitch: 0.8, level: 1, send: 0.06, cap: 2 },
  crunch: { pitch: 0.9, level: 1.5, send: 0.04, cap: 2 }, bowl: { pitch: 0.4, send: 0.08, cap: 1 },
  refill: { pitch: 0.5, level: 1, send: 0.06, cap: 1 }, jingle: { pitch: 0.4, level: 1, send: 0.1, cap: 2 },
  token: { level: 0.5, send: 0.16, cap: 4 }, buy: { send: 0.18, cap: 1 }, wear: { pitch: 0.4, level: 1, send: 0.1, cap: 1 },
  sparkle: { pitch: 0.3, level: 1, send: 0.18, cap: 2 }, shopOpen: { send: 0.12, cap: 1 }, shopClose: { send: 0.1, cap: 1 },
  lose: { send: 0.1, cap: 1 }, bombFall: { pitch: 0.4, send: 0.06, cap: 3 }, bombLand: { pitch: 0.5, level: 1, send: 0.1, cap: 2 },
  boxOpen: { pitch: 0.3, send: 0.1, cap: 2 }, atom: { send: 0.18, cap: 2 }, boom: { send: 0.08, cap: 1, gain: 0.85 },
};

// stand-ins while a recording loads (or if it cannot): never for a voice
const STAND_IN = {
  click: [S.click, 3], tick: [S.tick, 3], uiOpen: [S.pop, 1], uiClose: [S.pop, 1], uiOk: [S.coin, 1], nope: [S.nope, 1],
  footstep: [S.footstep, 4], paw: [S.step, 4], land: [S.step, 2], leap: [S.swat, 1], hop: [S.swat, 1], dust: [S.step, 2],
  tumble: [S.thud, 1], playbow: [S.step, 2], nuzzle: [S.swat, 1], pet: [S.swat, 1], boop: [S.pop, 3], heart: [S.pop, 3],
  thud: [S.thud, 1], swat: [S.swat, 1], toss: [S.swat, 1], squeak: [S.squeak, 3], crunch: [S.bite, 3], bowl: [S.thud, 1],
  refill: [S.bite, 2], jingle: [S.bell, 2], token: [S.coin, 3], buy: [S.buy, 1], wear: [S.wear, 1], sparkle: [S.coin, 3],
  shopOpen: [S.shopOpen, 1], shopClose: [S.shopClose, 1], lose: [S.nope, 1], bombFall: [S.swat, 1], bombLand: [S.thud, 1],
  boxOpen: [S.click, 1], atom: [S.coin, 1], boom: [S.thud, 1],
};

/** The friend kitten's voice: the same cats, about 3.5 semitones up (and so a little shorter). */
const FRIEND_RATE = 2 ** (3.5 / 12);

/** Picks a take: random, never the one that played last (exported for the tests). */
export function pickTake(n, last, rand = Math.random) {
  if (n <= 1) return 0;
  const k = Math.floor(rand() * (n - 1));
  return k >= last && last >= 0 ? k + 1 : k;
}

/** @param {{url?:(path:string)=>string, AudioContext?:any, fetch?:any, random?:()=>number}} [o]
 *  url: adds the build stamp to a file path (the others are for the tests) */
export function createKittyAudio(o = {}) {
  let ctx = null, fx = null, musicBus = null, duckGain = null, room = null, bed = null, muted = false;
  const rec = {};                                          // family -> [AudioBuffer]: the recordings that have loaded
  const synth = {};                                        // family -> [AudioBuffer]: stand-ins, made when first needed
  const last = {};                                         // family -> the take that played last
  const active = {};                                       // family -> [{ src, g, end }]
  const purrs = { kitty: null, friend: null };             // two purr slots: both cats can purr at once
  let duckUntil = 0, lastClick = -1;
  const LEVEL = 0.62;
  const url = o.url || ((p) => p);
  const rand = o.random || Math.random;
  const get = o.fetch || ((u) => fetch(u));

  // nothing keeps playing behind a hidden page (another tab, the home screen, a locked phone)
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (!ctx) return;
      if (document.hidden) ctx.suspend(); else ctx.resume();
    });
  }

  /** A short, bright small room: stereo noise with a few early reflections, decaying over ~0.35 s. */
  function makeRoom() {
    const sr = ctx.sampleRate, n = Math.floor(sr * 0.55);
    const ir = ctx.createBuffer(2, n, sr);
    let seed = 7;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const k = 0.55 - 0.4 * Math.min(1, t / 0.35);     // the highs die first: bright at the start, softer later
        lp += (rnd() - lp) * k;
        d[i] = t < 0.006 ? 0 : lp * Math.exp(-t * 6.9 / 0.35) * 0.6;   // 6 ms pre-delay, RT60 about 0.35 s
      }
      for (const [ms, g] of [[7, 0.09], [11.5, 0.07], [17, 0.055], [23.5, 0.04], [31, 0.03]]) {   // early reflections
        const i = Math.floor(sr * (ms + (c ? 1.3 : 0)) / 1000);
        d[i] += g * (c ? -1 : 1);
      }
    }
    // unit energy, then -6 dB: measured in Chrome the room sits 16-22 dB under the dry sound (rewards and hearts the most)
    let e = 0;
    for (let c = 0; c < 2; c++) for (const v of ir.getChannelData(c)) e += v * v;
    const k = 1 / Math.sqrt(e / 2 || 1);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < n; i++) d[i] *= k; }
    const conv = ctx.createConvolver();
    conv.normalize = false;
    conv.buffer = ir;
    const back = ctx.createGain();
    back.gain.value = 0.5;
    conv.connect(back).connect(fx);
    return conv;
  }

  function unlock() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = o.AudioContext || (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext));
    if (!AC) return;
    ctx = new AC();
    // the effects: bus -> limiter -> out (a pile-up of sounds never clips)
    fx = ctx.createGain();
    fx.gain.value = muted ? 0 : LEVEL;
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -4; lim.knee.value = 2; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.12;
    fx.connect(lim).connect(ctx.destination);
    room = makeRoom();
    // the music goes round the effects (it never pumps with them); it only dips under the big moments
    musicBus = ctx.createGain();
    musicBus.gain.value = muted ? 0 : LEVEL;
    duckGain = ctx.createGain();
    duckGain.connect(musicBus).connect(ctx.destination);
    // the recordings: fetched and decoded in the background, a few at a time, the ones heard first first, music last
    const queue = Object.keys(FILES).flatMap((name) => FILES[name].map((p, i) => ({ name, p, i })));
    const got = {}, tried = {};
    const one = async ({ name, p, i }) => {
      try {
        const r = await get(url(p));
        if (!r.ok) throw new Error(`${p} ${r.status}`);
        (got[name] ||= [])[i] = await ctx.decodeAudioData(await r.arrayBuffer());
      } catch (err) {
        console.warn(name === 'music' ? 'Glikdev: the music did not load' : VOICE.has(name)
          ? 'Glikdev: a voice did not load, it stays silent' : 'Glikdev: a sound did not load, using its stand-in', p, err);
      }
      // once every take of a family has been tried, it plays the ones that loaded (all of them, normally)
      if ((tried[name] = (tried[name] || 0) + 1) === FILES[name].length) {
        const have = (got[name] || []).filter(Boolean);
        if (have.length) {
          rec[name] = have;
          if (name === 'music') startMusic(have[0]);
        }
      }
    };
    let k = 0;
    const worker = async () => { while (k < queue.length) await one(queue[k++]); };
    for (let w = 0; w < 6; w++) worker();
  }

  /** The music, round and round: it fades in over three seconds, then loops inside the file (see MUSIC). */
  function startMusic(buffer) {
    if (bed) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    if (buffer.duration >= MUSIC.start + MUSIC.seconds + 0.05) {
      src.loopStart = MUSIC.start;
      src.loopEnd = MUSIC.start + MUSIC.seconds;
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(MUSIC.level, ctx.currentTime + 3);
    src.connect(g).connect(duckGain);
    src.start();
    bed = src;
  }

  /** Holds an automated value where it is now, so a new ramp never jumps. */
  function hold(param, t) {
    if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t);
    else { const v = param.value; param.cancelScheduledValues(t); param.setValueAtTime(v, t); }
  }

  /** The music dips by `dB` (2-4) fast, stays down `secs`, and comes back over about 400 ms. */
  function duck(dB, secs) {
    const t = ctx.currentTime;
    duckUntil = Math.max(duckUntil, t + secs);
    hold(duckGain.gain, t);
    duckGain.gain.setTargetAtTime(Math.min(10 ** (-dB / 20), duckGain.gain.value), t, 0.012);
    duckGain.gain.setTargetAtTime(1, duckUntil, 0.13);
  }

  function takes(name) {
    if (rec[name]) return rec[name];
    if (VOICE.has(name) || !STAND_IN[name]) return null;  // a cat is never faked
    if (!synth[name]) {
      const [fn, k] = STAND_IN[name], sr = ctx.sampleRate;
      synth[name] = Array.from({ length: k }, (_, v) => {
        const f = fn(sr, v); const b = ctx.createBuffer(1, f.length, sr); b.copyToChannel(f, 0); return b;
      });
    }
    return synth[name];
  }

  function stopVoice(v, fade = 0.03) {
    const t = ctx.currentTime;
    hold(v.g.gain, t);
    v.g.gain.linearRampToValueAtTime(0, t + fade);
    try { v.src.stop(t + fade + 0.01); } catch { /* already stopped */ }
    v.end = t + fade;
  }

  /**
   * Plays one take of a family. gain: linear; rate: playback rate (pitch); delay: seconds; pan -1..1;
   * near 0..1 (1 = by the camera): further away is quieter and duller; which: a set take (the token ladder).
   */
  function play(name, gain = 1, { rate = 1, delay = 0, pan = 0, near = 1, which = null, loop = false, lowpass = 0, send = null, fadeIn = 0 } = {}) {
    const list = takes(name);
    if (!list || !list.length) return null;
    const fam = FAM[name] || {};
    const k = which != null ? Math.min(which, list.length - 1) : pickTake(list.length, last[name] ?? -1, rand);
    last[name] = k;
    const t = ctx.currentTime + delay;
    // no more than `cap` of one sound at once: the oldest fades out (never a hard cut)
    const live = (active[name] || []).filter((v) => v.end > ctx.currentTime);
    while (live.length >= (fam.cap || 3)) stopVoice(live.shift());
    const src = ctx.createBufferSource();
    src.buffer = list[k];
    src.loop = loop;
    const r = rate * 2 ** (((rand() * 2 - 1) * (fam.pitch || 0)) / 12);
    src.playbackRate.value = r;
    const lv = 10 ** (((rand() * 2 - 1) * (fam.level || 0)) / 20);
    const g = ctx.createGain();
    const v = (fam.gain ?? 1) * gain * lv * (0.35 + 0.65 * near);
    if (fadeIn > 0) { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + fadeIn); } else g.gain.setValueAtTime(v, t);
    let out = src.connect(g);
    const cut = Math.min(lowpass || 20000, near < 0.97 ? 2200 * (20000 / 2200) ** near : 20000);
    if (cut < 19000) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = cut; f.Q.value = 0.5;
      out = out.connect(f);
    }
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-0.8, Math.min(0.8, pan));
      out = out.connect(p);
    }
    out.connect(fx);
    const s = send ?? fam.send ?? 0;
    if (s > 0 && room) {
      const sg = ctx.createGain();
      sg.gain.value = s * (1.3 - 0.3 * near);               // further away: a touch more room
      out.connect(sg).connect(room);
    }
    src.start(t);
    const voice = { src, g, peak: v, end: loop ? Infinity : t + (list[k].duration || 0) / r };
    live.push(voice);
    active[name] = live;
    return voice;
  }

  /** A cat starts purring (a seamless loop that swells in), or, if she already purrs, follows her new level. */
  function startPurr(who, near, pan) {
    const t = ctx.currentTime, p = purrs[who];
    if (p && p.end > t) {
      const target = p.peak / p.near * (0.35 + 0.65 * near);
      hold(p.g.gain, t);                                    // (this also drops the safety fade: set it again)
      p.g.gain.linearRampToValueAtTime(target, t + 0.25);
      p.g.gain.setValueAtTime(target, p.stopAt);
      p.g.gain.linearRampToValueAtTime(0, p.stopAt + 0.6);
      p.peak = target; p.near = 0.35 + 0.65 * near;
      return;
    }
    // the kitten purrs a little higher and quicker than her
    const voice = play('purr', 1, { rate: who === 'friend' ? FRIEND_RATE * 0.97 : 1, pan, near, loop: true, fadeIn: 0.35 });
    if (!voice) return;
    voice.near = 0.35 + 0.65 * near;
    const stopAt = voice.stopAt = t + 30;                   // never purrs on for ever if a purr-end is lost
    voice.g.gain.setValueAtTime(voice.peak, stopAt);
    voice.g.gain.linearRampToValueAtTime(0, stopAt + 0.6);
    voice.src.stop(stopAt + 0.65);
    voice.end = stopAt + 0.6;
    purrs[who] = voice;
  }
  function stopPurr(who, fade = 0.6) {
    const p = purrs[who];
    if (!p) return;
    stopVoice(p, fade);
    purrs[who] = null;
  }

  return {
    unlock,
    get running() { return !!ctx && ctx.state === 'running'; },
    get muted() { return muted; },
    /** which sounds are recordings right now (for checks) */
    get recorded() { return Object.keys(rec); },
    setMuted(m) {
      muted = m;
      if (fx) fx.gain.setTargetAtTime(m ? 0 : LEVEL, ctx.currentTime, 0.05);
      if (musicBus) musicBus.gain.setTargetAtTime(m ? 0 : LEVEL, ctx.currentTime, 0.05);
    },
    /**
     * feed it events (the cats', and the game's); `near` is 0-1 (1 = close to the camera),
     * `pan` is where the sound is on screen, -1 (left) to 1 (right). An event may say `who: 'friend'`
     * (the friend kitten). Unknown events are ignored.
     */
    event(e, near = 1, pan = 0) {
      if (!ctx || ctx.state !== 'running' || !e) return;
      const friend = e.who === 'friend';
      const vr = friend ? FRIEND_RATE : 1;                  // her voice, or the kitten's (higher)
      const small = friend ? 0.8 : 1;                       // the kitten is smaller: softer paws, a little higher
      const fr = friend ? 1.12 : 1;
      const at = (extra) => ({ pan, near, delay: e.delay || 0, ...extra });   // (an event may come a moment early: delay)
      switch (e.type) {
        // ---- the cats' voices (real recordings)
        case 'meow': play('meow', friend ? 0.8 : 1, at({ rate: vr })); break;
        case 'trill': play('trill', friend ? 0.85 : 1, at({ rate: 1.04 * vr })); break;
        case 'chirp': play('chirp', 1, at({ rate: 1.22 * vr })); break;
        case 'mew': play('meow', 0.7, at({ rate: 1.24 * vr })); break;                     // hungry: smaller, higher
        case 'yawn': play('meow', 0.55, at({ which: 2, rate: 0.72 * vr, delay: e.delay || 0 })); break;   // one meow, long and low
        case 'grumble': play('meow', 0.85, at({ rate: 0.74 * vr, delay: e.delay || 0 })); break;         // a low, cross meow
        case 'refuse': if (e.why !== 'asleep') play('trill', 0.8, at({ rate: 0.8 * vr })); break;       // a low, short "no"
        case 'sigh': play('sigh', friend ? 0.8 : 1, at({ rate: friend ? 1.15 : 1 })); break;
        case 'friend-hello': play('hello', 1, at()); break;
        case 'purr': startPurr(friend ? 'friend' : 'kitty', near, pan); break;
        case 'purr-end': stopPurr(friend ? 'friend' : 'kitty', 0.6); break;
        case 'pet':
          if (purrs[friend ? 'friend' : 'kitty']) startPurr(friend ? 'friend' : 'kitty', near, pan);
          play('pet', 1, at());
          break;
        // ---- the cats moving
        case 'step': play('paw', (e.strong ? 1.35 : 1) * small, at({ rate: fr })); break;
        case 'land': play('land', small, at({ rate: fr })); break;
        case 'leap': play('leap', small, at({ rate: fr })); break;
        case 'hop': play('hop', small, at({ rate: fr })); break;
        case 'dust': play('dust', 1, at()); break;
        case 'tumble': play('tumble', small, at({ rate: fr })); break;
        case 'playbow': play('playbow', small, at({ rate: fr })); play('chirp', 0.75, at({ rate: 1.22 * vr, delay: 0.06 })); break;
        case 'nuzzle': play('nuzzle', 1, at()); play('trill', 0.42, at({ rate: 1.1 * vr, delay: 0.14 })); break;
        case 'boop': play('boop', 1, at()); break;
        case 'heart': play('heart', 1, at({ rate: [1, 1.122, 1.26][Math.max(0, Math.min(2, e.k | 0))] })); break;
        // ---- toys, food, her bell
        case 'thud': play('thud', e.soft ? 0.55 : 1, at({ rate: e.soft ? 1.06 : 0.94 })); break;
        case 'swat': play('swat', small, at({ rate: fr })); break;
        case 'toss': {
          const sp = Math.max(0, Math.min(1, (e.speed || 0) / 40));
          play('toss', 0.6 + 0.4 * sp, at({ rate: 0.92 + 0.16 * sp }));
          break;
        }
        case 'squeak': play('squeak', 1, at()); break;
        case 'bite': play('crunch', small, at({ rate: fr })); break;
        case 'bowl': play('bowl', 1, at()); break;
        case 'refill': play('refill', 1, at()); break;
        case 'jingle': case 'wake': play('jingle', 1, at()); break;
        // ---- tokens, the shop, rewards
        case 'token': {
          const n = Math.max(1, Math.min(3, e.n || 1));
          for (let k = 0; k < n; k++) play('token', 1, { which: k, delay: k * 0.13 });   // do, mi, sol: climbing
          if (n >= 3) duck(2, 0.5);
          break;
        }
        case 'buy': play('buy', 1); duck(3, 1.0); break;
        case 'wear': play('wear', 1); break;
        case 'sparkle': play('sparkle', 1); break;
        case 'shop-open': play('shopOpen', 1); break;
        case 'shop-close': play('shopClose', 1); break;
        case 'lose': play('lose', 1); duck(2.5, 0.9); break;
        case 'atom': play('atom', 1, at()); duck(2, 0.6); break;
        // ---- dialogs and buttons
        case 'ui-open': play('uiOpen', 1); break;
        case 'ui-close': play('uiClose', 1); break;
        case 'ui-tab': play('tick', 1); break;
        case 'ui-ok': play('uiOk', 1); break;
        case 'ui-bad': play('nope', 0.55, { rate: 1.06, lowpass: 2400 }); break;   // a gentler "no"
        case 'nope': play('nope', 1); break;
        case 'click':
          if (ctx.currentTime - lastClick < 0.05) break;     // one click per press
          lastClick = ctx.currentTime;
          play('click', 1);
          break;
        // ---- you
        case 'footstep': play('footstep', e.strong ? 1.4 : 1, { rate: e.strong ? 0.97 : 1 }); break;
        // ---- the atom bombs
        case 'bomb-fall': play('bombFall', 1, at()); break;
        case 'bomb-land': play('bombLand', 1, at()); duck(3, 0.7); break;
        case 'box-open': play('boxOpen', 1, at()); break;
        case 'boom': play('boom', 1); duck(4, 1.8); break;   // the world goes up
        default:
      }
    },
  };
}
