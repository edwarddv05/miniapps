// Downloads the Corredor Metropolitano pages of the ATU QR portal and writes
// their text content (headings, service tabs, schedules, stop lists, images)
// to a JSON file. The output is the raw source for transport-data.ts; stop
// order of trunk services only exists in the route images, so it is checked
// by hand against them.
//
//   node scripts/atu-crawl.mjs <out.json>

import { writeFile } from 'node:fs/promises';

const ROOT = 'https://portal.atu.gob.pe/QR/';
const CHROME_IMAGE = /imagenes\/(banda|ActulizadoImg|NuevoImg|ModificadoImg|icono-|FOOTER|footer)/i;

const decode = (s) =>
  s
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&aacute;/g, 'á').replace(/&eacute;/g, 'é').replace(/&iacute;/g, 'í')
    .replace(/&oacute;/g, 'ó').replace(/&uacute;/g, 'ú').replace(/&ntilde;/g, 'ñ')
    .replace(/&Aacute;/g, 'Á').replace(/&Eacute;/g, 'É').replace(/&Iacute;/g, 'Í')
    .replace(/&Oacute;/g, 'Ó').replace(/&Uacute;/g, 'Ú').replace(/&Ntilde;/g, 'Ñ')
    .replace(/&shy;|­/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

function textLines(html) {
  return decode(
    html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d|td|span)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

async function get(url) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url);
      // Missing pages redirect to the gob.pe home page instead of failing.
      if (!response.url.startsWith(ROOT)) return null;
      if (response.ok) return await response.text();
      if (response.status === 404) return null;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  throw new Error(`No se pudo descargar ${url}`);
}

function parsePage(url, html) {
  // The side menu repeats on every page; the content starts after it.
  const body = html.slice(Math.max(0, html.indexOf('class="default-heading2"')));
  const tabs = [...body.matchAll(/<a href="([^"#][^"]*)" class="[^"]*default-button[^"]*"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({
    label: textLines(m[2]).join(' '),
    url: new URL(m[1], url).href,
  }));
  const images = [...body.matchAll(/<img[^>]+src="([^"]+)"/g)]
    .map((m) => new URL(m[1], url).href)
    .filter((src) => !CHROME_IMAGE.test(src));
  const lines = textLines(body);
  const end = lines.findIndex((line) => line.startsWith('+511'));
  return { url, lines: end >= 0 ? lines.slice(0, end) : lines, tabs, images };
}

async function crawlPage(url, pages) {
  if (pages.has(url) || !url.startsWith(ROOT)) return;
  pages.set(url, null);
  const html = await get(url);
  if (!html) return;
  pages.set(url, parsePage(url, html));
}

async function main() {
  const out = process.argv[2];
  if (!out) throw new Error('Uso: node scripts/atu-crawl.mjs <salida.json>');
  const home = await get(ROOT);
  const menu = [...home.matchAll(/<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)]
    .map((m) => ({ url: new URL(m[1], ROOT).href, label: textLines(m[2]).join(' ') }))
    .filter((link) => /\/QR\/(Metropolitano|Alimentadores|Tarifarios\/Metropolitano|Cicloparqueaderos|CAT|Playero)/.test(link.url));

  const pages = new Map();
  for (const link of menu) await crawlPage(link.url, pages);
  // Service tabs inside station and service pages lead to per-direction pages.
  for (const page of [...pages.values()]) {
    for (const tab of page?.tabs ?? []) await crawlPage(tab.url, pages);
  }

  await writeFile(
    out,
    JSON.stringify({ fetchedAt: new Date().toISOString(), menu, pages: Object.fromEntries(pages) }, null, 1),
  );
  console.log(`${pages.size} páginas → ${out}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
