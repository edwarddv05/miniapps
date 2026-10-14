const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createLoader, memoryStorage, appMocks } = require('./load-ts.cjs');

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});

function setup(initial) {
  const storage = memoryStorage(initial);
  return { storage, api: createLoader(appMocks(storage))('downloader-api') };
}

test('server addresses are completed and cleaned', () => {
  const { api } = setup();
  assert.equal(api.normalizeServerUrl('192.168.1.5:8787'), 'http://192.168.1.5:8787');
  assert.equal(api.normalizeServerUrl(' http://pc.local:8787/ '), 'http://pc.local:8787');
  assert.equal(api.normalizeServerUrl('https://descargas.example'), 'https://descargas.example');
  for (const value of ['', '   ', 'ftp://pc:21', 'http://']) assert.equal(api.normalizeServerUrl(value), null, value);
});

test('the address set in Ajustes is used after a restart', async () => {
  const { api } = setup({ '@miniapps/downloader-url': 'http://10.0.0.9:8787' });
  assert.equal(await api.loadDownloaderUrl(), 'http://10.0.0.9:8787');
  assert.equal(api.downloaderUrl(), 'http://10.0.0.9:8787');
});

test('an invalid stored address keeps the default', async () => {
  const { api } = setup({ '@miniapps/downloader-url': 'nada' });
  const before = api.downloaderUrl();
  assert.equal(await api.loadDownloaderUrl(), before);
});

test('the connection check is true only for a healthy answer', async () => {
  const { api } = setup();
  global.fetch = async () => ({ ok: true, json: async () => ({ ok: true }) });
  assert.equal(await api.checkDownloader('http://pc:8787'), true);
  global.fetch = async () => ({ ok: true, json: async () => ({ hola: 1 }) });
  assert.equal(await api.checkDownloader('http://pc:8787'), false);
  global.fetch = async () => ({ ok: false, json: async () => { throw new Error('html'); } });
  assert.equal(await api.checkDownloader('http://pc:8787'), false);
  global.fetch = async () => { throw new TypeError('Network request failed'); };
  assert.equal(await api.checkDownloader('http://pc:8787'), false);
});

test('an unreachable service points to Ajustes in its message', () => {
  const { api } = setup();
  const message = api.downloaderErrorMessage(new TypeError('Network request failed'), 'x');
  assert.match(message, /Ajustes/);
  assert.equal(api.downloaderErrorMessage(new Error('El video es privado.'), 'x'), 'El video es privado.');
  assert.equal(api.downloaderErrorMessage('raro', 'Algo falló'), 'Algo falló');
});

test('analysis is requested from the configured address and rejects bad links before asking', async () => {
  const { api } = setup();
  await api.saveDownloaderUrl('http://10.0.0.2:8787');
  const calls = [];
  global.fetch = async (url) => {
    calls.push(url);
    return { ok: true, json: async () => ({ title: 'Video', modes: ['video'] }) };
  };
  await assert.rejects(api.analyzeUrl('no es un enlace'), /https:\/\//);
  assert.equal(calls.length, 0);
  const result = await api.analyzeUrl('https://youtu.be/abc');
  assert.equal(calls[0], 'http://10.0.0.2:8787/analyze');
  assert.equal(result.title, 'Video');
  assert.deepEqual(result.modes, ['video']);
});

test('a cancelled analysis rejects without a result', async () => {
  const { api } = setup();
  const controller = new AbortController();
  global.fetch = (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
  });
  const pending = api.analyzeUrl('https://youtu.be/abc', controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});
