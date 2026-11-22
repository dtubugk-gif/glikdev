// The background music loops inside its file: the numbers in kittyaudio.js must fit the file that ships.
import test from 'node:test';
import assert from 'node:assert/strict';
import { statSync, readFileSync } from 'node:fs';
import { MUSIC } from '../src/kittyaudio.js';

const file = new URL('../sounds/music.mp3', import.meta.url);

test('the music loop is 24 bars at 84 bpm and starts inside the file', () => {
  assert.ok(Math.abs(MUSIC.seconds - 68.5714286) < 1e-6);
  assert.ok(MUSIC.start > 0.1 && MUSIC.start < 1.5);
  assert.ok(MUSIC.level > 0.1 && MUSIC.level <= 0.8, 'a background level, under the effects');
});

test('the music file is long enough to loop without a seam', () => {
  const data = readFileSync(file);
  assert.ok(data.subarray(0, 3).toString('latin1') === 'ID3' || data[0] === 0xff, 'an MP3');
  const seconds = statSync(file).size * 8 / 96000;          // 96 kbit/s, constant
  assert.ok(seconds >= MUSIC.start + MUSIC.seconds + 1, `file ${seconds.toFixed(1)} s`);
  assert.ok(seconds <= MUSIC.start + MUSIC.seconds + 4, `file ${seconds.toFixed(1)} s: rendered at another length?`);
  assert.ok(data.length < 1_000_000, 'under 1 MB');
});

test('the old meadow noise is gone', () => {
  const src = readFileSync(new URL('../src/kittyaudio.js', import.meta.url), 'utf8');
  assert.ok(!/meadow/.test(src));
  assert.ok(/sounds\/music\.mp3/.test(src));
});
