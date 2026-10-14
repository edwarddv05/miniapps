// Downloader: preview player, download bar and recent downloads.

import * as Haptics from 'expo-haptics';
import { Button as NativeButton, ContextMenu, Divider, HStack, Menu, Section, Toggle, Image as NativeImage, Picker, ProgressView, RNHostView, ScrollView, Spacer, Text as NativeText, TextField, type TextFieldRef, VStack, ZStack, useNativeState } from '@expo/ui/swift-ui';
import { accessibilityLabel, accessibilityAddTraits, accessibilityElement, accessibilityHidden, accessibilityValue, animation, Animation, blur, clipped, buttonStyle, clipShape, contentShape, controlSize, disabled, font, frame, glassEffect, autocorrectionDisabled, keyboardType, textInputAutocapitalization, lineLimit, listRowInsets, menuIndicator, monospacedDigit, onSubmit, offset, onGeometryChange, onTapGesture, opacity, padding, pickerStyle, resizable, scrollDismissesKeyboard, shadow, shapes, submitLabel, symbolEffect, tag, textFieldStyle, type ViewModifier } from '@expo/ui/swift-ui/modifiers';
import type { SFSymbol } from 'sf-symbols-typescript';
import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Image as RNImage, Pressable, ScrollView as ScrollViewRN, StyleSheet, useWindowDimensions, View } from 'react-native';
import FontAwesome6 from '@expo/vector-icons/FontAwesome6';
import * as Clipboard from 'expo-clipboard';
import { Asset } from 'expo-asset';
import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { UI } from '../ui-structure';
import { analyzeUrl, checkDownloader, LOCAL_DOWNLOADER, downloaderUrl, loadDownloaderUrl, normalizeServerUrl, saveDownloaderUrl, deleteLocalFile, detectDownloadSource, DownloadCancelledError, downloaderErrorMessage, fileExists, formatDuration, loadDownloadHistory, saveDownloadHistory, shareFile, sourceForKey, startDownload, type DownloadAnalysis, type DownloadHistoryItem, type DownloadItem, type DownloadMode, type DownloadTask, type SourceKey } from '../downloader-api';
import { background, foregroundStyle, tint } from '../native-colors';
import { LiquidProgress, PopIn } from '../modules/superapp-native/animations';
import { PageNative, alertUnsaved, SectionHeadingNative, SymbolImage, type ThemeTokens, makeId, nativeGlassAvailable, textModifiers, usePageWidth } from './shared';

const BRAND_ICONS: Record<Exclude<SourceKey, 'other'>, { glyph: string; background: string; foreground: string }> = {
  youtube: { glyph: 'youtube', background: '#FF0033', foreground: '#FFFFFF' },
  instagram: { glyph: 'instagram', background: '#E1306C', foreground: '#FFFFFF' },
  facebook: { glyph: 'facebook', background: '#0866FF', foreground: '#FFFFFF' },
  x: { glyph: 'x-twitter', background: '#000000', foreground: '#FFFFFF' },
  tiktok: { glyph: 'tiktok', background: '#000000', foreground: '#FFFFFF' },
};

// Brand marks are not SF Symbols, so the glyph comes from Font Awesome's brand
// set hosted as a small React Native view inside the SwiftUI row.
function SourceIconNative({ source, tokens, size = 34 }: { source: SourceKey; tokens: ThemeTokens; size?: number }) {
  const label = sourceForKey(source).label;
  if (source === 'other') {
    return <ZStack alignment="center" modifiers={[frame({ width: size, height: size }), background(tokens.slateSoft), clipShape('roundedRectangle', size * 0.28), accessibilityLabel(label)]}>
      <NativeImage systemName="globe" modifiers={[font({ size: size * 0.5 }), foregroundStyle(tokens.slate)]} />
    </ZStack>;
  }
  const brand = BRAND_ICONS[source];
  const dark = tokens.mode === 'dark' && brand.background === '#000000';
  return <VStack modifiers={[frame({ width: size, height: size }), clipShape('roundedRectangle', size * 0.28), accessibilityLabel(label)]}>
    <RNHostView>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: dark ? '#FFFFFF' : brand.background }}>
        <FontAwesome6 name={brand.glyph} brand size={Math.round(size * 0.55)} color={dark ? '#000000' : brand.foreground} />
      </View>
    </RNHostView>
  </VStack>;
}

function clockLabel(seconds: number) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const rest = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

// Icons from the Video.js v10 default set (Apache-2.0, see
// assets/player/LICENSE-videojs.txt), rasterised white because SwiftUI images
// from Expo UI load bitmaps, not SVG.
const PLAYER_ICON_MODULES = {
  play: require('../assets/player/play.png'),
  pause: require('../assets/player/pause.png'),
  restart: require('../assets/player/restart.png'),
  volumeHigh: require('../assets/player/volume-high.png'),
  volumeOff: require('../assets/player/volume-off.png'),
  fullscreen: require('../assets/player/fullscreen-enter.png'),
  gear: require('../assets/player/gear.png'),
  seek: require('../assets/player/seek.png'),
  seekBack: require('../assets/player/seek-back.png'),
} as const;
type PlayerIcon = keyof typeof PLAYER_ICON_MODULES;
const PLAYER_ICON_FALLBACK: Record<PlayerIcon, SFSymbol> = {
  play: 'play.fill', pause: 'pause.fill', restart: 'arrow.counterclockwise', volumeHigh: 'speaker.wave.2.fill', volumeOff: 'speaker.slash.fill',
  fullscreen: 'arrow.up.left.and.arrow.down.right', gear: 'gearshape.fill', seek: 'goforward.10', seekBack: 'gobackward.10',
};
let playerIconCache: Record<PlayerIcon, string> | null = null;

function usePlayerIcons() {
  const [icons, setIcons] = useState(playerIconCache);
  useEffect(() => {
    if (playerIconCache) return;
    const names = Object.keys(PLAYER_ICON_MODULES) as PlayerIcon[];
    void Asset.loadAsync(names.map((name) => PLAYER_ICON_MODULES[name])).then((assets) => {
      const loaded = Object.fromEntries(names.map((name, index) => [name, assets[index].localUri ?? ''])) as Record<PlayerIcon, string>;
      if (Object.values(loaded).every(Boolean)) {
        playerIconCache = loaded;
        setIcons(loaded);
      }
    }).catch(() => undefined);
  }, []);
  return icons;
}

function PlayerGlyph({ name, icons, size }: { name: PlayerIcon; icons: Record<PlayerIcon, string> | null; size: number }) {
  return icons
    ? <NativeImage uiImage={icons[name]} modifiers={[resizable(), frame({ width: size, height: size }), accessibilityHidden()]} />
    : <NativeImage systemName={PLAYER_ICON_FALLBACK[name]} modifiers={[font({ size: size * 0.85, weight: 'semibold' }), foregroundStyle('#FFFFFF'), accessibilityHidden()]} />;
}

type FieldAction = 'paste' | 'clear' | 'analyze' | 'busy' | 'none';

// The bar's trailing control, drawn as a glyph inside the field like Safari's
// address bar: paste when empty, clear while editing or once analysed, send
// when a typed link is waiting.
function fieldAction(url: string, focused: boolean, phase: string, analysed: boolean): { action: FieldAction } {
  if (phase === 'analyzing') return { action: 'busy' };
  if (phase === 'downloading') return { action: 'none' };
  if (!url.trim()) return { action: 'paste' };
  if (focused || analysed) return { action: 'clear' };
  return { action: 'analyze' };
}

function FieldActionNative({ tokens, action, onPaste, onClear, onAnalyze }: { tokens: ThemeTokens; action: FieldAction; onPaste: () => void; onClear: () => void; onAnalyze: () => void }) {
  if (action === 'none') return null;
  if (action === 'busy') return <ZStack alignment="center" modifiers={[frame({ width: 40, height: 40 })]}><ProgressView modifiers={[controlSize('small')]} /></ZStack>;
  const glyph = action === 'paste'
    ? { name: 'doc.on.clipboard' as const, color: tokens.secondary, size: 19, label: 'Pegar enlace', press: onPaste }
    : action === 'clear'
      ? { name: 'xmark.circle.fill' as const, color: tokens.muted, size: 20, label: 'Borrar enlace', press: onClear }
      : { name: 'arrow.up.circle.fill' as const, color: tokens.blue, size: 30, label: 'Analizar enlace', press: onAnalyze };
  return <NativeButton onPress={glyph.press} modifiers={[buttonStyle('plain'), accessibilityLabel(glyph.label)]}>
    <ZStack alignment="center" modifiers={[frame({ width: 40, height: 40 }), contentShape(shapes.rectangle())]}>
      <NativeImage systemName={glyph.name} modifiers={[font({ size: glyph.size, weight: 'medium' }), foregroundStyle(glyph.color), accessibilityHidden()]} />
    </ZStack>
  </NativeButton>;
}

const PLAYER_TEXT = '#FFFFFF';
// Clear glass over video with the 35 % dimming Apple suggests for bright media.
const PLAYER_BAR: ViewModifier[] = nativeGlassAvailable
  ? [glassEffect({ glass: { variant: 'clear', tint: '#00000059' }, shape: 'capsule' })]
  : [background('#000000A6'), clipShape('capsule')];
const PLAYER_ROUND: ViewModifier[] = nativeGlassAvailable
  ? [glassEffect({ glass: { variant: 'clear', tint: '#00000059', interactive: true }, shape: 'circle' })]
  : [background('#000000A6'), clipShape('circle')];
const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

// A YouTube-style timeline: a thin track showing what has loaded (lighter)
// and what has played (white), with a dot that grows while dragging. The
// native slider stays on top, nearly invisible, so dragging and VoiceOver
// adjustments stay native; this view only draws. It fills the space left in
// the control row and reports its measured width so the fills stay exact.
function ScrubberNative({ width, onMeasure, played, buffered, scrubbing, duration, value, onChange, onRelease }: { width: number; onMeasure: (width: number) => void; played: number; buffered: number; scrubbing: boolean; duration: number; value: number; onChange: (value: number) => void; onRelease: () => void }) {
  const track = scrubbing ? 6 : 4;
  const dot = scrubbing ? 16 : 12;
  const bar = (fill: number, color: string) => <VStack modifiers={[frame({ width: Math.max(0, Math.min(1, fill)) * width, height: track }), background(color), clipShape('capsule')]}>{null}</VStack>;
  const seekTo = (x: number) => {
    if (duration > 0 && width > 0) onChange(Math.max(0, Math.min(1, x / width)) * duration);
  };
  return <ZStack alignment="leading" modifiers={[frame({ maxWidth: Infinity, minHeight: 28, maxHeight: 28, alignment: 'leading' }), onGeometryChange((size) => { if (size.width > 0 && Math.abs(size.width - width) > 0.5) onMeasure(size.width); })]}>
    {/* The drawing hangs from a zero-size anchor: it spans `width` but reports
        no size, so a stale width can never push the control row. */}
    <ZStack alignment="leading" modifiers={[frame({ width: 0, height: 28, alignment: 'leading' }), accessibilityHidden()]}>
      {bar(1, '#FFFFFF40')}
      {bar(buffered, '#FFFFFF80')}
      {bar(played, '#FFFFFF')}
      <VStack modifiers={[frame({ width: dot, height: dot }), background('#FFFFFF'), clipShape('circle'), shadow({ radius: 3, color: '#00000059' }), offset({ x: Math.max(0, Math.min(1, played)) * width - dot / 2 })]}>{null}</VStack>
    </ZStack>
    {/* Touch is handled in React Native: the system slider shows a Liquid Glass
        lens over its thumb while dragging that cannot be hidden. */}
    <VStack modifiers={[frame({ maxWidth: Infinity, minHeight: 28, maxHeight: 28 })]}>
      <RNHostView>
        <View
          style={{ flex: 1 }}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Posición"
          accessibilityValue={{ text: `${clockLabel(value)} de ${clockLabel(duration)}` }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(event) => {
            onChange(Math.max(0, Math.min(duration, value + (event.nativeEvent.actionName === 'increment' ? 10 : -10))));
            onRelease();
          }}
          onStartShouldSetResponder={() => duration > 0}
          onMoveShouldSetResponder={() => duration > 0}
          onResponderTerminationRequest={() => false}
          onResponderGrant={(event) => seekTo(event.nativeEvent.locationX)}
          onResponderMove={(event) => seekTo(event.nativeEvent.locationX)}
          onResponderRelease={onRelease}
          onResponderTerminate={onRelease}
        />
      </RNHostView>
    </VStack>
  </ZStack>;
}

const SEEK_STEP = 10;

type SeekFeedback = { direction: 'back' | 'forward'; seconds: number };

// A native port of the Video.js v10 default video skin: the same control
// order (play, volume, time, time slider, time toggle, settings, fullscreen),
// the same touch gestures (tap toggles controls, double tap on the sides seeks
// 10 s, double tap in the middle goes full screen) and its seek indicator.
// Drawing is SwiftUI Liquid Glass over a bare AVPlayer surface.
function GlassPlayerNative({ sources, selfContained, audioLanguage, audioSources, poster, width, height }: { sources: string[]; selfContained: string[]; audioLanguage: string | null; audioSources: string[]; poster: string | null; width: number; height: number }) {
  const icons = usePlayerIcons();
  const [attempt, setAttempt] = useState(0);
  const [audioAttempt, setAudioAttempt] = useState(0);
  const key = sources.join('|');
  const audioKey = audioSources.join('|');
  useEffect(() => setAttempt(0), [key]);
  useEffect(() => setAudioAttempt(0), [audioKey]);
  const videoUrl = sources[attempt] ?? null;
  // HLS carries its own sound (and every dub); only bare video files need the separate track.
  const separateAudio = Boolean(videoUrl) && !selfContained.includes(videoUrl as string);
  const audioUrl = separateAudio ? audioSources[audioAttempt] ?? null : null;

  const player = useVideoPlayer(videoUrl, (instance) => {
    instance.loop = false;
    instance.timeUpdateEventInterval = 0.25;
  });
  const soundtrack = useVideoPlayer(audioUrl, (instance) => {
    instance.loop = false;
  });
  const videoView = useRef<VideoView>(null);
  const { status } = useEvent(player, 'statusChange', { status: player.status });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const { currentTime, bufferedPosition } = useEvent(player, 'timeUpdate', { currentTime: 0, currentLiveTimestamp: null, currentOffsetFromLive: null, bufferedPosition: 0 });
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [ended, setEnded] = useState(false);
  const [scrub, setScrub] = useState<number | null>(null);
  const [trackWidth, setTrackWidth] = useState<number | null>(null);
  const [showRemaining, setShowRemaining] = useState(true);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [seekFeedback, setSeekFeedback] = useState<SeekFeedback | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTap = useRef<{ zone: 'left' | 'center' | 'right'; at: number } | null>(null);
  const duration = player.duration > 0 ? player.duration : 0;
  const shownTime = scrub ?? currentTime;
  const elapsedLabel = clockLabel(shownTime);
  const totalLabel = showRemaining ? `-${clockLabel(Math.max(0, duration - shownTime))}` : clockLabel(duration);
  // Until the track reports its measured width: the row minus its margins,
  // padding, three 32 pt buttons, five gaps and the two time labels.
  const estimatedTrackWidth = Math.max(40, width - 20 - 16 - 96 - 20 - (elapsedLabel.length + totalLabel.length) * 7.5 - 8);

  useEffect(() => {
    if (status === 'error') setAttempt((value) => value + 1);
  }, [status]);
  // The poster only covers the wait for the first frame; later rebuffering
  // (after a seek) shows just the spinner over the last frame.
  const [everReady, setEverReady] = useState(false);
  useEffect(() => {
    if (status === 'readyToPlay') setEverReady(true);
  }, [status]);

  // Inside HLS the dub is an audio rendition: switch it on the same player.
  const { availableAudioTracks } = useEvent(player, 'availableAudioTracksChange', { availableAudioTracks: player.availableAudioTracks });
  useEffect(() => {
    if (separateAudio || !availableAudioTracks?.length) return;
    // YouTube marks the original only in the rendition name ("English - original"),
    // never as DEFAULT, so iOS would otherwise follow the phone's language.
    const original = availableAudioTracks.find((track) => /original/i.test(track.name ?? track.label));
    const wanted = audioLanguage
      ? availableAudioTracks.find((track) => track.language === audioLanguage) ?? availableAudioTracks.find((track) => track.language.split('-')[0] === audioLanguage.split('-')[0]) ?? original
      : original ?? availableAudioTracks.find((track) => track.isDefault) ?? null;
    if (wanted && player.audioTrack?.language !== wanted.language) player.audioTrack = wanted;
  }, [audioLanguage, availableAudioTracks, separateAudio, player]);  const { status: audioStatus } = useEvent(soundtrack, 'statusChange', { status: soundtrack.status });
  useEffect(() => {
    if (audioUrl && audioStatus === 'error') setAudioAttempt((value) => value + 1);
  }, [audioStatus, audioUrl]);

  useEffect(() => {
    const subscription = player.addListener('playToEnd', () => {
      setEnded(true);
      setControlsVisible(true);
      if (audioUrl) soundtrack.pause();
    });
    return () => subscription.remove();
  }, [player, soundtrack, audioUrl]);

  // A separate soundtrack (YouTube sends picture and sound apart) follows the
  // video. AVPlayer reports "playing" while it is still buffering, so sound
  // only runs while the picture's clock actually advances.
  const lastVideoTime = useRef(0);
  useEffect(() => {
    const advancing = currentTime > lastVideoTime.current + 0.01;
    lastVideoTime.current = currentTime;
    if (!audioUrl) return;
    if (isPlaying && advancing) {
      if (Math.abs(soundtrack.currentTime - currentTime) > 0.3) soundtrack.currentTime = currentTime;
      if (!soundtrack.playing) soundtrack.play();
    } else if (soundtrack.playing) {
      soundtrack.pause();
    }
  }, [currentTime, isPlaying, audioUrl, soundtrack]);
  useEffect(() => {
    if (!isPlaying && audioUrl) soundtrack.pause();
  }, [isPlaying, audioUrl, soundtrack]);
  useEffect(() => {
    if (audioUrl) {
      player.muted = true;
      soundtrack.muted = muted;
    } else {
      player.muted = muted;
    }
  }, [muted, audioUrl, player, soundtrack]);
  useEffect(() => {
    player.playbackRate = rate;
    if (audioUrl) soundtrack.playbackRate = rate;
  }, [rate, audioUrl, player, soundtrack]);

  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControlsVisible(false), 2800);
  }, []);
  useEffect(() => {
    if (isPlaying && scrub == null) scheduleHide();
    else if (hideTimer.current) clearTimeout(hideTimer.current);
  }, [isPlaying, scrub, scheduleHide]);
  useEffect(() => () => {
    for (const timer of [hideTimer.current, tapTimer.current, feedbackTimer.current]) if (timer) clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (fullscreen) void videoView.current?.enterFullscreen();
  }, [fullscreen]);

  const seek = (seconds: number) => {
    const target = Math.max(0, duration ? Math.min(seconds, duration) : seconds);
    player.currentTime = target;
    if (audioUrl) soundtrack.currentTime = target;
    setEnded(false);
  };

  const seekStep = (direction: 'back' | 'forward') => {
    seek(currentTime + (direction === 'forward' ? SEEK_STEP : -SEEK_STEP));
    // Repeated double taps add up, as in the Video.js seek indicator.
    setSeekFeedback((current) => ({ direction, seconds: current?.direction === direction ? current.seconds + SEEK_STEP : SEEK_STEP }));
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setSeekFeedback(null), 800);
  };

  const togglePlay = () => {
    if (isPlaying) {
      player.pause();
      return;
    }
    if (ended) seek(0);
    player.play();
  };

  const onZoneTap = (zone: 'left' | 'center' | 'right') => {
    const now = Date.now();
    const previous = lastTap.current;
    if (previous && previous.zone === zone && now - previous.at < 300) {
      if (tapTimer.current) clearTimeout(tapTimer.current);
      lastTap.current = null;
      if (zone === 'center') setFullscreen(true);
      else seekStep(zone === 'left' ? 'back' : 'forward');
      return;
    }
    lastTap.current = { zone, at: now };
    if (tapTimer.current) clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => {
      setControlsVisible((visible) => !visible);
      if (isPlaying) scheduleHide();
    }, 260);
  };

  if (!videoUrl) {
    return <VStack modifiers={[frame({ width, height }), clipped()]}>
      <RNHostView><RNImage source={{ uri: poster ?? undefined }} style={{ flex: 1, backgroundColor: '#000000' }} resizeMode="contain" /></RNHostView>
    </VStack>;
  }

  const ready = everReady;
  const showControls = controlsVisible || !isPlaying;
  const timeText = [foregroundStyle(PLAYER_TEXT), font({ textStyle: 'caption', weight: 'semibold' }), monospacedDigit()];
  const zone = (name: 'left' | 'center' | 'right') => <VStack modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity }), contentShape(shapes.rectangle()), onTapGesture(() => onZoneTap(name))]}>{null}</VStack>;

  return <ZStack alignment="center" modifiers={[frame({ width, height }), background('#000000'), clipShape('rectangle')]}>
    <VStack modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity })]}>
      <RNHostView>
        <View style={{ flex: 1, backgroundColor: '#000000' }}>
          <VideoView
            ref={videoView}
            player={player}
            style={StyleSheet.absoluteFill}
            nativeControls={fullscreen}
            contentFit="contain"
            allowsPictureInPicture={false}
            allowsVideoFrameAnalysis={false}
            onFullscreenExit={() => setFullscreen(false)}
          />
          {!everReady && poster ? <RNImage source={{ uri: poster }} style={StyleSheet.absoluteFill} resizeMode="contain" /> : null}
        </View>
      </RNHostView>
    </VStack>

    <HStack spacing={0} modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity }), accessibilityHidden()]}>
      {zone('left')}
      {zone('center')}
      {zone('right')}
    </HStack>

    {seekFeedback ? <VStack modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: seekFeedback.direction === 'back' ? 'leading' : 'trailing' }), padding({ horizontal: 28 })]}>
      <HStack alignment="center" spacing={6} modifiers={[padding({ horizontal: 14, vertical: 9 }), ...PLAYER_BAR]}>
        <PlayerGlyph name={seekFeedback.direction === 'back' ? 'seekBack' : 'seek'} icons={icons} size={16} />
        <NativeText modifiers={timeText}>{`${seekFeedback.direction === 'back' ? '−' : '+'}${seekFeedback.seconds} s`}</NativeText>
      </HStack>
    </VStack> : null}

    {/* While loading, the spinner takes the play button's place in the same glass circle. */}
    {status !== 'readyToPlay'
      ? <ZStack alignment="center" modifiers={[frame({ width: 64, height: 64 }), ...PLAYER_ROUND, accessibilityLabel('Cargando')]}>
        <ProgressView modifiers={[tint('#FFFFFF'), controlSize('regular')]} />
      </ZStack>
      : showControls ? <NativeButton onPress={togglePlay} modifiers={[buttonStyle('plain'), frame({ width: 64, height: 64 }), ...PLAYER_ROUND, contentShape(shapes.circle()), accessibilityLabel(isPlaying ? 'Pausar' : ended ? 'Repetir' : 'Reproducir')]}>
        <ZStack alignment="center" modifiers={[frame({ width: 64, height: 64 })]}>
          <PlayerGlyph name={isPlaying ? 'pause' : ended ? 'restart' : 'play'} icons={icons} size={26} />
        </ZStack>
      </NativeButton> : null}

    {showControls && ready ? <>

      <VStack modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'bottom' }), padding({ horizontal: 10, bottom: 10 })]}>
        <HStack alignment="center" spacing={4} modifiers={[padding({ leading: 12, trailing: 4, vertical: 2 }), frame({ maxWidth: Infinity, minHeight: 44 }), ...PLAYER_BAR]}>
          <NativeButton onPress={() => setMuted((value) => !value)} modifiers={[buttonStyle('plain'), frame({ width: 32, height: 40 }), contentShape(shapes.rectangle()), accessibilityLabel(muted ? 'Activar sonido' : 'Silenciar')]}>
            <PlayerGlyph name={muted ? 'volumeOff' : 'volumeHigh'} icons={icons} size={17} />
          </NativeButton>
          <NativeText modifiers={timeText}>{elapsedLabel}</NativeText>
          <ScrubberNative
            width={trackWidth ?? estimatedTrackWidth}
            onMeasure={setTrackWidth}
            played={duration ? Math.min(1, shownTime / duration) : 0}
            buffered={duration ? Math.min(1, bufferedPosition / duration) : 0}
            scrubbing={scrub != null}
            duration={duration}
            value={duration ? Math.min(shownTime, duration) : 0}
            onChange={(value) => setScrub(value)}
            onRelease={() => {
              if (scrub != null) {
                seek(scrub);
                setScrub(null);
              }
            }}
          />
          <NativeButton onPress={() => setShowRemaining((value) => !value)} modifiers={[buttonStyle('plain'), accessibilityLabel(showRemaining ? 'Tiempo restante' : 'Duración')]}>
            <NativeText modifiers={timeText}>{totalLabel}</NativeText>
          </NativeButton>
          <Menu label={<ZStack alignment="center" modifiers={[frame({ width: 32, height: 40 })]}><PlayerGlyph name="gear" icons={icons} size={17} /></ZStack>} modifiers={[menuIndicator('hidden'), accessibilityLabel('Ajustes del video')]}>
            <Menu label={`Velocidad · ${rate === 1 ? 'Normal' : `${rate}×`}`} systemImage="gauge.with.dots.needle.50percent">
              {PLAYBACK_RATES.map((value) => <NativeButton key={value} label={value === 1 ? 'Normal' : `${value}×`} systemImage={value === rate ? 'checkmark' : undefined} onPress={() => setRate(value)} />)}
            </Menu>
          </Menu>
          <NativeButton onPress={() => setFullscreen(true)} modifiers={[buttonStyle('plain'), frame({ width: 32, height: 40 }), contentShape(shapes.rectangle()), accessibilityLabel('Pantalla completa')]}>
            <PlayerGlyph name="fullscreen" icons={icons} size={17} />
          </NativeButton>
        </HStack>
      </VStack>
    </> : null}
  </ZStack>;
}

// The thumbnail stands in when data saver is on or nothing plays.
function MediaPreviewNative({ sources, selfContained, audioLanguage, audioSources, imageUrl, aspect, dataSaver, tokens }: { sources: string[]; selfContained: string[]; audioLanguage: string | null; audioSources: string[]; imageUrl: string | null; aspect: number | null; dataSaver: boolean; tokens: ThemeTokens }) {
  const { width } = useWindowDimensions();
  const playable = !dataSaver && sources.length > 0;
  if (!playable && !imageUrl) return null;
  const previewWidth = Math.min(width, UI.contentWidth) - UI.pageInset * 2;
  const height = Math.round(Math.min(460, Math.max(190, previewWidth / (aspect ?? 16 / 9))));
  // An exact width: embedded React Native views report the video's own size, and a
  // flexible frame would accept it and widen the whole page past the screen.
  return <VStack modifiers={[frame({ width: previewWidth, height }), clipped(), background('#000000'), listRowInsets({ top: 0, leading: 0, bottom: 0, trailing: 0 }), accessibilityLabel(playable ? 'Vista previa' : 'Miniatura')]}>
    {playable
      ? <GlassPlayerNative key={sources.join('|')} sources={sources} selfContained={selfContained} audioLanguage={audioLanguage} audioSources={audioSources} poster={imageUrl} width={previewWidth} height={height} />
      : <RNHostView><RNImage source={{ uri: imageUrl ?? undefined }} style={{ flex: 1, backgroundColor: tokens.mode === 'dark' ? '#1C1C1E' : '#E5E5EA' }} resizeMode={aspect && aspect < 1 ? 'contain' : 'cover'} /></RNHostView>}
  </VStack>;
}


function ItemStripNative({ items, selectedId, tokens, onSelect }: { items: DownloadItem[]; selectedId: string; tokens: ThemeTokens; onSelect: (id: string) => void }) {
  const { width } = useWindowDimensions();
  // Exact width for the same reason as the preview: the strip's scroll content is wider than the screen.
  return <VStack modifiers={[frame({ width: Math.min(width, UI.contentWidth) - UI.pageInset * 2, height: 84 }), clipped(), listRowInsets({ top: 0, leading: 0, bottom: 0, trailing: 0 })]}>
    <RNHostView>
      <ScrollViewRN horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingHorizontal: 16, alignItems: 'center' }}>
        {items.map((item) => {
          const selected = item.id === selectedId;
          return <Pressable key={item.id} onPress={() => onSelect(item.id)} accessibilityRole="button" accessibilityLabel={item.title} accessibilityState={{ selected }}
            style={{ width: 64, height: 64, borderRadius: 12, overflow: 'hidden', borderWidth: selected ? 3 : 0, borderColor: tokens.blue, backgroundColor: tokens.mode === 'dark' ? '#2C2C2E' : '#E5E5EA' }}>
            {item.thumbnail ? <RNImage source={{ uri: item.thumbnail }} style={{ flex: 1 }} resizeMode="cover" /> : null}
            {item.kind === 'video' ? <View style={{ position: 'absolute', right: 4, bottom: 4, borderRadius: 8, backgroundColor: '#00000099', paddingHorizontal: 5, paddingVertical: 2 }}>
              <FontAwesome6 name="play" size={9} color="#FFFFFF" />
            </View> : null}
          </Pressable>;
        })}
      </ScrollViewRN>
    </RNHostView>
  </VStack>;
}

const MODE_LABELS: Record<DownloadMode, string> = { video: 'Video', audio: 'Audio', image: 'Foto', thumbnail: 'Miniatura' };
const MODE_SYMBOLS: Record<DownloadMode, SFSymbol> = { video: 'film', audio: 'music.note', image: 'photo', thumbnail: 'photo.on.rectangle' };
const BAR_HEIGHT = 50;
const BAR_MAX_WIDTH = 240;

type BarState = 'ready' | 'downloading' | 'done';

// One capsule with fixed geometry in every state, so the action morphs into
// its own progress bar and back without the layout moving. The label stays
// "Descargar": format and quality are already chosen above it.
function DownloadBarNative({ state, fraction, preparing, tokens, onDownload, onCancel }: { state: BarState; fraction: number | null; preparing: boolean; tokens: ThemeTokens; onDownload: () => void; onCancel: () => void }) {
  const { width } = useWindowDimensions();
  const barWidth = Math.min(BAR_MAX_WIDTH, Math.min(width, UI.contentWidth) - UI.pageInset * 2);
  const doneTick = useNativeState(0);
  useEffect(() => {
    if (state === 'done') doneTick.set(doneTick.get() + 1);
  }, [state]);
  const percent = fraction == null ? null : Math.round(fraction * 100);
  const accent = state !== 'downloading';
  const surface: ViewModifier[] = nativeGlassAvailable
    ? [glassEffect({ glass: { variant: 'regular', interactive: state === 'ready', ...(accent ? { tint: tokens.blue } : {}) }, shape: 'capsule' })]
    : [background(accent ? tokens.blue : tokens.surfaceRaised), clipShape('capsule')];
  const box = frame({ width: barWidth, height: BAR_HEIGHT });

  if (state === 'ready') {
    return <HStack alignment="center" spacing={8} modifiers={[box, ...surface, contentShape(shapes.capsule()), onTapGesture(onDownload), accessibilityElement('ignore'), accessibilityLabel('Descargar'), accessibilityAddTraits(['isButton'])]}>
      <NativeImage systemName="arrow.down" modifiers={[font({ textStyle: 'headline', weight: 'semibold' }), foregroundStyle(tokens.inverseText)]} />
      <NativeText modifiers={textModifiers(tokens, { color: tokens.inverseText, style: 'headline', weight: 'semibold' })}>Descargar</NativeText>
    </HStack>;
  }

  if (state === 'done') {
    return <HStack alignment="center" spacing={8} modifiers={[box, ...surface, accessibilityElement('ignore'), accessibilityLabel('Guardado')]}>
      <NativeImage systemName="checkmark.circle.fill" modifiers={[font({ textStyle: 'headline', weight: 'semibold' }), foregroundStyle(tokens.inverseText), symbolEffect({ effect: 'bounce' }, { value: doneTick })]} />
      <NativeText modifiers={textModifiers(tokens, { color: tokens.inverseText, style: 'headline', weight: 'semibold' })}>Guardado</NativeText>
    </HStack>;
  }

  const fill = fraction == null ? 0 : Math.max(BAR_HEIGHT, barWidth * fraction);
  return <ZStack alignment="leading" modifiers={[box, ...surface]}>
    <LiquidProgress progress={fraction ?? -1} color={tokens.blue} modifiers={[box, opacity(0.32), clipShape('capsule')]} fallback={
      <VStack modifiers={[frame({ width: fill, height: BAR_HEIGHT }), background(tokens.blue), opacity(0.28), clipShape('capsule'), animation(Animation.spring({ duration: 0.45 }), fill)]}>{null}</VStack>
    } />
    {/* Padding sits inside the fixed frame so the content can never widen the capsule. */}
    <HStack alignment="center" spacing={8} modifiers={[padding({ leading: 20, trailing: 4 }), box]}>
      {preparing ? <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'subheadline', weight: 'semibold' })}>Preparando</NativeText> : null}
      {percent == null ? <ProgressView modifiers={[controlSize('small')]} /> : <NativeText modifiers={[...textModifiers(tokens, { style: 'headline', weight: 'semibold' }), monospacedDigit(), accessibilityLabel(`Descargando, ${percent} por ciento`)]}>{`${percent} %`}</NativeText>}
      <Spacer />
      <NativeButton onPress={onCancel} modifiers={[buttonStyle('plain'), frame({ width: 44, height: 44 }), contentShape(shapes.circle()), accessibilityLabel('Cancelar descarga')]}>
        <NativeImage systemName="xmark.circle.fill" modifiers={[font({ size: 24 }), foregroundStyle(tokens.secondary)]} />
      </NativeButton>
    </HStack>
  </ZStack>;
}

// The downloader service's address. The field is a draft: the address is
// stored and checked only on submit, and checking again is explicit.
function DownloaderServerRowsNative({ tokens }: { tokens: ThemeTokens }) {
  const [current, setCurrent] = useState(downloaderUrl);
  const state = useNativeState(downloaderUrl().replace(/^http:\/\//, ''));
  const [draft, setDraft] = useState(downloaderUrl().replace(/^http:\/\//, ''));
  const [status, setStatus] = useState<'idle' | 'checking' | 'ok' | 'down' | 'invalid'>('idle');
  useEffect(() => {
    // The stored address is read at launch; show it once it is.
    void loadDownloaderUrl().then((url) => {
      setCurrent(url);
      const shown = url.replace(/^http:\/\//, '');
      state.set(shown);
      setDraft(shown);
    });
  }, []);

  const check = async (url: string) => {
    setStatus('checking');
    setStatus((await checkDownloader(url)) ? 'ok' : 'down');
  };

  const submit = async () => {
    const url = normalizeServerUrl(draft);
    if (!url) return setStatus('invalid');
    if (url !== current) {
      try {
        await saveDownloaderUrl(url);
      } catch {
        return alertUnsaved(false);
      }
      setCurrent(url);
    }
    await check(url);
  };

  const statusText = status === 'checking' ? 'Comprobando…' : status === 'ok' ? 'Conectado' : status === 'down' ? 'Sin respuesta' : status === 'invalid' ? 'Dirección no válida' : null;
  return <>
    <HStack alignment="center" spacing={12} modifiers={[padding({ vertical: 4 })]}>
      <SymbolImage name="desktopcomputer" color={tokens.secondary} size={18} />
      <TextField text={state} onTextChange={(value) => { setDraft(value); state.set(value); if (status !== 'idle') setStatus('idle'); }} placeholder="192.168.1.5:8787" modifiers={[frame({ maxWidth: Infinity }), font({ textStyle: 'body' }), textFieldStyle('plain'), keyboardType('url'), textInputAutocapitalization('never'), autocorrectionDisabled(), accessibilityLabel('Dirección del servidor'), submitLabel('done'), onSubmit(() => void submit())]} />
      {status === 'checking' ? <ProgressView modifiers={[controlSize('small')]} /> : null}
    </HStack>
    <HStack alignment="center" spacing={12}>
      <NativeButton label="Comprobar conexión" onPress={() => void submit()} modifiers={[tint(tokens.blue), disabled(status === 'checking' || !draft.trim())]} />
      <Spacer />
      {statusText && status !== 'checking' ? <NativeText modifiers={textModifiers(tokens, { color: status === 'ok' ? tokens.sage : tokens.danger, style: 'subheadline', weight: 'medium' })}>{statusText}</NativeText> : null}
    </HStack>
  </>;
}


// The downloader's own settings, shown from its title menu.
function DownloaderSettingsNative({ tokens, dataSaver, onDataSaverChange }: { tokens: ThemeTokens; dataSaver: boolean; onDataSaverChange: (value: boolean) => void }) {
  return <>
    <Section>
      <Toggle label="Ahorro de datos" systemImage="antenna.radiowaves.left.and.right.slash" isOn={dataSaver} onIsOnChange={onDataSaverChange} modifiers={[tint(tokens.blue)]} />
    </Section>
    {LOCAL_DOWNLOADER ? null : <Section title="Servidor">
      <DownloaderServerRowsNative tokens={tokens} />
    </Section>}
  </>;
}

/** A link shared to the app from another app's share sheet. */
export type SharedLink = { url: string; nonce: number };

export function DownloaderNative({ tokens, dataSaver, onDataSaverChange, onBack, sharedLink, onSharedLinkHandled }: { tokens: ThemeTokens; dataSaver: boolean; onDataSaverChange: (value: boolean) => void; onBack: () => void; sharedLink?: SharedLink | null; onSharedLinkHandled?: () => void }) {
  const urlState = useNativeState('');
  const urlRef = useRef('');
  const urlInput = useRef<TextFieldRef>(null);
  const [urlFocused, setUrlFocused] = useState(false);
  const dismissKeyboard = () => void urlInput.current?.blur();
  const [url, setUrl] = useState('');
  const [phase, setPhase] = useState<'idle' | 'analyzing' | 'ready' | 'downloading' | 'done'>('idle');
  const [analysis, setAnalysis] = useState<DownloadAnalysis | null>(null);
  const [itemId, setItemId] = useState('');
  const [mode, setMode] = useState<DownloadMode>('video');
  const [qualityHeight, setQualityHeight] = useState<number | null>(null);
  const [audioTrackId, setAudioTrackId] = useState('');
  const [fraction, setFraction] = useState<number | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<DownloadHistoryItem[]>([]);
  const analyzeController = useRef<AbortController | null>(null);
  // A shared link downloads as soon as its analysis is ready, with the default format.
  const autoDownload = useRef(false);
  const task = useRef<DownloadTask | null>(null);
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const source = detectDownloadSource(url);
  const item = analysis?.items.find((candidate) => candidate.id === itemId) ?? null;
  // A photo in a carousel can only be saved as a photo; a video item offers
  // what the post as a whole offers.
  const modes: DownloadMode[] = !analysis ? [] : item?.kind === 'image' ? ['image'] : item?.kind === 'video' && item.mediaUrl ? ['video'] : analysis.modes.filter((option) => option !== 'image' || !item);
  const activeMode = modes.includes(mode) ? mode : modes[0] ?? 'video';
  const directFile = Boolean(item?.mediaUrl ?? analysis?.mediaUrl);
  const showQuality = activeMode === 'video' && !directFile && (analysis?.qualities.length ?? 0) > 1;
  const audioTrack = analysis?.audioTracks.find((track) => track.id === audioTrackId) ?? analysis?.audioTracks[0] ?? null;
  const showAudioTracks = !item && (activeMode === 'video' || activeMode === 'audio') && (analysis?.audioTracks.length ?? 0) > 1;
  const busy = phase === 'analyzing' || phase === 'downloading';

  useEffect(() => {
    void loadDownloadHistory().then(setHistory);
    return () => {
      analyzeController.current?.abort();
      task.current?.cancel();
      if (doneTimer.current) clearTimeout(doneTimer.current);
    };
  }, []);

  const reset = (value: string) => {
    analyzeController.current?.abort();
    urlRef.current = value;
    setUrl(value);
    urlState.set(value);
    setAnalysis(null);
    setItemId('');
    setQualityHeight(null);
    setPhase('idle');
    setError(null);
  };

  const analyze = async (value = url) => {
    if (phase === 'downloading' || !value.trim()) return;
    dismissKeyboard();
    analyzeController.current?.abort();
    const controller = new AbortController();
    analyzeController.current = controller;
    setPhase('analyzing');
    setError(null);
    try {
      const result = await analyzeUrl(value, controller.signal);
      if (controller.signal.aborted) return;
      setAnalysis(result);
      setItemId(result.items[0]?.id ?? '');
      // The server lists the original language first.
      setAudioTrackId(result.audioTracks[0]?.id ?? '');
      setMode(result.modes[0]);
      setQualityHeight(result.qualities.find((quality) => Number(quality.id) <= 1080)?.height ?? result.qualities[0]?.height ?? null);
      setPhase('ready');
    } catch (reason) {
      if (controller.signal.aborted) return;
      setAnalysis(null);
      setPhase('idle');
      setError(downloaderErrorMessage(reason, 'No se pudo analizar el enlace.'));
    }
  };

  const paste = async () => {
    const text = (await Clipboard.getStringAsync()).trim();
    if (!text) {
      setError('El portapapeles está vacío.');
      return;
    }
    reset(text);
    void analyze(text);
  };

  const rememberDownload = async (entry: DownloadHistoryItem) => {
    const next = [entry, ...history];
    const kept = next.slice(0, 20);
    for (const dropped of next.slice(20)) await deleteLocalFile(dropped.uri);
    setHistory(kept);
    await saveDownloadHistory(kept).catch(() => undefined);
  };

  const download = async () => {
    if (phase !== 'ready' || !analysis) return;
    dismissKeyboard();
    setPhase('downloading');
    setError(null);
    setFraction(null);
    const current = startDownload({
      url: item?.url ?? url,
      mode: activeMode,
      quality: activeMode === 'video' ? qualityHeight : null,
      mediaUrl: activeMode === 'audio' ? null : item?.mediaUrl ?? analysis.mediaUrl,
      itemIndex: item && !item.mediaUrl ? item.index : null,
      audioLanguage: showAudioTracks && audioTrack && !audioTrack.original ? audioTrack.id : null,
    }, (progress) => {
      setPreparing(progress.stage === 'preparing');
      setFraction(progress.fraction);
    });
    task.current = current;
    try {
      const { result, uri } = await current.promise;
      await rememberDownload({
        id: makeId(),
        title: item && analysis.items.length > 1 ? `${analysis.title} · ${item.title}` : analysis.title,
        source: source?.key ?? 'other',
        mode: activeMode,
        filename: result.filename,
        mimeType: result.mimeType,
        uri,
        thumbnail: item?.thumbnail ?? analysis.thumbnail,
        createdAt: Date.now(),
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPhase('done');
      doneTimer.current = setTimeout(() => setPhase((value) => (value === 'done' ? 'ready' : value)), 1800);
      await shareFile(uri, result.mimeType, result.filename);
    } catch (reason) {
      setPhase('ready');
      if (!(reason instanceof DownloadCancelledError)) setError(downloaderErrorMessage(reason, 'No se pudo completar la descarga.'));
    } finally {
      task.current = null;
    }
  };

  useEffect(() => {
    if (!sharedLink) return;
    onSharedLinkHandled?.();
    if (phase === 'downloading') {
      setError('Termina o cancela la descarga actual para abrir el enlace compartido.');
      return;
    }
    reset(sharedLink.url);
    autoDownload.current = true;
    void analyze(sharedLink.url);
  }, [sharedLink?.nonce]);

  useEffect(() => {
    if (phase === 'ready' && autoDownload.current) {
      autoDownload.current = false;
      void download();
    } else if (phase === 'idle') {
      autoDownload.current = false;
    }
  }, [phase]);

  const removeHistory = async (entry: DownloadHistoryItem) => {
    await deleteLocalFile(entry.uri);
    const kept = history.filter((candidate) => candidate.id !== entry.id);
    setHistory(kept);
    await saveDownloadHistory(kept).catch(() => undefined);
  };

  const openHistory = async (entry: DownloadHistoryItem) => {
    if (!(await fileExists(entry.uri))) {
      setError('El archivo ya no está en el iPhone.');
      return removeHistory(entry);
    }
    await shareFile(entry.uri, entry.mimeType, entry.filename);
  };

  const previewSources = !analysis ? [] : item
    ? [item.previewUrl ?? (item.kind === 'video' ? item.mediaUrl : null)].filter((value): value is string => Boolean(value))
    : [analysis.previewHlsUrl, analysis.previewUrl, analysis.previewRelayUrl].filter((value): value is string => Boolean(value));
  const previewImage = item?.thumbnail ?? analysis?.thumbnail ?? null;
  const duration = formatDuration(item?.durationSeconds ?? analysis?.durationSeconds);
  // Each newly recognised platform pops into the field.
  const lastSource = useRef<string | null>(null);
  const popCount = useRef(0);
  if ((source?.key ?? null) !== lastSource.current) {
    lastSource.current = source?.key ?? null;
    if (source) popCount.current += 1;
  }
  const sourcePops = popCount.current;
  const showBar = Boolean(analysis) && (phase === 'ready' || phase === 'downloading' || phase === 'done');
  const pageWidth = usePageWidth();

  return (
    <PageNative title="Downloader" tokens={tokens} onBack={onBack} onHeaderTap={dismissKeyboard} ambient={analysis?.ambientColor ?? null} settings={<DownloaderSettingsNative tokens={tokens} dataSaver={dataSaver} onDataSaverChange={onDataSaverChange} />}>
      <ZStack alignment="bottom" modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity })]}>
        {/* One scrolling column on the page itself: no grouped boxes. Scrolling
            closes the keyboard; static rows close it on tap. */}
        <ScrollView modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity }), scrollDismissesKeyboard('immediately')]}>
          <VStack alignment="leading" spacing={20} modifiers={[frame({ width: pageWidth, alignment: 'leading' }), padding({ horizontal: UI.pageInset, top: 0, bottom: showBar ? BAR_HEIGHT + 48 : 32 })]}>
            {/* The link is a floating glass search bar, like Safari's address field. */}
            <HStack alignment="center" spacing={10} modifiers={[frame({ maxWidth: Infinity, minHeight: 54 }), padding({ leading: 10, trailing: 6 }), ...(nativeGlassAvailable ? [glassEffect({ glass: { variant: 'regular' }, shape: 'capsule' })] : [background(tokens.surface), clipShape('capsule')])]}>
              {source ? <PopIn trigger={sourcePops}><SourceIconNative source={source.key} tokens={tokens} size={32} /></PopIn> : <ZStack alignment="center" modifiers={[frame({ width: 32, height: 32 })]}><SymbolImage name="link" color={tokens.secondary} size={18} /></ZStack>}
              <TextField ref={urlInput} text={urlState} onTextChange={(value) => { if (value !== urlRef.current) reset(value); }} placeholder="Pega un enlace" onFocusChange={setUrlFocused} modifiers={[frame({ maxWidth: Infinity }), font({ textStyle: 'body' }), lineLimit(1), textFieldStyle('plain'), keyboardType('url'), textInputAutocapitalization('never'), autocorrectionDisabled(), disabled(phase === 'downloading'), accessibilityLabel('Enlace del contenido'), submitLabel('go'), onSubmit(() => void analyze())]} />
              <FieldActionNative tokens={tokens} {...fieldAction(url, urlFocused, phase, Boolean(analysis))} onPaste={() => void paste()} onClear={() => { reset(''); void urlInput.current?.focus(); }} onAnalyze={() => void analyze()} />
            </HStack>

            {error ? <HStack alignment="firstTextBaseline" spacing={8} modifiers={[padding({ horizontal: 4 })]}>
              <SymbolImage name="exclamationmark.circle.fill" color={tokens.danger} size={18} />
              <NativeText modifiers={textModifiers(tokens, { color: tokens.danger, style: 'subheadline', weight: 'medium' })}>{error}</NativeText>
            </HStack> : null}

            {phase === 'analyzing' ? <VStack alignment="center" spacing={10} modifiers={[frame({ maxWidth: Infinity, minHeight: 200 })]}>
              <ProgressView />
              <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'subheadline' })}>Analizando…</NativeText>
            </VStack> : null}

            {analysis ? <>
              <VStack alignment="leading" spacing={12} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
                <VStack modifiers={[frame({ maxWidth: Infinity }), clipShape('roundedRectangle', 20)]}>
                  <MediaPreviewNative sources={previewSources} selfContained={analysis.previewHlsUrl && !item ? [analysis.previewHlsUrl] : []} audioLanguage={item ? null : audioTrack?.id ?? null} audioSources={item ? [] : audioTrack?.previewSources.length ? audioTrack.previewSources : analysis.previewAudioSources} imageUrl={previewImage} aspect={analysis.aspectRatio} dataSaver={dataSaver} tokens={tokens} />
                </VStack>
                <VStack alignment="leading" spacing={6} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ horizontal: 4 }), contentShape(shapes.rectangle()), onTapGesture(dismissKeyboard)]}>
                  <NativeText modifiers={[...textModifiers(tokens, { style: 'title3', weight: 'bold' }), lineLimit(3)]}>{analysis.title}</NativeText>
                  <HStack alignment="center" spacing={8}>
                    {source ? <SourceIconNative source={source.key} tokens={tokens} size={20} /> : null}
                    <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'subheadline' }), monospacedDigit(), lineLimit(1)]}>{[analysis.uploader ?? source?.label, duration].filter(Boolean).join(' · ')}</NativeText>
                  </HStack>
                </VStack>
              </VStack>

              {analysis.items.length > 1 ? <VStack alignment="leading" spacing={8} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
                <SectionHeadingNative title={`${analysis.items.length} elementos`} tokens={tokens} />
                <ItemStripNative items={analysis.items} selectedId={itemId} tokens={tokens} onSelect={(id) => { if (!busy) { setItemId(id); setError(null); } }} />
              </VStack> : null}

              {modes.length > 1 || showQuality || showAudioTracks ? <VStack alignment="leading" spacing={6} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
                {modes.length > 1 ? <Picker selection={activeMode} onSelectionChange={(value) => { setMode(value as DownloadMode); setError(null); }} modifiers={[pickerStyle('segmented'), frame({ maxWidth: Infinity }), padding({ bottom: 6 }), disabled(busy), accessibilityLabel('Formato')]}>
                  {modes.map((option) => <NativeText key={option} modifiers={[tag(option)]}>{MODE_LABELS[option]}</NativeText>)}
                </Picker> : null}
                {showQuality && analysis ? <OptionRowNative label="Calidad" tokens={tokens}>
                  <Picker selection={qualityHeight ?? analysis.qualities[0].height} onSelectionChange={(value) => setQualityHeight(Number(value))} modifiers={[pickerStyle('menu'), tint(tokens.blue), disabled(busy), accessibilityLabel('Calidad')]}>
                    {analysis.qualities.map((quality) => <NativeText key={quality.id} modifiers={[tag(quality.height)]}>{quality.label}</NativeText>)}
                  </Picker>
                </OptionRowNative> : null}
                {showQuality && showAudioTracks ? <Divider /> : null}
                {showAudioTracks && analysis ? <OptionRowNative label="Idioma" tokens={tokens}>
                  <Picker selection={audioTrack?.id ?? ''} onSelectionChange={(value) => setAudioTrackId(String(value))} modifiers={[pickerStyle('menu'), tint(tokens.blue), disabled(busy), accessibilityLabel('Idioma del audio')]}>
                    {analysis.audioTracks.map((track) => <NativeText key={track.id} modifiers={[tag(track.id)]}>{track.label}</NativeText>)}
                  </Picker>
                </OptionRowNative> : null}
              </VStack> : null}
            </> : null}

            {history.length ? <VStack alignment="leading" spacing={10} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
              <SectionHeadingNative title="Recientes" tokens={tokens} />
              {history.map((entry, index) => <VStack key={entry.id} spacing={0} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
                {index > 0 ? <Divider /> : null}
                <ContextMenu>
                  <ContextMenu.Trigger>
                    <NativeButton onPress={() => void openHistory(entry)} modifiers={[buttonStyle('plain'), accessibilityLabel(`${entry.title}, ${MODE_LABELS[entry.mode] ?? ''}`)]}>
                      <HStack alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ vertical: 8 }), contentShape(shapes.rectangle())]}>
                        <HistoryThumbnailNative entry={entry} tokens={tokens} />
                        <VStack alignment="leading" spacing={2} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
                          <NativeText modifiers={[...textModifiers(tokens, { style: 'body' }), lineLimit(1)]}>{entry.title}</NativeText>
                          <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'footnote' })}>{`${MODE_LABELS[entry.mode] ?? 'Archivo'} · ${sourceForKey(entry.source).label} · ${new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'short' }).format(entry.createdAt)}`}</NativeText>
                        </VStack>
                        <SymbolImage name="square.and.arrow.up" color={tokens.secondary} size={17} />
                      </HStack>
                    </NativeButton>
                  </ContextMenu.Trigger>
                  <ContextMenu.Items>
                    <NativeButton label="Compartir" systemImage="square.and.arrow.up" onPress={() => void openHistory(entry)} />
                    <NativeButton label="Eliminar del iPhone" systemImage="trash" role="destructive" onPress={() => void removeHistory(entry)} />
                  </ContextMenu.Items>
                </ContextMenu>
              </VStack>)}
            </VStack> : !analysis && phase !== 'analyzing' ? <VStack alignment="leading" spacing={12} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
              <SectionHeadingNative title="Compatibles" tokens={tokens} />
              <HStack alignment="center" spacing={0} modifiers={[frame({ maxWidth: Infinity }), contentShape(shapes.rectangle()), onTapGesture(dismissKeyboard)]}>
                {(['youtube', 'instagram', 'facebook', 'x', 'tiktok'] as const).map((key) => <VStack key={key} alignment="center" spacing={6} modifiers={[frame({ maxWidth: Infinity })]}>
                  <SourceIconNative source={key} tokens={tokens} size={44} />
                  <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'caption' })}>{sourceForKey(key).label}</NativeText>
                </VStack>)}
              </HStack>
            </VStack> : null}
          </VStack>
        </ScrollView>
        {showBar ? <VStack modifiers={[padding({ horizontal: UI.pageInset, bottom: 12 })]}>
          <DownloadBarNative state={phase === 'downloading' ? 'downloading' : phase === 'done' ? 'done' : 'ready'} fraction={fraction} preparing={preparing} tokens={tokens} onDownload={() => void download()} onCancel={() => task.current?.cancel()} />
        </VStack> : null}
      </ZStack>
    </PageNative>
  );
}

function OptionRowNative({ label, tokens, children }: { label: string; tokens: ThemeTokens; children: ReactNode }) {
  return <HStack alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity, minHeight: 44 }), padding({ horizontal: 4 })]}>
    <NativeText modifiers={textModifiers(tokens)}>{label}</NativeText>
    <Spacer />
    {children}
  </HStack>;
}

// The saved file's own picture when there is one; the service mark otherwise.
function HistoryThumbnailNative({ entry, tokens }: { entry: DownloadHistoryItem; tokens: ThemeTokens }) {
  if (!entry.thumbnail) return <SourceIconNative source={entry.source} tokens={tokens} size={48} />;
  return <VStack modifiers={[frame({ width: 48, height: 48 }), clipShape('roundedRectangle', 10), accessibilityHidden()]}>
    <RNHostView>
      <RNImage source={{ uri: entry.thumbnail }} style={{ flex: 1, backgroundColor: tokens.mode === 'dark' ? '#2A2938' : '#E4E6EC' }} resizeMode="cover" />
    </RNHostView>
  </VStack>;
}
