// The sound engine without a browser: a tiny fake AudioContext records what would play.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createKittyAudio, pickTake } from '../src/kittyaudio.js';

const SRC = readFileSync(new URL('../src/kittyaudio.js', import.meta.url), 'utf8');
const FILES = [...SRC.matchAll(/'(sounds\/[\w-]+\.mp3)'/g)].map((m) => m[1]);
const fileOf = (buf) => buf?.path;

class Param {
  constructor(v = 1) { this.value = v; this.events = []; }
  setValueAtTime(v, t) { this.events.push(['set', v, t]); if (t <= 0.0001) this.value = v; return this; }
  linearRampToValueAtTime(v, t) { this.events.push(['ramp', v, t]); return this; }
  setTargetAtTime(v, t, k) { this.events.push(['target', v, t, k]); return this; }
  cancelScheduledValues(t) { this.events.push(['cancel', t]); return this; }
  cancelAndHoldAtTime(t) { this.events.push(['hold', t]); return this; }
}
class Node {
  constructor(ctx, kind) { this.ctx = ctx; this.kind = kind; this.outs = []; }
  connect(n) { this.outs.push(n); return n; }
  disconnect() {}
}
function fakeContext() {
  const made = { sources: [], gains: [], filters: [] };
  class Ctx {
    constructor() { this.state = 'running'; this.currentTime = 0; this.sampleRate = 48000; this.destination = new Node(this, 'out'); Ctx.last = this; this.made = made; }
    createGain() { const n = new Node(this, 'gain'); n.gain = new Param(1); made.gains.push(n); return n; }
    createBufferSource() {
      const n = new Node(this, 'source');
      n.playbackRate = new Param(1); n.loop = false; n.stops = [];
      n.start = (t = 0) => { n.startedAt = t; made.sources.push(n); };
      n.stop = (t) => { n.stops.push(t); };
      return n;
    }
    createStereoPanner() { const n = new Node(this, 'pan'); n.pan = new Param(0); return n; }
    createBiquadFilter() { const n = new Node(this, 'filter'); n.frequency = new Param(350); n.Q = new Param(1); made.filters.push(n); return n; }
    createDynamicsCompressor() {
      const n = new Node(this, 'comp');
      for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = new Param(0);
      return n;
    }
    createConvolver() { return new Node(this, 'conv'); }
    createBuffer(ch, len, sr) {
      const data = Array.from({ length: ch }, () => new Float32Array(len));
      return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: (c) => data[c], copyToChannel: (f, c) => data[c].set(f) };
    }
    decodeAudioData(ab) { return Promise.resolve({ path: ab.path, duration: ab.path.includes('purr') ? 4.6 : 0.4 }); }
    resume() { this.state = 'running'; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
  }
  return { Ctx, made };
}
function setup({ fail = () => false } = {}) {
  const { Ctx, made } = fakeContext();
  let seed = 12345;
  const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const fetch = async (u) => (fail(u) ? { ok: false, status: 404 } : { ok: true, arrayBuffer: async () => ({ path: u }) });
  const audio = createKittyAudio({ AudioContext: Ctx, fetch, random });
  return { audio, made, ctx: () => Ctx.last };
}
const settle = async () => { for (let i = 0; i < 400; i++) await new Promise((r) => setImmediate(r)); };
const quiet = (fn) => async (...a) => { const w = console.warn; console.warn = () => {}; try { return await fn(...a); } finally { console.warn = w; } };

test('every sound file the engine names is a literal path that exists', () => {
  assert.ok(FILES.length >= 90, `${FILES.length} files`);
  for (const f of FILES) assert.ok(existsSync(new URL(`../${f}`, import.meta.url)), `${f} is missing`);
  const bytes = FILES.filter((f) => f !== 'sounds/music.mp3').reduce((s, f) => s + readFileSync(new URL(`../${f}`, import.meta.url)).length, 0);
  assert.ok(bytes < 1.6e6, `effects ${bytes} bytes`);
});

test('a take is never the same twice in a row', () => {
  let r = 0; const rand = () => (r = (r + 0.37) % 1);
  let last = -1;
  for (let i = 0; i < 200; i++) { const k = pickTake(4, last, rand); assert.ok(k >= 0 && k < 4); assert.notEqual(k, last); last = k; }
  assert.equal(pickTake(1, 0, rand), 0);
});

test('silent until the first tap, and every family decodes', async () => {
  const { audio, made } = setup();
  audio.event({ type: 'meow' });
  assert.equal(made.sources.length, 0);
  assert.equal(audio.running, false);
  audio.unlock();
  await settle();
  assert.equal(audio.running, true);
  const families = [...SRC.matchAll(/^\s+(\w+): \['sounds\//gm)].map((m) => m[1]);
  const extra = [...SRC.matchAll(/ (\w+): \['sounds\//g)].map((m) => m[1]);
  for (const f of new Set([...families, ...extra])) assert.ok(audio.recorded.includes(f), `${f} not loaded`);
});

test('footsteps: different takes, never the same twice running, with a little pitch spread', async () => {
  const { audio, made, ctx } = setup();
  audio.unlock(); await settle();
  for (let i = 0; i < 40; i++) { ctx().currentTime = i * 0.4; audio.event({ type: 'footstep', strong: i % 2 === 0 }); }
  const steps = made.sources.filter((s) => fileOf(s.buffer)?.includes('footstep'));
  assert.equal(steps.length, 40);
  const files = steps.map((s) => fileOf(s.buffer));
  for (let i = 1; i < files.length; i++) assert.notEqual(files[i], files[i - 1], `take repeated at ${i}`);
  assert.ok(new Set(files).size >= 4, 'uses most takes');
  const rates = new Set(steps.map((s) => s.playbackRate.value.toFixed(4)));
  assert.ok(rates.size > 10, 'pitch varies');
});

test('unknown or empty events are harmless', async () => {
  const { audio, made } = setup();
  audio.unlock(); await settle();
  const before = made.sources.length;
  for (const e of [{ type: 'no-such-thing' }, { type: '' }, {}, null, undefined, { type: 'cast' }, { type: 'mind', does: 'nap' }]) audio.event(e);
  assert.equal(made.sources.length, before);
});

test('every event type the game sends makes a sound', async () => {
  const { audio, made, ctx } = setup();
  audio.unlock(); await settle();
  const types = ['meow', 'trill', 'chirp', 'mew', 'yawn', 'sigh', 'bite', 'step', 'thud', 'toss', 'swat', 'leap', 'land', 'jingle', 'wake',
    'bowl', 'refill', 'purr', 'pet', 'grumble', 'refuse', 'nuzzle', 'boop', 'playbow', 'tumble', 'hop', 'friend-hello', 'heart', 'sparkle',
    'dust', 'ui-open', 'ui-close', 'ui-tab', 'ui-ok', 'ui-bad', 'bomb-fall', 'bomb-land', 'box-open', 'atom', 'token', 'buy', 'wear',
    'shop-open', 'shop-close', 'footstep', 'squeak', 'nope', 'boom', 'lose', 'click'];
  for (const [i, type] of types.entries()) {
    ctx().currentTime = 10 + i;
    const n = made.sources.length;
    audio.event({ type, n: 3, k: 2, speed: 30 });
    assert.ok(made.sources.length > n, `${type} played nothing`);
  }
});

test("the friend kitten: the same real voice, higher; two purrs at once; each stops alone", async () => {
  const { audio, made, ctx } = setup({ fail: () => false });
  audio.unlock(); await settle();
  ctx().currentTime = 1;
  audio.event({ type: 'meow' });
  audio.event({ type: 'meow', who: 'friend' });
  const [a, b] = made.sources.slice(-2);
  assert.ok(fileOf(a.buffer).includes('meow') && fileOf(b.buffer).includes('meow'));
  const ratio = b.playbackRate.value / a.playbackRate.value;
  assert.ok(ratio > 1.12 && ratio < 1.35, `friend ${ratio.toFixed(3)}x higher`);
  audio.event({ type: 'purr' });
  audio.event({ type: 'purr', who: 'friend' });
  const purrs = made.sources.filter((s) => fileOf(s.buffer)?.includes('purr'));
  assert.equal(purrs.length, 2);
  assert.ok(purrs.every((p) => p.loop), 'purrs loop');
  ctx().currentTime = 2;
  audio.event({ type: 'purr-end', who: 'friend' });
  assert.ok(purrs[1].stops.some((t) => t < 3), 'the friend stops');
  assert.ok(!purrs[0].stops.some((t) => t < 3), 'she purrs on');
  audio.event({ type: 'purr' });                            // she purrs again: no second loop of hers
  assert.equal(made.sources.filter((s) => fileOf(s.buffer)?.includes('purr')).length, 2);
});

test('a cat voice that cannot load stays silent (no synthesised cat)', quiet(async () => {
  const { audio, made } = setup({ fail: (u) => /meow|trill|chirp|purr|sigh|hello/.test(u) });
  audio.unlock(); await settle();
  const n = made.sources.length;
  for (const type of ['meow', 'trill', 'chirp', 'mew', 'yawn', 'sigh', 'purr', 'grumble', 'friend-hello']) audio.event({ type });
  audio.event({ type: 'meow', who: 'friend' });
  assert.equal(made.sources.length, n);
  audio.event({ type: 'click' });                           // other sounds still have a stand-in or their file
  assert.equal(made.sources.length, n + 1);
}));

test('an effect that cannot load falls back to a stand-in', quiet(async () => {
  const { audio, made } = setup({ fail: (u) => u.includes('footstep') });
  audio.unlock(); await settle();
  assert.ok(!audio.recorded.includes('footstep'));
  audio.event({ type: 'footstep' });
  const s = made.sources.at(-1);
  assert.ok(s && !s.buffer.path, 'a synthesised buffer');
}));

test('no pile-ups: at most a few of one sound at once, the oldest faded out', async () => {
  const { audio, made, ctx } = setup();
  audio.unlock(); await settle();
  ctx().currentTime = 5;
  for (let i = 0; i < 8; i++) audio.event({ type: 'thud' });
  const thuds = made.sources.filter((s) => fileOf(s.buffer)?.includes('thud'));
  assert.equal(thuds.length, 8);
  const stopped = thuds.filter((s) => s.stops.length);
  assert.equal(stopped.length, 5, 'cap of 3');
  for (const s of stopped) assert.ok(s.stops[0] > 5, 'a short fade, not a cut');
});

test('far away is quieter and duller', async () => {
  const { audio, made, ctx } = setup();
  audio.unlock(); await settle();
  ctx().currentTime = 3;
  const f0 = made.filters.length;
  audio.event({ type: 'swat' }, 1, 0);
  assert.equal(made.filters.length, f0, 'close: no low-pass');
  audio.event({ type: 'swat' }, 0.1, 0.5);
  assert.equal(made.filters.length, f0 + 1);
  assert.ok(made.filters.at(-1).frequency.value < 5000);
});

test('the music dips under the big moments and comes back', async () => {
  const { audio, made, ctx } = setup();
  audio.unlock(); await settle();
  ctx().currentTime = 7;
  const g0 = made.gains.map((g) => g.gain.events.length);
  audio.event({ type: 'boom' });
  const ducked = made.gains.find((g, i) => g.gain.events.slice(g0[i] || 0).some((e) => e[0] === 'target' && e[1] < 0.8 && e[1] > 0.5));
  assert.ok(ducked, 'a 2-4 dB dip');
  const back = ducked.gain.events.filter((e) => e[0] === 'target' && e[1] === 1).at(-1);
  assert.ok(back && back[2] > 7.5 && back[3] > 0.08 && back[3] < 0.2, 'comes back over about 400 ms');
});
