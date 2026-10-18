import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import { File, FileMode } from 'expo-file-system';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Sharing from 'expo-sharing';
import { useSyncExternalStore } from 'react';
import { extensionOf, imageSizes, isImageId, isMediaId, isScriptFile, newImageId, newMediaId, parseScriptData, scriptDataKey, scriptKvPrefix, uniqueScriptName, type MediaKind, type ScriptsBackup } from './script-runtime';

// The .js miniapps live as plain files in the app's documents folder, under
// "miniapps". Files come in from the Files app and go out through the share sheet.

export type ScriptFile = { name: string; modified: number };
type ScriptsState = { ready: boolean; failed: boolean; files: ScriptFile[] };

const MAX_BYTES = 512 * 1024;
const dir = () => `${FileSystem.documentDirectory}miniapps/`;
const uri = (name: string) => `${dir()}${encodeURIComponent(name)}`;
// Each miniapp's images, recordings, videos and files live in a hidden folder named after its file.
const mediaDir = (name: string) => `${dir()}.images/${encodeURIComponent(name)}/`;

let state: ScriptsState = { ready: false, failed: false, files: [] };
const listeners = new Set<() => void>();
const publish = (next: ScriptsState) => {
  state = next;
  listeners.forEach((listener) => listener());
};

async function ensureDir() {
  const info = await FileSystem.getInfoAsync(dir());
  if (!info.exists) await FileSystem.makeDirectoryAsync(dir(), { intermediates: true });
}

/** The file names in the miniapps folder, read now. */
export async function listScriptNames() {
  await ensureDir();
  return (await FileSystem.readDirectoryAsync(dir())).filter(isScriptFile);
}

export async function refreshScripts() {
  try {
    await ensureDir();
    const names = (await FileSystem.readDirectoryAsync(dir())).filter(isScriptFile);
    const files = await Promise.all(names.map(async (name): Promise<ScriptFile> => {
      const info = await FileSystem.getInfoAsync(uri(name));
      return { name, modified: info.exists ? info.modificationTime ?? 0 : 0 };
    }));
    files.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
    publish({ ready: true, failed: false, files });
  } catch {
    publish({ ...state, ready: true, failed: true });
  }
}

/** The files as last read, for code outside React. */
export const currentScripts = () => state.files;

export function useScripts() {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, () => state);
}

export function readScript(name: string) {
  return FileSystem.readAsStringAsync(uri(name));
}

export async function writeScript(name: string, source: string) {
  await ensureDir();
  await FileSystem.writeAsStringAsync(uri(name), source);
  await refreshScripts();
}

// ─── Stored values ─────────────────────────────────────────────────────────

async function valueKeys(name: string) {
  const prefix = scriptKvPrefix(name);
  return (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(prefix));
}

/**
 * A miniapp's stored values. Values saved by earlier versions as one JSON
 * object are moved to one entry each the first time they are read.
 */
export async function loadScriptData(name: string): Promise<Record<string, unknown>> {
  const prefix = scriptKvPrefix(name);
  const keys = await valueKeys(name);
  const data: Record<string, unknown> = {};
  for (const [key, raw] of keys.length ? await AsyncStorage.multiGet(keys) : []) {
    if (raw === null) continue;
    try {
      data[key.slice(prefix.length)] = JSON.parse(raw);
    } catch {
      // An unreadable value is left out instead of breaking the miniapp.
    }
  }
  const legacy = await AsyncStorage.getItem(scriptDataKey(name));
  if (legacy !== null) {
    const missing = Object.entries(parseScriptData(legacy)).filter(([key]) => !(key in data));
    if (missing.length) await AsyncStorage.multiSet(missing.map(([key, value]): [string, string] => [`${prefix}${key}`, JSON.stringify(value)]));
    for (const [key, value] of missing) data[key] = value;
    await AsyncStorage.removeItem(scriptDataKey(name));
  }
  return data;
}

/** Writes only the values that changed; `undefined` removes one. */
export async function saveScriptValues(name: string, changes: Array<[string, unknown]>) {
  const prefix = scriptKvPrefix(name);
  const set = changes.filter(([, value]) => value !== undefined).map(([key, value]): [string, string] => [`${prefix}${key}`, JSON.stringify(value)]);
  const remove = changes.filter(([, value]) => value === undefined).map(([key]) => `${prefix}${key}`);
  if (set.length) await AsyncStorage.multiSet(set);
  if (remove.length) await AsyncStorage.multiRemove(remove);
}

async function moveValues(from: string, to: string) {
  const data = await loadScriptData(from);
  await saveScriptValues(to, Object.entries(data));
  const old = await valueKeys(from);
  if (old.length) await AsyncStorage.multiRemove(old);
}

// ─── Files ─────────────────────────────────────────────────────────────────

/** Renames a file and carries its stored values and media along. Fails if the new name is taken. */
export async function renameScript(from: string, to: string) {
  if (from === to) return;
  const target = await FileSystem.getInfoAsync(uri(to));
  // The file system ignores case, so a case-only rename is the same file.
  if (target.exists && from.toLowerCase() !== to.toLowerCase()) throw new Error(`Ya existe "${to}".`);
  await FileSystem.moveAsync({ from: uri(from), to: uri(to) });
  if ((await FileSystem.getInfoAsync(mediaDir(from))).exists) {
    await FileSystem.makeDirectoryAsync(`${dir()}.images/`, { intermediates: true });
    await FileSystem.moveAsync({ from: mediaDir(from), to: mediaDir(to) });
  }
  await moveValues(from, to);
  await refreshScripts();
}

export async function deleteScript(name: string) {
  await FileSystem.deleteAsync(uri(name), { idempotent: true });
  await FileSystem.deleteAsync(mediaDir(name), { idempotent: true });
  const keys = await valueKeys(name);
  if (keys.length) await AsyncStorage.multiRemove(keys);
  await AsyncStorage.removeItem(scriptDataKey(name));
  await refreshScripts();
}

/** Copies .js files picked in the Files app into the miniapps folder. Returns the names they got. */
export async function importScripts() {
  const result = await DocumentPicker.getDocumentAsync({ type: ['public.javascript', 'com.netscape.javascript-source', 'public.source-code', 'public.plain-text', '*/*'], copyToCacheDirectory: true, multiple: true });
  if (result.canceled || !result.assets?.length) return [];
  const rejected = result.assets.filter((asset) => !isScriptFile(asset.name));
  if (rejected.length === result.assets.length) throw new Error('Solo se pueden importar archivos .js o .jsx.');
  const tooBig = result.assets.find((asset) => (asset.size ?? 0) > MAX_BYTES);
  if (tooBig) throw new Error(`"${tooBig.name}" pesa más de 512 KB.`);
  await ensureDir();
  const existing = (await FileSystem.readDirectoryAsync(dir()));
  const imported: string[] = [];
  for (const asset of result.assets.filter((item) => isScriptFile(item.name))) {
    const name = uniqueScriptName(asset.name, [...existing, ...imported]);
    await FileSystem.copyAsync({ from: asset.uri, to: uri(name) });
    imported.push(name);
  }
  await refreshScripts();
  return imported;
}

export async function shareScript(name: string) {
  await Sharing.shareAsync(uri(name), { mimeType: 'text/javascript', UTI: 'com.netscape.javascript-source', dialogTitle: name });
}

// ─── Media ─────────────────────────────────────────────────────────────────

export type ScriptImage = { id: string; width: number; height: number };

/** Where a stored image is read from; `thumb` is the small copy for lists. */
export function scriptImageUri(name: string, id: string, thumb = false) {
  return isImageId(id) ? `${mediaDir(name)}${id}${thumb ? '.thumb' : ''}.jpg` : null;
}

/** Where a stored recording, video or file is read from. */
export function scriptMediaUri(name: string, id: string) {
  return isMediaId(id) ? `${mediaDir(name)}${id}` : isImageId(id) ? scriptImageUri(name, id) : null;
}

/** Keeps a picked or captured photo for a miniapp: a copy up to 1600 px and a 480 px thumbnail, both JPEG. */
export async function saveScriptImage(name: string, source: { uri: string; width: number; height: number }): Promise<ScriptImage> {
  const id = newImageId();
  const sizes = imageSizes(source.width, source.height);
  await FileSystem.makeDirectoryAsync(mediaDir(name), { intermediates: true });
  const full = await ImageManipulator.manipulateAsync(source.uri, [{ resize: sizes.full }], { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG });
  const thumb = await ImageManipulator.manipulateAsync(full.uri, [{ resize: sizes.thumb }], { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG });
  await FileSystem.moveAsync({ from: full.uri, to: scriptImageUri(name, id)! });
  await FileSystem.moveAsync({ from: thumb.uri, to: scriptImageUri(name, id, true)! });
  return { id, width: full.width, height: full.height };
}

/** Copies (or moves, for a temporary recording) a file into the miniapp's folder and returns its id. */
export async function saveScriptMedia(name: string, source: string, kind: MediaKind, extension: string, move = false) {
  const id = newMediaId(kind, extension);
  await FileSystem.makeDirectoryAsync(mediaDir(name), { intermediates: true });
  if (move) await FileSystem.moveAsync({ from: source, to: scriptMediaUri(name, id)! });
  else await FileSystem.copyAsync({ from: source, to: scriptMediaUri(name, id)! });
  return id;
}

export async function deleteScriptMedia(name: string, id: string) {
  if (isImageId(id)) {
    await FileSystem.deleteAsync(scriptImageUri(name, id)!, { idempotent: true });
    await FileSystem.deleteAsync(scriptImageUri(name, id, true)!, { idempotent: true });
  } else if (isMediaId(id)) {
    await FileSystem.deleteAsync(scriptMediaUri(name, id)!, { idempotent: true });
  }
}

export async function readScriptMediaText(name: string, id: string) {
  const path = scriptMediaUri(name, id);
  if (!path) throw new Error('Archivo no válido.');
  return FileSystem.readAsStringAsync(path);
}

/** Writes text to a temporary file with the given name, for the share sheet. */
export async function temporaryTextFile(fileName: string, text: string) {
  const safe = fileName.replace(/[\\/:*?"<>|]/g, '').trim() || 'archivo.txt';
  const path = `${FileSystem.cacheDirectory}${encodeURIComponent(safe)}`;
  await FileSystem.writeAsStringAsync(path, text);
  return path;
}

export async function shareFile(path: string, mimeType?: string) {
  await Sharing.shareAsync(path, mimeType ? { mimeType } : undefined);
}

export { extensionOf };

// ─── Backup ────────────────────────────────────────────────────────────────

/**
 * The miniapps for the app's backup: every file, its stored values, and its
 * images, recordings and files as base64. Videos are only listed here; their
 * bytes are copied straight into the backup file (see writeScriptVideos).
 */
export async function collectScriptsBackup(): Promise<ScriptsBackup> {
  const backup: ScriptsBackup = { files: [], data: {}, media: {} };
  if (!(await FileSystem.getInfoAsync(dir())).exists) return backup;
  const names = (await FileSystem.readDirectoryAsync(dir())).filter(isScriptFile);
  for (const name of names) {
    backup.files.push({ name, source: await readScript(name) });
    const data = await loadScriptData(name);
    if (Object.keys(data).length) backup.data[name] = data;
    if (!(await FileSystem.getInfoAsync(mediaDir(name))).exists) continue;
    const media: Record<string, string> = {};
    for (const file of await FileSystem.readDirectoryAsync(mediaDir(name))) {
      if (isMediaId(file) && file.startsWith('vid-')) {
        const info = await FileSystem.getInfoAsync(`${mediaDir(name)}${file}`);
        if (info.exists && !info.isDirectory) (backup.videos ??= []).push({ name, file, size: info.size });
        continue;
      }
      const keep = isImageId(file.replace(/(\.thumb)?\.jpg$/, '')) || isMediaId(file);
      if (keep) media[file] = await FileSystem.readAsStringAsync(`${mediaDir(name)}${file}`, { encoding: FileSystem.EncodingType.Base64 });
    }
    if (Object.keys(media).length) backup.media[name] = media;
  }
  return backup;
}

const CHUNK = 4 * 1024 * 1024;

/** Copies `size` bytes from one open file to another in 4 MB pieces, letting the app draw between them. */
async function copyBytes(from: ReturnType<File['open']>, to: ReturnType<File['open']>, size: number) {
  let left = size;
  while (left > 0) {
    const chunk = from.readBytes(Math.min(CHUNK, left));
    if (!chunk.length) throw new Error('El respaldo está incompleto.');
    to.writeBytes(chunk);
    left -= chunk.length;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** Appends each listed video's bytes to an open backup file, in the listed order. */
export async function writeScriptVideos(out: ReturnType<File['open']>, videos: NonNullable<ScriptsBackup['videos']>) {
  for (const video of videos) {
    const input = new File(`${mediaDir(video.name)}${video.file}`).open(FileMode.ReadOnly);
    try {
      await copyBytes(input, out, video.size);
    } finally {
      input.close();
    }
  }
}

/**
 * Puts back the miniapps of a backup. Files with the same name are replaced;
 * other miniapps stay. `videos` says where the videos' bytes start in the
 * backup file, when it has them.
 */
export async function restoreScriptsBackup(backup: ScriptsBackup, videos?: { uri: string; offset: number }) {
  await ensureDir();
  for (const file of backup.files) {
    await FileSystem.writeAsStringAsync(uri(file.name), file.source);
    const old = await valueKeys(file.name);
    if (old.length) await AsyncStorage.multiRemove(old);
    await saveScriptValues(file.name, Object.entries(backup.data[file.name] ?? {}));
    const media = backup.media[file.name];
    if (!media) continue;
    await FileSystem.makeDirectoryAsync(mediaDir(file.name), { intermediates: true });
    for (const [item, base64] of Object.entries(media)) {
      await FileSystem.writeAsStringAsync(`${mediaDir(file.name)}${item}`, base64, { encoding: FileSystem.EncodingType.Base64 });
    }
  }
  if (videos && backup.videos?.length) {
    const input = new File(videos.uri).open(FileMode.ReadOnly);
    try {
      input.offset = videos.offset;
      for (const video of backup.videos) {
        await FileSystem.makeDirectoryAsync(mediaDir(video.name), { intermediates: true });
        const target = new File(`${mediaDir(video.name)}${video.file}`);
        target.create({ overwrite: true });
        const out = target.open(FileMode.ReadWrite);
        try {
          await copyBytes(input, out, video.size);
        } finally {
          out.close();
        }
      }
    } finally {
      input.close();
    }
  }
  await refreshScripts();
}
