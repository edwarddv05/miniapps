import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BlurView } from 'expo-blur';
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import { ComponentProps, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatScheduleTime, parseSchedule, todayAgenda, type ScheduleEntry } from './schedule-data';
import { getGeminiApiKey, pickImagesAndScan, setGeminiApiKey } from './ai-schedule-scanner';
import { useCurrentTime } from './use-current-time';
import { UI, type MiniappDestination } from './ui-structure';
import { analyzeUrl, detectDownloadSource, downloadFromService, downloaderErrorMessage, formatDuration, saveDownload, type DownloadAnalysis, type DownloadMode, type DownloadSource } from './downloader-api';
import {
  Alert,
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  useWindowDimensions,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

type IconName = ComponentProps<typeof Ionicons>['name'];

function confirmAction(title: string, message: string, action: string, onConfirm: () => void) {
  if (Platform.OS === 'web') {
    if (window.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [{ text: 'Cancelar', style: 'cancel' }, { text: action, style: 'destructive', onPress: onConfirm }]);
}

function showError(message: string) {
  if (Platform.OS === 'web') window.alert(message);
  else Alert.alert('No se pudo completar la acción', message);
}
type ThemeMode = 'system' | 'light' | 'dark';
type Screen = 'home' | 'miniapps' | 'settings';
type ScheduleView = 'day' | 'week';
type DayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;
type ScheduleColor = 'slate' | 'coral' | 'sage';

type ThemeTokens = {
  mode: 'light' | 'dark';
  background: string;
  surface: string;
  surfaceRaised: string;
  controlTrack: string;
  text: string;
  secondary: string;
  muted: string;
  border: string;
  borderStrong: string;
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
const CIRCLE_CONTROL_SIZE = UI.circleControlSize;

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
  background: '#F2F2F7',
  surface: '#FFFFFF',
  surfaceRaised: '#FFFFFF',
  controlTrack: '#E4E4E9',
  text: '#16181D',
  secondary: '#4C5564',
  muted: '#5B6472',
  border: '#D7D9DD',
  borderStrong: '#727A86',
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
  background: '#000000',
  surface: '#1C1C1E',
  surfaceRaised: '#2C2C2E',
  controlTrack: '#1C1C1E',
  text: '#F5F5F7',
  secondary: '#D2D7E0',
  muted: '#B1B9C6',
  border: '#3C4553',
  borderStrong: '#778394',
  slate: '#AFC2E0',
  slateSoft: '#2B374A',
  blue: '#7DB0FF',
  blueSoft: '#233A60',
  sage: '#B3D5BE',
  sageSoft: '#294033',
  danger: '#FFAAA7',
  inverseText: '#14161C',
};

function getTokens(themeMode: ThemeMode, systemScheme: 'light' | 'dark' | 'unspecified' | null | undefined): ThemeTokens {
  const isDark = themeMode === 'dark' || (themeMode === 'system' && systemScheme === 'dark');
  return isDark ? DARK : LIGHT;
}

function currentDayIndex(): DayIndex {
  const day = new Date().getDay();
  return ((day + 6) % 7) as DayIndex;
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

function capitalize(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function GlassSurface({
  children,
  style,
  tokens,
  interactive = false,
  tintColor,
  accessibilityLabel,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  tokens: ThemeTokens;
  interactive?: boolean;
  tintColor?: string;
  accessibilityLabel?: string;
}) {
  const glassAvailable = isLiquidGlassAvailable() && isGlassEffectAPIAvailable();

  if (glassAvailable) {
    return (
      <GlassView
        style={style}
        glassEffectStyle="regular"
        colorScheme={tokens.mode}
        isInteractive={interactive}
        tintColor={tintColor}
        accessible={Boolean(accessibilityLabel)}
        accessibilityLabel={accessibilityLabel}
      >
        {children}
      </GlassView>
    );
  }

  const isDark = tokens.mode === 'dark';
  const flattened = StyleSheet.flatten(style) || {};
  const borderRadius = flattened.borderRadius ?? 20;

  return (
    <View
      style={[
        {
          borderRadius,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: tintColor
            ? (isDark ? 'rgba(125, 176, 255, 0.4)' : 'rgba(10, 102, 232, 0.35)')
            : (isDark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(255, 255, 255, 0.7)'),
          borderTopColor: tintColor
            ? (isDark ? 'rgba(125, 176, 255, 0.75)' : 'rgba(10, 102, 232, 0.65)')
            : (isDark ? 'rgba(255, 255, 255, 0.35)' : 'rgba(255, 255, 255, 0.95)'),
          borderBottomColor: tintColor
            ? (isDark ? 'rgba(125, 176, 255, 0.2)' : 'rgba(10, 102, 232, 0.2)')
            : (isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.04)'),
          backgroundColor: tintColor
            ? (isDark ? 'rgba(10, 102, 232, 0.72)' : 'rgba(10, 102, 232, 0.85)')
            : (isDark ? 'rgba(32, 37, 46, 0.55)' : 'rgba(255, 255, 255, 0.65)'),
        },
        style,
      ]}
      accessible={Boolean(accessibilityLabel)}
      accessibilityLabel={accessibilityLabel}
    >
      <BlurView
        tint={isDark ? 'systemMaterialDark' : 'systemMaterialLight'}
        intensity={Platform.OS === 'ios' ? 90 : 70}
        style={StyleSheet.absoluteFill}
      />
      {children}
    </View>
  );
}

function Icon({ name, color, size = 20 }: { name: IconName; color: string; size?: number }) {
  return <Ionicons name={name} size={size} color={color} accessible={false} aria-hidden />;
}

function GlassButton({
  label,
  icon,
  onPress,
  tokens,
  compact = false,
  inline = false,
  fullWidth = false,
  accessibilityHint,
  disabled = false,
}: {
  label: string;
  icon?: IconName;
  onPress: () => void;
  tokens: ThemeTokens;
  compact?: boolean;
  inline?: boolean;
  fullWidth?: boolean;
  accessibilityHint?: string;
  disabled?: boolean;
}) {
  return (
    <Pressable
      disabled={disabled}
      aria-disabled={disabled}
      aria-busy={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [styles.glassButtonPressable, compact && styles.glassButtonCompact, inline && styles.glassButtonInlinePressable, fullWidth && styles.glassButtonFullWidthPressable, disabled && styles.disabledControl, pressed && styles.pressed]}
    >
      <GlassSurface tokens={tokens} interactive={!disabled} tintColor={tokens.blue} style={[styles.glassButton, compact && styles.glassButtonCompactSurface, inline && styles.glassButtonInline, fullWidth && styles.glassButtonFullWidth]}>
        {icon ? <Icon name={icon} color={tokens.inverseText} size={compact ? 20 : 18} /> : null}
        <Text style={[styles.glassButtonText, { color: tokens.inverseText }]}>{label}</Text>
      </GlassSurface>
    </Pressable>
  );
}

function SourceBadge({ source, tokens }: { source: DownloadSource; tokens: ThemeTokens }) {
  return <View accessible accessibilityLabel={`Fuente ${source.label}`} style={[styles.downloaderSourceBadge, { backgroundColor: tokens.slateSoft }]}>
    <Text style={[styles.downloaderSourceBadgeText, { color: tokens.slate }]}>{source.shortLabel}</Text>
  </View>;
}

function AnimatedSparkles({ color, size = 20, isScanning = false }: { color: string; size?: number; isScanning?: boolean }) {
  const scale = useRef(new Animated.Value(1)).current;
  const rotate = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isScanning) {
      const loopRotate = Animated.loop(
        Animated.timing(rotate, {
          toValue: 1,
          duration: 1200,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      );
      loopRotate.start();
      return () => loopRotate.stop();
    } else {
      rotate.setValue(0);
      const loopPulse = Animated.loop(
        Animated.sequence([
          Animated.timing(scale, {
            toValue: 1.25,
            duration: 850,
            useNativeDriver: true,
          }),
          Animated.timing(scale, {
            toValue: 1.0,
            duration: 850,
            useNativeDriver: true,
          }),
        ])
      );
      loopPulse.start();
      return () => loopPulse.stop();
    }
  }, [isScanning]);

  const spin = rotate.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <Animated.View style={{ transform: isScanning ? [{ rotate: spin }] : [{ scale }] }}>
      <Icon name="sparkles" color={color} size={size} />
    </Animated.View>
  );
}

function IconButton({
  label,
  icon,
  onPress,
  tokens,
  tintColor = tokens.blue,
  iconColor = tokens.inverseText,
  disabled = false,
  accessibilityHint,
  isScanning = false,
}: {
  label: string;
  icon: IconName;
  onPress: () => void;
  tokens: ThemeTokens;
  tintColor?: string;
  iconColor?: string;
  disabled?: boolean;
  accessibilityHint?: string;
  isScanning?: boolean;
}) {
  return (
    <Pressable
      disabled={disabled}
      aria-disabled={disabled}
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [styles.iconButton, disabled && { opacity: 0.5 }, pressed && styles.pressed]}
    >
      <GlassSurface tokens={tokens} interactive={!disabled} tintColor={tintColor} style={styles.iconButtonSurface}>
        {icon === 'sparkles' ? (
          <AnimatedSparkles color={iconColor} size={21} isScanning={isScanning} />
        ) : (
          <Icon name={icon} color={iconColor} size={21} />
        )}
      </GlassSurface>
    </Pressable>
  );
}

function BackButton({ onPress, tokens }: { onPress: () => void; tokens: ThemeTokens }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="Volver a Miniapps" style={({ pressed }) => [styles.backGlassPressable, pressed && styles.pressed]}>
      <GlassSurface tokens={tokens} interactive style={styles.backGlassSurface}>
        <Icon name="chevron-back" color={tokens.text} size={22} />
      </GlassSurface>
    </Pressable>
  );
}

function TabBar({ activeScreen, onChange, tokens }: { activeScreen: Screen; onChange: (screen: Screen) => void; tokens: ThemeTokens }) {
  const insets = useSafeAreaInsets();
  const tabs: Array<{ screen: Screen; label: string; icon: IconName; activeIcon: IconName }> = [
    { screen: 'home', label: 'Inicio', icon: 'home-outline', activeIcon: 'home' },
    { screen: 'miniapps', label: 'Miniapps', icon: 'grid-outline', activeIcon: 'grid' },
    { screen: 'settings', label: 'Ajustes', icon: 'settings-outline', activeIcon: 'settings' },
  ];

  return (
    <View style={[styles.tabBarPosition, { paddingBottom: Math.max(insets.bottom, 8), pointerEvents: 'box-none' }]}>
      <GlassSurface tokens={tokens} style={styles.tabBarSurface}>
        <View style={styles.tabBarInner} accessibilityRole="tablist" accessibilityLabel="Navegación principal">
          {tabs.map((tab) => {
            const isActive = activeScreen === tab.screen;
            return (
              <Pressable
                key={tab.screen}
                onPress={() => {
                  if (!isActive) void Haptics.selectionAsync();
                  onChange(tab.screen);
                }}
                accessibilityRole="tab"
                accessibilityLabel={tab.label}
                aria-selected={isActive}
                style={({ pressed }) => [styles.tabItem, pressed && styles.pressed]}
              >
                <Icon name={isActive ? tab.activeIcon : tab.icon} color={isActive ? tokens.blue : tokens.secondary} size={21} />
                <Text style={[styles.tabLabel, { color: isActive ? tokens.blue : tokens.secondary }]}>{tab.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </GlassSurface>
    </View>
  );
}

function ScreenHeader({ title, tokens, right, onBack }: { title: string; tokens: ThemeTokens; right?: ReactNode; onBack?: () => void }) {
  return (
    <View style={styles.screenHeader}>
      {onBack ? <View style={styles.headerActions}>
        <BackButton onPress={onBack} tokens={tokens} />
        {right}
      </View> : null}
      <Text accessibilityRole="header" style={[styles.screenTitle, { color: tokens.text }]}>{title}</Text>
    </View>
  );
}

function HomeScreen({ entries, tokens, loading, error, onRetry, onOpenSchedule }: { entries: ScheduleEntry[]; tokens: ThemeTokens; loading: boolean; error: string | null; onRetry: () => void; onOpenSchedule: () => void }) {
  const now = useCurrentTime();
  const { today, remaining, next, ongoing } = todayAgenda(entries, now);
  const emptyTitle = !entries.length ? 'Aún no hay clases' : today.length ? 'Clases terminadas' : 'Día libre';
  const emptyBody = !entries.length ? 'Añade una clase para verla aquí.' : today.length ? 'No quedan clases pendientes hoy.' : 'No hay clases programadas hoy.';
  const emptyIcon: IconName = !entries.length ? 'calendar-outline' : today.length ? 'checkmark-circle-outline' : 'calendar-clear-outline';

  return (
    <ScrollView contentContainerStyle={[styles.scrollContent, styles.homeContent]} showsVerticalScrollIndicator={false}>
      <View style={styles.homeIntro}>
        <Text accessibilityRole="header" style={[styles.heroTitle, { color: tokens.text }]}>Hoy</Text>
        <Text style={[styles.todayDate, { color: tokens.secondary }]}>{capitalize(new Intl.DateTimeFormat('es-PE', { weekday: 'long', day: 'numeric', month: 'long' }).format(now))}</Text>
      </View>

      <View style={[styles.todayCard, { backgroundColor: tokens.surface, borderColor: tokens.border }]}>
        {loading || error ? (
          <View style={[styles.statePanel, { backgroundColor: tokens.surface, borderColor: tokens.border }]} accessibilityLiveRegion={error ? 'assertive' : 'polite'}>
            <Text style={[styles.stateTitle, { color: tokens.text }]}>{loading ? 'Cargando tu horario' : 'No pudimos abrir el horario'}</Text>
            {error ? <Text style={[styles.stateBody, { color: tokens.secondary }]}>{error}</Text> : null}
            {error ? <Pressable onPress={onRetry} accessibilityRole="button" accessibilityLabel="Intentar cargar de nuevo" style={({ pressed }) => [styles.textAction, pressed && styles.pressed]}><Text style={[styles.textActionText, { color: tokens.slate }]}>Reintentar</Text></Pressable> : null}
          </View>
        ) : <View style={styles.todayFocus}>
          {next ? (
            <View style={styles.focusHeaderRow}>
              <View style={[styles.statusPill, { backgroundColor: ongoing ? tokens.blueSoft : tokens.slateSoft }]}>
                <View style={[styles.statusPillDot, { backgroundColor: ongoing ? tokens.blue : tokens.slate }]} />
                <Text style={[styles.statusPillText, { color: ongoing ? tokens.blue : tokens.slate }]}>
                  {ongoing ? 'En curso' : 'A continuación'}
                </Text>
              </View>
              {ongoing ? (
                <Text style={[styles.progressPercentText, { color: tokens.blue }]}>
                  {Math.round(Math.min(1, Math.max(0, (now.getHours() * 60 + now.getMinutes() - minutesFromTime(next.start)) / (minutesFromTime(next.end) - minutesFromTime(next.start)))) * 100)}%
                </Text>
              ) : null}
            </View>
          ) : null}
          {next ? <>
            <Text style={[styles.todayTime, { color: tokens.text }]}>{formatScheduleTime(next.start)}</Text>
            <Text style={[styles.todayTitle, { color: tokens.text }]}>{next.title}</Text>
            <Text style={[styles.todayMeta, { color: tokens.secondary }]}>{[`${formatScheduleTime(next.start)} a ${formatScheduleTime(next.end)}`, next.location].filter(Boolean).join(' · ')}</Text>
            {ongoing ? (
              <View style={[styles.ongoingProgressTrack, { backgroundColor: tokens.mode === 'dark' ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.06)' }]}>
                <View style={[styles.ongoingProgressBar, { width: `${Math.min(100, Math.max(0, ((now.getHours() * 60 + now.getMinutes() - minutesFromTime(next.start)) / (minutesFromTime(next.end) - minutesFromTime(next.start))) * 100))}%`, backgroundColor: tokens.blue }]} />
              </View>
            ) : null}
          </> : <View style={[styles.emptyPreview, { backgroundColor: tokens.slateSoft }]}>
            <Icon name={emptyIcon} color={tokens.slate} size={22} />
            <View style={styles.emptyPreviewCopy}>
              <Text style={[styles.emptyPreviewTitle, { color: tokens.text }]}>{emptyTitle}</Text>
              <Text style={[styles.emptyPreviewBody, { color: tokens.secondary }]}>{emptyBody}</Text>
            </View>
          </View>}
          <GlassButton label="Abrir horario" onPress={onOpenSchedule} tokens={tokens} />
        </View>}
      </View>

      {!loading && !error && remaining.length > 1 ? <View style={styles.homeRemaining}>
        <Text accessibilityRole="header" style={[styles.sectionLabel, { color: tokens.secondary }]}>Después</Text>
        <View style={[styles.agendaGroup, { backgroundColor: tokens.surface }]}>
          {remaining.slice(1).map((entry) => <AgendaContent key={entry.id} entry={entry} tokens={tokens} />)}
        </View>
      </View> : null}

    </ScrollView>
  );
}

function DownloaderScreen({ tokens, onBack }: { tokens: ThemeTokens; onBack: () => void }) {
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
  const actionIcon = phase === 'ready' ? 'arrow-down-outline' : 'search-outline';
  const videoCountLabel = analysis ? `${analysis.videoCount} ${analysis.videoCount === 1 ? 'video disponible' : 'videos disponibles'}` : null;

  return (
    <View style={[styles.screen, { backgroundColor: tokens.background }]}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <ScreenHeader title="Downloader" tokens={tokens} onBack={onBack} />
        <View style={[styles.downloaderSurface, { backgroundColor: tokens.surface, borderColor: tokens.border }]}>
          <Text style={[styles.fieldLabel, { color: tokens.text }]}>Enlace</Text>
          <View style={styles.downloaderLinkRow}>
            {source ? <SourceBadge source={source} tokens={tokens} /> : null}
            <TextInput value={url} editable={!isBusy} onChangeText={updateUrl} onSubmitEditing={() => { if (phase === 'idle') void analyze(); }} placeholder="https://…" placeholderTextColor={tokens.muted} keyboardType="url" autoCapitalize="none" autoCorrect={false} returnKeyType="go" accessibilityLabel="Enlace del audio o video" style={[styles.downloaderInputInline, { backgroundColor: tokens.background, borderColor: tokens.borderStrong, color: tokens.text }]} />
            <IconButton label={phase === 'ready' ? 'Descargar' : 'Analizar enlace'} icon={actionIcon} onPress={() => void (phase === 'ready' ? download() : analyze())} tokens={tokens} disabled={isBusy || !url.trim()} accessibilityHint={phase === 'ready' ? 'Descarga el recurso con el formato elegido' : 'Busca la información del enlace'} />
          </View>
          {isBusy ? <View style={styles.downloaderLoading} accessibilityLiveRegion="polite"><ActivityIndicator color={tokens.blue} accessibilityLabel={actionLabel} /><Text style={[styles.downloaderLoadingText, { color: tokens.secondary }]}>{actionLabel}</Text></View> : null}

          {analysis ? (
            <View style={[styles.downloaderResult, { backgroundColor: tokens.surfaceRaised, borderColor: tokens.border }]} accessibilityLiveRegion="polite">
              <View style={styles.downloaderResultHeader}>
                {source ? <SourceBadge source={source} tokens={tokens} /> : <Icon name="checkmark-circle" color={tokens.blue} size={22} />}
                <View style={styles.downloaderResultCopy}>
                  <Text style={[styles.downloaderResultTitle, { color: tokens.text }]}>{analysis.title}</Text>
                  {source ? <Text style={[styles.downloaderResultMeta, { color: tokens.secondary }]}>{source.label}</Text> : null}
                </View>
              </View>
              <View style={styles.downloaderResultCopy}>
                {analysis.uploader ? <Text style={[styles.downloaderResultMeta, { color: tokens.secondary }]}>Usuario: {analysis.uploader}</Text> : null}
                {formatDuration(analysis.durationSeconds) ? <Text style={[styles.downloaderResultMeta, { color: tokens.secondary }]}>Duración: {formatDuration(analysis.durationSeconds)}</Text> : null}
                {analysis.description ? <Text style={[styles.downloaderDescription, { color: tokens.secondary }]}>{analysis.description}</Text> : null}
              </View>
            </View>
          ) : null}

          {analysis ? <>
          <Text style={[styles.fieldLabel, styles.downloaderFormatLabel, { color: tokens.text }]}>Videos</Text>
          <Text style={[styles.downloaderResultMeta, { color: tokens.secondary }]}>{videoCountLabel}</Text>
          {analysis.videos.length > 1 ? <select aria-label="Video" disabled={isBusy} value={selectedVideoId} onChange={(event) => setSelectedVideoId(event.target.value)} style={{ ...styles.downloaderSelect, backgroundColor: tokens.background, borderColor: tokens.borderStrong, color: tokens.text, colorScheme: tokens.mode }}>
            {analysis.videos.map((video) => <option key={video.id} value={video.id}>{video.title}</option>)}
          </select> : null}
          <Text style={[styles.fieldLabel, styles.downloaderFormatLabel, { color: tokens.text }]}>Formato</Text>
          <View style={[styles.downloaderModeRow, { backgroundColor: tokens.background, borderColor: tokens.borderStrong }]} accessibilityRole="tablist" accessibilityLabel="Formato">
            {([['video', 'Video'], ['audio', 'Audio']] as Array<[DownloadMode, string]>).map(([key, label]) => {
              const selected = key === mode;
              return <Pressable key={key} disabled={isBusy} onPress={() => { setMode(key); setStatus(null); }} accessibilityRole="tab" accessibilityLabel={label} aria-selected={selected} style={({ pressed }) => [styles.downloaderMode, selected && { backgroundColor: tokens.surfaceRaised, borderColor: tokens.border }, pressed && styles.pressed]}><Icon name={key === 'video' ? 'videocam-outline' : 'musical-notes-outline'} color={selected ? tokens.text : tokens.secondary} size={18} /><Text style={[styles.downloaderModeText, { color: selected ? tokens.text : tokens.secondary }]}>{label}</Text></Pressable>;
            })}
          </View>
          {mode === 'video' && analysis.qualities.length > 0 ? <>
            <Text style={[styles.fieldLabel, styles.downloaderFormatLabel, { color: tokens.text }]}>Calidad</Text>
            <select aria-label="Calidad" disabled={isBusy} value={qualityHeight ?? analysis.qualities[0].height} onChange={(event) => setQualityHeight(Number(event.target.value))} style={{ ...styles.downloaderSelect, backgroundColor: tokens.background, borderColor: tokens.borderStrong, color: tokens.text, colorScheme: tokens.mode }}>
              {analysis.qualities.map((quality) => <option key={quality.id} value={quality.height}>{quality.label}</option>)}
            </select>
          </> : null}
          </> : null}
        </View>
        {status ? (
          <View style={styles.statusRow} accessibilityLiveRegion="polite">
            <Icon name={status.kind === 'error' ? 'alert-circle-outline' : 'checkmark-circle-outline'} color={status.kind === 'error' ? tokens.danger : tokens.blue} size={18} />
            <Text style={[styles.downloaderStatus, { color: status.kind === 'error' ? tokens.danger : tokens.blue }]}>{status.text}</Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function MiniAppsScreen({ entries, tokens, loading, error, onRetry, onOpenSchedule, onOpenDownloader, onClearSchedule }: { entries: ScheduleEntry[]; tokens: ThemeTokens; loading: boolean; error: string | null; onRetry: () => void; onOpenSchedule: () => void; onOpenDownloader: () => void; onClearSchedule: () => void }) {
  const requestClear = () => confirmAction('Borrar horario', 'Se eliminarán todas las clases guardadas en este dispositivo.', 'Borrar todo', onClearSchedule);

  return (
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <ScreenHeader title="Miniapps" tokens={tokens} />
      {loading || error ? (
        <View style={[styles.statePanel, { backgroundColor: tokens.surface, borderColor: tokens.border }]} accessibilityLiveRegion={error ? 'assertive' : 'polite'}>
          <Text style={[styles.stateTitle, { color: tokens.text }]}>{loading ? 'Cargando' : 'No pudimos abrir el horario'}</Text>
          {error ? <Text style={[styles.stateBody, { color: tokens.secondary }]}>{error}</Text> : null}
          {error ? <Pressable onPress={onRetry} accessibilityRole="button" accessibilityLabel="Intentar cargar de nuevo" style={({ pressed }) => [styles.textAction, pressed && styles.pressed]}><Text style={[styles.textActionText, { color: tokens.slate }]}>Reintentar</Text></Pressable> : null}
        </View>
      ) : null}
        <>
          <Text style={[styles.sectionLabel, { color: tokens.secondary }]}>Biblioteca</Text>
          <View style={[styles.miniAppList, { backgroundColor: tokens.surface, borderColor: tokens.border }]}>
            <MiniAppRow
              title="Horario"
              detail={loading ? 'Cargando…' : error ? 'No disponible' : entries.length ? `${entries.length} ${entries.length === 1 ? 'clase guardada' : 'clases guardadas'}` : 'Sin clases guardadas'}
              icon="calendar"
              iconColor={tokens.slate}
              iconBackground={tokens.slateSoft}
              tokens={tokens}
              onPress={onOpenSchedule}
              onLongPress={!loading && !error && entries.length ? requestClear : undefined}
              accessibilityLabel="Abrir Miniapp Horario"
              accessibilityHint={entries.length ? 'Mantén pulsado para borrar el horario' : undefined}
            />
            <View style={[styles.miniAppDivider, { backgroundColor: tokens.border }]} />
            <MiniAppRow
              title="Downloader"
              detail="Audio y video"
              icon="arrow-down-circle"
              iconColor={tokens.blue}
              iconBackground={tokens.blueSoft}
              tokens={tokens}
              onPress={onOpenDownloader}
              accessibilityLabel="Abrir Miniapp Downloader"
            />
          </View>
        </>

    </ScrollView>
  );
}

function MiniAppRow({ title, detail, icon, iconColor, iconBackground, tokens, onPress, onLongPress, accessibilityLabel, accessibilityHint }: { title: string; detail: string; icon: IconName; iconColor: string; iconBackground: string; tokens: ThemeTokens; onPress: () => void; onLongPress?: () => void; accessibilityLabel: string; accessibilityHint?: string }) {
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} delayLongPress={500} accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityHint={accessibilityHint} style={({ pressed }) => [styles.miniAppRowPressable, pressed && styles.pressed]}>
      <View style={styles.miniAppRow}>
        <View style={[styles.miniAppRowIcon, { backgroundColor: iconBackground }]}>
          <Icon name={icon} color={iconColor} size={22} />
        </View>
        <View style={styles.miniAppRowCopy}>
          <Text style={[styles.miniAppRowTitle, { color: tokens.text }]}>{title}</Text>
          <Text style={[styles.miniAppRowDetail, { color: tokens.secondary }]}>{detail}</Text>
        </View>
        <Icon name="chevron-forward" color={tokens.secondary} size={18} />
      </View>
    </Pressable>
  );
}

function SettingsScreen({ themeMode, tokens, onThemeChange, apiKey, onApiKeyChange }: { themeMode: ThemeMode; tokens: ThemeTokens; onThemeChange: (mode: ThemeMode) => void; apiKey: string; onApiKeyChange: (key: string) => void }) {
  return (
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <ScreenHeader title="Ajustes" tokens={tokens} />

      <View style={[styles.settingsSection, { backgroundColor: tokens.surface, borderColor: tokens.border }]}>
        <Text style={[styles.settingTitle, { color: tokens.secondary }]}>Tema</Text>
        <View style={styles.themeOptions} accessibilityRole="radiogroup" accessibilityLabel="Tema">
          {(['system', 'light', 'dark'] as ThemeMode[]).map((mode) => {
            const labels: Record<ThemeMode, string> = { system: 'Sistema', light: 'Claro', dark: 'Oscuro' };
            const isSelected = themeMode === mode;
            return (
              <Pressable key={mode} onPress={() => onThemeChange(mode)} accessibilityRole="radio" accessibilityLabel={`Tema ${labels[mode]}`} aria-checked={isSelected} style={({ pressed }) => [styles.themeOption, { borderColor: tokens.border }, pressed && styles.pressed]}>
                <Icon name={mode === 'system' ? 'phone-portrait-outline' : mode === 'light' ? 'sunny-outline' : 'moon-outline'} color={tokens.secondary} size={22} />
                <Text style={[styles.themeOptionText, { color: tokens.text }]}>{labels[mode]}</Text>
                {isSelected ? <Icon name="checkmark" color={tokens.blue} size={22} /> : null}
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={[styles.settingsSection, { backgroundColor: tokens.surface, borderColor: tokens.border }]}>
        <Text style={[styles.settingTitle, { color: tokens.secondary }]}>Inteligencia Artificial</Text>
        <Text style={{ fontSize: 13, lineHeight: 18, color: tokens.muted, marginTop: 4, marginBottom: 12 }}>
          Clave gratuita de Google Gemini (aistudio.google.com) para escanear y generar horarios desde fotos o capturas.
        </Text>
        <TextInput
          value={apiKey}
          onChangeText={onApiKeyChange}
          placeholder="Pega tu clave AIzaSy…"
          placeholderTextColor={tokens.muted}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          style={{
            backgroundColor: tokens.background,
            color: tokens.text,
            paddingHorizontal: 12,
            paddingVertical: 10,
            borderRadius: 10,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: tokens.border,
            fontSize: 15,
          }}
        />
        {apiKey ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}>
            <Icon name="checkmark-circle" color={tokens.sage} size={16} />
            <Text style={{ fontSize: 13, color: tokens.sage, fontWeight: '600' }}>Clave configurada</Text>
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

function SegmentedControl({ value, onChange, tokens }: { value: ScheduleView; onChange: (value: ScheduleView) => void; tokens: ThemeTokens }) {
  return (
    <View style={[styles.segmented, { backgroundColor: tokens.controlTrack }]} accessibilityRole="tablist" accessibilityLabel="Vista del horario">
      {([
        ['day', 'Hoy'],
        ['week', 'Semana'],
      ] as Array<[ScheduleView, string]>).map(([key, label]) => {
        const selected = value === key;
        return (
            <Pressable key={key} onPress={() => onChange(key)} accessibilityRole="tab" accessibilityLabel={`Vista ${label}`} aria-selected={selected} style={({ pressed }) => [styles.segmentedOption, selected && { backgroundColor: tokens.surfaceRaised }, pressed && styles.pressed]}>
            <Text style={[styles.segmentedText, { color: selected ? tokens.text : tokens.secondary }]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function DayPicker({ selectedDay, onChange, tokens, disabled = false }: { selectedDay: DayIndex; onChange: (day: DayIndex) => void; tokens: ThemeTokens; disabled?: boolean }) {
  if (Platform.OS === 'web') return <View style={[styles.daySelectRow, { backgroundColor: tokens.surface }]}>
    <Text style={{ color: tokens.text, fontSize: 17 }}>Día</Text>
    <select aria-label="Día del horario" disabled={disabled} value={selectedDay} onChange={(event) => onChange(Number(event.target.value) as DayIndex)} style={{ color: tokens.blue, background: tokens.surface, border: 0, font: 'inherit', fontSize: 17, minHeight: 44, maxWidth: '70%', padding: 8, cursor: 'pointer', colorScheme: tokens.mode }}>
      {DAYS.map((day) => <option key={day.index} value={day.index}>{day.long}</option>)}
    </select>
  </View>;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayPicker}>
      {DAYS.map((day) => {
        const selected = day.index === selectedDay;
        return (
          <Pressable key={day.index} onPress={() => onChange(day.index)} accessibilityRole="button" accessibilityLabel={`Ver ${day.long}`} aria-pressed={selected} style={({ pressed }) => [styles.dayButton, { borderColor: selected ? tokens.blue : tokens.borderStrong, backgroundColor: selected ? tokens.blue : tokens.surface }, pressed && styles.pressed]}>
            <Text style={[styles.dayButtonText, { color: selected ? tokens.inverseText : tokens.secondary }]}>{day.short}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function ScheduleEntryRow({ entry, tokens, onPress }: { entry: ScheduleEntry; tokens: ThemeTokens; onPress: () => void }) {
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Editar ${entry.title}, de ${formatScheduleTime(entry.start)} a ${formatScheduleTime(entry.end)}${entry.location ? `, ${entry.location}` : ''}`} style={({ pressed }) => pressed && styles.pressed}>
    <AgendaContent entry={entry} tokens={tokens} />
  </Pressable>;
}

function AgendaContent({ entry, tokens }: { entry: ScheduleEntry; tokens: ThemeTokens }) {
  const entryColor = colorForEntry(entry, tokens);
  const { width, fontScale } = useWindowDimensions();
  return (
    <View style={[styles.scheduleRow, { borderColor: tokens.border }, (width < 350 || fontScale >= 1.3) && styles.agendaStacked]}>
      <View style={styles.timeColumn}>
        <Text style={[styles.timeText, { color: tokens.text }]}>{formatScheduleTime(entry.start)}</Text>
        <Text style={[styles.endTimeText, { color: tokens.muted }]}>{formatScheduleTime(entry.end)}</Text>
      </View>
      <View style={styles.scheduleCard}>
        <View style={[styles.scheduleColorDot, { backgroundColor: entryColor.main }]} />
        <View style={styles.scheduleCardCopy}>
          <Text style={[styles.scheduleTitle, { color: tokens.text }]}>{entry.title}</Text>
          {entry.location ? (
            <View style={styles.metaRow}>
              <Icon name="location-outline" color={tokens.secondary} size={15} />
              <Text style={[styles.metaText, { color: tokens.secondary }]}>{entry.location}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function DayAgenda({ selectedDay, entries, tokens, onEdit, onScanAI, isScanningAI }: { selectedDay: DayIndex; entries: ScheduleEntry[]; tokens: ThemeTokens; onEdit: (entry: ScheduleEntry) => void; onScanAI?: () => void; isScanningAI?: boolean }) {
  const dayEntries = sortedEntries(entries.filter((entry) => entry.day === selectedDay));

  if (dayEntries.length === 0) {
    return (
      <View style={styles.emptyState}>
        <View style={[styles.emptyStateIcon, { backgroundColor: tokens.slateSoft }]}>
          <Icon name="calendar-clear-outline" color={tokens.slate} size={28} />
        </View>
        <Text style={[styles.emptyStateTitle, { color: tokens.text }]}>{entries.length === 0 ? 'Sin clases' : 'Día libre'}</Text>
        {entries.length === 0 && onScanAI ? (
          <Pressable
            onPress={onScanAI}
            accessibilityRole="button"
            accessibilityLabel="Escanear horario"
            style={({ pressed }) => [styles.solidAction, { backgroundColor: tokens.blue }, pressed && styles.pressed]}>
            <Icon name="sparkles" color={tokens.inverseText} size={18} />
            <Text style={[styles.solidActionText, { color: tokens.inverseText }]}>
              {isScanningAI ? 'Escaneando...' : 'Escanear horario'}
            </Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.agendaList}>
      <Text style={[styles.sectionLabel, { color: tokens.secondary }]}>{dayEntries.length} {dayEntries.length === 1 ? 'clase' : 'clases'}</Text>
      <View style={[styles.agendaGroup, { backgroundColor: tokens.surface }]}>
        {dayEntries.map((entry) => <ScheduleEntryRow key={entry.id} entry={entry} tokens={tokens} onPress={() => onEdit(entry)} />)}
      </View>
    </View>
  );
}

function WeekOverview({ entries, tokens, onEdit, onScanAI, isScanningAI }: { entries: ScheduleEntry[]; tokens: ThemeTokens; onEdit: (entry: ScheduleEntry) => void; onScanAI?: () => void; isScanningAI?: boolean }) {
  const visibleDays = DAYS.filter((day) => entries.some((entry) => entry.day === day.index));
  if (visibleDays.length === 0) {
    return <View style={styles.emptyState}>
      <View style={[styles.emptyStateIcon, { backgroundColor: tokens.slateSoft }]}>
        <Icon name="calendar-outline" color={tokens.slate} size={28} />
      </View>
      <Text style={[styles.emptyStateTitle, { color: tokens.text }]}>Sin clases</Text>
      {onScanAI ? (
        <Pressable
          onPress={onScanAI}
          accessibilityRole="button"
          accessibilityLabel="Escanear horario"
          style={({ pressed }) => [styles.solidAction, { backgroundColor: tokens.blue }, pressed && styles.pressed]}>
          <Icon name="sparkles" color={tokens.inverseText} size={18} />
          <Text style={[styles.solidActionText, { color: tokens.inverseText }]}>
            {isScanningAI ? 'Escaneando...' : 'Escanear horario'}
          </Text>
        </Pressable>
      ) : null}
    </View>;
  }
  return (
    <View style={styles.weekList}>
      {visibleDays.map((day) => {
        const dayEntries = sortedEntries(entries.filter((entry) => entry.day === day.index));
        return (
          <View key={day.index}>
            <Text accessibilityRole="header" style={[styles.sectionLabel, { color: tokens.secondary }]}>{day.long}</Text>
            <View style={[styles.agendaGroup, { backgroundColor: tokens.surface }]}>
              {dayEntries.map((entry) => <ScheduleEntryRow key={entry.id} entry={entry} tokens={tokens} onPress={() => onEdit(entry)} />)}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function ScheduleScreen({
  entries,
  tokens,
  selectedDay,
  onCreate,
  onScanAI,
  isScanningAI,
  onEdit,
  onBack,
  loading,
  error,
  onRetry,
  view,
  setView,
}: {
  entries: ScheduleEntry[];
  tokens: ThemeTokens;
  selectedDay: DayIndex;
  onCreate: () => void;
  onScanAI?: () => void;
  isScanningAI?: boolean;
  onEdit: (entry: ScheduleEntry) => void;
  onBack: () => void;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  view: ScheduleView;
  setView: (view: ScheduleView) => void;
}) {

  return (
    <View style={[styles.screen, { backgroundColor: tokens.background }]}>
      <ScrollView contentContainerStyle={[styles.scrollContent, styles.scheduleContent]} showsVerticalScrollIndicator={false}>
        <ScreenHeader
          title="Horario"
          tokens={tokens}
          onBack={onBack}
          right={
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {onScanAI ? (
                <IconButton
                  label={isScanningAI ? 'Escaneando...' : 'Escanear horario'}
                  icon={isScanningAI ? 'sync-outline' : 'sparkles'}
                  onPress={onScanAI}
                  tokens={tokens}
                  disabled={loading || Boolean(error) || isScanningAI}
                />
              ) : null}
              <IconButton label="Añadir clase" icon="add" onPress={onCreate} tokens={tokens} disabled={loading || Boolean(error)} />
            </View>
          }
        />
        <SegmentedControl value={view} onChange={setView} tokens={tokens} />
        {loading ? (
          <View style={[styles.statePanel, { backgroundColor: tokens.surface, borderColor: tokens.border }]} accessibilityLiveRegion="polite">
            <Icon name="time-outline" color={tokens.slate} size={24} />
            <Text style={[styles.stateTitle, { color: tokens.text }]}>Cargando tu horario</Text>
          </View>
        ) : error ? (
          <View style={[styles.statePanel, { backgroundColor: tokens.surface, borderColor: tokens.border }]} accessibilityLiveRegion="assertive">
            <Icon name="alert-circle-outline" color={tokens.danger} size={25} />
            <Text style={[styles.stateTitle, { color: tokens.text }]}>No pudimos abrir el horario</Text>
            <Text style={[styles.stateBody, { color: tokens.secondary }]}>{error}</Text>
            <Pressable onPress={onRetry} accessibilityRole="button" accessibilityLabel="Intentar cargar de nuevo" style={({ pressed }) => [styles.textAction, pressed && styles.pressed]}>
              <Text style={[styles.textActionText, { color: tokens.slate }]}>Intentar de nuevo</Text>
            </Pressable>
          </View>
        ) : view === 'day' ? (
          <>
            <DayAgenda selectedDay={selectedDay} entries={entries} tokens={tokens} onEdit={onEdit} onScanAI={onScanAI} isScanningAI={isScanningAI} />
          </>
        ) : (
          <WeekOverview entries={entries} tokens={tokens} onEdit={onEdit} onScanAI={onScanAI} isScanningAI={isScanningAI} />
        )}
      </ScrollView>
    </View>
  );
}

function ScheduleEditor({ visible, entry, defaultDay, tokens, onClose, onSave, onDelete }: { visible: boolean; entry: ScheduleEntry | null; defaultDay: DayIndex; tokens: ThemeTokens; onClose: () => void; onSave: (entry: ScheduleEntry) => Promise<string | null>; onDelete: (id: string) => void }) {
  const insets = useSafeAreaInsets();
  const { width, fontScale } = useWindowDimensions();
  const stackTimeFields = width < 420 || fontScale > 1.2;
  const titleInput = useRef<TextInput>(null);
  const locationInput = useRef<TextInput>(null);
  const [title, setTitle] = useState('');
  const [day, setDay] = useState<DayIndex>(defaultDay);
  const [start, setStart] = useState('08:00');
  const [end, setEnd] = useState('09:00');
  const [location, setLocation] = useState('');
  const [color, setColor] = useState<ScheduleColor>('slate');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [reduceMotion, setReduceMotion] = useState(true);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => listener.remove();
  }, []);
  const dirty = title !== (entry?.title ?? '') || day !== (entry?.day ?? defaultDay) || start !== (entry?.start ?? '08:00') || end !== (entry?.end ?? '09:00') || location !== (entry?.location ?? '') || color !== (entry?.color ?? 'slate');
  const requestClose = () => {
    if (savingRef.current) return;
    if (!dirty) return onClose();
    confirmAction('¿Descartar cambios?', 'Los cambios de esta clase no se han guardado.', 'Descartar cambios', onClose);
  };

  useEffect(() => {
    if (!visible) return;
    setTitle(entry?.title ?? '');
    setDay(entry?.day ?? defaultDay);
    setStart(entry?.start ?? '08:00');
    setEnd(entry?.end ?? '09:00');
    setLocation(entry?.location ?? '');
    setColor(entry?.color ?? 'slate');
    setValidationError(null);
    setSaving(false);
  }, [visible, entry, defaultDay]);

  const save = async () => {
    if (savingRef.current) return;
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setValidationError('Escribe el nombre de la clase.');
      return;
    }
    if (!isValidTime(start) || !isValidTime(end)) {
      setValidationError('Usa el formato HH:MM, por ejemplo 08:30.');
      return;
    }
    if (minutesFromTime(end) <= minutesFromTime(start)) {
      setValidationError('La hora de término debe ser posterior a la de inicio.');
      return;
    }
    savingRef.current = true;
    setSaving(true);
    const error = await onSave({ id: entry?.id ?? makeId(), title: cleanTitle, day, start, end, location: location.trim(), color });
    savingRef.current = false;
    setSaving(false);
    if (error) setValidationError(error);
  };

  return (
    <Modal visible={visible} animationType={reduceMotion ? 'none' : 'slide'} presentationStyle="pageSheet" onShow={() => titleInput.current?.focus()} onRequestClose={requestClose}>
      <View role="dialog" aria-modal accessibilityLabel={entry ? 'Editar clase' : 'Nueva clase'} style={[styles.modalRoot, { backgroundColor: tokens.background }]}>
        <KeyboardAvoidingView style={styles.modalKeyboard} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={[styles.editorHeader, { paddingTop: Math.max(insets.top, UI.sheetActionInset) }]}>
                <IconButton disabled={saving} label="Cerrar editor" icon="close" onPress={requestClose} tokens={tokens} tintColor={tokens.surface} iconColor={tokens.text} />
                <Text accessibilityRole="header" style={[styles.editorHeading, { color: tokens.text }]}>{entry ? 'Editar clase' : 'Nueva clase'}</Text>
                <IconButton disabled={saving} label={saving ? 'Guardando' : 'Guardar'} icon="checkmark" onPress={save} tokens={tokens} />
            </View>
          <ScrollView contentContainerStyle={[styles.editorContent, { paddingBottom: Math.max(insets.bottom, 24) }]} keyboardShouldPersistTaps="handled">
            <Text style={[styles.sectionLabel, { color: tokens.secondary }]}>Clase</Text>
            <View style={[styles.editorGroup, { backgroundColor: tokens.surface }]}>
              <Text style={[styles.fieldLabel, { color: tokens.text }]}>Nombre</Text>
              <TextInput ref={titleInput} editable={!saving} aria-invalid={Boolean(validationError && !title.trim())} value={title} onChangeText={setTitle} placeholder="Ej. Matemáticas" placeholderTextColor={tokens.muted} accessibilityLabel="Nombre de la clase" style={[styles.textInput, { backgroundColor: tokens.surface, borderColor: validationError && !title.trim() ? tokens.danger : tokens.borderStrong, color: tokens.text }]} returnKeyType="next" onSubmitEditing={() => locationInput.current?.focus()} />
            </View>

            <Text style={[styles.sectionLabel, { color: tokens.secondary }]}>Horario</Text>
            <View style={[styles.editorGroup, { backgroundColor: tokens.surface }]}>
            {Platform.OS === 'web' ? <DayPicker selectedDay={day} onChange={setDay} tokens={tokens} disabled={saving} /> : <>
              <Text style={[styles.fieldLabel, { color: tokens.text }]}>Día</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.editorDayPicker}>
                {DAYS.map((item) => {
                  const selected = item.index === day;
                  return (
                      <Pressable key={item.index} disabled={saving} onPress={() => setDay(item.index)} accessibilityRole="radio" accessibilityLabel={`Día ${item.long}`} aria-checked={selected} style={({ pressed }) => [styles.editorDay, { backgroundColor: selected ? tokens.blue : tokens.surface, borderColor: selected ? tokens.blue : tokens.borderStrong }, pressed && styles.pressed]}>
                      <Text style={[styles.editorDayText, { color: selected ? tokens.inverseText : tokens.secondary }]}>{selected ? '✓ ' : ''}{item.short}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </>}

            <View style={[styles.timeFieldsRow, stackTimeFields && styles.timeFieldsRowStacked]}>
              <View style={styles.timeField}>
                <Text style={[styles.fieldLabel, { color: tokens.text }]}>Empieza</Text>
                <TextInput editable={!saving} value={start} onChangeText={setStart} placeholder="08:00" placeholderTextColor={tokens.muted} keyboardType="numbers-and-punctuation" accessibilityLabel="Hora de inicio" style={[styles.textInput, { backgroundColor: tokens.surface, borderColor: tokens.borderStrong, color: tokens.text }]} />
              </View>
              <View style={styles.timeField}>
                <Text style={[styles.fieldLabel, { color: tokens.text }]}>Termina</Text>
                <TextInput editable={!saving} value={end} onChangeText={setEnd} placeholder="09:00" placeholderTextColor={tokens.muted} keyboardType="numbers-and-punctuation" accessibilityLabel="Hora de término" style={[styles.textInput, { backgroundColor: tokens.surface, borderColor: tokens.borderStrong, color: tokens.text }]} />
              </View>
            </View>
            </View>

            <Text style={[styles.sectionLabel, { color: tokens.secondary }]}>Detalles</Text>
            <View style={[styles.editorGroup, { backgroundColor: tokens.surface }]}>
              <Text style={[styles.fieldLabel, { color: tokens.text }]}>Lugar <Text style={{ color: tokens.muted, fontWeight: '400' }}>(opcional)</Text></Text>
                <TextInput ref={locationInput} editable={!saving} value={location} onChangeText={setLocation} placeholder="Ej. Aula 203" placeholderTextColor={tokens.muted} accessibilityLabel="Lugar de la clase" style={[styles.textInput, { backgroundColor: tokens.surface, borderColor: tokens.borderStrong, color: tokens.text }]} returnKeyType="done" onSubmitEditing={() => locationInput.current?.blur()} />

            <View style={{ marginTop: 20 }}>
              <Text style={[styles.fieldLabel, { color: tokens.text }]}>Color</Text>
              <View style={styles.colorOptions}>
                {COLORS.map((item) => {
                  const selected = color === item.key;
                  const swatch = colorForKey(item.key, tokens).main;
                  return (
                    <Pressable key={item.key} disabled={saving} onPress={() => setColor(item.key)} accessibilityRole="radio" accessibilityLabel={`Color ${item.label}`} aria-checked={selected} style={({ pressed }) => [styles.colorOption, { borderColor: tokens.border, backgroundColor: tokens.surface }, pressed && styles.pressed]}>
                      {selected ? <Icon name="checkmark" color={tokens.text} size={16} /> : <View style={[styles.colorSwatch, { backgroundColor: swatch }]} />}
                      <Text style={[styles.colorOptionText, { color: tokens.text }]}>{item.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            </View>

            {validationError ? (
              <View style={[styles.validationBox, { backgroundColor: tokens.surfaceRaised, borderColor: tokens.danger }]} accessibilityLiveRegion="assertive">
                <Icon name="alert-circle-outline" color={tokens.danger} size={18} />
                <Text style={[styles.validationText, { color: tokens.danger }]}>{validationError}</Text>
              </View>
            ) : null}

            {entry ? (
              <Pressable disabled={saving} onPress={() => onDelete(entry.id)} accessibilityRole="button" accessibilityLabel="Eliminar esta clase" style={({ pressed }) => [styles.deleteButton, pressed && styles.pressed]}>
                <Icon name="trash-outline" color={tokens.danger} size={18} />
                <Text style={[styles.deleteButtonText, { color: tokens.danger }]}>Eliminar clase</Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function AIScanReviewModal({
  visible,
  scanned,
  tokens,
  onImport,
  onClose,
}: {
  visible: boolean;
  scanned: ScheduleEntry[] | null;
  tokens: ThemeTokens;
  onImport: (entries: ScheduleEntry[]) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [revealedCount, setRevealedCount] = useState(0);
  const [processedIndex, setProcessedIndex] = useState(-1);
  const [isImporting, setIsImporting] = useState(false);

  useEffect(() => {
    if (!visible || !scanned || scanned.length === 0) {
      setRevealedCount(0);
      setProcessedIndex(-1);
      setIsImporting(false);
      return;
    }

    setRevealedCount(0);
    setProcessedIndex(-1);
    setIsImporting(false);

    let current = 0;
    const interval = setInterval(() => {
      current++;
      setRevealedCount(current);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (current >= scanned.length) {
        clearInterval(interval);
      }
    }, 70);

    return () => clearInterval(interval);
  }, [visible, scanned]);

  if (!visible || !scanned) return null;

  const isDoneRevealing = revealedCount >= scanned.length;
  const visibleEntries = scanned.slice(0, revealedCount);

  const startImporting = () => {
    if (isImporting || !isDoneRevealing) return;
    setIsImporting(true);

    let current = 0;
    const interval = setInterval(() => {
      setProcessedIndex(current);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      current++;

      if (current >= scanned.length) {
        clearInterval(interval);
        setTimeout(() => {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          onImport(scanned);
        }, 350);
      }
    }, 90);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View role="dialog" aria-modal accessibilityLabel="Horario detectado" style={[styles.modalRoot, { backgroundColor: tokens.background }]}>
        <View style={[styles.editorHeader, { paddingTop: Math.max(insets.top, UI.sheetActionInset) }]}>
          <IconButton label="Cerrar" icon="close" onPress={onClose} tokens={tokens} tintColor={tokens.surface} iconColor={tokens.text} disabled={isImporting} />
          <View style={{ alignItems: 'center' }}>
            <Text accessibilityRole="header" style={[styles.editorHeading, { color: tokens.text }]}>
              Horario detectado
            </Text>
            <Text style={{ fontSize: 13, color: tokens.secondary, marginTop: 2 }}>
              {isImporting
                ? `Guardando ${processedIndex + 1} de ${scanned.length} clases…`
                : `${visibleEntries.length} de ${scanned.length} clases identificadas`}
            </Text>
          </View>
          <IconButton
            label="Importar clases"
            icon="checkmark"
            onPress={startImporting}
            tokens={tokens}
            disabled={!isDoneRevealing || isImporting}
          />
        </View>

        <ScrollView contentContainerStyle={[styles.editorContent, { paddingBottom: Math.max(insets.bottom, 24) }]} showsVerticalScrollIndicator={false}>
          <View style={{ gap: 10 }}>
            {visibleEntries.map((entry, index) => {
              const entryColor = colorForKey(entry.color, tokens);
              const isProcessed = isImporting && index <= processedIndex;

              return (
                <View
                  key={entry.id}
                  style={{
                    backgroundColor: isProcessed ? tokens.surfaceRaised : tokens.surface,
                    borderRadius: 16,
                    padding: 14,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    borderWidth: 1,
                    borderColor: isProcessed ? tokens.sage : 'transparent',
                  }}>
                  <View style={{ minWidth: 56, alignItems: 'center' }}>
                    <Text style={{ fontSize: 15, fontWeight: '700', color: tokens.blue }}>{DAYS[entry.day].short}</Text>
                    <Text style={{ fontSize: 12, color: tokens.secondary, marginTop: 2 }}>{formatScheduleTime(entry.start)}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      {isProcessed ? (
                        <Icon name="checkmark-circle" color={tokens.sage} size={16} />
                      ) : (
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: entryColor.main }} />
                      )}
                      <Text style={{ fontSize: 16, fontWeight: '600', color: tokens.text }} numberOfLines={1}>{entry.title}</Text>
                    </View>
                    <Text style={{ fontSize: 13, color: tokens.secondary, marginTop: 4 }}>
                      {[`${formatScheduleTime(entry.start)} a ${formatScheduleTime(entry.end)}`, entry.location].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function APIKeyModal({
  visible,
  tokens,
  apiKey,
  onSave,
  onClose,
}: {
  visible: boolean;
  tokens: ThemeTokens;
  apiKey: string;
  onSave: (key: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState(apiKey);

  useEffect(() => {
    if (visible) setDraft(apiKey);
  }, [visible, apiKey]);

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View role="dialog" aria-modal accessibilityLabel="Configurar clave de Gemini" style={[styles.modalRoot, { backgroundColor: tokens.background }]}>
        <View style={[styles.editorHeader, { paddingTop: Math.max(insets.top, UI.sheetActionInset) }]}>
          <IconButton label="Cancelar" icon="close" onPress={onClose} tokens={tokens} tintColor={tokens.surface} iconColor={tokens.text} />
          <Text accessibilityRole="header" style={[styles.editorHeading, { color: tokens.text }]}>API de Gemini</Text>
          <IconButton
            label="Guardar"
            icon="checkmark"
            onPress={() => {
              onSave(draft);
              onClose();
            }}
            tokens={tokens}
          />
        </View>

        <ScrollView contentContainerStyle={[styles.editorContent, { paddingBottom: Math.max(insets.bottom, 24) }]} keyboardShouldPersistTaps="handled">
          <View style={[styles.editorGroup, { backgroundColor: tokens.surface }]}>
            <Text style={[styles.fieldLabel, { color: tokens.text }]}>Clave de API (AIzaSy…)</Text>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Pega tu clave AIzaSy…"
              placeholderTextColor={tokens.muted}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.textInput, { backgroundColor: tokens.surface, borderColor: tokens.borderStrong, color: tokens.text }]}
            />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function AppContent() {
  const systemScheme = useColorScheme();
  const insets = useSafeAreaInsets();
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
  const [apiKeyModalVisible, setApiKeyModalVisible] = useState(false);
  const writePending = useRef(false);
  const ready = !loading && !storageError;
  const tokens = useMemo(() => getTokens(themeMode, systemScheme), [themeMode, systemScheme]);

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

  const handleScanAI = async () => {
    let activeKey = apiKey.trim();
    if (!activeKey) {
      activeKey = await getGeminiApiKey();
      if (!activeKey) {
        setApiKeyModalVisible(true);
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
      showError(msg);
    } finally {
      setAiScanning(false);
    }
  };

  const importScannedClasses = async (classesToImport: ScheduleEntry[]) => {
    if (!classesToImport.length) return;
    try {
      const merged = sortedEntries([...entries, ...classesToImport]);
      await persistEntries(merged);
      setScannedSchedule(null);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (Platform.OS === 'web') {
        window.alert(`Se agregaron ${classesToImport.length} clases a tu horario.`);
      } else {
        Alert.alert('Horario importado', `Se agregaron ${classesToImport.length} clases a tu horario.`);
      }
    } catch {
      showError('No se pudieron guardar las clases escaneadas.');
    }
  };

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
    const conflict = entries.find((entry) => {
      if (entry.id === nextEntry.id || entry.day !== nextEntry.day) return false;
      return minutesFromTime(nextEntry.start) < minutesFromTime(entry.end) && minutesFromTime(nextEntry.end) > minutesFromTime(entry.start);
    });
    if (conflict) return `Se cruza con “${conflict.title}”, de ${formatScheduleTime(conflict.start)} a ${formatScheduleTime(conflict.end)}.`;

    const nextEntries = sortedEntries([...entries.filter((entry) => entry.id !== nextEntry.id), nextEntry]);
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
    const entry = entries.find((item) => item.id === id);
    confirmAction('Eliminar clase', `¿Quieres eliminar “${entry?.title ?? 'esta clase'}”?`, 'Eliminar', () => {
          void (async () => {
            const nextEntries = entries.filter((item) => item.id !== id);
            try {
              await persistEntries(nextEntries);
              setEditorVisible(false);
              setEditorEntry(null);
            } catch {
              showError('No se pudo eliminar la clase. Intenta eliminarla de nuevo.');
            }
          })();
    });
  };

  const clearSchedule = () => {
    void (async () => {
      try {
        await persistEntries([]);
      } catch {
        showError('No se pudo borrar el horario. Intenta borrarlo de nuevo.');
      }
    })();
  };

  const changeTheme = (mode: ThemeMode) => {
    setThemeMode(mode);
    void AsyncStorage.setItem(THEME_KEY, mode).catch(() => showError('El tema está aplicado, pero no se pudo guardar. Vuelve a seleccionarlo para reintentar.'));
  };

  const body = destination === 'schedule' && screen === 'miniapps' ? (
    <ScheduleScreen
      entries={entries}
      tokens={tokens}
      selectedDay={selectedDay}
      onCreate={() => openEditor()}
      onScanAI={handleScanAI}
      isScanningAI={aiScanning}
      onEdit={openEditor}
      onBack={() => setDestination('library')}
      loading={loading}
      error={storageError}
      onRetry={loadData}
      view={scheduleView}
      setView={setScheduleView}
    />
  ) : destination === 'downloader' && screen === 'miniapps' ? null
  : screen === 'home' ? (
    <HomeScreen entries={entries} tokens={tokens} loading={loading} error={storageError} onRetry={loadData} onOpenSchedule={() => openSchedule(currentDayIndex())} />
  ) : screen === 'miniapps' ? (
    <MiniAppsScreen entries={entries} tokens={tokens} loading={loading} error={storageError} onRetry={loadData} onOpenSchedule={() => openSchedule()} onOpenDownloader={openDownloader} onClearSchedule={clearSchedule} />
  ) : (
    <SettingsScreen themeMode={themeMode} tokens={tokens} onThemeChange={changeTheme} apiKey={apiKey} onApiKeyChange={updateApiKey} />
  );

  return (
    <View style={[styles.appRoot, { backgroundColor: tokens.background, paddingTop: insets.top }]}>
      <StatusBar style={tokens.mode === 'dark' ? 'light' : 'dark'} />
      <View style={styles.screen} aria-hidden={editorVisible}>
      {body}
      {destination === 'downloader' ? <View style={[styles.screen, screen !== 'miniapps' && { display: 'none' }]}>
        <DownloaderScreen tokens={tokens} onBack={() => setDestination('library')} />
      </View> : null}
      <TabBar activeScreen={screen} onChange={setScreen} tokens={tokens} />
      </View>
      <ScheduleEditor visible={editorVisible} entry={editorEntry} defaultDay={selectedDay} tokens={tokens} onClose={() => setEditorVisible(false)} onSave={saveEntry} onDelete={deleteEntry} />
      <AIScanReviewModal visible={Boolean(scannedSchedule)} scanned={scannedSchedule} tokens={tokens} onImport={importScannedClasses} onClose={() => setScannedSchedule(null)} />
      <APIKeyModal visible={apiKeyModalVisible} tokens={tokens} apiKey={apiKey} onSave={updateApiKey} onClose={() => setApiKeyModalVisible(false)} />
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

function colorForKey(key: ScheduleColor, tokens: ThemeTokens) {
  if (key === 'coral') return { main: tokens.blue, soft: tokens.blueSoft, border: tokens.blue };
  if (key === 'sage') return { main: tokens.sage, soft: tokens.sageSoft, border: tokens.sage };
  return { main: tokens.slate, soft: tokens.slateSoft, border: tokens.slate };
}

function colorForEntry(entry: ScheduleEntry, tokens: ThemeTokens) {
  return colorForKey(entry.color, tokens);
}

const styles = StyleSheet.create({
  daySelectRow: { borderRadius: UI.groupRadius, paddingHorizontal: 16, minHeight: 60, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  editorGroup: { borderRadius: UI.groupRadius, padding: 16, marginBottom: 24 },
  editorHeading: { flex: 1, fontSize: 17, fontWeight: '600', textAlign: 'center', marginHorizontal: 12 },
  todayDate: { fontSize: 15, lineHeight: 22, marginTop: 12 },
  todayFocus: { gap: 14, paddingVertical: 4 },
  focusHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statusPill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, borderCurve: 'continuous', gap: 6, alignSelf: 'flex-start' },
  statusPillDot: { width: 7, height: 7, borderRadius: 4 },
  statusPillText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.2 },
  progressPercentText: { fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  ongoingProgressTrack: { height: 6, borderRadius: 3, overflow: 'hidden', marginTop: 4, marginBottom: 4 },
  ongoingProgressBar: { height: '100%', borderRadius: 3 },
  todayState: { fontSize: 15, fontWeight: '600' },
  todayTime: { fontSize: 40, fontWeight: '700', letterSpacing: -1, fontVariant: ['tabular-nums'] },
  todayTitle: { fontSize: 24, lineHeight: 30, fontWeight: '600', letterSpacing: -0.4 },
  todayMeta: { fontSize: 17, lineHeight: 24, marginBottom: 8 },
  homeRemaining: { marginTop: 16 },
  agendaGroup: { borderRadius: 20, borderCurve: 'continuous', overflow: 'hidden', paddingHorizontal: 16 },
  agendaStacked: { flexDirection: 'column', gap: 8 },
  freeDay: { paddingVertical: 18, fontSize: 17, minHeight: 56 },
  headerActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  appRoot: { flex: 1 },
  screen: { flex: 1 },
  scrollContent: { alignSelf: 'center', width: '100%', maxWidth: UI.contentWidth, paddingHorizontal: UI.pageInset, paddingTop: 22, paddingBottom: 112 },
  homeContent: { paddingTop: 22 },
  homeIntro: { marginBottom: 22 },
  eyebrow: { fontSize: 14, fontWeight: '700', letterSpacing: 0.2, marginBottom: 9 },
  heroTitle: { fontSize: 34, lineHeight: 41, fontWeight: '700', letterSpacing: -0.8 },
  screenHeader: { marginBottom: 20 },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', minHeight: 52 },
  headerCopy: { flex: 1, minWidth: 0 },
  screenTitle: { fontSize: 34, lineHeight: 41, fontWeight: '700', letterSpacing: -0.8 },
  screenSubtitle: { fontSize: 15, lineHeight: 21, marginTop: 3 },
  backGlassPressable: { alignSelf: 'flex-start', minHeight: 44, marginRight: 8 },
  backGlassSurface: { width: CIRCLE_CONTROL_SIZE, height: CIRCLE_CONTROL_SIZE, borderRadius: CIRCLE_CONTROL_SIZE / 2, justifyContent: 'center', alignItems: 'center' },
  todayCard: { borderRadius: 20, borderCurve: 'continuous', padding: 24 },
  cardHeadingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 },
  cardEyebrow: { fontSize: 13, lineHeight: 18, marginBottom: 3 },
  cardTitle: { fontSize: 20, lineHeight: 26, fontWeight: '700', letterSpacing: -0.2 },
  nextEntry: { flexDirection: 'row', alignItems: 'center', borderRadius: 17, padding: 14, minHeight: 86 },
  entryDot: { width: 10, height: 10, borderRadius: 5, marginRight: 12 },
  nextEntryCopy: { flex: 1, minWidth: 0 },
  nextEntryTime: { fontSize: 13, fontWeight: '700', marginBottom: 4, fontVariant: ['tabular-nums'] },
  nextEntryTitle: { fontSize: 17, lineHeight: 22, fontWeight: '700' },
  nextEntryLocation: { fontSize: 14, marginTop: 4 },
  emptyPreview: { flexDirection: 'row', alignItems: 'center', borderRadius: 17, padding: 14, minHeight: 86 },
  emptyPreviewCopy: { flex: 1, marginLeft: 12 },
  emptyPreviewTitle: { fontSize: 16, lineHeight: 21, fontWeight: '700' },
  emptyPreviewBody: { fontSize: 14, lineHeight: 19, marginTop: 4 },
  sectionLabel: { fontSize: 15, fontWeight: '600', marginBottom: 12, marginLeft: 16 },
  miniAppList: { borderRadius: 20, borderCurve: 'continuous', overflow: 'hidden' },
  miniAppRowPressable: { minHeight: 78 },
  miniAppRow: { minHeight: 88, paddingHorizontal: 16, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', gap: 16 },
  miniAppRowIcon: { width: 44, height: 44, borderRadius: 12, borderCurve: 'continuous', justifyContent: 'center', alignItems: 'center' },
  miniAppRowCopy: { flex: 1, minWidth: 0 },
  miniAppRowTitle: { fontSize: 17, lineHeight: 22, fontWeight: '700' },
  miniAppRowDetail: { fontSize: 14, lineHeight: 19, marginTop: 3 },
  miniAppDivider: { height: 1, marginLeft: 70 },
  settingsSection: { borderRadius: 20, borderCurve: 'continuous', padding: 16, marginBottom: 16 },
  settingTitle: { fontSize: 16, lineHeight: 22, fontWeight: '700' },
  themeOptions: { marginTop: 12 },
  themeOption: { minHeight: 56, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 16 },
  themeOptionText: { flex: 1, fontSize: 17 },
  settingRow: { flexDirection: 'row', alignItems: 'center' },
  settingRowCopy: { flex: 1, minWidth: 0, paddingRight: 12 },
  dangerRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 20, padding: 18, minHeight: 80, marginBottom: 24 },
  scheduleContent: { paddingTop: 22 },
  segmented: { flexDirection: 'row', borderRadius: 12, padding: 4, marginBottom: 20, gap: 4 },
  segmentedOption: { flex: 1, minHeight: 44, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  segmentedText: { fontSize: 14, fontWeight: '700' },
  dayPicker: { gap: 8, paddingBottom: 18 },
  dayButton: { minWidth: 52, minHeight: 44, borderWidth: 1, borderRadius: 13, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  dayButtonText: { fontSize: 13, fontWeight: '700' },
  agendaList: { marginTop: 2 },
  agendaHeading: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 11 },
  agendaTitle: { fontSize: 21, lineHeight: 27, fontWeight: '700' },
  agendaCount: { fontSize: 13 },
  scheduleRow: { flexDirection: 'row', alignItems: 'flex-start', minHeight: 88, paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, gap: 16 },
  timeColumn: { flexShrink: 0 },
  timeText: { fontSize: 17, fontWeight: '600', fontVariant: ['tabular-nums'] },
  endTimeText: { fontSize: 15, marginTop: 4, fontVariant: ['tabular-nums'] },
  scheduleCard: { flex: 1, flexDirection: 'row', alignItems: 'baseline', minWidth: 0 },
  scheduleColorDot: { width: 9, height: 9, borderRadius: 5, marginRight: 12 },
  scheduleCardCopy: { flex: 1, minWidth: 0, paddingRight: 8 },
  scheduleTitle: { fontSize: 17, lineHeight: 23, fontWeight: '600' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 7 },
  metaText: { flexShrink: 1, fontSize: 15, lineHeight: 21 },
  emptyState: { minHeight: 160, paddingVertical: 24, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  emptyStateIcon: { width: 62, height: 62, borderRadius: 22, justifyContent: 'center', alignItems: 'center', marginBottom: 17 },
  emptyStateTitle: { fontSize: 20, lineHeight: 26, fontWeight: '700', textAlign: 'center' },
  solidAction: { minHeight: 48, paddingHorizontal: 18, borderRadius: 15, flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 20 },
  solidActionText: { fontSize: 15, fontWeight: '700' },
  textAction: { minHeight: 44, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 10, marginTop: 8 },
  textActionText: { fontSize: 14, fontWeight: '700' },
  weekList: { gap: 24 },
  weekRow: { minHeight: 84, borderWidth: 1, borderRadius: 17, padding: 14, flexDirection: 'row', alignItems: 'center' },
  weekDayLabel: { minWidth: 76, paddingRight: 10 },
  weekDayShort: { fontSize: 13, fontWeight: '700' },
  weekDayLong: { fontSize: 15, fontWeight: '700', marginTop: 2 },
  weekSummary: { flex: 1, minWidth: 0, paddingRight: 12 },
  weekFirstTime: { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  weekFirstTitle: { fontSize: 14, marginTop: 3 },
  weekCount: { fontSize: 12, marginTop: 3 },
  statePanel: { borderWidth: 1, borderRadius: 22, padding: 24, alignItems: 'center', marginTop: 2 },
  stateTitle: { fontSize: 17, lineHeight: 23, fontWeight: '700', marginTop: 9, textAlign: 'center' },
  stateBody: { fontSize: 14, lineHeight: 20, marginTop: 5, textAlign: 'center' },
  downloaderSurface: { borderRadius: 20, borderCurve: 'continuous', padding: 20 },
  downloaderInput: { minHeight: 52, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, fontSize: 16 },
  downloaderLinkRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  downloaderSourceBadge: { width: 36, height: 36, borderRadius: 10, borderCurve: 'continuous', justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  downloaderSourceBadgeText: { fontSize: 12, fontWeight: '800' },
  downloaderInputInline: { flex: 1, minWidth: 0, minHeight: 52, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, fontSize: 16 },
  downloaderResult: { borderRadius: 16, borderCurve: 'continuous', borderWidth: 1, padding: 13, marginTop: 18, gap: 10 },
  downloaderResultHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  downloaderResultCopy: { flex: 1, minWidth: 0 },
  downloaderResultTitle: { fontSize: 16, lineHeight: 21, fontWeight: '700' },
  downloaderResultMeta: { fontSize: 13, lineHeight: 18, marginTop: 4 },
  downloaderDescription: { fontSize: 14, lineHeight: 20, marginTop: 10 },
  downloaderLoading: { alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 14, minHeight: 44 },
  downloaderLoadingText: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  downloaderSelect: { minHeight: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, marginTop: 8, fontSize: 15 },
  downloaderFormatLabel: { marginTop: 20 },
  downloaderModeRow: { flexDirection: 'row', borderWidth: 1, borderRadius: 14, padding: 4, gap: 4, marginTop: 16 },
  downloaderMode: { flex: 1, minHeight: 46, borderWidth: 1, borderColor: 'transparent', borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  downloaderModeText: { fontSize: 14, fontWeight: '700' },
  downloaderActionRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 16 },
  statusRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, marginTop: 14, paddingHorizontal: 4 },
  downloaderStatus: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: '700' },
  modalRoot: { flex: 1 },
  modalKeyboard: { flex: 1 },
  editorContent: { padding: UI.pageInset, maxWidth: UI.contentWidth, width: '100%', alignSelf: 'center' },
  editorHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: UI.sheetActionInset, maxWidth: UI.contentWidth, width: '100%', alignSelf: 'center' },
  editorHeaderActions: { flexDirection: 'row', alignItems: 'center', marginTop: -7 },
  editorEyebrow: { fontSize: 13, fontWeight: '700' },
  formGroup: { marginBottom: 19 },
  fieldLabel: { fontSize: 14, lineHeight: 19, fontWeight: '700', marginBottom: 8 },
  textInput: { minHeight: 50, borderWidth: 1, borderRadius: 15, paddingHorizontal: 14, fontSize: 16 },
  editorDayPicker: { gap: 8 },
  editorDay: { minHeight: 44, paddingHorizontal: 13, borderWidth: 1, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  editorDayText: { fontSize: 13, fontWeight: '700' },
  timeFieldsRow: { flexDirection: 'row', gap: 16 },
  timeFieldsRowStacked: { flexDirection: 'column' },
  timeField: { flex: 1, minWidth: 0 },
  colorOptions: { gap: 8 },
  colorOption: { minHeight: 48, borderWidth: 1, borderRadius: 15, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center' },
  colorSwatch: { width: 18, height: 18, borderRadius: 9, marginRight: 9 },
  colorOptionText: { fontSize: 14, fontWeight: '600' },
  validationBox: { flexDirection: 'row', alignItems: 'flex-start', borderRadius: 14, padding: 12, marginBottom: 15, gap: 8 },
  validationText: { flex: 1, fontSize: 14, lineHeight: 19 },
  deleteButton: { minHeight: 48, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 7, marginTop: 8 },
  deleteButtonText: { fontSize: 14, fontWeight: '700' },
  glassButtonPressable: { alignSelf: 'flex-start', minHeight: 52 },
  glassButtonFullWidthPressable: { alignSelf: 'stretch' },
  glassButtonInlinePressable: { flexShrink: 0, minHeight: 44 },
  disabledControl: { opacity: 0.45 },
  glassButtonCompact: { alignSelf: 'auto', minHeight: 48 },
  glassButton: { minHeight: 52, paddingHorizontal: 16, borderRadius: 17, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  glassButtonFullWidth: { width: '100%' },
  glassButtonInline: { minHeight: 44, paddingHorizontal: 13, borderRadius: 14, gap: 6 },
  glassButtonCompactSurface: { minWidth: CIRCLE_CONTROL_SIZE, minHeight: CIRCLE_CONTROL_SIZE, width: CIRCLE_CONTROL_SIZE, paddingHorizontal: 0, borderRadius: CIRCLE_CONTROL_SIZE / 2 },
  glassButtonText: { fontSize: 15, fontWeight: '700' },
  iconButton: { width: CIRCLE_CONTROL_SIZE, height: CIRCLE_CONTROL_SIZE },
  iconButtonSurface: { width: CIRCLE_CONTROL_SIZE, height: CIRCLE_CONTROL_SIZE, borderRadius: CIRCLE_CONTROL_SIZE / 2, justifyContent: 'center', alignItems: 'center' },
  tabBarPosition: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', paddingHorizontal: 12 },
  tabBarSurface: { width: '100%', maxWidth: 480, minHeight: 70, borderRadius: 32, paddingHorizontal: 6, paddingTop: 4 },
  tabBarInner: { flexDirection: 'row', alignItems: 'stretch', justifyContent: 'space-around' },
  tabItem: { flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center' },
  tabLabel: { fontSize: 12, lineHeight: 16, fontWeight: '700', marginTop: 4 },
  pressed: { opacity: 0.75 },
});
