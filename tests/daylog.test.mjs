import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeList } from './fake-dom.mjs';
import { renderDayLog, renderHeadline, handle, dayHref, latestDay } from '../src/daylog.js';

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
  assert.equal(text(rows[1], '.daylog-by'), 'idea by @leafy');
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
  assert.equal(name.textContent, '@' + raw);
  assert.equal(text(list, '.daylog-title'), '<b>t</b>');
  assert.equal(list.querySelector('.daylog-title').children.length, 0);
  assert.equal(list.querySelector('.daylog-idea').children.length, 0);
});

test('long, emoji and Hebrew names stay intact and get dir="auto"', () => {
  const names = ['@' + 'a'.repeat(60), '@builder🔥🎮', '@גליקי_הבונה'];
  const list = makeList();
  renderDayLog(list, names.map((by, i) => ({ day: i + 2, date: '2026-11-2' + i, title: 't', idea: 'i', by })));
  const got = list.querySelectorAll('.daylog-name');
  assert.deepEqual(got.map((n) => n.textContent), names);   // already start with exactly one @
  for (const n of got) assert.equal(n.getAttribute('dir'), 'auto');
});

test('"idea by @name": a leading @ is optional and never doubled; empty names count as nobody', () => {
  assert.equal(handle('leafy'), '@leafy');
  assert.equal(handle('@leafy'), '@leafy');
  assert.equal(handle('  @@leafy '), '@leafy');
  assert.equal(handle('@'), '');
  assert.equal(handle(null), '');
  const list = makeList();
  renderDayLog(list, [{ day: 1, date: '2026-11-19', title: 't', idea: 'i', by: 'leafy' }, { day: 2, date: '2026-11-20', title: 't', idea: 'i', by: '@' }]);
  const rows = entries(list);
  assert.equal(text(rows[0], '.daylog-by'), 'idea by @leafy');
  assert.equal(text(rows[1], '.daylog-by'), 'idea by: nobody yet');
});

test('each entry links to its playable snapshot days/NN/ (relative, zero-padded)', () => {
  assert.equal(dayHref(1), 'days/01/');
  assert.equal(dayHref(12, '../../'), '../../days/12/');
  assert.equal(dayHref(105), 'days/105/');
  const list = makeList();
  renderDayLog(list, [{ day: 3, date: '2026-11-21', title: 'x', idea: 'y', by: '"><script>' }], { root: '../../' });
  const a = list.querySelector('.daylog-play');
  assert.equal(a.tagName, 'A');
  assert.equal(a.getAttribute('href'), '../../days/03/');
  assert.equal(a.textContent, 'Play this day');
  assert.equal(a.getAttribute('aria-label'), 'Play Day 3');
});

test('the title card follows the newest day', () => {
  const doc = makeList().ownerDocument;
  const els = { day: doc.createElement('span'), line: doc.createElement('span'), bubble: doc.createElement('p') };
  assert.equal(renderHeadline(els, []), false);
  renderHeadline(els, [
    { day: 1, date: '2026-11-19', title: 'An empty world', headline: 'This world is empty.', idea: 'x', by: null },
  ]);
  assert.equal(els.day.textContent, 'Day 1.');
  assert.equal(els.line.textContent, 'This world is empty.');
  assert.equal(els.bubble.textContent, 'What should Day 2 add? Comment it.');
  renderHeadline(els, [
    { day: 2, date: '2026-11-20', title: 'A tree <b>', idea: 'x', by: '@leafy' },
    { day: 1, date: '2026-11-19', title: 'An empty world', headline: 'This world is empty.', idea: 'x', by: null },
  ]);
  assert.equal(els.day.textContent, 'Day 2.');
  assert.equal(els.line.textContent, 'A tree <b>');
  assert.equal(els.line.children.length, 0);
  assert.equal(els.bubble.textContent, 'What should Day 3 add? Comment it.');
  assert.equal(latestDay([{ day: 1 }, { day: 7 }, { day: 3 }]).day, 7);
});

test('the shipped days.json: days 1..N without gaps or duplicates, every field present', () => {
  const days = JSON.parse(readFileSync(new URL('../days.json', import.meta.url), 'utf8'));
  assert.ok(Array.isArray(days) && days.length >= 1, 'days.json is a non-empty array');
  const nums = days.map((d) => d.day);
  assert.deepEqual([...nums].sort((a, b) => a - b), days.map((_, i) => i + 1), 'days run 1..N, no gaps, no duplicates');
  for (const d of days) {
    assert.ok(Number.isInteger(d.day), `day is a whole number: ${JSON.stringify(d.day)}`);
    assert.match(d.date, /^\d{4}-\d{2}-\d{2}$/, `day ${d.day}: date is YYYY-MM-DD`);
    for (const k of ['title', 'idea']) assert.ok(typeof d[k] === 'string' && d[k].trim(), `day ${d.day}: ${k} is a non-empty string`);
    assert.ok('by' in d && (d.by === null || (typeof d.by === 'string' && d.by.trim())), `day ${d.day}: by is a name or null`);
    if ('headline' in d) assert.ok(typeof d.headline === 'string' && d.headline.trim(), `day ${d.day}: headline is text`);
    if ('checks' in d) assert.ok(d.checks && typeof d.checks === 'object', `day ${d.day}: checks is an object`);
  }
  const d1 = days.find((d) => d.day === 1);
  assert.deepEqual(
    { day: d1.day, date: d1.date, title: d1.title, headline: d1.headline, idea: d1.idea, by: d1.by },
    { day: 1, date: '2026-11-19', title: 'An empty world', headline: 'This world is empty.', idea: 'Nothing yet. You decide.', by: null },
  );
});

test('the Day log stylesheet wraps long names', () => {
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(css, /\.daylog-name[^{]*\{[^}]*overflow-wrap:\s*anywhere/);
});
