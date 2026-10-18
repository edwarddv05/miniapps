const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLoader } = require('./load-ts.cjs');

const { createShakeDetector } = createLoader()('shake-detector');

const jolt = (detect, time) => detect(2.5, 0.4, 0.3, time);

test('three strong jolts within a second are a shake', () => {
  const detect = createShakeDetector();
  assert.equal(jolt(detect, 0), false);
  assert.equal(jolt(detect, 250), false);
  assert.equal(jolt(detect, 500), true);
});

test('gravity and walking never trigger it', () => {
  const detect = createShakeDetector();
  for (let time = 0; time < 5000; time += 50) assert.equal(detect(0.2, 1.1, 0.4, time), false);
});

test('samples of one bump count once', () => {
  const detect = createShakeDetector();
  for (let time = 0; time < 90; time += 15) assert.equal(jolt(detect, time), false);
  assert.equal(jolt(detect, 400), false);
});

test('jolts far apart do not add up', () => {
  const detect = createShakeDetector();
  assert.equal(jolt(detect, 0), false);
  assert.equal(jolt(detect, 900), false);
  assert.equal(jolt(detect, 1950), false);
});

test('after a shake it stays quiet for a moment', () => {
  const detect = createShakeDetector();
  jolt(detect, 0);
  jolt(detect, 200);
  assert.equal(jolt(detect, 400), true);
  assert.equal(jolt(detect, 600), false);
  assert.equal(jolt(detect, 800), false);
  assert.equal(jolt(detect, 1000), false);
  assert.equal(jolt(detect, 2000), false);
  assert.equal(jolt(detect, 2200), false);
  assert.equal(jolt(detect, 2400), true);
});
