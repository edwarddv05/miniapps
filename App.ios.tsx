import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { Host } from '@expo/ui';
import { BottomSheet, Button as NativeButton, ContextMenu, Divider, Form, HStack, Picker, ProgressView, Section, SecureField, type SecureFieldRef, Spacer, TabView, Text as NativeText, VStack, ZStack, useNativeState } from '@expo/ui/swift-ui';
import { accessibilityLabel, accessibilityElement, accessibilityValue, blur, buttonStyle, clipShape, contentShape, controlSize, disabled, font, frame, ignoreSafeArea, autocorrectionDisabled, textInputAutocapitalization, lineLimit, minimumScaleFactor, monospacedDigit, onSubmit, offset, padding, pickerStyle, scrollDismissesKeyboard, shapes, submitLabel, tag } from '@expo/ui/swift-ui/modifiers';
import type { SFSymbol } from 'sf-symbols-typescript';
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Appearance, Linking, useColorScheme } from 'react-native';
import { SCHEDULE_KEY, classesClash, courseLabel, formatScheduleTime, parseSchedule, todayAgenda, type DayIndex, type ScheduleEntry } from './schedule-data';
import { useCurrentTime } from './use-current-time';
import { UI, type MiniappDestination } from './ui-structure';
import { loadDownloaderUrl } from './downloader-api';
import { StatusBar } from 'expo-status-bar';
import { background, foregroundStyle, tint } from './native-colors';
import { getGeminiApiKey, setGeminiApiKey, pickImagesAndScan } from './ai-schedule-scanner';
import { exportBackup, pickBackup, restoreBackup, summarize, summaryText, type Backup } from './backup';
import { type ScannedClass } from './schedule-scan';
import { type SavedTrip } from './transit-trips';
import { DATA_SAVER_KEY, DAYS, DataStateNative, NativeCircleButton, PageNative, ReadingCanvasNative, type ScheduleView, type Screen, SectionHeadingNative, SymbolImage, THEME_KEY, type ThemeMode, type ThemeTokens, WeekStripNative,  capitalize, colorForKey, courseCount, currentDayIndex, durationLabel, getTokens, groupedListModifiers, minutesFromTime, momentFor, nextClassAfterToday, sortedEntries, textModifiers, timeRange, withAlpha } from './screens/shared';
import { DownloaderNative, type SharedLink } from './screens/downloader';
import { parseAppLink } from './app-links';
import { syncScheduleWidget } from './widget-sync';
import { Sky, animationsAvailable } from './modules/superapp-native/animations';
import { AnimeNative, AnimeTodayNative } from './screens/anime';
import { TRANSIT_ICON, TransitNative, TransitTodayNative } from './screens/transit';
import { CARDS_ICON, CardsNative, CardsTodayNative, useCardsLibraryDetail } from './screens/cards';
import { AIScanReviewNative, APIKeySheetNative, ScheduleEditorNative, ScheduleNative } from './screens/schedule';

function HomeNative({ entries, tokens, loading, error, onOpenSchedule, onOpenAnime, onOpenTrip, onOpenCard, onRetry }: { entries: ScheduleEntry[]; tokens: ThemeTokens; loading: boolean; error: string | null; onOpenSchedule: () => void; onOpenAnime: (id: number) => void; onOpenTrip: (trip: SavedTrip) => void; onOpenCard: (cardId: string) => void; onRetry: () => void }) {
  const now = useCurrentTime();
  const { today, remaining, next, ongoing } = todayAgenda(entries, now);
  const todayIndex = ((now.getDay() + 6) % 7) as DayIndex;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const later = next ? null : nextClassAfterToday(entries, todayIndex);
  const dateLine = capitalize(new Intl.DateTimeFormat('es-PE', { weekday: 'long', day: 'numeric', month: 'long' }).format(now));
  const ready = !loading && !error;

  const accent = next ? colorForKey(next.color, tokens.mode) : null;

  // The class in progress (or the next one) is the page: no card, its own
  // colour for the title and progress, time left in large rounded figures.
  const hero = next ? (() => {
    const start = minutesFromTime(next.start);
    const end = minutesFromTime(next.end);
    const progress = Math.min(1, Math.max(0, (nowMinutes - start) / (end - start)));
    const left = durationLabel(ongoing ? end - nowMinutes : start - nowMinutes);
    return <VStack alignment="leading" spacing={8} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ horizontal: 4 })]}>
      <NativeText modifiers={textModifiers(tokens, { color: accent?.ink, style: 'subheadline', weight: 'bold' })}>{ongoing ? 'En curso' : 'Siguiente'}</NativeText>
      <NativeText modifiers={textModifiers(tokens, { color: accent?.ink, style: 'title', weight: 'bold' })}>{next.title}</NativeText>
      <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'body' }), monospacedDigit()]}>{[courseLabel(next), next.kind, timeRange(next), next.location].filter(Boolean).join(' · ')}</NativeText>
      <HStack alignment="firstTextBaseline" spacing={8} modifiers={[padding({ top: 10 }), accessibilityElement('combine')]}>
        <NativeText modifiers={[foregroundStyle(tokens.text), font({ size: 46, weight: 'heavy', design: 'rounded' }), monospacedDigit(), minimumScaleFactor(0.6), lineLimit(1)]}>{left}</NativeText>
        <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'body' })}>{ongoing ? 'para terminar' : 'para empezar'}</NativeText>
      </HStack>
      {ongoing ? <ProgressView value={progress} modifiers={[tint(accent?.main ?? tokens.blue), accessibilityLabel('Progreso de la clase'), accessibilityValue(`${Math.round(progress * 100)} %`)]} /> : null}
    </VStack>;
  })() : (() => {
    const title = !entries.length ? 'Sin clases guardadas' : today.length ? 'Clases terminadas' : 'Día libre';
    const symbol: SFSymbol = !entries.length ? 'calendar' : today.length ? 'checkmark.circle' : 'sun.max';
    const laterDay = later ? (later.offset === 1 ? 'Mañana' : DAYS[later.entry.day].long) : null;
    return <HStack alignment="center" spacing={14} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ horizontal: 4, vertical: 4 })]}>
      <SymbolImage name={symbol} color={tokens.secondary} size={25} />
      <VStack alignment="leading" spacing={3} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
        <NativeText modifiers={textModifiers(tokens, { style: 'title3', weight: 'semibold' })}>{title}</NativeText>
        {later && laterDay ? <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'subheadline' }), monospacedDigit()]}>{`${laterDay}, ${formatScheduleTime(later.entry.start)} · ${later.entry.title}`}</NativeText> : null}
      </VStack>
    </HStack>;
  })();

  const upcoming = remaining.slice(1);
  const courses = courseCount(entries);
  return (
    <PageNative title="Hoy" subtitle={dateLine} tokens={tokens} ambient={ready && !animationsAvailable ? accent?.main : null} backdrop={<Sky minute={nowMinutes} dark={tokens.mode === 'dark'} modifiers={[frame({ maxWidth: Infinity, height: 460, alignment: 'top' })]} />} action={<NativeCircleButton tokens={tokens} label="Abrir horario" systemName="calendar" onPress={onOpenSchedule} />}>
      <ReadingCanvasNative tokens={tokens}>
        {ready ? <>
          {hero}
          {upcoming.length ? <VStack alignment="leading" spacing={12} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
            <SectionHeadingNative title="Después" tokens={tokens} />
            <VStack alignment="leading" spacing={0} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ horizontal: 4 })]}>
              {upcoming.map((entry, index) => <TimelineRowNative key={entry.id} entry={entry} tokens={tokens} last={index === upcoming.length - 1} />)}
            </VStack>
          </VStack> : null}
          <CardsTodayNative tokens={tokens} now={now} onOpen={onOpenCard} />
          <TransitTodayNative tokens={tokens} now={now} onOpen={onOpenTrip} />
          <AnimeTodayNative tokens={tokens} now={now} onOpen={onOpenAnime} />
          {entries.length ? <VStack alignment="leading" spacing={10} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
            <SectionHeadingNative title="Semana" detail={courses === 1 ? '1 curso' : `${courses} cursos`} tokens={tokens} />
            <WeekStripNative entries={entries} tokens={tokens} today={todayIndex} accent={accent} />
          </VStack> : null}
        </> : <DataStateNative loading={loading} error={error} tokens={tokens} onRetry={onRetry} />}
      </ReadingCanvasNative>
    </PageNative>
  );
}

// One stop on the day's line: a dot in the class colour, a thin rule down to
// the next stop, then time, title and place.
function TimelineRowNative({ entry, tokens, last }: { entry: ScheduleEntry; tokens: ThemeTokens; last: boolean }) {
  const color = colorForKey(entry.color, tokens.mode);
  return <HStack alignment="top" spacing={14} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), accessibilityElement('combine')]}>
    <VStack alignment="center" spacing={4} modifiers={[frame({ width: 12, maxHeight: Infinity, alignment: 'top' }), padding({ top: 5 })]}>
      <VStack modifiers={[frame({ width: 11, height: 11 }), background(color.main), clipShape('circle')]}>{null}</VStack>
      {last ? null : <VStack modifiers={[frame({ width: 2, maxHeight: Infinity }), background(tokens.border)]}>{null}</VStack>}
    </VStack>
    <VStack alignment="leading" spacing={2} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ bottom: last ? 0 : 20 })]}>
      <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'subheadline', weight: 'semibold' }), monospacedDigit()]}>{timeRange(entry)}</NativeText>
      <NativeText modifiers={textModifiers(tokens, { style: 'headline', weight: 'semibold' })}>{entry.title}</NativeText>
      {entry.location || entry.code || entry.kind ? <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'subheadline' })}>{[courseLabel(entry), entry.kind, entry.location].filter(Boolean).join(' · ')}</NativeText> : null}
    </VStack>
  </HStack>;
}

function MiniappsNative({ entries, tokens, loading, error, onOpenSchedule, onOpenDownloader, onOpenAnime, onOpenTransit, onOpenCards, onClearSchedule }: { entries: ScheduleEntry[]; tokens: ThemeTokens; loading: boolean; error: string | null; onOpenSchedule: () => void; onOpenDownloader: () => void; onOpenAnime: () => void; onOpenTransit: () => void; onOpenCards: () => void; onClearSchedule: () => void }) {
  const scheduleRow = <MiniappRowNative title="Horario" detail={loading ? 'Cargando…' : error ? 'No disponible' : entries.length ? (courseCount(entries) === 1 ? '1 curso' : `${courseCount(entries)} cursos`) : 'Sin clases guardadas'} icon="calendar" iconColor={tokens.slate} iconBackground={tokens.slateSoft} tokens={tokens} onPress={onOpenSchedule} label="Abrir Miniapp Horario" />;
  const downloaderRow = <MiniappRowNative title="Downloader" detail="Audio y video" icon="arrow.down.circle" iconColor={tokens.blue} iconBackground={tokens.blueSoft} tokens={tokens} onPress={onOpenDownloader} label="Abrir Miniapp Downloader" />;
  const transitIcon = TRANSIT_ICON[tokens.mode];
  const transitRow = <MiniappRowNative title="Metropolitano" detail="Rutas y horarios" icon="bus" iconColor={transitIcon} iconBackground={withAlpha(transitIcon, tokens.mode === 'dark' ? 0.18 : 0.14)} tokens={tokens} onPress={onOpenTransit} label="Abrir Miniapp Metropolitano" />;
  const cardsIcon = CARDS_ICON[tokens.mode];
  const cardsDetail = useCardsLibraryDetail();
  const cardsRow = <MiniappRowNative title="Tarjetas" detail={cardsDetail} icon="creditcard.fill" iconColor={cardsIcon} iconBackground={withAlpha(cardsIcon, tokens.mode === 'dark' ? 0.18 : 0.14)} tokens={tokens} onPress={onOpenCards} label="Abrir Miniapp Tarjetas" />;
  const animeRow = <MiniappRowNative title="Anime" detail="Catálogo y estrenos" icon="play.tv" iconColor={tokens.sage} iconBackground={tokens.sageSoft} tokens={tokens} onPress={onOpenAnime} label="Abrir Miniapp Anime" />;

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
          <VStack alignment="leading" spacing={0} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ horizontal: 16, vertical: 4 }), background(tokens.surface), clipShape('roundedRectangle', UI.groupRadius)]}>{animeRow}</VStack>
          <VStack alignment="leading" spacing={0} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ horizontal: 16, vertical: 4 }), background(tokens.surface), clipShape('roundedRectangle', UI.groupRadius)]}>{transitRow}</VStack>
          <VStack alignment="leading" spacing={0} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ horizontal: 16, vertical: 4 }), background(tokens.surface), clipShape('roundedRectangle', UI.groupRadius)]}>{cardsRow}</VStack>
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

function HomeTabNative({ entries, tokens, loading, error, onOpenSchedule, onOpenAnime, onOpenTrip, onOpenCard, onRetry }: { entries: ScheduleEntry[]; tokens: ThemeTokens; loading: boolean; error: string | null; onOpenSchedule: () => void; onOpenAnime: (id: number) => void; onOpenTrip: (trip: SavedTrip) => void; onOpenCard: (cardId: string) => void; onRetry: () => void }) {
  return (
    <VStack modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity })]}>
      <HomeNative entries={entries} tokens={tokens} loading={loading} error={error} onOpenSchedule={onOpenSchedule} onOpenAnime={onOpenAnime} onOpenTrip={onOpenTrip} onOpenCard={onOpenCard} onRetry={onRetry} />
    </VStack>
  );
}

function MiniappsTabNative({ entries, tokens, loading, error, destination, schedule, downloader, anime, transit, cards, onOpenSchedule, onOpenDownloader, onOpenAnime, onOpenTransit, onOpenCards, onClearSchedule }: { entries: ScheduleEntry[]; tokens: ThemeTokens; loading: boolean; error: string | null; destination: MiniappDestination; schedule: ReactNode; downloader: ReactNode; anime: ReactNode; transit: ReactNode; cards: ReactNode; onOpenSchedule: () => void; onOpenDownloader: () => void; onOpenAnime: () => void; onOpenTransit: () => void; onOpenCards: () => void; onClearSchedule: () => void }) {
  return (
    <VStack modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity })]}>
      {destination === 'schedule' ? schedule : destination === 'downloader' ? downloader : destination === 'anime' ? anime : destination === 'transit' ? transit : destination === 'cards' ? cards : <MiniappsNative entries={entries} tokens={tokens} loading={loading} error={error} onOpenSchedule={onOpenSchedule} onOpenDownloader={onOpenDownloader} onOpenAnime={onOpenAnime} onOpenTransit={onOpenTransit} onOpenCards={onOpenCards} onClearSchedule={onClearSchedule} />}
    </VStack>
  );
}

// Copy of the schedule, anime list, cards and saved trips, and restoring it.
function BackupRowsNative({ tokens, onRestored }: { tokens: ThemeTokens; onRestored: () => void }) {
  const [busy, setBusy] = useState<'export' | 'restore' | null>(null);

  const doExport = async () => {
    setBusy('export');
    try {
      await exportBackup();
    } catch (error) {
      Alert.alert('No se pudo crear el respaldo', error instanceof Error ? error.message : 'Inténtalo de nuevo.');
    } finally {
      setBusy(null);
    }
  };

  const doRestore = async () => {
    setBusy('restore');
    let backup: Backup | null;
    try {
      backup = await pickBackup();
    } catch (error) {
      setBusy(null);
      Alert.alert('No se pudo leer el respaldo', error instanceof Error ? error.message : 'Inténtalo de nuevo.');
      return;
    }
    setBusy(null);
    if (!backup) return;
    const created = backup.createdAt ? new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(backup.createdAt)) : null;
    const chosen = backup;
    Alert.alert('Restaurar respaldo', `${created ? `Respaldo del ${created}: ` : ''}${summaryText(summarize(chosen.data))}. Reemplaza los datos actuales de este iPhone.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Restaurar',
        style: 'destructive',
        onPress: () => {
          setBusy('restore');
          void restoreBackup(chosen)
            .then(() => {
              onRestored();
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            })
            .catch(() => Alert.alert('No se pudo restaurar', 'Tus datos no cambiaron. Inténtalo de nuevo.'))
            .finally(() => setBusy(null));
        },
      },
    ]);
  };

  return <>
    <HStack alignment="center" spacing={12}>
      <NativeButton label="Exportar respaldo" systemImage="square.and.arrow.up" onPress={() => void doExport()} modifiers={[tint(tokens.blue), disabled(busy !== null)]} />
      <Spacer />
      {busy === 'export' ? <ProgressView modifiers={[controlSize('small')]} /> : null}
    </HStack>
    <HStack alignment="center" spacing={12}>
      <NativeButton label="Restaurar respaldo" systemImage="square.and.arrow.down" onPress={() => void doRestore()} modifiers={[tint(tokens.blue), disabled(busy !== null)]} />
      <Spacer />
      {busy === 'restore' ? <ProgressView modifiers={[controlSize('small')]} /> : null}
    </HStack>
  </>;
}

function SettingsNative({ themeMode, tokens, onThemeChange, apiKey, onApiKeyChange, onRestored }: { themeMode: ThemeMode; tokens: ThemeTokens; onThemeChange: (mode: ThemeMode) => void; apiKey: string; onApiKeyChange: (key: string) => void; onRestored: () => void }) {
  const labels: Record<ThemeMode, string> = { system: 'Sistema', light: 'Claro', dark: 'Oscuro' };
  const keyState = useNativeState('');
  const keyInput = useRef<SecureFieldRef>(null);
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
    <PageNative title="Ajustes" tokens={tokens} onHeaderTap={() => void keyInput.current?.blur()}>
      <Form modifiers={[...groupedListModifiers(tokens), scrollDismissesKeyboard('immediately')]}>
        <Section title="Tema">
          <Picker selection={themeMode} onSelectionChange={(value) => onThemeChange(value as ThemeMode)} modifiers={[pickerStyle('inline'), accessibilityLabel('Tema')]}>
            {(Object.keys(labels) as ThemeMode[]).map((mode) => <HStack key={mode} spacing={12} modifiers={[tag(mode), padding({ vertical: 8 })]}><SymbolImage name={mode === 'system' ? 'iphone' : mode === 'light' ? 'sun.max' : 'moon'} color={tokens.secondary} /><NativeText modifiers={textModifiers(tokens)}>{labels[mode]}</NativeText></HStack>)}
          </Picker>
        </Section>
        <Section title="Datos">
          <BackupRowsNative tokens={tokens} onRestored={onRestored} />
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
                ref={keyInput}
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
  const [scannedSchedule, setScannedSchedule] = useState<ScannedClass[] | null>(null);
  const [apiKeySheetVisible, setApiKeySheetVisible] = useState(false);
  const [dataSaver, setDataSaver] = useState(false);
  const writePending = useRef(false);
  const ready = !loading && !storageError;
  const clock = useCurrentTime();
  const moment = momentFor(clock);
  const tokens = useMemo(() => getTokens(themeMode, systemScheme, moment), [themeMode, systemScheme, moment]);

  useEffect(() => {
    Appearance.setColorScheme(themeMode === 'system' ? 'unspecified' : themeMode);
    return () => Appearance.setColorScheme('unspecified');
  }, [themeMode]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setStorageError(null);
    try {
      const [storedSchedule, storedTheme, storedApiKey, storedDataSaver] = await Promise.all([
        AsyncStorage.getItem(SCHEDULE_KEY),
        AsyncStorage.getItem(THEME_KEY),
        getGeminiApiKey(),
        AsyncStorage.getItem(DATA_SAVER_KEY),
        loadDownloaderUrl(),
      ]);
      setDataSaver(storedDataSaver === 'true');
      const parsed = parseSchedule(storedSchedule);
      const cleaned = parsed.filter((e) => !e.id.startsWith('example-'));
      if (cleaned.length !== parsed.length) {
        await AsyncStorage.setItem(SCHEDULE_KEY, JSON.stringify(cleaned));
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
    void setGeminiApiKey(key).catch(() => Alert.alert('No se pudo guardar la clave', 'La clave se usará solo hasta cerrar la app.'));
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

  // Links from the share extension (download that address) and the widget (open Horario).
  const [sharedLink, setSharedLink] = useState<SharedLink | null>(null);
  useEffect(() => {
    const open = (link: string | null) => {
      const target = link ? parseAppLink(link) : null;
      if (!target) return;
      if (target.kind === 'schedule') {
        openSchedule();
      } else {
        setSharedLink({ url: target.url, nonce: Date.now() });
        openDownloader();
      }
    };
    void Linking.getInitialURL().then(open).catch(() => undefined);
    const subscription = Linking.addEventListener('url', ({ url }) => open(url));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (ready) syncScheduleWidget(entries);
  }, [entries, ready]);

  const openAnime = () => {
    setScreen('miniapps');
    setDestination('anime');
  };

  const openTransit = () => {
    setScreen('miniapps');
    setDestination('transit');
  };

  // From Hoy's Metropolitano section: the miniapp opened on that trip.
  const [transitLink, setTransitLink] = useState<(SavedTrip & { nonce: number }) | null>(null);
  const openTransitTrip = (trip: SavedTrip) => {
    setTransitLink({ ...trip, nonce: Date.now() });
    openTransit();
  };

  const openCards = () => {
    setScreen('miniapps');
    setDestination('cards');
  };

  // From Hoy's Tarjetas section: the miniapp opened on that card.
  const [cardsLink, setCardsLink] = useState<{ cardId: string; nonce: number } | null>(null);
  const openCard = (cardId: string) => {
    setCardsLink({ cardId, nonce: Date.now() });
    openCards();
  };

  // From Hoy's anime section: the Anime miniapp opened on that anime.
  const [animeLink, setAnimeLink] = useState<{ id: number; nonce: number } | null>(null);
  const openAnimeDetail = (id: number) => {
    setAnimeLink({ id, nonce: Date.now() });
    openAnime();
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
      await AsyncStorage.setItem(SCHEDULE_KEY, JSON.stringify(nextEntries));
      setEntries(nextEntries);
    } finally {
      writePending.current = false;
    }
  };

  const saveEntry = async (nextEntry: ScheduleEntry) => {
    const conflict = entries.find((item) => classesClash(nextEntry, item));
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

  const changeDataSaver = (value: boolean) => {
    setDataSaver(value);
    void AsyncStorage.setItem(DATA_SAVER_KEY, String(value)).catch(() => Alert.alert('No se pudo guardar el ajuste', 'Ahorro de datos está aplicado solo hasta cerrar la app.'));
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
      onClear={clearSchedule}
    />
  );
  const downloader = <DownloaderNative tokens={tokens} dataSaver={dataSaver} onDataSaverChange={changeDataSaver} onBack={() => setDestination('library')} sharedLink={sharedLink} onSharedLinkHandled={() => setSharedLink(null)} />;
  const anime = <AnimeNative tokens={tokens} apiKey={apiKey} link={animeLink} onBack={() => setDestination('library')} />;
  const transit = <TransitNative tokens={tokens} link={transitLink} onBack={() => setDestination('library')} />;
  const cards = <CardsNative tokens={tokens} link={cardsLink} onBack={() => setDestination('library')} />;
  const body = (
    <TabView selection={screen} onSelectionChange={(value) => setScreen(value as Screen)} modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity }), tint(tokens.blue)]}>
      <TabView.Tab value="home" label="Inicio" systemImage="house.fill"><HomeTabNative entries={entries} tokens={tokens} loading={loading} error={storageError} onOpenSchedule={() => openSchedule(currentDayIndex())} onOpenAnime={openAnimeDetail} onOpenTrip={openTransitTrip} onOpenCard={openCard} onRetry={loadData} /></TabView.Tab>
      <TabView.Tab value="miniapps" label="Miniapps" systemImage="square.grid.2x2.fill"><MiniappsTabNative entries={entries} tokens={tokens} loading={loading} error={storageError} destination={destination} schedule={schedule} downloader={downloader} anime={anime} transit={transit} cards={cards} onOpenSchedule={() => openSchedule()} onOpenDownloader={openDownloader} onOpenAnime={openAnime} onOpenTransit={openTransit} onOpenCards={openCards} onClearSchedule={clearSchedule} /></TabView.Tab>
      <TabView.Tab value="settings" label="Ajustes" systemImage="gearshape.fill"><SettingsNative themeMode={themeMode} tokens={tokens} onThemeChange={changeTheme} apiKey={apiKey} onApiKeyChange={updateApiKey} onRestored={() => void loadData()} /></TabView.Tab>
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
