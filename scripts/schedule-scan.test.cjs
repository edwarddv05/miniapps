const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLoader } = require('./load-ts.cjs');

const { parseScanTime, parseScanDay, parseScannedClasses, scanIssueText, extractJsonArray } = createLoader()('schedule-scan');
const ids = (index) => `id-${index}`;
const one = (item) => parseScannedClasses([item], ids)[0];
const base = { title: 'Investigación de Operaciones II', code: 'SI601', section: 'V', kind: 'T', day: 0, start: '16:00', end: '18:00', location: 'S4-216' };

test('times in the usual shapes read as 24-hour HH:MM', () => {
  assert.equal(parseScanTime('8:00'), '08:00');
  assert.equal(parseScanTime('08:00:00'), '08:00');
  assert.equal(parseScanTime('4:30 pm'), '16:30');
  assert.equal(parseScanTime('12:00 a. m.'), '00:00');
  assert.equal(parseScanTime('12:15 PM'), '12:15');
  assert.equal(parseScanTime('16.30'), '16:30');
});

test('times that cannot be read are not guessed', () => {
  for (const value of ['', '8', '25:00', '10:75', '13:00 pm', 'mañana', null, 800]) assert.equal(parseScanTime(value), null, String(value));
});

test('days read as numbers or Spanish names, anything else is unknown', () => {
  assert.equal(parseScanDay(0), 0);
  assert.equal(parseScanDay('4'), 4);
  assert.equal(parseScanDay('Miércoles'), 2);
  assert.equal(parseScanDay('SÁB'), 5);
  assert.equal(parseScanDay('dom.'), 6);
  for (const value of [7, -1, 1.5, 'Lunez', 'weekday', null]) assert.equal(parseScanDay(value), null, String(value));
});

test('a clean class has no issues and keeps its course details', () => {
  const item = one(base);
  assert.deepEqual(item.issues, []);
  assert.equal(item.entry.code, 'SI601');
  assert.equal(item.entry.section, 'V');
  assert.equal(item.entry.kind, 'T');
  assert.equal(item.entry.start, '16:00');
});

test('an unreadable time is flagged instead of becoming 08:00', () => {
  const item = one({ ...base, start: '4 de la tarde' });
  assert.deepEqual(item.issues, ['start']);
  assert.match(scanIssueText(item), /Inicio no reconocido: «4 de la tarde»/);
});

test('an unreadable day is flagged instead of becoming Monday', () => {
  const item = one({ ...base, day: 9 });
  assert.deepEqual(item.issues, ['day']);
  assert.equal(scanIssueText(item), 'Día no reconocido: «9»');
  assert.equal(one({ ...base, day: undefined }).issues[0], 'day');
  assert.equal(scanIssueText(one({ ...base, day: undefined })), 'Falta el día');
});

test('a class that ends before it starts is flagged, with a usable placeholder end', () => {
  const item = one({ ...base, start: '18:00', end: '16:00' });
  assert.deepEqual(item.issues, ['order']);
  assert.ok(item.entry.end > item.entry.start);
});

test('code and section printed together are split', () => {
  const item = one({ ...base, code: 'ge703u', section: '' });
  assert.equal(item.entry.code, 'GE703');
  assert.equal(item.entry.section, 'U');
});

test('sessions of one course share a colour and other courses differ', () => {
  const [a, b, c] = parseScannedClasses([base, { ...base, day: 2 }, { ...base, title: 'Física I' }], ids);
  assert.equal(a.entry.color, b.entry.color);
  assert.notEqual(a.entry.color, c.entry.color);
});

test('items without a title or that are not objects are skipped', () => {
  assert.equal(parseScannedClasses([null, 'x', { ...base, title: '  ' }, base], ids).length, 1);
});

test('the JSON list is found inside fences or surrounding text', () => {
  assert.deepEqual(extractJsonArray('```json\n[{"a":1}]\n```'), [{ a: 1 }]);
  assert.deepEqual(extractJsonArray('Aquí está: [1, 2] listo'), [1, 2]);
});

test('a reply that is not a JSON list is rejected', () => {
  assert.throws(() => extractJsonArray('{"title":"x"}'), /formato de lista/);
  assert.throws(() => extractJsonArray('No pude leer la imagen'));
  assert.throws(() => extractJsonArray('[{"title": "x",]'));
});
