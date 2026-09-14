import { Linking, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

export type DownloadMode = 'video' | 'audio';

export type DownloadAnalysis = {
  title: string;
  uploader?: string | null;
  durationSeconds?: number | null;
};

export type DownloadResult = {
  fileUrl: string;
  filename: string;
  mimeType: string;
};

const DEFAULT_DOWNLOADER_API_URL = 'http://192.168.101.3:8787';
const configuredApiUrl = typeof process !== 'undefined' ? process.env?.EXPO_PUBLIC_DOWNLOADER_API_URL : undefined;
export const DOWNLOADER_API_URL = (configuredApiUrl || DEFAULT_DOWNLOADER_API_URL).replace(/\/$/, '');

export function downloaderErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  if (/failed to fetch|network request failed|network connection/i.test(error.message)) {
    return 'No se pudo conectar con el servicio local. Verifica que Downloader esté encendido.';
  }
  return error.message || fallback;
}

function assertUrl(value: string) {
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.toString();
  } catch {
    // Normalize the platform URL parser's technical error for the input field.
  }
  throw new Error('Usa un enlace que empiece por https:// o http://.');
}

async function readError(response: Response, fallback: string) {
  try {
    const payload = await response.json() as { detail?: string };
    return payload.detail || fallback;
  } catch {
    return fallback;
  }
}

export async function analyzeUrl(input: string): Promise<DownloadAnalysis> {
  const url = assertUrl(input);
  const response = await fetch(`${DOWNLOADER_API_URL}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });

  if (!response.ok) throw new Error(await readError(response, 'No se pudo analizar el enlace.'));
  const result = await response.json() as DownloadAnalysis;
  return {
    title: result.title || 'Recurso sin título',
    uploader: result.uploader || null,
    durationSeconds: typeof result.durationSeconds === 'number' ? result.durationSeconds : null,
  };
}

export async function downloadFromService(input: string, mode: DownloadMode): Promise<DownloadResult> {
  const url = assertUrl(input);
  const response = await fetch(`${DOWNLOADER_API_URL}/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, mode }),
  });

  if (!response.ok) throw new Error(await readError(response, 'No se pudo completar la descarga.'));
  const result = await response.json() as DownloadResult;
  return {
    ...result,
    fileUrl: new URL(result.fileUrl, `${DOWNLOADER_API_URL}/`).toString(),
  };
}

export function formatDuration(durationSeconds?: number | null) {
  if (!durationSeconds || durationSeconds <= 0) return null;
  const total = Math.round(durationSeconds);
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export async function saveDownload(result: DownloadResult) {
  if (Platform.OS === 'web') {
    await Linking.openURL(result.fileUrl);
    return result.fileUrl;
  }

  if (!FileSystem.documentDirectory) throw new Error('El almacenamiento del dispositivo no está disponible.');
  const safeFilename = result.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const target = `${FileSystem.documentDirectory}${safeFilename}`;
  const downloaded = await FileSystem.downloadAsync(result.fileUrl, target);

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(downloaded.uri, {
      mimeType: result.mimeType,
      dialogTitle: result.filename,
      UTI: result.mimeType === 'audio/mp4' ? 'public.audio' : 'public.movie',
    });
  } else {
    await Linking.openURL(downloaded.uri);
  }

  return downloaded.uri;
}
