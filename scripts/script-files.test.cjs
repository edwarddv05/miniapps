const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLoader, memoryStorage, appMocks } = require('./load-ts.cjs');

function setup(initial) {
  const storage = memoryStorage(initial);
  const files = createLoader({ ...appMocks(storage), sucrase: {} })('script-files');
  return { storage, files };
}

test('values are stored one key each and read back', async () => {
  const { storage, files } = setup();
  await files.saveScriptValues('Notas.jsx', [['notes', [{ id: 1 }]], ['tema', 'oscuro']]);
  assert.equal(storage.data.get('@miniapps/script-kv/Notas.jsx/tema'), '"oscuro"');
  assert.deepEqual(await files.loadScriptData('Notas.jsx'), { notes: [{ id: 1 }], tema: 'oscuro' });
  await files.saveScriptValues('Notas.jsx', [['tema', undefined]]);
  assert.deepEqual(await files.loadScriptData('Notas.jsx'), { notes: [{ id: 1 }] });
});

test("a miniapp never reads another's values, even with a longer name", async () => {
  const { files } = setup();
  await files.saveScriptValues('Notas.js', [['a', 1]]);
  await files.saveScriptValues('Notas.js.bak.js', [['b', 2]]);
  assert.deepEqual(await files.loadScriptData('Notas.js'), { a: 1 });
});

test('values saved as one object by earlier versions move to their own keys', async () => {
  const { storage, files } = setup({
    '@miniapps/script-data/Notas.jsx': JSON.stringify({ notes: ['viejo'], count: 2 }),
    '@miniapps/script-kv/Notas.jsx/count': '5',
  });
  // A key already stored on its own wins over the old copy.
  assert.deepEqual(await files.loadScriptData('Notas.jsx'), { count: 5, notes: ['viejo'] });
  assert.equal(storage.data.has('@miniapps/script-data/Notas.jsx'), false);
  assert.equal(storage.data.get('@miniapps/script-kv/Notas.jsx/notes'), '["viejo"]');
});

test('an unreadable value is skipped instead of failing the miniapp', async () => {
  const { files } = setup({ '@miniapps/script-kv/A.js/ok': '1', '@miniapps/script-kv/A.js/roto': '{' });
  assert.deepEqual(await files.loadScriptData('A.js'), { ok: 1 });
});
