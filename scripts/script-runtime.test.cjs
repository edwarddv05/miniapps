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
