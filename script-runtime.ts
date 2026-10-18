import { transform } from 'sucrase';

// Miniapps written as .js files on the phone. Each file is transpiled on the
// device (JSX and import/export become plain calls), then run with the app's
// API as its only scope. The UI it returns is drawn by the app's SwiftUI views.

export type ScriptMeta = { title: string; icon: string; color: string | null; detail: string | null; closeButton: boolean };

export class ScriptError extends Error {
  line: number | null;
  constructor(message: string, line: number | null = null) {
    super(message);
    this.name = 'ScriptError';
    this.line = line;
  }
}

export const SCRIPT_EXTENSIONS = ['.js', '.jsx'];
export const SCRIPT_DATA_PREFIX = '@miniapps/script-data/';
const MAX_NAME = 60;

export function isScriptFile(name: string) {
  const lower = name.toLowerCase();
  return SCRIPT_EXTENSIONS.some((ext) => lower.endsWith(ext)) && !name.startsWith('.');
}

export function baseName(name: string) {
  return name.replace(/\.(jsx?)$/i, '');
}

/** A safe file name from what the owner typed: no folders, always .js or .jsx. */
export function scriptFileName(input: string) {
  const trimmed = input.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/^\.+/, '').trim();
  if (!trimmed) return null;
  const extension = /\.jsx$/i.test(trimmed) ? '.jsx' : '.js';
  const base = baseName(trimmed).slice(0, MAX_NAME).trim();
  return base ? `${base}${extension}` : null;
}

/** `name` if free, otherwise "name 2", "name 3"… compared without case, as the iOS file system does. */
export function uniqueScriptName(name: string, existing: string[]) {
  const taken = new Set(existing.map((item) => item.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  const extension = name.slice(baseName(name).length);
  for (let index = 2; ; index++) {
    const candidate = `${baseName(name)} ${index}${extension}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

function errorLine(error: unknown): number | null {
  const loc = (error as { loc?: { line?: unknown } })?.loc;
  if (typeof loc?.line === 'number') return loc.line;
  // Sucrase ends its messages with "(line:column)"; Hermes starts with "line:column:".
  const message = error instanceof Error ? error.message : '';
  const match = /\((\d+):\d+\)\s*$/.exec(message) ?? /^(\d+):\d+:/.exec(message);
  return match ? Number(match[1]) : null;
}

/** JSX and modules to plain JavaScript. Line numbers are kept, so errors point at the file. */
export function compileScript(source: string) {
  let code: string;
  try {
    code = transform(source, {
      transforms: ['jsx', 'imports'],
      jsxPragma: 'h',
      jsxFragmentPragma: 'Fragment',
      production: true,
    }).code;
  } catch (error) {
    const message = error instanceof Error ? error.message.replace(/\s*\(\d+:\d+\)\s*$/, '') : String(error);
    throw new ScriptError(message, errorLine(error));
  }
  // Sucrase only rewrites JSX and modules; the engine's own parser catches the
  // rest (a stray quote, a missing bracket) without running anything.
  try {
    new Function('exports', 'module', 'require', code);
  } catch (error) {
    throw new ScriptError(error instanceof Error ? error.message.replace(/^\d+:\d+:\s*/, '') : String(error), errorLine(error));
  }
  return code;
}

// The iOS keyboard turns quotes into curly ones, "--" into a dash and "..."
// into an ellipsis, which breaks code.
export function plainPunctuation(source: string) {
  return source.replace(/[“”„]/g, '"').replace(/[‘’‚]/g, "'").replace(/—/g, '--').replace(/…/g, '...');
}

/** Compiles `source`; if only the keyboard's punctuation breaks it, the plain version is returned as `fixed`. */
export function checkScript(source: string): { code: string; fixed: string | null } {
  try {
    return { code: compileScript(source), fixed: null };
  } catch (error) {
    const plain = plainPunctuation(source);
    if (plain === source) throw error;
    try {
      return { code: compileScript(plain), fixed: plain };
    } catch {
      throw error;
    }
  }
}

export type ScriptModule = { default?: unknown; meta?: unknown; [key: string]: unknown };

/** Runs compiled code with `scope` as its globals. `require` serves only the modules the app offers. */
export function evaluateScript(code: string, scope: Record<string, unknown>, modules: Record<string, unknown> = {}): ScriptModule {
  const names = Object.keys(scope);
  const module = { exports: {} as ScriptModule };
  const require = (request: string) => {
    if (request in modules) return modules[request];
    throw new ScriptError(`El módulo "${request}" no está disponible.`);
  };
  let run: (...args: unknown[]) => void;
  try {
    // The code runs in an inner function, on the same first line, so its own
    // declarations may reuse a scope name (a local Row) and lines still match.
    run = new Function(...names, 'exports', 'module', 'require', `(function () {${code}\n})();`) as typeof run;
  } catch (error) {
    throw new ScriptError(error instanceof Error ? error.message : String(error), errorLine(error));
  }
  try {
    run(...names.map((name) => scope[name]), module.exports, module, require);
  } catch (error) {
    if (error instanceof ScriptError) throw error;
    throw new ScriptError(error instanceof Error ? error.message : String(error));
  }
  return module.exports;
}

export function scriptComponent(exports: ScriptModule) {
  if (typeof exports.default !== 'function') throw new ScriptError('El archivo no tiene "export default function".');
  return exports.default as (props: Record<string, never>) => unknown;
}

/** `export const meta = { title, icon, color, detail, closeButton }`, with the file name as title when absent. */
export function readMeta(exports: ScriptModule | null, fileName: string): ScriptMeta {
  const meta = (exports?.meta && typeof exports.meta === 'object' ? exports.meta : {}) as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
  return {
    title: text(meta.title) ?? baseName(fileName),
    icon: text(meta.icon) ?? 'curlybraces',
    color: text(meta.color),
    detail: text(meta.detail),
    // The app's close button floats over the miniapp unless it brings its own (it then calls close()).
    closeButton: meta.closeButton !== false,
  };
}

// The object literal after `export const meta =`, found without running the
// file, so listing miniapps never runs their code.
function metaLiteral(source: string) {
  const start = /export\s+const\s+meta\s*=\s*\{/.exec(source);
  if (!start) return null;
  const open = start.index + start[0].length - 1;
  let depth = 0;
  let quote: string | null = null;
  for (let index = open; index < source.length; index++) {
    const char = source[index];
    if (quote) {
      if (char === '\\') index++;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') quote = char;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return source.slice(open, index + 1);
  }
  return null;
}

/** The miniapp's meta read from its source text. Anything but plain values falls back to defaults. */
export function staticMeta(source: string, fileName: string): ScriptMeta {
  const literal = metaLiteral(plainPunctuation(source));
  let meta: unknown = null;
  // Only plain values: with calls and template tags ruled out, nothing in it can run.
  if (literal && !/[()`]/.test(literal.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, ''))) {
    try {
      meta = new Function(`return (${literal});`)();
    } catch {
      meta = null;
    }
  }
  return readMeta({ meta }, fileName);
}

export function scriptDataKey(fileName: string) {
  return `${SCRIPT_DATA_PREFIX}${fileName}`;
}

/** A miniapp's stored values: a JSON object, or empty when missing or unreadable. */
export function parseScriptData(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export const NEW_SCRIPT = `export const meta = { title: 'Nueva', icon: 'sparkles', color: 'indigo' };

export default function App() {
  const [count, setCount] = useStored('count', 0);

  return (
    <VStack spacing={24} maxWidth={Infinity} maxHeight={Infinity}>
      <Text style="largeTitle" weight="bold" mono>{count}</Text>
      <HStack spacing={12}>
        <IconButton icon="minus" label="Restar" onPress={() => setCount(count - 1)} />
        <IconButton icon="plus" label="Sumar" prominent onPress={() => setCount(count + 1)} />
      </HStack>
    </VStack>
  );
}
`;
