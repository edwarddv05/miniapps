const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLoader, memoryStorage, appMocks } = require('./load-ts.cjs');

const schedule = [{ id: 'c1', title: 'Física I', day: 1, start: '08:00', end: '10:00', location: 'R1', color: 'blue' }];
const library = { entries: [{ id: 7, status: 'watching', progress: 3, addedAt: 1, updatedAt: 1, completedAt: null, anime: { id: 7, title: { romaji: 'X' } } }], lastRefresh: 5 };
const cards = { cards: [{ id: 'k1', name: 'Visa', image: 'file:///old-phone/cards/k1.jpg' }], purchases: [{ id: 'p1', cardId: 'k1', cents: 1000, date: '2026-10-01' }], payments: [], rate: { mode: 'auto' } };
const trips = { favorites: [{ from: 'a', to: 'b' }], recents: [] };

function setup(initial) {
  const storage = memoryStorage(initial);
  const files = new Set();
  const load = createLoader({
    ...appMocks(storage),
    'expo-file-system/legacy': { getInfoAsync: async (uri) => ({ exists: files.has(uri) }) },
  });
  return { storage, files, backup: load('backup') };
}

const stored = () => ({
  '@miniapps/schedule': JSON.stringify(schedule),
  '@miniapps/anime-library': JSON.stringify(library),
  '@miniapps/cards': JSON.stringify(cards),
  '@miniapps/transit-trips': JSON.stringify(trips),
  '@miniapps/transit-fare': 'student',
});

test('a backup holds every section with its format and version', async () => {
  const { backup } = setup(stored());
  const made = await backup.buildBackup(new Date('2026-10-03T12:00:00Z'));
  assert.equal(made.format, 'my-superapp-backup');
  assert.equal(made.version, 1);
  assert.equal(made.createdAt, '2026-10-03T12:00:00.000Z');
  assert.equal(made.data.fare, 'student');
  assert.deepEqual(backup.summarize(made.data), { classes: 1, anime: 1, cards: 1, purchases: 1, trips: 1 });
});

test('an empty phone makes a valid, empty backup', async () => {
  const { backup } = setup();
  const made = await backup.buildBackup();
  assert.deepEqual(backup.summarize(made.data), { classes: 0, anime: 0, cards: 0, purchases: 0, trips: 0 });
  assert.deepEqual(backup.summarize(backup.parseBackup(JSON.stringify(made)).data), backup.summarize(made.data));
});

test('a section that cannot be read stops the export', async () => {
  const { backup } = setup({ ...stored(), '@miniapps/schedule': '{broken' });
  await assert.rejects(backup.buildBackup(), /horario/);
});

test('a backup round-trips through its file', async () => {
  const { backup } = setup(stored());
  const made = await backup.buildBackup();
  const read = backup.parseBackup(JSON.stringify(made));
  assert.deepEqual(read.data.schedule, made.data.schedule);
  assert.deepEqual(read.data.trips, made.data.trips);
});

test('files that are not backups, or from a newer app, are rejected', async () => {
  const { backup } = setup(stored());
  const made = await backup.buildBackup();
  assert.throws(() => backup.parseBackup('hola'), /no es un respaldo/);
  assert.throws(() => backup.parseBackup(JSON.stringify({ ...made, format: 'otra-app' })), /no es un respaldo/);
  assert.throws(() => backup.parseBackup(JSON.stringify({ ...made, version: 2 })), /versión más nueva/);
  const { trips: _omit, ...partial } = made.data;
  assert.throws(() => backup.parseBackup(JSON.stringify({ ...made, data: partial })), /no incluye los viajes/);
});

test('a backup with an invalid record is rejected whole, not restored with gaps', async () => {
  const { backup } = setup(stored());
  const made = await backup.buildBackup();
  const badClass = { ...made, data: { ...made.data, schedule: [{ ...schedule[0], end: '07:00' }] } };
  assert.throws(() => backup.parseBackup(JSON.stringify(badClass)), /El horario del respaldo no es válido/);
  const badPurchase = { ...made, data: { ...made.data, cards: { ...made.data.cards, purchases: [{ id: 'p2' }] } } };
  assert.throws(() => backup.parseBackup(JSON.stringify(badPurchase)), /Las tarjetas del respaldo no son válidas/);
});

test('restoring replaces every section and drops card photos not on this phone', async () => {
  const source = setup(stored());
  const made = await source.backup.buildBackup();
  const target = setup({ '@miniapps/schedule': '[]' });
  await target.backup.restoreBackup(target.backup.parseBackup(JSON.stringify(made)));
  assert.deepEqual(JSON.parse(target.storage.data.get('@miniapps/schedule')), schedule);
  assert.equal(JSON.parse(target.storage.data.get('@miniapps/anime-library')).entries[0].id, 7);
  assert.equal(JSON.parse(target.storage.data.get('@miniapps/cards')).cards[0].image, null);
  assert.equal(target.storage.data.get('@miniapps/transit-fare'), 'student');
});

test('a restore that cannot be written leaves the data as it was', async () => {
  const source = setup(stored());
  const made = await source.backup.buildBackup();
  const target = setup({ '@miniapps/schedule': '[]' });
  target.storage.failWrites = true;
  await assert.rejects(target.backup.restoreBackup(target.backup.parseBackup(JSON.stringify(made))));
  assert.equal(target.storage.data.get('@miniapps/schedule'), '[]');
});
