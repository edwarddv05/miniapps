import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import {
  BottomSheet,
  Button as NativeButton,
  ConfirmationDialog,
  ContextMenu,
  ContentUnavailableView,
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
  submitLabel,
  tag,
  textFieldStyle,
  type ViewModifier,
} from '@expo/ui/swift-ui/modifiers';
import type { SFSymbol } from 'sf-symbols-typescript';
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Alert, Appearance, Platform, PlatformColor, useColorScheme, useWindowDimensions, type ColorValue } from 'react-native';
import { parseSchedule, todayAgenda, type ScheduleEntry } from './schedule-data';
import { useCurrentTime } from './use-current-time';
import { UI, type MiniappDestination } from './ui-structure';
import { analyzeUrl, downloadFromService, downloaderErrorMessage, formatDuration, saveDownload, type DownloadAnalysis, type DownloadMode } from './downloader-api';
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
  return <VStack spacing={0} modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity }), background(tokens.background)]}>
    <VStack alignment="leading" spacing={12} modifiers={[frame({ maxWidth: UI.contentWidth, alignment: 'leading' }), padding({ horizontal: UI.pageInset, top: 12, bottom: 8 })]}>
      {onBack ? <HStack alignment="center" spacing={12}>
        <NativeCircleButton tokens={tokens} label="Volver a Miniapps" systemName="chevron.left" onPress={onBack} />
        <Spacer />
        {action}
      </HStack> : null}
      <NativeText modifiers={[...textModifiers(tokens, { style: 'largeTitle', weight: 'bold' }), accessibilityAddTraits(['isHeader'])]}>{title}</NativeText>
    </VStack>
    {children}
  </VStack>;
}

function groupedListModifiers(tokens: ThemeTokens): ViewModifier[] {
  return [listStyle('insetGrouped'), scrollContentBackground('hidden'), background(tokens.background), frame({ maxWidth: UI.contentWidth, maxHeight: Infinity })];
}

function SymbolImage({ name, color, size = 22 }: { name: SFSymbol; color: ColorValue; size?: number }) {
  const textStyle = size >= 25 ? 'title' : size >= 22 ? 'title2' : size >= 18 ? 'body' : 'caption';
  return <NativeImage systemName={name} modifiers={[font({ textStyle }), foregroundStyle(color), accessibilityHidden()]} />;
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
  const emptyBody = !entries.length ? 'Añade una clase para verla aquí.' : today.length ? 'No quedan clases pendientes hoy.' : 'No hay clases programadas hoy.';

  return (
    <PageNative title="Hoy" tokens={tokens}>
      <List modifiers={groupedListModifiers(tokens)}>
        <Section header={<NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'subheadline' })}>{new Intl.DateTimeFormat('es-PE', { weekday: 'long', day: 'numeric', month: 'long' }).format(now)}</NativeText>}>
          {loading || error ? <DataStateNative loading={loading} error={error} tokens={tokens} onRetry={onRetry} /> : (
            <VStack alignment="leading" spacing={16} modifiers={[padding({ vertical: 16 }), frame({ maxWidth: Infinity, alignment: 'leading' })]}>
              {next ? <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'subheadline', weight: 'semibold' })}>{ongoing ? 'En curso' : 'A continuación'}</NativeText> : null}
              {next ? <>
                <NativeText modifiers={[...textModifiers(tokens, { style: 'largeTitle', weight: 'bold' }), monospacedDigit()]}>{next.start}</NativeText>
                <NativeText modifiers={textModifiers(tokens, { style: 'title2', weight: 'semibold' })}>{next.title}</NativeText>
                <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'body' })}>{[`${next.start} – ${next.end}`, next.location].filter(Boolean).join(' · ')}</NativeText>
              </> : <HStack alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ vertical: 4 })]}>
                <VStack alignment="center" spacing={0} modifiers={[frame({ width: 44, height: 44 }), background(tokens.slateSoft), clipShape('roundedRectangle', 12)]}>
                  <SymbolImage name="calendar" color={tokens.slate} size={22} />
                </VStack>
                <VStack alignment="leading" spacing={4} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
                  <NativeText modifiers={textModifiers(tokens, { style: 'title2', weight: 'semibold' })}>{emptyTitle}</NativeText>
                  <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'body' })}>{emptyBody}</NativeText>
                </VStack>
              </HStack>}
              <NativeButton label="Abrir horario" onPress={onOpenSchedule} modifiers={nativeGlassModifiers(tokens, true)} />
            </VStack>
          )}
        </Section>
        {!loading && !error && remaining.length > 1 ? <Section title="Después">
          {remaining.slice(1).map((entry) => <AgendaContentNative key={entry.id} entry={entry} tokens={tokens} />)}
        </Section> : null}
      </List>
    </PageNative>
  );
}

function DownloaderNative({ tokens, onBack }: { tokens: ThemeTokens; onBack: () => void }) {
  const urlState = useNativeState('');
  const [url, setUrl] = useState('');
  const [mode, setMode] = useState<DownloadMode>('video');
  const [phase, setPhase] = useState<'idle' | 'analyzing' | 'ready' | 'downloading'>('idle');
  const [analysis, setAnalysis] = useState<DownloadAnalysis | null>(null);
  const [status, setStatus] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  const updateUrl = (value: string) => {
    setUrl(value);
    urlState.set(value);
    setAnalysis(null);
    setPhase('idle');
    setStatus(null);
  };

  const analyze = async () => {
    if (phase === 'analyzing' || phase === 'downloading' || !url.trim()) return;
    setPhase('analyzing');
    setStatus(null);
    try {
      setAnalysis(await analyzeUrl(url));
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
      const result = await downloadFromService(url, mode);
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
  const actionIcon: SFSymbol = phase === 'ready' ? 'arrow.down' : 'magnifyingglass';

  return (
    <PageNative title="Downloader" tokens={tokens} onBack={onBack}>
      <Form modifiers={groupedListModifiers(tokens)}>
        <Section title="Enlace">
          <TextField text={urlState} onTextChange={updateUrl} placeholder="https://…" modifiers={[font({ textStyle: 'body' }), textFieldStyle('plain'), keyboardType('url'), textInputAutocapitalization('never'), autocorrectionDisabled(), disabled(isBusy), accessibilityLabel('Enlace del audio o video'), submitLabel('go'), onSubmit(() => { if (phase === 'idle') void analyze(); })]} />
        </Section>
        {analysis ? <>
          <Section title="Contenido">
              <VStack alignment="leading" spacing={8} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ vertical: 8 })]}>
                <NativeText modifiers={textModifiers(tokens, { style: 'body', weight: 'bold' })}>{analysis.title}</NativeText>
                <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'subheadline' })}>{[analysis.uploader, formatDuration(analysis.durationSeconds)].filter(Boolean).join(' · ')}</NativeText>
              </VStack>
          </Section>
          <Section title="Formato">
          <Picker selection={mode} onSelectionChange={(value) => { setMode(value as DownloadMode); setStatus(null); }} modifiers={[pickerStyle('segmented'), frame({ maxWidth: Infinity }), disabled(isBusy), accessibilityLabel('Formato')]}>
            <NativeText modifiers={[tag('video')]}>Video</NativeText>
            <NativeText modifiers={[tag('audio')]}>Audio</NativeText>
          </Picker>
          </Section>
        </> : null}
        <Section>
          {isBusy ? <ProgressView><NativeText>{actionLabel}</NativeText></ProgressView> : null}
          <NativeButton
            label={actionLabel}
            systemImage={actionIcon}
            onPress={() => void (phase === 'ready' ? download() : analyze())}
            modifiers={[...nativeGlassModifiers(tokens, true), accessibilityLabel(actionLabel), disabled(isBusy || !url.trim())]}
          />
        </Section>

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
    <PageNative title="Miniapps" tokens={tokens}>
      <List modifiers={groupedListModifiers(tokens)}>
        <Section title="Biblioteca">
          {!loading && !error && entries.length > 0 ? (
            <ContextMenu>
              <ContextMenu.Trigger>{scheduleRow}</ContextMenu.Trigger>
              <ContextMenu.Items>
                <NativeButton label="Borrar horario" systemImage="trash" role="destructive" onPress={onClearSchedule} />
              </ContextMenu.Items>
            </ContextMenu>
          ) : scheduleRow}
          {downloaderRow}
        </Section>
      </List>
    </PageNative>
  );
}

function MiniappRowNative({ title, detail, icon, iconColor, iconBackground, tokens, onPress, label }: { title: string; detail: string; icon: SFSymbol; iconColor: string; iconBackground: string; tokens: ThemeTokens; onPress: () => void; label: string }) {
  return (
    <NativeButton onPress={onPress} modifiers={[buttonStyle('plain'), frame({ maxWidth: Infinity, alignment: 'leading' }), accessibilityLabel(label)]}>
      <HStack alignment="center" spacing={16} modifiers={[frame({ maxWidth: Infinity, minHeight: 64, alignment: 'leading' }), padding({ vertical: 8 })]}>
        <VStack alignment="center" spacing={0} modifiers={[frame({ width: 44, height: 44 }), background(iconBackground), clipShape('roundedRectangle', 12)]}>
          <SymbolImage name={icon} color={iconColor} size={22} />
        </VStack>
        <VStack alignment="leading" spacing={3} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
          <NativeText modifiers={textModifiers(tokens, { style: 'body', weight: 'bold' })}>{title}</NativeText>
          <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'footnote' })}>{detail}</NativeText>
        </VStack>
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
            {(Object.keys(labels) as ThemeMode[]).map((mode) => <NativeText key={mode} modifiers={[tag(mode)]}>{labels[mode]}</NativeText>)}
          </Picker>
        </Section>
      </Form>
    </PageNative>
  );
}

function ScheduleEntryRowNative({ entry, tokens, onPress }: { entry: ScheduleEntry; tokens: ThemeTokens; onPress: () => void }) {
  return (
    <NativeButton onPress={onPress} modifiers={[buttonStyle('plain'), frame({ maxWidth: Infinity, alignment: 'leading' }), accessibilityLabel(`Editar ${entry.title}, de ${entry.start} a ${entry.end}${entry.location ? `, ${entry.location}` : ''}`)]}>
      <AgendaContentNative entry={entry} tokens={tokens} />
    </NativeButton>
  );
}

function AgendaContentNative({ entry, tokens }: { entry: ScheduleEntry; tokens: ThemeTokens }) {
  const entryColor = colorForKey(entry.color, tokens);
  return <AdaptiveRow modifiers={[frame({ maxWidth: Infinity, minHeight: 72, alignment: 'leading' }), padding({ vertical: 12 })]}>
        <VStack alignment="leading" spacing={4}>
          <NativeText modifiers={[...textModifiers(tokens, { style: 'headline', weight: 'semibold' }), monospacedDigit()]}>{entry.start}</NativeText>
          <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'subheadline' }), monospacedDigit()]}>{entry.end}</NativeText>
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
    <VStack alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity, alignment: 'center' }), padding({ vertical: 24 })]}>
      <ContentUnavailableView title="Sin clases" systemImage="calendar" />
      {entries.length === 0 ? <NativeButton label="Cargar un ejemplo" onPress={onLoadExample} modifiers={[buttonStyle('borderless'), tint(tokens.slate)]} /> : null}
    </VStack>
  );
}

function WeekOverviewNative({ entries, tokens, onSelectDay }: { entries: ScheduleEntry[]; tokens: ThemeTokens; onSelectDay: (day: DayIndex) => void }) {
  return (
    <Group>
      {DAYS.map((day) => {
        const dayEntries = sortedEntries(entries.filter((entry) => entry.day === day.index));
        return (
          <Section key={day.index} title={day.long}>
            <NativeButton onPress={() => onSelectDay(day.index)} modifiers={[buttonStyle('plain'), accessibilityLabel(`Abrir ${day.long}, ${dayEntries.length} clases`)]}>
              <VStack alignment="leading" spacing={0} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
                {dayEntries.length ? dayEntries.map((entry) => <AgendaContentNative key={entry.id} entry={entry} tokens={tokens} />) : <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'body' }), padding({ vertical: 12 }), frame({ minHeight: 44 })]}>Día libre</NativeText>}
              </VStack>
            </NativeButton>
          </Section>
        );
      })}
    </Group>
  );
}

function ScheduleNative({ entries, tokens, selectedDay, onSelectDay, onCreate, onEdit, onLoadExample, onBack, loading, error, onRetry, view, setView }: { entries: ScheduleEntry[]; tokens: ThemeTokens; selectedDay: DayIndex; onSelectDay: (day: DayIndex) => void; onCreate: () => void; onEdit: (entry: ScheduleEntry) => void; onLoadExample: () => void; onBack: () => void; loading: boolean; error: string | null; onRetry: () => void; view: ScheduleView; setView: (view: ScheduleView) => void }) {
  const dayEntries = sortedEntries(entries.filter((entry) => entry.day === selectedDay));

  return (
    <PageNative title="Horario" tokens={tokens} onBack={onBack} action={
          <NativeCircleButton tokens={tokens} accent label="Añadir clase" systemName="plus" onPress={onCreate} disabled={loading || Boolean(error)} />
    }>
        <Picker selection={view} onSelectionChange={(value) => setView(value as ScheduleView)} modifiers={[pickerStyle('segmented'), frame({ maxWidth: 680 }), padding({ horizontal: 20, top: 8, bottom: 8 }), accessibilityLabel('Vista del horario')]}>
          <NativeText modifiers={[tag('day')]}>{'Agenda'}</NativeText>
          <NativeText modifiers={[tag('week')]}>{'Semana'}</NativeText>
        </Picker>
      <List modifiers={groupedListModifiers(tokens)}>
        {loading ? (
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
          <>
            <Section>
            <Picker label="Día" selection={selectedDay} onSelectionChange={(value) => onSelectDay(value as DayIndex)} modifiers={[pickerStyle('menu'), font({ textStyle: 'body' }), accessibilityLabel('Día del horario')]}>
              {DAYS.map((item) => <NativeText key={item.index} modifiers={[tag(item.index)]}>{item.long}</NativeText>)}
            </Picker>
            </Section>
            <Section title={dayEntries.length ? `${dayEntries.length} ${dayEntries.length === 1 ? 'clase' : 'clases'}` : undefined}>
              {dayEntries.length ? dayEntries.map((entry) => <ScheduleEntryRowNative key={entry.id} entry={entry} tokens={tokens} onPress={() => onEdit(entry)} />) : <EmptyAgendaNative entries={entries} tokens={tokens} onLoadExample={onLoadExample} />}
            </Section>
          </>
        ) : (
          <WeekOverviewNative entries={entries} tokens={tokens} onSelectDay={(nextDay) => { onSelectDay(nextDay); setView('day'); }} />
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
    <Form modifiers={[scrollContentBackground('hidden'), background(tokens.background), frame({ maxWidth: Infinity, maxHeight: Infinity }), listStyle('insetGrouped'), disabled(saving)]}>
      <Section title="Clase">
        <VStack alignment="leading" spacing={6}>
          <NativeText modifiers={textModifiers(tokens, { style: 'body', weight: 'semibold' })}>Nombre</NativeText>
          <TextField text={titleState} onTextChange={(value) => { setTitle(value); titleState.set(value); }} placeholder="Matemáticas" modifiers={[font({ textStyle: 'body' }), textFieldStyle('plain'), accessibilityLabel('Nombre de la clase'), submitLabel('next'), onSubmit(() => { void locationInput.current?.focus(); })]} />
        </VStack>
      </Section>
      <Section title="Horario">
        <Picker label="Día" selection={day} onSelectionChange={(value) => setDay(value as DayIndex)} modifiers={[pickerStyle('menu'), font({ textStyle: 'body', weight: 'semibold' })]}>
          {DAYS.map((item) => <NativeText key={item.index} modifiers={[tag(item.index)]}>{item.long}</NativeText>)}
        </Picker>
        <DatePicker title="Empieza" selection={timeToDate(start)} displayedComponents={['hourAndMinute']} onDateChange={(date) => setStart(dateToTime(date))} modifiers={[font({ textStyle: 'body', weight: 'semibold' })]} />
        <DatePicker title="Termina" selection={timeToDate(end)} displayedComponents={['hourAndMinute']} onDateChange={(date) => setEnd(dateToTime(date))} modifiers={[font({ textStyle: 'body', weight: 'semibold' })]} />
      </Section>
      <Section title="Detalles">
        <VStack alignment="leading" spacing={6}>
          <NativeText modifiers={textModifiers(tokens, { style: 'body', weight: 'semibold' })}>Lugar</NativeText>
          <TextField ref={locationInput} text={locationState} onTextChange={(value) => { setLocation(value); locationState.set(value); }} placeholder="Opcional" modifiers={[font({ textStyle: 'body' }), textFieldStyle('plain'), accessibilityLabel('Lugar, opcional'), submitLabel('done'), onSubmit(() => { void locationInput.current?.blur(); })]} />
        </VStack>
        <Picker label="Color" selection={color} onSelectionChange={(value) => setColor(value as ScheduleColor)} modifiers={[pickerStyle('menu'), font({ textStyle: 'body', weight: 'semibold' })]}>
          {COLORS.map((item) => <NativeText key={item.key} modifiers={[tag(item.key)]}>{item.label}</NativeText>)}
        </Picker>
      </Section>

      {validationError ? <Section><NativeText modifiers={[...textModifiers(tokens, { color: tokens.danger, style: 'callout', weight: 'semibold' }), background(tokens.surfaceRaised), padding({ all: 12 }), clipShape('roundedRectangle', 14), strokeBorder({ content: tokens.danger, style: { lineWidth: 1 }, shape: 'roundedRectangle', cornerRadius: 14 })]}>{validationError}</NativeText></Section> : null}

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

  const openSchedule = (day = selectedDay) => {
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
    if (conflict) return `Se cruza con “${conflict.title}”, de ${conflict.start} a ${conflict.end}.`;
    const nextEntries = sortedEntries([...entries.filter((item) => item.id !== nextEntry.id), nextEntry]);
    try {
      await persistEntries(nextEntries);
      setSelectedDay(nextEntry.day);
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
        setSelectedDay(EXAMPLE_SCHEDULE[0].day);
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
    <ScheduleNative entries={entries} tokens={tokens} selectedDay={selectedDay} onSelectDay={setSelectedDay} onCreate={() => openEditor()} onEdit={openEditor} onLoadExample={loadExample} onBack={() => setDestination('library')} loading={loading} error={storageError} onRetry={loadData} view={scheduleView} setView={setScheduleView} />
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
    <Host style={{ flex: 1, backgroundColor: tokens.background }} colorScheme={tokens.mode} seedColor={tokens.blue} useViewportSizeMeasurement>
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
