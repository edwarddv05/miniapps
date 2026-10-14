import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useSyncExternalStore } from 'react';

// The owner's saved trips in the Metropolitano miniapp: favourites and the
// last few searched. Stored on the phone only, in one store shared by the
// miniapp and Hoy, so a favourite shows on Hoy as soon as it is starred.

export type SavedTrip = { from: string; to: string };
export type SavedTrips = { favorites: SavedTrip[]; recents: SavedTrip[] };

export const TRIPS_KEY = '@miniapps/transit-trips';
const MAX_RECENTS = 5;

export const EMPTY_TRIPS: SavedTrips = { favorites: [], recents: [] };

const sameTrip = (a: SavedTrip, b: SavedTrip) => a.from === b.from && a.to === b.to;

function validTrips(value: unknown): SavedTrip[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is SavedTrip => typeof item?.from === 'string' && typeof item?.to === 'string');
}

type TripsState = { ready: boolean; failed: boolean; trips: SavedTrips };

let state: TripsState = { ready: false, failed: false, trips: EMPTY_TRIPS };
const listeners = new Set<() => void>();
let loading: Promise<void> | null = null;
// What storage holds, to go back to when a write fails.
let persisted: SavedTrips = EMPTY_TRIPS;
// Writes go one after another, so a slow write never lands after a newer one.
let writes: Promise<unknown> = Promise.resolve();

function emit(next: TripsState) {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function parseTrips(raw: string | null): SavedTrips {
  if (!raw) return EMPTY_TRIPS;
  const stored = JSON.parse(raw);
  return { favorites: validTrips(stored?.favorites), recents: validTrips(stored?.recents) };
}

export function loadTrips(retry = false) {
  if (!loading || retry) {
    loading = AsyncStorage.getItem(TRIPS_KEY)
      .then((raw) => {
        persisted = parseTrips(raw);
        emit({ ready: true, failed: false, trips: persisted });
      })
      // Trips that cannot be read must not look empty, and nothing may be
      // written over them until they load.
      .catch(() => emit({ ready: true, failed: true, trips: EMPTY_TRIPS }));
  }
  return loading;
}

export function useSavedTrips() {
  const current = useSyncExternalStore(subscribe, () => state);
  useEffect(() => {
    void loadTrips();
  }, []);
  return current;
}

// Applies a change and stores it; changes made before the stored trips load
// wait for them, so nothing saved earlier is overwritten. Resolves false when
// it could not be saved; the trips then go back to what is stored.
export async function updateSavedTrips(change: (trips: SavedTrips) => SavedTrips): Promise<boolean> {
  await loadTrips();
  if (state.failed) return false;
  const trips = change(state.trips);
  const next: TripsState = { ...state, trips };
  emit(next);
  const write = writes.then(() => AsyncStorage.setItem(TRIPS_KEY, JSON.stringify(trips)));
  writes = write.catch(() => undefined);
  try {
    await write;
    persisted = trips;
    return true;
  } catch {
    if (state === next) emit({ ...state, trips: persisted });
    return false;
  }
}

export function isFavorite(trips: SavedTrips, trip: SavedTrip) {
  return trips.favorites.some((item) => sameTrip(item, trip));
}

export function withRecent(trips: SavedTrips, trip: SavedTrip): SavedTrips {
  return { ...trips, recents: [trip, ...trips.recents.filter((item) => !sameTrip(item, trip))].slice(0, MAX_RECENTS) };
}

export function withFavoriteToggled(trips: SavedTrips, trip: SavedTrip): SavedTrips {
  return isFavorite(trips, trip)
    ? { ...trips, favorites: trips.favorites.filter((item) => !sameTrip(item, trip)) }
    : { ...trips, favorites: [...trips.favorites, trip] };
}

// Whether the owner pays the general or the student fare; the planner and
// the fare sheet show that one.
export type FareKind = 'general' | 'student';
export const FARE_KEY = '@miniapps/transit-fare';

export async function loadFareKind(): Promise<FareKind> {
  try {
    return (await AsyncStorage.getItem(FARE_KEY)) === 'student' ? 'student' : 'general';
  } catch {
    return 'general';
  }
}

export function saveFareKind(kind: FareKind) {
  return AsyncStorage.setItem(FARE_KEY, kind);
}
