const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLoader, memoryStorage, appMocks } = require('./load-ts.cjs');

const LIBRARY_KEY = '@miniapps/anime-library';
const TRIPS_KEY = '@miniapps/transit-trips';
const anime = (id, extra = {}) => ({ id, title: { romaji: `Anime ${id}`, english: null, native: null }, cover: null, banner: null, color: null, format: 'TV', status: 'RELEASING', episodes: 12, seasonYear: 2026, startDate: null, nextEpisode: { episode: 6, airingAt: 2_000_000_000 }, score: null, popularity: null, trending: null, genres: [], synopsis: 'largo', studio: null, ...extra });

function library(initial) {
  const storage = memoryStorage(initial);
  const load = createLoader(appMocks(storage));
  return { storage, lib: load('anime-library') };
}

function trips(initial) {
  const storage = memoryStorage(initial);
  const load = createLoader(appMocks(storage));
  return { storage, trips: load('transit-trips') };
}

test('a saved anime is stored and the synopsis stays out', async () => {
  const { storage, lib } = library();
  assert.equal(await lib.setListStatus(anime(1), 'watching'), true);
  const stored = JSON.parse(storage.data.get(LIBRARY_KEY));
  assert.equal(stored.entries.length, 1);
  assert.equal(stored.entries[0].anime.synopsis, '');
});

test('a corrupt anime list shows as failed and is never overwritten', async () => {
  const { storage, lib } = library({ [LIBRARY_KEY]: '{not json' });
  await lib.loadLibrary();
  assert.equal(lib.useAnimeLibrary().failed, true);
  assert.equal(await lib.setListStatus(anime(1), 'watching'), false);
  assert.deepEqual(await lib.setProgress(anime(1), 3), { saved: false, done: false });
  assert.equal(storage.data.get(LIBRARY_KEY), '{not json');
});

test('an anime list that cannot be read can be retried', async () => {
  const { storage, lib } = library({ [LIBRARY_KEY]: JSON.stringify({ entries: [], lastRefresh: 0 }) });
  storage.failReads = true;
  await lib.loadLibrary();
  assert.equal(lib.useAnimeLibrary().failed, true);
  storage.failReads = false;
  await lib.loadLibrary(true);
  assert.equal(lib.useAnimeLibrary().failed, false);
  assert.equal(await lib.setListStatus(anime(1), 'planning'), true);
});

test('a failed write reports false and the list goes back to what is stored', async () => {
  const { storage, lib } = library();
  await lib.setListStatus(anime(1), 'watching');
  storage.failWrites = true;
  const result = await lib.setProgress(anime(1), 4);
  assert.equal(result.saved, false);
  assert.equal(lib.useAnimeLibrary().entries[0].progress, 0);
  storage.failWrites = false;
  assert.equal((await lib.setProgress(anime(1), 4)).saved, true);
  assert.equal(JSON.parse(storage.data.get(LIBRARY_KEY)).entries[0].progress, 4);
});

test('quick successive changes are written in order, the last one winning', async () => {
  const { storage, lib } = library();
  await lib.setListStatus(anime(1), 'watching');
  const results = await Promise.all([1, 2, 3].map((episode) => lib.setProgress(anime(1), episode)));
  assert.ok(results.every((result) => result.saved));
  assert.equal(JSON.parse(storage.data.get(LIBRARY_KEY)).entries[0].progress, 3);
  assert.equal(lib.useAnimeLibrary().entries[0].progress, 3);
});

test('two different anime saved at once both stay in the list', async () => {
  const { storage, lib } = library();
  await Promise.all([lib.setListStatus(anime(1), 'watching'), lib.setListStatus(anime(2), 'planning')]);
  const ids = JSON.parse(storage.data.get(LIBRARY_KEY)).entries.map((entry) => entry.id).sort();
  assert.deepEqual(ids, [1, 2]);
});

test('watching the last episode of a finished series moves it to Terminados', async () => {
  const { lib } = library();
  const finished = anime(1, { status: 'FINISHED', nextEpisode: null });
  assert.deepEqual(await lib.setProgress(finished, 12), { saved: true, done: true });
  assert.equal(lib.useAnimeLibrary().entries[0].status, 'completed');
});

test('starring a trip is stored; a failed write leaves favourites as stored', async () => {
  const { storage, trips: store } = trips();
  const trip = { from: 'naranjal', to: 'central' };
  assert.equal(await store.updateSavedTrips((current) => store.withFavoriteToggled(current, trip)), true);
  assert.equal(JSON.parse(storage.data.get(TRIPS_KEY)).favorites.length, 1);
  storage.failWrites = true;
  assert.equal(await store.updateSavedTrips((current) => store.withFavoriteToggled(current, trip)), false);
  assert.equal(store.useSavedTrips().trips.favorites.length, 1);
});

test('corrupt saved trips are never overwritten by a new favourite', async () => {
  const { storage, trips: store } = trips({ [TRIPS_KEY]: '[broken' });
  const saved = await store.updateSavedTrips((current) => store.withFavoriteToggled(current, { from: 'a', to: 'b' }));
  assert.equal(saved, false);
  assert.equal(store.useSavedTrips().failed, true);
  assert.equal(storage.data.get(TRIPS_KEY), '[broken');
});

test('recent trips keep the last five, newest first, without repeats', () => {
  const { trips: store } = trips();
  let current = store.EMPTY_TRIPS;
  for (const to of ['a', 'b', 'c', 'd', 'e', 'f', 'b']) current = store.withRecent(current, { from: 'x', to });
  assert.deepEqual(current.recents.map((trip) => trip.to), ['b', 'f', 'e', 'd', 'c']);
});
