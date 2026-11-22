// The game's sounds in the browser. Nothing plays until the player has tapped once (browsers require a
// gesture).
//   - Her voice is real cats: three meows cut from a recording the owner supplied (also used, shortened or
//     pitched, for her hello, her chirp at a toy, her hungry mew and her yawn) and a public-domain purr.
//     Only her sleepy sigh and her collar bell are still synthesised by kittysound.js.
//   - Everything else is a real recording too (sounds/*.mp3, cut from the Sonniss GDC bundle by
//     art/day03/sounds/build_sounds.py): the token's ting, coins and a happy sting when you buy, cloth and a pop
//     when she puts something on, the shop opening and closing, soft pats for paws, your steps and the toy
//     landing, a whoosh for her swats, kibble crunches, button clicks and the felt mouse's squeak.
//     Until a recording has loaded (or if it cannot), the synthesised version of that sound plays instead.
//   - Underneath plays the game's own music (sounds/music.mp3: an original tune written and synthesised by
//     tools/gamemusic.mjs), looping quietly with no seam. If it cannot load there is simply no music.
// Sounds from her get quieter the further she is from the camera and sit left or right where she is on screen.
import * as S from './kittysound.js';

// (written out in full so the deploy check sees every file the game needs)
const FILES = {
  coin: ['sounds/coin.mp3'], coinflip: ['sounds/coinflip.mp3'], buy: ['sounds/buy.mp3'], cloth: ['sounds/cloth.mp3'],
  pop: ['sounds/pop.mp3'], click: ['sounds/click.mp3'], shopOpen: ['sounds/shopopen.mp3'], shopClose: ['sounds/shopclose.mp3'],
  nope: ['sounds/nope.mp3'], pat: ['sounds/pat1.mp3', 'sounds/pat2.mp3'], whoosh: ['sounds/whoosh.mp3'],
  crunch: ['sounds/crunch1.mp3', 'sounds/crunch2.mp3'], squeak: ['sounds/squeak.mp3'],
  // her voice: real cats (the owner's meow recording; a public-domain purr from Wikimedia Commons)
  meow: ['sounds/meow1.mp3', 'sounds/meow2.mp3', 'sounds/meow3.mp3'], trill: ['sounds/trill.mp3'], chirp: ['sounds/chirp.mp3'],
  purr: ['sounds/purr.mp3'],
  music: ['sounds/music.mp3'],
};

/** The music file holds the tune and then its first two seconds again; looping from `start` for `seconds`
 *  (24 bars at 84 bpm) lands on the same sound at both ends, whatever padding the MP3 decoder adds. */
export const MUSIC = { start: 0.5, seconds: 24 * 4 * 60 / 84, level: 0.5 };

/** @param {{url?:(path:string)=>string}} [o]  url: adds the build stamp to a file path */
export function createKittyAudio(o = {}) {
  let ctx = null, master = null, musicBus = null, bufs = null, makers = null, purring = null, n = 0, muted = false, bed = null;
  const rec = {};                                          // name -> [AudioBuffer]: the recordings that have loaded
  const LEVEL = 0.62;
  const url = o.url || ((p) => p);

  // nothing keeps playing behind a hidden page (another tab, the home screen, a locked phone)
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (!ctx) return;
      if (document.hidden) ctx.suspend(); else ctx.resume();
    });
  }

  function unlock() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : LEVEL;
    // a gentle bus compressor: a pile-up of sounds (three coins, a trill and a purr) never clips or jumps out
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 14; comp.ratio.value = 3; comp.attack.value = 0.004; comp.release.value = 0.18;
    master.connect(comp).connect(ctx.destination);
    // the music goes round the compressor, so a burst of effects never makes it pump
    musicBus = ctx.createGain();
    musicBus.gain.value = muted ? 0 : LEVEL;
    musicBus.connect(ctx.destination);
    const sr = ctx.sampleRate;
    const make = (f) => { const b = ctx.createBuffer(1, f.length, sr); b.copyToChannel(f, 0); return b; };
    const many = (fn, k) => Array.from({ length: k }, (_, v) => make(fn(sr, v)));
    // each synthesised sound is built the first time it is needed, and the voice in the background,
    // so the first tap never stalls while a whole library is made
    const one = (fn, ...args) => () => [make(fn(sr, ...args))];
    makers = {
      meow: () => many(S.meow, 3), trill: () => many(S.trill, 3), chirp: () => many(S.chirp, 3), mew: () => many(S.mew, 3),
      purr: one(S.purr, 4.0), bell: () => many(S.bell, 2), yawn: one(S.yawn), sigh: one(S.sigh),
      // stand-ins for the recordings, should one not load
      coin: () => many(S.coin, 3), coinflip: () => many(S.coin, 1), buy: one(S.buy), cloth: one(S.wear), pop: () => many(S.click, 1),
      click: () => many(S.click, 3), shopOpen: one(S.shopOpen), shopClose: one(S.shopClose), nope: one(S.nope),
      pat: () => many(S.step, 4), whoosh: one(S.swat), crunch: () => many(S.bite, 3), squeak: () => many(S.squeak, 3),
    };
    bufs = {};
    const order = ['bell', 'trill', 'purr', 'meow', 'chirp', 'mew', 'yawn', 'sigh'];
    const warm = () => { const k = order.find((x) => !bufs[x]); if (!k) return; bufs[k] = makers[k](); setTimeout(warm, 40); };
    setTimeout(warm, 60);
    // the recordings: fetched and decoded in the background, small ones first, the music last
    (async () => {
      for (const [name, paths] of Object.entries(FILES)) {
        try {
          const list = [];
          for (const p of paths) {
            const r = await fetch(url(p));
            if (!r.ok) throw new Error(`${p} ${r.status}`);
            list.push(await ctx.decodeAudioData(await r.arrayBuffer()));
          }
          rec[name] = list;
          if (name === 'music') startMusic(list[0]);
        } catch (err) {
          console.warn(name === 'music' ? 'Glikdev: the music did not load' : 'Glikdev: a sound did not load, using its stand-in', name, err);
        }
      }
    })();
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
    src.connect(g).connect(musicBus);
    src.start();
    bed = src;
  }

  function play(name, gain = 1, { rate = 1, delay = 0, pan = 0, which = null } = {}) {
    const list = rec[name] || bufs[name] || (bufs[name] = makers[name]());
    const src = ctx.createBufferSource();
    src.buffer = list[(which ?? n++) % list.length];
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    let out = src.connect(g);
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-0.8, Math.min(0.8, pan));
      out = out.connect(p);
    }
    out.connect(master);
    src.start(ctx.currentTime + delay);
    return { src, g };
  }

  function stopPurr(fade = 0.25) {
    if (!purring) return;
    const { src, g } = purring;
    const t = ctx.currentTime;
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.linearRampToValueAtTime(0, t + fade);
    src.stop(t + fade + 0.02);
    purring = null;
  }
  function startPurr(v, pan) {
    stopPurr(0.2);
    purring = play('purr', 0.001, { pan });
    purring.g.gain.linearRampToValueAtTime((rec.purr ? 0.9 : 1.0) * v, ctx.currentTime + 0.25);   // a purr swells in, it does not switch on
    purring.src.onended = () => { purring = null; };
  }

  const vary = () => 0.94 + 0.12 * ((n * 0.618) % 1);    // a little pitch variety, no two alike
  let lastClick = 0;

  return {
    unlock,
    get running() { return !!ctx && ctx.state === 'running'; },
    get muted() { return muted; },
    /** which sounds are recordings right now (for checks) */
    get recorded() { return Object.keys(rec); },
    setMuted(m) {
      muted = m;
      if (master) master.gain.setTargetAtTime(m ? 0 : LEVEL, ctx.currentTime, 0.05);
      if (musicBus) musicBus.gain.setTargetAtTime(m ? 0 : LEVEL, ctx.currentTime, 0.05);
    },
    /**
     * feed it events (the kitty's, and the game's); `near` is 0-1 (1 = close to the camera),
     * `pan` is where the sound is on screen, -1 (left) to 1 (right)
     */
    event(e, near = 1, pan = 0) {
      if (!ctx || ctx.state !== 'running') return;
      const v = 0.35 + 0.65 * near;
      const at = (extra) => ({ pan, ...extra });
      switch (e.type) {
        case 'meow': play('meow', 0.8 * v, at({ rate: vary() })); break;
        case 'trill': play('trill', 0.55 * v, at({ rate: (rec.trill ? 1.08 : 1) * vary() })); break;
        case 'chirp': play('chirp', 0.5 * v, at({ rate: (rec.chirp ? 1.25 : 1) * vary() })); break;
        // a hungry mew is a meow, smaller and higher; a yawn is one stretched long and low
        case 'mew': if (rec.meow) play('meow', 0.6 * v, at({ rate: 1.2 * vary() })); else play('mew', 0.7 * v, at({ rate: vary() })); break;
        case 'yawn': if (rec.meow) play('meow', 0.45 * v, at({ which: 2, rate: 0.72, delay: e.delay || 0 })); else play('yawn', 0.7 * v, at({ delay: e.delay || 0 })); break;
        case 'sigh': play('sigh', 0.6 * v, at()); break;
        case 'bite': play('crunch', 0.75 * v, at({ rate: 0.9 + 0.25 * ((n * 0.37) % 1) })); break;
        case 'step': play('pat', (e.strong ? 0.42 : 0.28) * v, at({ rate: 1.05 * vary() })); break;
        case 'thud': play('pat', (e.soft ? 0.4 : 0.7) * v, at({ rate: e.soft ? 0.8 : 0.66 })); break;
        case 'toss': play('whoosh', Math.min(0.6, 0.25 + (e.speed || 0) / 80), { rate: 0.85 }); break;
        case 'swat': play('whoosh', 0.5 * v, at({ rate: 1.35 })); play('pat', 0.5 * v, at({ rate: 1.2, delay: 0.07 })); break;
        case 'leap': play('whoosh', 0.35 * v, at({ rate: 1.0 })); break;
        case 'land': play('pat', 0.75 * v, at({ rate: 0.78 })); break;
        case 'jingle': case 'wake': play('bell', 0.38 * v, at({ rate: vary() })); break;
        case 'bowl': play('pop', 0.4, at({ rate: 0.8 })); play('bell', 0.2, at({ rate: 0.7 })); break;
        case 'refill': play('pop', 0.35, at({ rate: 0.9 })); break;
        case 'purr': startPurr(v, pan); break;
        case 'pet':
          if (purring) startPurr(v, pan);
          play('pop', 0.3 * v, at({ rate: 1.25 }));
          break;
        case 'purr-end': stopPurr(0.6); break;
        // Day 3: a token pops out (one ting each, climbing); bought; put on; the shop; you; buttons
        case 'token': for (let k = 0; k < Math.min(3, e.n || 1); k++) play('coin', 0.55, at({ which: k, rate: rec.coin ? [1, 1.12, 1.26][k] : 1, delay: k * 0.14 })); break;
        case 'buy': play('coinflip', 0.5); play('buy', 0.6, { delay: 0.12 }); play('trill', 0.42, { delay: 0.6, rate: 1.06 }); break;
        case 'wear': play('cloth', 0.6); if (rec.cloth) play('pop', 0.45, { delay: 0.3, rate: 0.9 }); break;
        case 'shop-open': play('shopOpen', 0.55); break;
        case 'shop-close': play('shopClose', 0.5); break;
        case 'footstep': play('pat', e.strong ? 0.36 : 0.26, { rate: (e.strong ? 0.8 : 0.72) * vary() }); break;
        case 'squeak': play('squeak', 0.5 * v, at({ rate: 1.1 * vary() })); break;
        case 'nope': play('nope', 0.5); break;
        case 'click':
          if (ctx.currentTime - lastClick < 0.05) break;     // one click per press
          lastClick = ctx.currentTime;
          play('click', 0.55, { rate: vary() });
          break;
        default:
      }
    },
  };
}
