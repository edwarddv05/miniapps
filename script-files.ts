import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Sharing from 'expo-sharing';
import { useSyncExternalStore } from 'react';
import { imageSizes, isImageId, isScriptFile, newImageId, scriptDataKey, uniqueScriptName } from './script-runtime';

// The .js miniapps live as plain files in the app's documents folder, under
// "miniapps". Files come in from the Files app and go out through the share sheet.

export type ScriptFile = { name: string; modified: number };
type ScriptsState = { ready: boolean; failed: boolean; files: ScriptFile[] };

const MAX_BYTES = 512 * 1024;
const dir = () => `${FileSystem.documentDirectory}miniapps/`;
const uri = (name: string) => `${dir()}${encodeURIComponent(name)}`;
// Each miniapp's images live in a hidden folder named after its file.
const imagesDir = (name: string) => `${dir()}.images/${encodeURIComponent(name)}/`;

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

/** Renames a file and carries its stored values along. Fails if the new name is taken. */
export async function renameScript(from: string, to: string) {
  if (from === to) return;
  const target = await FileSystem.getInfoAsync(uri(to));
  // The file system ignores case, so a case-only rename is the same file.
  if (target.exists && from.toLowerCase() !== to.toLowerCase()) throw new Error(`Ya existe "${to}".`);
  await FileSystem.moveAsync({ from: uri(from), to: uri(to) });
  if ((await FileSystem.getInfoAsync(imagesDir(from))).exists) {
    await FileSystem.makeDirectoryAsync(`${dir()}.images/`, { intermediates: true });
    await FileSystem.moveAsync({ from: imagesDir(from), to: imagesDir(to) });
  }
  const data = await AsyncStorage.getItem(scriptDataKey(from));
  if (data !== null) {
    await AsyncStorage.setItem(scriptDataKey(to), data);
    await AsyncStorage.removeItem(scriptDataKey(from));
  }
  await refreshScripts();
}

export async function deleteScript(name: string) {
  await FileSystem.deleteAsync(uri(name), { idempotent: true });
  await FileSystem.deleteAsync(imagesDir(name), { idempotent: true });
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

export async function loadScriptData(name: string) {
  return AsyncStorage.getItem(scriptDataKey(name));
}

export async function saveScriptData(name: string, data: Record<string, unknown>) {
  await AsyncStorage.setItem(scriptDataKey(name), JSON.stringify(data));
}

export type ScriptImage = { id: string; width: number; height: number };

/** Where a stored image is read from; `thumb` is the small copy for lists. */
export function scriptImageUri(name: string, id: string, thumb = false) {
  return isImageId(id) ? `${imagesDir(name)}${id}${thumb ? '.thumb' : ''}.jpg` : null;
}

/** Keeps a picked or captured photo for a miniapp: a copy up to 1600 px and a 480 px thumbnail, both JPEG. */
export async function saveScriptImage(name: string, source: { uri: string; width: number; height: number }): Promise<ScriptImage> {
  const id = newImageId();
  const sizes = imageSizes(source.width, source.height);
  await FileSystem.makeDirectoryAsync(imagesDir(name), { intermediates: true });
  const full = await ImageManipulator.manipulateAsync(source.uri, [{ resize: sizes.full }], { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG });
  const thumb = await ImageManipulator.manipulateAsync(full.uri, [{ resize: sizes.thumb }], { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG });
  await FileSystem.moveAsync({ from: full.uri, to: scriptImageUri(name, id)! });
  await FileSystem.moveAsync({ from: thumb.uri, to: scriptImageUri(name, id, true)! });
  return { id, width: full.width, height: full.height };
}

export async function deleteScriptImage(name: string, id: string) {
  if (!isImageId(id)) return;
  await FileSystem.deleteAsync(scriptImageUri(name, id)!, { idempotent: true });
  await FileSystem.deleteAsync(scriptImageUri(name, id, true)!, { idempotent: true });
}
