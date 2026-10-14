import AsyncStorage from '@react-native-async-storage/async-storage';
import { RELATION_LABELS, type AnimeDetail, type StreamingService } from './anime-api';
import { matchScore, normalizeTitle } from './anime-search';

// Where an anime streams in a country (Peru unless the owner picks another), from
// JustWatch's GraphQL API: the same request simple-justwatch-python-api sends,
// trimmed to the fields shown here. AniList's links are worldwide, so they are
// used only when JustWatch fails.

const API_URL = 'https://apis.justwatch.com/graphql';
const IMAGES_URL = 'https://images.justwatch.com';
const CACHE_KEY = '@miniapps/anime-justwatch-v3';
const COUNTRY_KEY = '@miniapps/anime-justwatch-country';
export const DEFAULT_COUNTRY = 'PE';

// Latin America first, then the catalogues most often compared against.
export const STREAMING_COUNTRIES: Array<{ code: string; name: string }> = [
  { code: 'PE', name: 'Perú' },
  { code: 'MX', name: 'México' },
  { code: 'AR', name: 'Argentina' },
  { code: 'CL', name: 'Chile' },
  { code: 'CO', name: 'Colombia' },
  { code: 'EC', name: 'Ecuador' },
  { code: 'BO', name: 'Bolivia' },
  { code: 'UY', name: 'Uruguay' },
  { code: 'PY', name: 'Paraguay' },
  { code: 'VE', name: 'Venezuela' },
  { code: 'CR', name: 'Costa Rica' },
  { code: 'BR', name: 'Brasil' },
  { code: 'ES', name: 'España' },
  { code: 'US', name: 'Estados Unidos' },
  { code: 'CA', name: 'Canadá' },
  { code: 'GB', name: 'Reino Unido' },
  { code: 'JP', name: 'Japón' },
];

export function countryName(code: string) {
  return STREAMING_COUNTRIES.find((country) => country.code === code)?.name ?? code;
}

// The flag emoji from the two regional-indicator letters of the code.
export function countryFlag(code: string) {
  return String.fromCodePoint(...[...code.toUpperCase()].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65));
}

export async function loadStreamingCountry() {
  try {
    const code = await AsyncStorage.getItem(COUNTRY_KEY);
    return code && STREAMING_COUNTRIES.some((country) => country.code === code) ? code : DEFAULT_COUNTRY;
  } catch {
    return DEFAULT_COUNTRY;
  }
}

export async function saveStreamingCountry(code: string) {
  await AsyncStorage.setItem(COUNTRY_KEY, code).catch(() => undefined);
}
const CACHE_LIMIT = 200;
// Catalogues change slowly; a title is looked up again after three days.
const CACHE_TTL = 3 * 24 * 60 * 60 * 1000;
const RESULTS = 5;
// A JustWatch title is taken only when it matches the anime's title at least from
// the start ("Frieren" for "Frieren: Beyond Journey's End").
const TITLE_MATCH = 75;
// Or when most words are shared: JustWatch spells some romaji titles its own way
// ("Tensei Shitara Suraimu Datta Ken" for AniList's "…Slime Datta Ken").
const WORD_OVERLAP = 0.75;

function wordOverlap(a: string, b: string) {
  const left = normalizeTitle(a).split(' ').filter(Boolean);
  const right = new Set(normalizeTitle(b).split(' ').filter(Boolean));
  if (!left.length || !right.size) return 0;
  return left.filter((word) => right.has(word)).length / Math.max(left.length, right.size);
}

function titlesMatch(ours: string, theirs: string) {
  return matchScore(ours, { english: theirs, romaji: null }) >= TITLE_MATCH
    || matchScore(theirs, { english: ours, romaji: null }) >= TITLE_MATCH
    || wordOverlap(ours, theirs) >= WORD_OVERLAP;
}

// Subscriptions and free services first; rentals and purchases after.
const MONETIZATION_ORDER = ['FLATRATE', 'FREE', 'ADS', 'RENT', 'BUY'];

const SEARCH_QUERY = `query Search($country: Country!, $language: Language!, $first: Int!, $filter: TitleFilter) {
  popularTitles(country: $country, filter: $filter, first: $first, sortBy: POPULAR, sortRandomSeed: 0) {
    edges { node {
      objectType
      content(country: $country, language: $language) { title originalTitle }
      offers(country: $country, platform: WEB, filter: { bestOnly: true }) { ...Offer }
      ... on Show {
        seasons(sortDirection: ASC) {
          content(country: $country, language: $language) { seasonNumber }
          offers(country: $country, platform: WEB, filter: { bestOnly: true }) { ...Offer }
        }
      }
    } }
  }
}
fragment Offer on Offer {
  monetizationType
  standardWebURL
  package { packageId clearName icon(profile: S100, format: PNG) }
}`;

type RawOffer = { monetizationType: string; standardWebURL: string | null; package: { packageId: number; clearName: string; icon: string | null } };
type RawSeason = { content: { seasonNumber: number | null }; offers: RawOffer[] | null };
type RawNode = { objectType: string; content: { title: string; originalTitle: string | null }; offers: RawOffer[] | null; seasons?: RawSeason[] | null };

type CacheEntry = { at: number; services: StreamingService[] | null };
type Cache = Record<string, CacheEntry>;

const memory = new Map<string, StreamingService[] | null>();

async function readCache(): Promise<Cache> {
  try {
    return JSON.parse((await AsyncStorage.getItem(CACHE_KEY)) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

async function writeCache(key: string, services: StreamingService[] | null) {
  const cache = await readCache();
  cache[key] = { at: Date.now(), services };
  const kept = Object.entries(cache).sort((a, b) => b[1].at - a[1].at).slice(0, CACHE_LIMIT);
  await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(kept))).catch(() => undefined);
}

// JustWatch keeps every season under one show, while AniList lists each season
// on its own: "Season 2", "4th Season Part 1 & 2" and "Part 2" are dropped, with
// whatever follows them, before searching.
function baseTitle(title: string) {
  return title
    .replace(/\s*[:\-–]?\s*\b(season\s*\d+|\d+(st|nd|rd|th)\s+season|part\s*\d+|cour\s*\d+)\b.*$/i, '')
    .replace(/\s+(ii|iii|iv|\d+)\s*$/i, '')
    // "Mushoku Tensei III: Isekai…": the numeral and the subtitle after it.
    .replace(/\s+(II|III|IV|V|VI|VII|VIII|IX|X)\s*[:\-–].*$/, '')
    .trim();
}

const ROMAN: Record<string, number> = { II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 };

// Which JustWatch season an AniList entry is: "Season 3", "3rd Season" or
// "Mushoku Tensei III". Without a marker, an entry with no prequel is season 1;
// otherwise it is unknown and the offers of the whole show are used.
function seasonNumber(anime: AnimeDetail): number | null {
  for (const title of [anime.title.english, anime.title.romaji]) {
    if (!title) continue;
    const numbered = title.match(/\bseason\s*(\d+)/i) ?? title.match(/\b(\d+)(?:st|nd|rd|th)\s+season\b/i);
    if (numbered) return Number(numbered[1]);
    const roman = title.match(/\b(II|III|IV|V|VI|VII|VIII|IX|X)\b(?=\s*[:\-–]|\s*$)/);
    if (roman) return ROMAN[roman[1]];
  }
  return anime.relations.some((relation) => relation.relation === RELATION_LABELS.PREQUEL) ? null : 1;
}

async function search(title: string, objectType: string, country: string, signal?: AbortSignal): Promise<RawNode[]> {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operationName: 'Search',
      // English titles match AniList's; offers do not depend on the language.
      variables: { country, language: 'en', first: RESULTS, filter: { searchQuery: title, objectTypes: [objectType] } },
      query: SEARCH_QUERY,
    }),
    signal,
  });
  if (!response.ok) throw new Error(`JustWatch ${response.status}`);
  const body = await response.json();
  if (body?.errors?.length) throw new Error('JustWatch');
  return (body?.data?.popularTitles?.edges ?? []).map((edge: { node: RawNode }) => edge.node);
}

function services(offers: RawOffer[]): StreamingService[] {
  const sorted = [...offers].sort((a, b) => MONETIZATION_ORDER.indexOf(a.monetizationType) - MONETIZATION_ORDER.indexOf(b.monetizationType));
  const result: StreamingService[] = [];
  for (const offer of sorted) {
    if (!offer.standardWebURL || result.some((service) => service.site === offer.package.clearName)) continue;
    result.push({ site: offer.package.clearName, url: offer.standardWebURL, icon: null, color: null, logo: offer.package.icon ? `${IMAGES_URL}${offer.package.icon}` : null });
  }
  return result;
}

// Services in the country for the anime; an empty list when JustWatch has it but
// nothing streams it there. Throws when JustWatch fails or does not know the anime,
// so the caller can fall back to AniList's worldwide links.
export async function streamingIn(anime: AnimeDetail, country: string, signal?: AbortSignal): Promise<StreamingService[]> {
  const key = `${anime.id}:${country}`;
  const known = memory.get(key);
  if (known !== undefined) {
    if (known === null) throw new Error('JustWatch no tiene este anime.');
    return known;
  }
  const cached = (await readCache())[key];
  if (cached && Date.now() - cached.at < CACHE_TTL) {
    memory.set(key, cached.services);
    if (cached.services === null) throw new Error('JustWatch no tiene este anime.');
    return cached.services;
  }

  const objectType = anime.format === 'MOVIE' ? 'MOVIE' : 'SHOW';
  const names = [...new Set([anime.title.english, anime.title.romaji].filter((value): value is string => Boolean(value)).map(baseTitle))];
  // The romaji title is searched only when the English one finds nothing.
  for (const name of names) {
    const nodes = await search(name, objectType, country, signal);
    // Each result is checked against both AniList titles, not only the one searched.
    const match = nodes.find((node) => [node.content.title, node.content.originalTitle].some((title) => title && names.some((ours) => titlesMatch(ours, title))));
    if (match) {
      // AniList lists each season on its own and JustWatch prices them apart:
      // season 1 can be on Netflix while season 3 is only on Crunchyroll.
      const wanted = objectType === 'SHOW' ? seasonNumber(anime) : null;
      const season = wanted == null ? undefined : match.seasons?.find((item) => item.content.seasonNumber === wanted);
      const found = services((season ?? match).offers ?? []);
      memory.set(key, found);
      void writeCache(key, found);
      return found;
    }
  }
  memory.set(key, null);
  void writeCache(key, null);
  throw new Error('JustWatch no tiene este anime.');
}
