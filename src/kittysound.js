// Synthesised sounds: pure functions that return mono Float32Array samples.
//
// In the game (kittyaudio.js) these are only STAND-INS for effects whose recording (game/sounds/*.mp3) has not
// loaded yet or could not load: bell, bite, step, thud, swat, coin, buy, wear, shopOpen, shopClose, footstep, click,
// squeak, nope, pop, tick. The game NEVER plays a synthesised cat: the owner wants the cats to be real cats only,
// so if a meow, trill, chirp, purr or sigh recording is missing the game stays silent for it.
// meow, purr, trill, chirp, mew, yawn, sigh (and wind) below are kept only for the Day 2/3 Short tools
// (tools/sounds.mjs) and their tests; nothing in the game calls them.
//
// Day 2 notes:
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

/** A two-pole resonator (a formant): feed it noise, tell it where and how wide. */
function resonator(sr) {
  let y1 = 0, y2 = 0;
  return (x, f, bw) => {
    const r = Math.exp((-Math.PI * bw) / sr);
    const y = 2 * r * Math.cos((TAU * f) / sr) * y1 - r * r * y2 + (1 - r) * x;
    y2 = y1; y1 = y;
    return y;
  };
}

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
  const rs1 = resonator(sr), rs2 = resonator(sr);
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
    // breath: noise sung through the same mouth (the first two formants), so it belongs to the voice
    s += (rs1(nz, F1, 260) * 2.2 + rs2(nz, F2, 380) * 1.6) * 3 * (0.3 + 0.5 * nasal + 0.4 * round) + hp * 0.02;
    // a little roughness as the call starts and as it trails off (the voice catching)
    s *= 1 + (0.10 * (1 - smooth(0, 0.22, u)) + 0.07 * smooth(0.7, 1, u)) * Math.sin(Math.PI * phase);
    const amp = smooth(0.0, 0.07, u) * (1 - smooth(0.72, 1.0, u)) * (0.75 + 0.25 * Math.sin(Math.PI * Math.min(1, u * 1.4)));
    out[i] = s * amp;
  }
  return finish(out, sr, { peak: 0.8, wet: 0.13, t60: 0.32, hp: 150, drive: 0.12 });
}
/** A purr of `seconds`, starting on an out-breath. Loops cleanly if you cut on a breath boundary. */
export function purr(sr = 48000, seconds = 3.6, seed = 3) {
  const r = prng(seed);
  const n = Math.floor(sr * seconds);
  const out = new Float32Array(n);
  let a = 0, b = 0, c = 0, d = 0, ph = 0;
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
    d += (nz - d) * 0.2;                                   // a soft rattle in the chest, riding each pulse
    out[i] = (b * 2.4 + c * 0.6 + thump + (d - a) * 0.2 * pulse) * pulse * breathEnv;
  }
  // soft fade in / out so a one-off purr never clicks
  const f = Math.floor(sr * 0.08);
  for (let i = 0; i < f; i++) { out[i] *= i / f; out[n - 1 - i] *= i / f; }
  return finish(out, sr, { peak: 0.7, wet: 0.05, t60: 0.25, hp: 28 });
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
      for (const [ratio, amp, decay] of partials) s += (Math.sin(TAU * f0 * ratio * t * (1 + 0.0008 * Math.sin(TAU * 5 * t))) + 0.45 * Math.sin(TAU * f0 * ratio * 1.006 * t)) * amp * Math.exp(-t / decay);   // paired partials: a shimmer
      out[i] += s * g * (1 - Math.exp(-t * 2500));
    }
  }
  return finish(out, sr, { peak: 0.55, wet: 0.14, t60: 0.45, hp: 400 });
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
  const rs1 = resonator(sr), rs2 = resonator(sr);
  for (let i = 0; i < n; i++) {
    const t = i / sr, u = t / dur;
    jitter += r() * 0.004 - jitter * 0.02;
    const f = f0(u) * (1 + jitter + 0.012 * Math.sin(TAU * 5.8 * t) * smooth(0.2, 0.6, u));   // a little vibrato once the note has opened
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
    s += (rs1(nz, F[0][0], F[0][1]) * 2.2 + (F[1] ? rs2(nz, F[1][0], F[1][1]) * 1.6 : 0)) * breath * 14 + hp * breath * 0.3;   // breath through the mouth's own formants
    const fl = flutter ? 1 - flutter.depth * (0.5 + 0.5 * Math.sin(TAU * flutter.rate * t)) : 1;
    out[i] = s * amp(u) * fl;
  }
  return finish(out, sr, { peak, wet: 0.12, t60: 0.3, hp: 140, drive: 0.1 });
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
  return finish(out, sr, { peak: 0.4, wet: 0.1, t60: 0.3, hp: 120 });
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
    out[i] = hp * e * (1 - smooth(0.08, 0.16, t)) + Math.sin(TAU * 170 * t) * Math.exp(-t * 60) * 0.22;   // and the soft thump of her jaw
  }
  return finish(out, sr, { peak: 0.5, wet: 0.08, t60: 0.2, hp: 110 });
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
    out[i] = (b2 * 3 + Math.sin(TAU * f * t) * 0.5) * Math.exp(-t * 55) * (1 - Math.exp(-t * 900))
      + Math.sin(TAU * 3400 * t) * Math.exp(-t * 700) * 0.05;       // the faintest tick of a claw
  }
  return finish(out, sr, { peak: 0.5, wet: 0.1, t60: 0.22, hp: 45 });
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
  return finish(out, sr, { peak: 0.6, wet: 0.14, t60: 0.3, hp: 35 });
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
  return finish(out, sr, { peak: 0.5, wet: 0.12, t60: 0.25, hp: 150 });
}

// ---------------------------------------------------------------------------------------------
// Day 3 sound pass (the owner: "improve all of the sound effects").
//   finish()   every sound now ends here: rumble and DC out, a touch of soft saturation, a small room
//              (so nothing is bone dry), a click-free tail, then its peak.
//   New sounds: coin (a friendship token), buy (cha-ching), wear (cloth and a pop), shopOpen (the door
//   chime), shopClose, footstep (your trainers on the plate), click (buttons), squeak (the felt mouse),
//   nope (not enough tokens), wind (a quiet, loopable breeze).

/** A small room: four damped combs and two all-passes (Schroeder), mixed in at `wet`. In place. */
function room(out, sr, wet = 0.12, t60 = 0.35) {
  if (wet <= 0) return out;
  const n = out.length;
  const tail = new Float32Array(n);
  for (const ms of [29.7, 37.1, 41.1, 43.7]) {
    const d = Math.max(1, Math.round((ms / 1000) * sr));
    const g = Math.pow(10, (-3 * (ms / 1000)) / t60);
    const buf = new Float32Array(d);
    let k = 0, lp = 0;
    for (let i = 0; i < n; i++) {
      const y = buf[k];
      lp += (y - lp) * 0.45;                       // the room soaks up the highs a little on every pass
      buf[k] = out[i] + lp * g;
      tail[i] += y * 0.25;
      if (++k === d) k = 0;
    }
  }
  for (const ms of [5.0, 1.7]) {
    const d = Math.max(1, Math.round((ms / 1000) * sr));
    const buf = new Float32Array(d);
    let k = 0;
    for (let i = 0; i < n; i++) {
      const x = tail[i], y = buf[k];
      buf[k] = x + y * 0.5;
      tail[i] = y - x * 0.5;
      if (++k === d) k = 0;
    }
  }
  for (let i = 0; i < n; i++) out[i] += tail[i] * wet;
  return out;
}

/** The last stop of every sound. */
function finish(out, sr, { peak = 0.6, wet = 0.12, t60 = 0.35, hp = 60, drive = 0.0, fade = 0.012 } = {}) {
  const n = out.length;
  const a = Math.exp((-TAU * hp) / sr);              // one-pole high-pass: no DC, no rumble
  let x1 = 0, y1 = 0;
  for (let i = 0; i < n; i++) { const x = out[i]; y1 = a * (y1 + x - x1); x1 = x; out[i] = y1; }
  if (drive > 0) {
    let m = 0;
    for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(out[i]));
    if (m > 0) for (let i = 0; i < n; i++) out[i] = Math.tanh((out[i] / m) * (1 + drive * 3)) / Math.tanh(1 + drive * 3);
  }
  room(out, sr, wet, t60);
  const f = Math.min(n >> 1, Math.floor(sr * fade));
  for (let i = 0; i < f; i++) out[n - 1 - i] *= i / f;
  return normalise(out, peak);
}

/** One struck bell or chime partial set, added into `out` from sample s0. */
function strike(out, sr, s0, f0, gain, partials, bright = 2500) {
  const n = out.length;
  for (let i = Math.max(0, s0); i < n; i++) {
    const t = (i - s0) / sr;
    let s = 0;
    for (const [ratio, amp, decay] of partials) {
      if (f0 * ratio > sr * 0.45) continue;
      s += Math.sin(TAU * f0 * ratio * t) * amp * Math.exp(-t / decay);
    }
    out[i] += s * gain * (1 - Math.exp(-t * bright));
  }
}
const CHIME = [[1, 1, 0.34], [2.0, 0.42, 0.2], [3.01, 0.2, 0.12], [4.2, 0.12, 0.07], [5.43, 0.07, 0.05]];
const semis = (k) => Math.pow(2, k / 12);

/** A friendship token: the classic two-note "ting!" (a fourth up), with a sparkle on top. v = 0, 1, 2 climb. */
export function coin(sr = 48000, v = 0) {
  const n = Math.floor(sr * 0.62);
  const out = new Float32Array(n);
  const r = prng(201 + v);
  const f = 988 * semis(2 * (v % 3));
  strike(out, sr, 0, f, 0.8, CHIME, 6000);
  strike(out, sr, Math.floor(sr * 0.072), f * semis(5), 1.0, CHIME, 6000);
  for (let i = 0; i < Math.floor(sr * 0.03); i++) out[i] += r() * 0.18 * Math.exp(-i / (sr * 0.006));   // the flick of the coin
  return finish(out, sr, { peak: 0.58, wet: 0.16, t60: 0.5, hp: 300 });
}

/** Bought it: coins dropping in, the till's bell, and a little run of sparkle. */
export function buy(sr = 48000) {
  const n = Math.floor(sr * 1.15);
  const out = new Float32Array(n);
  const r = prng(211);
  for (const [t0, st, g] of [[0, 0, 0.55], [0.06, 4, 0.5], [0.115, 7, 0.55]]) strike(out, sr, Math.floor(sr * t0), 1047 * semis(st), g, CHIME, 6000);
  strike(out, sr, Math.floor(sr * 0.2), 2093, 0.9, [[1, 1, 0.55], [2.76, 0.4, 0.3], [5.4, 0.18, 0.16], [8.9, 0.08, 0.09]], 5000);   // "ching"
  [0, 4, 7, 12, 16].forEach((st, k) => strike(out, sr, Math.floor(sr * (0.3 + 0.045 * k)), 2093 * semis(st), 0.16, [[1, 1, 0.16], [2, 0.3, 0.08]], 8000));
  for (let i = 0; i < Math.floor(sr * 0.04); i++) out[i] += r() * 0.15 * Math.exp(-i / (sr * 0.008));
  return finish(out, sr, { peak: 0.62, wet: 0.2, t60: 0.7, hp: 250 });
}

/** Putting something on: a quick swish of cloth, then a soft, round pop as it settles. */
export function wear(sr = 48000) {
  const n = Math.floor(sr * 0.34);
  const out = new Float32Array(n);
  const r = prng(221);
  let lp = 0, lp2 = 0, ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const u = Math.min(1, t / 0.17);
    const nz = r();
    const k = 0.12 + 0.5 * smooth(0, 1, u);
    lp += (nz - lp) * k; lp2 += (lp - lp2) * 0.6;
    const swish = (lp - lp2 * 0.5) * Math.sin(Math.PI * u) ** 1.5 * (t < 0.17 ? 1 : 0) * 0.5;
    let pop = 0;
    if (t > 0.15) {
      const q = t - 0.15;
      const f = 300 + 420 * Math.exp(-q * 38);
      ph += f / sr;
      pop = Math.sin(TAU * ph) * Math.exp(-q * 30) * (1 - Math.exp(-q * 1500));
    }
    out[i] = swish + pop * 0.9;
  }
  return finish(out, sr, { peak: 0.5, wet: 0.14, t60: 0.3, hp: 120 });
}

/** The shop's door chime: ding, dong. */
export function shopOpen(sr = 48000) {
  const n = Math.floor(sr * 1.3);
  const out = new Float32Array(n);
  const P = [[1, 1, 0.6], [2.0, 0.5, 0.36], [2.99, 0.28, 0.22], [4.1, 0.16, 0.13], [5.9, 0.07, 0.08]];
  strike(out, sr, 0, 1319, 0.9, P, 4000);
  strike(out, sr, Math.floor(sr * 0.26), 1047, 1.0, P, 4000);
  return finish(out, sr, { peak: 0.5, wet: 0.24, t60: 0.9, hp: 300 });
}

/** Leaving the counter: a soft wooden knock and the chime's last little ring. */
export function shopClose(sr = 48000) {
  const n = Math.floor(sr * 0.5);
  const out = new Float32Array(n);
  const r = prng(231);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    lp += (r() - lp) * 0.2;
    out[i] = (Math.sin(TAU * 210 * t) * 0.8 + Math.sin(TAU * 345 * t) * 0.35 + lp * 0.6) * Math.exp(-t * 55) * (1 - Math.exp(-t * 1800));
  }
  strike(out, sr, Math.floor(sr * 0.03), 1047, 0.22, [[1, 1, 0.3], [2.0, 0.4, 0.16]], 4000);
  return finish(out, sr, { peak: 0.42, wet: 0.18, t60: 0.5, hp: 90 });
}

/** Your trainers on the plate: a soft heel thump and a short rubbery scuff. Four variants. */
export function footstep(sr = 48000, v = 0) {
  const r = prng(241 + v);
  const n = Math.floor(sr * 0.13);
  const out = new Float32Array(n);
  let lp = 0, bp = 0, lp2 = 0;
  const f = 105 + 14 * (v % 4), tone = 0.16 + 0.05 * ((v * 3) % 4);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const nz = r();
    lp += (nz - lp) * tone; lp2 += (lp - lp2) * 0.04; bp = lp - lp2;      // a band of scuff, roughly 300 Hz - 2 kHz
    const thump = Math.sin(TAU * f * t * (1 - 0.6 * t)) * Math.exp(-t * 48);
    const scuff = bp * Math.exp(-(((t - 0.022) / 0.02) ** 2)) * 1.0;
    out[i] = (thump * 0.9 + scuff) * (1 - Math.exp(-t * 1400));
  }
  return finish(out, sr, { peak: 0.45, wet: 0.1, t60: 0.25, hp: 70 });
}

/** A button: a small, dry, woody tick. */
export function click(sr = 48000, v = 0) {
  const r = prng(251 + v);
  const n = Math.floor(sr * 0.06);
  const out = new Float32Array(n);
  const f = 1500 + 220 * (v % 3);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    out[i] = (Math.sin(TAU * f * t) * 0.7 + Math.sin(TAU * f * 2.41 * t) * 0.25 + r() * 0.25 * Math.exp(-t * 900)) * Math.exp(-t * 130) * (1 - Math.exp(-t * 6000));
  }
  return finish(out, sr, { peak: 0.32, wet: 0.06, t60: 0.15, hp: 400, fade: 0.005 });
}

/** The felt mouse squeaks when she bats it: a quick, bendy two-part squeak. */
export function squeak(sr = 48000, v = 0) {
  const n = Math.floor(sr * 0.2);
  const out = new Float32Array(n);
  const base = 1750 + 160 * (v % 3);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, u = t / 0.2;
    const f = base * (1 + 0.5 * Math.sin(Math.PI * Math.min(1, u * 1.15)) - 0.22 * smooth(0.7, 1, u));
    ph += f / sr;
    const s = Math.sin(TAU * ph) + 0.32 * Math.sin(TAU * 2 * ph) + 0.12 * Math.sin(TAU * 3 * ph);
    out[i] = s * smooth(0, 0.08, u) * (1 - smooth(0.7, 1, u)) * (1 - 0.25 * Math.sin(TAU * 38 * t));
  }
  return finish(out, sr, { peak: 0.42, wet: 0.1, t60: 0.25, hp: 500 });
}

/** Not enough tokens: two soft, round notes stepping down. Friendly, not a buzzer. */
export function nope(sr = 48000) {
  const n = Math.floor(sr * 0.34);
  const out = new Float32Array(n);
  const P = [[1, 1, 0.12], [2.0, 0.22, 0.06], [4.0, 0.06, 0.03]];
  strike(out, sr, 0, 392, 0.9, P, 900);
  strike(out, sr, Math.floor(sr * 0.11), 311, 1.0, P, 900);
  return finish(out, sr, { peak: 0.4, wet: 0.1, t60: 0.3, hp: 120 });
}

/** A quiet breeze over the plate, `seconds` long, made to loop without a seam. */
export function wind(sr = 48000, seconds = 9) {
  const n = Math.floor(sr * seconds);
  const over = Math.floor(sr * 1.0);
  const r = prng(261);
  const raw = new Float32Array(n + over);
  let a = 0, b = 0, c = 0;
  for (let i = 0; i < n + over; i++) {
    const t = i / sr;
    const nz = r();
    a += (nz - a) * 0.02; b += (a - b) * 0.02;                     // a low, soft hush
    c += (nz - c) * 0.12;
    // gusts: slow swells whose periods divide the loop, so the level matches at the seam too
    const gust = 0.55 + 0.25 * Math.sin((TAU * t * 2) / seconds + 1) + 0.2 * Math.sin((TAU * t * 5) / seconds + 2.3);
    raw[i] = (b * 5 + (c - a) * 0.12) * gust;
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = raw[i];
  for (let i = 0; i < over; i++) {                                   // fold the overrun back over the start
    const k = i / over;
    out[i] = raw[i] * k + raw[n + i] * (1 - k);
  }
  const A = Math.exp((-TAU * 70) / sr);
  let x1 = 0, y1 = 0;
  for (let p = 0; p < 2; p++) for (let i = 0; i < n; i++) { const x = out[i]; y1 = A * (y1 + x - x1); x1 = x; if (p === 1) out[i] = y1; }
  return normalise(out, 0.3);
}

/** A bubble pop: a sine that rises fast as it fades. v = 0, 1, 2 climb. */
export function pop(sr = 48000, v = 0) {
  const n = Math.floor(sr * 0.16);
  const out = new Float32Array(n);
  const f0 = 520 * semis(2 * (v % 3));
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    ph += (f0 * 2.3 + (f0 - f0 * 2.3) * Math.exp(-t / 0.02)) / sr;
    out[i] = Math.sin(TAU * ph) * Math.exp(-t / 0.045) * (1 - Math.exp(-t * 1500));
  }
  return finish(out, sr, { peak: 0.4, wet: 0.08, t60: 0.2, hp: 250 });
}

/** A tiny dry tick (tabs, counters). */
export function tick(sr = 48000, v = 0) {
  const r = prng(271 + v);
  const n = Math.floor(sr * 0.035);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    out[i] = (Math.sin(TAU * (2300 + 200 * (v % 3)) * t) * 0.5 + r() * 0.4) * Math.exp(-t * 260) * (1 - Math.exp(-t * 8000));
  }
  return finish(out, sr, { peak: 0.22, wet: 0, hp: 600, fade: 0.004 });
}
