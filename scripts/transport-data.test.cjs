const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../transport-data.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const moduleExports = {};
new Function('exports', compiled)(moduleExports);
const { METROPOLITANO, findService, routeRunsAt, windowCovers, normalizeName } = moduleExports;

const stationIds = new Set(METROPOLITANO.stations.map((station) => station.id));
const routes = METROPOLITANO.services.flatMap((service) => service.routes);
const TIME = /^([01]\d|2[0-4]):[0-5]\d$/;

// Position along the corridor from north to south. The two downtown branches
// sit side by side between Caquetá and Central, so each gets the same span.
function corridorPosition(id) {
  const order = { norte: 0, 'ramal-oeste': 1, 'ramal-este': 1, sur: 2 };
  const station = METROPOLITANO.stations.find((item) => item.id === id);
  const sameSegment = METROPOLITANO.stations.filter((item) => item.segment === station.segment);
  return order[station.segment] * 1000 + sameSegment.indexOf(station);
}

test('station and service ids are unique', () => {
  assert.equal(stationIds.size, METROPOLITANO.stations.length);
  const serviceIds = METROPOLITANO.services.map((service) => service.id);
  assert.equal(new Set(serviceIds).size, serviceIds.length);
  const routeIds = routes.map((route) => route.id);
  assert.equal(new Set(routeIds).size, routeIds.length);
});

test('the corridor has its 44 stations inside Lima', () => {
  assert.equal(METROPOLITANO.stations.length, 44);
  for (const station of METROPOLITANO.stations) {
    assert.ok(station.lat < -11.85 && station.lat > -12.2, station.id);
    assert.ok(station.lon < -76.95 && station.lon > -77.1, station.id);
  }
});

test('every route stops at known stations, each once', () => {
  for (const route of routes) {
    assert.ok(route.stops.length >= 2, route.id);
    for (const stop of route.stops) assert.ok(stationIds.has(stop), `${route.id}: ${stop}`);
    assert.equal(new Set(route.stops).size, route.stops.length, route.id);
  }
});

test('routes run the way their direction says and keep to one downtown branch', () => {
  for (const route of routes) {
    const positions = route.stops.map(corridorPosition);
    for (let index = 1; index < positions.length; index += 1) {
      const step = positions[index] - positions[index - 1];
      assert.ok(route.direction === 'NS' ? step > 0 : step < 0, `${route.id} at ${route.stops[index]}`);
    }
    const segments = new Set(route.stops.map((id) => METROPOLITANO.stations.find((item) => item.id === id).segment));
    assert.ok(!(segments.has('ramal-oeste') && segments.has('ramal-este')), route.id);
  }
});

test('every station is served by some trunk service', () => {
  const served = new Set(routes.flatMap((route) => route.stops));
  for (const id of stationIds) assert.ok(served.has(id), id);
});

test('service windows have valid days and times', () => {
  const windows = [
    ...routes.flatMap((route) => route.hours),
    ...METROPOLITANO.feeders.flatMap((feeder) => feeder.variants.flatMap((variant) => variant.hours.flatMap((leg) => leg.windows))),
  ];
  for (const window of windows) {
    assert.ok(window.days.length > 0);
    assert.ok(window.days.every((day) => Number.isInteger(day) && day >= 0 && day <= 6));
    assert.match(window.from, TIME);
    assert.match(window.to, TIME);
    assert.notEqual(window.from, window.to);
  }
});

test('feeders start at a trunk station and list their stops', () => {
  for (const feeder of METROPOLITANO.feeders) {
    assert.ok(stationIds.has(feeder.terminal), feeder.id);
    assert.ok(feeder.variants.length > 0, feeder.id);
    for (const variant of feeder.variants) {
      assert.ok(variant.stops.length >= 2, `${feeder.id} ${variant.name}`);
      assert.equal(variant.hours.length, 2, `${feeder.id} ${variant.name}`);
    }
  }
});

test('regular services follow the day of the week', () => {
  const [northbound] = findService(METROPOLITANO, 'A').routes;
  assert.equal(routeRunsAt(northbound, new Date(2026, 8, 28, 22, 30)), true); // lunes
  assert.equal(routeRunsAt(northbound, new Date(2026, 8, 27, 22, 30)), false); // domingo
  assert.equal(routeRunsAt(northbound, new Date(2026, 8, 28, 4, 59)), false);
});

test('overnight windows belong to the night they start', () => {
  const window = { days: [5, 6], from: '23:30', to: '04:00' };
  assert.equal(windowCovers(window, new Date(2026, 9, 2, 23, 45)), true); // viernes
  assert.equal(windowCovers(window, new Date(2026, 9, 3, 1, 0)), true); // sábado de madrugada
  assert.equal(windowCovers(window, new Date(2026, 9, 4, 1, 0)), true); // domingo de madrugada
  assert.equal(windowCovers(window, new Date(2026, 9, 5, 1, 0)), false); // lunes de madrugada
  assert.equal(windowCovers(window, new Date(2026, 9, 1, 23, 45)), false); // jueves
});

test('windows ending at 24:00 run until midnight', () => {
  const window = { days: [1], from: '05:30', to: '24:00' };
  assert.equal(windowCovers(window, new Date(2026, 8, 28, 23, 59)), true);
  assert.equal(windowCovers(window, new Date(2026, 8, 29, 0, 5)), false);
});

test('names compare without accents or case', () => {
  assert.equal(normalizeName('  Canadá '), 'canada');
  assert.equal(normalizeName('ESPAÑA'), 'espana');
});
