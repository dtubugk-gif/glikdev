// Day 2: the kitty's sounds in the browser. Nothing plays until the player has tapped (browsers
// require a gesture), and only in answer to what the player does: a meow when she arrives where she
// was called, a purr while she is petted, the collar bell when she sets off or is petted.
import { meow, purr, bell } from './kittysound.js';

export function createKittyAudio() {
  let ctx = null, master = null, bufs = null, purring = null, n = 0;

  function unlock() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
    const sr = ctx.sampleRate;
    const make = (f) => { const b = ctx.createBuffer(1, f.length, sr); b.copyToChannel(f, 0); return b; };
    bufs = { meow: [0, 1, 2].map((v) => make(meow(sr, v))), purr: make(purr(sr, 4.0)), bell: [0, 1].map((v) => make(bell(sr, v))) };
  }

  function play(buf, gain = 1, { rate = 1 } = {}) {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(master);
    src.start();
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

  return {
    unlock,
    /** feed it the kitty's brain events */
    event(e) {
      if (!ctx || ctx.state !== 'running') return;
      if (e.type === 'meow') play(bufs.meow[n++ % 3], 0.9, { rate: 0.97 + 0.06 * ((n * 0.37) % 1) });
      else if (e.type === 'purr' || (e.type === 'pet' && purring)) {
        stopPurr(0.2);
        purring = play(bufs.purr, 1.0);
        purring.src.onended = () => { purring = null; };
      } else if (e.type === 'purr-end') stopPurr(0.6);
      if (e.type === 'jingle' || e.type === 'pet') play(bufs.bell[n++ % 2], e.type === 'pet' ? 0.35 : 0.45);
    },
  };
}
