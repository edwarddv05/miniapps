import { transform } from 'sucrase';

// Miniapps written as .js files on the phone. Each file is transpiled on the
// device (JSX and import/export become plain calls), then run with the app's
// API as its only scope. The UI it returns is drawn by the app's SwiftUI views.

export type ScriptMeta = { title: string; icon: string; color: string | null; detail: string | null };

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

/** `export const meta = { title, icon, color, detail }`, with the file name as title when absent. */
export function readMeta(exports: ScriptModule | null, fileName: string): ScriptMeta {
  const meta = (exports?.meta && typeof exports.meta === 'object' ? exports.meta : {}) as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
  return {
    title: text(meta.title) ?? baseName(fileName),
    icon: text(meta.icon) ?? 'curlybraces',
    color: text(meta.color),
    detail: text(meta.detail),
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

const IMAGE_ID = /^img-[a-z0-9]+-[a-z0-9]+$/;

/** A new name for an image a miniapp keeps. Only names of this shape are ever read or deleted. */
export function newImageId(now = Date.now(), random = Math.random()) {
  return `img-${now.toString(36)}-${Math.floor(random * 36 ** 6).toString(36).padStart(6, '0')}`;
}

export function isImageId(value: unknown): value is string {
  return typeof value === 'string' && IMAGE_ID.test(value);
}

/** Longest side of a stored image and of its thumbnail, in pixels. */
export function imageSizes(width: number, height: number) {
  const fit = (limit: number) => {
    const scale = Math.min(1, limit / Math.max(width, height, 1));
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
  };
  return { full: fit(1600), thumb: fit(480) };
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

// Recordings, videos and files a miniapp keeps sit next to its images. The
// id carries the file's extension, so players and the share sheet know its type.
const MEDIA_ID = /^(aud|vid|fil)-[a-z0-9]+-[a-z0-9]+\.[a-z0-9]{1,5}$/;
export type MediaKind = 'aud' | 'vid' | 'fil';

export function newMediaId(kind: MediaKind, extension: string, now = Date.now(), random = Math.random()) {
  const ext = extension.replace(/^\./, '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'bin';
  return `${kind}-${now.toString(36)}-${Math.floor(random * 36 ** 6).toString(36).padStart(6, '0')}.${ext}`;
}

export function isMediaId(value: unknown): value is string {
  return typeof value === 'string' && MEDIA_ID.test(value);
}

/** The extension of a file name or URI, without the dot; empty when there is none. */
export function extensionOf(name: string) {
  const match = /\.([A-Za-z0-9]{1,5})(?:[?#].*)?$/.exec(name);
  return match ? match[1].toLowerCase() : '';
}

// Each stored value is its own entry, so changing one never rewrites the rest.
export const SCRIPT_KV_PREFIX = '@miniapps/script-kv/';

export function scriptKvPrefix(fileName: string) {
  return `${SCRIPT_KV_PREFIX}${fileName}/`;
}

/** Log lines a miniapp writes with console.*: one string per call, objects as JSON. */
export function formatLog(args: unknown[]) {
  return args.map((value) => {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return `${value.name}: ${value.message}`;
    if (value === undefined) return 'undefined';
    if (typeof value === 'function') return `[función ${value.name || 'anónima'}]`;
    try {
      const text = JSON.stringify(value, null, 2);
      return text === undefined ? String(value) : text;
    } catch {
      return String(value);
    }
  }).join(' ');
}

export type ScriptsBackup = {
  files: Array<{ name: string; source: string }>;
  data: Record<string, Record<string, unknown>>;
  media: Record<string, Record<string, string>>;
};

/** Checks the miniapps section of a backup; null when absent, throws when malformed. */
export function parseScriptsBackup(value: unknown): ScriptsBackup | null {
  if (value === undefined || value === null) return null;
  const section = value as Partial<ScriptsBackup>;
  const bad = () => new Error('Las miniapps del respaldo no son válidas.');
  if (!Array.isArray(section.files) || typeof section.data !== 'object' || section.data === null || typeof section.media !== 'object' || section.media === null) throw bad();
  const files = section.files.map((file) => {
    if (typeof file?.name !== 'string' || typeof file?.source !== 'string' || !isScriptFile(file.name) || scriptFileName(file.name) !== file.name) throw bad();
    return { name: file.name, source: file.source };
  });
  const names = new Set(files.map((file) => file.name));
  const data: ScriptsBackup['data'] = {};
  for (const [name, values] of Object.entries(section.data)) {
    if (!names.has(name) || typeof values !== 'object' || values === null || Array.isArray(values)) throw bad();
    data[name] = values as Record<string, unknown>;
  }
  const media: ScriptsBackup['media'] = {};
  for (const [name, items] of Object.entries(section.media)) {
    if (!names.has(name) || typeof items !== 'object' || items === null) throw bad();
    media[name] = {};
    for (const [file, base64] of Object.entries(items as Record<string, unknown>)) {
      const id = file.replace(/(\.thumb)?\.jpg$/, '');
      if ((!isImageId(id) && !isMediaId(file)) || typeof base64 !== 'string') throw bad();
      media[name][file] = base64;
    }
  }
  return { files, data, media };
}

// ─── Notifications ─────────────────────────────────────────────────────────

export type NotifyOptions = {
  title?: string;
  body?: string;
  at?: Date | number | string;
  seconds?: number;
  repeat?: boolean;
  daily?: { hour: number; minute?: number };
  weekly?: { weekday: number; hour: number; minute?: number };
};

export type NotifyTrigger =
  | null
  | { type: 'date'; date: number }
  | { type: 'timeInterval'; seconds: number; repeats: boolean }
  | { type: 'daily'; hour: number; minute: number }
  | { type: 'weekly'; weekday: number; hour: number; minute: number };

const whole = (value: unknown, min: number, max: number, what: string) => {
  const number = Number(value ?? 0);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${what} debe ser un entero de ${min} a ${max}.`);
  return number;
};

/**
 * When a notification fires: `at` a date, after `seconds`, `daily` at a time
 * or `weekly` on a weekday (1 = lunes … 7 = domingo). Nothing means now.
 * Weekdays are turned into iOS's own numbering, where 1 is Sunday.
 */
export function notificationTrigger(options: NotifyOptions, now = Date.now()): NotifyTrigger {
  if (options.at !== undefined) {
    const date = options.at instanceof Date ? options.at.getTime() : typeof options.at === 'number' ? options.at : Date.parse(options.at);
    if (!Number.isFinite(date)) throw new Error('La fecha del aviso no es válida.');
    if (date <= now) throw new Error('La fecha del aviso ya pasó.');
    return { type: 'date', date };
  }
  if (options.seconds !== undefined) {
    const seconds = Number(options.seconds);
    const repeats = options.repeat === true;
    if (!Number.isFinite(seconds) || seconds < (repeats ? 60 : 1)) throw new Error(repeats ? 'Un aviso que se repite necesita al menos 60 segundos.' : 'seconds debe ser 1 o más.');
    return { type: 'timeInterval', seconds: Math.round(seconds), repeats };
  }
  if (options.daily) return { type: 'daily', hour: whole(options.daily.hour, 0, 23, 'hour'), minute: whole(options.daily.minute, 0, 59, 'minute') };
  if (options.weekly) {
    const weekday = whole(options.weekly.weekday, 1, 7, 'weekday');
    return { type: 'weekly', weekday: (weekday % 7) + 1, hour: whole(options.weekly.hour, 0, 23, 'hour'), minute: whole(options.weekly.minute, 0, 59, 'minute') };
  }
  return null;
}

// ─── Links ─────────────────────────────────────────────────────────────────

/**
 * The miniapp a link opens: miniapps://abrir/Notas?nota=3, or the same path
 * after "/--/" in an Expo Go link. Null for any other link.
 */
export function parseMiniappLink(url: string): { name: string; params: Record<string, string> } | null {
  const match = /^(?:miniapps:\/\/|[a-z][a-z0-9+.-]*:\/\/[^/]*\/--\/)abrir\/([^?#]+)(?:\?([^#]*))?/i.exec(url.trim());
  if (!match) return null;
  let name: string;
  try {
    name = decodeURIComponent(match[1].replace(/\+/g, ' ')).replace(/\/+$/, '').trim();
  } catch {
    return null;
  }
  if (!name) return null;
  const params: Record<string, string> = {};
  for (const pair of (match[2] ?? '').split('&')) {
    if (!pair) continue;
    const [key, value = ''] = pair.split('=');
    try {
      params[decodeURIComponent(key.replace(/\+/g, ' '))] = decodeURIComponent(value.replace(/\+/g, ' '));
    } catch {
      // A badly encoded parameter is skipped.
    }
  }
  return { name, params };
}

/** The file a name refers to: the exact file name, or the name without .js/.jsx, ignoring case. */
export function findScriptFile(name: string, files: string[]) {
  const wanted = name.trim().toLowerCase();
  return files.find((file) => file.toLowerCase() === wanted) ?? files.find((file) => baseName(file).toLowerCase() === wanted) ?? null;
}

// ─── Places ────────────────────────────────────────────────────────────────

export type Point = { latitude: number; longitude: number };

/** Distance in metres between two points, along the Earth's surface. */
export function distanceMeters(a: Point, b: Point) {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}
