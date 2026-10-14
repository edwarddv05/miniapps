// Anime: explore, Mi lista, detail and Hoy's anime section.

import * as Haptics from 'expo-haptics';
import { BottomSheet, Button as NativeButton, ContentUnavailableView, Divider, Group, HStack, Menu, Image as NativeImage, LazyVStack, Picker, ProgressView, RNHostView, ScrollView, Spacer, Text as NativeText, TextField, type TextFieldRef, VStack, ZStack, useNativeState } from '@expo/ui/swift-ui';
import { accessibilityLabel, accessibilityAddTraits, accessibilityElement, accessibilityHidden, accessibilityHint, animation, Animation, blur, clipped, buttonStyle, clipShape, contentShape, contentTransition, controlSize, disabled, font, fixedSize, frame, glassEffect, ignoreSafeArea, autocorrectionDisabled, lineLimit, menuIndicator, minimumScaleFactor, monospacedDigit, multilineTextAlignment, onSubmit, offset, onAppear, useScrollGeometryChange, onLongPressGesture, onTapGesture, opacity, padding, pickerStyle, presentationDetents, presentationDragIndicator, scaleEffect, scrollDismissesKeyboard, shadow, shapes, submitLabel, tag, textFieldStyle, type ViewModifier } from '@expo/ui/swift-ui/modifiers';
import type { SFSymbol } from 'sf-symbols-typescript';
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, Image as RNImage, Linking, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useCurrentTime } from '../use-current-time';
import { UI } from '../ui-structure';
import { LinearGradient } from 'expo-linear-gradient';
import { background, foregroundStyle, tint } from '../native-colors';
import { background as shapeBackground } from '@expo/ui/swift-ui/modifiers';
import { activeFilterCount, ANIME_GENRES, animeErrorMessage, animeTitle, cachedTranslation, currentAnimeSeason, DEFAULT_ANIME_FILTERS, FORMAT_LABELS, formatFuzzyDate, genreLabel, getAnime, loadAnimeFilters, saveAnimeFilters, SEASON_LABELS, searchAnime, SORT_LABELS, STATUS_LABELS, translateSynopsis, type AnimeDetail, type AnimeFilters, type AnimeFormat, type AnimeSeason, type AnimeSort, type AnimeStatus, type AnimeSummary, type StreamingService } from '../anime-api';
import { countryFlag, countryName, loadStreamingCountry, saveStreamingCountry, STREAMING_COUNTRIES, streamingIn } from '../justwatch-api';
import { airedEpisodes, episodesBehind, LIST_STATUS_LABELS, loadLibrary, refreshLibrary, setListStatus, setProgress, updateLibrarySnapshot, watchableEpisodes, useAnimeLibrary, type LibraryEntry, type ListStatus } from '../anime-library';
import { CHIP_GAP, CIRCLE_CONTROL_SIZE, type FilterChip, FilterChipsNative, NativeCircleButton, PageNative, SHEET_ACTION_INSET, SectionHeadingNative, StoreErrorNative, SymbolImage, type ThemeTokens, alertUnsaved, capitalize, darken, mixHex, nativeGlassAvailable, textModifiers, usePageWidth, withAlpha } from './shared';

const ANIME_COLUMNS = 3;
const MIN_SEARCH_LENGTH = 2;
const ANIME_GRID_GAP = 12;
const EPISODES_COLLAPSED = 12;
// Scroll offsets (pt) over which the detail's header title fades in.
const TITLE_REVEAL_START = 40;
const TITLE_REVEAL_SPAN = 80;

// Readable text in a cover's own colour; pale covers need more darkening than class hues.
function coverInk(color: string | null, tokens: ThemeTokens) {
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return tokens.blue;
  return tokens.mode === 'dark' ? mixHex(color, '#FFFFFF', 0.35) : mixHex(color, '#000000', 0.5);
}

function untilLabel(seconds: number) {
  if (seconds <= 0) return 'Ahora';
  const minutes = Math.ceil(seconds / 60);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  if (days) return hours ? `${days} d ${hours} h` : `${days} d`;
  if (hours) return rest ? `${hours} h ${rest} min` : `${hours} h`;
  return `${rest} min`;
}

function airingDate(seconds: number, withYear = false) {
  return new Intl.DateTimeFormat('es-PE', withYear
    ? { day: 'numeric', month: 'short', year: 'numeric' }
    : { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(seconds * 1000);
}


function scoreLabel(score: number) {
  return (score / 10).toLocaleString('es-PE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function filterSummary(filters: AnimeFilters) {
  return [
    filters.genres.map(genreLabel).join(', '),
    [filters.season ? SEASON_LABELS[filters.season] : null, filters.year].filter(Boolean).join(' '),
    filters.format ? FORMAT_LABELS[filters.format] : null,
    filters.status ? STATUS_LABELS[filters.status] : null,
  ].filter(Boolean).join(' · ');
}

function translationErrorMessage(reason: unknown) {
  const message = reason instanceof Error ? reason.message.toLowerCase() : '';
  if (message.includes('quota') || message.includes('exhausted') || message.includes('rate')) return 'Se agotó la cuota de Gemini. Inténtalo más tarde.';
  if (message.includes('api key') || message.includes('permission')) return 'La clave de Gemini no es válida. Cámbiala en Ajustes.';
  return 'No se pudo traducir la sinopsis.';
}

// `fade` paints a gradient over the image on the React Native side: Expo Go's
// native @expo/ui predates gradient fills, so a SwiftUI gradient would not draw.
function AnimeCoverNative({ uri, width, height, radius = 12, fade, tokens }: { uri: string | null; width: number; height: number; radius?: number; fade?: { colors: [string, string, ...string[]]; locations: [number, number, ...number[]] }; tokens: ThemeTokens }) {
  return <VStack modifiers={[frame({ width, height }), clipShape('roundedRectangle', radius), accessibilityHidden()]}>
    <RNHostView>
      <View style={{ flex: 1 }}>
        <RNImage source={uri ? { uri } : undefined} style={{ flex: 1, backgroundColor: tokens.mode === 'dark' ? '#2A2938' : '#E4E6EC' }} resizeMode="cover" />
        {fade ? <LinearGradient colors={fade.colors} locations={fade.locations} style={StyleSheet.absoluteFill} /> : null}
      </View>
    </RNHostView>
  </VStack>;
}


// One short line under the cover: what kind of anime it is and its year
// ("TV · 2013", "Película · 2016"). Airing ones get a green dot beside it;
// the countdown lives in the long-press card and the detail.
function animeCardDetail(anime: AnimeSummary) {
  return [anime.format ? FORMAT_LABELS[anime.format] : null, anime.seasonYear ?? anime.startDate?.year ?? null].filter(Boolean).join(' · ');
}

function StatusDotNative({ status, size = 8 }: { status: AnimeStatus; size?: number }) {
  return <VStack modifiers={[frame({ width: size, height: size }), background(STATUS_DOTS[status]), clipShape('circle'), accessibilityHidden()]}>{null}</VStack>;
}

type SpotlightStat = { value: string; label: string; star?: boolean; accent?: boolean };

// What a long press shows: a card of its own, not an enlarged cover. The
// banner (or the cover) runs edge to edge with the title on it, then three
// figures side by side, genres in the anime's colour and the synopsis opening.
// Tapping the card opens the anime; tapping outside closes it. Everything comes
// from the list query.
function AnimeSpotlightNative({ anime, tokens, nowSeconds, onOpen, onClose }: { anime: AnimeSummary; tokens: ThemeTokens; nowSeconds: number; onOpen: () => void; onClose: () => void }) {
  const { width: screenWidth } = useWindowDimensions();
  const width = Math.min(screenWidth - UI.pageInset * 2, 400);
  const [shown, setShown] = useState(false);
  // Drift runs the banner's slow pan and the glow; it stays off with Reduce Motion.
  const [drift, setDrift] = useState(false);
  useEffect(() => {
    setShown(true);
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (active && !reduce) setDrift(true);
    });
    return () => {
      active = false;
    };
  }, []);
  const ink = coverInk(anime.color, tokens);
  const title = animeTitle(anime.title);
  const romaji = anime.title.romaji && anime.title.romaji !== title ? anime.title.romaji : null;
  const tint = anime.color && /^#[0-9a-f]{6}$/i.test(anime.color) ? anime.color : null;
  const year = anime.seasonYear ?? anime.startDate?.year ?? null;
  const next = anime.nextEpisode;
  const bannerHeight = anime.banner ? Math.round(width * 0.46) : Math.round(width * 0.62);

  // Three figures at most, in order of use: rating, next episode, kind, studio.
  const candidates: Array<SpotlightStat | null> = [
    anime.score ? { value: scoreLabel(anime.score), label: 'Puntuación', star: true } : null,
    next ? { value: untilLabel(next.airingAt - nowSeconds), label: `Episodio ${next.episode}`, accent: true } : null,
    anime.format ? { value: FORMAT_LABELS[anime.format], label: year ? String(year) : 'Formato' } : null,
    anime.studio ? { value: anime.studio, label: 'Estudio' } : null,
  ];
  const stats = candidates.filter((stat): stat is SpotlightStat => Boolean(stat)).slice(0, 3);
  const statWidth = stats.length ? Math.floor((width - 32 - (stats.length - 1)) / stats.length) : 0;

  return <ZStack alignment="center" modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity })]}>
    <VStack modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity }), background('#000000'), opacity(shown ? 0.45 : 0), animation(Animation.easeOut({ duration: 0.2 }), shown), ignoreSafeArea({ edges: 'all' }), contentShape(shapes.rectangle()), onTapGesture(onClose), accessibilityLabel('Cerrar resumen'), accessibilityAddTraits(['isButton'])]}>{null}</VStack>
    <VStack alignment="leading" spacing={0} modifiers={[
      frame({ width, alignment: 'leading' }),
      background(tokens.surface),
      clipShape('roundedRectangle', 28),
      shadow({ radius: 30, y: 12, color: '#00000040' }),
      scaleEffect(shown ? 1 : 0.92),
      opacity(shown ? 1 : 0),
      animation(Animation.spring({ duration: 0.35, bounce: 0.18 }), shown),
      contentShape(shapes.rectangle()),
      onTapGesture(onOpen),
      accessibilityElement('combine'),
      accessibilityAddTraits(['isButton']),
      accessibilityHint('Toca para abrir'),
    ]}>
      {/* The banner drifts slowly (a Ken Burns pan), and a glow of the cover's
          colour sways under the title inside the dark gradient. */}
      <ZStack alignment="bottomLeading" modifiers={[frame({ width, height: bannerHeight }), clipped()]}>
        <ZStack modifiers={[
          frame({ width, height: bannerHeight }),
          scaleEffect(drift ? 1.16 : 1.04),
          offset({ x: drift ? -width * 0.04 : width * 0.04, y: drift ? -bannerHeight * 0.03 : bannerHeight * 0.03 }),
          animation(Animation.easeInOut({ duration: 9 }).repeat({ repeatCount: 10000, autoreverses: true }), drift),
        ]}>
          <AnimeCoverNative uri={anime.banner ?? anime.cover} width={width} height={bannerHeight} radius={0} tokens={tokens} />
        </ZStack>
        <VStack modifiers={[frame({ width, height: bannerHeight }), shapeBackground({ type: 'linearGradient', colors: ['#00000000', '#00000026', '#000000C7'], startPoint: { x: 0.5, y: 0.25 }, endPoint: { x: 0.5, y: 1 } })]}>{null}</VStack>
        <VStack modifiers={[
          frame({ width: width * 0.8, height: bannerHeight * 0.6 }),
          background(tint ?? tokens.blue),
          clipShape('circle'),
          blur(48),
          opacity(drift ? 0.5 : 0.3),
          offset({ x: drift ? width * 0.4 : -width * 0.3, y: bannerHeight * 0.3 }),
          animation(Animation.easeInOut({ duration: 6 }).repeat({ repeatCount: 10000, autoreverses: true }), drift),
          accessibilityHidden(),
        ]}>{null}</VStack>
        {/* Padding sits inside the frame: after it, it would widen the card. */}
        <VStack alignment="leading" spacing={4} modifiers={[padding({ horizontal: 18, bottom: 16 }), frame({ width, alignment: 'leading' })]}>
          {anime.status ? <HStack alignment="center" spacing={6} modifiers={[padding({ horizontal: 9, vertical: 4 }), background('#00000059'), clipShape('capsule')]}>
            <StatusDotNative status={anime.status} size={7} />
            <NativeText modifiers={[foregroundStyle('#FFFFFF'), font({ textStyle: 'caption', weight: 'semibold' })]}>{STATUS_LABELS[anime.status]}</NativeText>
          </HStack> : null}
          <NativeText modifiers={[foregroundStyle('#FFFFFF'), font({ textStyle: 'title2', weight: 'bold', design: 'rounded' }), lineLimit(2), minimumScaleFactor(0.8)]}>{title}</NativeText>
          {romaji ? <NativeText modifiers={[foregroundStyle('#FFFFFFCC'), font({ textStyle: 'footnote' }), lineLimit(1)]}>{romaji}</NativeText> : null}
        </VStack>
      </ZStack>

      <VStack alignment="leading" spacing={16} modifiers={[padding({ all: 16 }), frame({ width, alignment: 'leading' })]}>
        {stats.length ? <HStack alignment="center" spacing={0}>
          {stats.map((stat, index) => <HStack key={index} alignment="center" spacing={0}>
            {index > 0 ? <VStack modifiers={[frame({ width: 1, height: 34 }), background(tokens.border)]}>{null}</VStack> : null}
            <VStack alignment="center" spacing={3} modifiers={[frame({ width: statWidth })]}>
              <HStack alignment="center" spacing={4}>
                {stat.star ? <NativeImage systemName="star.fill" modifiers={[font({ size: 13, weight: 'bold' }), foregroundStyle(tokens.mode === 'dark' ? '#FFD60A' : '#E0A800')]} /> : null}
                <NativeText modifiers={[foregroundStyle(stat.accent ? ink : tokens.text), font({ textStyle: 'headline', weight: 'bold', design: 'rounded' }), monospacedDigit(), lineLimit(1), minimumScaleFactor(0.6)]}>{stat.value}</NativeText>
              </HStack>
              <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'caption2', weight: 'medium' }), lineLimit(1)]}>{stat.label}</NativeText>
            </VStack>
          </HStack>)}
        </HStack> : null}

        {anime.genres.length ? <HStack alignment="center" spacing={6}>
          {anime.genres.slice(0, 3).map((genre) => <NativeText key={genre} modifiers={[
            foregroundStyle(ink),
            font({ textStyle: 'caption', weight: 'semibold' }),
            lineLimit(1),
            padding({ horizontal: 9, vertical: 5 }),
            background(tint ? withAlpha(tint, tokens.mode === 'dark' ? 0.24 : 0.16) : tokens.blueSoft),
            clipShape('capsule'),
          ]}>{genreLabel(genre)}</NativeText>)}
        </HStack> : null}

        {anime.synopsis ? <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'footnote' }), lineLimit(4)]}>{anime.synopsis}</NativeText> : null}
      </VStack>
    </VStack>
  </ZStack>;
}

function AnimeCardNative({ anime, width, tokens, listStatus, onPress, onPeek }: { anime: AnimeSummary; width: number; tokens: ThemeTokens; listStatus: ListStatus | null; onPress: () => void; onPeek: () => void }) {
  const title = animeTitle(anime.title);
  const detail = animeCardDetail(anime);
  const airing = anime.status === 'RELEASING';
  return <VStack alignment="leading" spacing={6} modifiers={[
    frame({ width, alignment: 'topLeading' }),
    contentShape(shapes.rectangle()),
    onTapGesture(onPress),
    onLongPressGesture(onPeek, 0.35),
    accessibilityElement('combine'),
    accessibilityAddTraits(['isButton']),
    accessibilityLabel([title, anime.score ? `puntuación ${scoreLabel(anime.score)}` : null, airing ? 'en emisión' : null, detail, listStatus ? `en tu lista: ${LIST_STATUS_LABELS[listStatus]}` : null].filter(Boolean).join(', ')),
    accessibilityHint('Mantén pulsado para ver un resumen'),
  ]}>
    <ZStack alignment="topLeading">
      <AnimeCoverNative uri={anime.cover} width={width} height={Math.round(width * 1.5)} tokens={tokens} />
      {/* The rating rides on the cover, legible on any artwork. */}
      {anime.score ? <HStack alignment="center" spacing={3} modifiers={[padding({ horizontal: 7, vertical: 4 }), background('#000000A6'), clipShape('capsule'), padding({ all: 6 })]}>
        <NativeImage systemName="star.fill" modifiers={[font({ size: 10, weight: 'bold' }), foregroundStyle('#FFD60A')]} />
        <NativeText modifiers={[foregroundStyle('#FFFFFF'), font({ textStyle: 'caption', weight: 'bold' }), monospacedDigit()]}>{scoreLabel(anime.score)}</NativeText>
      </HStack> : null}
      {/* Anime already in Mi lista carry its mark in the opposite corner. */}
      {listStatus ? <ZStack alignment="center" modifiers={[frame({ width: 26, height: 26 }), background('#000000A6'), clipShape('circle'), padding({ all: 6 }), offset({ x: width - 38 })]}>
        <NativeImage systemName={LIST_SYMBOLS[listStatus]} modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle('#FFFFFF')]} />
      </ZStack> : null}
    </ZStack>
    <VStack alignment="leading" spacing={2} modifiers={[frame({ width, alignment: 'leading' })]}>
      <NativeText modifiers={[...textModifiers(tokens, { style: 'footnote', weight: 'semibold' }), lineLimit(2)]}>{title}</NativeText>
      {detail ? <HStack alignment="center" spacing={5}>
        {airing ? <StatusDotNative status="RELEASING" size={6} /> : null}
        <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'caption' }), monospacedDigit(), lineLimit(1)]}>{detail}</NativeText>
      </HStack> : null}
    </VStack>
  </VStack>;
}


// Skeletons keep the page's real shape while loading. They pulse gently,
// unless Reduce Motion is on.
function useSkeletonPulse(): ViewModifier[] {
  const [dim, setDim] = useState(false);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (active && !reduce) setDim(true);
    });
    return () => {
      active = false;
    };
  }, []);
  return [opacity(dim ? 0.45 : 1), animation(Animation.easeInOut({ duration: 0.9 }).repeat({ repeatCount: 10000, autoreverses: true }), dim)];
}

function SkeletonBarNative({ width, height = 11, tokens, radius = 4 }: { width: number; height?: number; tokens: ThemeTokens; radius?: number }) {
  return <VStack modifiers={[frame({ width, height }), background(tokens.mode === 'dark' ? '#2A2938' : '#DEDDE6'), clipShape('roundedRectangle', radius)]}>{null}</VStack>;
}

function AnimeGridSkeletonNative({ rows, columnWidth, tokens }: { rows: number; columnWidth: number; tokens: ThemeTokens }) {
  const pulse = useSkeletonPulse();
  return <VStack alignment="leading" spacing={20} modifiers={[...pulse, accessibilityElement('ignore'), accessibilityLabel('Cargando')]}>
    {Array.from({ length: rows }, (_, row) => <HStack key={row} alignment="top" spacing={ANIME_GRID_GAP}>
      {Array.from({ length: ANIME_COLUMNS }, (_, column) => <VStack key={column} alignment="leading" spacing={7}>
        <SkeletonBarNative width={columnWidth} height={Math.round(columnWidth * 1.5)} radius={12} tokens={tokens} />
        <SkeletonBarNative width={Math.round(columnWidth * (column === 1 ? 0.7 : 0.85))} tokens={tokens} />
        <SkeletonBarNative width={Math.round(columnWidth * 0.5)} height={9} tokens={tokens} />
      </VStack>)}
    </HStack>)}
  </VStack>;
}

function AnimeDetailSkeletonNative({ width, tokens }: { width: number; tokens: ThemeTokens }) {
  const pulse = useSkeletonPulse();
  const textWidth = width - 120 - 16;
  return <VStack alignment="leading" spacing={24} modifiers={[...pulse, accessibilityElement('ignore'), accessibilityLabel('Cargando')]}>
    <HStack alignment="top" spacing={16}>
      <SkeletonBarNative width={120} height={180} radius={14} tokens={tokens} />
      <VStack alignment="leading" spacing={9} modifiers={[padding({ top: 4 })]}>
        <SkeletonBarNative width={textWidth} height={20} radius={6} tokens={tokens} />
        <SkeletonBarNative width={Math.round(textWidth * 0.7)} height={20} radius={6} tokens={tokens} />
        <SkeletonBarNative width={Math.round(textWidth * 0.8)} tokens={tokens} />
        <SkeletonBarNative width={Math.round(textWidth * 0.5)} tokens={tokens} />
      </VStack>
    </HStack>
    <VStack alignment="leading" spacing={9}>
      <SkeletonBarNative width={110} height={18} radius={6} tokens={tokens} />
      {[1, 0.96, 0.9, 1, 0.6].map((share, index) => <SkeletonBarNative key={index} width={Math.round(width * share)} tokens={tokens} />)}
    </VStack>
  </VStack>;
}

const LIST_SYMBOLS: Record<ListStatus, SFSymbol> = { watching: 'eye.fill', planning: 'bookmark.fill', completed: 'checkmark.circle.fill' };
const LIST_ORDER: ListStatus[] = ['watching', 'planning', 'completed'];

// "Hoy 10:26", "Mañana 9:30", "Jue 2 oct, 9:30": when an episode airs, relative to today.
function airingMoment(seconds: number, now: Date) {
  const date = new Date(seconds * 1000);
  const time = new Intl.DateTimeFormat('es-PE', { hour: 'numeric', minute: '2-digit' }).format(date);
  const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOfDay(date) - startOfDay(now)) / 86400000);
  if (days === 0) return `Hoy ${time}`;
  if (days === 1) return `Mañana ${time}`;
  return `${capitalize(new Intl.DateTimeFormat('es-PE', { weekday: 'short', day: 'numeric', month: 'short' }).format(date))}, ${time}`;
}

// "Hoy 10:26", "Mañana 9:30", "Jue 10:26" within the week, "1 oct" beyond it.
function shortAiringMoment(seconds: number, now: Date) {
  const date = new Date(seconds * 1000);
  const time = new Intl.DateTimeFormat('es-PE', { hour: 'numeric', minute: '2-digit' }).format(date);
  const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOfDay(date) - startOfDay(now)) / 86400000);
  if (days === 0) return `Hoy ${time}`;
  if (days === 1) return `Mañana ${time}`;
  if (days < 7) return `${capitalize(new Intl.DateTimeFormat('es-PE', { weekday: 'short' }).format(date).replace('.', ''))} ${time}`;
  return new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'short' }).format(date).replace('.', '');
}

// A small capsule for an episode: the next one to watch (filled with the
// anime's colour) or the next one to air (quiet, with a clock).
function EpisodeChipNative({ symbol, text, color, filled, tokens }: { symbol: SFSymbol; text: string; color: string; filled: boolean; tokens: ThemeTokens }) {
  return <HStack alignment="center" spacing={4} modifiers={[
    padding({ horizontal: 8, vertical: 4 }),
    background(filled ? withAlpha(color, tokens.mode === 'dark' ? 0.26 : 0.16) : tokens.mode === 'dark' ? '#FFFFFF14' : '#0000000D'),
    clipShape('capsule'),
  ]}>
    <NativeImage systemName={symbol} modifiers={[font({ size: 10, weight: 'bold' }), foregroundStyle(filled ? color : tokens.secondary)]} />
    <NativeText modifiers={[foregroundStyle(filled ? color : tokens.secondary), font({ textStyle: 'caption', weight: 'semibold' }), monospacedDigit(), lineLimit(1)]}>{text}</NativeText>
  </HStack>;
}

function episodesLabel(count: number) {
  return count === 1 ? '1 episodio' : `${count} episodios`;
}

// Viendo / Me interesa / Terminado under the detail's cover. Tapping the
// selected one takes the anime out of the list. While watching, a counter
// keeps track of the episodes seen and says how many are waiting.
function ListControlsNative({ anime, tokens, ink }: { anime: AnimeSummary; tokens: ThemeTokens; ink: string }) {
  const pageWidth = usePageWidth();
  const library = useAnimeLibrary();
  const entry = library.entries.find((item) => item.id === anime.id) ?? null;
  const buttonWidth = Math.floor((pageWidth - 16) / 3);
  const total = anime.episodes;
  const behind = entry ? episodesBehind(entry) : 0;
  const aired = airedEpisodes(anime);
  const limit = watchableEpisodes(anime);

  const choose = (status: ListStatus) => {
    void Haptics.selectionAsync();
    void setListStatus(anime, entry?.status === status ? null : status).then(alertUnsaved);
  };
  const step = async (delta: number) => {
    if (!entry) return;
    const { saved, done } = await setProgress(anime, entry.progress + delta);
    if (!alertUnsaved(saved)) return;
    void (done ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success) : Haptics.selectionAsync());
  };

  return <VStack alignment="leading" spacing={14} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
    <HStack alignment="center" spacing={8}>
      {LIST_ORDER.map((status) => {
        const selected = entry?.status === status;
        return <NativeButton key={status} onPress={() => choose(status)} modifiers={[buttonStyle('plain'), accessibilityLabel(LIST_STATUS_LABELS[status]), ...(selected ? [accessibilityAddTraits(['isSelected'])] : [])]}>
          <VStack alignment="center" spacing={5} modifiers={[frame({ width: buttonWidth, height: 58 }), background(selected ? tokens.blue : tokens.surface), clipShape('roundedRectangle', 16), contentShape(shapes.rectangle())]}>
            <NativeImage systemName={LIST_SYMBOLS[status]} modifiers={[font({ textStyle: 'body', weight: 'semibold' }), foregroundStyle(selected ? tokens.inverseText : tokens.secondary)]} />
            <NativeText modifiers={[...textModifiers(tokens, { color: selected ? tokens.inverseText : tokens.text, style: 'caption', weight: 'semibold' }), lineLimit(1), minimumScaleFactor(0.8)]}>{LIST_STATUS_LABELS[status]}</NativeText>
          </VStack>
        </NativeButton>;
      })}
    </HStack>
    {entry?.status === 'watching' ? <HStack alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity })]}>
      <NativeCircleButton tokens={tokens} label="Un episodio menos" systemName="minus" onPress={() => void step(-1)} disabled={entry.progress <= 0} />
      <Spacer />
      <VStack alignment="center" spacing={2} modifiers={[accessibilityElement('combine')]}>
        <HStack alignment="firstTextBaseline" spacing={4}>
          <NativeText modifiers={[foregroundStyle(tokens.text), font({ size: 30, weight: 'heavy', design: 'rounded' }), monospacedDigit(), contentTransition('numericText'), animation(Animation.spring({ duration: 0.3 }), entry.progress)]}>{String(entry.progress)}</NativeText>
          <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'headline' }), monospacedDigit()]}>{`/ ${total ?? '?'}`}</NativeText>
        </HStack>
        <NativeText modifiers={textModifiers(tokens, { color: behind ? ink : tokens.secondary, style: 'footnote', weight: behind ? 'semibold' : 'regular' })}>
          {behind ? `${episodesLabel(behind)} por ver` : aired != null && entry.progress >= aired && anime.status === 'RELEASING' ? 'Al día' : 'episodios vistos'}
        </NativeText>
      </VStack>
      <Spacer />
      <NativeCircleButton tokens={tokens} accent label={`Marcar episodio ${entry.progress + 1} como visto`} systemName="plus" onPress={() => void step(1)} disabled={limit != null && entry.progress >= limit} />
    </HStack> : null}
  </VStack>;
}

type LibraryRow = { entry: LibraryEntry; primary: string; primaryInk?: boolean; secondary?: string | null; progress?: number | null };

function LibraryRowNative({ row, tokens, onOpen, onAdvance }: { row: LibraryRow; tokens: ThemeTokens; onOpen: () => void; onAdvance?: () => void }) {
  const anime = row.entry.anime;
  const ink = coverInk(anime.color, tokens);
  const title = animeTitle(anime.title);
  return <HStack alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ vertical: 8 })]}>
    <NativeButton onPress={onOpen} modifiers={[buttonStyle('plain'), frame({ maxWidth: Infinity, alignment: 'leading' }), accessibilityLabel([title, row.primary, row.secondary].filter(Boolean).join(', '))]}>
      <HStack alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), contentShape(shapes.rectangle())]}>
        <AnimeCoverNative uri={anime.cover} width={48} height={72} radius={8} tokens={tokens} />
        <VStack alignment="leading" spacing={3} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
          <NativeText modifiers={[...textModifiers(tokens, { style: 'headline', weight: 'semibold' }), lineLimit(2)]}>{title}</NativeText>
          <NativeText modifiers={[...textModifiers(tokens, { color: row.primaryInk ? ink : tokens.secondary, style: 'subheadline', weight: row.primaryInk ? 'semibold' : 'regular' }), monospacedDigit(), lineLimit(1)]}>{row.primary}</NativeText>
          {row.secondary ? <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'footnote' }), monospacedDigit(), lineLimit(1)]}>{row.secondary}</NativeText> : null}
          {row.progress != null ? <ProgressView value={row.progress} modifiers={[tint(ink), frame({ maxWidth: 160 }), padding({ top: 2 }), accessibilityHidden()]} /> : null}
        </VStack>
      </HStack>
    </NativeButton>
    {onAdvance ? <NativeCircleButton tokens={tokens} accent={Boolean(row.primaryInk)} label={`Marcar episodio ${row.entry.progress + 1} de ${title} como visto`} systemName="plus" onPress={onAdvance} /> : null}
  </HStack>;
}

function LibrarySectionNative({ title, rows, tokens, onOpen, onAdvance }: { title: string; rows: LibraryRow[]; tokens: ThemeTokens; onOpen: (id: number) => void; onAdvance?: (entry: LibraryEntry) => void }) {
  if (!rows.length) return null;
  return <VStack alignment="leading" spacing={4} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
    <SectionHeadingNative title={title} detail={String(rows.length)} tokens={tokens} />
    {rows.map((row, index) => <VStack key={row.entry.id} spacing={0} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
      {index > 0 ? <Divider /> : null}
      <LibraryRowNative row={row} tokens={tokens} onOpen={() => onOpen(row.entry.id)} onAdvance={onAdvance && row.entry.progress < watchableEpisodes(row.entry.anime) ? () => onAdvance(row.entry) : undefined} />
    </VStack>)}
  </VStack>;
}

// A season at a glance: watched (the anime's colour), out but not watched
// (the same colour, faint) and still to air (the track).
function EpisodeBarNative({ entry, width, ink, tokens, light = false }: { entry: LibraryEntry; width: number; ink: string; tokens: ThemeTokens; light?: boolean }) {
  const aired = airedEpisodes(entry.anime) ?? entry.anime.episodes ?? entry.progress;
  const total = Math.max(entry.anime.episodes ?? 0, aired, entry.progress, 1);
  const size = (count: number) => Math.round((width * Math.min(count, total)) / total);
  const color = light ? '#FFFFFF' : ink;
  // The frame aligns to the left: the stack is only as wide as its widest
  // segment, and a centred frame would start the bar partway along.
  return <ZStack alignment="leading" modifiers={[frame({ width, height: 5, alignment: 'leading' }), background(light ? '#FFFFFF33' : tokens.mode === 'dark' ? '#FFFFFF1F' : '#0000001A'), clipShape('capsule'), accessibilityHidden()]}>
    <VStack modifiers={[frame({ width: size(aired), height: 5 }), background(withAlpha(color, light ? 0.45 : 0.35)), clipShape('capsule')]}>{null}</VStack>
    <VStack modifiers={[frame({ width: size(entry.progress), height: 5 }), background(color), clipShape('capsule')]}>{null}</VStack>
  </ZStack>;
}

function seasonLabel(entry: LibraryEntry) {
  return `${entry.progress}/${entry.anime.episodes ?? airedEpisodes(entry.anime) ?? '?'}`;
}

// The next episode among the series the owner is caught up on: the page's
// centrepiece, on the anime's own banner, with the countdown as large as it gets.
function WatchingHeroNative({ entry, tokens, now, width, onOpen }: { entry: LibraryEntry; tokens: ThemeTokens; now: Date; width: number; onOpen: () => void }) {
  const anime = entry.anime;
  const episode = anime.nextEpisode!;
  const title = animeTitle(anime.title);
  const inner = width - 36;
  // The full title shows, so the card grows by the lines it needs (about 8 pt per
  // character of semibold subheadline), keeping the art above it the same.
  const titleLines = Math.min(3, Math.max(1, Math.ceil((title.length * 8) / inner)));
  const height = 206 + titleLines * 20;
  const base = darken(anime.color && /^#[0-9a-f]{6}$/i.test(anime.color) ? anime.color : '#2A2938', 0.62);
  const until = untilLabel(episode.airingAt - now.getTime() / 1000);
  return <ZStack alignment="bottomLeading" modifiers={[
    frame({ width, height }),
    clipShape('roundedRectangle', 24),
    contentShape(shapes.rectangle()),
    onTapGesture(onOpen),
    accessibilityElement('combine'),
    accessibilityAddTraits(['isButton']),
    accessibilityLabel(`${title}, episodio ${episode.episode} en ${until}, ${airingMoment(episode.airingAt, now)}`),
  ]}>
    <AnimeCoverNative uri={anime.banner ?? anime.cover} width={width} height={height} radius={0} tokens={tokens} fade={{ colors: [withAlpha(base, 0), withAlpha(base, 0.55), withAlpha(base, 0.92), base], locations: [0.12, 0.38, 0.58, 0.72] }} />
    {/* The banner fades into its own colour, darkened, as Apple Music does under
        album art: the text sits on flat colour, never on linework. */}
    <VStack alignment="leading" spacing={4} modifiers={[padding({ horizontal: 18, bottom: 16 }), frame({ width, alignment: 'leading' })]}>
      <HStack alignment="center" spacing={6}>
        <StatusDotNative status="RELEASING" size={7} />
        <NativeText modifiers={[foregroundStyle('#FFFFFFD9'), font({ textStyle: 'caption', weight: 'semibold' }), monospacedDigit(), lineLimit(1)]}>{`Episodio ${episode.episode} · ${shortAiringMoment(episode.airingAt, now)}`}</NativeText>
      </HStack>
      <NativeText modifiers={[foregroundStyle('#FFFFFF'), font({ size: 46, weight: 'heavy', design: 'rounded' }), monospacedDigit(), lineLimit(1), minimumScaleFactor(0.6), contentTransition('numericText'), shadow({ radius: 10, color: '#00000099' })]}>{until}</NativeText>
      <NativeText modifiers={[foregroundStyle('#FFFFFF'), font({ textStyle: 'subheadline', weight: 'semibold' }), lineLimit(3), fixedSize({ horizontal: false, vertical: true }), shadow({ radius: 6, color: '#000000B3' })]}>{title}</NativeText>
      <HStack alignment="center" spacing={10} modifiers={[padding({ top: 6 })]}>
        <EpisodeBarNative entry={entry} width={inner - 52} ink="#FFFFFF" tokens={tokens} light />
        <NativeText modifiers={[foregroundStyle('#FFFFFFE6'), font({ textStyle: 'caption', weight: 'semibold' }), monospacedDigit(), lineLimit(1), frame({ width: 42, alignment: 'trailing' }), shadow({ radius: 6, color: '#000000B3' })]}>{seasonLabel(entry)}</NativeText>
      </HStack>
    </VStack>
  </ZStack>;
}

type WatchingKind = 'waiting' | 'next' | 'ongoing';

// One series being watched. What leads depends on its state: the episodes
// waiting, the time to the next one, or how far along a finished series is.
function WatchingCardNative({ entry, kind, tokens, now, width, onOpen, onAdvance }: { entry: LibraryEntry; kind: WatchingKind; tokens: ThemeTokens; now: Date; width: number; onOpen: () => void; onAdvance: () => void }) {
  const { fontScale } = useWindowDimensions();
  const anime = entry.anime;
  const ink = coverInk(anime.color, tokens);
  const title = animeTitle(anime.title);
  const tint = anime.color && /^#[0-9a-f]{6}$/i.test(anime.color) ? anime.color : null;
  const canAdvance = kind !== 'next' && entry.progress < watchableEpisodes(anime);
  const coverWidth = 58;
  const textWidth = width - 28 - coverWidth - 14 - (canAdvance ? CIRCLE_CONTROL_SIZE + 12 : 0);
  const behind = episodesBehind(entry);
  const next = anime.nextEpisode;

  const lead = kind === 'waiting'
    ? <HStack alignment="firstTextBaseline" spacing={6}>
      <NativeText modifiers={[foregroundStyle(ink), font({ size: 28, weight: 'heavy', design: 'rounded' }), monospacedDigit(), contentTransition('numericText')]}>{String(behind)}</NativeText>
      <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'subheadline', weight: 'medium' }), lineLimit(1)]}>{behind === 1 ? 'episodio por ver' : 'episodios por ver'}</NativeText>
    </HStack>
    : kind === 'next' && next
      ? <NativeText modifiers={[foregroundStyle(ink), font({ size: 28, weight: 'heavy', design: 'rounded' }), monospacedDigit(), lineLimit(1), minimumScaleFactor(0.7)]}>{untilLabel(next.airingAt - now.getTime() / 1000)}</NativeText>
      : <HStack alignment="firstTextBaseline" spacing={4}>
        <NativeText modifiers={[foregroundStyle(tokens.text), font({ size: 28, weight: 'heavy', design: 'rounded' }), monospacedDigit(), contentTransition('numericText')]}>{String(entry.progress)}</NativeText>
        <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'subheadline', weight: 'medium' }), monospacedDigit()]}>{`/ ${anime.episodes ?? '?'}`}</NativeText>
      </HStack>;
  // Chips instead of a sentence: ▶ the episode to watch next, 🕒 the next to air.
  // Both chips name the episode the same way: "Ep 13", "Ep 14 · Jue 10:26 a. m.".
  const watchChip = kind !== 'next' && entry.progress < watchableEpisodes(anime) ? `Ep ${entry.progress + 1}` : null;
  const airingChip = next ? `Ep ${next.episode} · ${shortAiringMoment(next.airingAt, now)}` : null;
  // Both chips share a line when they fit; otherwise the airing one drops
  // below, whole, rather than being cut. Widths are estimated at the text size.
  const chipWidth = (text: string) => 34 + text.length * 7.4 * fontScale;
  const oneLine = !watchChip || !airingChip || chipWidth(watchChip) + 6 + chipWidth(airingChip) <= textWidth;
  const chipViews = [
    watchChip ? <EpisodeChipNative key="watch" symbol="play.fill" text={watchChip} color={ink} filled tokens={tokens} /> : null,
    airingChip ? <EpisodeChipNative key="airing" symbol="clock" text={airingChip} color={ink} filled={false} tokens={tokens} /> : null,
  ];
  const chips = oneLine
    ? <HStack alignment="center" spacing={6}>{chipViews}</HStack>
    : <VStack alignment="leading" spacing={6}>{chipViews}</VStack>;
  const hasChips = (kind !== 'next' && entry.progress < watchableEpisodes(anime)) || Boolean(next);
  const detail = kind === 'waiting'
    ? `sigue el episodio ${entry.progress + 1}${next ? `, el ${next.episode} sale ${airingMoment(next.airingAt, now)}` : ''}`
    : kind === 'next' && next
      ? `episodio ${next.episode}, ${airingMoment(next.airingAt, now)}`
      : null;

  return <HStack alignment="center" spacing={12} modifiers={[
    padding({ all: 14 }),
    frame({ width, alignment: 'leading' }),
    ...(tint ? [shapeBackground({ type: 'linearGradient', colors: [withAlpha(tint, tokens.mode === 'dark' ? 0.2 : 0.12), withAlpha(tint, 0)], startPoint: { x: 0, y: 0.5 }, endPoint: { x: 1, y: 0.5 } })] : []),
    background(tokens.surface),
    clipShape('roundedRectangle', 20),
  ]}>
    <HStack alignment="center" spacing={14} modifiers={[contentShape(shapes.rectangle()), onTapGesture(onOpen), accessibilityElement('combine'), accessibilityAddTraits(['isButton']), accessibilityLabel([title, detail].filter(Boolean).join(', '))]}>
      <AnimeCoverNative uri={anime.cover} width={coverWidth} height={Math.round(coverWidth * 1.5)} radius={10} tokens={tokens} />
      <VStack alignment="leading" spacing={4} modifiers={[frame({ width: textWidth, alignment: 'leading' })]}>
        <NativeText modifiers={[...textModifiers(tokens, { style: 'subheadline', weight: 'semibold' }), lineLimit(3), fixedSize({ horizontal: false, vertical: true })]}>{title}</NativeText>
        {lead}
        {hasChips ? chips : null}
        <HStack alignment="center" spacing={8} modifiers={[padding({ top: 4 })]}>
          <EpisodeBarNative entry={entry} width={textWidth - 50} ink={ink} tokens={tokens} />
          <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'caption2', weight: 'medium' }), monospacedDigit(), lineLimit(1), frame({ width: 42, alignment: 'trailing' })]}>{seasonLabel(entry)}</NativeText>
        </HStack>
      </VStack>
    </HStack>
    {canAdvance ? <NativeCircleButton tokens={tokens} accent={kind === 'waiting'} label={`Marcar episodio ${entry.progress + 1} de ${title} como visto`} systemName="checkmark" onPress={onAdvance} /> : null}
  </HStack>;
}

// Viendo, by what matters: the next episode of a caught-up series as the hero,
// then episodes waiting to be watched, then the other upcoming episodes in
// airing order, then series that have finished airing.
function WatchingBoardNative({ entries, tokens, now, width, onOpen, onAdvance }: { entries: LibraryEntry[]; tokens: ThemeTokens; now: Date; width: number; onOpen: (id: number) => void; onAdvance: (entry: LibraryEntry) => void }) {
  const waiting = entries.filter((entry) => episodesBehind(entry) > 0).sort((a, b) => episodesBehind(b) - episodesBehind(a));
  const upcoming = entries.filter((entry) => !episodesBehind(entry) && entry.anime.nextEpisode).sort((a, b) => a.anime.nextEpisode!.airingAt - b.anime.nextEpisode!.airingAt);
  const ongoing = entries.filter((entry) => !waiting.includes(entry) && !upcoming.includes(entry)).sort((a, b) => b.updatedAt - a.updatedAt);
  const [hero, ...later] = upcoming;
  const group = (title: string, list: LibraryEntry[], kind: WatchingKind) => list.length ? <VStack key={title} alignment="leading" spacing={10} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
    <SectionHeadingNative title={title} detail={list.length > 1 ? String(list.length) : undefined} tokens={tokens} />
    {list.map((entry) => <WatchingCardNative key={entry.id} entry={entry} kind={kind} tokens={tokens} now={now} width={width} onOpen={() => onOpen(entry.id)} onAdvance={() => onAdvance(entry)} />)}
  </VStack> : null;
  return <>
    {hero ? <WatchingHeroNative entry={hero} tokens={tokens} now={now} width={width} onOpen={() => onOpen(hero.id)} /> : null}
    {group('Por ver', waiting, 'waiting')}
    {group('Después', later, 'next')}
    {group('En curso', ongoing, 'ongoing')}
  </>;
}

// Mi lista: what is being watched (see WatchingBoardNative), what is wanted
// (premieres first) and what is finished.
function MyListNative({ tokens, tab, onTabChange, onBack, onExplore, onOpen }: { tokens: ThemeTokens; tab: ListStatus; onTabChange: (tab: ListStatus) => void; onBack: () => void; onExplore: () => void; onOpen: (id: number) => void }) {
  const pageWidth = usePageWidth();
  const now = useCurrentTime();
  const nowSeconds = now.getTime() / 1000;
  const library = useAnimeLibrary();
  const setTab = onTabChange;
  useEffect(() => {
    void refreshLibrary();
  }, []);

  const of = (status: ListStatus) => library.entries.filter((entry) => entry.status === status);
  const facts = (anime: AnimeSummary) => [anime.format ? FORMAT_LABELS[anime.format] : null, anime.seasonYear ?? anime.startDate?.year ?? null, anime.score ? `★ ${scoreLabel(anime.score)}` : null].filter(Boolean).join(' · ');

  const advance = async (entry: LibraryEntry) => {
    const { saved, done } = await setProgress(entry.anime, entry.progress + 1);
    if (!alertUnsaved(saved)) return;
    void (done ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success) : Haptics.selectionAsync());
  };

  const sections: Array<{ title: string; rows: LibraryRow[]; advance?: boolean }> = [];
  if (tab === 'planning') {
    const planning = of('planning');
    const premieres = planning.filter((entry) => entry.anime.status === 'NOT_YET_RELEASED').sort((a, b) => (a.anime.nextEpisode?.airingAt ?? Number.MAX_SAFE_INTEGER) - (b.anime.nextEpisode?.airingAt ?? Number.MAX_SAFE_INTEGER));
    const available = planning.filter((entry) => entry.anime.status !== 'NOT_YET_RELEASED').sort((a, b) => b.addedAt - a.addedAt);
    sections.push(
      { title: 'Próximos estrenos', rows: premieres.map((entry) => {
        const first = entry.anime.nextEpisode;
        return { entry, primary: first ? `Estreno ${airingMoment(first.airingAt, now)}` : `Estreno ${formatFuzzyDate(entry.anime.startDate) ?? 'sin fecha'}`, primaryInk: Boolean(first), secondary: first ? `en ${untilLabel(first.airingAt - nowSeconds)}` : facts(entry.anime) };
      }) },
      { title: 'Disponibles', rows: available.map((entry) => ({ entry, primary: [entry.anime.status ? STATUS_LABELS[entry.anime.status] : null, entry.anime.episodes ? episodesLabel(entry.anime.episodes) : null].filter(Boolean).join(' · '), secondary: facts(entry.anime) })) },
    );
  } else if (tab === 'completed') {
    const completed = of('completed').sort((a, b) => (b.completedAt ?? b.updatedAt) - (a.completedAt ?? a.updatedAt));
    sections.push({ title: 'Terminados', rows: completed.map((entry) => ({ entry, primary: `Terminado ${new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'short', year: 'numeric' }).format(entry.completedAt ?? entry.updatedAt)}`, secondary: facts(entry.anime) })) });
  }
  const empty = tab === 'watching' ? !of('watching').length : !sections.some((section) => section.rows.length);

  return <PageNative title="Anime" tokens={tokens} onBack={onBack} action={<NativeCircleButton tokens={tokens} label="Explorar" systemName="magnifyingglass" onPress={onExplore} />}>
    <ScrollView modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity })]}>
      <VStack alignment="leading" spacing={24} modifiers={[frame({ width: pageWidth, alignment: 'leading' }), padding({ horizontal: UI.pageInset, top: 0, bottom: 40 })]}>
        <Picker selection={tab} onSelectionChange={(value) => setTab(value as ListStatus)} modifiers={[pickerStyle('segmented'), frame({ maxWidth: Infinity }), accessibilityLabel('Lista')]}>
          {LIST_ORDER.map((status) => {
            const count = of(status).length;
            const label = status === 'completed' ? 'Terminados' : LIST_STATUS_LABELS[status];
            return <NativeText key={status} modifiers={[tag(status)]}>{count ? `${label} ${count}` : label}</NativeText>;
          })}
        </Picker>
        {!library.ready ? <AnimeDetailSkeletonNative width={pageWidth} tokens={tokens} />
          : library.failed ? <StoreErrorNative message="No se pudo leer tu lista" tokens={tokens} onRetry={() => void loadLibrary(true)} />
          : empty ? <ContentUnavailableView title={tab === 'watching' ? 'Nada en curso' : tab === 'planning' ? 'Nada pendiente' : 'Nada terminado'} systemImage={LIST_SYMBOLS[tab]} modifiers={[frame({ maxWidth: Infinity }), padding({ vertical: 48 })]} />
          : tab === 'watching' ? <WatchingBoardNative entries={of('watching')} tokens={tokens} now={now} width={pageWidth} onOpen={onOpen} onAdvance={(entry) => void advance(entry)} />
          : sections.map((section) => <LibrarySectionNative key={section.title} title={section.title} rows={section.rows} tokens={tokens} onOpen={onOpen} onAdvance={section.advance ? (entry) => void advance(entry) : undefined} />)}
      </VStack>
    </ScrollView>
  </PageNative>;
}

// Hoy's anime section. It only appears when there is something to say:
// episodes out that have not been watched, or episodes airing today or tomorrow
// of what is being watched. It reads the saved list and refreshes it (one
// request at most) when the airing data is stale.
export function AnimeTodayNative({ tokens, now, onOpen }: { tokens: ThemeTokens; now: Date; onOpen: (id: number) => void }) {
  const library = useAnimeLibrary();
  useEffect(() => {
    void refreshLibrary();
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refreshLibrary();
    });
    return () => subscription.remove();
  }, []);
  const nowSeconds = now.getTime() / 1000;
  const horizon = nowSeconds + 36 * 3600;
  const items = library.entries
    .filter((entry) => entry.status === 'watching')
    .map((entry) => {
      const behind = episodesBehind(entry);
      const next = entry.anime.nextEpisode;
      if (behind) return { entry, order: -behind, text: behind === 1 ? `Ep ${entry.progress + 1} disponible` : `${episodesLabel(behind)} por ver`, available: true };
      if (next && next.airingAt <= horizon) return { entry, order: next.airingAt, text: `Ep ${next.episode} · ${airingMoment(next.airingAt, now)}`, available: false };
      return null;
    })
    .filter((item): item is { entry: LibraryEntry; order: number; text: string; available: boolean } => Boolean(item))
    .sort((a, b) => a.order - b.order)
    .slice(0, 4);
  if (!items.length) return null;

  return <VStack alignment="leading" spacing={12} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
    <SectionHeadingNative title="Anime" tokens={tokens} />
    <VStack alignment="leading" spacing={12} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ horizontal: 4 })]}>
      {items.map((item) => {
        const title = animeTitle(item.entry.anime.title);
        return <NativeButton key={item.entry.id} onPress={() => onOpen(item.entry.id)} modifiers={[buttonStyle('plain'), accessibilityLabel(`${title}, ${item.text}`)]}>
          <HStack alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), contentShape(shapes.rectangle())]}>
            <AnimeCoverNative uri={item.entry.anime.cover} width={36} height={54} radius={6} tokens={tokens} />
            <VStack alignment="leading" spacing={2} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
              <NativeText modifiers={[...textModifiers(tokens, { style: 'headline', weight: 'semibold' }), lineLimit(1)]}>{title}</NativeText>
              <NativeText modifiers={[...textModifiers(tokens, { color: item.available ? coverInk(item.entry.anime.color, tokens) : tokens.secondary, style: 'subheadline', weight: item.available ? 'semibold' : 'regular' }), monospacedDigit(), lineLimit(1)]}>{item.text}</NativeText>
            </VStack>
            <SymbolImage name="chevron.right" color={tokens.secondary} size={17} />
          </HStack>
        </NativeButton>;
      })}
    </VStack>
  </VStack>;
}

export function AnimeNative({ tokens, apiKey, link, onBack }: { tokens: ThemeTokens; apiKey: string; link: { id: number; nonce: number } | null; onBack: () => void }) {
  const pageWidth = usePageWidth();
  const now = useCurrentTime();
  const queryState = useNativeState('');
  const queryRef = useRef('');
  const searchInput = useRef<TextFieldRef>(null);
  const dismissKeyboard = () => void searchInput.current?.blur();
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<AnimeFilters>(DEFAULT_ANIME_FILTERS);
  const [filtersReady, setFiltersReady] = useState(false);
  const [items, setItems] = useState<AnimeSummary[]>([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [phase, setPhase] = useState<'loading' | 'more' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [filtersVisible, setFiltersVisible] = useState(false);
  // Opened anime, newest last: related titles open on top of the current one.
  const [stack, setStack] = useState<number[]>([]);
  const [peek, setPeek] = useState<AnimeSummary | null>(null);
  // Anime opens on Mi lista, which costs no request. Explorar (the catalogue)
  // only asks AniList when it is opened. With an empty list there is nothing
  // to show, so it opens on Explorar instead.
  const [exploring, setExploring] = useState(false);
  const [listTab, setListTab] = useState<ListStatus>('watching');
  const library = useAnimeLibrary();
  const decidedRoot = useRef(false);
  useEffect(() => {
    if (!library.ready || decidedRoot.current) return;
    decidedRoot.current = true;
    if (!library.entries.length && !library.failed) setExploring(true);
  }, [library.ready, library.failed, library.entries.length]);
  const listStatus = useMemo(() => new Map(library.entries.map((entry) => [entry.id, entry.status])), [library.entries]);
  // Hoy opens an anime straight from its section.
  const handledLink = useRef<number | null>(null);
  useEffect(() => {
    if (!link || handledLink.current === link.nonce) return;
    handledLink.current = link.nonce;
    setStack([link.id]);
  }, [link]);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    void loadAnimeFilters().then((stored) => {
      setFilters(stored);
      setFiltersReady(true);
    });
    return () => controller.current?.abort();
  }, []);

  const load = useCallback(async (nextPage: number, search: string, active: AnimeFilters) => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setPhase(nextPage === 1 ? 'loading' : 'more');
    setError(null);
    try {
      const result = await searchAnime({ search, filters: active, page: nextPage }, current.signal);
      if (current.signal.aborted) return;
      setItems((previous) => nextPage === 1 ? result.items : [...previous, ...result.items.filter((item) => !previous.some((existing) => existing.id === item.id))]);
      setPage(nextPage);
      setHasNext(result.hasNextPage);
      setPhase('ready');
    } catch (reason) {
      if (current.signal.aborted) return;
      if (nextPage === 1) loadedKey.current = null;
      setError(animeErrorMessage(reason));
      if (nextPage === 1) setItems([]);
      setPhase(nextPage === 1 ? 'error' : 'ready');
    }
  }, []);

  // Requests are kept to a minimum: typing waits for a pause, a single
  // letter does not search, and answers are cached in anime-api.
  const search = query.trim().length >= MIN_SEARCH_LENGTH ? query.trim() : '';
  const loadedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!filtersReady || !exploring) return;
    const key = JSON.stringify([search, filters]);
    // Coming back to Explorar keeps what it showed; nothing to ask.
    if (loadedKey.current === key) return;
    const timer = setTimeout(() => {
      loadedKey.current = key;
      void load(1, search, filters);
    }, search ? 600 : 0);
    return () => clearTimeout(timer);
  }, [search, filters, filtersReady, exploring, load]);

  const changeQuery = (value: string) => {
    queryRef.current = value;
    setQuery(value);
    queryState.set(value);
  };

  // Only called by the sheet's ✓, and only a real change asks AniList again.
  const applyFilters = (next: AnimeFilters) => {
    setFiltersVisible(false);
    if (JSON.stringify(next) === JSON.stringify(filters)) return;
    setFilters(next);
    void saveAnimeFilters(next).catch(() => undefined);
  };

  const loadMore = () => {
    if (phase === 'ready' && hasNext && !error) void load(page + 1, search, filters);
  };

  const open = (id: number) => {
    dismissKeyboard();
    setStack((current) => [...current, id]);
  };

  const columnWidth = Math.floor((pageWidth - ANIME_GRID_GAP * (ANIME_COLUMNS - 1)) / ANIME_COLUMNS);
  const rows: AnimeSummary[][] = [];
  for (let index = 0; index < items.length; index += ANIME_COLUMNS) rows.push(items.slice(index, index + ANIME_COLUMNS));
  const nowSeconds = now.getTime() / 1000;
  const filterCount = activeFilterCount(filters);
  const summary = filterSummary(filters);

  // Leaving Explorar goes to Mi lista when it has something, otherwise back to Biblioteca.
  const closeExplore = () => {
    dismissKeyboard();
    if (library.entries.length) setExploring(false);
    else onBack();
  };

  return <ZStack alignment="topLeading" modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'topLeading' })]}>
    {exploring ? null : <VStack modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity }), ...(stack.length || peek ? [accessibilityHidden()] : [])]}>
      <MyListNative tokens={tokens} tab={listTab} onTabChange={setListTab} onBack={onBack} onExplore={() => setExploring(true)} onOpen={open} />
    </VStack>}
    {exploring ? <VStack modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity }), ...(stack.length || peek ? [accessibilityHidden()] : [])]}>
      <PageNative title="Explorar" tokens={tokens} onBack={closeExplore} backLabel={library.entries.length ? 'Volver a Mi lista' : 'Volver a Miniapps'} onHeaderTap={dismissKeyboard} action={
        <NativeCircleButton tokens={tokens} accent={filterCount > 0} label={filterCount ? `Filtros, ${filterCount} activos` : 'Filtros'} systemName="line.3.horizontal.decrease" onPress={() => { dismissKeyboard(); setFiltersVisible(true); }} />
      }>
        <ScrollView modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity }), scrollDismissesKeyboard('immediately')]}>
          <VStack alignment="leading" spacing={16} modifiers={[frame({ width: pageWidth, alignment: 'leading' }), padding({ horizontal: UI.pageInset, top: 0, bottom: 32 })]}>
            <HStack alignment="center" spacing={10} modifiers={[frame({ maxWidth: Infinity, minHeight: 54 }), padding({ leading: 16, trailing: 8 }), ...(nativeGlassAvailable ? [glassEffect({ glass: { variant: 'regular' }, shape: 'capsule' })] : [background(tokens.surface), clipShape('capsule')])]}>
              <SymbolImage name="magnifyingglass" color={tokens.secondary} size={18} />
              <TextField ref={searchInput} text={queryState} onTextChange={(value) => { if (value !== queryRef.current) changeQuery(value); }} placeholder="Buscar anime" modifiers={[frame({ maxWidth: Infinity }), font({ textStyle: 'body' }), lineLimit(1), textFieldStyle('plain'), autocorrectionDisabled(), accessibilityLabel('Buscar anime'), submitLabel('search'), onSubmit(dismissKeyboard)]} />
              {/* Clearing is part of the field, like the system search bar. */}
              {query ? <NativeButton onPress={() => changeQuery('')} modifiers={[buttonStyle('plain'), frame({ width: 32, height: 44 }), contentShape(shapes.rectangle()), accessibilityLabel('Borrar búsqueda')]}>
                <NativeImage systemName="xmark.circle.fill" modifiers={[font({ size: 18 }), foregroundStyle(tokens.secondary)]} />
              </NativeButton> : null}
            </HStack>

            {summary ? <NativeButton onPress={() => setFiltersVisible(true)} modifiers={[buttonStyle('plain'), accessibilityLabel(`Filtros: ${summary}`)]}>
              <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'subheadline' }), lineLimit(2), padding({ horizontal: 4 })]}>{summary}</NativeText>
            </NativeButton> : null}

            {phase === 'loading' ? <AnimeGridSkeletonNative rows={3} columnWidth={columnWidth} tokens={tokens} /> : phase === 'error' ? <VStack alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity, minHeight: 280 })]}>
              <SymbolImage name="exclamationmark.triangle" color={tokens.danger} size={26} />
              <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'subheadline' }), multilineTextAlignment('center')]}>{error}</NativeText>
              <NativeButton label="Reintentar" onPress={() => void load(1, search, filters)} modifiers={[buttonStyle('bordered'), controlSize('regular'), tint(tokens.blue)]} />
            </VStack> : !items.length ? <ContentUnavailableView title="Sin resultados" systemImage="magnifyingglass" modifiers={[frame({ maxWidth: Infinity }), padding({ vertical: 48 })]} /> : <>
              <SectionHeadingNative title={search ? 'Resultados' : SORT_LABELS[filters.sort]} tokens={tokens} />
              {/* Lazy rows: the last one appearing asks for the next page. */}
              <LazyVStack alignment="leading" spacing={20} modifiers={[frame({ width: pageWidth, alignment: 'leading' })]}>
                {rows.map((row, index) => <HStack key={row[0].id} alignment="top" spacing={ANIME_GRID_GAP} modifiers={[frame({ width: pageWidth, alignment: 'leading' }), ...(index === rows.length - 1 ? [onAppear(loadMore)] : [])]}>
                  {row.map((anime) => <AnimeCardNative key={anime.id} anime={anime} width={columnWidth} tokens={tokens} listStatus={listStatus.get(anime.id) ?? null} onPress={() => open(anime.id)} onPeek={() => {
                    dismissKeyboard();
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    setPeek(anime);
                  }} />)}
                </HStack>)}
              </LazyVStack>
              {phase === 'more' ? <AnimeGridSkeletonNative rows={1} columnWidth={columnWidth} tokens={tokens} /> : null}
              {error ? <VStack alignment="center" spacing={10} modifiers={[frame({ maxWidth: Infinity })]}>
                <NativeText modifiers={textModifiers(tokens, { color: tokens.danger, style: 'subheadline', weight: 'medium' })}>{error}</NativeText>
                <NativeButton label="Reintentar" onPress={() => void load(page + 1, search, filters)} modifiers={[buttonStyle('bordered'), controlSize('regular'), tint(tokens.blue)]} />
              </VStack> : null}
            </>}
          </VStack>
        </ScrollView>
      </PageNative>
    </VStack> : null}
    {peek ? <AnimeSpotlightNative key={peek.id} anime={peek} tokens={tokens} nowSeconds={nowSeconds} onClose={() => setPeek(null)} onOpen={() => { setPeek(null); open(peek.id); }} /> : null}
    {stack.length ? <AnimeDetailNative key={stack.length} id={stack[stack.length - 1]} tokens={tokens} apiKey={apiKey} onBack={() => setStack((current) => current.slice(0, -1))} onOpen={open} /> : null}
    <BottomSheet isPresented={filtersVisible} onIsPresentedChange={setFiltersVisible} onDismiss={() => setFiltersVisible(false)}>
      {filtersVisible ? <AnimeFiltersSheetNative filters={filters} tokens={tokens} onApply={applyFilters} onClose={() => setFiltersVisible(false)} /> : null}
    </BottomSheet>
  </ZStack>;
}

const SORT_CHIPS: Array<{ key: AnimeSort; label: string; symbol: SFSymbol }> = [
  { key: 'TRENDING_DESC', label: 'Tendencia', symbol: 'flame.fill' },
  { key: 'POPULARITY_DESC', label: 'Popularidad', symbol: 'heart.fill' },
  { key: 'SCORE_DESC', label: 'Puntuación', symbol: 'star.fill' },
  { key: 'START_DATE_DESC', label: 'Recientes', symbol: 'calendar' },
  { key: 'TITLE_ROMAJI', label: 'A–Z', symbol: 'textformat' },
];
const SEASON_SYMBOLS: Record<AnimeSeason, SFSymbol> = { WINTER: 'snowflake', SPRING: 'camera.macro', SUMMER: 'sun.max.fill', FALL: 'leaf.fill' };
// Status reads like a traffic light: airing green, upcoming indigo, done grey.
const STATUS_ORDER: AnimeStatus[] = ['RELEASING', 'NOT_YET_RELEASED', 'FINISHED', 'HIATUS', 'CANCELLED'];
const STATUS_DOTS: Record<AnimeStatus, string> = { RELEASING: '#34C759', NOT_YET_RELEASED: '#5E5CE6', FINISHED: '#8E8E93', HIATUS: '#FF9500', CANCELLED: '#FF3B30' };
const FORMAT_SYMBOLS: Record<AnimeFormat, SFSymbol> = { TV: 'tv', TV_SHORT: 'clock', MOVIE: 'film', SPECIAL: 'gift', OVA: 'opticaldisc', ONA: 'globe', MUSIC: 'music.note' };

function FilterHeadingNative({ title, tokens, children }: { title: string; tokens: ThemeTokens; children?: ReactNode }) {
  return <HStack alignment="center" spacing={8} modifiers={[frame({ maxWidth: Infinity, minHeight: 28, alignment: 'leading' })]}>
    <NativeText modifiers={[...textModifiers(tokens, { style: 'headline', weight: 'semibold' }), accessibilityAddTraits(['isHeader'])]}>{title}</NativeText>
    <Spacer />
    {children ?? null}
  </HStack>;
}

// The sheet edits a draft; nothing is asked of AniList until ✓. Closing it by
// swiping down discards the draft.
function AnimeFiltersSheetNative({ filters: applied, tokens, onApply, onClose }: { filters: AnimeFilters; tokens: ThemeTokens; onApply: (filters: AnimeFilters) => void; onClose: () => void }) {
  const [filters, setDraft] = useState(applied);
  const onChange = setDraft;
  const { width: screenWidth } = useWindowDimensions();
  const width = Math.min(screenWidth, UI.contentWidth) - SHEET_ACTION_INSET * 2;
  const current = currentAnimeSeason();
  const lastYear = current.year + 1;
  const years = useMemo(() => Array.from({ length: lastYear - 1969 }, (_, index) => lastYear - index), [lastYear]);
  const set = (patch: Partial<AnimeFilters>) => onChange({ ...filters, ...patch });
  const isCurrent = filters.season === current.season && filters.year === current.year;
  const tileWidth = Math.floor((width - CHIP_GAP * 3) / 4);

  const sortChips: FilterChip[] = SORT_CHIPS.map((item) => ({ key: item.key, label: item.label, symbol: item.symbol, selected: filters.sort === item.key, onPress: () => set({ sort: item.key }) }));
  // Tapping the selected chip again clears that filter.
  const statusChips: FilterChip[] = STATUS_ORDER.map((key) => ({ key, label: STATUS_LABELS[key], dot: STATUS_DOTS[key], selected: filters.status === key, onPress: () => set({ status: filters.status === key ? null : key }) }));
  const formatChips: FilterChip[] = (Object.keys(FORMAT_LABELS) as AnimeFormat[]).map((key) => ({ key, label: FORMAT_LABELS[key], symbol: FORMAT_SYMBOLS[key], selected: filters.format === key, onPress: () => set({ format: filters.format === key ? null : key }) }));
  const genreChips: FilterChip[] = ANIME_GENRES.map((genre) => {
    const selected = filters.genres.includes(genre.key);
    return { key: genre.key, label: genre.label, selected, onPress: () => set({ genres: selected ? filters.genres.filter((key) => key !== genre.key) : [...filters.genres, genre.key] }) };
  });

  return <Group modifiers={[presentationDetents(['medium', 'large']), presentationDragIndicator('visible')]}>
    <VStack spacing={0} modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'top' }), background(tokens.background)]}>
      <HStack alignment="center" spacing={12} modifiers={[padding({ all: SHEET_ACTION_INSET })]}>
        <NativeCircleButton tokens={tokens} label="Restablecer filtros" systemName="arrow.counterclockwise" onPress={() => onChange(DEFAULT_ANIME_FILTERS)} disabled={!activeFilterCount(filters)} />
        <Spacer />
        <NativeText modifiers={[...textModifiers(tokens, { style: 'headline', weight: 'semibold' }), accessibilityAddTraits(['isHeader'])]}>Filtros</NativeText>
        <Spacer />
        <NativeCircleButton tokens={tokens} accent label="Aplicar filtros" systemName="checkmark" onPress={() => onApply(filters)} />
      </HStack>
      <ScrollView modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity })]}>
        <VStack alignment="leading" spacing={28} modifiers={[frame({ width, alignment: 'leading' }), padding({ horizontal: SHEET_ACTION_INSET, top: 4, bottom: 36 })]}>
          <VStack alignment="leading" spacing={12}>
            <FilterHeadingNative title="Orden" tokens={tokens} />
            <FilterChipsNative chips={sortChips} width={width} tokens={tokens} />
          </VStack>

          <VStack alignment="leading" spacing={12}>
            <FilterHeadingNative title="Temporada" tokens={tokens}>
              <NativeButton label="Actual" onPress={() => set({ season: current.season, year: current.year })} modifiers={[buttonStyle('borderless'), tint(tokens.blue), disabled(isCurrent), accessibilityLabel(`Temporada actual, ${SEASON_LABELS[current.season]} ${current.year}`)]} />
            </FilterHeadingNative>
            <HStack alignment="center" spacing={CHIP_GAP}>
              {(Object.keys(SEASON_LABELS) as AnimeSeason[]).map((key) => {
                const selected = filters.season === key;
                return <NativeButton key={key} onPress={() => set({ season: selected ? null : key })} modifiers={[buttonStyle('plain'), accessibilityLabel(SEASON_LABELS[key]), ...(selected ? [accessibilityAddTraits(['isSelected'])] : [])]}>
                  <VStack alignment="center" spacing={6} modifiers={[frame({ width: tileWidth, height: 76 }), background(selected ? tokens.blue : tokens.surface), clipShape('roundedRectangle', 16), contentShape(shapes.rectangle())]}>
                    <NativeImage systemName={SEASON_SYMBOLS[key]} modifiers={[font({ textStyle: 'title3' }), foregroundStyle(selected ? tokens.inverseText : tokens.secondary)]} />
                    <NativeText modifiers={[...textModifiers(tokens, { color: selected ? tokens.inverseText : tokens.text, style: 'footnote', weight: 'semibold' }), lineLimit(1), minimumScaleFactor(0.8)]}>{SEASON_LABELS[key]}</NativeText>
                  </VStack>
                </NativeButton>;
              })}
            </HStack>
            {/* Tapping the year opens the full list; the arrows step one year. */}
            <HStack alignment="center" spacing={12} modifiers={[frame({ width, minHeight: CIRCLE_CONTROL_SIZE })]}>
              <NativeCircleButton tokens={tokens} label="Año anterior" systemName="chevron.left" onPress={() => set({ year: filters.year ? filters.year - 1 : current.year })} disabled={filters.year === 1970} />
              <Spacer />
              <Menu label={
                <HStack alignment="center" spacing={6}>
                  <NativeText modifiers={filters.year
                    ? [foregroundStyle(tokens.text), font({ textStyle: 'title2', weight: 'bold', design: 'rounded' }), monospacedDigit(), contentTransition('numericText')]
                    : textModifiers(tokens, { color: tokens.secondary, style: 'headline', weight: 'medium' })}>{filters.year ? String(filters.year) : 'Cualquier año'}</NativeText>
                  <NativeImage systemName="chevron.up.chevron.down" modifiers={[font({ textStyle: 'footnote', weight: 'semibold' }), foregroundStyle(tokens.secondary)]} />
                </HStack>
              } modifiers={[accessibilityLabel(filters.year ? `Año ${filters.year}` : 'Año, cualquiera')]}>
                <NativeButton label="Cualquier año" onPress={() => set({ year: null })} />
                {years.map((year) => <NativeButton key={year} label={String(year)} systemImage={filters.year === year ? 'checkmark' : undefined} onPress={() => set({ year })} />)}
              </Menu>
              <Spacer />
              <NativeCircleButton tokens={tokens} label="Año siguiente" systemName="chevron.right" onPress={() => set({ year: filters.year ? filters.year + 1 : current.year })} disabled={filters.year === lastYear} />
            </HStack>
          </VStack>

          <VStack alignment="leading" spacing={12}>
            <FilterHeadingNative title="Estado" tokens={tokens} />
            <FilterChipsNative chips={statusChips} width={width} tokens={tokens} />
          </VStack>

          <VStack alignment="leading" spacing={12}>
            <FilterHeadingNative title="Formato" tokens={tokens} />
            <FilterChipsNative chips={formatChips} width={width} tokens={tokens} />
          </VStack>

          <VStack alignment="leading" spacing={12}>
            <FilterHeadingNative title="Géneros" tokens={tokens}>
              {filters.genres.length ? <NativeButton label="Quitar" onPress={() => set({ genres: [] })} modifiers={[buttonStyle('borderless'), tint(tokens.blue), accessibilityLabel('Quitar géneros')]} /> : null}
            </FilterHeadingNative>
            <FilterChipsNative chips={genreChips} width={width} tokens={tokens} />
          </VStack>
        </VStack>
      </ScrollView>
    </VStack>
  </Group>;
}

function InfoRowNative({ label, value, tokens }: { label: string; value: string; tokens: ThemeTokens }) {
  return <HStack alignment="firstTextBaseline" spacing={16} modifiers={[frame({ maxWidth: Infinity, minHeight: 44 }), padding({ horizontal: 4 }), accessibilityElement('combine')]}>
    <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary })}>{label}</NativeText>
    <Spacer />
    <NativeText modifiers={[...textModifiers(tokens), multilineTextAlignment('trailing')]}>{value}</NativeText>
  </HStack>;
}

function AnimeDetailNative({ id, tokens, apiKey, onBack, onOpen }: { id: number; tokens: ThemeTokens; apiKey: string; onBack: () => void; onOpen: (id: number) => void }) {
  const pageWidth = usePageWidth();
  const now = useCurrentTime();
  const [anime, setAnime] = useState<AnimeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [translation, setTranslation] = useState<string | null>(null);
  const [showTranslation, setShowTranslation] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const [allEpisodes, setAllEpisodes] = useState(false);
  // Services in the chosen country from JustWatch, or AniList's worldwide links
  // (`global`) when JustWatch fails. Null while it is being looked up.
  const [streaming, setStreaming] = useState<{ services: StreamingService[]; global: boolean } | null>(null);
  const [country, setCountry] = useState<string | null>(null);
  // The header title fades in while the large title beside the cover scrolls
  // under the header, in steps of a tenth so scrolling does not re-render every frame.
  const [titleReveal, setTitleReveal] = useState(0);
  const scrollGeometry = useScrollGeometryChange((geometry) => {
    const next = Math.round(Math.min(1, Math.max(0, (geometry.contentOffsetY - TITLE_REVEAL_START) / TITLE_REVEAL_SPAN)) * 10) / 10;
    setTitleReveal((current) => (current === next ? current : next));
  });

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    getAnime(id, controller.signal).then((detail) => {
      setAnime(detail);
      // Opening a saved anime keeps its copy in Mi lista current, at no extra request.
      updateLibrarySnapshot(detail);
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(animeErrorMessage(reason));
    });
    return () => controller.abort();
  }, [id, attempt]);

  useEffect(() => {
    void loadStreamingCountry().then(setCountry);
  }, []);

  useEffect(() => {
    if (!anime || anime.id !== id || !country) return;
    const controller = new AbortController();
    setStreaming(null);
    streamingIn(anime, country, controller.signal)
      .then((services) => setStreaming({ services, global: false }))
      .catch(() => {
        if (!controller.signal.aborted) setStreaming({ services: anime.streaming, global: true });
      });
    return () => controller.abort();
  }, [anime, id, country]);

  const chooseCountry = (code: string) => {
    if (code === country) return;
    setCountry(code);
    void saveStreamingCountry(code);
  };

  // A synopsis translated before is shown in Spanish straight away; it costs nothing.
  useEffect(() => {
    void cachedTranslation(id).then((text) => {
      if (!text) return;
      setTranslation(text);
      setShowTranslation(true);
    });
  }, [id]);

  const translate = async () => {
    if (translation) {
      setShowTranslation((value) => !value);
      return;
    }
    if (!anime?.description || translating) return;
    if (!apiKey.trim()) {
      setTranslateError('Agrega la clave de Gemini en Ajustes.');
      return;
    }
    setTranslating(true);
    setTranslateError(null);
    try {
      setTranslation(await translateSynopsis(id, anime.description, apiKey));
      setShowTranslation(true);
    } catch (reason) {
      console.warn('Traducción de sinopsis', reason);
      setTranslateError(translationErrorMessage(reason));
    } finally {
      setTranslating(false);
    }
  };

  const nowSeconds = now.getTime() / 1000;
  const ink = coverInk(anime?.color ?? null, tokens);
  const library = useAnimeLibrary();
  const listEntry = library.entries.find((entry) => entry.id === id) ?? null;

  const body = (() => {
    if (!anime) {
      return error ? <VStack alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity, minHeight: 320 })]}>
        <SymbolImage name="exclamationmark.triangle" color={tokens.danger} size={26} />
        <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'subheadline' }), multilineTextAlignment('center')]}>{error}</NativeText>
        <NativeButton label="Reintentar" onPress={() => setAttempt((value) => value + 1)} modifiers={[buttonStyle('bordered'), controlSize('regular'), tint(tokens.blue)]} />
      </VStack> : <AnimeDetailSkeletonNative width={pageWidth} tokens={tokens} />;
    }

    const title = animeTitle(anime.title);
    const altTitle = [anime.title.romaji, anime.title.native].find((value) => value && value !== title) ?? null;
    const period = [anime.season ? SEASON_LABELS[anime.season] : null, anime.seasonYear].filter(Boolean).join(' ');
    const coverWidth = 120;
    const next = anime.nextEpisode;
    const start = formatFuzzyDate(anime.startDate);
    const end = formatFuzzyDate(anime.endDate);
    const aired = anime.episodeList.filter((episode) => episode.airingAt != null && episode.airingAt <= nowSeconds).length;
    const info: Array<[string, string | null]> = [
      ['Episodios', anime.episodes ? (anime.status === 'RELEASING' && aired ? `${aired} de ${anime.episodes}` : String(anime.episodes)) : anime.status === 'RELEASING' && next && next.episode > 1 ? `${next.episode - 1} emitidos` : null],
      ['Duración', anime.duration ? `${anime.duration} min${anime.format === 'MOVIE' ? '' : ' por episodio'}` : null],
      ['Emisión', start ? (end && end !== start ? `${start} – ${end}` : start) : null],
      ['Estudio', anime.studios.join(', ') || null],
      ['Origen', anime.source],
    ];

    // Collapsed, the list shows a window that keeps the next episode in view.
    const episodes = anime.episodeList;
    const nextIndex = episodes.findIndex((episode) => episode.airingAt != null && episode.airingAt > nowSeconds);
    const windowStart = nextIndex > EPISODES_COLLAPSED - 3 ? Math.min(nextIndex - (EPISODES_COLLAPSED - 3), episodes.length - EPISODES_COLLAPSED) : 0;
    const collapsible = episodes.length > EPISODES_COLLAPSED + 1;
    const visibleEpisodes = collapsible && !allEpisodes ? episodes.slice(windowStart, windowStart + EPISODES_COLLAPSED) : episodes;
    const relationWidth = 100;

    return <>
      <HStack alignment="top" spacing={16} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
        <AnimeCoverNative uri={anime.cover} width={coverWidth} height={coverWidth * 1.5} radius={14} tokens={tokens} />
        <VStack alignment="leading" spacing={6} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
          <NativeText modifiers={[...textModifiers(tokens, { style: 'title2', weight: 'bold' }), lineLimit(5), minimumScaleFactor(0.8)]}>{title}</NativeText>
          {altTitle ? <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'subheadline' }), lineLimit(2)]}>{altTitle}</NativeText> : null}
          <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'subheadline' })}>{[anime.format ? FORMAT_LABELS[anime.format] : null, period || null].filter(Boolean).join(' · ')}</NativeText>
          <HStack alignment="center" spacing={10}>
            {anime.status ? <HStack alignment="center" spacing={6}>
              <StatusDotNative status={anime.status} />
              <NativeText modifiers={textModifiers(tokens, { color: ink, style: 'subheadline', weight: 'semibold' })}>{STATUS_LABELS[anime.status]}</NativeText>
            </HStack> : null}
            {anime.score ? <HStack alignment="center" spacing={3} modifiers={[accessibilityElement('ignore'), accessibilityLabel(`Puntuación ${anime.score} de 100`)]}>
              <NativeImage systemName="star.fill" modifiers={[font({ textStyle: 'caption' }), foregroundStyle(tokens.mode === 'dark' ? '#FFD60A' : '#E0A800')]} />
              <NativeText modifiers={[...textModifiers(tokens, { style: 'subheadline', weight: 'semibold' }), monospacedDigit()]}>{scoreLabel(anime.score)}</NativeText>
            </HStack> : null}
          </HStack>
        </VStack>
      </HStack>

      <ListControlsNative anime={anime} tokens={tokens} ink={ink} />

      {anime.genres.length ? <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'subheadline' }), padding({ horizontal: 4 })]}>{anime.genres.map(genreLabel).join(' · ')}</NativeText> : null}

      {next ? <VStack alignment="leading" spacing={4} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ horizontal: 4 }), accessibilityElement('combine')]}>
        <NativeText modifiers={textModifiers(tokens, { color: ink, style: 'subheadline', weight: 'bold' })}>{anime.episodes ? `Episodio ${next.episode} de ${anime.episodes}` : `Episodio ${next.episode}`}</NativeText>
        <NativeText modifiers={[foregroundStyle(tokens.text), font({ size: 40, weight: 'heavy', design: 'rounded' }), monospacedDigit(), minimumScaleFactor(0.6), lineLimit(1)]}>{untilLabel(next.airingAt - nowSeconds)}</NativeText>
        <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'body' }), monospacedDigit()]}>{capitalize(airingDate(next.airingAt))}</NativeText>
      </VStack> : null}

      {/* The heading is the country picker: "Dónde ver en 🇵🇪 Perú". With AniList's
          worldwide links there is no country to pick, so it reads "Dónde ver". */}
      {country && (!streaming || !streaming.global || streaming.services.length) ? <VStack alignment="leading" spacing={12} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
        {streaming?.global
          ? <SectionHeadingNative title="Dónde ver" tokens={tokens} />
          : <HStack alignment="firstTextBaseline" spacing={6} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ horizontal: 4 })]}>
            <NativeText modifiers={[...textModifiers(tokens, { style: 'title3', weight: 'bold' }), accessibilityAddTraits(['isHeader'])]}>Dónde ver en</NativeText>
            <Menu label={
              <HStack alignment="firstTextBaseline" spacing={5}>
                <NativeText modifiers={textModifiers(tokens, { style: 'title3', weight: 'bold' })}>{countryFlag(country)}</NativeText>
                <NativeText modifiers={textModifiers(tokens, { color: tokens.blue, style: 'title3', weight: 'bold' })}>{countryName(country)}</NativeText>
                <NativeImage systemName="chevron.up.chevron.down" modifiers={[font({ textStyle: 'footnote', weight: 'semibold' }), foregroundStyle(tokens.blue)]} />
              </HStack>
            } modifiers={[menuIndicator('hidden'), accessibilityLabel(`País, ${countryName(country)}`)]}>
              {STREAMING_COUNTRIES.map((option) => <NativeButton key={option.code} label={`${countryFlag(option.code)}  ${option.name}`} systemImage={option.code === country ? 'checkmark' : undefined} onPress={() => chooseCountry(option.code)} />)}
            </Menu>
            <Spacer />
            {!streaming ? <ProgressView modifiers={[controlSize('small')]} /> : null}
          </HStack>}
        {streaming && !streaming.global && !streaming.services.length
          ? <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'body' }), padding({ horizontal: 4 })]}>{`No está en ningún servicio de ${countryName(country)}.`}</NativeText>
          : null}
        {streaming?.services.length ? <ScrollView axes="horizontal" showsIndicators={false} modifiers={[frame({ width: pageWidth })]}>
          <HStack alignment="top" spacing={14}>
            {streaming.services.map((service) => <NativeButton key={service.site} onPress={() => void Linking.openURL(service.url).catch(() => undefined)} modifiers={[buttonStyle('plain'), accessibilityLabel(`Ver en ${service.site}`)]}>
              <VStack alignment="center" spacing={6} modifiers={[frame({ width: 78, alignment: 'top' }), contentShape(shapes.rectangle())]}>
                {service.logo
                  ? <VStack modifiers={[frame({ width: 56, height: 56 }), clipShape('roundedRectangle', 14), accessibilityHidden()]}><RNHostView><RNImage source={{ uri: service.logo }} style={{ flex: 1 }} resizeMode="cover" /></RNHostView></VStack>
                  /* AniList's service icons are white marks meant for the brand colour. */
                  : <ZStack alignment="center" modifiers={[frame({ width: 56, height: 56 }), background(service.color ?? tokens.slate), clipShape('roundedRectangle', 14)]}>
                  {service.icon
                    ? <VStack modifiers={[frame({ width: 30, height: 30 }), accessibilityHidden()]}><RNHostView><RNImage source={{ uri: service.icon }} style={{ flex: 1 }} resizeMode="contain" /></RNHostView></VStack>
                    : <NativeText modifiers={[foregroundStyle('#FFFFFF'), font({ textStyle: 'title3', weight: 'bold', design: 'rounded' })]}>{service.site.charAt(0)}</NativeText>}
                </ZStack>}
                <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'caption', weight: 'medium' }), lineLimit(2), multilineTextAlignment('center')]}>{service.site}</NativeText>
              </VStack>
            </NativeButton>)}
          </HStack>
        </ScrollView> : null}
      </VStack> : null}

      {anime.description ? <VStack alignment="leading" spacing={10} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
        <HStack alignment="center" spacing={8} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ leading: 4 })]}>
          <NativeText modifiers={[...textModifiers(tokens, { style: 'title3', weight: 'bold' }), accessibilityAddTraits(['isHeader'])]}>Sinopsis</NativeText>
          <Spacer />
          <NativeCircleButton tokens={tokens} accent={Boolean(translation && showTranslation)} label={translation && showTranslation ? 'Ver sinopsis original' : 'Traducir sinopsis'} systemName="translate" onPress={() => void translate()} busy={translating} />
        </HStack>
        <NativeText modifiers={[...textModifiers(tokens, { style: 'body' }), padding({ horizontal: 4 })]}>{translation && showTranslation ? translation : anime.description}</NativeText>
        {translateError ? <HStack alignment="firstTextBaseline" spacing={8} modifiers={[padding({ horizontal: 4 })]}>
          <SymbolImage name="exclamationmark.circle.fill" color={tokens.danger} size={18} />
          <NativeText modifiers={textModifiers(tokens, { color: tokens.danger, style: 'subheadline', weight: 'medium' })}>{translateError}</NativeText>
        </HStack> : null}
      </VStack> : null}

      {episodes.length ? <VStack alignment="leading" spacing={6} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
        <SectionHeadingNative title="Episodios" detail={String(episodes.length)} tokens={tokens} />
        {visibleEpisodes.map((episode, index) => {
          const upcoming = episode.airingAt != null && episode.airingAt > nowSeconds;
          const isNext = next?.episode === episode.number;
          const date = episode.airingAt == null ? null : isNext ? `${capitalize(airingDate(episode.airingAt))} · en ${untilLabel(episode.airingAt - nowSeconds)}` : airingDate(episode.airingAt, !upcoming);
          const seen = Boolean(listEntry && listEntry.status !== 'planning' && episode.number <= listEntry.progress);
          // Tapping an aired episode marks everything up to it as seen; tapping
          // the last one seen steps back one.
          const mark = () => {
            void Haptics.selectionAsync();
            void setProgress(anime, seen && listEntry?.progress === episode.number ? episode.number - 1 : episode.number).then(({ saved }) => alertUnsaved(saved));
          };
          return <VStack key={episode.number} spacing={0} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
            {index > 0 ? <Divider /> : null}
            <HStack alignment="firstTextBaseline" spacing={12} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ horizontal: 4, vertical: 10 }), contentShape(shapes.rectangle()), ...(upcoming ? [] : [onTapGesture(mark), accessibilityAddTraits(['isButton']), accessibilityHint(seen ? 'Visto' : 'Toca para marcar hasta aquí como visto')]), accessibilityElement('combine')]}>
              <NativeText modifiers={[foregroundStyle(isNext ? ink : upcoming ? tokens.secondary : tokens.text), font({ textStyle: 'headline', weight: 'bold', design: 'rounded' }), monospacedDigit(), frame({ minWidth: 30, alignment: 'leading' })]}>{String(episode.number)}</NativeText>
              <VStack alignment="leading" spacing={2} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
                <NativeText modifiers={[...textModifiers(tokens, { color: upcoming && !isNext ? tokens.secondary : tokens.text, style: 'body', weight: isNext ? 'semibold' : 'regular' }), lineLimit(2)]}>{episode.title ?? `Episodio ${episode.number}`}</NativeText>
                {date ? <NativeText modifiers={[...textModifiers(tokens, { color: isNext ? ink : tokens.secondary, style: 'footnote', weight: isNext ? 'semibold' : 'regular' }), monospacedDigit()]}>{date}</NativeText> : null}
              </VStack>
              {seen ? <NativeImage systemName="checkmark.circle.fill" modifiers={[font({ textStyle: 'body' }), foregroundStyle(ink), accessibilityHidden()]} /> : null}
            </HStack>
          </VStack>;
        })}
        {collapsible ? <NativeButton label={allEpisodes ? 'Mostrar menos' : `Mostrar los ${episodes.length}`} onPress={() => setAllEpisodes((value) => !value)} modifiers={[buttonStyle('borderless'), tint(tokens.blue), padding({ horizontal: 4, top: 4 })]} /> : null}
      </VStack> : null}

      {info.some(([, value]) => value) ? <VStack alignment="leading" spacing={4} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
        <SectionHeadingNative title="Información" tokens={tokens} />
        {info.filter(([, value]) => value).map(([label, value], index) => <VStack key={label} spacing={0} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
          {index > 0 ? <Divider /> : null}
          <InfoRowNative label={label} value={value as string} tokens={tokens} />
        </VStack>)}
      </VStack> : null}

      {anime.relations.length ? <VStack alignment="leading" spacing={12} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
        <SectionHeadingNative title="Relacionados" tokens={tokens} />
        <ScrollView axes="horizontal" showsIndicators={false} modifiers={[frame({ width: pageWidth })]}>
          <HStack alignment="top" spacing={12}>
            {anime.relations.map((relation) => <NativeButton key={relation.id} onPress={() => onOpen(relation.id)} modifiers={[buttonStyle('plain'), accessibilityLabel(`${relation.relation}: ${animeTitle(relation.title)}`)]}>
              <VStack alignment="leading" spacing={4} modifiers={[frame({ width: relationWidth, alignment: 'topLeading' }), contentShape(shapes.rectangle())]}>
                <AnimeCoverNative uri={relation.cover} width={relationWidth} height={relationWidth * 1.5} radius={10} tokens={tokens} />
                <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'caption', weight: 'semibold' }), lineLimit(1)]}>{relation.relation}</NativeText>
                <NativeText modifiers={[...textModifiers(tokens, { style: 'footnote', weight: 'semibold' }), lineLimit(2)]}>{animeTitle(relation.title)}</NativeText>
                <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'caption' }), lineLimit(1)]}>{[relation.format ? FORMAT_LABELS[relation.format] : null, relation.year].filter(Boolean).join(' · ')}</NativeText>
              </VStack>
            </NativeButton>)}
          </HStack>
        </ScrollView>
      </VStack> : null}
    </>;
  })();

  return <PageNative title={anime ? animeTitle(anime.title) : ''} titleOpacity={titleReveal} tokens={tokens} onBack={onBack} backLabel="Volver" ambient={anime?.color ?? null}>
    <ScrollView modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity }), ...(scrollGeometry ? [scrollGeometry] : [])]}>
      <VStack alignment="leading" spacing={24} modifiers={[frame({ width: pageWidth, alignment: 'leading' }), padding({ horizontal: UI.pageInset, top: 4, bottom: 40 })]}>{body}</VStack>
    </ScrollView>
  </PageNative>;
}
