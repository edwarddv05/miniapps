const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

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

const { ATU_PAGES, pageFingerprint } = load('atu-source');
const { ATU_SNAPSHOT } = load('atu-snapshot');
const { ATU_PORTAL_URL } = load('transport-data');

test('the snapshot covers every source page', () => {
  for (const page of ATU_PAGES) assert.match(ATU_SNAPSHOT[page.key] ?? '', /^[0-9a-f]{8}$/, page.key);
  assert.equal(new Set(ATU_PAGES.map((page) => page.key)).size, ATU_PAGES.length);
});

const page = (content) => `<ul><li><a href="../x">Menú</a></li></ul><h2 class="default-heading2">X</h2>${content}<p>+511 203 9000</p><p>José Gálvez 550</p>`;

test('a page fingerprint follows its schedule and route image, not the menu or footer', () => {
  const base = pageFingerprint('https://portal.atu.gob.pe/QR/x', page('<img src="../imagenes/A.png"><p>5:00 a. m. - 11:00 p. m.</p>'));
  assert.equal(pageFingerprint('https://portal.atu.gob.pe/QR/x', page('<img src="../imagenes/A.png"><p>5:00 a. m. -   11:00 p. m.</p><!-- nota -->')), base);
  assert.notEqual(pageFingerprint('https://portal.atu.gob.pe/QR/x', page('<img src="../imagenes/A.png"><p>5:00 a. m. - 10:00 p. m.</p>')), base);
  assert.notEqual(pageFingerprint('https://portal.atu.gob.pe/QR/x', page('<img src="../imagenes/A-2026.png"><p>5:00 a. m. - 11:00 p. m.</p>')), base);
  assert.equal(pageFingerprint('https://portal.atu.gob.pe/QR/x', page('<img src="../imagenes/NuevoImg.png"><img src="../imagenes/A.png"><p>5:00 a. m. - 11:00 p. m.</p>')), base);
});

test('the menu fingerprint follows Metropolitano links only, ignoring commented ones', () => {
  const menu = (links) => links.map((href) => `<a href="${href}">x</a>`).join('');
  const base = pageFingerprint(ATU_PORTAL_URL, menu(['Metropolitano/Servicios/X5.php', 'MetroLima/L1/']));
  assert.equal(pageFingerprint(ATU_PORTAL_URL, menu(['Metropolitano/Servicios/X5.php', 'MetroLima/L2/']) + '<!-- <a href="Metropolitano/Servicios/X4.php">x</a> -->'), base);
  assert.notEqual(pageFingerprint(ATU_PORTAL_URL, menu(['Metropolitano/Servicios/X5.php', 'Metropolitano/Servicios/X14.php'])), base);
});
