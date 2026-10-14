const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../schedule-data.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const moduleExports = {};
new Function('exports', compiled)(moduleExports);
const { formatScheduleTime, parseSchedule, todayAgenda } = moduleExports;
const entry = { id: 'test', title: 'Clase de prueba', day: 0, start: '08:00', end: '09:00', location: '', color: 'teal' };

test('missing and empty storage are valid empty schedules', () => {
  assert.deepEqual(parseSchedule(null), []);
  assert.deepEqual(parseSchedule('[]'), []);
});

test('schedule times use a readable AM and PM format', () => {
  assert.equal(formatScheduleTime('00:05'), '12:05 AM');
  assert.equal(formatScheduleTime('11:00'), '11:00 AM');
  assert.equal(formatScheduleTime('12:00'), '12:00 PM');
  assert.equal(formatScheduleTime('14:30'), '2:30 PM');
});

test('existing valid records are preserved', () => {
  assert.deepEqual(parseSchedule(JSON.stringify([entry])), [entry]);
});

test('legacy three-colour records load with the hue they were shown with', () => {
  const legacy = ['slate', 'coral', 'sage'].map((color, index) => ({ ...entry, id: `legacy-${index}`, color }));
  assert.deepEqual(parseSchedule(JSON.stringify(legacy)).map((item) => item.color), ['indigo', 'blue', 'green']);
});

test('code and section printed together split at the letters after the digits', () => {
  const { splitCourseCode, courseLabel, shortCourseName } = moduleExports;
  assert.deepEqual(splitCourseCode('GE703U'), { code: 'GE703', section: 'U' });
  assert.deepEqual(splitCourseCode(' si601v '), { code: 'SI601', section: 'V' });
  assert.equal(splitCourseCode('GE703'), null);
  assert.equal(splitCourseCode('Cálculo'), null);
  assert.equal(courseLabel({ code: 'GE703', section: 'U' }), 'GE703 U');
  assert.equal(courseLabel({}), '');
  assert.equal(shortCourseName({ title: 'Investigación de Operaciones II', code: undefined }), 'IO II');
  assert.equal(shortCourseName({ title: 'Ciberseguridad', code: 'SI705' }), 'SI705');
});

test('records with code and section load, and a non-string code is rejected', () => {
  assert.equal(parseSchedule(JSON.stringify([{ ...entry, code: 'GE703', section: 'U' }]))[0].code, 'GE703');
  assert.throws(() => parseSchedule(JSON.stringify([{ ...entry, code: 703 }])));
});

test('theory and practice of one course may share hours; different courses clash', () => {
  const { classesClash, normalizeClassKind } = moduleExports;
  const theory = { ...entry, id: 't', code: 'SI130', kind: 'T', start: '16:00', end: '18:00' };
  const practice = { ...entry, id: 'p', code: 'SI130', kind: 'PRA', start: '17:00', end: '19:00' };
  const other = { ...entry, id: 'o', code: 'SI155', kind: 'T', start: '16:00', end: '18:00' };
  assert.equal(classesClash(theory, practice), false);
  assert.equal(classesClash(theory, other), true);
  assert.equal(classesClash(theory, { ...theory, id: 't2' }), true);
  assert.equal(normalizeClassKind('PRA'), 'PRA');
  assert.equal(normalizeClassKind(' teoría '), 'T');
  assert.equal(normalizeClassKind('x'), undefined);
  assert.throws(() => parseSchedule(JSON.stringify([{ ...entry, kind: 'X' }])));
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
