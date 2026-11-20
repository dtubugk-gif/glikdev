// Day 2: the kitty's sounds in the browser. Nothing plays until the player has tapped once (browsers
// require a gesture). Every sound is synthesised by kittysound.js when audio starts, then played in
// answer to her events: meows, trills, chirps, mews, purring, a yawn, a sleepy sigh, crunching kibble,
// soft paw steps in time with her feet, the collar bell, the yarn landing and her paw swats.
// Sounds get quieter the further she is from the camera.
import * as S from './kittysound.js';

export function createKittyAudio() {
  let ctx = null, master = null, bufs = null, purring = null, n = 0, muted = false;

  function unlock() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.6;
    master.connect(ctx.destination);
    const sr = ctx.sampleRate;
    const make = (f) => { const b = ctx.createBuffer(1, f.length, sr); b.copyToChannel(f, 0); return b; };
    const many = (fn, k) => Array.from({ length: k }, (_, v) => make(fn(sr, v)));
    bufs = {
      meow: many(S.meow, 3), trill: many(S.trill, 3), chirp: many(S.chirp, 3), mew: many(S.mew, 3),
      purr: make(S.purr(sr, 4.0)), bell: many(S.bell, 2), yawn: [make(S.yawn(sr))], sigh: [make(S.sigh(sr))],
      bite: many(S.bite, 3), step: many(S.step, 4), thud: [make(S.thud(sr))], swat: [make(S.swat(sr))],
    };
  }

  function play(name, gain = 1, { rate = 1, delay = 0 } = {}) {
    const list = bufs[name];
    const src = ctx.createBufferSource();
    src.buffer = list[n++ % list.length];
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(master);
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

  const vary = () => 0.94 + 0.12 * ((n * 0.618) % 1);    // a little pitch variety, no two alike

  return {
    unlock,
    get running() { return !!ctx && ctx.state === 'running'; },
    get muted() { return muted; },
    setMuted(m) {
      muted = m;
      if (master) master.gain.setTargetAtTime(m ? 0 : 0.6, ctx.currentTime, 0.05);
    },
    /** feed it the kitty's events; `near` is 0-1 (1 = close to the camera) */
    event(e, near = 1) {
      if (!ctx || ctx.state !== 'running') return;
      const v = 0.35 + 0.65 * near;
      switch (e.type) {
        case 'meow': play('meow', 0.9 * v, { rate: vary() }); break;
        case 'trill': play('trill', 0.75 * v, { rate: vary() }); break;
        case 'chirp': play('chirp', 0.7 * v, { rate: vary() }); break;
        case 'mew': play('mew', 0.75 * v, { rate: vary() }); break;
        case 'yawn': play('yawn', 0.7 * v, { delay: e.delay || 0 }); break;
        case 'sigh': case 'asleep': if (e.type === 'sigh') play('sigh', 0.6 * v); break;
        case 'bite': play('bite', 0.7 * v, { rate: vary() }); break;
        case 'step': play('step', (e.strong ? 0.5 : 0.35) * v, { rate: vary() }); break;
        case 'thud': play('thud', (e.soft ? 0.32 : 0.6) * v, { rate: e.soft ? 1.15 : 1 }); break;
        case 'toss': play('swat', Math.min(0.55, 0.2 + (e.speed || 0) / 80), { rate: 0.7 }); break;
        case 'swat': play('swat', 0.6 * v); break;
        case 'leap': play('swat', 0.35 * v, { rate: 0.8 }); break;
        case 'land': play('step', 0.7 * v, { rate: 0.85 }); break;
        case 'jingle': case 'wake': play('bell', 0.4 * v); break;
        case 'bowl': play('bell', 0.3, { rate: 0.7 }); break;
        case 'refill': play('bell', 0.26, { rate: 0.8 }); break;
        case 'purr':
          stopPurr(0.2);
          purring = play('purr', 1.0 * v);
          purring.src.onended = () => { purring = null; };
          break;
        case 'pet':
          if (purring) { stopPurr(0.2); purring = play('purr', 1.0 * v); purring.src.onended = () => { purring = null; }; }
          play('bell', 0.25 * v);
          break;
        case 'purr-end': stopPurr(0.6); break;
        default:
      }
    },
  };
}
