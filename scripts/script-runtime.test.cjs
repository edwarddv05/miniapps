const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLoader } = require('./load-ts.cjs');

const runtime = createLoader({ sucrase: require('sucrase') })('script-runtime');

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
