// Day 5: an atom bomb lands on you: the world blows up, your ghost floats off, and everything is back (pure logic).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { BLAST, blastPose, flyPose, ghostPose } from '../src/blast.js';
import { ATOM_BOX } from '../src/tokens.js';

const GAME = join(dirname(fileURLToPath(import.meta.url)), '..');

test('the explosion: a flash, a shake, white, and then the world is back', () => {
  assert.equal(blastPose(-1).on, false);
  assert.equal(blastPose(NaN).on, false);
  const hit = blastPose(0.05);
  assert.ok(hit.on && hit.dead);
  assert.ok(hit.cover > 0.7, 'a flash on the frame it lands');
  assert.ok(hit.shake > 1, 'and the camera shakes hard');
  assert.ok(blastPose(0.9).cover < 0.05, 'the flash clears so the explosion can be seen');
  assert.ok(blastPose(0.4).word > 0.9 && blastPose(0.4).wordFade === 1, 'BOOM is up');
  assert.equal(blastPose(1.0).wordFade, 0, 'and gone again, so your ghost can be seen');
  assert.ok(Math.abs(blastPose(BLAST.reloadAt - 0.01).cover - 1) < 1e-6, 'fully white when the world is put back');
  const back = blastPose(BLAST.reloadAt + 0.01);
  assert.ok(back.on && !back.dead && back.cover > 0.95 && back.shake === 0 && back.plate === 0);
  assert.ok(blastPose(BLAST.end - 0.05).cover < 0.05);
  assert.equal(blastPose(BLAST.end).on, false);
  let last = 0;
  for (let a = 0; a < BLAST.reloadAt; a += 1 / 60) {
    const p = blastPose(a);
    assert.ok(p.cover >= 0 && p.cover <= 1 && p.plate >= last - 1e-9 && p.plate <= 1 && p.dust >= 0 && p.dust <= 1 && p.word < 1.6);
    last = p.plate;
  }
  assert.ok(last > 0.95, 'the plate has tipped away by then');
  assert.ok(BLAST.end + 1 < ATOM_BOX.every, 'it is all over well before the next bomb');
});

test('everything is thrown outward and up once the ring of dust reaches it, and is put back with the world', () => {
  assert.equal(flyPose(0.1, 35).on, false, 'something 35 m off has not felt it yet');
  assert.equal(flyPose(0.1, 2).on, true);
  for (const k of [0, 1, 2, 3, 4]) {
    let up = -1, out = -1;
    for (let a = 0.6; a < BLAST.reloadAt; a += 0.1) {
      const f = flyPose(a, 10, k);
      assert.ok(f.on && f.up > up && f.out > out, 'it keeps going up and out until the white');
      up = f.up; out = f.out;
    }
    assert.ok(up > 12 && out > 12, `thing ${k} is well away (${up.toFixed(0)} m up, ${out.toFixed(0)} m out)`);
  }
  assert.notEqual(flyPose(1, 10, 0).out, flyPose(1, 10, 1).out, 'each thing goes its own way');
  const back = flyPose(BLAST.reloadAt, 10, 2);
  assert.deepEqual([back.on, back.out, back.up, back.spin], [false, 0, 0, 0]);
});

test('your ghost pops up, floats off upward, and is gone when you are back', () => {
  assert.equal(ghostPose(0).on, false, 'not on the very frame of the flash');
  assert.equal(ghostPose(BLAST.reloadAt).on, false);
  let y = 0;
  for (let a = 0.4; a < BLAST.reloadAt; a += 0.2) { const g = ghostPose(a); assert.ok(g.on && g.y > y - 0.6 && Math.abs(g.flap) < 0.5 && g.scale > 0.9 && g.scale < 1.3); y = g.y; }
  assert.ok(y > 3.5 && y < 6, `it has floated up, and is still in the picture (${y.toFixed(1)} m)`);
  assert.ok(ghostPose(0.2).scale > 0 && ghostPose(0.2).scale < 1.2);
});

test('the files it needs are there and the page knows the module', () => {
  const html = readFileSync(join(GAME, 'index.html'), 'utf8');
  assert.ok(/"\.\/src\/blast\.js": "\.\/src\/blast\.js\?v=/.test(html), 'blast.js is in the import map');
  assert.ok(/id="boom"/.test(html) && /id="boom-word"/.test(html));
  assert.ok(existsSync(join(GAME, 'sounds', 'boom.mp3')), 'sounds/boom.mp3');
  const file = join(GAME, 'models', 'player_ghost.glb');
  assert.ok(existsSync(file), 'models/player_ghost.glb');
  const buf = readFileSync(file);
  const json = JSON.parse(buf.toString('utf8', 20, 20 + buf.readUInt32LE(12)));
  const names = json.nodes.map((n) => n.name);
  for (const n of ['PlayerGhost', 'Halo', 'Wing_L', 'Wing_R']) assert.ok(names.includes(n), `node ${n}`);
  const kids = (json.nodes.find((n) => n.name === 'PlayerGhost').children || []).map((i) => json.nodes[i].name);
  for (const n of ['Halo', 'Wing_L', 'Wing_R']) assert.ok(kids.includes(n), `${n} is a child of PlayerGhost`);
  assert.ok(!json.animations && !json.skins);
  for (const m of json.materials || []) assert.ok((m.emissiveFactor || [0, 0, 0]).every((x) => x === 0), `${m.name} must not glow`);
  assert.ok(buf.length < 1e6, `player_ghost.glb is ${(buf.length / 1e6).toFixed(2)} MB`);
});
