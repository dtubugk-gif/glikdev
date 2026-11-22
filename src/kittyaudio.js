// The game's sounds in the browser. Nothing plays until the player has tapped once (browsers require a
// gesture). Every sound is synthesised by kittysound.js when audio starts, then played in answer to events:
// the kitty's voice (meows, trills, chirps, mews, purring, a yawn, a sleepy sigh), her crunching, paw steps,
// collar bell, the toy landing and her swats; and since Day 3 the friendship tokens, buying and dressing,
// the shop's door chime, your own footsteps, button ticks, the felt mouse's squeak and a quiet breeze.
// Sounds from her get quieter the further she is from the camera and sit left or right where she is on screen.
import * as S from './kittysound.js';

export function createKittyAudio() {
  let ctx = null, master = null, bufs = null, makers = null, purring = null, n = 0, muted = false, breeze = null;
  const LEVEL = 0.62;

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
    const sr = ctx.sampleRate;
    const make = (f) => { const b = ctx.createBuffer(1, f.length, sr); b.copyToChannel(f, 0); return b; };
    const many = (fn, k) => Array.from({ length: k }, (_, v) => make(fn(sr, v)));
    // each sound is built the first time it is needed, and the rest one by one in the background,
    // so the first tap never stalls while a whole library is synthesised
    const one = (fn, ...args) => () => [make(fn(sr, ...args))];
    makers = {
      meow: () => many(S.meow, 3), trill: () => many(S.trill, 3), chirp: () => many(S.chirp, 3), mew: () => many(S.mew, 3),
      purr: one(S.purr, 4.0), bell: () => many(S.bell, 2), yawn: one(S.yawn), sigh: one(S.sigh),
      bite: () => many(S.bite, 3), step: () => many(S.step, 4), thud: one(S.thud), swat: one(S.swat),
      coin: () => many(S.coin, 3), buy: one(S.buy), wear: one(S.wear), shopOpen: one(S.shopOpen),
      shopClose: one(S.shopClose), footstep: () => many(S.footstep, 4), click: () => many(S.click, 3), squeak: () => many(S.squeak, 3),
      nope: one(S.nope),
    };
    bufs = {};
    const order = ['click', 'bell', 'trill', 'purr', 'coin', 'footstep', 'meow', 'step', 'chirp', 'swat', 'thud', 'bite', 'mew', 'wear', 'buy',
      'shopOpen', 'shopClose', 'squeak', 'nope', 'yawn', 'sigh'];
    const warm = () => { const k = order.find((x) => !bufs[x]); if (!k) return; bufs[k] = makers[k](); setTimeout(warm, 40); };
    setTimeout(warm, 60);
    // the breeze: built a moment later (nine seconds of it), then left looping very quietly
    setTimeout(() => {
      if (!ctx) return;
      const src = ctx.createBufferSource();
      src.buffer = make(S.wind(sr, 9));
      src.loop = true;
      const g = ctx.createGain();
      g.gain.value = 0;
      g.gain.linearRampToValueAtTime(0.16, ctx.currentTime + 3);
      src.connect(g).connect(master);
      src.start();
      breeze = src;
    }, 2500);
  }

  function play(name, gain = 1, { rate = 1, delay = 0, pan = 0, which = null } = {}) {
    const list = bufs[name] || (bufs[name] = makers[name]());
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
    purring.g.gain.linearRampToValueAtTime(1.0 * v, ctx.currentTime + 0.25);   // a purr swells in, it does not switch on
    purring.src.onended = () => { purring = null; };
  }

  const vary = () => 0.94 + 0.12 * ((n * 0.618) % 1);    // a little pitch variety, no two alike
  let lastClick = 0;

  return {
    unlock,
    get running() { return !!ctx && ctx.state === 'running'; },
    get muted() { return muted; },
    setMuted(m) {
      muted = m;
      if (master) master.gain.setTargetAtTime(m ? 0 : LEVEL, ctx.currentTime, 0.05);
    },
    /**
     * feed it events (the kitty's, and the game's); `near` is 0-1 (1 = close to the camera),
     * `pan` is where the sound is on screen, -1 (left) to 1 (right)
     */
    event(e, near = 1, pan = 0) {
      if (!ctx || ctx.state !== 'running') return;
      const v = 0.35 + 0.65 * near;
      const o = (extra) => ({ pan, ...extra });
      switch (e.type) {
        case 'meow': play('meow', 0.9 * v, o({ rate: vary() })); break;
        case 'trill': play('trill', 0.72 * v, o({ rate: vary() })); break;
        case 'chirp': play('chirp', 0.62 * v, o({ rate: vary() })); break;
        case 'mew': play('mew', 0.7 * v, o({ rate: vary() })); break;
        case 'yawn': play('yawn', 0.7 * v, o({ delay: e.delay || 0 })); break;
        case 'sigh': play('sigh', 0.6 * v, o()); break;
        case 'bite': play('bite', 0.7 * v, o({ rate: vary() })); break;
        case 'step': play('step', (e.strong ? 0.5 : 0.34) * v, o({ rate: vary() })); break;
        case 'thud': play('thud', (e.soft ? 0.32 : 0.6) * v, o({ rate: e.soft ? 1.15 : 1 })); break;
        case 'toss': play('swat', Math.min(0.55, 0.2 + (e.speed || 0) / 80), { rate: 0.7 }); break;
        case 'swat': play('swat', 0.6 * v, o()); break;
        case 'leap': play('swat', 0.35 * v, o({ rate: 0.8 })); break;
        case 'land': play('step', 0.7 * v, o({ rate: 0.85 })); break;
        case 'jingle': case 'wake': play('bell', 0.38 * v, o({ rate: vary() })); break;
        case 'bowl': play('bell', 0.28, o({ rate: 0.7 })); break;
        case 'refill': play('bell', 0.24, o({ rate: 0.8 })); break;
        case 'purr': startPurr(v, pan); break;
        case 'pet':
          if (purring) startPurr(v, pan);
          play('bell', 0.2 * v, o());
          break;
        case 'purr-end': stopPurr(0.6); break;
        // Day 3: a token pops out (one bright ting each, climbing); bought; put on; the shop; you; buttons
        case 'token': for (let k = 0; k < Math.min(3, e.n || 1); k++) play('coin', 0.5, o({ which: k, delay: k * 0.14 })); break;
        case 'buy': play('buy', 0.62); play('trill', 0.45, { delay: 0.5, rate: 1.06 }); break;
        case 'wear': play('wear', 0.6); break;
        case 'shop-open': play('shopOpen', 0.5); break;
        case 'shop-close': play('shopClose', 0.5); break;
        case 'footstep': play('footstep', e.strong ? 0.34 : 0.24, { rate: vary() }); break;
        case 'squeak': play('squeak', 0.5 * v, o({ rate: vary() })); break;
        case 'nope': play('nope', 0.5); break;
        case 'click':
          if (ctx.currentTime - lastClick < 0.05) break;     // one tick per press
          lastClick = ctx.currentTime;
          play('click', 0.5, { rate: vary() });
          break;
        default:
      }
    },
  };
}
