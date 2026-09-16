import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import {
  BottomSheet,
  Button as NativeButton,
  ConfirmationDialog,
  ContextMenu,
  DatePicker,
  Form,
  Group,
  HStack,
  Host,
  List,
  Image as NativeImage,
  Picker,
  ProgressView,
  Section,
  ScrollView,
  Spacer,
  TabView,
  Text as NativeText,
  TextField,
  type TextFieldRef,
  VStack,
  ZStack,
  useNativeState,
} from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  accessibilityAddTraits,
  accessibilityHidden,
  buttonBorderShape,
  buttonStyle,
  clipShape,
  contentShape,
  controlSize,
  disabled,
  interactiveDismissDisabled,
  font,
  frame,
  autocorrectionDisabled,
  keyboardType,
  textInputAutocapitalization,
  listStyle,
  monospacedDigit,
  onSubmit,
  padding,
  pickerStyle,
  presentationDetents,
  presentationDragIndicator,
  scrollContentBackground,
  shapes,
  submitLabel,
  tag,
  textFieldStyle,
  type ViewModifier,
} from '@expo/ui/swift-ui/modifiers';
import type { SFSymbol } from 'sf-symbols-typescript';
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Alert, Appearance, Platform, PlatformColor, useColorScheme, useWindowDimensions, type ColorValue } from 'react-native';
import { formatScheduleTime, parseSchedule, todayAgenda, type ScheduleEntry } from './schedule-data';
import { useCurrentTime } from './use-current-time';
import { UI, type MiniappDestination } from './ui-structure';
import { analyzeUrl, detectDownloadSource, downloadFromService, downloaderErrorMessage, formatDuration, saveDownload, type DownloadAnalysis, type DownloadMode, type DownloadSource } from './downloader-api';
import { StatusBar } from 'expo-status-bar';
import { background, foregroundStyle, strokeBorder, tint } from './native-colors';

type ThemeMode = 'system' | 'light' | 'dark';
type Screen = 'home' | 'miniapps' | 'settings';
type ScheduleView = 'day' | 'week';
type DayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;
type ScheduleColor = 'slate' | 'coral' | 'sage';

type ThemeTokens = {
  mode: 'light' | 'dark';
  background: ColorValue;
  surface: ColorValue;
  surfaceRaised: ColorValue;
  text: ColorValue;
  secondary: ColorValue;
  muted: ColorValue;
  border: ColorValue;
  slate: string;
  slateSoft: string;
  blue: string;
  blueSoft: string;
  sage: string;
  sageSoft: string;
  danger: string;
  inverseText: string;
};

const STORAGE_KEY = '@miniapps/schedule';
const THEME_KEY = '@miniapps/theme';
const SHEET_ACTION_INSET = UI.sheetActionInset;
const CIRCLE_CONTROL_SIZE = UI.circleControlSize;
// Keep the label box smaller than the outer control so SwiftUI's glass style
// can contribute its own insets without changing the diameter per symbol.
const CIRCLE_ICON_LAYOUT_SIZE = 16;

const DAYS: Array<{ short: string; long: string; index: DayIndex }> = [
  { short: 'Lun', long: 'Lunes', index: 0 },
  { short: 'Mar', long: 'Martes', index: 1 },
  { short: 'Mié', long: 'Miércoles', index: 2 },
  { short: 'Jue', long: 'Jueves', index: 3 },
  { short: 'Vie', long: 'Viernes', index: 4 },
  { short: 'Sáb', long: 'Sábado', index: 5 },
  { short: 'Dom', long: 'Domingo', index: 6 },
];

const COLORS: Array<{ key: ScheduleColor; label: string }> = [
  { key: 'slate', label: 'Azul pizarra' },
  { key: 'coral', label: 'Azul' },
  { key: 'sage', label: 'Salvia' },
];

const LIGHT: ThemeTokens = {
  mode: 'light',
  background: PlatformColor('systemGroupedBackground'),
  surface: PlatformColor('secondarySystemGroupedBackground'),
  surfaceRaised: PlatformColor('tertiarySystemGroupedBackground'),
  text: PlatformColor('label'),
  secondary: PlatformColor('secondaryLabel'),
  muted: PlatformColor('secondaryLabel'),
  border: PlatformColor('separator'),
  slate: '#24324A',
  slateSoft: '#DDE5F1',
  blue: '#0A66E8',
  blueSoft: '#DDEAFF',
  sage: '#486553',
  sageSoft: '#DCE9DF',
  danger: '#A83232',
  inverseText: '#FFFFFF',
};

const DARK: ThemeTokens = {
  mode: 'dark',
  background: PlatformColor('systemGroupedBackground'),
  surface: PlatformColor('secondarySystemGroupedBackground'),
  surfaceRaised: PlatformColor('tertiarySystemGroupedBackground'),
  text: PlatformColor('label'),
  secondary: PlatformColor('secondaryLabel'),
  muted: PlatformColor('secondaryLabel'),
  border: PlatformColor('separator'),
  slate: '#AFC2E0',
  slateSoft: '#2B374A',
  blue: '#7DB0FF',
  blueSoft: '#233A60',
  sage: '#B3D5BE',
  sageSoft: '#294033',
  danger: '#FFAAA7',
  inverseText: '#14161C',
};

const EXAMPLE_SCHEDULE: ScheduleEntry[] = [
  { id: 'example-1', title: 'Diseño de producto', day: 0, start: '08:30', end: '10:00', location: 'Aula 203', color: 'slate' },
  { id: 'example-2', title: 'Inglés', day: 1, start: '11:00', end: '12:00', location: 'Sala 4', color: 'coral' },
  { id: 'example-3', title: 'Programación', day: 2, start: '09:00', end: '10:30', location: 'Laboratorio', color: 'sage' },
  { id: 'example-4', title: 'Investigación', day: 3, start: '14:00', end: '15:30', location: '', color: 'slate' },
];

const nativeGlassAvailable = Number(Platform.Version) >= 26;

function getTokens(themeMode: ThemeMode, systemScheme: 'light' | 'dark' | 'unspecified' | null | undefined) {
  return themeMode === 'dark' || (themeMode === 'system' && systemScheme === 'dark') ? DARK : LIGHT;
}

function currentDayIndex(): DayIndex {
  return ((new Date().getDay() + 6) % 7) as DayIndex;
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function minutesFromTime(value: string) {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function isValidTime(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function sortedEntries(entries: ScheduleEntry[]) {
  return [...entries].sort((a, b) => a.start.localeCompare(b.start));
}

function timeToDate(value: string) {
  const [hours, minutes] = value.split(':').map(Number);
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date;
}

function dateToTime(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function colorForKey(key: ScheduleColor, tokens: ThemeTokens) {
  if (key === 'coral') return { main: tokens.blue, soft: tokens.blueSoft };
  if (key === 'sage') return { main: tokens.sage, soft: tokens.sageSoft };
  return { main: tokens.slate, soft: tokens.slateSoft };
}

function textModifiers(tokens: ThemeTokens, options: { color?: ColorValue; style?: 'largeTitle' | 'title' | 'title2' | 'title3' | 'headline' | 'subheadline' | 'body' | 'callout' | 'footnote' | 'caption' | 'caption2'; weight?: 'regular' | 'medium' | 'semibold' | 'bold' } = {}): ViewModifier[] {
  return [
    foregroundStyle(options.color ?? tokens.text),
    font({ textStyle: options.style ?? 'body', weight: options.weight ?? 'regular' }),
    ...(['largeTitle', 'title', 'title2', 'title3'].includes(options.style ?? '') ? [accessibilityAddTraits(['isHeader'])] : []),
  ];
}

function AdaptiveRow({ children, modifiers }: { children: ReactNode; modifiers?: ViewModifier[] }) {
  const { width, fontScale } = useWindowDimensions();
  return width < 350 || fontScale >= 1.3
    ? <VStack alignment="leading" spacing={12} modifiers={modifiers}>{children}</VStack>
    : <HStack alignment="top" spacing={12} modifiers={modifiers}>{children}</HStack>;
}

function surfaceModifiers(tokens: ThemeTokens, radius = 22): ViewModifier[] {
  return [
    frame({ maxWidth: Infinity, alignment: 'leading' }),
    padding({ all: 18 }),
    background(tokens.surface),
    clipShape('roundedRectangle', radius),
  ];
}

function nativeGlassModifiers(tokens: ThemeTokens, prominent = false, shape: 'capsule' | 'card' | 'circle' = 'capsule'): ViewModifier[] {
  return [
    buttonStyle(nativeGlassAvailable ? (prominent ? 'glassProminent' : 'glass') : (prominent ? 'borderedProminent' : 'bordered')),
    buttonBorderShape(shape === 'capsule' ? 'capsule' : shape === 'circle' ? 'circle' : 'roundedRectangle', shape === 'card' ? 18 : undefined),
    controlSize('large'),
    ...(prominent ? [tint(tokens.blue)] : []),
    foregroundStyle(prominent ? tokens.inverseText : tokens.text),
  ];
}

function nativeCircleModifiers(tokens: ThemeTokens, accent = false): ViewModifier[] {
  return [
    // A shared prominent style gives every circular peer the same native
    // metrics. Neutral controls use the raised system surface as their tint;
    // primary controls keep the app's blue accent.
    buttonStyle(nativeGlassAvailable ? 'glassProminent' : 'borderedProminent'),
    buttonBorderShape('circle'),
    controlSize('large'),
    tint(accent ? tokens.blue : tokens.surfaceRaised),
    foregroundStyle(accent ? tokens.inverseText : tokens.text),
  ];
}

function NativeCircleButton({ tokens, accent = false, label, systemName, onPress, disabled: isDisabled = false }: { tokens: ThemeTokens; accent?: boolean; label: string; systemName: SFSymbol; onPress: () => void; disabled?: boolean }) {
  const iconColor = accent ? tokens.inverseText : tokens.text;
  return (
    <NativeButton onPress={onPress} modifiers={[...nativeCircleModifiers(tokens, accent), frame({ width: CIRCLE_CONTROL_SIZE, height: CIRCLE_CONTROL_SIZE }), accessibilityLabel(label), disabled(isDisabled)]}>
      <ZStack modifiers={[frame({ width: CIRCLE_ICON_LAYOUT_SIZE, height: CIRCLE_ICON_LAYOUT_SIZE })]}>
        <NativeImage systemName={systemName} size={20} color={iconColor} />
      </ZStack>
    </NativeButton>
  );
}

function PageNative({ title, tokens, onBack, action, children }: { title: string; tokens: ThemeTokens; onBack?: () => void; action?: ReactNode; children: ReactNode }) {
  return <VStack spacing={0} modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'topLeading' }), background(tokens.background)]}>
    <VStack alignment="leading" spacing={12} modifiers={[frame({ maxWidth: UI.contentWidth, alignment: 'leading' }), padding({ horizontal: UI.pageInset, top: 12, bottom: 8 })]}>
      {onBack ? <HStack alignment="center" spacing={12}>
        <NativeCircleButton tokens={tokens} label="Volver a Miniapps" systemName="chevron.left" onPress={onBack} />
        <Spacer />
        <NativeText modifiers={[...textModifiers(tokens, { style: 'headline', weight: 'semibold' }), accessibilityAddTraits(['isHeader'])]}>{title}</NativeText>
        <Spacer />
        {action ?? <VStack modifiers={[frame({ width: CIRCLE_CONTROL_SIZE, height: CIRCLE_CONTROL_SIZE })]}>{null}</VStack>}
      </HStack> : null}
      {!onBack && <NativeText modifiers={[...textModifiers(tokens, { style: 'largeTitle', weight: 'bold' }), accessibilityAddTraits(['isHeader'])]}>{title}</NativeText>}
    </VStack>
    {children}
  </VStack>;
}

function ReadingCanvasNative({ tokens, children }: { tokens: ThemeTokens; children: ReactNode }) {
  return <ScrollView modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity })]}>
    <VStack alignment="leading" spacing={28} modifiers={[frame({ maxWidth: UI.contentWidth, alignment: 'leading' }), padding({ horizontal: UI.pageInset, top: 20, bottom: 32 })]}>{children}</VStack>
  </ScrollView>;
}

function groupedListModifiers(tokens: ThemeTokens): ViewModifier[] {
  return [listStyle('insetGrouped'), scrollContentBackground('hidden'), background(tokens.background), frame({ maxWidth: UI.contentWidth, maxHeight: Infinity })];
}

function SymbolImage({ name, color, size = 22 }: { name: SFSymbol; color: ColorValue; size?: number }) {
  const textStyle = size >= 25 ? 'title' : size >= 22 ? 'title2' : size >= 18 ? 'body' : 'caption';
  return <NativeImage systemName={name} modifiers={[font({ textStyle }), foregroundStyle(color), accessibilityHidden()]} />;
}

function SourceBadgeNative({ source, tokens }: { source: DownloadSource; tokens: ThemeTokens }) {
  return <VStack alignment="center" spacing={0} modifiers={[frame({ width: 34, height: 34 }), background(tokens.slateSoft), clipShape('roundedRectangle', 10), accessibilityLabel(`Fuente ${source.label}`)]}>
    <NativeText modifiers={[...textModifiers(tokens, { color: tokens.slate, style: source.shortLabel.length > 2 ? 'caption2' : 'body', weight: 'bold' }), accessibilityHidden()]}>{source.shortLabel}</NativeText>
  </VStack>;
}

function DataStateNative({ loading, error, tokens, onRetry }: { loading: boolean; error: string | null; tokens: ThemeTokens; onRetry: () => void }) {
  return <VStack alignment="leading" spacing={12} modifiers={surfaceModifiers(tokens)}>
    {loading ? <ProgressView /> : <SymbolImage name="exclamationmark.triangle" color={tokens.danger} />}
    <NativeText modifiers={textModifiers(tokens)}>{loading ? 'Cargando horario…' : error}</NativeText>
    {!loading && <NativeButton label="Reintentar" onPress={onRetry} modifiers={[buttonStyle('bordered'), controlSize('large')]} />}
  </VStack>;
}

function HomeNative({ entries, tokens, loading, error, onOpenSchedule, onRetry }: { entries: ScheduleEntry[]; tokens: ThemeTokens; loading: boolean; error: string | null; onOpenSchedule: () => void; onRetry: () => void }) {
  const now = useCurrentTime();
  const { today, remaining, next, ongoing } = todayAgenda(entries, now);
  const emptyTitle = !entries.length ? 'Aún no hay clases' : today.length ? 'Clases terminadas' : 'Día libre';

  return (
    <PageNative title="Hoy" tokens={tokens}>
      <ReadingCanvasNative tokens={tokens}>
        <VStack alignment="leading" spacing={20} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
          <HStack alignment="center" spacing={16}>
            <NativeText modifiers={[...textModifiers(tokens, { color: tokens.blue, style: 'largeTitle', weight: 'bold' }), monospacedDigit()]}>{String(now.getDate())}</NativeText>
            <VStack alignment="leading" spacing={2}>
              <NativeText modifiers={textModifiers(tokens, { style: 'headline', weight: 'semibold' })}>{new Intl.DateTimeFormat('es-PE', { weekday: 'long' }).format(now)}</NativeText>
              <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'subheadline' })}>{new Intl.DateTimeFormat('es-PE', { month: 'long', year: 'numeric' }).format(now)}</NativeText>
            </VStack>
          </HStack>
          {loading || error ? <DataStateNative loading={loading} error={error} tokens={tokens} onRetry={onRetry} /> : (
            <VStack alignment="leading" spacing={20} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ all: 24 }), background(tokens.surface), clipShape('roundedRectangle', UI.groupRadius)]}>
              {next ? <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'subheadline', weight: 'semibold' })}>{ongoing ? 'En curso' : 'A continuación'}</NativeText> : null}
              {next ? <>
                <NativeText modifiers={textModifiers(tokens, { style: 'title', weight: 'bold' })}>{next.title}</NativeText>
                <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'body' })}>{[`${formatScheduleTime(next.start)} a ${formatScheduleTime(next.end)}`, next.location].filter(Boolean).join(' · ')}</NativeText>
                {ongoing ? <ProgressView value={Math.min(1, Math.max(0, (now.getHours() * 60 + now.getMinutes() - minutesFromTime(next.start)) / (minutesFromTime(next.end) - minutesFromTime(next.start))))} modifiers={[tint(tokens.blue), accessibilityLabel('Progreso de la clase')]} /> : null}
              </> : <HStack alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ vertical: 4 })]}>
                <VStack alignment="center" spacing={0} modifiers={[frame({ width: 44, height: 44 }), background(tokens.slateSoft), clipShape('roundedRectangle', 12)]}>
                  <SymbolImage name="calendar" color={tokens.slate} size={22} />
                </VStack>
                <VStack alignment="leading" spacing={4} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
                  <NativeText modifiers={textModifiers(tokens, { style: 'title2', weight: 'semibold' })}>{emptyTitle}</NativeText>
                </VStack>
              </HStack>}
              <NativeButton label="Abrir horario" onPress={onOpenSchedule} modifiers={nativeGlassModifiers(tokens, true)} />
            </VStack>
          )}
        </VStack>
        {!loading && !error && remaining.length > 1 ? <VStack alignment="leading" spacing={8} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
          <NativeText modifiers={textModifiers(tokens, { style: 'title2', weight: 'bold' })}>Después</NativeText>
          {remaining.slice(1).map((entry) => <AgendaContentNative key={entry.id} entry={entry} tokens={tokens} />)}
        </VStack> : null}
      </ReadingCanvasNative>
    </PageNative>
  );
}

function DownloaderNative({ tokens, onBack }: { tokens: ThemeTokens; onBack: () => void }) {
  const urlState = useNativeState('');
  const [url, setUrl] = useState('');
  const [mode, setMode] = useState<DownloadMode>('video');
  const [phase, setPhase] = useState<'idle' | 'analyzing' | 'ready' | 'downloading'>('idle');
  const [analysis, setAnalysis] = useState<DownloadAnalysis | null>(null);
  const [selectedVideoId, setSelectedVideoId] = useState('');
  const [qualityHeight, setQualityHeight] = useState<number | null>(null);
  const [status, setStatus] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const source = detectDownloadSource(url);
  const selectedVideo = analysis?.videos.find((video) => video.id === selectedVideoId);

  const updateUrl = (value: string) => {
    setUrl(value);
    urlState.set(value);
    setAnalysis(null);
    setSelectedVideoId('');
    setQualityHeight(null);
    setPhase('idle');
    setStatus(null);
  };

  const analyze = async () => {
    if (phase === 'analyzing' || phase === 'downloading' || !url.trim()) return;
    setPhase('analyzing');
    setStatus(null);
    try {
      const result = await analyzeUrl(url);
      setAnalysis(result);
      setSelectedVideoId(result.videos[0]?.id ?? '');
      setQualityHeight(result.qualities[0]?.height ?? null);
      setPhase('ready');
    } catch (error) {
      setAnalysis(null);
      setPhase('idle');
      setStatus({ kind: 'error', text: downloaderErrorMessage(error, 'No se pudo analizar el enlace.') });
    }
  };

  const download = async () => {
    if (phase !== 'ready' || !url.trim()) return;
    setPhase('downloading');
    setStatus(null);
    try {
      const result = await downloadFromService(selectedVideo?.url || url, mode, mode === 'video' ? qualityHeight : null);
      await saveDownload(result);
      setStatus({ kind: 'success', text: 'Listo.' });
      setPhase('ready');
    } catch (error) {
      setPhase('ready');
      setStatus({ kind: 'error', text: downloaderErrorMessage(error, 'No se pudo completar la descarga.') });
    }
  };

  const isBusy = phase === 'analyzing' || phase === 'downloading';
  const actionLabel = phase === 'analyzing' ? 'Analizando…' : phase === 'downloading' ? 'Descargando…' : phase === 'ready' ? 'Descargar' : 'Analizar';
  const videoCountLabel = analysis ? `${analysis.videoCount} ${analysis.videoCount === 1 ? 'video disponible' : 'videos disponibles'}` : null;

  return (
    <PageNative title="Downloader" tokens={tokens} onBack={onBack}>
      <Form modifiers={groupedListModifiers(tokens)}>
        <Section title="Enlace">
          <HStack alignment="center" spacing={8} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
            {source ? <SourceBadgeNative source={source} tokens={tokens} /> : null}
            <TextField text={urlState} onTextChange={updateUrl} placeholder="https://…" modifiers={[frame({ maxWidth: Infinity }), font({ textStyle: 'body' }), textFieldStyle('plain'), keyboardType('url'), textInputAutocapitalization('never'), autocorrectionDisabled(), disabled(isBusy), accessibilityLabel('Enlace del audio o video'), submitLabel('go'), onSubmit(() => { if (phase === 'idle') void analyze(); })]} />
            {!analysis ? <NativeCircleButton tokens={tokens} accent label="Analizar enlace" systemName="arrow.up" onPress={() => void analyze()} disabled={isBusy || !url.trim()} /> : null}
          </HStack>
          {isBusy ? <VStack alignment="center" spacing={6} modifiers={[frame({ maxWidth: Infinity, alignment: 'center' }), padding({ vertical: 8 })]}>
            <ProgressView />
            <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'subheadline' })}>{actionLabel}</NativeText>
          </VStack> : null}
        </Section>
        {analysis ? <>
          <Section title="Contenido">
            <VStack alignment="leading" spacing={8} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ vertical: 8 })]}>
              <NativeText modifiers={textModifiers(tokens, { style: 'title2', weight: 'bold' })}>{analysis.title}</NativeText>
              {analysis.uploader ? <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'subheadline' })}>Usuario: {analysis.uploader}</NativeText> : null}
              {formatDuration(analysis.durationSeconds) ? <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'subheadline' })}>Duración: {formatDuration(analysis.durationSeconds)}</NativeText> : null}
              {analysis.description ? <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'body' })}>{analysis.description}</NativeText> : null}
            </VStack>
          </Section>
          {analysis.videos.length > 1 ? <Section title="Videos">
            {videoCountLabel ? <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'subheadline' })}>{videoCountLabel}</NativeText> : null}
            {analysis.videos.length > 1 ? <Picker label="Video" selection={selectedVideoId} onSelectionChange={(value) => setSelectedVideoId(String(value))} modifiers={[pickerStyle('menu'), disabled(isBusy), accessibilityLabel('Video')]}>
              {analysis.videos.map((video) => <NativeText key={video.id} modifiers={[tag(video.id)]}>{video.title}</NativeText>)}
            </Picker> : null}
          </Section> : null}
          <Section title="Formato">
            <Picker selection={mode} onSelectionChange={(value) => { setMode(value as DownloadMode); setStatus(null); }} modifiers={[pickerStyle('segmented'), frame({ maxWidth: Infinity }), disabled(isBusy), accessibilityLabel('Formato')]}>
              <NativeText modifiers={[tag('video')]}>Video</NativeText>
              <NativeText modifiers={[tag('audio')]}>Audio</NativeText>
            </Picker>
          </Section>
          {mode === 'video' && analysis.qualities.length > 0 ? <Section title="Calidad">
            <Picker label="Calidad" selection={qualityHeight ?? analysis.qualities[0].height} onSelectionChange={(value) => setQualityHeight(Number(value))} modifiers={[pickerStyle('menu'), disabled(isBusy), accessibilityLabel('Calidad')]}>
              {analysis.qualities.map((quality) => <NativeText key={quality.id} modifiers={[tag(quality.height)]}>{quality.label}</NativeText>)}
            </Picker>
          </Section> : null}
          <Section>
            <HStack alignment="center" spacing={16} modifiers={[padding({ vertical: 8 })]}>
              <VStack alignment="leading" spacing={4} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
                <NativeText modifiers={textModifiers(tokens, { style: 'headline', weight: 'semibold' })}>{mode === 'audio' ? 'Guardar audio' : 'Guardar video'}</NativeText>
              </VStack>
              <NativeCircleButton tokens={tokens} accent label="Descargar" systemName="arrow.down" onPress={() => void download()} disabled={isBusy} />
            </HStack>
          </Section>
        </> : null}
        {status ? (
          <HStack alignment="top" spacing={7} modifiers={[padding({ horizontal: 4 })]}>
            <SymbolImage name={status.kind === 'error' ? 'exclamationmark.circle' : 'checkmark.circle'} color={status.kind === 'error' ? tokens.danger : tokens.blue} size={18} />
            <NativeText modifiers={textModifiers(tokens, { color: status.kind === 'error' ? tokens.danger : tokens.blue, style: 'callout', weight: 'semibold' })}>{status.text}</NativeText>
          </HStack>
        ) : null}
      </Form>
    </PageNative>
  );
}

function MiniappsNative({ entries, tokens, loading, error, onOpenSchedule, onOpenDownloader, onClearSchedule }: { entries: ScheduleEntry[]; tokens: ThemeTokens; loading: boolean; error: string | null; onOpenSchedule: () => void; onOpenDownloader: () => void; onClearSchedule: () => void }) {
  const scheduleRow = <MiniappRowNative title="Horario" detail={loading ? 'Cargando…' : error ? 'No disponible' : entries.length ? `${entries.length} ${entries.length === 1 ? 'clase guardada' : 'clases guardadas'}` : 'Sin clases guardadas'} icon="calendar" iconColor={tokens.slate} iconBackground={tokens.slateSoft} tokens={tokens} onPress={onOpenSchedule} label="Abrir Miniapp Horario" />;
  const downloaderRow = <MiniappRowNative title="Downloader" detail="Audio y video" icon="arrow.down.circle" iconColor={tokens.blue} iconBackground={tokens.blueSoft} tokens={tokens} onPress={onOpenDownloader} label="Abrir Miniapp Downloader" />;

  return (
    <PageNative title="Biblioteca" tokens={tokens}>
      <ReadingCanvasNative tokens={tokens}>
        <VStack alignment="leading" spacing={12} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
          <VStack alignment="leading" spacing={16} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ all: 20 }), background(tokens.surface), clipShape('roundedRectangle', UI.groupRadius)]}>
          {!loading && !error && entries.length > 0 ? (
            <ContextMenu>
              <ContextMenu.Trigger>{scheduleRow}</ContextMenu.Trigger>
              <ContextMenu.Items>
                <NativeButton label="Borrar horario" systemImage="trash" role="destructive" onPress={onClearSchedule} />
              </ContextMenu.Items>
            </ContextMenu>
          ) : scheduleRow}
          </VStack>
        </VStack>
        <VStack alignment="leading" spacing={12} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
          <VStack alignment="leading" spacing={0} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ all: 20 }), background(tokens.surface), clipShape('roundedRectangle', UI.groupRadius)]}>{downloaderRow}</VStack>
        </VStack>
      </ReadingCanvasNative>
    </PageNative>
  );
}

function MiniappRowNative({ title, detail, icon, iconColor, iconBackground, tokens, onPress, label }: { title: string; detail: string; icon: SFSymbol; iconColor: string; iconBackground: string; tokens: ThemeTokens; onPress: () => void; label: string }) {
  return (
    <NativeButton onPress={onPress} modifiers={[buttonStyle('plain'), frame({ maxWidth: Infinity, minHeight: 84, alignment: 'leading' }), accessibilityLabel(label)]}>
      <HStack alignment="center" spacing={16} modifiers={[frame({ maxWidth: Infinity, minHeight: 84, alignment: 'leading' }), padding({ vertical: 8 }), contentShape(shapes.rectangle())]}>
        <VStack alignment="center" spacing={0} modifiers={[frame({ width: 44, height: 44 }), background(iconBackground), clipShape('roundedRectangle', 12)]}>
          <SymbolImage name={icon} color={iconColor} size={22} />
        </VStack>
        <VStack alignment="leading" spacing={3}>
          <NativeText modifiers={textModifiers(tokens, { style: 'title2', weight: 'bold' })}>{title}</NativeText>
          <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'footnote' })}>{detail}</NativeText>
        </VStack>
        <Spacer />
        <SymbolImage name="chevron.right" color={tokens.secondary} size={17} />
      </HStack>
    </NativeButton>
  );
}

function HomeTabNative({ entries, tokens, loading, error, onOpenSchedule, onRetry }: { entries: ScheduleEntry[]; tokens: ThemeTokens; loading: boolean; error: string | null; onOpenSchedule: () => void; onRetry: () => void }) {
  return (
    <VStack modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity })]}>
      <HomeNative entries={entries} tokens={tokens} loading={loading} error={error} onOpenSchedule={onOpenSchedule} onRetry={onRetry} />
    </VStack>
  );
}

function MiniappsTabNative({ entries, tokens, loading, error, destination, schedule, downloader, onOpenSchedule, onOpenDownloader, onClearSchedule }: { entries: ScheduleEntry[]; tokens: ThemeTokens; loading: boolean; error: string | null; destination: MiniappDestination; schedule: ReactNode; downloader: ReactNode; onOpenSchedule: () => void; onOpenDownloader: () => void; onClearSchedule: () => void }) {
  return (
    <VStack modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity })]}>
      {destination === 'schedule' ? schedule : destination === 'downloader' ? downloader : <MiniappsNative entries={entries} tokens={tokens} loading={loading} error={error} onOpenSchedule={onOpenSchedule} onOpenDownloader={onOpenDownloader} onClearSchedule={onClearSchedule} />}
    </VStack>
  );
}

function SettingsNative({ themeMode, tokens, onThemeChange }: { themeMode: ThemeMode; tokens: ThemeTokens; onThemeChange: (mode: ThemeMode) => void }) {
  const labels: Record<ThemeMode, string> = { system: 'Sistema', light: 'Claro', dark: 'Oscuro' };

  return (
    <PageNative title="Ajustes" tokens={tokens}>
      <Form modifiers={groupedListModifiers(tokens)}>
        <Section title="Tema">
          <Picker selection={themeMode} onSelectionChange={(value) => onThemeChange(value as ThemeMode)} modifiers={[pickerStyle('inline'), accessibilityLabel('Tema')]}>
            {(Object.keys(labels) as ThemeMode[]).map((mode) => <HStack key={mode} spacing={12} modifiers={[tag(mode), padding({ vertical: 8 })]}><SymbolImage name={mode === 'system' ? 'iphone' : mode === 'light' ? 'sun.max' : 'moon'} color={tokens.secondary} /><NativeText modifiers={textModifiers(tokens)}>{labels[mode]}</NativeText></HStack>)}
          </Picker>
        </Section>
      </Form>
    </PageNative>
  );
}

function ScheduleEntryRowNative({ entry, tokens, onPress }: { entry: ScheduleEntry; tokens: ThemeTokens; onPress: () => void }) {
  return (
    <NativeButton onPress={onPress} modifiers={[buttonStyle('plain'), frame({ maxWidth: Infinity, alignment: 'leading' }), accessibilityLabel(`Editar ${entry.title}, de ${formatScheduleTime(entry.start)} a ${formatScheduleTime(entry.end)}${entry.location ? `, ${entry.location}` : ''}`)]}>
      <AgendaContentNative entry={entry} tokens={tokens} />
    </NativeButton>
  );
}

function AgendaContentNative({ entry, tokens }: { entry: ScheduleEntry; tokens: ThemeTokens }) {
  const entryColor = colorForKey(entry.color, tokens);
  return <AdaptiveRow modifiers={[frame({ maxWidth: Infinity, minHeight: 72, alignment: 'leading' }), padding({ vertical: 12 }), contentShape(shapes.rectangle())]}>
        <VStack alignment="leading" spacing={4}>
          <NativeText modifiers={[...textModifiers(tokens, { style: 'headline', weight: 'semibold' }), monospacedDigit()]}>{formatScheduleTime(entry.start)}</NativeText>
          <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'subheadline' }), monospacedDigit()]}>{formatScheduleTime(entry.end)}</NativeText>
        </VStack>
        <VStack alignment="leading" spacing={6} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
          <HStack alignment="center" spacing={7}>
            <SymbolImage name="circle.fill" color={entryColor.main} size={8} />
            <NativeText modifiers={textModifiers(tokens, { style: 'headline', weight: 'semibold' })}>{entry.title}</NativeText>
          </HStack>
          {entry.location ? <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'subheadline' })}>{entry.location}</NativeText> : null}
        </VStack>
      </AdaptiveRow>;
}

function EmptyAgendaNative({ entries, tokens, onLoadExample }: { entries: ScheduleEntry[]; tokens: ThemeTokens; onLoadExample: () => void }) {
  return (
    <VStack alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity, alignment: 'center' }), padding({ vertical: 28, horizontal: 20 })]}>
      <SymbolImage name="calendar" color={tokens.secondary} size={26} />
      <NativeText modifiers={[...textModifiers(tokens, { style: 'title3', weight: 'semibold' }), accessibilityAddTraits(['isHeader'])]}>{entries.length === 0 ? 'Sin clases' : 'Día libre'}</NativeText>
      {entries.length === 0 ? <NativeButton label="Cargar un ejemplo" onPress={onLoadExample} modifiers={[buttonStyle('borderless'), tint(tokens.slate)]} /> : null}
    </VStack>
  );
}

function WeekOverviewNative({ entries, tokens, onEdit }: { entries: ScheduleEntry[]; tokens: ThemeTokens; onEdit: (entry: ScheduleEntry) => void }) {
  const visibleDays = DAYS.filter((day) => entries.some((entry) => entry.day === day.index));
  return (
    <Group>
      {visibleDays.map((day) => {
        const dayEntries = sortedEntries(entries.filter((entry) => entry.day === day.index));
        return (
          <Section key={day.index} header={<HStack spacing={8}><NativeText modifiers={textModifiers(tokens, { color: day.index === currentDayIndex() ? tokens.blue : tokens.text, style: 'title3', weight: 'bold' })}>{day.long}</NativeText><Spacer /><NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'caption' })}>{`${dayEntries.length} ${dayEntries.length === 1 ? 'clase' : 'clases'}`}</NativeText></HStack>}>
              {dayEntries.map((entry) => <ScheduleEntryRowNative key={entry.id} entry={entry} tokens={tokens} onPress={() => onEdit(entry)} />)}
          </Section>
        );
      })}
    </Group>
  );
}

function ScheduleNative({ entries, tokens, selectedDay, onCreate, onEdit, onLoadExample, onBack, loading, error, onRetry, view, setView }: { entries: ScheduleEntry[]; tokens: ThemeTokens; selectedDay: DayIndex; onCreate: () => void; onEdit: (entry: ScheduleEntry) => void; onLoadExample: () => void; onBack: () => void; loading: boolean; error: string | null; onRetry: () => void; view: ScheduleView; setView: (view: ScheduleView) => void }) {
  const dayEntries = sortedEntries(entries.filter((entry) => entry.day === selectedDay));
  const emptyView = !loading && !error && ((view === 'day' && dayEntries.length === 0) || (view === 'week' && entries.length === 0));

  return (
    <PageNative title="Horario" tokens={tokens} onBack={onBack} action={
          <NativeCircleButton tokens={tokens} accent label="Añadir clase" systemName="plus" onPress={onCreate} disabled={loading || Boolean(error)} />
    }>
        <VStack alignment="leading" spacing={4} modifiers={[frame({ maxWidth: UI.contentWidth, alignment: 'leading' }), padding({ horizontal: UI.pageInset, top: 20, bottom: 12 })]}>
          <NativeText modifiers={textModifiers(tokens, { style: 'largeTitle', weight: 'bold' })}>{view === 'week' ? 'Tu semana' : DAYS[selectedDay].long}</NativeText>
          {view === 'day' ? <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'subheadline' })}>{new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'long' }).format(new Date())}</NativeText> : null}
        </VStack>
        <Picker selection={view} onSelectionChange={(value) => setView(value as ScheduleView)} modifiers={[pickerStyle('segmented'), frame({ maxWidth: 680 }), padding({ horizontal: 20, top: 8, bottom: 8 }), accessibilityLabel('Vista del horario')]}>
          <NativeText modifiers={[tag('day')]}>{'Hoy'}</NativeText>
          <NativeText modifiers={[tag('week')]}>{'Semana'}</NativeText>
        </Picker>
      <List modifiers={groupedListModifiers(tokens)}>
        {emptyView ? <EmptyAgendaNative entries={entries} tokens={tokens} onLoadExample={onLoadExample} /> : loading ? (
          <VStack alignment="center" spacing={10} modifiers={surfaceModifiers(tokens)}>
            <ProgressView />
            <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'callout' })}>Cargando tu horario</NativeText>
          </VStack>
        ) : error ? (
          <VStack alignment="center" spacing={10} modifiers={surfaceModifiers(tokens)}>
            <SymbolImage name="exclamationmark.triangle" color={tokens.danger} size={26} />
            <NativeText modifiers={textModifiers(tokens, { style: 'headline', weight: 'bold' })}>No pudimos abrir el horario</NativeText>
            <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'body' })}>{error}</NativeText>
            <NativeButton label="Intentar de nuevo" onPress={onRetry} modifiers={[buttonStyle('borderless'), tint(tokens.slate)]} />
          </VStack>
        ) : view === 'day' ? (
          <Section title={`${dayEntries.length} ${dayEntries.length === 1 ? 'clase' : 'clases'}`}>
            {dayEntries.map((entry) => <ScheduleEntryRowNative key={entry.id} entry={entry} tokens={tokens} onPress={() => onEdit(entry)} />)}
          </Section>
        ) : (
          <WeekOverviewNative entries={entries} tokens={tokens} onEdit={onEdit} />
        )}
      </List>
    </PageNative>
  );
}

function ScheduleEditorNative({ entry, defaultDay, tokens, onSave, onDelete, onClose }: { entry: ScheduleEntry | null; defaultDay: DayIndex; tokens: ThemeTokens; onSave: (entry: ScheduleEntry) => Promise<string | null>; onDelete: (id: string) => void; onClose: () => void }) {
  const [initial] = useState(() => entry ?? { id: makeId(), title: '', day: defaultDay, start: '08:00', end: '09:00', location: '', color: 'slate' as ScheduleColor });
  const [title, setTitle] = useState(initial.title);
  const [day, setDay] = useState<DayIndex>(initial.day);
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [location, setLocation] = useState(initial.location);
  const [color, setColor] = useState<ScheduleColor>(initial.color);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const savingRef = useRef(false);
  const dirty = title !== initial.title || day !== initial.day || start !== initial.start || end !== initial.end || location !== initial.location || color !== initial.color;
  const requestClose = () => {
    if (savingRef.current) return;
    if (!dirty) return onClose();
    Alert.alert('¿Descartar cambios?', 'Los cambios de esta clase no se han guardado.', [
      { text: 'Seguir editando', style: 'cancel' },
      { text: 'Descartar cambios', style: 'destructive', onPress: onClose },
    ]);
  };
  useEffect(() => {
    if (validationError) AccessibilityInfo.announceForAccessibility(validationError);
  }, [validationError]);
  const titleState = useNativeState(initial.title);
  const locationState = useNativeState(initial.location);
  const locationInput = useRef<TextFieldRef>(null);

  const save = async () => {
    if (savingRef.current) return;
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setValidationError('Escribe el nombre de la clase.');
      return;
    }
    if (!isValidTime(start) || !isValidTime(end)) {
      setValidationError('Usa un horario válido.');
      return;
    }
    if (minutesFromTime(end) <= minutesFromTime(start)) {
      setValidationError('La hora de término debe ser posterior a la de inicio.');
      return;
    }
    savingRef.current = true;
    setSaving(true);
    const error = await onSave({ id: entry?.id ?? initial.id, title: cleanTitle, day, start, end, location: location.trim(), color });
    savingRef.current = false;
    setSaving(false);
    if (error) setValidationError(error);
  };

  return (
    <Group modifiers={[presentationDetents(['medium', 'large']), presentationDragIndicator('visible'), interactiveDismissDisabled(dirty || saving)]}>
    <VStack spacing={0} modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity }), background(tokens.background)]}>
      <HStack spacing={12} modifiers={[padding({ all: SHEET_ACTION_INSET })]}>
        <NativeCircleButton tokens={tokens} label="Cancelar" systemName="xmark" onPress={requestClose} disabled={saving} />
        <Spacer />
        <NativeText modifiers={[...textModifiers(tokens, { style: 'headline', weight: 'semibold' }), accessibilityAddTraits(['isHeader'])]}>{entry ? 'Editar clase' : 'Nueva clase'}</NativeText>
        <Spacer />
        <NativeCircleButton tokens={tokens} accent label={saving ? 'Guardando' : 'Guardar'} systemName="checkmark" onPress={() => void save()} disabled={saving} />
      </HStack>
      {validationError ? (
        <NativeText modifiers={[
          ...textModifiers(tokens, { color: tokens.danger, style: 'callout', weight: 'semibold' }),
          frame({ maxWidth: Infinity, alignment: 'leading' }),
          padding({ horizontal: SHEET_ACTION_INSET, bottom: 12 }),
        ]}>{validationError}</NativeText>
      ) : null}
    <Form modifiers={[scrollContentBackground('hidden'), background(tokens.background), frame({ maxWidth: Infinity, maxHeight: Infinity }), listStyle('insetGrouped'), disabled(saving)]}>
      <Section title="Clase">
        <VStack alignment="leading" spacing={6}>
          <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'subheadline', weight: 'semibold' })}>Nombre</NativeText>
          <TextField text={titleState} onTextChange={(value) => { setTitle(value); titleState.set(value); }} placeholder="Nombre de la clase" modifiers={[font({ textStyle: 'title2', weight: 'semibold' }), padding({ vertical: 8 }), textFieldStyle('plain'), accessibilityLabel('Nombre de la clase'), submitLabel('next'), onSubmit(() => { void locationInput.current?.focus(); })]} />
        </VStack>
      </Section>
      <Section title="Horario">
        <Picker label="Día" selection={day} onSelectionChange={(value) => setDay(value as DayIndex)} modifiers={[pickerStyle('menu'), font({ textStyle: 'body', weight: 'semibold' })]}>
          {DAYS.map((item) => <NativeText key={item.index} modifiers={[tag(item.index)]}>{item.long}</NativeText>)}
        </Picker>
        <DatePicker title="Empieza" selection={timeToDate(start)} displayedComponents={['hourAndMinute']} onDateChange={(date) => setStart(dateToTime(date))} modifiers={[font({ textStyle: 'body', weight: 'semibold' })]} />
        <DatePicker title="Termina" selection={timeToDate(end)} displayedComponents={['hourAndMinute']} onDateChange={(date) => setEnd(dateToTime(date))} modifiers={[font({ textStyle: 'body', weight: 'semibold' })]} />
        {minutesFromTime(end) > minutesFromTime(start) ? <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'footnote' })}>{`Cada ${DAYS[day].long.toLowerCase()} · ${minutesFromTime(end) - minutesFromTime(start)} min`}</NativeText> : null}
      </Section>
      <Section title="Detalles">
        <VStack alignment="leading" spacing={6}>
          <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'subheadline', weight: 'semibold' })}>Lugar</NativeText>
          <TextField ref={locationInput} text={locationState} onTextChange={(value) => { setLocation(value); locationState.set(value); }} placeholder="Opcional" modifiers={[font({ textStyle: 'body' }), textFieldStyle('plain'), accessibilityLabel('Lugar, opcional'), submitLabel('done'), onSubmit(() => { void locationInput.current?.blur(); })]} />
        </VStack>
        <Picker label="Color" selection={color} onSelectionChange={(value) => setColor(value as ScheduleColor)} modifiers={[pickerStyle('menu'), font({ textStyle: 'body', weight: 'semibold' })]}>
          {COLORS.map((item) => <NativeText key={item.key} modifiers={[tag(item.key)]}>{item.label}</NativeText>)}
        </Picker>
      </Section>

      {entry ? (
        <Section>
          <ConfirmationDialog title="Eliminar clase" isPresented={confirmDelete} onIsPresentedChange={setConfirmDelete}>
            <ConfirmationDialog.Trigger>
              <NativeButton label="Eliminar clase" systemImage="trash" role="destructive" onPress={() => setConfirmDelete(true)} modifiers={[buttonStyle('borderless'), tint(tokens.danger)]} />
            </ConfirmationDialog.Trigger>
            <ConfirmationDialog.Message><NativeText>¿Quieres eliminar “{entry.title}” de tu horario?</NativeText></ConfirmationDialog.Message>
            <ConfirmationDialog.Actions>
              <NativeButton label="Eliminar" role="destructive" onPress={() => { setConfirmDelete(false); onDelete(entry.id); }} />
              <NativeButton label="Cancelar" role="cancel" onPress={() => setConfirmDelete(false)} />
            </ConfirmationDialog.Actions>
          </ConfirmationDialog>
        </Section>
      ) : null}
    </Form>
    </VStack>
    </Group>
  );
}

export default function App() {
  const systemScheme = useColorScheme();
  const [themeMode, setThemeMode] = useState<ThemeMode>('system');
  const [screen, setScreen] = useState<Screen>('home');
  const [destination, setDestination] = useState<MiniappDestination>('library');
  const [scheduleView, setScheduleView] = useState<ScheduleView>('day');
  const [selectedDay, setSelectedDay] = useState<DayIndex>(currentDayIndex());
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [editorEntry, setEditorEntry] = useState<ScheduleEntry | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);
  const writePending = useRef(false);
  const ready = !loading && !storageError;
  const tokens = useMemo(() => getTokens(themeMode, systemScheme), [themeMode, systemScheme]);

  useEffect(() => {
    Appearance.setColorScheme(themeMode === 'system' ? 'unspecified' : themeMode);
    return () => Appearance.setColorScheme('unspecified');
  }, [themeMode]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setStorageError(null);
    try {
      const [storedSchedule, storedTheme] = await Promise.all([AsyncStorage.getItem(STORAGE_KEY), AsyncStorage.getItem(THEME_KEY)]);
      setEntries(parseSchedule(storedSchedule));
      if (storedTheme === 'system' || storedTheme === 'light' || storedTheme === 'dark') setThemeMode(storedTheme);
    } catch {
      setStorageError('No se pudo leer el horario. Reintenta para volver a cargarlo.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const openSchedule = (day = currentDayIndex()) => {
    setSelectedDay(day);
    setScreen('miniapps');
    setDestination('schedule');
  };

  const openDownloader = () => {
    setScreen('miniapps');
    setDestination('downloader');
  };

  const openEditor = (entry: ScheduleEntry | null = null) => {
    if (!ready || writePending.current) return;
    setEditorEntry(entry);
    setEditorVisible(true);
  };

  const persistEntries = async (nextEntries: ScheduleEntry[]) => {
    if (!ready || writePending.current) throw new Error('Schedule unavailable');
    writePending.current = true;
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(nextEntries));
      setEntries(nextEntries);
    } finally {
      writePending.current = false;
    }
  };

  const saveEntry = async (nextEntry: ScheduleEntry) => {
    const conflict = entries.find((item) => item.id !== nextEntry.id && item.day === nextEntry.day && minutesFromTime(nextEntry.start) < minutesFromTime(item.end) && minutesFromTime(nextEntry.end) > minutesFromTime(item.start));
    if (conflict) return `Se cruza con “${conflict.title}”, de ${formatScheduleTime(conflict.start)} a ${formatScheduleTime(conflict.end)}.`;
    const nextEntries = sortedEntries([...entries.filter((item) => item.id !== nextEntry.id), nextEntry]);
    try {
      await persistEntries(nextEntries);
      setSelectedDay(currentDayIndex());
      setEditorVisible(false);
      setEditorEntry(null);
      setStorageError(null);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return null;
    } catch {
      return 'No pudimos guardar la clase. Inténtalo de nuevo.';
    }
  };

  const deleteEntry = (id: string) => {
    void (async () => {
      const nextEntries = entries.filter((item) => item.id !== id);
      try {
        await persistEntries(nextEntries);
        setEditorVisible(false);
        setEditorEntry(null);
      } catch {
        Alert.alert('No se pudo eliminar', 'La clase sigue guardada. Intenta eliminarla de nuevo.');
      }
    })();
  };

  const clearSchedule = () => {
    Alert.alert('Borrar horario', 'Se eliminarán todas las clases guardadas en este dispositivo.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Borrar todo',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await persistEntries([]);
            } catch {
              Alert.alert('No se pudo borrar el horario', 'Las clases siguen guardadas. Intenta borrarlas de nuevo.');
            }
          })();
        },
      },
    ]);
  };

  const loadExample = () => {
    if (!ready || entries.length || writePending.current) return;
    void (async () => {
      try {
        await persistEntries(EXAMPLE_SCHEDULE);
        setSelectedDay(currentDayIndex());
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {
        Alert.alert('No se pudo cargar el ejemplo', 'Intenta cargarlo de nuevo.');
      }
    })();
  };

  const changeTheme = (mode: ThemeMode) => {
    setThemeMode(mode);
    void AsyncStorage.setItem(THEME_KEY, mode).catch(() => Alert.alert('No se pudo guardar el tema', 'El tema está aplicado. Vuelve a seleccionarlo para intentar guardarlo.'));
  };

  const schedule = (
    <ScheduleNative entries={entries} tokens={tokens} selectedDay={selectedDay} onCreate={() => openEditor()} onEdit={openEditor} onLoadExample={loadExample} onBack={() => setDestination('library')} loading={loading} error={storageError} onRetry={loadData} view={scheduleView} setView={setScheduleView} />
  );
  const downloader = <DownloaderNative tokens={tokens} onBack={() => setDestination('library')} />;
  const body = (
    <TabView selection={screen} onSelectionChange={(value) => setScreen(value as Screen)} modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity }), tint(tokens.blue)]}>
      <TabView.Tab value="home" label="Inicio" systemImage="house.fill"><HomeTabNative entries={entries} tokens={tokens} loading={loading} error={storageError} onOpenSchedule={() => openSchedule(currentDayIndex())} onRetry={loadData} /></TabView.Tab>
      <TabView.Tab value="miniapps" label="Miniapps" systemImage="square.grid.2x2.fill"><MiniappsTabNative entries={entries} tokens={tokens} loading={loading} error={storageError} destination={destination} schedule={schedule} downloader={downloader} onOpenSchedule={() => openSchedule()} onOpenDownloader={openDownloader} onClearSchedule={clearSchedule} /></TabView.Tab>
      <TabView.Tab value="settings" label="Ajustes" systemImage="gearshape.fill"><SettingsNative themeMode={themeMode} tokens={tokens} onThemeChange={changeTheme} /></TabView.Tab>
    </TabView>
  );

  return (
    <>
    <StatusBar style={tokens.mode === 'dark' ? 'light' : 'dark'} />
    <Host style={{ flex: 1, backgroundColor: tokens.background }} colorScheme={tokens.mode} seedColor={tokens.blue} useViewportSizeMeasurement ignoreSafeArea={destination === 'downloader' ? 'keyboard' : undefined}>
      <ZStack alignment="center" modifiers={[background(tokens.background), frame({ maxWidth: Infinity, maxHeight: Infinity })]}>
        {body}
        <BottomSheet
          isPresented={editorVisible}
          onIsPresentedChange={setEditorVisible}
          onDismiss={() => { setEditorVisible(false); setEditorEntry(null); }}>
          <ScheduleEditorNative key={editorEntry?.id ?? 'new'} entry={editorEntry} defaultDay={selectedDay} tokens={tokens} onSave={saveEntry} onDelete={deleteEntry} onClose={() => setEditorVisible(false)} />
        </BottomSheet>
      </ZStack>
    </Host>
    </>
  );
}
