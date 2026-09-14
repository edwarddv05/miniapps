const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../schedule-data.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const moduleExports = {};
new Function('exports', compiled)(moduleExports);
const { parseSchedule, todayAgenda } = moduleExports;
const entry = { id: 'test', title: 'Clase de prueba', day: 0, start: '08:00', end: '09:00', location: '', color: 'slate' };

test('missing and empty storage are valid empty schedules', () => {
  assert.deepEqual(parseSchedule(null), []);
  assert.deepEqual(parseSchedule('[]'), []);
});

test('existing valid records are preserved', () => {
  assert.deepEqual(parseSchedule(JSON.stringify([entry])), [entry]);
});

test('today agenda distinguishes upcoming, ongoing, and finished classes', () => {
  const later = { ...entry, id: 'later', start: '11:00', end: '12:00' };
  const entries = [later, entry];
  const at = (hours, minutes = 0) => new Date(2026, 8, 14, hours, minutes);
  assert.equal(todayAgenda(entries, at(7)).next.id, 'test');
  assert.equal(todayAgenda(entries, at(8)).ongoing, true);
  assert.equal(todayAgenda(entries, at(9)).next.id, 'later');
  assert.equal(todayAgenda(entries, at(9)).ongoing, false);
  assert.equal(todayAgenda(entries, at(12)).next, undefined);
  assert.equal(todayAgenda(entries, at(12)).today.length, 2);
  assert.equal(todayAgenda(entries, new Date(2026, 8, 15)).today.length, 0);
  assert.deepEqual(entries.map((item) => item.id), ['later', 'test']);
});

test('corrupted records reject the entire load instead of silently losing records', () => {
  for (const raw of ['{', '{}', '[null]', '[1]', JSON.stringify([entry, entry])]) {
    assert.throws(() => parseSchedule(raw));
  }
  for (const change of [{ day: 7 }, { day: 1.5 }, { title: ' ' }, { id: '' }, { start: '25:00' }, { end: '08:00' }, { end: '07:00' }, { color: 'unknown' }, { location: null }]) {
    assert.throws(() => parseSchedule(JSON.stringify([entry, { ...entry, id: 'another', ...change }])));
  }
});
