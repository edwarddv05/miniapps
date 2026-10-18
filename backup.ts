import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { LIBRARY_KEY, loadLibrary, parseLibrary } from './anime-library';
import { CARDS_KEY, loadCards, parseCards } from './cards-store';
import { parseSchedule, SCHEDULE_KEY } from './schedule-data';
import { FARE_KEY, loadTrips, parseTrips, TRIPS_KEY } from './transit-trips';
import { collectScriptsBackup, restoreScriptsBackup } from './script-files';
import { parseScriptsBackup, type ScriptsBackup } from './script-runtime';

// A copy of the owner's data in one file: schedule, anime list, cards, saved
// trips and the .js miniapps with their data, photos and recordings (videos
// stay out). Restoring checks the whole file before anything is replaced.
// The Gemini key stays out of it, and card photos stay on the phone.

export const BACKUP_FORMAT = 'my-superapp-backup';
export const BACKUP_VERSION = 1;

// `items` counts the records in a section, so a backup whose parser had to
// drop invalid ones is rejected instead of restored with gaps.
type Section = { key: string; parse: (raw: string | null) => unknown; items: (value: any) => number };

const length = (value: unknown) => (Array.isArray(value) ? value.length : 0);

const SECTIONS: Record<'schedule' | 'anime' | 'cards' | 'trips', Section> = {
  schedule: { key: SCHEDULE_KEY, parse: parseSchedule, items: length },
  anime: { key: LIBRARY_KEY, parse: parseLibrary, items: (value) => length(value?.entries) },
  cards: { key: CARDS_KEY, parse: parseCards, items: (value) => length(value?.cards) + length(value?.purchases) + length(value?.payments) },
  trips: { key: TRIPS_KEY, parse: parseTrips, items: (value) => length(value?.favorites) + length(value?.recents) },
};
type SectionName = keyof typeof SECTIONS;
const NAMES = Object.keys(SECTIONS) as SectionName[];

export type BackupSummary = { classes: number; anime: number; cards: number; purchases: number; trips: number; miniapps: number };

export type Backup = {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: string;
  // Backups made before miniapps were included have none.
  data: Record<SectionName, unknown> & { fare: 'general' | 'student'; miniapps: ScriptsBackup | null };
};

export function summarize(data: Backup['data']): BackupSummary {
  const schedule = data.schedule as unknown[];
  const anime = data.anime as { entries: unknown[] };
  const cards = data.cards as { cards: unknown[]; purchases: unknown[] };
  const trips = data.trips as { favorites: unknown[] };
  return { classes: schedule.length, anime: anime.entries.length, cards: cards.cards.length, purchases: cards.purchases.length, trips: trips.favorites.length, miniapps: data.miniapps?.files.length ?? 0 };
}

export function summaryText(summary: BackupSummary) {
  const count = (value: number, one: string, many: string) => `${value} ${value === 1 ? one : many}`;
  return [
    count(summary.classes, 'clase', 'clases'),
    count(summary.anime, 'anime', 'anime'),
    count(summary.cards, 'tarjeta', 'tarjetas'),
    count(summary.purchases, 'compra', 'compras'),
    count(summary.trips, 'viaje favorito', 'viajes favoritos'),
    ...(summary.miniapps ? [count(summary.miniapps, 'miniapp', 'miniapps')] : []),
  ].join(', ');
}

/** Reads every section as stored. A section that cannot be read stops the export: a partial copy would look complete. */
export async function buildBackup(now = new Date()): Promise<Backup> {
  const keys = [...NAMES.map((name) => SECTIONS[name].key), FARE_KEY];
  const stored = new Map(await AsyncStorage.multiGet(keys));
  const data = {} as Backup['data'];
  for (const name of NAMES) {
    try {
      data[name] = SECTIONS[name].parse(stored.get(SECTIONS[name].key) ?? null);
    } catch {
      throw new Error(`No se pudo leer ${LABELS[name]}; el respaldo no se creó.`);
    }
  }
  data.fare = stored.get(FARE_KEY) === 'student' ? 'student' : 'general';
  try {
    data.miniapps = await collectScriptsBackup();
  } catch {
    throw new Error('No se pudieron leer las miniapps; el respaldo no se creó.');
  }
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: now.toISOString(), data };
}

const LABELS: Record<SectionName, string> = { schedule: 'el horario', anime: 'la lista de anime', cards: 'las tarjetas', trips: 'los viajes' };
const INVALID: Record<SectionName, string> = {
  schedule: 'El horario del respaldo no es válido.',
  anime: 'La lista de anime del respaldo no es válida.',
  cards: 'Las tarjetas del respaldo no son válidas.',
  trips: 'Los viajes del respaldo no son válidos.',
};

/** Validates a backup file. Throws with a message that says what is wrong; never returns partial data. */
export function parseBackup(text: string): Backup {
  let value: any;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('El archivo no es un respaldo de la app.');
  }
  if (value?.format !== BACKUP_FORMAT || typeof value?.data !== 'object' || value.data === null) throw new Error('El archivo no es un respaldo de la app.');
  if (typeof value.version !== 'number' || value.version > BACKUP_VERSION) throw new Error('El respaldo es de una versión más nueva de la app.');
  const data = {} as Backup['data'];
  for (const name of NAMES) {
    if (!(name in value.data)) throw new Error(`El respaldo no incluye ${LABELS[name]}.`);
    const section = SECTIONS[name];
    let parsed: unknown;
    try {
      // Each section passes the same check the app applies when it loads it.
      parsed = section.parse(JSON.stringify(value.data[name]));
    } catch {
      parsed = null;
    }
    if (parsed === null || section.items(parsed) !== section.items(value.data[name])) {
      throw new Error(INVALID[name]);
    }
    data[name] = parsed;
  }
  data.fare = value.data.fare === 'student' ? 'student' : 'general';
  data.miniapps = parseScriptsBackup(value.data.miniapps);
  return { format: BACKUP_FORMAT, version: value.version, createdAt: typeof value.createdAt === 'string' ? value.createdAt : '', data };
}

export async function exportBackup() {
  const backup = await buildBackup();
  if (!FileSystem.cacheDirectory) throw new Error('El almacenamiento del dispositivo no está disponible.');
  const uri = `${FileSystem.cacheDirectory}my-superapp-${backup.createdAt.slice(0, 10)}.json`;
  await FileSystem.writeAsStringAsync(uri, JSON.stringify(backup));
  await Sharing.shareAsync(uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: 'Respaldo' });
  return summarize(backup.data);
}

/** Lets the owner pick a backup file and checks it. Null when the picker is cancelled. */
export async function pickBackup(): Promise<Backup | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'public.json', '*/*'], copyToCacheDirectory: true, multiple: false });
  if (result.canceled || !result.assets?.length) return null;
  const text = await FileSystem.readAsStringAsync(result.assets[0].uri);
  return parseBackup(text);
}

/** Replaces the stored data with the backup's, all keys in one write, then reloads the stores. */
export async function restoreBackup(backup: Backup) {
  // Card photos live in the documents folder of the phone that made the
  // backup; a card whose photo is not on this phone shows its design instead.
  const cards = backup.data.cards as ReturnType<typeof parseCards>;
  const withImages = await Promise.all(cards.cards.map(async (card) => {
    if (!card.image) return card;
    const exists = await FileSystem.getInfoAsync(card.image).then((info) => info.exists).catch(() => false);
    return exists ? card : { ...card, image: null };
  }));
  backup = { ...backup, data: { ...backup.data, cards: { ...cards, cards: withImages } } };
  await AsyncStorage.multiSet([
    ...NAMES.map((name): [string, string] => [SECTIONS[name].key, JSON.stringify(backup.data[name])]),
    [FARE_KEY, backup.data.fare],
  ]);
  // Miniapps with the same name are replaced; the others on this phone stay.
  if (backup.data.miniapps?.files.length) await restoreScriptsBackup(backup.data.miniapps);
  await Promise.all([loadLibrary(true), loadTrips(true), loadCards(true)]);
}
