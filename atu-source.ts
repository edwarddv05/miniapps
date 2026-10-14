import { ATU_PORTAL_URL, METROPOLITANO } from './transport-data';

// Detects whether the ATU portal changed since transport-data.ts was built.
// Each page the data came from is reduced to a fingerprint (its schedule text
// and route images; for the home page, the Metropolitano menu), and the
// fingerprints taken when the data was checked live in atu-snapshot.ts,
// written by scripts/atu-snapshot.cjs. The app compares them only when the
// owner asks. It cannot apply changes itself: trunk stops are transcribed
// from route images by hand.

export type AtuPage = { key: string; label: string; url: string };

export const ATU_PAGES: AtuPage[] = [
  { key: 'menu', label: 'Menú del Metropolitano', url: ATU_PORTAL_URL },
  { key: 'tarifas', label: 'Tarifas', url: METROPOLITANO.source },
  ...METROPOLITANO.services.map((service) => ({ key: `servicio:${service.id}`, label: service.name, url: service.source })),
  ...METROPOLITANO.feeders.map((feeder) => ({ key: `alimentador:${feeder.id}`, label: `Alimentador ${feeder.name}`, url: feeder.source })),
];

const CHROME_IMAGE = /imagenes\/(banda|ActulizadoImg|NuevoImg|ModificadoImg|icono-|FOOTER|footer)/i;
const MENU_LINK = /^(Metropolitano|Alimentadores|Tarifarios\/Metropolitano|Playero)/;

// FNV-1a, 32 bits: stable across the phone and Node.
function hash(text: string) {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value.toString(16).padStart(8, '0');
}

function withoutNoise(html: string) {
  return html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
}

export function pageFingerprint(url: string, html: string) {
  const clean = withoutNoise(html);
  if (url === ATU_PORTAL_URL) {
    // Links relative to the portal; React Native's URL has no pathname.
    const links = [...clean.matchAll(/<a[^>]+href="([^"]+)"/g)]
      .map((match) => match[1].replace(ATU_PORTAL_URL, '').replace(/^(\.\.?\/)+/, ''))
      .filter((path) => MENU_LINK.test(path));
    return hash([...new Set(links)].sort().join('\n'));
  }
  // The side menu repeats on every page; the page's own content starts after it.
  const start = clean.indexOf('class="default-heading2"');
  const body = start >= 0 ? clean.slice(start) : clean;
  const images = [...body.matchAll(/<img[^>]+src="([^"]+)"/g)].map((match) => match[1].split('/').pop() ?? '').filter((src) => !CHROME_IMAGE.test(`imagenes/${src}`));
  const text = body.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ');
  const end = text.indexOf('+511');
  return hash(`${images.join('|')}\n${(end >= 0 ? text.slice(0, end) : text).trim()}`);
}

export type AtuCheck = { checkedAt: number; changed: AtuPage[]; failed: number };

async function fetchPage(page: AtuPage, signal?: AbortSignal) {
  const response = await fetch(page.url, { signal });
  // Missing pages redirect to the gob.pe home page instead of failing.
  if (!response.ok || !response.url.startsWith(ATU_PORTAL_URL)) return null;
  return response.text();
}

// Asks every source page once, four at a time.
export async function checkAtuChanges(snapshot: Record<string, string>, signal?: AbortSignal): Promise<AtuCheck> {
  const changed: AtuPage[] = [];
  let failed = 0;
  const queue = [...ATU_PAGES];
  const worker = async () => {
    for (let page = queue.shift(); page; page = queue.shift()) {
      try {
        const html = await fetchPage(page, signal);
        if (html === null) {
          changed.push(page);
          continue;
        }
        if (pageFingerprint(page.url, html) !== snapshot[page.key]) changed.push(page);
      } catch (reason) {
        if (signal?.aborted) throw reason;
        failed += 1;
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  const order = new Map(ATU_PAGES.map((page, index) => [page.key, index]));
  changed.sort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0));
  return { checkedAt: Date.now(), changed, failed };
}
