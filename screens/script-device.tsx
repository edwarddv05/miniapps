// What a miniapp can reach on the phone beyond drawing: place, sensors, voice,
// Face ID, notifications, sound, video, files and maps. Functions live in the
// runtime's scope; hooks and the Video and Map views read the running file
// from context, so every recording or file lands in that miniapp's folder.

import { RNHostView, VStack } from '@expo/ui/swift-ui';
import { frame } from '@expo/ui/swift-ui/modifiers';
import { RecordingPresets, createAudioPlayer, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Location from 'expo-location';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as Notifications from 'expo-notifications';
import { Accelerometer, Barometer, Gyroscope } from 'expo-sensors';
import * as Speech from 'expo-speech';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking, StyleSheet, View, type AppStateStatus } from 'react-native';
import NativeMap, { Marker, type Region } from 'react-native-maps';
import { deleteScriptMedia, extensionOf, readScriptMediaText, saveScriptMedia, scriptMediaUri, shareFile, temporaryTextFile } from '../script-files';
import { distanceMeters, isImageId, isMediaId, notificationTrigger, parseMiniappLink, type NotifyOptions, type Point } from '../script-runtime';
import { ScriptFileContext, common, resolveColor, useTokens, type ScriptLaunch, type ViewProps } from './script-context';
import { usePageWidth } from './shared';

/** A stored id becomes its file; a web or file URL is used as given. */
function mediaSource(fileName: string, source: unknown) {
  if (typeof source !== 'string' || !source) return null;
  if (isMediaId(source) || isImageId(source)) return scriptMediaUri(fileName, source);
  return /^(https?|file):\/\//i.test(source) ? source : null;
}

const fail = (message: string) => {
  throw new Error(message);
};

async function ensureLocation() {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) fail('Sin acceso a la ubicación. Actívalo en Ajustes de iOS.');
}

const toPlace = (position: Location.LocationObject) => ({
  latitude: position.coords.latitude,
  longitude: position.coords.longitude,
  altitude: position.coords.altitude,
  accuracy: position.coords.accuracy,
  speed: position.coords.speed,
  time: position.timestamp,
});

// ─── Notifications ─────────────────────────────────────────────────────────

/** Shows a miniapp's notification as a banner even while the app is open. Call once at start-up. */
export function installNotificationHandler() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

/** The miniapp a tapped notification belongs to, with the data it was scheduled with. */
export function notificationTarget(response: Notifications.NotificationResponse | null) {
  const data = response?.notification.request.content.data as { miniapp?: unknown; data?: unknown } | undefined;
  return typeof data?.miniapp === 'string' ? { name: data.miniapp, data: data.data ?? null } : null;
}

async function ensureNotifications() {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return;
  const asked = await Notifications.requestPermissionsAsync();
  if (!asked.granted) fail('Las notificaciones están desactivadas. Actívalas en Ajustes de iOS.');
}

// ─── Functions in a miniapp's scope ────────────────────────────────────────

type DeviceContext = { fileName: string; track: (cleanup: () => void) => () => void };

export function createDeviceApi({ fileName, track }: DeviceContext) {
  const own = (request: Notifications.NotificationRequest) => (request.content.data as { miniapp?: unknown } | undefined)?.miniapp === fileName;

  const notify = {
    schedule: async (options: NotifyOptions & { data?: unknown; sound?: boolean } = {}) => {
      const trigger = notificationTrigger(options);
      await ensureNotifications();
      return Notifications.scheduleNotificationAsync({
        content: { title: options.title ?? '', body: options.body ?? '', sound: options.sound !== false, data: { miniapp: fileName, data: options.data ?? null } },
        trigger: trigger === null ? null : trigger.type === 'date' ? { type: Notifications.SchedulableTriggerInputTypes.DATE, date: trigger.date }
          : trigger.type === 'timeInterval' ? { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: trigger.seconds, repeats: trigger.repeats }
          : trigger.type === 'daily' ? { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: trigger.hour, minute: trigger.minute }
          : { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: trigger.weekday, hour: trigger.hour, minute: trigger.minute },
      });
    },
    list: async () => (await Notifications.getAllScheduledNotificationsAsync()).filter(own).map((request) => ({
      id: request.identifier,
      title: request.content.title ?? '',
      body: request.content.body ?? '',
      data: (request.content.data as { data?: unknown }).data ?? null,
    })),
    cancel: async (id: string) => {
      const request = (await Notifications.getAllScheduledNotificationsAsync()).find((item) => item.identifier === id);
      if (request && own(request)) await Notifications.cancelScheduledNotificationAsync(id);
    },
    cancelAll: async () => {
      for (const request of (await Notifications.getAllScheduledNotificationsAsync()).filter(own)) await Notifications.cancelScheduledNotificationAsync(request.identifier);
    },
  };

  const location = {
    get: async (options: { precise?: boolean } = {}) => {
      await ensureLocation();
      return toPlace(await Location.getCurrentPositionAsync({ accuracy: options.precise ? Location.Accuracy.High : Location.Accuracy.Balanced }));
    },
    address: async (point: Point) => {
      const [place] = await Location.reverseGeocodeAsync({ latitude: Number(point.latitude), longitude: Number(point.longitude) });
      if (!place) return null;
      const text = [place.street && place.streetNumber ? `${place.street} ${place.streetNumber}` : place.street ?? place.name, place.district, place.city].filter(Boolean).join(', ');
      return { text, name: place.name, street: place.street, number: place.streetNumber, district: place.district, city: place.city, region: place.region, country: place.country, postalCode: place.postalCode };
    },
    search: async (query: string) => (await Location.geocodeAsync(String(query))).map(({ latitude, longitude }) => ({ latitude, longitude })),
    distance: (a: Point, b: Point) => distanceMeters(a, b),
  };

  const speak = (text: string, options: { language?: string; rate?: number; pitch?: number } = {}) => new Promise<void>((resolve) => {
    Speech.speak(String(text), { language: options.language ?? 'es-ES', rate: options.rate, pitch: options.pitch, onDone: () => resolve(), onStopped: () => resolve(), onError: () => resolve() });
  });
  track(() => void Speech.stop());

  const authenticate = async (reason = 'Desbloquear') => {
    const result = await LocalAuthentication.authenticateAsync({ promptMessage: String(reason), cancelLabel: 'Cancelar' });
    return result.success;
  };

  const playSound = async (source: string, options: { volume?: number } = {}) => {
    const uri = mediaSource(fileName, source);
    if (!uri) fail('Sonido no válido.');
    await setAudioModeAsync({ playsInSilentMode: true });
    const player = createAudioPlayer({ uri: uri! });
    if (options.volume !== undefined) player.volume = Math.max(0, Math.min(1, Number(options.volume)));
    return new Promise<void>((resolve) => {
      let untrack = () => {};
      const finish = () => {
        subscription.remove();
        untrack();
        player.remove();
        resolve();
      };
      const subscription = player.addListener('playbackStatusUpdate', (status) => {
        if (status.didJustFinish) finish();
      });
      untrack = track(finish);
      player.play();
    });
  };

  const saveVideos = async (assets: ImagePicker.ImagePickerAsset[]) => {
    const saved = [];
    for (const asset of assets) {
      const id = await saveScriptMedia(fileName, asset.uri, 'vid', extensionOf(asset.fileName ?? asset.uri) || 'mov');
      saved.push({ id, width: asset.width, height: asset.height, duration: (asset.duration ?? 0) / 1000 });
    }
    return saved;
  };
  const pickVideos = async (options: { multiple?: boolean; limit?: number } = {}) => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], allowsMultipleSelection: options.multiple === true, selectionLimit: options.multiple ? Math.max(1, options.limit ?? 5) : 1 });
    return result.canceled ? [] : saveVideos(result.assets);
  };
  const recordVideo = async (options: { maxSeconds?: number } = {}) => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) fail('Sin acceso a la cámara. Actívalo en Ajustes de iOS.');
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['videos'], videoMaxDuration: options.maxSeconds });
    return result.canceled ? null : (await saveVideos(result.assets))[0] ?? null;
  };

  const pickFiles = async (options: { types?: string[]; multiple?: boolean } = {}) => {
    const result = await DocumentPicker.getDocumentAsync({ type: options.types?.length ? options.types : '*/*', copyToCacheDirectory: true, multiple: options.multiple === true });
    if (result.canceled || !result.assets?.length) return [];
    const saved = [];
    for (const asset of result.assets) {
      const id = await saveScriptMedia(fileName, asset.uri, 'fil', extensionOf(asset.name) || 'bin', true);
      saved.push({ id, name: asset.name, size: asset.size ?? null, type: asset.mimeType ?? null });
    }
    return saved;
  };

  return {
    notify,
    location,
    speak,
    stopSpeaking: () => Speech.stop(),
    authenticate,
    playSound,
    pickVideos,
    recordVideo,
    pickFiles,
    readFile: (id: string) => readScriptMediaText(fileName, String(id)),
    saveFile: async (name: string, text: string) => saveScriptMedia(fileName, await temporaryTextFile(String(name), String(text)), 'fil', extensionOf(String(name)) || 'txt', true),
    exportFile: async (name: string, text: string, mimeType?: string) => shareFile(await temporaryTextFile(String(name), String(text)), mimeType),
    shareFile: (id: string) => {
      const uri = scriptMediaUri(fileName, String(id));
      return uri ? shareFile(uri) : Promise.reject(new Error('Archivo no válido.'));
    },
    fileUri: (id: string) => scriptMediaUri(fileName, String(id)),
    // Asks only to add, so the miniapp never sees the photo library.
    saveToPhotos: async (id: string) => {
      const uri = scriptMediaUri(fileName, String(id));
      if (!uri || !(isImageId(id) || /^vid-/.test(String(id)))) fail('Solo se pueden guardar fotos y videos de la miniapp.');
      const permission = await MediaLibrary.requestPermissionsAsync(true);
      if (!permission.granted) fail('Sin permiso para guardar en Fotos. Actívalo en Ajustes de iOS.');
      await MediaLibrary.saveToLibraryAsync(uri!);
    },
    deleteFile: (id: string) => deleteScriptMedia(fileName, String(id)),
    openBrowser: (url: string) => WebBrowser.openBrowserAsync(String(url)),
    openMaps: (target: string | (Point & { title?: string })) => Linking.openURL(typeof target === 'string'
      ? `maps://?q=${encodeURIComponent(target)}`
      : `maps://?ll=${target.latitude},${target.longitude}&q=${encodeURIComponent(target.title ?? 'Ubicación')}`),
  };
}

// ─── Hooks ─────────────────────────────────────────────────────────────────

/** Follows the phone's position while the view is on screen. */
export function useLocation(options: { precise?: boolean; distance?: number } = {}) {
  const [place, setPlace] = useState<ReturnType<typeof toPlace> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const precise = options.precise === true;
  const distance = options.distance ?? 10;
  useEffect(() => {
    let cancelled = false;
    let subscription: { remove: () => void } | null = null;
    void (async () => {
      try {
        await ensureLocation();
        const watch = await Location.watchPositionAsync({ accuracy: precise ? Location.Accuracy.High : Location.Accuracy.Balanced, distanceInterval: distance }, (position) => setPlace(toPlace(position)));
        if (cancelled) watch.remove();
        else subscription = watch;
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'No se pudo obtener la ubicación.');
      }
    })();
    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [precise, distance]);
  return { location: place, error };
}

/** Compass heading in degrees from north, or null until the first reading. */
export function useHeading() {
  const [heading, setHeading] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    let subscription: { remove: () => void } | null = null;
    void (async () => {
      try {
        await ensureLocation();
        const watch = await Location.watchHeadingAsync((value) => setHeading(value.trueHeading >= 0 ? value.trueHeading : value.magHeading));
        if (cancelled) watch.remove();
        else subscription = watch;
      } catch {
        // Without access the heading stays null.
      }
    })();
    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, []);
  return heading;
}

type Sensor<T> = { isAvailableAsync: () => Promise<boolean>; setUpdateInterval: (ms: number) => void; addListener: (listener: (data: T) => void) => { remove: () => void } };

function useSensor<T>(sensor: Sensor<T>, interval: number) {
  const [reading, setReading] = useState<T | null>(null);
  useEffect(() => {
    let cancelled = false;
    let subscription: { remove: () => void } | null = null;
    sensor.isAvailableAsync().then((available) => {
      if (!available || cancelled) return;
      sensor.setUpdateInterval(Math.max(16, interval));
      subscription = sensor.addListener(setReading);
    }, () => {});
    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [sensor, interval]);
  return reading;
}

/** Acceleration in g on each axis. */
export const useAccelerometer = (interval = 100) => useSensor(Accelerometer as unknown as Sensor<{ x: number; y: number; z: number }>, interval);
/** Rotation in radians per second on each axis. */
export const useGyroscope = (interval = 100) => useSensor(Gyroscope as unknown as Sensor<{ x: number; y: number; z: number }>, interval);
/** Air pressure in hPa, and the change in height in metres since it started. */
export const useBarometer = (interval = 500) => useSensor(Barometer as unknown as Sensor<{ pressure: number; relativeAltitude?: number }>, interval);

/** 'active', 'inactive' or 'background'; `onChange` runs on each change. */
export function useAppState(onChange?: (state: AppStateStatus) => void) {
  const [state, setState] = useState(AppState.currentState);
  const latest = useRef(onChange);
  latest.current = onChange;
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      setState(next);
      latest.current?.(next);
    });
    return () => subscription.remove();
  }, []);
  return state;
}

/** Records from the microphone; stop() keeps the recording and returns its id. */
export function useRecorder() {
  const fileName = useContext(ScriptFileContext);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 200);
  const duration = useRef(0);
  duration.current = state.durationMillis;
  const start = useCallback(async () => {
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) fail('Sin acceso al micrófono. Actívalo en Ajustes de iOS.');
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
  }, [recorder]);
  const stop = useCallback(async () => {
    const seconds = duration.current / 1000;
    await recorder.stop();
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    if (!recorder.uri) return null;
    return { id: await saveScriptMedia(fileName, recorder.uri, 'aud', extensionOf(recorder.uri) || 'm4a', true), duration: seconds };
  }, [recorder, fileName]);
  return { recording: state.isRecording, seconds: state.durationMillis / 1000, start, stop };
}

/** Plays a recording by id, or a sound by URL. */
export function usePlayer(source: string | null) {
  const fileName = useContext(ScriptFileContext);
  const uri = mediaSource(fileName, source);
  const player = useAudioPlayer(uri ? { uri } : null, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  useEffect(() => {
    void setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
  }, []);
  const ended = status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration - 0.05);
  return useMemo(() => {
    const play = () => {
      if (ended) void player.seekTo(0);
      player.play();
    };
    return {
      playing: status.playing,
      position: status.currentTime,
      duration: status.duration,
      loaded: status.isLoaded,
      play,
      pause: () => player.pause(),
      toggle: () => (status.playing ? player.pause() : play()),
      seek: (seconds: number) => player.seekTo(Number(seconds)),
    };
  }, [player, status.playing, status.currentTime, status.duration, status.isLoaded, ended]);
}

// ─── Views ─────────────────────────────────────────────────────────────────

/** A video by id (from pickVideos/recordVideo) or URL. Full width unless `width` says otherwise. */
export function Video({ source, autoplay, loop, muted, controls = true, fit = 'contain', aspect = 16 / 9, width, height, ...rest }: ViewProps & { source?: string; autoplay?: boolean; loop?: boolean; muted?: boolean; controls?: boolean; fit?: 'contain' | 'cover'; aspect?: number }) {
  const tokens = useTokens();
  const uri = mediaSource(useContext(ScriptFileContext), source);
  const pageWidth = usePageWidth();
  const player = useVideoPlayer(uri ? { uri } : null, (instance) => {
    instance.loop = loop === true;
    instance.muted = muted === true;
    if (autoplay) instance.play();
  });
  useEffect(() => {
    player.loop = loop === true;
    player.muted = muted === true;
  }, [player, loop, muted]);
  if (!uri) return null;
  const w = width ?? pageWidth;
  return <VStack modifiers={[frame({ width: w, height: height ?? Math.round(w / (aspect > 0 ? aspect : 16 / 9)) }), ...common(rest, tokens)]}>
    <RNHostView>
      <View style={{ flex: 1, backgroundColor: '#000000' }}>
        <VideoView player={player} style={StyleSheet.absoluteFill} nativeControls={controls} contentFit={fit} allowsPictureInPicture={false} />
      </View>
    </RNHostView>
  </VStack>;
}

type MapMarker = Point & { title?: string; detail?: string; color?: string; id?: string | number };

/** Apple Maps around a point or the markers. `onPress` gets the tapped point; `onPressMarker` the marker. */
// Named MapView so a miniapp's own `new Map()` keeps working.
export function MapView({ latitude, longitude, span, markers = [], showsUser, onPress, onPressMarker, width, height = 260, ...rest }: ViewProps & { latitude?: number; longitude?: number; span?: number; markers?: MapMarker[]; showsUser?: boolean; onPress?: (point: Point) => void; onPressMarker?: (marker: MapMarker) => void }) {
  const tokens = useTokens();
  const pageWidth = usePageWidth();
  const map = useRef<NativeMap>(null);
  const region = useMemo((): Region => {
    if (latitude !== undefined && longitude !== undefined) return { latitude, longitude, latitudeDelta: span ?? 0.02, longitudeDelta: span ?? 0.02 };
    if (markers.length) {
      const lats = markers.map((marker) => marker.latitude);
      const lons = markers.map((marker) => marker.longitude);
      const pad = (values: number[]) => Math.max(span ?? 0.01, (Math.max(...values) - Math.min(...values)) * 1.4);
      return { latitude: (Math.max(...lats) + Math.min(...lats)) / 2, longitude: (Math.max(...lons) + Math.min(...lons)) / 2, latitudeDelta: pad(lats), longitudeDelta: pad(lons) };
    }
    // Lima, until the miniapp gives a place.
    return { latitude: -12.0464, longitude: -77.0428, latitudeDelta: span ?? 0.2, longitudeDelta: span ?? 0.2 };
  }, [latitude, longitude, span, markers]);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    map.current?.animateToRegion(region, 300);
  }, [region]);
  return <VStack modifiers={[frame({ width: width ?? pageWidth, height }), ...common(rest, tokens)]}>
    <RNHostView>
      <View style={{ flex: 1 }}>
        <NativeMap
          ref={map}
          style={StyleSheet.absoluteFill}
          initialRegion={region}
          showsUserLocation={showsUser === true}
          userInterfaceStyle={tokens.mode}
          onPress={onPress ? (event) => onPress(event.nativeEvent.coordinate) : undefined}
        >
          {markers.map((marker, index) => {
            const color = resolveColor(marker.color, tokens);
            return <Marker
              key={String(marker.id ?? index)}
              coordinate={{ latitude: marker.latitude, longitude: marker.longitude }}
              title={marker.title}
              description={marker.detail}
              pinColor={typeof color === 'string' ? color : undefined}
              onPress={onPressMarker ? () => onPressMarker(marker) : undefined}
            />;
          })}
        </NativeMap>
      </View>
    </RNHostView>
  </VStack>;
}

export const DEVICE_HOOKS = { useLocation, useHeading, useAccelerometer, useGyroscope, useBarometer, useAppState, useRecorder, usePlayer };
export const DEVICE_COMPONENTS = { Video, MapView };

/**
 * Opens a miniapp from a miniapps://abrir/<Nombre> link or a tapped
 * notification, including the one that launched the app. Returns the cleanup.
 */
export function listenForMiniappOpens(open: (name: string, launch: ScriptLaunch) => void) {
  const fromUrl = (url: string | null) => {
    const link = url ? parseMiniappLink(url) : null;
    if (link) open(link.name, { source: 'link', data: link.params });
  };
  const fromResponse = (response: Notifications.NotificationResponse | null) => {
    const target = notificationTarget(response);
    if (!target) return;
    Notifications.clearLastNotificationResponse();
    open(target.name, { source: 'notification', data: target.data });
  };
  void Linking.getInitialURL().then(fromUrl, () => {});
  void Notifications.getLastNotificationResponseAsync().then(fromResponse, () => {});
  const links = Linking.addEventListener('url', (event) => fromUrl(event.url));
  const taps = Notifications.addNotificationResponseReceivedListener(fromResponse);
  return () => {
    links.remove();
    taps.remove();
  };
}
