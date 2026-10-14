import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useSyncExternalStore } from 'react';
import { animeSummariesByIds, type AnimeSummary } from './anime-api';

// The owner's anime list: what they are watching, want to watch and have
// finished. It lives on the phone with a copy of each anime's list data, so
// Hoy and Mi lista show without asking AniList. Airing data is refreshed in
// one batched request, only when it has gone stale.

export type ListStatus = 'watching' | 'planning' | 'completed';

export type LibraryEntry = {
  id: number;
  status: ListStatus;
  // Episodes watched (only meaningful while watching).
  progress: number;
  addedAt: number;
  updatedAt: number;
  completedAt: number | null;
  anime: AnimeSummary;
};

type LibraryState = { ready: boolean; failed: boolean; entries: LibraryEntry[]; lastRefresh: number };

export const LIBRARY_KEY = '@miniapps/anime-library';
// Airing data older than this is refreshed when Hoy or the list is shown.
const STALE_AFTER = 6 * 60 * 60 * 1000;
// Never ask more often than this, whatever looks stale.
const MIN_REFRESH_INTERVAL = 15 * 60 * 1000;

export const LIST_STATUS_LABELS: Record<ListStatus, string> = { watching: 'Viendo', planning: 'Me interesa', completed: 'Terminado' };

let state: LibraryState = { ready: false, failed: false, entries: [], lastRefresh: 0 };
const listeners = new Set<() => void>();
let loading: Promise<void> | null = null;
// What storage holds, to go back to when a write fails.
let persisted: { entries: LibraryEntry[]; lastRefresh: number } = { entries: [], lastRefresh: 0 };
let refreshing: Promise<void> | null = null;

function emit(next: LibraryState) {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function parseLibrary(raw: string | null): { entries: LibraryEntry[]; lastRefresh: number } {
  if (!raw) return { entries: [], lastRefresh: 0 };
  const stored = JSON.parse(raw);
  const entries: LibraryEntry[] = Array.isArray(stored?.entries) ? stored.entries.filter((entry: LibraryEntry) => entry?.id && entry.anime && entry.status in LIST_STATUS_LABELS) : [];
  return { entries, lastRefresh: Number(stored?.lastRefresh) || 0 };
}

export function loadLibrary(retry = false) {
  if (!loading || retry) {
    loading = AsyncStorage.getItem(LIBRARY_KEY)
      .then((raw) => {
        persisted = parseLibrary(raw);
        emit({ ready: true, failed: false, ...persisted });
      })
      // A list that cannot be read must not look empty, and nothing may be
      // written over it until it loads.
      .catch(() => emit({ ready: true, failed: true, entries: [], lastRefresh: 0 }));
  }
  return loading;
}

// Writes go one after another, so a slow write never lands after a newer one.
let writes: Promise<unknown> = Promise.resolve();

// Applies a change to the list as it is now and stores it. The change runs
// after the stored list has loaded and with no wait before it is shown, so
// changes made at the same moment build on each other instead of one undoing
// the other. Resolves false when it could not be saved; the list then goes
// back to what is stored, unless a newer change is on screen.
async function commit(change: (entries: LibraryEntry[]) => LibraryEntry[], refreshedAt?: number): Promise<boolean> {
  await loadLibrary();
  if (state.failed) return false;
  const entries = change(state.entries);
  const lastRefresh = refreshedAt ?? state.lastRefresh;
  const next: LibraryState = { ...state, entries, lastRefresh };
  emit(next);
  const write = writes.then(() => AsyncStorage.setItem(LIBRARY_KEY, JSON.stringify({ entries, lastRefresh })));
  writes = write.catch(() => undefined);
  try {
    await write;
    persisted = { entries, lastRefresh };
    return true;
  } catch {
    if (state === next) emit({ ...state, ...persisted });
    return false;
  }
}

// Only the fields the list needs; the synopsis stays out of storage.
function snapshot(anime: AnimeSummary): AnimeSummary {
  return {
    id: anime.id,
    title: anime.title,
    cover: anime.cover,
    banner: anime.banner,
    color: anime.color,
    format: anime.format,
    status: anime.status,
    episodes: anime.episodes,
    seasonYear: anime.seasonYear,
    startDate: anime.startDate,
    nextEpisode: anime.nextEpisode,
    score: anime.score,
    popularity: anime.popularity,
    trending: anime.trending,
    genres: anime.genres,
    synopsis: '',
    studio: anime.studio,
  };
}

export function useAnimeLibrary() {
  const current = useSyncExternalStore(subscribe, () => state);
  useEffect(() => {
    void loadLibrary();
  }, []);
  return current;
}

export function libraryEntry(id: number) {
  return state.entries.find((entry) => entry.id === id) ?? null;
}

// Episodes already out: everything before the next one, or the whole run once finished.
export function airedEpisodes(anime: AnimeSummary) {
  if (anime.nextEpisode) return anime.nextEpisode.episode - 1;
  if (anime.status === 'FINISHED' || anime.status === 'CANCELLED') return anime.episodes;
  return null;
}

// How far progress can go: the episodes out, or the whole run when AniList
// does not say what has aired.
export function watchableEpisodes(anime: AnimeSummary) {
  return airedEpisodes(anime) ?? anime.episodes ?? Number.MAX_SAFE_INTEGER;
}

// Episodes out that the owner has not watched yet.
export function episodesBehind(entry: LibraryEntry) {
  if (entry.status !== 'watching') return 0;
  const aired = airedEpisodes(entry.anime);
  return aired == null ? 0 : Math.max(0, aired - entry.progress);
}

export function setListStatus(anime: AnimeSummary, status: ListStatus | null): Promise<boolean> {
  return commit((entries) => {
    const now = Date.now();
    const existing = entries.find((entry) => entry.id === anime.id);
    const others = entries.filter((entry) => entry.id !== anime.id);
    if (!status) return others;
    const total = anime.episodes ?? airedEpisodes(anime) ?? 0;
    return [{
      id: anime.id,
      status,
      progress: status === 'completed' ? Math.max(existing?.progress ?? 0, total) : existing?.progress ?? 0,
      addedAt: existing?.addedAt ?? now,
      updatedAt: now,
      completedAt: status === 'completed' ? now : null,
      anime: snapshot(anime),
    }, ...others];
  });
}

// Sets how far the owner has watched. Watching the last episode of a finished
// series moves it to Terminados; progress on an anime not in the list adds it to Viendo.
export async function setProgress(anime: AnimeSummary, progress: number): Promise<{ saved: boolean; done: boolean }> {
  // Only episodes already out can be watched: an airing series stops at the last aired one.
  const value = Math.max(0, Math.min(progress, watchableEpisodes(anime)));
  const done = anime.status === 'FINISHED' && anime.episodes != null && value >= anime.episodes;
  const saved = await commit((entries) => {
    const now = Date.now();
    const existing = entries.find((entry) => entry.id === anime.id);
    return [{
      id: anime.id,
      status: done ? 'completed' : 'watching',
      progress: value,
      addedAt: existing?.addedAt ?? now,
      updatedAt: now,
      completedAt: done ? now : null,
      anime: snapshot(anime),
    }, ...entries.filter((entry) => entry.id !== anime.id)];
  });
  return { saved, done: saved && done };
}

// Keeps a saved anime's copy current with data already fetched (opening its
// detail), at no extra request.
export function updateLibrarySnapshot(anime: AnimeSummary) {
  const existing = libraryEntry(anime.id);
  if (!existing || state.failed) return;
  void commit((entries) => entries.map((entry) => (entry.id === anime.id ? { ...entry, anime: snapshot(anime) } : entry)));
}

// One batched request for the saved anime whose airing data can change, and
// only when something is stale: an episode that should have aired by now, or
// data older than STALE_AFTER. Finished and completed ones are never asked for.
export async function refreshLibrary() {
  await loadLibrary();
  if (state.failed) return;
  if (refreshing) return refreshing;
  const now = Date.now();
  const live = state.entries.filter((entry) => entry.status !== 'completed' && entry.anime.status !== 'FINISHED' && entry.anime.status !== 'CANCELLED');
  if (!live.length || now - state.lastRefresh < MIN_REFRESH_INTERVAL) return;
  const overdue = live.some((entry) => entry.anime.nextEpisode && entry.anime.nextEpisode.airingAt * 1000 <= now);
  if (!overdue && now - state.lastRefresh < STALE_AFTER) return;
  refreshing = animeSummariesByIds(live.map((entry) => entry.id))
    .then(async (fresh) => {
      const byId = new Map(fresh.map((anime) => [anime.id, anime]));
      await commit((entries) => entries.map((entry) => {
        const anime = byId.get(entry.id);
        return anime ? { ...entry, anime: snapshot(anime) } : entry;
      }), Date.now());
    })
    .catch(() => undefined)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}
