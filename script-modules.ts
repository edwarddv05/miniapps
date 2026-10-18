import * as FileSystem from 'expo-file-system/legacy';
import { listScriptNames, readScript } from './script-files';
import { ScriptError, checkScript, compileScript, moduleRequests, packageFallbackUrl, packageUrl, resolveLocalModule, type ModuleTable } from './script-runtime';

// What a miniapp imports beyond the app's own modules: other files of the
// owner ("./_fechas") and npm packages ("dayjs"). Packages are downloaded once
// from esm.sh (jsDelivr when esm.sh fails) and kept in miniapps/.npm, so later
// runs work offline. A kept file starts with the URL it came from, which its
// own imports are resolved against.

const APP_MODULES = new Set(['superapp', 'react', '@expo/ui/swift-ui', '@expo/ui/swift-ui/modifiers']);
const MAX_MODULES = 200;
const MAX_PACKAGE_BYTES = 3 * 1024 * 1024;

const packageDir = () => `${FileSystem.documentDirectory}miniapps/.npm/`;

function cacheName(url: string) {
  let hash = 5381;
  for (let index = 0; index < url.length; index++) hash = ((hash * 33) ^ url.charCodeAt(index)) >>> 0;
  const label = url.replace(/^https:\/\/[^/]+\//, '').replace(/[^a-z0-9@.-]+/gi, '_').slice(0, 60);
  return `${label}-${hash.toString(36)}.js`;
}

const packageLabel = (url: string) => url.replace(/^https:\/\/(esm\.sh|cdn\.jsdelivr\.net\/npm)\//, '').replace(/(\/\+esm)?(\?.*)?$/, '');
const SOURCE_LINE = '//@source ';

type Download = { text: string; url: string };
const downloaded = new Map<string, Download>();

async function fetchText(url: string): Promise<{ text: string } | { status: number | null }> {
  try {
    const response = await fetch(url);
    if (!response.ok) return { status: response.status };
    return { text: await response.text() };
  } catch {
    return { status: null };
  }
}

async function downloadPackage(url: string, request: string): Promise<Download> {
  const known = downloaded.get(url);
  if (known) return known;
  const path = `${packageDir()}${cacheName(url)}`;
  if ((await FileSystem.getInfoAsync(path)).exists) {
    const stored = await FileSystem.readAsStringAsync(path);
    const newline = stored.indexOf('\n');
    const kept = stored.startsWith(SOURCE_LINE) ? { url: stored.slice(SOURCE_LINE.length, newline), text: stored.slice(newline + 1) } : { url, text: stored };
    downloaded.set(url, kept);
    return kept;
  }
  let result = await fetchText(url);
  let from = url;
  const fallback = packageFallbackUrl(request);
  if ('status' in result && result.status !== 404 && fallback) {
    result = await fetchText(fallback);
    from = fallback;
  }
  if ('status' in result) {
    if (result.status === 404) throw new ScriptError(`El paquete "${packageLabel(url)}" no existe.`);
    throw new ScriptError(result.status === null ? `No se pudo descargar "${packageLabel(url)}". Revisa la conexión.` : `No se pudo descargar "${packageLabel(url)}" (${result.status}).`);
  }
  if (result.text.length > MAX_PACKAGE_BYTES) throw new ScriptError(`"${packageLabel(url)}" pesa más de 3 MB.`);
  await FileSystem.makeDirectoryAsync(packageDir(), { intermediates: true });
  await FileSystem.writeAsStringAsync(path, `${SOURCE_LINE}${from}\n${result.text}`);
  const kept = { url: from, text: result.text };
  downloaded.set(url, kept);
  return kept;
}

/** Downloaded packages, to free the space. */
export async function clearPackages() {
  downloaded.clear();
  await FileSystem.deleteAsync(packageDir(), { idempotent: true });
}

/**
 * Reads, downloads and compiles everything `code` imports, and what those
 * import in turn, before the miniapp runs: its require() then never waits.
 */
export async function loadModules(code: string) {
  const files = await listScriptNames();
  const table: ModuleTable = {};
  const resolveAll = async (moduleCode: string, local: boolean, base: string | null) => {
    const requests: Record<string, string> = {};
    for (const request of moduleRequests(moduleCode)) {
      if (APP_MODULES.has(request)) continue;
      let id: string;
      if (local && request.startsWith('./')) {
        const file = resolveLocalModule(request, files);
        if (!file) throw new ScriptError(`No existe el archivo "${request.slice(2)}".`);
        id = `local:${file}`;
        if (!table[id]) {
          table[id] = { code: '', scoped: true, requests: {} };
          let compiled: string;
          try {
            compiled = checkScript(await readScript(file), file).code;
          } catch (error) {
            const found = error instanceof ScriptError ? error : new ScriptError(String(error));
            throw new ScriptError(`${file}${found.line ? `, línea ${found.line}` : ''}: ${found.message}`);
          }
          table[id].code = compiled;
          table[id].requests = await resolveAll(compiled, true, null);
        }
      } else {
        const url = packageUrl(request, base);
        if (!url) throw new ScriptError(`"${request}" no es un paquete válido.`);
        id = url;
        if (!table[id]) {
          table[id] = { code: '', scoped: false, requests: {} };
          const download = await downloadPackage(url, request);
          let compiled: string;
          try {
            compiled = compileScript(download.text, { guard: false });
          } catch (error) {
            throw new ScriptError(`"${packageLabel(url)}" no funciona aquí: ${error instanceof Error ? error.message : String(error)}`);
          }
          table[id].code = compiled;
          table[id].requests = await resolveAll(compiled, false, download.url);
        }
      }
      requests[request] = id;
      if (Object.keys(table).length > MAX_MODULES) throw new ScriptError('La miniapp importa demasiados módulos.');
    }
    return requests;
  };
  const requests = await resolveAll(code, true, null);
  return { table, requests };
}
