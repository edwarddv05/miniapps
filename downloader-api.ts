import { Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

export type DownloadMode = 'video' | 'audio' | 'image';

export type DownloadQuality = {
  id: string;
  label: string;
  height: number;
};

export type DownloadVideo = {
  id: string;
  title: string;
  url: string;
  durationSeconds?: number | null;
};

export type DownloadItem = {
  id: string;
  kind: 'video' | 'image';
  title: string;
  url: string;
  mediaUrl: string | null;
  thumbnail: string | null;
  durationSeconds: number | null;
};

export type SourceKey = 'youtube' | 'x' | 'facebook' | 'instagram' | 'tiktok' | 'other';

export type DownloadSource = {
  key: SourceKey;
  label: string;
  shortLabel: string;
};

export type DownloadAnalysis = {
  title: string;
  description?: string | null;
  uploader?: string | null;
  durationSeconds?: number | null;
  thumbnail: string | null;
  previewUrl: string | null;
  mediaUrl: string | null;
  aspectRatio: number | null;
  modes: DownloadMode[];
  items: DownloadItem[];
  videoCount: number;
  videos: DownloadVideo[];
  qualities: DownloadQuality[];
};

export type DownloadResult = {
  fileUrl: string;
  filename: string;
  mimeType: string;
  sizeBytes?: number | null;
};

export type DownloadProgress = {
  stage: 'server' | 'processing' | 'transfer';
  /** 0–1, or null while the size is unknown. */
  fraction: number | null;
};

export type DownloadHistoryItem = {
  id: string;
  title: string;
  source: SourceKey;
  mode: DownloadMode;
  filename: string;
  mimeType: string;
  uri: string;
  thumbnail: string | null;
  createdAt: number;
};

const DEFAULT_DOWNLOADER_API_URL = 'http://192.168.101.3:8787';
const configuredApiUrl = typeof process !== 'undefined' ? process.env?.EXPO_PUBLIC_DOWNLOADER_API_URL : undefined;
export const DOWNLOADER_API_URL = (configuredApiUrl || DEFAULT_DOWNLOADER_API_URL).replace(/\/$/, '');
const HISTORY_KEY = '@miniapps/downloads';
const HISTORY_LIMIT = 20;
const MODES: DownloadMode[] = ['video', 'audio', 'image'];

export class DownloadCancelledError extends Error {
  constructor() {
    super('Descarga cancelada.');
  }
}

export function downloaderErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  if (/failed to fetch|network request failed|network connection|could not connect/i.test(error.message)) {
    return 'No se pudo conectar con el servicio local. Verifica que Downloader esté encendido.';
  }
  return error.message || fallback;
}

const SOURCES: Record<SourceKey, DownloadSource> = {
  youtube: { key: 'youtube', label: 'YouTube', shortLabel: 'YT' },
  x: { key: 'x', label: 'X', shortLabel: 'X' },
  facebook: { key: 'facebook', label: 'Facebook', shortLabel: 'f' },
  instagram: { key: 'instagram', label: 'Instagram', shortLabel: 'IG' },
  tiktok: { key: 'tiktok', label: 'TikTok', shortLabel: 'TT' },
  other: { key: 'other', label: 'Web', shortLabel: 'WEB' },
};

export function sourceForKey(key: SourceKey) {
  return SOURCES[key] ?? SOURCES.other;
}

export function detectDownloadSource(input: string): DownloadSource | null {
  try {
    const hostname = new URL(input.trim()).hostname.toLowerCase().replace(/^www\./, '');
    if (hostname === 'youtube.com' || hostname.endsWith('.youtube.com') || hostname === 'youtu.be') return SOURCES.youtube;
    if (hostname === 'x.com' || hostname.endsWith('.x.com') || hostname === 'twitter.com' || hostname.endsWith('.twitter.com')) return SOURCES.x;
    if (hostname === 'facebook.com' || hostname.endsWith('.facebook.com') || hostname === 'fb.watch') return SOURCES.facebook;
    if (hostname === 'instagram.com' || hostname.endsWith('.instagram.com')) return SOURCES.instagram;
    if (hostname === 'tiktok.com' || hostname.endsWith('.tiktok.com')) return SOURCES.tiktok;
    return SOURCES.other;
  } catch {
    return null;
  }
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

function text(value: unknown) {
  return typeof value === 'string' && value ? value : null;
}

function positive(value: unknown) {
  return typeof value === 'number' && value > 0 ? value : null;
}

export async function analyzeUrl(input: string, signal?: AbortSignal): Promise<DownloadAnalysis> {
  const url = assertUrl(input);
  const response = await fetch(`${DOWNLOADER_API_URL}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
    signal,
  });

  if (!response.ok) throw new Error(await readError(response, 'No se pudo analizar el enlace.'));
  const result = await response.json() as Record<string, unknown>;
  const videos = Array.isArray(result.videos)
    ? result.videos.filter((video): video is DownloadVideo => Boolean(video && typeof video.id === 'string' && typeof video.title === 'string' && typeof video.url === 'string'))
    : [];
  const qualities = Array.isArray(result.qualities)
    ? result.qualities.filter((quality): quality is DownloadQuality => Boolean(quality && typeof quality.id === 'string' && typeof quality.label === 'string' && typeof quality.height === 'number'))
    : [];
  const items: DownloadItem[] = Array.isArray(result.items)
    ? result.items.flatMap((item) => item && typeof item.id === 'string' && typeof item.url === 'string' && (item.kind === 'video' || item.kind === 'image')
      ? [{ id: item.id, kind: item.kind, title: text(item.title) ?? 'Elemento', url: item.url, mediaUrl: text(item.mediaUrl), thumbnail: text(item.thumbnail), durationSeconds: positive(item.durationSeconds) }]
      : [])
    : [];
  const modes = Array.isArray(result.modes) ? MODES.filter((mode) => (result.modes as unknown[]).includes(mode)) : [];
  return {
    title: text(result.title) ?? 'Sin título',
    description: text(result.description),
    uploader: text(result.uploader),
    durationSeconds: positive(result.durationSeconds),
    thumbnail: text(result.thumbnail),
    previewUrl: text(result.previewUrl),
    mediaUrl: text(result.mediaUrl),
    aspectRatio: positive(result.aspectRatio),
    modes: modes.length ? modes : ['video', 'audio'],
    items,
    videoCount: positive(result.videoCount) ?? Math.max(items.length, videos.length, 1),
    videos,
    qualities,
  };
}

function absoluteResult(result: DownloadResult): DownloadResult {
  return { ...result, fileUrl: new URL(result.fileUrl, `${DOWNLOADER_API_URL}/`).toString() };
}

export async function downloadFromService(input: string, mode: DownloadMode, quality?: number | null): Promise<DownloadResult> {
  const url = assertUrl(input);
  const response = await fetch(`${DOWNLOADER_API_URL}/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, mode, quality: quality ?? null }),
  });

  if (!response.ok) throw new Error(await readError(response, 'No se pudo completar la descarga.'));
  return absoluteResult(await response.json() as DownloadResult);
}

type JobState = {
  status: 'running' | 'done' | 'error' | 'cancelled';
  phase?: 'starting' | 'downloading' | 'processing' | 'done';
  progress?: number | null;
  error?: string;
  result?: DownloadResult;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type DownloadTask = {
  promise: Promise<{ result: DownloadResult; uri: string }>;
  cancel: () => void;
};

/**
 * Runs the download on the PC, then copies the finished file to the phone.
 * Progress covers both legs so the caller can show one bar.
 */
export function startDownload(
  params: { url: string; mode: DownloadMode; quality?: number | null; mediaUrl?: string | null },
  onProgress: (progress: DownloadProgress) => void,
): DownloadTask {
  let cancelled = false;
  let jobId: string | null = null;
  let resumable: FileSystem.DownloadResumable | null = null;

  const cancel = () => {
    cancelled = true;
    if (jobId) void fetch(`${DOWNLOADER_API_URL}/jobs/${jobId}`, { method: 'DELETE' }).catch(() => undefined);
    void resumable?.cancelAsync().catch(() => undefined);
  };

  const promise = (async () => {
    const url = assertUrl(params.url);
    onProgress({ stage: 'server', fraction: null });
    const created = await fetch(`${DOWNLOADER_API_URL}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, mode: params.mode, quality: params.quality ?? null, mediaUrl: params.mediaUrl ?? null }),
    });
    if (!created.ok) throw new Error(await readError(created, 'No se pudo iniciar la descarga.'));
    jobId = (await created.json() as { jobId: string }).jobId;

    let job: JobState;
    for (;;) {
      if (cancelled) throw new DownloadCancelledError();
      const response = await fetch(`${DOWNLOADER_API_URL}/jobs/${jobId}`);
      if (!response.ok) throw new Error(await readError(response, 'Se perdió el estado de la descarga.'));
      job = await response.json() as JobState;
      if (job.status !== 'running') break;
      onProgress(job.phase === 'processing'
        ? { stage: 'processing', fraction: null }
        : { stage: 'server', fraction: typeof job.progress === 'number' ? job.progress : null });
      await wait(500);
    }
    if (job.status === 'cancelled' || cancelled) throw new DownloadCancelledError();
    if (job.status === 'error' || !job.result) throw new Error(job.error || 'No se pudo completar la descarga.');

    const result = absoluteResult(job.result);
    if (Platform.OS === 'web') {
      await Linking.openURL(result.fileUrl);
      return { result, uri: result.fileUrl };
    }
    if (!FileSystem.documentDirectory) throw new Error('El almacenamiento del dispositivo no está disponible.');
    const directory = `${FileSystem.documentDirectory}downloads/`;
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true }).catch(() => undefined);
    const target = `${directory}${Date.now()}-${result.filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    onProgress({ stage: 'transfer', fraction: 0 });
    resumable = FileSystem.createDownloadResumable(result.fileUrl, target, {}, ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
      const total = totalBytesExpectedToWrite > 0 ? totalBytesExpectedToWrite : result.sizeBytes ?? 0;
      onProgress({ stage: 'transfer', fraction: total > 0 ? Math.min(1, totalBytesWritten / total) : null });
    });
    const downloaded = await resumable.downloadAsync();
    if (cancelled) {
      await FileSystem.deleteAsync(target, { idempotent: true });
      throw new DownloadCancelledError();
    }
    if (!downloaded || downloaded.status >= 400) throw new Error('No se pudo copiar el archivo al iPhone.');
    return { result, uri: downloaded.uri };
  })();

  return { promise, cancel };
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

function utiFor(mimeType: string) {
  if (mimeType.startsWith('audio/')) return 'public.audio';
  if (mimeType.startsWith('image/')) return 'public.image';
  return 'public.movie';
}

export async function shareFile(uri: string, mimeType: string, filename: string) {
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType, dialogTitle: filename, UTI: utiFor(mimeType) });
  } else {
    await Linking.openURL(uri);
  }
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
  await shareFile(downloaded.uri, result.mimeType, result.filename);
  return downloaded.uri;
}

export async function loadDownloadHistory(): Promise<DownloadHistoryItem[]> {
  try {
    const raw = await AsyncStorage.getItem(HISTORY_KEY);
    const value: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(value) ? value.filter((item): item is DownloadHistoryItem => Boolean(item && typeof item.id === 'string' && typeof item.uri === 'string')) : [];
  } catch {
    return [];
  }
}

export async function saveDownloadHistory(items: DownloadHistoryItem[]) {
  await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, HISTORY_LIMIT)));
}

export async function fileExists(uri: string) {
  if (Platform.OS === 'web') return true;
  try {
    return (await FileSystem.getInfoAsync(uri)).exists;
  } catch {
    return false;
  }
}

export async function deleteLocalFile(uri: string) {
  if (Platform.OS === 'web') return;
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
}
