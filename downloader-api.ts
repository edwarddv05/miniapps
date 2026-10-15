import { Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { SuperappNative } from './modules/superapp-native';

export type DownloadMode = 'video' | 'audio' | 'image' | 'thumbnail';

export type DownloadQuality = {
  id: string;
  label: string;
  height: number;
  /** yt-dlp's estimate of the saved file; null when the site does not say. */
  sizeBytes: number | null;
};

export type DownloadVideo = {
  id: string;
  title: string;
  url: string;
  durationSeconds?: number | null;
};

export type DownloadItem = {
  id: string;
  index: number;
  kind: 'video' | 'image';
  previewUrl: string | null;
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
  previewRelayUrl: string | null;
  /** Dominant colour of the thumbnail (#RRGGBB) for the page's ambient glow. */
  ambientColor: string | null;
  /** YouTube's HLS master playlist: picture, sound and every dub in one stream. */
  previewHlsUrl: string | null;
  /** Separate sound for previews whose video stream is silent (YouTube): direct from the site, then through the PC. */
  previewAudioSources: string[];
  /** Dubbed languages, original first; empty when the video has one track. */
  audioTracks: AudioTrack[];
  mediaUrl: string | null;
  aspectRatio: number | null;
  modes: DownloadMode[];
  items: DownloadItem[];
  videoCount: number;
  videos: DownloadVideo[];
  qualities: DownloadQuality[];
  /** Estimated weight of the audio download; null when unknown. */
  audioSizeBytes: number | null;
};

export type AudioTrack = {
  id: string;
  label: string;
  original: boolean;
  /** Direct from the site first, then through the PC. */
  previewSources: string[];
};

export type DownloadResult = {
  fileUrl: string;
  filename: string;
  mimeType: string;
  sizeBytes?: number | null;
};

export type DownloadProgress = {
  /** `preparing` while the PC joins video and audio into one MP4 the iPhone can keep. */
  stage: 'preparing' | 'downloading';
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
  /** Measured on the iPhone after saving; older entries get it on load. */
  sizeBytes?: number | null;
  durationSeconds?: number | null;
};

/**
 * The standalone build carries yt-dlp inside the app; Expo Go and web still
 * use the PC service.
 */
export const LOCAL_DOWNLOADER = Boolean(SuperappNative);

type LocalJob = {
  status: 'running' | 'done' | 'error' | 'cancelled';
  progress?: number | null;
  error?: string;
  result?: { files: string[]; post: 'none' | 'merge' | 'remux-video' | 'remux-audio'; filename: string; mimeType: string };
};

async function localCall<T>(name: string, payload: Record<string, unknown>): Promise<T> {
  if (!SuperappNative) throw new Error('El descargador no está disponible en esta versión de la app.');
  const envelope = JSON.parse(await SuperappNative.python(name, JSON.stringify(payload))) as { ok: boolean; value?: T; error?: string };
  if (!envelope.ok) throw new Error(envelope.error || 'No se pudo procesar el enlace.');
  return envelope.value as T;
}

const DEFAULT_DOWNLOADER_API_URL = 'http://192.168.101.3:8787';
const configuredApiUrl = typeof process !== 'undefined' ? process.env?.EXPO_PUBLIC_DOWNLOADER_API_URL : undefined;
const SERVER_KEY = '@miniapps/downloader-url';
// The address set in Ajustes wins over the build's; it is read once at launch.
let DOWNLOADER_API_URL = (configuredApiUrl || DEFAULT_DOWNLOADER_API_URL).replace(/\/$/, '');

export function downloaderUrl() {
  return DOWNLOADER_API_URL;
}

/** "192.168.1.5:8787" or "http://pc.local:8787/" → "http://192.168.1.5:8787"; null when it is not an address. */
export function normalizeServerUrl(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  // Another scheme ("ftp://") is not the service; no scheme means http.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && !/^https?:\/\//i.test(value)) return null;
  try {
    const parsed = new URL(/^https?:\/\//i.test(value) ? value : `http://${value}`);
    // A bare word is a typo, not a host: an address has a dot, a port or is localhost.
    if (!parsed.hostname || !(parsed.hostname.includes('.') || parsed.port || parsed.hostname === 'localhost')) return null;
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

export async function loadDownloaderUrl() {
  try {
    const stored = normalizeServerUrl((await AsyncStorage.getItem(SERVER_KEY)) ?? '');
    if (stored) DOWNLOADER_API_URL = stored;
  } catch {
    // The build's address stays in use.
  }
  return DOWNLOADER_API_URL;
}

export async function saveDownloaderUrl(url: string) {
  await AsyncStorage.setItem(SERVER_KEY, url);
  DOWNLOADER_API_URL = url;
}

/** Whether the service answers at that address, within a few seconds. */
export async function checkDownloader(url = DOWNLOADER_API_URL): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(`${url}/health`, { signal: controller.signal });
    const body = await response.json() as { ok?: boolean };
    return response.ok && body?.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
const HISTORY_KEY = '@miniapps/downloads';
const HISTORY_LIMIT = 20;
const MODES: DownloadMode[] = ['video', 'audio', 'image', 'thumbnail'];

export class DownloadCancelledError extends Error {
  constructor() {
    super('Descarga cancelada.');
  }
}

export function downloaderErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  if (LOCAL_DOWNLOADER) return error.message || fallback;
  // iOS reports unreachable hosts as timeouts or "fetch failed" with native stack details.
  if (/fetch failed|failed to fetch|network request failed|network connection|could not connect|timed out|offline|cannot find host/i.test(error.message)) {
    return `No se pudo conectar con el servicio en ${DOWNLOADER_API_URL}. Verifica que esté encendido y en la misma red, o cambia la dirección en Ajustes.`;
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

// A direct CDN link first, then the PC relay path (made absolute) as fallback.
function sources(direct: unknown, relay: unknown) {
  return [text(direct), text(relay) ? new URL(relay as string, `${DOWNLOADER_API_URL}/`).toString() : null].filter((value): value is string => Boolean(value));
}

export async function analyzeUrl(input: string, signal?: AbortSignal): Promise<DownloadAnalysis> {
  const url = assertUrl(input);
  if (LOCAL_DOWNLOADER) {
    const result = await localCall<Record<string, unknown>>('analyze', { url });
    const analysis = readAnalysis(result);
    if (analysis.thumbnail && !signal?.aborted) analysis.ambientColor = await SuperappNative!.ambientColor(analysis.thumbnail).catch(() => null);
    return analysis;
  }
  const response = await fetch(`${DOWNLOADER_API_URL}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
    signal,
  });

  if (!response.ok) throw new Error(await readError(response, 'No se pudo analizar el enlace.'));
  return readAnalysis(await response.json() as Record<string, unknown>);
}

function readAnalysis(result: Record<string, unknown>): DownloadAnalysis {
  const videos = Array.isArray(result.videos)
    ? result.videos.filter((video): video is DownloadVideo => Boolean(video && typeof video.id === 'string' && typeof video.title === 'string' && typeof video.url === 'string'))
    : [];
  const qualities = Array.isArray(result.qualities)
    ? result.qualities.flatMap((quality) => quality && typeof quality.id === 'string' && typeof quality.label === 'string' && typeof quality.height === 'number'
      ? [{ id: quality.id, label: quality.label, height: quality.height, sizeBytes: positive(quality.sizeBytes) }]
      : [])
    : [];
  const items: DownloadItem[] = Array.isArray(result.items)
    ? result.items.flatMap((item) => item && typeof item.id === 'string' && typeof item.url === 'string' && (item.kind === 'video' || item.kind === 'image')
      ? [{ id: item.id, index: typeof item.index === 'number' ? item.index : 0, kind: item.kind, title: text(item.title) ?? 'Elemento', url: item.url, mediaUrl: text(item.mediaUrl), previewUrl: text(item.previewUrl), thumbnail: text(item.thumbnail), durationSeconds: positive(item.durationSeconds) }]
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
    previewRelayUrl: text(result.previewRelayUrl) ? new URL(result.previewRelayUrl as string, `${DOWNLOADER_API_URL}/`).toString() : null,
    previewHlsUrl: text(result.previewHlsUrl),
    ambientColor: typeof result.ambientColor === 'string' && /^#[0-9a-f]{6}$/i.test(result.ambientColor) ? result.ambientColor : null,
    previewAudioSources: sources(result.previewAudioDirectUrl, result.previewAudioUrl),
    audioTracks: Array.isArray(result.audioTracks)
      ? result.audioTracks.flatMap((track) => track && typeof track.id === 'string' && typeof track.label === 'string'
        ? [{ id: track.id, label: track.label, original: Boolean(track.original), previewSources: sources(track.previewDirectUrl, track.previewUrl) }]
        : [])
      : [],
    mediaUrl: text(result.mediaUrl),
    aspectRatio: positive(result.aspectRatio),
    modes: modes.length ? modes : ['video', 'audio'],
    items,
    videoCount: positive(result.videoCount) ?? Math.max(items.length, videos.length, 1),
    videos,
    qualities,
    audioSizeBytes: positive(result.audioSizeBytes),
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

type DownloadPlan = {
  strategy: 'direct' | 'relay' | 'merge';
  url: string | null;
  headers: Record<string, string>;
  relayUrl: string;
  filename: string;
  mimeType: string;
  sizeBytes: number | null;
};

export type DownloadTask = {
  promise: Promise<{ result: DownloadResult; uri: string }>;
  cancel: () => void;
};

/**
 * Downloads straight to the phone. The PC only resolves the media URL and
 * passes bytes through when the site refuses the phone. When video and audio
 * come apart (YouTube, Facebook) the PC first joins them into a normal MP4 the
 * iPhone can save to Photos, then deletes it once sent.
 */
type DownloadParams = { url: string; mode: DownloadMode; quality?: number | null; mediaUrl?: string | null; itemIndex?: number | null; audioLanguage?: string | null };

async function downloadTarget(filename: string) {
  if (!FileSystem.documentDirectory) throw new Error('El almacenamiento del dispositivo no está disponible.');
  const directory = `${FileSystem.documentDirectory}downloads/`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true }).catch(() => undefined);
  return `${directory}${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
}

const fileUri = (path: string) => (path.startsWith('file://') ? path : `file://${encodeURI(path)}`);

/**
 * yt-dlp inside the app downloads the streams; separate video and audio
 * (YouTube, Facebook) are then joined natively into an MP4 Photos accepts.
 */
function startLocalDownload(params: DownloadParams, onProgress: (progress: DownloadProgress) => void): DownloadTask {
  let cancelled = false;
  let jobId: string | null = null;
  const cancel = () => {
    cancelled = true;
    if (jobId) void localCall('cancel', { jobId }).catch(() => undefined);
  };

  const promise = (async () => {
    const url = assertUrl(params.url);
    onProgress({ stage: 'downloading', fraction: null });
    const started = await localCall<{ jobId: string }>('start', { ...params, url });
    jobId = started.jobId;
    if (cancelled) cancel();
    let job: LocalJob;
    for (;;) {
      job = await localCall<LocalJob>('status', { jobId: started.jobId });
      if (job.status !== 'running') break;
      onProgress({ stage: 'downloading', fraction: typeof job.progress === 'number' ? job.progress : null });
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    if (job.status === 'cancelled' || cancelled) throw new DownloadCancelledError();
    if (job.status === 'error' || !job.result) throw new Error(job.error || 'No se pudo completar la descarga.');

    const { files, post, filename, mimeType } = job.result;
    const target = await downloadTarget(filename);
    try {
      onProgress({ stage: 'preparing', fraction: null });
      if (post === 'merge') {
        await SuperappNative!.joinMedia(files[0], files[1], target);
      } else if (post === 'remux-video' || post === 'remux-audio') {
        // A file AVFoundation cannot rewrite is still kept as it came.
        const rewrite = post === 'remux-video' ? SuperappNative!.joinMedia(files[0], null, target) : SuperappNative!.remuxAudio(files[0], target);
        await rewrite.catch(() => FileSystem.moveAsync({ from: fileUri(files[0]), to: target }));
      } else {
        await FileSystem.moveAsync({ from: fileUri(files[0]), to: target });
      }
    } finally {
      void localCall('release', { jobId: started.jobId }).catch(() => undefined);
    }
    if (cancelled) {
      await FileSystem.deleteAsync(target, { idempotent: true });
      throw new DownloadCancelledError();
    }
    const info = await FileSystem.getInfoAsync(target);
    return { result: { fileUrl: target, filename, mimeType, sizeBytes: info.exists ? info.size : null }, uri: target };
  })();

  return { promise, cancel };
}

export function startDownload(params: DownloadParams, onProgress: (progress: DownloadProgress) => void): DownloadTask {
  if (LOCAL_DOWNLOADER) return startLocalDownload(params, onProgress);
  let cancelled = false;
  let resumable: FileSystem.DownloadResumable | null = null;
  let preparing: string | null = null;

  const cancel = () => {
    cancelled = true;
    void resumable?.cancelAsync().catch(() => undefined);
    if (preparing) void fetch(preparing, { method: 'DELETE' }).catch(() => undefined);
  };

  const fetchTo = async (source: string, headers: Record<string, string>, target: string, expected: number | null) => {
    onProgress({ stage: 'downloading', fraction: expected ? 0 : null });
    resumable = FileSystem.createDownloadResumable(source, target, { headers }, ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
      const total = totalBytesExpectedToWrite > 0 ? totalBytesExpectedToWrite : expected ?? 0;
      onProgress({ stage: 'downloading', fraction: total > 0 ? Math.min(1, totalBytesWritten / total) : null });
    });
    const downloaded = await resumable.downloadAsync();
    if (cancelled) throw new DownloadCancelledError();
    if (!downloaded || downloaded.status >= 400) {
      await FileSystem.deleteAsync(target, { idempotent: true });
      throw new Error('No se pudo descargar el archivo.');
    }
    return downloaded.uri;
  };

  const promise = (async () => {
    const url = assertUrl(params.url);
    onProgress({ stage: 'downloading', fraction: null });
    const response = await fetch(`${DOWNLOADER_API_URL}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, mode: params.mode, quality: params.quality ?? null, mediaUrl: params.mediaUrl ?? null, itemIndex: params.itemIndex ?? null, audioLanguage: params.audioLanguage ?? null }),
    });
    if (!response.ok) throw new Error(await readError(response, 'No se pudo preparar la descarga.'));
    const plan = await response.json() as DownloadPlan;
    if (cancelled) throw new DownloadCancelledError();
    const relayUrl = new URL(plan.relayUrl, `${DOWNLOADER_API_URL}/`).toString();
    const result: DownloadResult = { fileUrl: plan.url ?? relayUrl, filename: plan.filename, mimeType: plan.mimeType, sizeBytes: plan.sizeBytes };

    if (Platform.OS === 'web') {
      await Linking.openURL(relayUrl);
      return { result, uri: relayUrl };
    }
    const target = await downloadTarget(plan.filename);

    if (plan.strategy === 'direct' && plan.url) {
      try {
        return { result, uri: await fetchTo(plan.url, plan.headers, target, plan.sizeBytes) };
      } catch (error) {
        if (cancelled || error instanceof DownloadCancelledError) throw new DownloadCancelledError();
        // The site refused the phone (different IP or headers): fall back to the PC relay.
      }
    }
    if (plan.strategy === 'merge') {
      preparing = relayUrl;
      const started = await fetch(`${relayUrl}/start`, { method: 'POST' });
      if (!started.ok) throw new Error(await readError(started, 'No se pudo preparar el video.'));
      let size: number | null = null;
      for (;;) {
        if (cancelled) throw new DownloadCancelledError();
        const state = await (await fetch(`${relayUrl}/status`)).json() as { status: string; progress?: number | null; error?: string; size?: number };
        if (state.status === 'error') throw new Error(state.error || 'No se pudo preparar el video.');
        if (state.status === 'done') {
          size = state.size ?? null;
          break;
        }
        onProgress({ stage: 'preparing', fraction: typeof state.progress === 'number' ? state.progress : null });
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
      const uri = await fetchTo(relayUrl, {}, target, size);
      preparing = null;
      return { result: { ...result, sizeBytes: size }, uri };
    }
    return { result, uri: await fetchTo(relayUrl, {}, target, plan.sizeBytes) };
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

/**
 * Downloads finished by the Shortcuts action while the app was closed. The
 * native side lists them in downloads/background.json; reading takes them.
 */
export async function takeBackgroundDownloads(): Promise<DownloadHistoryItem[]> {
  if (Platform.OS === 'web' || !FileSystem.documentDirectory) return [];
  const path = `${FileSystem.documentDirectory}downloads/background.json`;
  try {
    if (!(await FileSystem.getInfoAsync(path)).exists) return [];
    const value: unknown = JSON.parse(await FileSystem.readAsStringAsync(path));
    await FileSystem.deleteAsync(path, { idempotent: true });
    return Array.isArray(value) ? value.filter((item): item is DownloadHistoryItem => Boolean(item && typeof item.id === 'string' && typeof item.uri === 'string' && typeof item.createdAt === 'number')) : [];
  } catch {
    return [];
  }
}

export async function fileExists(uri: string) {
  if (Platform.OS === 'web') return true;
  try {
    return (await FileSystem.getInfoAsync(uri)).exists;
  } catch {
    return false;
  }
}

export async function fileSize(uri: string): Promise<number | null> {
  if (Platform.OS === 'web') return null;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists && !info.isDirectory ? info.size : null;
  } catch {
    return null;
  }
}

/** "4,1 MB", "120 MB", "1,2 GB", "180 KB". */
export function formatBytes(bytes: number) {
  const mb = bytes / 1_000_000;
  if (mb >= 1000) return `${(mb / 1000).toFixed(1).replace('.', ',')} GB`;
  if (mb >= 10) return `${Math.round(mb)} MB`;
  if (mb >= 1) return `${mb.toFixed(1).replace('.', ',')} MB`;
  return `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

export async function deleteLocalFile(uri: string) {
  if (Platform.OS === 'web') return;
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
}
