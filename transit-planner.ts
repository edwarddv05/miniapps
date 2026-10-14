import { formatScheduleTime } from './schedule-data';
import {
  clockMinutes,
  findStation,
  normalizeName,
  routeRunsAt,
  windowCovers,
  type Feeder,
  type FeederVariant,
  type Service,
  type ServiceRoute,
  type ServiceWindow,
  type Station,
  type TransitSystem,
  type Weekday,
} from './transport-data';

// Trip planning on the bundled data: which services go from one station to
// another, whether they run at the chosen time, and roughly how long they
// take. Everything is computed on the phone.

export type TripLeg = {
  service: Service;
  route: ServiceRoute;
  from: string;
  to: string;
  // Stops the bus makes after boarding, the last one included.
  stops: number;
  minutes: number;
};

export type TripOption = {
  key: string;
  legs: TripLeg[];
  minutes: number;
  // At the chosen time: running (with the hour it stops) or its next start.
  running: boolean;
  endsAt: Date | null;
  nextStart: Date | null;
};

export type TripPlan = { direct: TripOption[]; transfers: TripOption[] };

// Average speed between stations and time lost at each stop, tuned so a
// Regular A from Naranjal to Central (16 stations) comes out near 35 minutes.
const SPEED_KMH = 26;
const DWELL_MINUTES = 0.75;
const TRANSFER_MINUTES = 5;

export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = radians(b.lat - a.lat);
  const dLon = radians(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

// Stations the bus passes between two of its stops, in travel order, whether
// it stops there or not. Downtown it follows the branch the route uses.
export function corridorBetween(system: TransitSystem, route: ServiceRoute, from: string, to: string): Station[] {
  const branch = route.stops
    .map((id) => findStation(system, id)?.segment)
    .find((segment) => segment === 'ramal-oeste' || segment === 'ramal-este');
  const line = system.stations.filter((station) => station.segment === 'norte' || station.segment === 'sur' || station.segment === branch);
  const start = line.findIndex((station) => station.id === from);
  const end = line.findIndex((station) => station.id === to);
  if (start < 0 || end < 0) return [];
  return start <= end ? line.slice(start, end + 1) : line.slice(end, start + 1).reverse();
}

function legMinutes(system: TransitSystem, route: ServiceRoute, fromIndex: number, toIndex: number) {
  let km = 0;
  for (let index = fromIndex; index < toIndex; index += 1) {
    // Along the corridor, not in a straight line between two distant stops.
    const passed = corridorBetween(system, route, route.stops[index], route.stops[index + 1]);
    for (let step = 1; step < passed.length; step += 1) km += distanceKm(passed[step - 1], passed[step]);
  }
  const intermediateStops = toIndex - fromIndex - 1;
  return (km / SPEED_KMH) * 60 + intermediateStops * DWELL_MINUTES + DWELL_MINUTES;
}

function makeLeg(system: TransitSystem, service: Service, route: ServiceRoute, from: string, to: string): TripLeg | null {
  const fromIndex = route.stops.indexOf(from);
  const toIndex = route.stops.indexOf(to);
  if (fromIndex < 0 || toIndex <= fromIndex) return null;
  return { service, route, from, to, stops: toIndex - fromIndex, minutes: legMinutes(system, route, fromIndex, toIndex) };
}

function atClock(base: Date, dayOffset: number, time: string) {
  const minutes = clockMinutes(time);
  const date = new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayOffset, 0, 0, 0, 0);
  date.setMinutes(minutes);
  return date;
}

// When the window that covers `date` closes.
export function windowEnd(window: ServiceWindow, date: Date): Date {
  const from = clockMinutes(window.from);
  const to = clockMinutes(window.to);
  const minutes = date.getHours() * 60 + date.getMinutes();
  if (to > from) return atClock(date, 0, window.to);
  // Overnight: before midnight it ends tomorrow, after midnight today.
  return atClock(date, minutes >= from ? 1 : 0, window.to);
}

export function routeEndsAt(route: ServiceRoute, date: Date): Date | null {
  const ends = route.hours.filter((window) => windowCovers(window, date)).map((window) => windowEnd(window, date));
  return ends.length ? new Date(Math.max(...ends.map((end) => end.getTime()))) : null;
}

// The next time the route starts running after `date`, within a week.
export function routeNextStart(route: ServiceRoute, date: Date): Date | null {
  let best: Date | null = null;
  for (let offset = 0; offset <= 7; offset += 1) {
    const day = ((date.getDay() + offset) % 7) as Weekday;
    for (const window of route.hours) {
      if (!window.days.includes(day)) continue;
      const start = atClock(date, offset, window.from);
      if (start > date && (!best || start < best)) best = start;
    }
    if (best) return best;
  }
  return best;
}

function optionFor(legs: TripLeg[], date: Date): TripOption {
  const minutes = legs.reduce((total, leg) => total + leg.minutes, 0) + (legs.length - 1) * TRANSFER_MINUTES;
  // A transfer runs only if the second bus still runs when the first arrives.
  let clock = date;
  let running = true;
  let endsAt: Date | null = null;
  for (const leg of legs) {
    if (!routeRunsAt(leg.route, clock)) running = false;
    const end = routeEndsAt(leg.route, clock);
    if (end && (!endsAt || end < endsAt)) endsAt = end;
    clock = new Date(clock.getTime() + (leg.minutes + TRANSFER_MINUTES) * 60_000);
  }
  return {
    key: legs.map((leg) => `${leg.route.id}:${leg.from}>${leg.to}`).join('|'),
    legs,
    minutes: Math.max(1, Math.round(minutes)),
    running,
    endsAt: running ? endsAt : null,
    nextStart: running ? null : routeNextStart(legs[0].route, date),
  };
}

function byAvailability(a: TripOption, b: TripOption) {
  if (a.running !== b.running) return a.running ? -1 : 1;
  if (!a.running && a.nextStart && b.nextStart && a.nextStart.getTime() !== b.nextStart.getTime()) return a.nextStart.getTime() - b.nextStart.getTime();
  return a.minutes - b.minutes;
}

// One option per service and direction: the SXN from 22 de Agosto and the
// SXN from Naranjal are the same bus to the rider at Naranjal.
function bestPerService(options: TripOption[]) {
  const kept = new Map<string, TripOption>();
  for (const option of options) {
    const key = option.legs.map((leg) => `${leg.service.id}${leg.route.direction}`).join('+');
    const current = kept.get(key);
    if (!current || byAvailability(option, current) < 0) kept.set(key, option);
  }
  return [...kept.values()].sort(byAvailability);
}

const MAX_TRANSFERS = 4;

export function planTrip(system: TransitSystem, from: string, to: string, date: Date): TripPlan {
  if (from === to) return { direct: [], transfers: [] };
  const direct: TripOption[] = [];
  for (const service of system.services) {
    for (const route of service.routes) {
      const leg = makeLeg(system, service, route, from, to);
      if (leg) direct.push(optionFor([leg], date));
    }
  }
  const directOptions = bestPerService(direct);
  // Transfers only matter when no direct bus runs at that time.
  if (directOptions.some((option) => option.running)) return { direct: directOptions, transfers: [] };

  const transfers: TripOption[] = [];
  for (const firstService of system.services) {
    for (const firstRoute of firstService.routes) {
      const boarding = firstRoute.stops.indexOf(from);
      if (boarding < 0) continue;
      for (const middle of firstRoute.stops.slice(boarding + 1)) {
        if (middle === to) continue;
        const first = makeLeg(system, firstService, firstRoute, from, middle);
        if (!first) continue;
        for (const secondService of system.services) {
          if (secondService.id === firstService.id) continue;
          for (const secondRoute of secondService.routes) {
            const second = makeLeg(system, secondService, secondRoute, middle, to);
            if (second) transfers.push(optionFor([first, second], date));
          }
        }
      }
    }
  }
  const running = transfers.filter((option) => option.running);
  const pool = running.length ? running : transfers;
  // The fastest way for each pair of services, then the best few overall.
  const bestPairs = bestPerService(pool.sort((a, b) => a.minutes - b.minutes));
  return { direct: directOptions, transfers: bestPairs.slice(0, MAX_TRANSFERS) };
}

export type ServiceStatus = { running: boolean; endsAt: Date | null; nextStart: Date | null };

// Whether any direction of the service runs at `date`, and until or from when.
export function serviceStatus(service: Service, date: Date): ServiceStatus {
  const ends = service.routes.map((route) => routeEndsAt(route, date)).filter((end): end is Date => Boolean(end));
  if (ends.length) return { running: true, endsAt: new Date(Math.max(...ends.map((end) => end.getTime()))), nextStart: null };
  const starts = service.routes.map((route) => routeNextStart(route, date)).filter((start): start is Date => Boolean(start));
  return { running: false, endsAt: null, nextStart: starts.length ? new Date(Math.min(...starts.map((start) => start.getTime()))) : null };
}

// "Naranjal – Central" for a service that runs both ways, "Izaguirre → Benavides"
// for one that only runs in one direction.
export function serviceSpan(system: TransitSystem, service: Service) {
  const [route] = service.routes;
  const separator = service.routes.some((other) => other.direction !== route.direction) ? ' – ' : ' → ';
  return `${findStation(system, route.stops[0])?.name ?? ''}${separator}${findStation(system, route.stops[route.stops.length - 1])?.name ?? ''}`;
}

// The same status for any set of windows (a feeder's legs and variants).
export function windowsStatus(hours: ServiceWindow[], date: Date): ServiceStatus {
  const route = { id: '', direction: 'NS' as const, stops: [], hours };
  const running = routeRunsAt(route, date);
  return { running, endsAt: running ? routeEndsAt(route, date) : null, nextStart: running ? null : routeNextStart(route, date) };
}

export function feederStatus(feeder: Feeder, date: Date): ServiceStatus {
  return windowsStatus(feeder.variants.flatMap((variant) => variant.hours.flatMap((leg) => leg.windows)), date);
}

export type FeederLeg = { from: string; to: string; stops: string[]; windows: ServiceWindow[] };

// A variant's stop list runs out and back; it splits at the turnaround named
// in its hours. When the name does not appear, the list stays whole.
export function feederLegs(variant: FeederVariant): FeederLeg[] {
  const [out, back] = variant.hours;
  const turn = variant.stops.findIndex((stop) => normalizeName(stop) === normalizeName(out.to));
  if (turn <= 0 || !back) return [{ from: out.from, to: out.to, stops: variant.stops, windows: variant.hours.flatMap((leg) => leg.windows) }];
  const returning = variant.stops.slice(turn + 1);
  return [
    { from: out.from, to: out.to, stops: variant.stops.slice(0, turn + 1), windows: out.windows },
    { from: back.from, to: back.to, stops: returning.length ? returning : variant.stops.slice(turn), windows: back.windows },
  ];
}

export function feedersAtStation(system: TransitSystem, stationId: string): Feeder[] {
  return system.feeders.filter((feeder) => feeder.terminal === stationId);
}

export type FeederMatch = { feeder: Feeder; stop: string | null };

// Feeders by name or code, or by a stop they pass ("plaza vea").
export function searchFeeders(system: TransitSystem, query: string): FeederMatch[] {
  const needle = normalizeName(query);
  if (!needle) return system.feeders.map((feeder) => ({ feeder, stop: null }));
  const matches: FeederMatch[] = [];
  for (const feeder of system.feeders) {
    if (normalizeName(feeder.name).includes(needle) || normalizeName(feeder.code ?? '').includes(needle)) {
      matches.push({ feeder, stop: null });
      continue;
    }
    const stop = feeder.variants.flatMap((variant) => variant.stops).find((name) => normalizeName(name).includes(needle));
    if (stop) matches.push({ feeder, stop });
  }
  return matches;
}

export type StationService = { service: Service; route: ServiceRoute };

// Services that can be boarded at the station (not those that end there),
// one per service and direction.
export function servicesAtStation(system: TransitSystem, stationId: string): StationService[] {
  const found = new Map<string, StationService>();
  for (const service of system.services) {
    for (const route of service.routes) {
      const index = route.stops.indexOf(stationId);
      if (index < 0 || index === route.stops.length - 1) continue;
      const key = `${service.id}${route.direction}`;
      if (!found.has(key)) found.set(key, { service, route });
    }
  }
  return [...found.values()];
}

// "hacia Matellini": where the bus is heading.
export function headsign(system: TransitSystem, route: ServiceRoute) {
  return findStation(system, route.stops[route.stops.length - 1])?.name ?? '';
}

const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function clockLabel(date: Date) {
  return formatScheduleTime(`${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`);
}

// "Hasta 9:00 PM", "Desde 5:00 PM", "Mañana desde 5:30 AM", "Lunes desde 5:30 AM".
export function availabilityLabel(option: ServiceStatus, reference: Date) {
  if (option.running) return option.endsAt ? `Hasta ${clockLabel(option.endsAt)}` : 'En servicio';
  if (!option.nextStart) return 'Sin servicio esta semana';
  const start = option.nextStart;
  if (sameDay(start, reference)) return `Desde ${clockLabel(start)}`;
  const tomorrow = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate() + 1);
  const day = sameDay(start, tomorrow) ? 'Mañana' : DAY_NAMES[start.getDay()][0].toUpperCase() + DAY_NAMES[start.getDay()].slice(1);
  return `${day} desde ${clockLabel(start)}`;
}

const DAY_SETS: Array<[string, number[]]> = [
  ['Todos los días', [0, 1, 2, 3, 4, 5, 6]],
  ['Lun a sáb', [1, 2, 3, 4, 5, 6]],
  ['Lun a vie', [1, 2, 3, 4, 5]],
  ['Vie y sáb', [5, 6]],
  ['Sáb y dom', [0, 6]],
  ['Sáb', [6]],
  ['Dom', [0]],
];

function daysLabel(days: number[]) {
  const sorted = [...days].sort();
  const match = DAY_SETS.find(([, set]) => set.length === sorted.length && set.every((day, index) => day === sorted[index]));
  return match ? match[0] : sorted.map((day) => DAY_NAMES[day].slice(0, 3)).join(', ');
}

// "Lun a vie 5:30 AM – 9:00 PM · Sáb y dom 6:30 AM – 9:00 PM", windows on the
// same days joined: "Lun a vie 5:00 – 10:00 AM y 4:30 – 8:30 PM".
export function hoursLabel(hours: ServiceWindow[]) {
  const groups = new Map<string, ServiceWindow[]>();
  for (const window of hours) {
    const label = daysLabel(window.days);
    groups.set(label, [...(groups.get(label) ?? []), window]);
  }
  const range = (window: ServiceWindow) => `${formatScheduleTime(window.from === '24:00' ? '00:00' : window.from)} – ${formatScheduleTime(window.to === '24:00' ? '00:00' : window.to)}`;
  return [...groups.entries()].map(([label, windows]) => `${label} ${windows.map(range).join(' y ')}`).join(' · ');
}

// Trip minutes rounded the way people say them.
export function minutesLabel(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export type NearbyStation = { station: Station; meters: number; walkMinutes: number };

// The closest stations to a point, straight-line distance; walking at 4.5 km/h.
export function nearestStations(system: TransitSystem, point: { lat: number; lon: number }, count = 3): NearbyStation[] {
  return system.stations
    .map((station) => {
      const meters = Math.round(distanceKm(point, station) * 1000);
      return { station, meters, walkMinutes: Math.max(1, Math.round(meters / 75)) };
    })
    .sort((a, b) => a.meters - b.meters)
    .slice(0, count);
}

// "450 m", "1,2 km".
export function distanceLabel(meters: number) {
  if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
  return `${(meters / 1000).toFixed(1).replace('.', ',')} km`;
}
