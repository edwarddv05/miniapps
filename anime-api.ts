import AsyncStorage from '@react-native-async-storage/async-storage';
import { generateGeminiText } from './ai-schedule-scanner';
import { kitsuCandidateIds, matchScore, STRONG_MATCH } from './anime-search';

const ENDPOINT = 'https://graphql.anilist.co';
const FILTERS_KEY = '@miniapps/anime-filters';
const TRANSLATIONS_KEY = '@miniapps/anime-translations';
const TRANSLATIONS_LIMIT = 200;
export const ANIME_PAGE_SIZE = 30;
const RELATIONS_LIMIT = 20;

export type AnimeSeason = 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL';
export type AnimeStatus = 'RELEASING' | 'FINISHED' | 'NOT_YET_RELEASED' | 'CANCELLED' | 'HIATUS';
export type AnimeFormat = 'TV' | 'TV_SHORT' | 'MOVIE' | 'SPECIAL' | 'OVA' | 'ONA' | 'MUSIC';
export type AnimeSort = 'TRENDING_DESC' | 'POPULARITY_DESC' | 'SCORE_DESC' | 'START_DATE_DESC' | 'TITLE_ROMAJI';

export type AnimeFilters = {
  genres: string[];
  year: number | null;
  season: AnimeSeason | null;
  status: AnimeStatus | null;
  format: AnimeFormat | null;
  sort: AnimeSort;
};

export const DEFAULT_ANIME_FILTERS: AnimeFilters = { genres: [], year: null, season: null, status: null, format: null, sort: 'TRENDING_DESC' };

type FuzzyDate = { year: number | null; month: number | null; day: number | null };

export type AnimeTitle = { romaji: string | null; english: string | null; native: string | null };

export type AnimeSummary = {
  id: number;
  title: AnimeTitle;
  cover: string | null;
  banner: string | null;
  color: string | null;
  format: AnimeFormat | null;
  status: AnimeStatus | null;
  episodes: number | null;
  seasonYear: number | null;
  startDate: FuzzyDate | null;
  nextEpisode: { episode: number; airingAt: number } | null;
  score: number | null;
  popularity: number;
  trending: number;
  genres: string[];
  synopsis: string;
  studio: string | null;
};

export type AnimeRelation = {
  id: number;
  relation: string;
  title: AnimeTitle;
  cover: string | null;
  format: AnimeFormat | null;
  year: number | null;
};

export type AnimeEpisode = {
  number: number;
  airingAt: number | null;
  title: string | null;
};

export type StreamingService = {
  site: string;
  url: string;
  icon: string | null;
  color: string | null;
  // A full-colour service logo (JustWatch), drawn as is instead of the icon on colour.
  logo?: string | null;
};

export type AnimeDetail = AnimeSummary & {
  description: string;
  duration: number | null;
  season: AnimeSeason | null;
  endDate: FuzzyDate | null;
  genres: string[];
  studios: string[];
  source: string | null;
  relations: AnimeRelation[];
  episodeList: AnimeEpisode[];
  streaming: StreamingService[];
};

// Spanish names for AniList's fixed genre list. "Hentai" is left out on purpose.
export const ANIME_GENRES: Array<{ key: string; label: string }> = [
  { key: 'Action', label: 'Acción' },
  { key: 'Adventure', label: 'Aventura' },
  { key: 'Comedy', label: 'Comedia' },
  { key: 'Drama', label: 'Drama' },
  { key: 'Ecchi', label: 'Ecchi' },
  { key: 'Fantasy', label: 'Fantasía' },
  { key: 'Horror', label: 'Terror' },
  { key: 'Mahou Shoujo', label: 'Mahō shōjo' },
  { key: 'Mecha', label: 'Mecha' },
  { key: 'Music', label: 'Música' },
  { key: 'Mystery', label: 'Misterio' },
  { key: 'Psychological', label: 'Psicológico' },
  { key: 'Romance', label: 'Romance' },
  { key: 'Sci-Fi', label: 'Ciencia ficción' },
  { key: 'Slice of Life', label: 'Recuentos de la vida' },
  { key: 'Sports', label: 'Deportes' },
  { key: 'Supernatural', label: 'Sobrenatural' },
  { key: 'Thriller', label: 'Suspenso' },
];

export const SEASON_LABELS: Record<AnimeSeason, string> = { WINTER: 'Invierno', SPRING: 'Primavera', SUMMER: 'Verano', FALL: 'Otoño' };
export const STATUS_LABELS: Record<AnimeStatus, string> = { RELEASING: 'En emisión', FINISHED: 'Finalizado', NOT_YET_RELEASED: 'Próximamente', CANCELLED: 'Cancelado', HIATUS: 'En pausa' };
export const FORMAT_LABELS: Record<AnimeFormat, string> = { TV: 'TV', TV_SHORT: 'TV corto', MOVIE: 'Película', SPECIAL: 'Especial', OVA: 'OVA', ONA: 'ONA', MUSIC: 'Musical' };
export const SORT_LABELS: Record<AnimeSort, string> = { TRENDING_DESC: 'Tendencia', POPULARITY_DESC: 'Popularidad', SCORE_DESC: 'Puntuación', START_DATE_DESC: 'Más recientes', TITLE_ROMAJI: 'Título' };

export const RELATION_LABELS: Record<string, string> = {
  PREQUEL: 'Precuela',
  SEQUEL: 'Secuela',
  PARENT: 'Principal',
  SIDE_STORY: 'Historia paralela',
  SPIN_OFF: 'Spin-off',
  ALTERNATIVE: 'Versión alternativa',
  SUMMARY: 'Resumen',
  COMPILATION: 'Compilación',
  CONTAINS: 'Incluye',
  OTHER: 'Relacionado',
};
// Seasons first: the direct line of the story, then everything around it.
const RELATION_ORDER = ['PREQUEL', 'SEQUEL', 'PARENT', 'SIDE_STORY', 'SPIN_OFF', 'ALTERNATIVE', 'SUMMARY', 'COMPILATION', 'CONTAINS', 'OTHER'];

const SOURCE_LABELS: Record<string, string> = {
  ORIGINAL: 'Original',
  MANGA: 'Manga',
  LIGHT_NOVEL: 'Novela ligera',
  WEB_NOVEL: 'Novela web',
  NOVEL: 'Novela',
  VISUAL_NOVEL: 'Novela visual',
  VIDEO_GAME: 'Videojuego',
  GAME: 'Juego',
  WEB_MANGA: 'Manga web',
  MANHWA: 'Manhwa',
  MANHUA: 'Manhua',
  COMIC: 'Cómic',
  LIVE_ACTION: 'Live action',
  MULTIMEDIA_PROJECT: 'Proyecto multimedia',
  PICTURE_BOOK: 'Libro ilustrado',
  ANIME: 'Anime',
  DOUJINSHI: 'Doujinshi',
  OTHER: 'Otro',
};

export class AnimeApiError extends Error {
  constructor(message: string, readonly status: number | null = null) {
    super(message);
  }
}

const SUMMARY_FIELDS = `
  id
  title { romaji english native }
  coverImage { extraLarge large color }
  bannerImage
  format
  status
  episodes
  seasonYear
  startDate { year month day }
  nextAiringEpisode { episode airingAt }
  averageScore
  popularity
  trending
  genres
  description(asHtml: false)
  studios(isMain: true) { nodes { name } }
`;

const DETAIL_QUERY = `
query ($id: Int) {
  Media(id: $id, type: ANIME) {
    ${SUMMARY_FIELDS}
    duration
    season
    endDate { year month day }
    source
    relations {
      edges {
        relationType
        node { id type isAdult format seasonYear startDate { year } title { romaji english native } coverImage { large color } }
      }
    }
    airingSchedule(page: 1, perPage: 25) {
      pageInfo { total }
      nodes { episode airingAt }
    }
    airingSchedule2: airingSchedule(page: 2, perPage: 25) {
      nodes { episode airingAt }
    }
    streamingEpisodes { title }
    externalLinks { site url type icon color isDisabled }
  }
}`;

async function request<T>(query: string, variables: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal,
    });
  } catch (reason) {
    if (signal?.aborted) throw reason;
    throw new AnimeApiError('Sin conexión con AniList.');
  }
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.errors?.length) {
    const status = response.ok ? Number(body?.errors?.[0]?.status) || null : response.status;
    throw new AnimeApiError(String(body?.errors?.[0]?.message ?? `HTTP ${response.status}`), status);
  }
  return body.data as T;
}

export function animeErrorMessage(reason: unknown) {
  if (reason instanceof AnimeApiError) {
    if (reason.status === 429) return 'AniList recibió demasiadas consultas. Espera un minuto.';
    if (reason.status === 404) return 'AniList no tiene este anime.';
    if (reason.status == null) return reason.message;
  }
  return 'AniList no respondió. Inténtalo de nuevo.';
}

type RawMedia = {
  id: number;
  title: AnimeTitle;
  coverImage?: { extraLarge?: string | null; large?: string | null; color?: string | null } | null;
  bannerImage?: string | null;
  format?: AnimeFormat | null;
  status?: AnimeStatus | null;
  episodes?: number | null;
  seasonYear?: number | null;
  startDate?: FuzzyDate | null;
  nextAiringEpisode?: { episode: number; airingAt: number } | null;
  averageScore?: number | null;
  popularity?: number | null;
  trending?: number | null;
  genres?: string[] | null;
  description?: string | null;
  studios?: { nodes: Array<{ name: string }> } | null;
};

function toSummary(media: RawMedia): AnimeSummary {
  return {
    id: media.id,
    title: media.title,
    cover: media.coverImage?.extraLarge ?? media.coverImage?.large ?? null,
    banner: media.bannerImage ?? null,
    color: media.coverImage?.color ?? null,
    format: media.format ?? null,
    status: media.status ?? null,
    episodes: media.episodes ?? null,
    seasonYear: media.seasonYear ?? null,
    startDate: media.startDate?.year ? media.startDate : null,
    nextEpisode: media.nextAiringEpisode ?? null,
    score: media.averageScore ?? null,
    popularity: media.popularity ?? 0,
    trending: media.trending ?? 0,
    genres: media.genres ?? [],
    synopsis: cleanDescription(media.description),
    studio: media.studios?.nodes[0]?.name ?? null,
  };
}

function filterVariables(filters: AnimeFilters) {
  return {
    genres: filters.genres.length ? filters.genres : undefined,
    season: filters.season ?? undefined,
    year: filters.year ?? undefined,
    status: filters.status ?? undefined,
    format: filters.format ?? undefined,
  };
}

const FILTER_PARAMS = '$genres: [String], $season: MediaSeason, $year: Int, $status: MediaStatus, $format: MediaFormat';
const FILTER_ARGS = 'type: ANIME, isAdult: false, genre_in: $genres, season: $season, seasonYear: $year, status: $status, format: $format';

// Kitsu's candidates, fetched from AniList by id with the same filters applied.
// An empty id list is left out of the query: AniList would ignore the filter
// and return everything.
async function animeByIds(ids: { anilist: number[]; mal: number[] }, filters: AnimeFilters, signal?: AbortSignal) {
  const lists = [
    ids.anilist.length ? `byId: Page(perPage: 50) { media(${FILTER_ARGS}, id_in: $anilist) { ${SUMMARY_FIELDS} } }` : '',
    ids.mal.length ? `byMal: Page(perPage: 50) { media(${FILTER_ARGS}, idMal_in: $mal) { ${SUMMARY_FIELDS} } }` : '',
  ].filter(Boolean);
  if (!lists.length) return [];
  // GraphQL rejects a declared variable that no field uses.
  const params = [ids.anilist.length ? '$anilist: [Int]' : '', ids.mal.length ? '$mal: [Int]' : '', FILTER_PARAMS].filter(Boolean).join(', ');
  const query = `query (${params}) { ${lists.join(' ')} }`;
  const data = await request<Record<string, { media: RawMedia[] }>>(query, { anilist: ids.anilist.slice(0, 50), mal: ids.mal.slice(0, 50), ...filterVariables(filters) }, signal);
  return Object.values(data).flatMap((list) => list.media.map(toSummary));
}

function startValue(anime: AnimeSummary) {
  const date = anime.startDate;
  return date?.year ? date.year * 10000 + (date.month ?? 0) * 100 + (date.day ?? 0) : 0;
}

function compareBySort(sort: AnimeSort) {
  return (a: AnimeSummary, b: AnimeSummary) => {
    switch (sort) {
      case 'POPULARITY_DESC': return b.popularity - a.popularity;
      case 'SCORE_DESC': return (b.score ?? 0) - (a.score ?? 0) || b.popularity - a.popularity;
      case 'START_DATE_DESC': return startValue(b) - startValue(a);
      case 'TITLE_ROMAJI': return (a.title.romaji ?? '').localeCompare(b.title.romaji ?? '');
      default: return b.trending - a.trending || b.popularity - a.popularity;
    }
  };
}

type SearchResult = { items: AnimeSummary[]; hasNextPage: boolean };

// Every answer is kept for a while, so going back to the list, reopening the
// miniapp or retyping a search does not ask again.
const searchCache = new Map<string, { result: SearchResult; at: number }>();
const SEARCH_TTL = 10 * 60 * 1000;
const SEARCH_CACHE_LIMIT = 60;
// Kitsu is only asked when AniList's own whole-word search finds fewer good
// matches than this (typically a half-typed word).
const ENOUGH_MATCHES = 12;

// Browsing (no text) also survives closing the app: those pages change slowly,
// so they are kept on the phone for hours. Typed searches stay in memory only.
const BROWSE_CACHE_KEY = '@miniapps/anime-browse-cache';
const BROWSE_TTL = 6 * 60 * 60 * 1000;
const BROWSE_CACHE_LIMIT = 12;

type StoredPages = Record<string, { result: SearchResult; at: number }>;

async function readBrowseCache(): Promise<StoredPages> {
  try {
    return JSON.parse((await AsyncStorage.getItem(BROWSE_CACHE_KEY)) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

async function writeBrowseCache(key: string, result: SearchResult) {
  const pages = await readBrowseCache();
  pages[key] = { result, at: Date.now() };
  const kept = Object.entries(pages).filter(([, page]) => Date.now() - page.at < BROWSE_TTL).sort((a, b) => b[1].at - a[1].at).slice(0, BROWSE_CACHE_LIMIT);
  await AsyncStorage.setItem(BROWSE_CACHE_KEY, JSON.stringify(Object.fromEntries(kept))).catch(() => undefined);
}

export async function searchAnime(options: { search: string; filters: AnimeFilters; page: number }, signal?: AbortSignal): Promise<SearchResult> {
  const browsing = !options.search.trim();
  const key = JSON.stringify([options.search.trim().toLowerCase(), options.filters, options.page]);
  const ttl = browsing ? BROWSE_TTL : SEARCH_TTL;
  const cached = searchCache.get(key);
  if (cached && Date.now() - cached.at < ttl) return cached.result;
  if (browsing) {
    const stored = (await readBrowseCache())[key];
    if (stored && Date.now() - stored.at < BROWSE_TTL) {
      searchCache.set(key, stored);
      return stored.result;
    }
  }
  const result = await fetchSearch(options, signal);
  searchCache.set(key, { result, at: Date.now() });
  if (searchCache.size > SEARCH_CACHE_LIMIT) searchCache.delete(searchCache.keys().next().value as string);
  if (browsing) void writeBrowseCache(key, result);
  return result;
}

async function fetchSearch(options: { search: string; filters: AnimeFilters; page: number }, signal?: AbortSignal): Promise<SearchResult> {
  const { search, filters, page } = options;
  const text = search.trim();
  const relevance = Boolean(text) && filters.sort === DEFAULT_ANIME_FILTERS.sort;
  const sort = relevance ? ['SEARCH_MATCH', 'POPULARITY_DESC'] : [filters.sort, 'POPULARITY_DESC'];
  const searchQuery = `query ($page: Int, $perPage: Int, $search: String, $sort: [MediaSort], ${FILTER_PARAMS}) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { hasNextPage }
      media(${FILTER_ARGS}, search: $search, sort: $sort) { ${SUMMARY_FIELDS} }
    }
  }`;
  const data = await request<{ Page: { pageInfo: { hasNextPage: boolean }; media: RawMedia[] } }>(searchQuery, {
    page,
    perPage: ANIME_PAGE_SIZE,
    search: text || undefined,
    sort,
    ...filterVariables(filters),
  }, signal);
  const found = data.Page.media.map(toSummary);
  const hasNextPage = data.Page.pageInfo.hasNextPage;
  if (!text) return { items: found, hasNextPage };

  // AniList also matches alternative names and the Japanese title; a result
  // is kept only when its main or romaji title matches the text.
  const matching = found.filter((anime) => matchScore(text, anime.title) >= STRONG_MATCH);
  let candidates: AnimeSummary[] = [];
  if (page === 1 && matching.length < ENOUGH_MATCHES) {
    // Few whole-word matches: add Kitsu's prefix matches, fetched from AniList by id.
    candidates = await kitsuCandidateIds(text, signal)
      .then((ids) => animeByIds(ids, filters, signal))
      .catch(() => [] as AnimeSummary[]);
  }
  const seen = new Set(matching.map((anime) => anime.id));
  const added = candidates.filter((anime) => {
    if (seen.has(anime.id) || matchScore(text, anime.title) < STRONG_MATCH) return false;
    seen.add(anime.id);
    return true;
  });
  const scored = [...matching, ...added].map((anime) => ({ anime, score: matchScore(text, anime.title) }));
  if (page === 1) {
    const bySort = compareBySort(filters.sort);
    scored.sort(relevance ? (a, b) => b.score - a.score || b.anime.popularity - a.anime.popularity : (a, b) => bySort(a.anime, b.anime));
  }
  return { items: scored.map((entry) => entry.anime), hasNextPage };
}

// AniList descriptions carry light HTML (<br>, <i>, <b>) and entities.
export function cleanDescription(value: string | null | undefined) {
  if (!value) return '';
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Crunchyroll titles read "Episode 12 - Title"; keep only the title.
function streamingTitles(episodes: Array<{ title?: string | null }> | null | undefined) {
  const titles = new Map<number, string>();
  for (const item of episodes ?? []) {
    const match = item.title?.match(/^Episode\s+(\d+)\s*[-–:]\s*(.+)$/i);
    if (match) titles.set(Number(match[1]), match[2].trim());
  }
  return titles;
}

// Recently opened anime, so going back through related titles is instant.
const detailCache = new Map<number, { detail: AnimeDetail; at: number }>();
const DETAIL_TTL = 10 * 60 * 1000;

// Current data for a set of saved anime in as few requests as possible:
// AniList serves 50 per page, so a whole personal list is usually one request.
export async function animeSummariesByIds(ids: number[], signal?: AbortSignal): Promise<AnimeSummary[]> {
  const result: AnimeSummary[] = [];
  for (let start = 0; start < ids.length; start += 50) {
    const chunk = ids.slice(start, start + 50);
    const data = await request<{ Page: { media: RawMedia[] } }>(`query ($ids: [Int]) { Page(perPage: 50) { media(type: ANIME, id_in: $ids) { ${SUMMARY_FIELDS} } } }`, { ids: chunk }, signal);
    result.push(...data.Page.media.map(toSummary));
  }
  return result;
}

export async function getAnime(id: number, signal?: AbortSignal): Promise<AnimeDetail> {
  const cached = detailCache.get(id);
  if (cached && Date.now() - cached.at < DETAIL_TTL) return cached.detail;
  const detail = await fetchAnime(id, signal);
  detailCache.set(id, { detail, at: Date.now() });
  return detail;
}

async function fetchAnime(id: number, signal?: AbortSignal): Promise<AnimeDetail> {
  type RawDetail = RawMedia & {
    bannerImage: string | null;
    description: string | null;
    duration: number | null;
    season: AnimeSeason | null;
    startDate: FuzzyDate | null;
    endDate: FuzzyDate | null;
    genres: string[] | null;
    averageScore: number | null;
    source: string | null;
    studios: { nodes: Array<{ name: string }> } | null;
    relations: { edges: Array<{ relationType: string; node: RawMedia & { type: string; isAdult: boolean | null; startDate: { year: number | null } | null } }> } | null;
    airingSchedule: { pageInfo: { total: number | null }; nodes: Array<{ episode: number; airingAt: number }> } | null;
    airingSchedule2: { nodes: Array<{ episode: number; airingAt: number }> } | null;
    streamingEpisodes: Array<{ title: string | null }> | null;
    externalLinks: Array<{ site: string; url: string | null; type: string; icon: string | null; color: string | null; isDisabled: boolean | null }> | null;
  };
  const data = await request<{ Media: RawDetail | null }>(DETAIL_QUERY, { id }, signal);
  const media = data.Media;
  if (!media) throw new AnimeApiError('AniList no tiene este anime.', 404);

  const relations = (media.relations?.edges ?? [])
    // Cameos (CHARACTER) are noise; long franchises list dozens of specials.
    .filter((edge) => edge.node.type === 'ANIME' && !edge.node.isAdult && edge.relationType !== 'CHARACTER')
    .sort((a, b) => RELATION_ORDER.indexOf(a.relationType) - RELATION_ORDER.indexOf(b.relationType) || (a.node.seasonYear ?? a.node.startDate?.year ?? 0) - (b.node.seasonYear ?? b.node.startDate?.year ?? 0))
    .map((edge) => ({
      id: edge.node.id,
      relation: RELATION_LABELS[edge.relationType] ?? RELATION_LABELS.OTHER,
      title: edge.node.title,
      cover: edge.node.coverImage?.large ?? null,
      format: edge.node.format ?? null,
      year: edge.node.seasonYear ?? edge.node.startDate?.year ?? null,
    }))
    .slice(0, RELATIONS_LIMIT);

  // The episode list comes from the airing schedule (dates) with Crunchyroll
  // titles where they exist. Long-running series (more than two pages of
  // schedule) only show the next episode.
  const titles = streamingTitles(media.streamingEpisodes);
  // AniList serves at most 25 per page; two pages cover a two-cour season.
  const scheduled = [...(media.airingSchedule?.nodes ?? []), ...(media.airingSchedule2?.nodes ?? [])];
  const scheduleComplete = (media.airingSchedule?.pageInfo.total ?? 0) <= scheduled.length;
  let episodeList: AnimeEpisode[] = [];
  if (scheduled.length && scheduleComplete) {
    episodeList = scheduled.sort((a, b) => a.episode - b.episode).map((node) => ({ number: node.episode, airingAt: node.airingAt, title: titles.get(node.episode) ?? null }));
  } else if (!scheduled.length && titles.size && titles.size <= 60) {
    episodeList = [...titles.entries()].sort((a, b) => a[0] - b[0]).map(([number, title]) => ({ number, airingAt: null, title }));
  }

  return {
    ...toSummary(media),
    description: cleanDescription(media.description),
    duration: media.duration ?? null,
    season: media.season ?? null,
    endDate: media.endDate?.year ? media.endDate : null,
    genres: media.genres ?? [],
    studios: (media.studios?.nodes ?? []).map((node) => node.name),
    source: media.source ? SOURCE_LABELS[media.source] ?? null : null,
    relations,
    episodeList,
    streaming: streamingServices(media.externalLinks),
  };
}

// Where the anime streams, worldwide: AniList does not say in which countries.
// A service can appear more than once (YouTube channels per region); one link each.
function streamingServices(links: Array<{ site: string; url: string | null; type: string; icon: string | null; color: string | null; isDisabled: boolean | null }> | null) {
  const services: StreamingService[] = [];
  for (const link of links ?? []) {
    if (link.type !== 'STREAMING' || link.isDisabled || !link.url || services.some((service) => service.site === link.site)) continue;
    services.push({ site: link.site, url: link.url, icon: link.icon, color: link.color });
  }
  return services;
}

export function animeTitle(title: AnimeTitle) {
  return title.english || title.romaji || title.native || 'Sin título';
}

export function genreLabel(key: string) {
  return ANIME_GENRES.find((genre) => genre.key === key)?.label ?? key;
}

export function formatFuzzyDate(date: FuzzyDate | null) {
  if (!date?.year) return null;
  if (!date.month) return String(date.year);
  const value = new Date(date.year, date.month - 1, date.day ?? 1);
  return new Intl.DateTimeFormat('es-PE', date.day ? { day: 'numeric', month: 'short', year: 'numeric' } : { month: 'long', year: 'numeric' }).format(value);
}

// AniList's seasons: winter is January to March, and so on.
export function currentAnimeSeason(date = new Date()): { season: AnimeSeason; year: number } {
  const seasons: AnimeSeason[] = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];
  return { season: seasons[Math.floor(date.getMonth() / 3)], year: date.getFullYear() };
}

export function activeFilterCount(filters: AnimeFilters) {
  return filters.genres.length + (filters.year ? 1 : 0) + (filters.season ? 1 : 0) + (filters.status ? 1 : 0) + (filters.format ? 1 : 0) + (filters.sort !== DEFAULT_ANIME_FILTERS.sort ? 1 : 0);
}

export async function loadAnimeFilters(): Promise<AnimeFilters> {
  try {
    const raw = await AsyncStorage.getItem(FILTERS_KEY);
    if (!raw) return DEFAULT_ANIME_FILTERS;
    const stored = JSON.parse(raw) as Partial<AnimeFilters>;
    return {
      genres: Array.isArray(stored.genres) ? stored.genres.filter((genre) => ANIME_GENRES.some((item) => item.key === genre)) : [],
      year: typeof stored.year === 'number' ? stored.year : null,
      season: stored.season && stored.season in SEASON_LABELS ? stored.season : null,
      status: stored.status && stored.status in STATUS_LABELS ? stored.status : null,
      format: stored.format && stored.format in FORMAT_LABELS ? stored.format : null,
      sort: stored.sort && stored.sort in SORT_LABELS ? stored.sort : DEFAULT_ANIME_FILTERS.sort,
    };
  } catch {
    return DEFAULT_ANIME_FILTERS;
  }
}

export async function saveAnimeFilters(filters: AnimeFilters) {
  await AsyncStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
}

type TranslationCache = Record<string, { text: string; at: number }>;

async function readTranslations(): Promise<TranslationCache> {
  try {
    return JSON.parse((await AsyncStorage.getItem(TRANSLATIONS_KEY)) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

export async function cachedTranslation(id: number) {
  return (await readTranslations())[id]?.text ?? null;
}

// Translation runs only when asked for, and each synopsis is translated once:
// the result is kept on the phone so reopening the anime costs no quota.
export async function translateSynopsis(id: number, text: string, apiKey: string) {
  const prompt = `Traduce al español latinoamericano esta sinopsis de anime. Conserva los nombres propios y los saltos de párrafo. Devuelve solo la traducción, sin comentarios ni comillas.\n\n${text}`;
  const translated = (await generateGeminiText(prompt, apiKey)).replace(/^```\w*\s*|```$/g, '').trim();
  const cache = await readTranslations();
  cache[id] = { text: translated, at: Date.now() };
  const kept = Object.entries(cache).sort((a, b) => b[1].at - a[1].at).slice(0, TRANSLATIONS_LIMIT);
  await AsyncStorage.setItem(TRANSLATIONS_KEY, JSON.stringify(Object.fromEntries(kept))).catch(() => undefined);
  return translated;
}
