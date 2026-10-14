const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Compiles the app's TypeScript modules on the fly, resolving their relative imports.
const cache = {};
function load(name) {
  if (cache[name]) return cache[name];
  const source = fs.readFileSync(path.join(__dirname, `../${name}.ts`), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const moduleExports = {};
  cache[name] = moduleExports;
  new Function('exports', 'require', compiled)(moduleExports, (request) => load(request.replace('./', '')));
  return moduleExports;
}

const { METROPOLITANO } = load('transport-data');
const { planTrip, availabilityLabel, nearestStations, distanceLabel, feederStatus, feederLegs, feedersAtStation, searchFeeders, serviceStatus, serviceSpan, servicesAtStation, hoursLabel, minutesLabel, corridorBetween, routeNextStart, headsign } = load('transit-planner');

// Tuesday 29 September 2026.
const at = (day, hours, minutes = 0) => new Date(2026, 8, day, hours, minutes);
const codes = (options) => options.map((option) => option.legs.map((leg) => leg.service.code).join('+'));

test('a trip along the Regular A offers it, running, heading south', () => {
  const plan = planTrip(METROPOLITANO, 'naranjal', 'central', at(29, 12));
  const regular = plan.direct.find((option) => option.legs[0].service.code === 'A');
  assert.ok(regular);
  assert.equal(regular.running, true);
  assert.equal(regular.legs[0].route.direction, 'NS');
  assert.equal(regular.legs[0].stops, 15);
  assert.ok(regular.minutes >= 28 && regular.minutes <= 45, `${regular.minutes} min`);
  assert.equal(headsign(METROPOLITANO, regular.legs[0].route), 'Central');
  assert.deepEqual(plan.transfers, []);
});

test('the opposite direction uses the northbound routes', () => {
  const plan = planTrip(METROPOLITANO, 'central', 'naranjal', at(29, 12));
  assert.ok(plan.direct.length > 0);
  assert.ok(plan.direct.every((option) => option.legs[0].route.direction === 'SN'));
});

test('running services come first and expresses that are off show when they start', () => {
  const plan = planTrip(METROPOLITANO, 'naranjal', 'javier-prado', at(29, 12));
  assert.equal(plan.direct[0].running, true);
  const x2 = plan.direct.find((option) => option.legs[0].service.code === 'X2');
  assert.ok(x2);
  assert.equal(x2.running, false);
  assert.equal(availabilityLabel(x2, at(29, 12)), 'Mañana desde 5:00 AM');
  const firstOff = plan.direct.findIndex((option) => !option.running);
  assert.ok(plan.direct.slice(firstOff).every((option) => !option.running));
});

test('an express is faster than the regular that stops everywhere', () => {
  const plan = planTrip(METROPOLITANO, 'matellini', 'central', at(29, 7));
  const express = plan.direct.find((option) => option.legs[0].service.code === 'X1');
  const regular = plan.direct.find((option) => option.legs[0].service.code === 'C');
  assert.ok(express.minutes < regular.minutes);
});

test('stations without a common service get a transfer', () => {
  const plan = planTrip(METROPOLITANO, 'pacifico', 'rosario-de-villa', at(29, 12));
  assert.deepEqual(plan.direct, []);
  assert.ok(plan.transfers.length > 0);
  const [best] = plan.transfers;
  assert.equal(best.legs.length, 2);
  assert.equal(best.legs[0].from, 'pacifico');
  assert.equal(best.legs[1].to, 'rosario-de-villa');
  assert.equal(best.legs[0].to, best.legs[1].from);
  assert.equal(best.running, true);
});

test('the same station twice plans nothing', () => {
  assert.deepEqual(planTrip(METROPOLITANO, 'central', 'central', at(29, 12)), { direct: [], transfers: [] });
});

test('the night service counts from Friday night into Saturday morning', () => {
  const saturdayNight = new Date(2026, 9, 3, 1, 30); // sábado 3 de octubre, 1:30
  const plan = planTrip(METROPOLITANO, 'naranjal', 'matellini', saturdayNight);
  const lechucero = plan.direct.find((option) => option.legs[0].service.code === 'L');
  assert.ok(lechucero?.running);
  assert.equal(availabilityLabel(lechucero, saturdayNight), 'Hasta 4:00 AM');
});

test('the next start skips days a route does not run', () => {
  const x7 = METROPOLITANO.services.find((service) => service.id === 'X7').routes[0];
  const next = routeNextStart(x7, new Date(2026, 9, 3, 12)); // sábado
  assert.equal(next.getDay(), 1);
  assert.equal(next.getHours(), 5);
  assert.equal(next.getMinutes(), 30);
});

test('the corridor between two stops follows the branch the route uses', () => {
  const a = METROPOLITANO.services.find((service) => service.id === 'A').routes[0];
  assert.deepEqual(corridorBetween(METROPOLITANO, a, 'caqueta', 'central').map((station) => station.id), ['caqueta', 'ramon-castilla', 'tacna', 'jiron-de-la-union', 'colmena', 'central']);
  const b = METROPOLITANO.services.find((service) => service.id === 'B').routes[1];
  assert.deepEqual(corridorBetween(METROPOLITANO, b, 'central', 'caqueta').map((station) => station.id), ['central', 'espana', 'quilca', 'dos-de-mayo', 'caqueta']);
});

test('hours read by day groups', () => {
  const x1 = METROPOLITANO.services.find((service) => service.id === 'X1').routes[0];
  assert.equal(hoursLabel(x1.hours), 'Lun a vie 5:30 AM – 9:00 PM · Sáb y dom 6:30 AM – 9:00 PM');
  const sxn = METROPOLITANO.services.find((service) => service.id === 'SXN').routes[0];
  assert.equal(hoursLabel(sxn.hours), 'Lun a vie 5:00 AM – 10:00 AM y 4:30 PM – 8:30 PM');
});

test('durations read as minutes or hours', () => {
  assert.equal(minutesLabel(35), '35 min');
  assert.equal(minutesLabel(60), '1 h');
  assert.equal(minutesLabel(75), '1 h 15 min');
});

test('transfers are only computed while no direct bus runs', () => {
  assert.equal(codes(planTrip(METROPOLITANO, 'naranjal', 'central', at(29, 12)).transfers).length, 0);
});

test('a service is running if any of its directions is', () => {
  const x2 = METROPOLITANO.services.find((service) => service.id === 'X2');
  const morning = serviceStatus(x2, at(29, 7));
  assert.equal(morning.running, true);
  assert.equal(availabilityLabel(morning, at(29, 7)), 'Hasta 9:00 AM');
  const noon = serviceStatus(x2, at(29, 12));
  assert.equal(noon.running, false);
  assert.equal(availabilityLabel(noon, at(29, 12)), 'Desde 5:00 PM');
});

test('spans mark one-way services with an arrow', () => {
  const find = (id) => METROPOLITANO.services.find((service) => service.id === id);
  assert.equal(serviceSpan(METROPOLITANO, find('A')), 'Naranjal – Central');
  assert.equal(serviceSpan(METROPOLITANO, find('X6')), 'Izaguirre → Benavides');
});

test('a station lists what can be boarded there, not services that end there', () => {
  const atMatellini = servicesAtStation(METROPOLITANO, 'matellini');
  assert.ok(atMatellini.every((item) => item.route.direction === 'SN'));
  assert.ok(atMatellini.some((item) => item.service.id === 'C'));
  const atCentral = servicesAtStation(METROPOLITANO, 'central').map((item) => `${item.service.id}${item.route.direction}`);
  assert.ok(atCentral.includes('CNS') && atCentral.includes('ASN'));
  assert.ok(!atCentral.includes('ANS'));
});

const feeder = (id) => METROPOLITANO.feeders.find((item) => item.id === id);

test('a feeder route splits at its turnaround into out and back', () => {
  const [out, back] = feederLegs(feeder('tahuantinsuyo').variants[0]);
  assert.equal(out.to, 'Mascaypacha');
  assert.equal(out.stops[0], 'Huáscar');
  assert.equal(out.stops[out.stops.length - 1], 'Mascaypacha');
  assert.equal(back.stops[back.stops.length - 1], 'Túpac Amaru');
  assert.equal(out.stops.length + back.stops.length, feeder('tahuantinsuyo').variants[0].stops.length);
});

test('a feeder whose turnaround is not in its stops keeps one list', () => {
  const legs = feederLegs(feeder('playero').variants[0]);
  assert.equal(legs.length, 1);
});

test('feeders run until midnight and stop overnight', () => {
  assert.equal(feederStatus(feeder('tahuantinsuyo'), at(29, 23, 45)).running, true);
  const late = feederStatus(feeder('tahuantinsuyo'), at(30, 1, 0));
  assert.equal(late.running, false);
  assert.equal(availabilityLabel(late, at(30, 1, 0)), 'Desde 5:00 AM');
});

test('each terminal lists its feeders', () => {
  assert.equal(feedersAtStation(METROPOLITANO, 'matellini').length, 5);
  assert.ok(feedersAtStation(METROPOLITANO, 'naranjal').some((item) => item.id === 'puno'));
  assert.deepEqual(feedersAtStation(METROPOLITANO, 'canada'), []);
});

test('feeders are found by name, code or a stop they pass', () => {
  assert.equal(searchFeeders(METROPOLITANO, 'payet')[0].feeder.id, 'payet');
  assert.equal(searchFeeders(METROPOLITANO, 'an-01')[0].feeder.id, 'tahuantinsuyo');
  const byStop = searchFeeders(METROPOLITANO, 'pantanos');
  assert.equal(byStop[0].feeder.id, 'villa-el-salvador');
  assert.equal(byStop[0].stop, 'Pantanos de Villa');
  assert.equal(searchFeeders(METROPOLITANO, '').length, METROPOLITANO.feeders.length);
});

test('the nearest stations are sorted by distance', () => {
  // A point next to the Javier Prado station.
  const [first, second] = nearestStations(METROPOLITANO, { lat: -12.0893, lon: -77.0236 });
  assert.equal(first.station.id, 'javier-prado');
  assert.ok(first.meters < 100);
  assert.ok(second.meters > first.meters);
  assert.equal(nearestStations(METROPOLITANO, { lat: -12.0893, lon: -77.0236 }, 5).length, 5);
});

test('distances read in metres or kilometres', () => {
  assert.equal(distanceLabel(447), '450 m');
  assert.equal(distanceLabel(3), '10 m');
  assert.equal(distanceLabel(1234), '1,2 km');
});
