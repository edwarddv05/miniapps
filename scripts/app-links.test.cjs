const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLoader } = require('./load-ts.cjs');

const { parseAppLink } = createLoader()('app-links');

test('a shared link opens the Downloader with the decoded address', () => {
  const shared = 'https://www.youtube.com/watch?v=abc&t=10';
  assert.deepEqual(parseAppLink(`miniapps://download?url=${encodeURIComponent(shared)}`), { kind: 'download', url: shared });
});

test('the widget opens Horario', () => {
  assert.deepEqual(parseAppLink('miniapps://schedule'), { kind: 'schedule' });
});

test('other schemes, routes and addresses are ignored', () => {
  assert.equal(parseAppLink('miniapps://download?url=javascript%3Aalert(1)'), null);
  assert.equal(parseAppLink('miniapps://download'), null);
  assert.equal(parseAppLink('miniapps://settings'), null);
  assert.equal(parseAppLink('https://example.com'), null);
  assert.equal(parseAppLink('miniapps://download?url=%E0%A4%A'), null);
});
