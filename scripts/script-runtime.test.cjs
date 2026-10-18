const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLoader } = require('./load-ts.cjs');

const runtime = createLoader({ sucrase: require('sucrase'), 'sucrase/dist/parser': require('sucrase/dist/parser'), 'sucrase/dist/parser/tokenizer/types': require('sucrase/dist/parser/tokenizer/types') })('script-runtime');

// JSX becomes plain objects, so a file's output can be compared without React.
const h = (type, props, ...children) => ({ type, props: props ?? {}, children });
const scope = (extra = {}) => ({ h, Fragment: 'Fragment', Text: 'Text', VStack: 'VStack', Row: 'Row', useStored: (key, initial) => [initial, () => {}], ...extra });
const run = (source, extra) => runtime.evaluateScript(runtime.compileScript(source), scope(extra), { superapp: scope(extra) });

test('a JSX file runs with the app scope and exports its component and meta', () => {
  const exports = run(`
    export const meta = { title: 'Contador', icon: 'plus.circle' };
    export default function App() {
      return <VStack spacing={8}><Text>{1 + 1}</Text></VStack>;
    }
  `);
  const App = runtime.scriptComponent(exports);
  assert.deepEqual(App({}), { type: 'VStack', props: { spacing: 8 }, children: [{ type: 'Text', props: {}, children: [2] }] });
  assert.equal(runtime.readMeta(exports, 'contador.js').title, 'Contador');
});

test('a file may declare its own names that the scope also has', () => {
  const exports = run(`
    const Row = ({ label }) => <Text>{label}</Text>;
    export default function App() { return <Row label="a" />; }
  `);
  const element = runtime.scriptComponent(exports)({});
  assert.equal(typeof element.type, 'function');
});

test('imports from superapp resolve, other modules are refused', () => {
  const exports = run(`import { Text } from 'superapp'; export default () => <Text />;`);
  assert.equal(runtime.scriptComponent(exports)({}).type, 'Text');
  assert.throws(() => run(`import fs from 'fs'; export default () => null;`), (error) => error.name === 'ScriptError' && /fs/.test(error.message));
});

test('a syntax error reports its line', () => {
  assert.throws(() => runtime.compileScript('const a = 1;\nconst b = ;\n'), (error) => error.name === 'ScriptError' && error.line === 2);
});

test('a file without a default function is refused', () => {
  assert.throws(() => runtime.scriptComponent(run('export const x = 1;')), /export default function/);
});

test('an error thrown while the file loads becomes a ScriptError', () => {
  assert.throws(() => run('throw new Error("boom");'), (error) => error.name === 'ScriptError' && error.message === 'boom');
});

test('keyboard punctuation is fixed only when it breaks the code', () => {
  const broken = 'const s = “hola”;\nlet i = 2; i—;\nexport default () => s;';
  const checked = runtime.checkScript(broken);
  assert.equal(checked.fixed, 'const s = "hola";\nlet i = 2; i--;\nexport default () => s;');
  const fine = 'export default () => "Dijo “hola”";';
  assert.equal(runtime.checkScript(fine).fixed, null);
});

test('meta is read from the text without running the file', () => {
  const source = `globalThis.ran = true;\nexport const meta = { title: 'Gastos {mes}', color: "orange", icon: 'cart' };\nexport default () => null;`;
  assert.deepEqual(runtime.staticMeta(source, 'gastos.js'), { title: 'Gastos {mes}', icon: 'cart', color: 'orange', detail: null });
  assert.equal(globalThis.ran, undefined);
  const withCall = `export const meta = { title: (globalThis.ran = 'x') };`;
  assert.equal(runtime.staticMeta(withCall, 'otra.jsx').title, 'otra');
  assert.equal(globalThis.ran, undefined);
  assert.equal(runtime.staticMeta('export default () => null;', 'sin-meta.js').icon, 'curlybraces');
});

test('file names are cleaned and kept unique', () => {
  assert.equal(runtime.scriptFileName(' Mis/gastos: '), 'Misgastos.js');
  assert.equal(runtime.scriptFileName('vista.JSX'), 'vista.jsx');
  assert.equal(runtime.scriptFileName('../'), null);
  assert.equal(runtime.uniqueScriptName('a.js', ['A.js', 'a 2.js']), 'a 3.js');
  assert.equal(runtime.isScriptFile('notas.txt'), false);
  assert.equal(runtime.isScriptFile('.oculto.js'), false);
});

test('stored data survives corrupt or wrong-shaped values', () => {
  assert.deepEqual(runtime.parseScriptData('{"count":3}'), { count: 3 });
  assert.deepEqual(runtime.parseScriptData('{broken'), {});
  assert.deepEqual(runtime.parseScriptData('[1,2]'), {});
  assert.deepEqual(runtime.parseScriptData(null), {});
});

test('the new-file template compiles and runs', () => {
  const exports = run(runtime.NEW_SCRIPT, { HStack: 'HStack', IconButton: 'IconButton' });
  assert.equal(runtime.scriptComponent(exports)({}).type, 'VStack');
  assert.equal(runtime.staticMeta(runtime.NEW_SCRIPT, 'Nueva.js').title, 'Nueva');
});

test('image names have one shape, and only that shape is accepted', () => {
  const id = runtime.newImageId(1_760_000_000_000, 0.5);
  assert.equal(runtime.isImageId(id), true);
  assert.equal(runtime.isImageId('../notas.js'), false);
  assert.equal(runtime.isImageId('img-x/../../y'), false);
  assert.equal(runtime.isImageId(42), false);
});

test('stored images keep their shape within 1600 px, thumbnails within 480 px', () => {
  assert.deepEqual(runtime.imageSizes(4032, 3024), { full: { width: 1600, height: 1200 }, thumb: { width: 480, height: 360 } });
  assert.deepEqual(runtime.imageSizes(800, 1200), { full: { width: 800, height: 1200 }, thumb: { width: 320, height: 480 } });
});

test('notification triggers cover a date, a delay, daily and weekly times', () => {
  const now = Date.parse('2026-10-18T10:00:00Z');
  assert.equal(runtime.notificationTrigger({}, now), null);
  assert.deepEqual(runtime.notificationTrigger({ at: '2026-10-18T11:00:00Z' }, now), { type: 'date', date: now + 3600000 });
  assert.throws(() => runtime.notificationTrigger({ at: now - 1 }, now), /ya pasó/);
  assert.throws(() => runtime.notificationTrigger({ at: 'mañana' }, now), /no es válida/);
  assert.deepEqual(runtime.notificationTrigger({ seconds: 90.4 }, now), { type: 'timeInterval', seconds: 90, repeats: false });
  assert.throws(() => runtime.notificationTrigger({ seconds: 30, repeat: true }, now), /60 segundos/);
  assert.deepEqual(runtime.notificationTrigger({ daily: { hour: 7 } }, now), { type: 'daily', hour: 7, minute: 0 });
  assert.throws(() => runtime.notificationTrigger({ daily: { hour: 24 } }, now), /hour/);
  // lunes = 1 is iOS's 2; domingo = 7 is iOS's 1.
  assert.equal(runtime.notificationTrigger({ weekly: { weekday: 1, hour: 8 } }, now).weekday, 2);
  assert.equal(runtime.notificationTrigger({ weekly: { weekday: 7, hour: 8 } }, now).weekday, 1);
});

test('miniapp links name a file and carry their query', () => {
  assert.deepEqual(runtime.parseMiniappLink('miniapps://abrir/Notas'), { name: 'Notas', params: {} });
  assert.deepEqual(runtime.parseMiniappLink('miniapps://abrir/Mis%20notas?nota=3&modo=ver+todo'), { name: 'Mis notas', params: { nota: '3', modo: 'ver todo' } });
  assert.deepEqual(runtime.parseMiniappLink('exp://192.168.1.4:8081/--/abrir/Notas.jsx/'), { name: 'Notas.jsx', params: {} });
  assert.equal(runtime.parseMiniappLink('miniapps://otra/Notas'), null);
  assert.equal(runtime.parseMiniappLink('https://example.com/abrir/Notas'), null);
  const files = ['Notas.jsx', 'notas.js', 'Gastos.js'];
  assert.equal(runtime.findScriptFile('notas.js', files), 'notas.js');
  assert.equal(runtime.findScriptFile('GASTOS', files), 'Gastos.js');
  assert.equal(runtime.findScriptFile('Otra', files), null);
});

test('media ids keep their extension and are told apart from other strings', () => {
  const id = runtime.newMediaId('aud', '.M4A', 1000, 0.5);
  assert.match(id, /^aud-rs-[a-z0-9]{6}\.m4a$/);
  assert.ok(runtime.isMediaId(id));
  assert.ok(!runtime.isMediaId('aud-x-y.toolong'));
  assert.ok(!runtime.isMediaId('../secret.txt'));
  assert.equal(runtime.newMediaId('fil', '', 1, 0).endsWith('.bin'), true);
  assert.equal(runtime.extensionOf('file:///a/b/Clip.MOV?x=1'), 'mov');
  assert.equal(runtime.extensionOf('sin-extension'), '');
});

test('log lines join their arguments and show objects as JSON', () => {
  assert.equal(runtime.formatLog(['total', 3, { a: 1 }]), 'total 3 {\n  "a": 1\n}');
  assert.equal(runtime.formatLog([new TypeError('mal'), undefined]), 'TypeError: mal undefined');
  const loop = {};
  loop.self = loop;
  assert.equal(runtime.formatLog([loop]), '[object Object]');
});

test('the miniapps section of a backup is checked before it is used', () => {
  assert.equal(runtime.parseScriptsBackup(undefined), null);
  const good = { files: [{ name: 'Notas.jsx', source: 'x' }], data: { 'Notas.jsx': { notes: [] } }, media: { 'Notas.jsx': { 'img-a-000001.jpg': 'AA==', 'img-a-000001.thumb.jpg': 'AA==', 'aud-a-000001.m4a': 'AA==' } } };
  assert.deepEqual(runtime.parseScriptsBackup(good), good);
  assert.throws(() => runtime.parseScriptsBackup({ ...good, files: [{ name: '../x.js', source: '' }] }), /no son válidas/);
  assert.throws(() => runtime.parseScriptsBackup({ ...good, data: { 'Otra.js': {} } }), /no son válidas/);
  assert.throws(() => runtime.parseScriptsBackup({ ...good, media: { 'Notas.jsx': { '../../evil': 'AA==' } } }), /no son válidas/);
});

test('distances follow the Earth surface', () => {
  const lima = { latitude: -12.0464, longitude: -77.0428 };
  const callao = { latitude: -12.0566, longitude: -77.1181 };
  const meters = runtime.distanceMeters(lima, callao);
  assert.ok(meters > 8000 && meters < 8400, String(meters));
  assert.equal(runtime.distanceMeters(lima, lima), 0);
});

test('loops get a guard on their own line, outside strings and regexes', () => {
  const code = runtime.compileScript('let i = 0;\nwhile (i < 3) i++;\nfor (let j = 0; j < 2; j++) { for (;;) break; }\ndo { i-- } while (i > 0)\nfor (const x of [1]) {}\nconst s = `for (;;) ${i}`;\nconst re = /while (x)/;');
  assert.match(code, /while \(__superappLoop\(2\) && \(i < 3\)\)/);
  assert.match(code, /for \(let j = 0; __superappLoop\(3\) && \(j < 2\); j\+\+\)/);
  assert.match(code, /for \(; __superappLoop\(3\);\)/);
  assert.match(code, /while \(__superappLoop\(4\) && \(i > 0\)\)/);
  assert.match(code, /for \(const x of \[1\]\)/);
  assert.match(code, /`for \(;;\) \$\{i\}`/);
  assert.match(code, /\/while \(x\)\//);
  assert.equal(code.split('\n').length, 7);
});

test('a runaway loop is stopped with its line, and the clock restarts on the next turn', () => {
  let clock = 0;
  let turn = null;
  const guard = runtime.createLoopGuard({ limitMs: 3000, now: () => clock, defer: (fn) => { turn = fn; } });
  const run = () => {
    for (let index = 0; index < 1024 * 5; index++) {
      clock += 1;
      guard(12);
    }
  };
  assert.throws(run, (error) => error.line === 12 && /3 s/.test(error.message));
  turn();
  clock = 0;
  const quick = runtime.createLoopGuard({ limitMs: 3000, now: () => 0, defer: () => {} });
  for (let index = 0; index < 50000; index++) quick(1);
  assert.equal(runtime.evaluateScript(runtime.compileScript('let n = 0; while (n < 5000) n++; export const total = n;'), { __superappLoop: quick }).total, 5000);
});

test('TypeScript files compile with their types removed', () => {
  const exports = runtime.evaluateScript(runtime.checkScript('type Item = { id: number };\nconst items: Item[] = [{ id: 2 }];\nexport const total = items.reduce((sum: number, item) => sum + item.id, 0);', 'Gastos.tsx').code, {});
  assert.equal(exports.total, 2);
  assert.equal(runtime.isTypeScriptFile('Gastos.ts'), true);
  assert.equal(runtime.scriptFileName('Gastos.TSX'), 'Gastos.tsx');
  assert.equal(runtime.baseName('Gastos.ts'), 'Gastos');
  assert.equal(runtime.isScriptFile('a.tsx'), true);
});

test('imports of other files and packages run once, in the miniapp scope or bare', () => {
  const table = {
    'local:_fechas.js': { code: runtime.compileScript("export const hoy = () => saludo + ' ' + require('./_x').x;"), scoped: true, requests: { './_x': 'local:_x.js' } },
    'local:_x.js': { code: runtime.compileScript('export const x = typeof saludo;'), scoped: false, requests: {} },
  };
  const main = runtime.compileScript("import { hoy } from './_fechas';\nimport { hoy as otra } from './_fechas';\nexport const text = hoy();\nexport const same = hoy === otra;");
  assert.deepEqual(runtime.moduleRequests(main), ['./_fechas']);
  const exports = runtime.evaluateScript(main, { saludo: 'hola' }, {}, table, { './_fechas': 'local:_fechas.js' });
  assert.equal(exports.text, 'hola undefined');
  assert.equal(exports.same, true);
  assert.throws(() => runtime.evaluateScript(runtime.compileScript("import x from './_nada';"), {}), /no está disponible/);
});

test('import paths resolve to files and package URLs', () => {
  const files = ['_fechas.js', 'Notas.jsx', '_util.ts'];
  assert.equal(runtime.resolveLocalModule('./_fechas', files), '_fechas.js');
  assert.equal(runtime.resolveLocalModule('./_util.ts', files), '_util.ts');
  assert.equal(runtime.resolveLocalModule('../_fechas', files), null);
  assert.equal(runtime.resolveLocalModule('./sub/_fechas', files), null);
  assert.equal(runtime.packageUrl('dayjs', null), 'https://esm.sh/dayjs?bundle&target=es2015');
  assert.equal(runtime.packageUrl('npm:dayjs@1.11/plugin/utc', null), 'https://esm.sh/dayjs@1.11/plugin/utc?bundle&target=es2015');
  assert.equal(runtime.packageUrl('/dayjs@1.11.23/es2015/dayjs.mjs', 'https://esm.sh/dayjs?bundle'), 'https://esm.sh/dayjs@1.11.23/es2015/dayjs.mjs');
  assert.equal(runtime.packageUrl('./b.mjs', 'https://cdn.jsdelivr.net/npm/x@1/dist/a.mjs'), 'https://cdn.jsdelivr.net/npm/x@1/dist/b.mjs');
  assert.equal(runtime.packageUrl('../c.mjs', 'https://cdn.jsdelivr.net/npm/x@1/dist/a.mjs'), 'https://cdn.jsdelivr.net/npm/x@1/c.mjs');
  assert.equal(runtime.packageUrl('no válido!', null), null);
  assert.equal(runtime.packageFallbackUrl('marked'), 'https://cdn.jsdelivr.net/npm/marked/+esm');
  assert.equal(runtime.packageFallbackUrl('/marked@1/x.mjs'), null);
  assert.equal(runtime.isModuleFile('_fechas.js'), true);
  assert.equal(runtime.isModuleFile('Notas.jsx'), false);
});

test('strokes become SVG paths', () => {
  assert.equal(runtime.strokePath([]), '');
  assert.equal(runtime.strokePath([[1, 2]]), 'M1 2l0.01 0');
  assert.equal(runtime.strokePath([[1, 2], [3, 4.5]]), 'M1 2L3 4.5');
});

test('backup files with videos carry their JSON behind a header', () => {
  const text = 'Año 🎬 ñ';
  const bytes = runtime.utf8Encode(text);
  assert.deepEqual([...bytes], [...Buffer.from(text, 'utf8')]);
  assert.equal(runtime.utf8Decode(bytes), text);
  const header = runtime.utf8Encode(runtime.backupHeader(1234) + '{');
  assert.deepEqual(runtime.readBackupHeader(header), { jsonStart: header.length - 1, jsonLength: 1234 });
  assert.equal(runtime.readBackupHeader(runtime.utf8Encode('{"format":1}')), null);
  assert.throws(() => runtime.readBackupHeader(runtime.utf8Encode('MYSUPERAPP-BACKUP\nxx\n')), /dañado/);
  const good = { files: [{ name: 'Cine.js', source: '' }], data: {}, media: {}, videos: [{ name: 'Cine.js', file: 'vid-a-000001.mov', size: 10 }] };
  assert.deepEqual(runtime.parseScriptsBackup(good).videos, good.videos);
  assert.throws(() => runtime.parseScriptsBackup({ ...good, videos: [{ name: 'Cine.js', file: 'aud-a-000001.m4a', size: 1 }] }), /no son válidas/);
  assert.throws(() => runtime.parseScriptsBackup({ ...good, videos: [{ name: 'Otra.js', file: 'vid-a-000001.mov', size: 1 }] }), /no son válidas/);
});
