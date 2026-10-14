// Takes the fingerprints of the ATU pages the Metropolitano data came from
// and writes atu-snapshot.ts. Run it right after updating transport-data.ts,
// so the app's "Buscar cambios" compares against what the data reflects.
//
//   node scripts/atu-snapshot.cjs

const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.join(__dirname, '..');
const cache = {};
function load(name) {
  if (cache[name]) return cache[name];
  const source = fs.readFileSync(path.join(root, `${name}.ts`), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const moduleExports = {};
  cache[name] = moduleExports;
  new Function('exports', 'require', compiled)(moduleExports, (request) => load(request.replace('./', '')));
  return moduleExports;
}

async function main() {
  const { ATU_PAGES, pageFingerprint } = load('atu-source');
  const { TRANSPORT_DATA_CHECKED_ON } = load('transport-data');
  const fingerprints = {};
  for (const page of ATU_PAGES) {
    const response = await fetch(page.url);
    if (!response.ok) throw new Error(`${page.url}: ${response.status}`);
    fingerprints[page.key] = pageFingerprint(page.url, await response.text());
  }
  const body = Object.entries(fingerprints).map(([key, value]) => `  '${key}': '${value}',`).join('\n');
  fs.writeFileSync(
    path.join(root, 'atu-snapshot.ts'),
    `// Written by scripts/atu-snapshot.cjs; do not edit by hand.\n// Fingerprints of the ATU pages as of ${TRANSPORT_DATA_CHECKED_ON}.\n\nexport const ATU_SNAPSHOT: Record<string, string> = {\n${body}\n};\n`,
  );
  console.log(`${Object.keys(fingerprints).length} páginas → atu-snapshot.ts`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
