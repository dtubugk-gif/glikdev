// Day 3: friendship tokens and the wardrobe (pure logic) + the files the shop needs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ITEMS, SLOTS, itemById, rewardFor, createWallet, CALL_COOLDOWN, MAX_TOKENS } from '../src/tokens.js';
import { createBrain, STEP } from '../src/kittybrain.js';
import { KITTY_DEMOS, DEMOS } from '../src/demo.js';

const GAME = join(dirname(fileURLToPath(import.meta.url)), '..');

test('every shop item is well formed and has its picture', () => {
  const ids = new Set();
  for (const it of ITEMS) {
    assert.ok(/^[a-z]+$/.test(it.id), it.id);
    assert.ok(!ids.has(it.id), `duplicate ${it.id}`);
    ids.add(it.id);
    assert.ok(SLOTS.includes(it.slot), `${it.id} slot`);
    assert.ok(Number.isInteger(it.price) && it.price > 0, `${it.id} price`);
    assert.ok(it.name && (it.node || it.wand) && (it.fit || it.slot === 'toy'));
    assert.ok(existsSync(join(GAME, 'models', 'shop', `${it.id}.webp`)), `${it.id}.webp`);
  }
  assert.ok(existsSync(join(GAME, 'models', 'shop', 'token.webp')));
  assert.ok(ITEMS.some((i) => i.price <= 5), 'something cheap to buy first');
});

test('the fit file places every kind of piece on every cat', () => {
  const fit = JSON.parse(readFileSync(join(GAME, 'models', 'outfits_fit.json'), 'utf8'));
  for (const cat of ['ginger', 'realistic', 'tabby']) {
    for (const kind of new Set(ITEMS.map((i) => i.fit).filter(Boolean))) {
      const f = fit[cat]?.[kind];
      assert.ok(f, `${cat} ${kind}`);
      assert.ok(['head', 'neck', 'chest', 'spine'].includes(f.bone));
      assert.equal(f.p.length, 3); assert.equal(f.q.length, 4); assert.equal(f.s.length, 3);
      assert.ok(Math.abs(Math.hypot(...f.q) - 1) < 1e-3, 'unit quaternion');
      assert.ok(f.s.every((v) => v > 0.4 && v < 1.6), 'a sane scale');
    }
    assert.ok(Number.isFinite(fit[cat].splay));
  }
});

test('the outfits file holds the token and every piece', () => {
  const buf = readFileSync(join(GAME, 'models', 'outfits.glb'));
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const names = new Set(gltf.nodes.map((n) => n.name));
  for (const n of ['Token', 'Wing_L', 'Wing_R', 'Temple_L', 'Temple_R', ...ITEMS.filter((i) => i.node).map((i) => i.node)]) assert.ok(names.has(n), n);
  assert.ok(buf.length < 5 * 1024 * 1024, 'under 5 MB');
});

test('rewards: purr 1, a finished bowl 3, each swat 1, a call 1 with a cooldown', () => {
  const st = {};
  assert.equal(rewardFor({ type: 'purr', t: 1 }, st), 1);
  assert.equal(rewardFor({ type: 'eaten', t: 2 }, st), 3);
  assert.equal(rewardFor({ type: 'swat', t: 3, round: 1 }, st), 1);
  assert.equal(rewardFor({ type: 'pet', t: 3 }, st), 0, 'tapping alone pays nothing: she has to purr');
  assert.equal(rewardFor({ type: 'arrive', goal: 'call', t: 10 }, st), 1);
  assert.equal(rewardFor({ type: 'arrive', goal: 'call', t: 10 + CALL_COOLDOWN - 1 }, st), 0);
  assert.equal(rewardFor({ type: 'arrive', goal: 'call', t: 10 + CALL_COOLDOWN + 0.1 }, st), 1);
  assert.equal(rewardFor({ type: 'arrive', goal: 'eat', t: 99 }, st), 0);
  assert.equal(rewardFor({ type: 'step', t: 99 }, st), 0);
});

test('petting the real kitty pays once per purr, however fast you tap', () => {
  const b = createBrain({ seed: 2, mode: 'sit' });
  const st = {};
  let got = 0;
  for (let i = 0; i < 60 * 6; i++) {
    if (i % 12 === 0 && i < 60 * 3) b.pet();              // five taps a second for three seconds
    b.step(STEP);
    for (const e of b.drain()) got += rewardFor(e, st);
  }
  assert.equal(got, 1);
});

test('a game of yarn and a bowl of food pay what they should', () => {
  const st = {};
  let got = 0;
  const b = createBrain({ seed: 2, mode: 'sit' });
  b.play();
  for (let i = 0; i < 60 * 40; i++) { b.step(STEP); for (const e of b.drain()) got += rewardFor(e, st); }
  assert.equal(got, 3, 'three swats');
  got = 0;
  const c = createBrain({ seed: 2, mode: 'sit', hunger: 0.9 });
  c.feed();
  for (let i = 0; i < 60 * 30; i++) { c.step(STEP); for (const e of c.drain()) got += rewardFor(e, st); }
  assert.equal(got, 3, 'one bowl');
});

test('wallet: earn, buy (puts it on), one thing per slot, take off', () => {
  const w = createWallet();
  assert.equal(w.tokens, 0);
  assert.equal(w.buy('bowtie'), false, 'cannot buy with nothing');
  w.earn(13);
  assert.equal(w.canBuy('bowtie'), true);
  assert.equal(w.buy('bowtie'), true);
  assert.equal(w.tokens, 8);
  assert.equal(w.earned, 13);
  assert.equal(w.isWearing('bowtie'), true);
  assert.equal(w.buy('bowtie'), false, 'already hers');
  assert.equal(w.buy('strawhat'), true);
  assert.equal(w.tokens, 0);
  assert.deepEqual(w.wearing, { hat: 'strawhat', face: null, neck: 'bowtie', back: null, toy: null });
  assert.equal(w.wear('crown'), false, 'not hers yet');
  w.earn(10);
  assert.equal(w.buy('flowercrown'), true);
  assert.equal(w.wearing.hat, 'flowercrown', 'the new hat replaces the old one');
  assert.equal(w.wear('strawhat'), true);
  assert.equal(w.wearing.hat, 'strawhat');
  assert.equal(w.takeOff('hat'), true);
  assert.equal(w.takeOff('hat'), false);
  assert.equal(w.wearing.hat, null);
  assert.equal(w.owns('strawhat'), true, 'taking it off does not lose it');
});

test('wallet: saving and loading, and a broken save never throws', () => {
  const w = createWallet();
  w.earn(50); w.buy('shades'); w.buy('scarf');
  const again = createWallet(JSON.parse(JSON.stringify(w)));
  assert.equal(again.tokens, w.tokens);
  assert.deepEqual(again.wearing, w.wearing);
  assert.equal(again.owns('shades'), true);
  for (const bad of [null, 7, 'x', [], { tokens: -5 }, { tokens: 'lots', owned: 'all', wearing: 3 },
    { tokens: 1e12, owned: ['nope', 'crown'], wearing: { hat: 'bowtie', neck: 'crown', face: 'shades' } }]) {
    const b = createWallet(bad);
    assert.ok(b.tokens >= 0 && b.tokens <= MAX_TOKENS);
    assert.ok(!b.owns('nope'));
    assert.equal(b.wearing.hat, null, 'a piece in the wrong slot is ignored');
    assert.equal(b.wearing.face, null, 'wearing something she does not own is ignored');
  }
  const cap = createWallet({ tokens: MAX_TOKENS });
  cap.earn(50);
  assert.equal(cap.tokens, MAX_TOKENS);
  assert.equal(createWallet().earn(-3), 0);
  assert.equal(createWallet().earn(NaN), 0);
});

test('the Day 3 demos exist and only dress her in real pieces', () => {
  for (const d of ['kittytoken', 'kittydress', 'shopwalk', 'kittytoy']) { assert.ok(DEMOS.includes(d)); assert.ok(KITTY_DEMOS[d]); }
  for (const s of KITTY_DEMOS.kittydress.script) {
    if (s.type !== 'wear') continue;
    if (s.id === null) assert.ok(SLOTS.includes(s.slot)); else assert.ok(itemById(s.id), s.id);
  }
});
