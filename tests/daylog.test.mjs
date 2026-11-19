import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeList } from './fake-dom.mjs';
import { renderDayLog } from '../src/daylog.js';

const entries = (list) => list.querySelectorAll('.daylog-entry');
const text = (el, cls) => el.querySelector(cls).textContent;

test('0 entries shows "No days yet"', () => {
  const list = makeList();
  renderDayLog(list, []);
  assert.equal(entries(list).length, 0);
  assert.equal(list.children.length, 1);
  assert.equal(list.children[0].textContent, 'No days yet');
});

test('a missing or broken days value is treated as empty', () => {
  for (const bad of [null, undefined, {}, 'x']) {
    const list = makeList();
    renderDayLog(list, bad);
    assert.equal(list.textContent, 'No days yet');
  }
});

test('3 entries render in day order with all fields', () => {
  const list = makeList();
  renderDayLog(list, [
    { day: 3, date: '2026-11-21', title: 'Rain', idea: 'Make it rain', by: '@cloud' },
    { day: 1, date: '2026-11-19', title: 'An empty world', idea: 'Nothing yet. You decide.', by: null },
    { day: 2, date: '2026-11-20', title: 'A tree', idea: 'Plant one tree', by: '@leafy' },
  ]);
  const rows = entries(list);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => text(r, '.daylog-day')), ['Day 1', 'Day 2', 'Day 3']);
  assert.deepEqual(rows.map((r) => text(r, '.daylog-title')), ['An empty world', 'A tree', 'Rain']);
  assert.equal(text(rows[1], '.daylog-idea'), 'Plant one tree');
  assert.equal(rows[1].querySelector('.daylog-date').getAttribute('datetime'), '2026-11-20');
  assert.equal(text(rows[1], '.daylog-by'), 'idea by: @leafy');
  // Re-rendering replaces, never appends.
  renderDayLog(list, [{ day: 1, date: '2026-11-19', title: 'An empty world', idea: 'x', by: null }]);
  assert.equal(entries(list).length, 1);
});

test('by: null is shown as "idea by: nobody yet"', () => {
  const list = makeList();
  renderDayLog(list, [{ day: 1, date: '2026-11-19', title: 'An empty world', idea: 'Nothing yet. You decide.', by: null }]);
  const row = entries(list)[0];
  assert.equal(text(row, '.daylog-by'), 'idea by: nobody yet');
  assert.equal(row.querySelector('.daylog-name'), null);
});

test('a hostile name renders as plain text with no child elements', () => {
  const raw = '<img src=x onerror=alert(1)>';
  const list = makeList();
  renderDayLog(list, [{ day: 2, date: '2026-11-20', title: '<b>t</b>', idea: '<script>x</script>', by: raw }]);
  const name = list.querySelector('.daylog-name');
  assert.ok(name, 'name element exists');
  assert.equal(name.children.length, 0);
  assert.equal(name.textContent, raw);
  assert.equal(text(list, '.daylog-title'), '<b>t</b>');
  assert.equal(list.querySelector('.daylog-title').children.length, 0);
  assert.equal(list.querySelector('.daylog-idea').children.length, 0);
});

test('long, emoji and Hebrew names stay intact and get dir="auto"', () => {
  const names = ['@' + 'a'.repeat(60), '@builder🔥🎮', '@גליקי_הבונה'];
  const list = makeList();
  renderDayLog(list, names.map((by, i) => ({ day: i + 2, date: '2026-11-2' + i, title: 't', idea: 'i', by })));
  const got = list.querySelectorAll('.daylog-name');
  assert.deepEqual(got.map((n) => n.textContent), names);
  for (const n of got) assert.equal(n.getAttribute('dir'), 'auto');
});

test('the shipped days.json matches the Day 1 contract', () => {
  const days = JSON.parse(readFileSync(new URL('../days.json', import.meta.url), 'utf8'));
  assert.deepEqual(days, [
    { day: 1, date: '2026-11-19', title: 'An empty world', idea: 'Nothing yet. You decide.', by: null },
  ]);
});

test('the Day log stylesheet wraps long names', () => {
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(css, /\.daylog-name[^{]*\{[^}]*overflow-wrap:\s*anywhere/);
});
