// Day 2: the kitty's voice, synthesised (no sample files). Pure functions that return mono
// Float32Array samples, so the game plays them through Web Audio and the Short's tools can write
// the very same sounds to WAV in node.
//
// meow(sr, v): additive synthesis. A harmonic source whose pitch rises then falls ("mi-AU"), shaped by
//   moving formant peaks (the mouth opening from an "m" through "ee-ah" to a rounded "ow"), plus breath.
// purr(sr, seconds): the 25-ish Hz rumble of a purr: bursts of low, filtered noise at the purr rate,
//   in alternating out-breath / in-breath phrases (the in-breath a little quieter and higher).
// bell(sr, v): the little gold bell on her collar: inharmonic partials with fast decays, 2-3 strikes.

const TAU = Math.PI * 2;

function prng(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) / 4294967296) * 2 - 1; };
}
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

function normalise(buf, peak) {
  let m = 0;
  for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i]));
  if (m > 0) for (let i = 0; i < buf.length; i++) buf[i] *= peak / m;
  return buf;
}

/** @param {number} sr sample rate  @param {number} v variant 0, 1, 2 ... (pitch, length and shape vary) */
export function meow(sr = 48000, v = 0) {
  const r = prng(17 + v * 31);
  const dur = 0.66 + 0.1 * ((v * 0.37) % 1);
  const n = Math.floor(sr * dur);
  const out = new Float32Array(n);
  const base = 520 + 70 * ((v * 0.61) % 1);
  // formant tracks over the call: "m" -> "ee" -> "ah" -> "ow"
  const track = (u) => {
    const F1 = u < 0.08 ? 380 : u < 0.35 ? 760 + 900 * smooth(0.08, 0.35, u) : 1660 - 1000 * smooth(0.45, 1, u);
    const F2 = u < 0.08 ? 1500 : u < 0.4 ? 2900 - 300 * smooth(0.1, 0.4, u) : 2600 - 1400 * smooth(0.5, 1, u);
    const F3 = 4300 - 600 * smooth(0.5, 1, u);
    return [F1, F2, F3];
  };
  let phase = 0, jitter = 0;
  let hp = 0, lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, u = t / dur;
    // pitch: up to a peak a third of the way in, then a long fall, with a little vibrato and jitter
    const contour = 1 + 0.42 * smooth(0.0, 0.32, u) - 0.62 * smooth(0.32, 1.0, u);
    jitter += (r() * 0.004 - jitter * 0.02);
    const f0 = base * contour * (1 + 0.012 * Math.sin(TAU * 6.2 * t) + jitter);
    phase += f0 / sr;
    const [F1, F2, F3] = track(u);
    const nasal = 1 - smooth(0.0, 0.1, u);                     // the "m": muffled highs at the start
    const round = smooth(0.55, 1.0, u);                         // lips rounding at the end
    let s = 0;
    for (let k = 1; k * f0 < sr * 0.45 && k <= 28; k++) {
      const f = k * f0;
      const env = 1.0 / (1 + ((f - F1) / 260) ** 2) + 0.75 / (1 + ((f - F2) / 340) ** 2) + 0.32 / (1 + ((f - F3) / 520) ** 2);
      const tilt = 1 / k ** (0.9 + 0.8 * nasal + 0.5 * round);
      s += Math.sin(TAU * k * phase) * env * tilt;
    }
    // breath: high-passed noise, strongest at the start and as the meow trails off
    const nz = r();
    hp = 0.92 * (hp + nz - lp); lp = nz;
    s += hp * (0.05 + 0.08 * nasal + 0.05 * round);
    const amp = smooth(0.0, 0.07, u) * (1 - smooth(0.72, 1.0, u)) * (0.75 + 0.25 * Math.sin(Math.PI * Math.min(1, u * 1.4)));
    out[i] = s * amp;
  }
  return normalise(out, 0.8);
}
/** A purr of `seconds`, starting on an out-breath. Loops cleanly if you cut on a breath boundary. */
export function purr(sr = 48000, seconds = 3.6, seed = 3) {
  const r = prng(seed);
  const n = Math.floor(sr * seconds);
  const out = new Float32Array(n);
  let a = 0, b = 0, c = 0, ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    // breath phrases: 1.25 s out, 1.05 s in, 0.06 s soft gaps
    const cyc = t % 2.3;
    const outBreath = cyc < 1.25;
    const local = outBreath ? cyc / 1.25 : (cyc - 1.25) / 1.05;
    const breathEnv = smooth(0, 0.08, local) * (1 - smooth(0.9, 1, local)) * (outBreath ? 1 : 0.72);
    const rate = outBreath ? 25.5 : 27.5;
    ph += rate / sr;
    const p = ph % 1;
    // each purr pulse: a fast rise and a softer fall, never fully silent between pulses
    const pulse = 0.22 + 0.78 * Math.pow(Math.sin(Math.PI * Math.pow(p, 0.6)), 2.2);
    // low noise: two one-pole low-passes (about 350 Hz) and a gentle resonance near 120 Hz
    const nz = r();
    a += (nz - a) * 0.045;
    b += (a - b) * 0.045;
    c = c * 0.985 + b * 0.25;
    const thump = Math.sin(TAU * (outBreath ? 52 : 58) * t) * 0.35;
    out[i] = (b * 2.4 + c * 0.6 + thump) * pulse * breathEnv;
  }
  // soft fade in / out so a one-off purr never clicks
  const f = Math.floor(sr * 0.08);
  for (let i = 0; i < f; i++) { out[i] *= i / f; out[n - 1 - i] *= i / f; }
  return normalise(out, 0.7);
}

/** The collar bell: 2-3 quick strikes of a small brass bell. */
export function bell(sr = 48000, v = 0) {
  const n = Math.floor(sr * 0.9);
  const out = new Float32Array(n);
  const partials = [[1, 1, 0.42], [2.32, 0.55, 0.26], [4.25, 0.32, 0.14], [6.63, 0.18, 0.08], [9.1, 0.08, 0.05]];
  const f0 = 2650 + 120 * (v % 3);
  const strikes = [[0, 1], [0.085 + 0.01 * (v % 2), 0.62], [0.2, 0.33]].slice(0, 2 + (v % 2));
  for (const [t0, g] of strikes) {
    const s0 = Math.floor(t0 * sr);
    for (let i = s0; i < n; i++) {
      const t = (i - s0) / sr;
      let s = 0;
      for (const [ratio, amp, decay] of partials) s += Math.sin(TAU * f0 * ratio * t * (1 + 0.0008 * Math.sin(TAU * 5 * t))) * amp * Math.exp(-t / decay);
      out[i] += s * g * (1 - Math.exp(-t * 2500));
    }
  }
  return normalise(out, 0.55);
}

// ---------------------------------------------------------------------------------------------
// More of her voice and the sounds around her (added with the care features).
//   voice(sr, spec)  the shared engine: a harmonic source with a pitch curve, moving formants,
//                    optional rolled-R flutter (a trill) and breath noise.
//   trill: the rolled "brrrp?" cats make to say hello;  chirp: a quick "mrp!" at prey (the yarn)
//   mew: a tiny, high kitten mew (hungry);  yawn: a long breathy "aaah" falling;  sigh: an out-breath
//   bite: crunchy kibble;  step: a soft paw pad on the floor;  thud: the yarn landing;  swat: a paw flick

function voice(sr, { dur, f0, formants, flutter = null, breath = 0.06, tilt = 1.1, amp, seed = 1, peak = 0.8 }) {
  const r = prng(seed);
  const n = Math.floor(sr * dur);
  const out = new Float32Array(n);
  let phase = 0, jitter = 0, hp = 0, lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, u = t / dur;
    jitter += r() * 0.004 - jitter * 0.02;
    const f = f0(u) * (1 + jitter);
    phase += f / sr;
    const F = formants(u);
    let s = 0;
    for (let k = 1; k * f < sr * 0.45 && k <= 24; k++) {
      const h = k * f;
      let env = 0;
      for (const [Fc, bw, g] of F) env += g / (1 + ((h - Fc) / bw) ** 2);
      s += Math.sin(TAU * k * phase) * env / k ** tilt;
    }
    const nz = r();
    hp = 0.9 * (hp + nz - lp); lp = nz;
    s += hp * breath;
    const fl = flutter ? 1 - flutter.depth * (0.5 + 0.5 * Math.sin(TAU * flutter.rate * t)) : 1;
    out[i] = s * amp(u) * fl;
  }
  return normalise(out, peak);
}

/** "brrrp?": a rolled, rising hello */
export function trill(sr = 48000, v = 0) {
  const base = 430 + 60 * (v % 3);
  return voice(sr, {
    dur: 0.42 + 0.06 * (v % 2), seed: 41 + v,
    f0: (u) => base * (1 + 0.38 * smooth(0.15, 0.95, u)),
    formants: (u) => [[700 + 500 * u, 300, 1], [2300, 420, 0.6], [4000, 600, 0.25]],
    flutter: { rate: 26, depth: 0.75 }, breath: 0.05, tilt: 1.25,
    amp: (u) => smooth(0, 0.08, u) * (1 - smooth(0.8, 1, u)),
  });
}

/** "mrp!": short, high, quick upward chirp */
export function chirp(sr = 48000, v = 0) {
  const base = 780 + 90 * (v % 3);
  return voice(sr, {
    dur: 0.17, seed: 61 + v,
    f0: (u) => base * (1 + 0.55 * smooth(0, 0.7, u)),
    formants: (u) => [[1300, 320, 1], [2900, 500, 0.7]],
    breath: 0.04, tilt: 1.0,
    amp: (u) => smooth(0, 0.12, u) * (1 - smooth(0.6, 1, u)),
  });
}

/** a tiny kitten "mew" */
export function mew(sr = 48000, v = 0) {
  const base = 980 + 120 * (v % 3);
  return voice(sr, {
    dur: 0.36, seed: 71 + v,
    f0: (u) => base * (1 + 0.2 * smooth(0, 0.3, u) - 0.35 * smooth(0.3, 1, u)),
    formants: (u) => [[1500 - 300 * u, 340, 1], [3200, 500, 0.6], [5200, 700, 0.2]],
    breath: 0.07, tilt: 0.95,
    amp: (u) => smooth(0, 0.1, u) * (1 - smooth(0.65, 1, u)),
  });
}

/** a big yawn: breathy, opening wide, pitch sliding down */
export function yawn(sr = 48000) {
  return voice(sr, {
    dur: 1.1, seed: 83, peak: 0.6,
    f0: (u) => 420 * (1 - 0.45 * smooth(0.1, 1, u)),
    formants: (u) => [[600 + 700 * Math.sin(Math.PI * Math.min(1, u * 1.3)), 380, 1], [1700, 450, 0.5]],
    breath: 0.35, tilt: 1.5,
    amp: (u) => smooth(0, 0.15, u) * (1 - smooth(0.55, 1, u)),
  });
}

/** a contented out-breath as she settles down */
export function sigh(sr = 48000) {
  const r = prng(91);
  const n = Math.floor(sr * 0.8);
  const out = new Float32Array(n);
  let a = 0, b2 = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    a += (r() - a) * 0.25; b2 += (a - b2) * 0.25;
    out[i] = (a - b2 * 0.6) * smooth(0, 0.12, u) * (1 - smooth(0.35, 1, u));
  }
  return normalise(out, 0.4);
}

/** crunchy kibble: a few sharp clicks inside a short burst of dry noise */
export function bite(sr = 48000, v = 0) {
  const r = prng(101 + v);
  const n = Math.floor(sr * 0.16);
  const out = new Float32Array(n);
  const clicks = [0, 0.018, 0.04, 0.07].map((c) => c + 0.006 * (v % 3));
  let hp = 0, lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const nz = r();
    hp = 0.6 * (hp + nz - lp); lp = nz;
    let e = 0;
    for (const c of clicks) if (t >= c) e += Math.exp(-(t - c) * 140);
    out[i] = hp * e * (1 - smooth(0.08, 0.16, t));
  }
  return normalise(out, 0.5);
}

/** a soft paw pad on the floor */
export function step(sr = 48000, v = 0) {
  const r = prng(121 + v);
  const n = Math.floor(sr * 0.09);
  const out = new Float32Array(n);
  let a = 0, b2 = 0;
  const f = 70 + 12 * (v % 4);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    a += (r() - a) * 0.08; b2 += (a - b2) * 0.08;
    out[i] = (b2 * 3 + Math.sin(TAU * f * t) * 0.5) * Math.exp(-t * 55) * (1 - Math.exp(-t * 900));
  }
  return normalise(out, 0.5);
}

/** the yarn landing on the plate */
export function thud(sr = 48000) {
  const r = prng(131);
  const n = Math.floor(sr * 0.25);
  const out = new Float32Array(n);
  let a = 0, b2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    a += (r() - a) * 0.05; b2 += (a - b2) * 0.05;
    out[i] = (b2 * 3 + Math.sin(TAU * 55 * t) * 0.8) * Math.exp(-t * 22) * (1 - Math.exp(-t * 600));
  }
  return normalise(out, 0.6);
}

/** a quick paw flick: a short whoosh with a soft tap at the end */
export function swat(sr = 48000) {
  const r = prng(141);
  const n = Math.floor(sr * 0.22);
  const out = new Float32Array(n);
  let bp = 0, lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, u = t / 0.22;
    const nz = r();
    const k = 0.05 + 0.25 * smooth(0, 0.6, u);              // the band sweeps up as the paw speeds up
    lp += (nz - lp) * k; bp = nz - lp;
    const tap = t > 0.16 ? Math.sin(TAU * 160 * (t - 0.16)) * Math.exp(-(t - 0.16) * 60) : 0;
    out[i] = bp * Math.sin(Math.PI * Math.min(1, u * 1.25)) * 0.6 + tap;
  }
  return normalise(out, 0.5);
}
