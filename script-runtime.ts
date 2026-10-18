import { transform } from 'sucrase';
import { parse } from 'sucrase/dist/parser';
import { TokenType as tt } from 'sucrase/dist/parser/tokenizer/types';

// Miniapps written as .js, .jsx, .ts or .tsx files on the phone. Each file is
// transpiled on the device (JSX, types and import/export become plain calls),
// then run with the app's API as its only scope. The UI it returns is drawn by
// the app's SwiftUI views.

export type ScriptMeta = { title: string; icon: string; color: string | null; detail: string | null };

export class ScriptError extends Error {
  line: number | null;
  constructor(message: string, line: number | null = null) {
    super(message);
    this.name = 'ScriptError';
    this.line = line;
  }
}

export const SCRIPT_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx'];
export const SCRIPT_DATA_PREFIX = '@miniapps/script-data/';
const MAX_NAME = 60;

export function isScriptFile(name: string) {
  const lower = name.toLowerCase();
  return SCRIPT_EXTENSIONS.some((ext) => lower.endsWith(ext)) && !name.startsWith('.');
}

export function baseName(name: string) {
  return name.replace(/\.([jt]sx?)$/i, '');
}

export function isTypeScriptFile(name: string) {
  return /\.tsx?$/i.test(name);
}

// Files whose name starts with "_" are modules: other files import them, and
// Biblioteca opens them in the editor instead of running them.
export function isModuleFile(name: string) {
  return name.startsWith('_');
}

/** A safe file name from what the owner typed: no folders, always .js, .jsx, .ts or .tsx. */
export function scriptFileName(input: string) {
  const trimmed = input.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/^\.+/, '').trim();
  if (!trimmed) return null;
  const extension = (/\.[jt]sx?$/i.exec(trimmed)?.[0] ?? '.js').toLowerCase();
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

/**
 * JSX, types and modules to plain JavaScript. Line numbers are kept, so errors
 * point at the file. Loops get a guard that stops one running away (`guard`
 * is off for downloaded packages).
 */
export function compileScript(source: string, options: { typescript?: boolean; guard?: boolean } = {}) {
  let code: string;
  try {
    code = transform(source, {
      transforms: options.typescript ? ['jsx', 'imports', 'typescript'] : ['jsx', 'imports'],
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
  if (options.guard === false) return code;
  try {
    return guardLoops(code);
  } catch {
    // Code the engine accepts but the tokenizer does not runs unguarded.
    return code;
  }
}

// ─── Runaway loops ─────────────────────────────────────────────────────────

export const LOOP_GUARD = '__superappLoop';

/**
 * Puts a call to the loop guard in the condition of every while, do…while and
 * three-part for loop, with the loop's line. Nothing is added on new lines, so
 * line numbers still match the file. for…of and for…in end on their own.
 */
export function guardLoops(code: string) {
  const { tokens } = parse(code, false, false, false);
  const lineStarts = [0];
  for (let index = 0; index < code.length; index++) if (code[index] === '\n') lineStarts.push(index + 1);
  const lineAt = (position: number) => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (lineStarts[middle] <= position) low = middle;
      else high = middle - 1;
    }
    return low + 1;
  };
  const opens = new Set([tt.parenL, tt.bracketL, tt.braceL, tt.dollarBraceL]);
  const closes = new Set([tt.parenR, tt.bracketR, tt.braceR]);
  const matching = (open: number) => {
    let depth = 0;
    for (let index = open; index < tokens.length; index++) {
      if (opens.has(tokens[index].type)) depth++;
      else if (closes.has(tokens[index].type) && --depth === 0) return index;
    }
    return -1;
  };
  const edits: Array<[number, string]> = [];
  for (let index = 0; index < tokens.length - 1; index++) {
    const kind = tokens[index].type;
    if ((kind !== tt._while && kind !== tt._for) || tokens[index + 1].type !== tt.parenL) continue;
    const end = matching(index + 1);
    if (end < 0) continue;
    const call = `${LOOP_GUARD}(${lineAt(tokens[index].start)})`;
    if (kind === tt._while) {
      edits.push([tokens[index + 1].end, `${call} && (`], [tokens[end].start, ')']);
      continue;
    }
    const semis: number[] = [];
    let depth = 0;
    for (let inner = index + 1; inner <= end; inner++) {
      const type = tokens[inner].type;
      if (opens.has(type)) depth++;
      else if (closes.has(type)) depth--;
      else if (type === tt.semi && depth === 1) semis.push(inner);
    }
    if (semis.length !== 2) continue;
    const [first, second] = semis;
    if (second === first + 1) edits.push([tokens[first].end, ` ${call}`]);
    else edits.push([tokens[first + 1].start, `${call} && (`], [tokens[second].start, ')']);
  }
  edits.sort((a, b) => b[0] - a[0]);
  let result = code;
  for (const [position, text] of edits) result = result.slice(0, position) + text + result.slice(position);
  return result;
}

/**
 * The guard the compiled loops call. A loop that keeps the app busy longer
 * than `limitMs` without letting it draw is stopped with an error on its line.
 * The clock restarts each time the app gets a turn (`defer` runs then).
 */
export function createLoopGuard({ limitMs = 3000, now = Date.now, defer = (fn: () => void) => { globalThis.setTimeout(fn, 0); } }: { limitMs?: number; now?: () => number; defer?: (fn: () => void) => void } = {}) {
  let armed = false;
  let start = 0;
  let count = 0;
  return (line: number) => {
    if (!armed) {
      armed = true;
      start = now();
      count = 0;
      defer(() => {
        armed = false;
      });
    }
    if ((++count & 1023) === 0 && now() - start > limitMs) {
      throw new ScriptError(`Un bucle siguió más de ${Math.round(limitMs / 1000)} s sin terminar y se detuvo.`, line);
    }
    return true;
  };
}

// The iOS keyboard turns quotes into curly ones, "--" into a dash and "..."
// into an ellipsis, which breaks code.
export function plainPunctuation(source: string) {
  return source.replace(/[“”„]/g, '"').replace(/[‘’‚]/g, "'").replace(/—/g, '--').replace(/…/g, '...');
}

/** Compiles `source`; if only the keyboard's punctuation breaks it, the plain version is returned as `fixed`. */
export function checkScript(source: string, fileName = ''): { code: string; fixed: string | null } {
  const options = { typescript: isTypeScriptFile(fileName) };
  try {
    return { code: compileScript(source, options), fixed: null };
  } catch (error) {
    const plain = plainPunctuation(source);
    if (plain === source) throw error;
    try {
      return { code: compileScript(plain, options), fixed: plain };
    } catch {
      throw error;
    }
  }
}

export type ScriptModule = { default?: unknown; meta?: unknown; [key: string]: unknown };

/**
 * Compiled modules a file imports, by id: its code, whether it runs with the
 * miniapp's scope (the owner's files) or bare (downloaded packages), and the
 * id each of its import paths points to.
 */
export type ModuleTable = Record<string, { code: string; scoped: boolean; requests: Record<string, string> }>;

/**
 * Runs compiled code with `scope` as its globals. `require` serves the modules
 * the app offers, then the files and packages in `table` (each run once).
 */
export function evaluateScript(code: string, scope: Record<string, unknown>, modules: Record<string, unknown> = {}, table: ModuleTable = {}, requests: Record<string, string> = {}): ScriptModule {
  const loaded = new Map<string, { exports: ScriptModule }>();
  const makeRequire = (paths: Record<string, string>) => (request: string) => {
    if (request in modules) return modules[request];
    const id = paths[request];
    if (id === undefined || !table[id]) throw new ScriptError(`El módulo "${request}" no está disponible.`);
    const cached = loaded.get(id);
    if (cached) return cached.exports;
    const module = { exports: {} as ScriptModule };
    // Cached before it runs, so two modules that import each other still load.
    loaded.set(id, module);
    run(table[id].code, table[id].scoped ? scope : {}, module, makeRequire(table[id].requests), id);
    return module.exports;
  };
  const main = { exports: {} as ScriptModule };
  run(code, scope, main, makeRequire(requests), null);
  return main.exports;
}

function run(code: string, scope: Record<string, unknown>, module: { exports: ScriptModule }, require: (request: string) => unknown, id: string | null) {
  const names = Object.keys(scope);
  const where = (message: string) => (id ? `${id.replace(/^local:/, '')}: ${message}` : message);
  let body: (...args: unknown[]) => void;
  try {
    // The code runs in an inner function, on the same first line, so its own
    // declarations may reuse a scope name (a local Row) and lines still match.
    body = new Function(...names, 'exports', 'module', 'require', `(function () {${code}\n})();`) as typeof body;
  } catch (error) {
    throw new ScriptError(where(error instanceof Error ? error.message : String(error)), id ? null : errorLine(error));
  }
  try {
    body(...names.map((name) => scope[name]), module.exports, module, require);
  } catch (error) {
    if (error instanceof ScriptError) throw error;
    throw new ScriptError(where(error instanceof Error ? error.message : String(error)));
  }
}

// ─── Imports ───────────────────────────────────────────────────────────────

/** Every path the compiled code passes to require(), in order, once each. */
export function moduleRequests(code: string) {
  const found = new Set<string>();
  for (const match of code.matchAll(/\brequire\(\s*(['"])([^'"\n]+)\1\s*\)/g)) found.add(match[2]);
  return [...found];
}

/** The owner's file an import like "./_fechas" names, with or without its extension. */
export function resolveLocalModule(request: string, files: string[]) {
  if (!request.startsWith('./') || request.slice(2).includes('/')) return null;
  const wanted = request.slice(2).toLowerCase();
  return files.find((file) => file.toLowerCase() === wanted) ?? files.find((file) => baseName(file).toLowerCase() === wanted) ?? null;
}

export const PACKAGE_HOST = 'https://esm.sh';

/**
 * Where a package or URL import is downloaded from: "dayjs", "npm:dayjs@1.11"
 * and "dayjs/plugin/utc" come from esm.sh, built for older engines; a path
 * inside a downloaded file is resolved against that file's URL.
 */
export function packageUrl(request: string, base: string | null) {
  if (/^https:\/\//i.test(request)) return request;
  if (base && /^https:\/\//i.test(base)) {
    const origin = /^https:\/\/[^/]+/i.exec(base)![0];
    if (request.startsWith('/')) return `${origin}${request}`;
    if (request.startsWith('./') || request.startsWith('../')) {
      const parts = base.slice(origin.length).split('?')[0].split('/').slice(0, -1);
      for (const part of request.split('/')) {
        if (part === '..') parts.pop();
        else if (part !== '.') parts.push(part);
      }
      return `${origin}${parts.join('/')}`;
    }
  }
  const spec = request.replace(/^npm:/, '');
  if (!/^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(@[\w.^~<>=*-]+)?(\/[\w./-]*)?$/i.test(spec)) return null;
  return `${PACKAGE_HOST}/${spec}?bundle&target=es2015`;
}

/** jsDelivr's copy of a package import, tried only when esm.sh fails. Null for paths inside a downloaded file. */
export function packageFallbackUrl(request: string) {
  if (/^(https:|\/|\.)/i.test(request)) return null;
  const spec = request.replace(/^npm:/, '');
  return packageUrl(spec, null) ? `https://cdn.jsdelivr.net/npm/${spec}/+esm` : null;
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
  // Videos travel as raw bytes after the JSON, in this order (see BACKUP_MAGIC).
  videos?: Array<{ name: string; file: string; size: number }>;
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
  if (section.videos === undefined) return { files, data, media };
  if (!Array.isArray(section.videos)) throw bad();
  const videos = section.videos.map((video) => {
    if (!names.has(video?.name) || !isMediaId(video?.file) || !video.file.startsWith('vid-') || !Number.isSafeInteger(video?.size) || video.size < 0) throw bad();
    return { name: video.name, file: video.file, size: video.size };
  });
  return { files, data, media, videos };
}

// ─── Backup file with videos ───────────────────────────────────────────────

/**
 * A backup with videos is not plain JSON: it starts with this line, then the
 * JSON's length in bytes on its own line, the JSON, and each video's bytes
 * one after another. Without videos a backup stays a plain .json file.
 */
export const BACKUP_MAGIC = 'MYSUPERAPP-BACKUP';

export function backupHeader(jsonBytes: number) {
  return `${BACKUP_MAGIC}\n${jsonBytes}\n`;
}

/** Where the JSON sits in a backup file, from its first bytes; null for a plain JSON backup. */
export function readBackupHeader(start: Uint8Array) {
  let text = '';
  for (let index = 0; index < start.length && index < 64; index++) text += String.fromCharCode(start[index]);
  if (!text.startsWith(`${BACKUP_MAGIC}\n`)) return null;
  const match = /^[^\n]+\n(\d+)\n/.exec(text);
  if (!match) throw new Error('El respaldo está dañado.');
  return { jsonStart: match[0].length, jsonLength: Number(match[1]) };
}

/** UTF-8 bytes of a string, without relying on TextEncoder. */
export function utf8Encode(text: string) {
  const bytes: number[] = [];
  for (let index = 0; index < text.length; index++) {
    let code = text.charCodeAt(index);
    if (code >= 0xd800 && code < 0xdc00 && index + 1 < text.length) {
      const low = text.charCodeAt(index + 1);
      if (low >= 0xdc00 && low < 0xe000) {
        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
        index++;
      }
    }
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
  }
  return Uint8Array.from(bytes);
}

export function utf8Decode(bytes: Uint8Array) {
  let text = '';
  for (let index = 0; index < bytes.length;) {
    const byte = bytes[index++];
    let code: number;
    if (byte < 0x80) code = byte;
    else if (byte >= 0xf0) code = ((byte & 7) << 18) | ((bytes[index++] & 63) << 12) | ((bytes[index++] & 63) << 6) | (bytes[index++] & 63);
    else if (byte >= 0xe0) code = ((byte & 15) << 12) | ((bytes[index++] & 63) << 6) | (bytes[index++] & 63);
    else code = ((byte & 31) << 6) | (bytes[index++] & 63);
    text += String.fromCodePoint(code);
  }
  return text;
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

// ─── Drawing ───────────────────────────────────────────────────────────────

/** One line drawn by hand: its colour, width in points and the points it passed. */
export type Stroke = { color: string; width: number; points: Array<[number, number]> };

/** The SVG path of a stroke. A single point becomes a dot. */
export function strokePath(points: Array<[number, number]>) {
  if (!points.length) return '';
  const [first, ...rest] = points;
  if (!rest.length) return `M${first[0]} ${first[1]}l0.01 0`;
  return `M${first[0]} ${first[1]}${rest.map(([x, y]) => `L${x} ${y}`).join('')}`;
}
