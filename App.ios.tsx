import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { Host } from '@expo/ui';
import {
  BottomSheet,
  Button as NativeButton,
  ConfirmationDialog,
  ContentUnavailableView,
  ContextMenu,
  DatePicker,
  Divider,
  Form,
  GlassEffectContainer,
  Group,
  HStack,
  List,
  Image as NativeImage,
  Picker,
  ProgressView,
  Section,
  SecureField,
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
  accessibilityElement,
  accessibilityHidden,
  accessibilityValue,
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
  lineLimit,
  listStyle,
  monospacedDigit,
  multilineTextAlignment,
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
import { formatScheduleTime, parseSchedule, todayAgenda, type DayIndex, type ScheduleColor, type ScheduleEntry } from './schedule-data';
import { useCurrentTime } from './use-current-time';
import { UI, type MiniappDestination } from './ui-structure';
import { analyzeUrl, detectDownloadSource, downloadFromService, downloaderErrorMessage, formatDuration, saveDownload, type DownloadAnalysis, type DownloadMode, type DownloadSource } from './downloader-api';
import { StatusBar } from 'expo-status-bar';
import { background, foregroundStyle, strokeBorder, tint } from './native-colors';
import { getGeminiApiKey, setGeminiApiKey, pickImagesAndScan } from './ai-schedule-scanner';

type ThemeMode = 'system' | 'light' | 'dark';
type Screen = 'home' | 'miniapps' | 'settings';
type ScheduleView = 'day' | 'week';

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

const DAYS: Array<{ initial: string; short: string; long: string; index: DayIndex }> = [
  { initial: 'L', short: 'Lun', long: 'Lunes', index: 0 },
  { initial: 'M', short: 'Mar', long: 'Martes', index: 1 },
  { initial: 'X', short: 'Mié', long: 'Miércoles', index: 2 },
  { initial: 'J', short: 'Jue', long: 'Jueves', index: 3 },
  { initial: 'V', short: 'Vie', long: 'Viernes', index: 4 },
  { initial: 'S', short: 'Sáb', long: 'Sábado', index: 5 },
  { initial: 'D', short: 'Dom', long: 'Domingo', index: 6 },
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

const nativeGlassAvailable = Number(Platform.Version) >= 26;

function getTokens(themeMode: ThemeMode, systemScheme: 'light' | 'dark' | 'unspecified' | null | undefined) {
  return themeMode === 'dark' || (themeMode === 'system' && systemScheme === 'dark') ? DARK : LIGHT;
}

function currentDayIndex(): DayIndex {
  return ((new Date().getDay() + 6) % 7) as DayIndex;
}

function capitalize(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
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

function durationLabel(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${Math.max(1, rest)} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

function timeRange(entry: ScheduleEntry) {
  return `${formatScheduleTime(entry.start)} – ${formatScheduleTime(entry.end)}`;
}

// First class on a following day, used when today has nothing left.
function nextClassAfterToday(entries: ScheduleEntry[], today: DayIndex) {
  for (let offset = 1; offset <= 7; offset++) {
    const day = ((today + offset) % 7) as DayIndex;
    const first = sortedEntries(entries.filter((entry) => entry.day === day))[0];
    if (first) return { entry: first, offset };
  }
  return null;
}

function findConflict(entry: ScheduleEntry, others: ScheduleEntry[]) {
  return others.find((item) => item.id !== entry.id && item.day === entry.day && minutesFromTime(entry.start) < minutesFromTime(item.end) && minutesFromTime(entry.end) > minutesFromTime(item.start));
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

function NativeCircleButton({
  tokens,
  accent = false,
  label,
  systemName,
  onPress,
  disabled: isDisabled = false,
  busy = false,
}: {
  tokens: ThemeTokens;
  accent?: boolean;
  label: string;
  systemName: SFSymbol;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  const iconColor = accent ? tokens.inverseText : tokens.text;

  return (
    <NativeButton onPress={onPress} modifiers={[...nativeCircleModifiers(tokens, accent), frame({ width: CIRCLE_CONTROL_SIZE, height: CIRCLE_CONTROL_SIZE }), accessibilityLabel(label), disabled(isDisabled || busy)]}>
      <ZStack modifiers={[frame({ width: CIRCLE_ICON_LAYOUT_SIZE, height: CIRCLE_ICON_LAYOUT_SIZE })]}>
        {busy ? <ProgressView modifiers={[controlSize('small')]} /> : <NativeImage systemName={systemName} size={20} color={iconColor} />}
      </ZStack>
    </NativeButton>
  );
}

// Peer glass controls share one container so iOS 26 can blend and morph them
// as a single Liquid Glass group instead of separate floating discs.
function GlassControlGroup({ children }: { children: ReactNode }) {
  if (!nativeGlassAvailable) return <HStack alignment="center" spacing={8}>{children}</HStack>;
  return <GlassEffectContainer spacing={8}><HStack alignment="center" spacing={8}>{children}</HStack></GlassEffectContainer>;
}

function PageNative({ title, subtitle, tokens, onBack, action, children }: { title: string; subtitle?: string; tokens: ThemeTokens; onBack?: () => void; action?: ReactNode; children: ReactNode }) {
  return <VStack spacing={0} modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'topLeading' }), background(tokens.background)]}>
    <VStack alignment="leading" spacing={12} modifiers={[frame({ maxWidth: UI.contentWidth, alignment: 'leading' }), padding({ horizontal: UI.pageInset, top: 12, bottom: 8 })]}>
      {onBack ? <ZStack alignment="center" modifiers={[frame({ maxWidth: Infinity, minHeight: CIRCLE_CONTROL_SIZE })]}>
        {/* The title sits in its own layer so it stays centred when the two sides hold a different number of controls. */}
        <NativeText modifiers={[...textModifiers(tokens, { style: 'headline', weight: 'semibold' }), lineLimit(1), padding({ horizontal: CIRCLE_CONTROL_SIZE * 2 + 16 }), accessibilityAddTraits(['isHeader'])]}>{title}</NativeText>
        <HStack alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity })]}>
          <NativeCircleButton tokens={tokens} label="Volver a Miniapps" systemName="chevron.left" onPress={onBack} />
          <Spacer />
          {action ?? null}
        </HStack>
      </ZStack> : null}
      {!onBack && <VStack alignment="leading" spacing={2}>
        <NativeText modifiers={[...textModifiers(tokens, { style: 'largeTitle', weight: 'bold' }), accessibilityAddTraits(['isHeader'])]}>{title}</NativeText>
        {subtitle ? <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'subheadline', weight: 'medium' })}>{subtitle}</NativeText> : null}
      </VStack>}
    </VStack>
    {children}
  </VStack>;
}

function ReadingCanvasNative({ tokens, children }: { tokens: ThemeTokens; children: ReactNode }) {
  return <ScrollView modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity })]}>
    <VStack alignment="leading" spacing={24} modifiers={[frame({ maxWidth: UI.contentWidth, alignment: 'leading' }), padding({ horizontal: UI.pageInset, top: 16, bottom: 32 })]}>{children}</VStack>
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

function SectionHeadingNative({ title, detail, tokens }: { title: string; detail?: string; tokens: ThemeTokens }) {
  return <HStack alignment="firstTextBaseline" spacing={8} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ horizontal: 4 })]}>
    <NativeText modifiers={[...textModifiers(tokens, { style: 'title3', weight: 'bold' }), accessibilityAddTraits(['isHeader'])]}>{title}</NativeText>
    <Spacer />
    {detail ? <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'subheadline' })}>{detail}</NativeText> : null}
  </HStack>;
}

function GroupedSurfaceNative({ tokens, children, spacing = 0, inset = 16 }: { tokens: ThemeTokens; children: ReactNode; spacing?: number; inset?: number }) {
  return <VStack alignment="leading" spacing={spacing} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ horizontal: inset, vertical: inset / 2 }), background(tokens.surface), clipShape('roundedRectangle', UI.groupRadius)]}>{children}</VStack>;
}

function WeekStripNative({ entries, tokens, today }: { entries: ScheduleEntry[]; tokens: ThemeTokens; today: DayIndex }) {
  return <HStack alignment="center" spacing={4} modifiers={[frame({ maxWidth: Infinity })]}>
    {DAYS.map((day) => {
      const count = entries.filter((entry) => entry.day === day.index).length;
      const isToday = day.index === today;
      return <VStack key={day.index} alignment="center" spacing={6} modifiers={[
        frame({ maxWidth: Infinity, minHeight: 60 }),
        ...(isToday ? [background(tokens.blueSoft), clipShape('roundedRectangle', UI.iconRadius)] : []),
        accessibilityElement('ignore'),
        accessibilityLabel(`${day.long}${isToday ? ', hoy' : ''}, ${count === 1 ? '1 clase' : `${count} clases`}`),
      ]}>
        <NativeText modifiers={textModifiers(tokens, { color: isToday ? tokens.blue : tokens.secondary, style: 'caption', weight: 'semibold' })}>{day.initial}</NativeText>
        <NativeText modifiers={[...textModifiers(tokens, { color: count ? (isToday ? tokens.blue : tokens.text) : tokens.secondary, style: 'headline', weight: count ? 'semibold' : 'regular' }), monospacedDigit()]}>{count ? String(count) : '–'}</NativeText>
      </VStack>;
    })}
  </HStack>;
}

function HomeNative({ entries, tokens, loading, error, onOpenSchedule, onRetry }: { entries: ScheduleEntry[]; tokens: ThemeTokens; loading: boolean; error: string | null; onOpenSchedule: () => void; onRetry: () => void }) {
  const now = useCurrentTime();
  const { today, remaining, next, ongoing } = todayAgenda(entries, now);
  const todayIndex = ((now.getDay() + 6) % 7) as DayIndex;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const later = next ? null : nextClassAfterToday(entries, todayIndex);
  const dateLine = capitalize(new Intl.DateTimeFormat('es-PE', { weekday: 'long', day: 'numeric', month: 'long' }).format(now));
  const ready = !loading && !error;

  const nextCard = next ? (() => {
    const start = minutesFromTime(next.start);
    const end = minutesFromTime(next.end);
    const progress = Math.min(1, Math.max(0, (nowMinutes - start) / (end - start)));
    return <>
      <HStack alignment="firstTextBaseline" spacing={8} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
        <NativeText modifiers={textModifiers(tokens, { color: ongoing ? tokens.blue : tokens.secondary, style: 'subheadline', weight: 'semibold' })}>{ongoing ? 'En curso' : 'Siguiente'}</NativeText>
        <Spacer />
        <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'subheadline' }), monospacedDigit()]}>{ongoing ? `Termina en ${durationLabel(end - nowMinutes)}` : `Empieza en ${durationLabel(start - nowMinutes)}`}</NativeText>
      </HStack>
      <VStack alignment="leading" spacing={6} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
        <NativeText modifiers={textModifiers(tokens, { style: 'title', weight: 'bold' })}>{next.title}</NativeText>
        <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'body' }), monospacedDigit()]}>{[timeRange(next), next.location].filter(Boolean).join(' · ')}</NativeText>
      </VStack>
      {ongoing ? <ProgressView value={progress} modifiers={[tint(tokens.blue), accessibilityLabel('Progreso de la clase'), accessibilityValue(`${Math.round(progress * 100)} %`)]} /> : null}
    </>;
  })() : (() => {
    const title = !entries.length ? 'Sin clases guardadas' : today.length ? 'Clases terminadas' : 'Día libre';
    const symbol: SFSymbol = !entries.length ? 'calendar' : today.length ? 'checkmark.circle' : 'sun.max';
    const laterDay = later ? (later.offset === 1 ? 'Mañana' : DAYS[later.entry.day].long) : null;
    return <HStack alignment="center" spacing={14} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
      <VStack alignment="center" spacing={0} modifiers={[frame({ width: 44, height: 44 }), background(tokens.slateSoft), clipShape('roundedRectangle', UI.iconRadius)]}>
        <SymbolImage name={symbol} color={tokens.slate} size={22} />
      </VStack>
      <VStack alignment="leading" spacing={3} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
        <NativeText modifiers={textModifiers(tokens, { style: 'title3', weight: 'semibold' })}>{title}</NativeText>
        {later && laterDay ? <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'subheadline' }), monospacedDigit()]}>{`${laterDay}, ${formatScheduleTime(later.entry.start)} · ${later.entry.title}`}</NativeText> : null}
      </VStack>
    </HStack>;
  })();

  return (
    <PageNative title="Hoy" subtitle={dateLine} tokens={tokens}>
      <ReadingCanvasNative tokens={tokens}>
        {ready ? <>
          <VStack alignment="leading" spacing={18} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ all: 20 }), background(tokens.surface), clipShape('roundedRectangle', UI.groupRadius)]}>
            {nextCard}
            <NativeButton label="Abrir horario" systemImage="calendar" onPress={onOpenSchedule} modifiers={[...nativeGlassModifiers(tokens, true), frame({ maxWidth: Infinity })]} />
          </VStack>
          {remaining.length > 1 ? <VStack alignment="leading" spacing={10} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
            <SectionHeadingNative title="Después" detail={remaining.length - 1 === 1 ? '1 clase' : `${remaining.length - 1} clases`} tokens={tokens} />
            <GroupedSurfaceNative tokens={tokens}>
              {remaining.slice(1).map((entry, index) => <VStack key={entry.id} spacing={0} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
                {index > 0 ? <Divider /> : null}
                <AgendaContentNative entry={entry} tokens={tokens} />
              </VStack>)}
            </GroupedSurfaceNative>
          </VStack> : null}
          {entries.length ? <VStack alignment="leading" spacing={10} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
            <SectionHeadingNative title="Semana" detail={entries.length === 1 ? '1 clase' : `${entries.length} clases`} tokens={tokens} />
            <GroupedSurfaceNative tokens={tokens} inset={8}>
              <WeekStripNative entries={entries} tokens={tokens} today={todayIndex} />
            </GroupedSurfaceNative>
          </VStack> : null}
        </> : <DataStateNative loading={loading} error={error} tokens={tokens} onRetry={onRetry} />}
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

  const scheduleSurface = (
    <VStack alignment="leading" spacing={12} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ horizontal: 16, top: 4, bottom: entries.length && !loading && !error ? 14 : 4 }), background(tokens.surface), clipShape('roundedRectangle', UI.groupRadius)]}>
      {scheduleRow}
      {!loading && !error && entries.length > 0 ? <>
        <Divider />
        <WeekStripNative entries={entries} tokens={tokens} today={currentDayIndex()} />
      </> : null}
    </VStack>
  );

  return (
    <PageNative title="Biblioteca" tokens={tokens}>
      <ReadingCanvasNative tokens={tokens}>
        <VStack alignment="leading" spacing={14} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
          {!loading && !error && entries.length > 0 ? (
            <ContextMenu>
              <ContextMenu.Trigger>{scheduleSurface}</ContextMenu.Trigger>
              <ContextMenu.Items>
                <NativeButton label="Borrar horario" systemImage="trash" role="destructive" onPress={onClearSchedule} />
              </ContextMenu.Items>
            </ContextMenu>
          ) : scheduleSurface}
          <VStack alignment="leading" spacing={0} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ horizontal: 16, vertical: 4 }), background(tokens.surface), clipShape('roundedRectangle', UI.groupRadius)]}>{downloaderRow}</VStack>
        </VStack>
      </ReadingCanvasNative>
    </PageNative>
  );
}

function MiniappRowNative({ title, detail, icon, iconColor, iconBackground, tokens, onPress, label }: { title: string; detail: string; icon: SFSymbol; iconColor: string; iconBackground: string; tokens: ThemeTokens; onPress: () => void; label: string }) {
  return (
    <NativeButton onPress={onPress} modifiers={[buttonStyle('plain'), frame({ maxWidth: Infinity, minHeight: 72, alignment: 'leading' }), accessibilityLabel(`${label}, ${detail}`)]}>
      <HStack alignment="center" spacing={14} modifiers={[frame({ maxWidth: Infinity, minHeight: 72, alignment: 'leading' }), padding({ vertical: 8 }), contentShape(shapes.rectangle())]}>
        <VStack alignment="center" spacing={0} modifiers={[frame({ width: 44, height: 44 }), background(iconBackground), clipShape('roundedRectangle', UI.iconRadius)]}>
          <SymbolImage name={icon} color={iconColor} size={22} />
        </VStack>
        <VStack alignment="leading" spacing={2}>
          <NativeText modifiers={textModifiers(tokens, { style: 'title3', weight: 'semibold' })}>{title}</NativeText>
          <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'subheadline' })}>{detail}</NativeText>
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

function SettingsNative({ themeMode, tokens, onThemeChange, apiKey, onApiKeyChange }: { themeMode: ThemeMode; tokens: ThemeTokens; onThemeChange: (mode: ThemeMode) => void; apiKey: string; onApiKeyChange: (key: string) => void }) {
  const labels: Record<ThemeMode, string> = { system: 'Sistema', light: 'Claro', dark: 'Oscuro' };
  const keyState = useNativeState('');
  const [draft, setDraft] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const editing = isEditing || !apiKey;

  const startEditing = () => {
    keyState.set('');
    setDraft('');
    setIsEditing(true);
  };

  const commitKey = () => {
    const value = draft.trim();
    if (!value) return;
    onApiKeyChange(value);
    keyState.set('');
    setDraft('');
    setIsEditing(false);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const confirmDeleteKey = () => {
    Alert.alert(
      'Eliminar clave',
      '¿Deseas eliminar la clave guardada de la API de Gemini?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: () => {
            keyState.set('');
            setDraft('');
            onApiKeyChange('');
            setIsEditing(false);
          },
        },
      ]
    );
  };

  return (
    <PageNative title="Ajustes" tokens={tokens}>
      <Form modifiers={groupedListModifiers(tokens)}>
        <Section title="Tema">
          <Picker selection={themeMode} onSelectionChange={(value) => onThemeChange(value as ThemeMode)} modifiers={[pickerStyle('inline'), accessibilityLabel('Tema')]}>
            {(Object.keys(labels) as ThemeMode[]).map((mode) => <HStack key={mode} spacing={12} modifiers={[tag(mode), padding({ vertical: 8 })]}><SymbolImage name={mode === 'system' ? 'iphone' : mode === 'light' ? 'sun.max' : 'moon'} color={tokens.secondary} /><NativeText modifiers={textModifiers(tokens)}>{labels[mode]}</NativeText></HStack>)}
          </Picker>
        </Section>
        <Section title="API de Gemini">
          {!editing ? <>
            <HStack alignment="center" spacing={12} modifiers={[padding({ vertical: 4 })]}>
              <SymbolImage name="key.fill" color={tokens.secondary} size={18} />
              <NativeText modifiers={textModifiers(tokens)}>Clave</NativeText>
              <Spacer />
              <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary })}>{`••••${apiKey.slice(-4)}`}</NativeText>
            </HStack>
            <NativeButton label="Cambiar clave" onPress={startEditing} modifiers={[tint(tokens.blue)]} />
            <NativeButton label="Eliminar clave" role="destructive" onPress={confirmDeleteKey} />
          </> : <>
            <HStack alignment="center" spacing={12} modifiers={[padding({ vertical: 4 })]}>
              <SymbolImage name="key.fill" color={tokens.secondary} size={18} />
              <SecureField
                text={keyState}
                placeholder="AIzaSy…"
                onTextChange={setDraft}
                modifiers={[
                  frame({ maxWidth: Infinity }),
                  font({ textStyle: 'body' }),
                  textInputAutocapitalization('never'),
                  autocorrectionDisabled(),
                  accessibilityLabel('Clave de la API de Gemini'),
                  submitLabel('done'),
                  onSubmit(commitKey),
                ]}
              />
            </HStack>
            <NativeButton label="Guardar clave" onPress={commitKey} modifiers={[tint(tokens.blue), disabled(!draft.trim())]} />
            {apiKey ? <NativeButton label="Cancelar" onPress={() => { keyState.set(''); setDraft(''); setIsEditing(false); }} modifiers={[tint(tokens.secondary)]} /> : null}
          </>}
        </Section>
      </Form>
    </PageNative>
  );
}

function AIScanReviewNative({
  scanned,
  existing,
  tokens,
  onImport,
  onClose,
}: {
  scanned: ScheduleEntry[];
  existing: ScheduleEntry[];
  tokens: ThemeTokens;
  onImport: (selected: ScheduleEntry[]) => Promise<boolean>;
  onClose: () => void;
}) {
  // Classes that overlap the stored schedule start unselected so an import
  // never silently creates a double-booked slot.
  const conflicts = useMemo(() => new Map(scanned.map((entry) => [entry.id, findConflict(entry, existing)])), [scanned, existing]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(scanned.filter((entry) => !conflicts.get(entry.id)).map((entry) => entry.id)));
  const [importing, setImporting] = useState(false);
  const days = DAYS.filter((day) => scanned.some((entry) => entry.day === day.index));

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const confirm = async () => {
    if (importing || !selected.size) return;
    setImporting(true);
    const ok = await onImport(scanned.filter((entry) => selected.has(entry.id)));
    if (!ok) setImporting(false);
  };

  return (
    <Group modifiers={[presentationDetents(['medium', 'large']), presentationDragIndicator('visible'), interactiveDismissDisabled(importing)]}>
      <VStack spacing={0} modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'top' }), background(tokens.background)]}>
        <HStack alignment="center" spacing={12} modifiers={[padding({ all: SHEET_ACTION_INSET })]}>
          <NativeCircleButton tokens={tokens} label="Cerrar" systemName="xmark" onPress={onClose} disabled={importing} />
          <Spacer />
          <VStack alignment="center" spacing={2}>
            <NativeText modifiers={[...textModifiers(tokens, { style: 'headline', weight: 'semibold' }), accessibilityAddTraits(['isHeader'])]}>Horario detectado</NativeText>
            <NativeText modifiers={[...textModifiers(tokens, { style: 'caption', color: tokens.secondary }), monospacedDigit()]}>{`${selected.size} de ${scanned.length} seleccionadas`}</NativeText>
          </VStack>
          <Spacer />
          <NativeCircleButton tokens={tokens} accent label={`Importar ${selected.size} clases`} systemName="checkmark" onPress={() => void confirm()} disabled={!selected.size} busy={importing} />
        </HStack>
        <List modifiers={[listStyle('insetGrouped'), scrollContentBackground('hidden'), background(tokens.background), frame({ maxWidth: Infinity, maxHeight: Infinity }), disabled(importing)]}>
          {days.map((day) => (
            <Section key={day.index} title={day.long}>
              {sortedEntries(scanned.filter((entry) => entry.day === day.index)).map((entry) => {
                const isSelected = selected.has(entry.id);
                const conflict = conflicts.get(entry.id);
                return (
                  <NativeButton key={entry.id} onPress={() => toggle(entry.id)} modifiers={[buttonStyle('plain'), accessibilityLabel(`${entry.title}, ${timeRange(entry)}${conflict ? `, se cruza con ${conflict.title}` : ''}`), accessibilityValue(isSelected ? 'Seleccionada' : 'No seleccionada')]}>
                    <HStack alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ vertical: 6 }), contentShape(shapes.rectangle())]}>
                      <SymbolImage name={isSelected ? 'checkmark.circle.fill' : 'circle'} color={isSelected ? tokens.blue : tokens.secondary} size={22} />
                      <VStack alignment="leading" spacing={3} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
                        <NativeText modifiers={textModifiers(tokens, { style: 'headline', weight: 'semibold' })}>{entry.title}</NativeText>
                        <NativeText modifiers={[...textModifiers(tokens, { style: 'subheadline', color: tokens.secondary }), monospacedDigit()]}>{[timeRange(entry), entry.location].filter(Boolean).join(' · ')}</NativeText>
                        {conflict ? <NativeText modifiers={textModifiers(tokens, { style: 'footnote', color: tokens.danger, weight: 'medium' })}>{`Se cruza con ${conflict.title}`}</NativeText> : null}
                      </VStack>
                    </HStack>
                  </NativeButton>
                );
              })}
            </Section>
          ))}
        </List>
      </VStack>
    </Group>
  );
}

function APIKeySheetNative({
  tokens,
  onSaveKey,
  onClose,
}: {
  tokens: ThemeTokens;
  onSaveKey: (key: string) => void;
  onClose: () => void;
}) {
  const keyState = useNativeState('');
  const [draft, setDraft] = useState('');
  const save = () => {
    const value = draft.trim();
    if (value) onSaveKey(value);
  };

  return (
    <Group modifiers={[presentationDetents(['medium']), presentationDragIndicator('visible')]}>
      <VStack spacing={0} modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'top' }), background(tokens.background)]}>
        <HStack alignment="center" spacing={12} modifiers={[padding({ all: SHEET_ACTION_INSET })]}>
          <NativeCircleButton tokens={tokens} label="Cerrar" systemName="xmark" onPress={onClose} />
          <Spacer />
          <NativeText modifiers={[...textModifiers(tokens, { style: 'headline', weight: 'semibold' }), accessibilityAddTraits(['isHeader'])]}>API de Gemini</NativeText>
          <Spacer />
          <NativeCircleButton tokens={tokens} accent label="Guardar y escanear" systemName="checkmark" onPress={save} disabled={!draft.trim()} />
        </HStack>
        <Form modifiers={[listStyle('insetGrouped'), scrollContentBackground('hidden'), background(tokens.background), frame({ maxWidth: Infinity, maxHeight: Infinity })]}>
          <Section title="Clave">
            <SecureField
              text={keyState}
              placeholder="AIzaSy…"
              autoFocus
              onTextChange={setDraft}
              modifiers={[font({ textStyle: 'body' }), textInputAutocapitalization('never'), autocorrectionDisabled(), accessibilityLabel('Clave de la API de Gemini'), submitLabel('done'), onSubmit(save)]}
            />
          </Section>
        </Form>
      </VStack>
    </Group>
  );
}

type AgendaState = 'past' | 'now' | undefined;

function ScheduleEntryRowNative({ entry, tokens, state, onPress }: { entry: ScheduleEntry; tokens: ThemeTokens; state?: AgendaState; onPress: () => void }) {
  const status = state === 'now' ? ', en curso' : state === 'past' ? ', terminada' : '';
  return (
    <NativeButton onPress={onPress} modifiers={[buttonStyle('plain'), frame({ maxWidth: Infinity, alignment: 'leading' }), accessibilityLabel(`Editar ${entry.title}, de ${formatScheduleTime(entry.start)} a ${formatScheduleTime(entry.end)}${entry.location ? `, ${entry.location}` : ''}${status}`)]}>
      <AgendaContentNative entry={entry} tokens={tokens} state={state} />
    </NativeButton>
  );
}

function AgendaContentNative({ entry, tokens, state }: { entry: ScheduleEntry; tokens: ThemeTokens; state?: AgendaState }) {
  const entryColor = colorForKey(entry.color, tokens);
  const past = state === 'past';
  return <AdaptiveRow modifiers={[frame({ maxWidth: Infinity, minHeight: 64, alignment: 'leading' }), padding({ vertical: 10 }), contentShape(shapes.rectangle())]}>
        <VStack alignment="leading" spacing={3}>
          <NativeText modifiers={[...textModifiers(tokens, { color: state === 'now' ? tokens.blue : past ? tokens.secondary : tokens.text, style: 'subheadline', weight: 'semibold' }), monospacedDigit()]}>{formatScheduleTime(entry.start)}</NativeText>
          <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'subheadline' }), monospacedDigit()]}>{formatScheduleTime(entry.end)}</NativeText>
        </VStack>
        <VStack alignment="leading" spacing={4} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
          <HStack alignment="firstTextBaseline" spacing={7}>
            <SymbolImage name="circle.fill" color={past ? tokens.border : entryColor.main} size={8} />
            <NativeText modifiers={textModifiers(tokens, { color: past ? tokens.secondary : tokens.text, style: 'headline', weight: 'semibold' })}>{entry.title}</NativeText>
          </HStack>
          {entry.location || state === 'now' ? <NativeText modifiers={textModifiers(tokens, { color: state === 'now' ? tokens.blue : tokens.secondary, style: 'subheadline', weight: state === 'now' ? 'medium' : 'regular' })}>{[state === 'now' ? 'En curso' : '', entry.location].filter(Boolean).join(' · ')}</NativeText> : null}
        </VStack>
      </AdaptiveRow>;
}

function StateRowNative({ tokens, children }: { tokens: ThemeTokens; children: ReactNode }) {
  return <VStack alignment="center" spacing={10} modifiers={[frame({ maxWidth: Infinity, alignment: 'center' }), padding({ vertical: 20 })]}>{children}</VStack>;
}

function WeekOverviewNative({ entries, tokens, onEdit }: { entries: ScheduleEntry[]; tokens: ThemeTokens; onEdit: (entry: ScheduleEntry) => void }) {
  const visibleDays = DAYS.filter((day) => entries.some((entry) => entry.day === day.index));
  const today = currentDayIndex();
  return (
    <Group>
      {visibleDays.map((day) => {
        const dayEntries = sortedEntries(entries.filter((entry) => entry.day === day.index));
        return (
          <Section key={day.index} header={<HStack alignment="firstTextBaseline" spacing={8}>
            <NativeText modifiers={textModifiers(tokens, { color: day.index === today ? tokens.blue : tokens.text, style: 'title3', weight: 'bold' })}>{day.index === today ? `${day.long} · hoy` : day.long}</NativeText>
            <Spacer />
            <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'subheadline' }), monospacedDigit()]}>{dayEntries.length === 1 ? '1 clase' : `${dayEntries.length} clases`}</NativeText>
          </HStack>}>
            {dayEntries.map((entry) => <ScheduleEntryRowNative key={entry.id} entry={entry} tokens={tokens} onPress={() => onEdit(entry)} />)}
          </Section>
        );
      })}
    </Group>
  );
}

function ScheduleNative({ entries, tokens, selectedDay, onCreate, onScanAI, isScanningAI, onEdit, onBack, loading, error, onRetry, view, setView }: { entries: ScheduleEntry[]; tokens: ThemeTokens; selectedDay: DayIndex; onCreate: () => void; onScanAI: () => void; isScanningAI: boolean; onEdit: (entry: ScheduleEntry) => void; onBack: () => void; loading: boolean; error: string | null; onRetry: () => void; view: ScheduleView; setView: (view: ScheduleView) => void }) {
  const now = useCurrentTime();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const isToday = selectedDay === currentDayIndex();
  const dayEntries = sortedEntries(entries.filter((entry) => entry.day === selectedDay));
  const ready = !loading && !error;
  const dayCount = new Set(entries.map((entry) => entry.day)).size;
  const heading = view === 'week' ? 'Semana' : DAYS[selectedDay].long;
  const detail = !ready ? null : view === 'week'
    ? entries.length ? `${entries.length === 1 ? '1 clase' : `${entries.length} clases`} en ${dayCount === 1 ? '1 día' : `${dayCount} días`}` : null
    : `${new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'long' }).format(now)}${dayEntries.length ? ` · ${dayEntries.length === 1 ? '1 clase' : `${dayEntries.length} clases`}` : ''}`;
  const entryState = (entry: ScheduleEntry) => {
    if (view !== 'day' || !isToday) return undefined;
    if (minutesFromTime(entry.end) <= nowMinutes) return 'past' as const;
    if (minutesFromTime(entry.start) <= nowMinutes) return 'now' as const;
    return undefined;
  };

  return (
    <PageNative title="Horario" tokens={tokens} onBack={onBack} action={
      <GlassControlGroup>
        <NativeCircleButton tokens={tokens} label="Escanear horario desde fotos" systemName="text.viewfinder" onPress={onScanAI} disabled={!ready} busy={isScanningAI} />
        <NativeCircleButton tokens={tokens} accent label="Añadir clase" systemName="plus" onPress={onCreate} disabled={!ready || isScanningAI} />
      </GlassControlGroup>
    }>
      <VStack alignment="leading" spacing={14} modifiers={[frame({ maxWidth: UI.contentWidth, alignment: 'leading' }), padding({ horizontal: UI.pageInset, top: 12, bottom: 4 })]}>
        <VStack alignment="leading" spacing={2}>
          <NativeText modifiers={[...textModifiers(tokens, { style: 'largeTitle', weight: 'bold' }), accessibilityAddTraits(['isHeader'])]}>{heading}</NativeText>
          {detail ? <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'subheadline', weight: 'medium' }), monospacedDigit()]}>{detail}</NativeText> : null}
        </VStack>
        <Picker selection={view} onSelectionChange={(value) => setView(value as ScheduleView)} modifiers={[pickerStyle('segmented'), frame({ maxWidth: Infinity }), accessibilityLabel('Vista del horario')]}>
          <NativeText modifiers={[tag('day')]}>Hoy</NativeText>
          <NativeText modifiers={[tag('week')]}>Semana</NativeText>
        </Picker>
      </VStack>
      <List modifiers={groupedListModifiers(tokens)}>
        {isScanningAI ? <Section>
          <HStack alignment="center" spacing={12} modifiers={[padding({ vertical: 4 })]}>
            <ProgressView modifiers={[controlSize('small')]} />
            <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'callout' })}>Analizando imágenes…</NativeText>
          </HStack>
        </Section> : null}
        {loading ? <Section>
          <StateRowNative tokens={tokens}>
            <ProgressView />
            <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'callout' })}>Cargando horario…</NativeText>
          </StateRowNative>
        </Section> : error ? <Section>
          <StateRowNative tokens={tokens}>
            <SymbolImage name="exclamationmark.triangle" color={tokens.danger} size={26} />
            <NativeText modifiers={textModifiers(tokens, { style: 'headline', weight: 'semibold' })}>No se pudo abrir el horario</NativeText>
            <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'subheadline' }), multilineTextAlignment('center')]}>{error}</NativeText>
            <NativeButton label="Reintentar" onPress={onRetry} modifiers={[buttonStyle('bordered'), controlSize('regular'), tint(tokens.blue)]} />
          </StateRowNative>
        </Section> : (view === 'day' ? !dayEntries.length : !entries.length) ? <Section>
          <ContentUnavailableView title={entries.length ? 'Día libre' : 'Sin clases'} systemImage={entries.length ? 'sun.max' : 'calendar'} modifiers={[padding({ vertical: 12 })]} />
        </Section> : view === 'day' ? (
          <Section>
            {dayEntries.map((entry) => <ScheduleEntryRowNative key={entry.id} entry={entry} tokens={tokens} state={entryState(entry)} onPress={() => onEdit(entry)} />)}
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
  const [apiKey, setApiKey] = useState('');
  const [aiScanning, setAiScanning] = useState(false);
  const [scannedSchedule, setScannedSchedule] = useState<ScheduleEntry[] | null>(null);
  const [apiKeySheetVisible, setApiKeySheetVisible] = useState(false);
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
      const [storedSchedule, storedTheme, storedApiKey] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEY),
        AsyncStorage.getItem(THEME_KEY),
        getGeminiApiKey(),
      ]);
      const parsed = parseSchedule(storedSchedule);
      const cleaned = parsed.filter((e) => !e.id.startsWith('example-'));
      if (cleaned.length !== parsed.length) {
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
      }
      setEntries(cleaned);
      if (storedTheme === 'system' || storedTheme === 'light' || storedTheme === 'dark') setThemeMode(storedTheme);
      if (storedApiKey) setApiKey(storedApiKey);
    } catch {
      setStorageError('No se pudo leer el horario. Reintenta para volver a cargarlo.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const updateApiKey = (key: string) => {
    setApiKey(key);
    void setGeminiApiKey(key);
  };

  const handleScanAI = async (keyOverride?: string) => {
    if (aiScanning) return;
    let activeKey = (keyOverride ?? apiKey).trim();
    if (!activeKey) {
      activeKey = await getGeminiApiKey();
      if (!activeKey) {
        setApiKeySheetVisible(true);
        return;
      }
      setApiKey(activeKey);
    }

    try {
      setAiScanning(true);
      const scanned = await pickImagesAndScan(activeKey);
      if (scanned && scanned.length > 0) {
        setScannedSchedule(scanned);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      Alert.alert('No se pudo escanear el horario', msg);
    } finally {
      setAiScanning(false);
    }
  };

  const importScannedClasses = async (classesToImport: ScheduleEntry[]) => {
    if (!classesToImport.length) return false;
    try {
      const merged = sortedEntries([...entries, ...classesToImport]);
      await persistEntries(merged);
      setScannedSchedule(null);
      setScheduleView('week');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return true;
    } catch {
      Alert.alert('No se pudieron guardar las clases', 'El horario no cambió. Intenta importar de nuevo.');
      return false;
    }
  };

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

  const changeTheme = (mode: ThemeMode) => {
    setThemeMode(mode);
    void AsyncStorage.setItem(THEME_KEY, mode).catch(() => Alert.alert('No se pudo guardar el tema', 'El tema está aplicado. Vuelve a seleccionarlo para intentar guardarlo.'));
  };

  const schedule = (
    <ScheduleNative
      entries={entries}
      tokens={tokens}
      selectedDay={selectedDay}
      onCreate={() => openEditor()}
      onScanAI={() => void handleScanAI()}
      isScanningAI={aiScanning}
      onEdit={openEditor}
      onBack={() => setDestination('library')}
      loading={loading}
      error={storageError}
      onRetry={loadData}
      view={scheduleView}
      setView={setScheduleView}
    />
  );
  const downloader = <DownloaderNative tokens={tokens} onBack={() => setDestination('library')} />;
  const body = (
    <TabView selection={screen} onSelectionChange={(value) => setScreen(value as Screen)} modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity }), tint(tokens.blue)]}>
      <TabView.Tab value="home" label="Inicio" systemImage="house.fill"><HomeTabNative entries={entries} tokens={tokens} loading={loading} error={storageError} onOpenSchedule={() => openSchedule(currentDayIndex())} onRetry={loadData} /></TabView.Tab>
      <TabView.Tab value="miniapps" label="Miniapps" systemImage="square.grid.2x2.fill"><MiniappsTabNative entries={entries} tokens={tokens} loading={loading} error={storageError} destination={destination} schedule={schedule} downloader={downloader} onOpenSchedule={() => openSchedule()} onOpenDownloader={openDownloader} onClearSchedule={clearSchedule} /></TabView.Tab>
      <TabView.Tab value="settings" label="Ajustes" systemImage="gearshape.fill"><SettingsNative themeMode={themeMode} tokens={tokens} onThemeChange={changeTheme} apiKey={apiKey} onApiKeyChange={updateApiKey} /></TabView.Tab>
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
        <BottomSheet
          isPresented={Boolean(scannedSchedule)}
          onIsPresentedChange={(val) => { if (!val) setScannedSchedule(null); }}
          onDismiss={() => setScannedSchedule(null)}>
          {scannedSchedule ? (
            <AIScanReviewNative
              scanned={scannedSchedule}
              existing={entries}
              tokens={tokens}
              onImport={importScannedClasses}
              onClose={() => setScannedSchedule(null)}
            />
          ) : null}
        </BottomSheet>
        <BottomSheet
          isPresented={apiKeySheetVisible}
          onIsPresentedChange={setApiKeySheetVisible}
          onDismiss={() => setApiKeySheetVisible(false)}>
          {apiKeySheetVisible ? <APIKeySheetNative
            tokens={tokens}
            onSaveKey={(key) => {
              updateApiKey(key);
              setApiKeySheetVisible(false);
              // The photo picker cannot present while this sheet is still dismissing.
              setTimeout(() => void handleScanAI(key), 450);
            }}
            onClose={() => setApiKeySheetVisible(false)}
          /> : null}
        </BottomSheet>
      </ZStack>
    </Host>
    </>
  );
}
