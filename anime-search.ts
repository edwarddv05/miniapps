// Title matching for Anime search. AniList's own search only matches whole
// words ("frier" finds nothing), ranks loosely and also matches alternative
// names, so candidates are also taken from Kitsu, which matches word prefixes,
// and every candidate is kept and ranked here only by its main (English) title
// and its romaji title.

export type SearchTitles = {
  english: string | null;
  romaji: string | null;
};

// A match on every typed word, at least as prefixes: the bar a result must
// clear to be shown.
export const STRONG_MATCH = 50;

export function normalizeTitle(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9぀-ヿ㐀-鿿가-힯]+/g, ' ')
    .trim();
}

function titleScore(query: string, words: string[], title: string) {
  const text = normalizeTitle(title);
  if (!text) return 0;
  if (text === query) return 100;
  if (text.startsWith(query)) return 90;
  if (` ${text}`.includes(` ${query}`)) return 75;
  const titleWords = text.split(' ');
  // Every typed word starts some word of the title, in the typed order.
  let cursor = 0;
  let inOrder = true;
  for (const word of words) {
    const found = titleWords.findIndex((candidate, index) => index >= cursor && candidate.startsWith(word));
    if (found === -1) {
      inOrder = false;
      break;
    }
    cursor = found + 1;
  }
  if (inOrder) return 60;
  const matched = words.filter((word) => titleWords.some((candidate) => candidate.startsWith(word))).length;
  if (matched === words.length) return STRONG_MATCH;
  if (text.includes(query)) return 40;
  return Math.round((matched / words.length) * 30);
}

// Best score over the main title and the romaji title. Alternative names and
// the Japanese title are ignored on purpose.
export function matchScore(search: string, titles: SearchTitles) {
  const query = normalizeTitle(search);
  if (!query) return 0;
  const words = query.split(' ');
  const all = [titles.english, titles.romaji].filter((value): value is string => Boolean(value));
  return all.reduce((best, title) => Math.max(best, titleScore(query, words, title)), 0);
}

export type ExternalIds = { anilist: number[]; mal: number[] };

const KITSU_TIMEOUT = 4000;
// Kitsu serves 20 per page and ranks loosely: for "the exi" the anime titled
// "The Exiled Heavy Knight…" is its 47th result. Three pages are asked for at
// once; the ranking here drops the ones whose titles do not match.
const KITSU_PAGES = 3;
const KITSU_PAGE_SIZE = 20;

type KitsuMapping = { externalSite?: string; externalId?: string };

async function kitsuPage(search: string, offset: number, signal: AbortSignal): Promise<ExternalIds> {
  const url = `https://kitsu.io/api/edge/anime?filter%5Btext%5D=${encodeURIComponent(search)}&page%5Blimit%5D=${KITSU_PAGE_SIZE}&page%5Boffset%5D=${offset}&fields%5Banime%5D=mappings&include=mappings&fields%5Bmappings%5D=externalSite,externalId`;
  const ids: ExternalIds = { anilist: [], mal: [] };
  try {
    const response = await fetch(url, { headers: { Accept: 'application/vnd.api+json' }, signal });
    if (!response.ok) return ids;
    const body = await response.json();
    const mappings = new Map<string, KitsuMapping>();
    for (const item of body?.included ?? []) mappings.set(String(item.id), item.attributes ?? {});
    for (const anime of body?.data ?? []) {
      const linked: KitsuMapping[] = (anime?.relationships?.mappings?.data ?? []).map((ref: { id: string }) => mappings.get(String(ref.id))).filter(Boolean);
      const anilist = Number(linked.find((mapping) => mapping.externalSite === 'anilist/anime')?.externalId);
      const mal = Number(linked.find((mapping) => mapping.externalSite === 'myanimelist/anime')?.externalId);
      if (anilist) ids.anilist.push(anilist);
      else if (mal) ids.mal.push(mal);
    }
  } catch {}
  return ids;
}

// Kitsu's text search, reduced to AniList ids (or MyAnimeList ids when Kitsu
// has no AniList mapping). Kitsu is an extra source: pages that are slow or
// fail add nothing and the AniList results stand alone.
export async function kitsuCandidateIds(search: string, signal?: AbortSignal): Promise<ExternalIds> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort);
  const timer = setTimeout(abort, KITSU_TIMEOUT);
  try {
    const pages = await Promise.all(Array.from({ length: KITSU_PAGES }, (_, index) => kitsuPage(search, index * KITSU_PAGE_SIZE, controller.signal)));
    return {
      anilist: [...new Set(pages.flatMap((page) => page.anilist))],
      mal: [...new Set(pages.flatMap((page) => page.mal))],
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
