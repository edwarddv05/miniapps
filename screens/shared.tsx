// Theme, layout primitives and helpers shared by the iOS screens.

import { Background, BottomSheet, Button as NativeButton, Form, GlassEffectContainer, Group, HStack, Mask, Image as NativeImage, ProgressView, ScrollView, Spacer, Text as NativeText, VStack, ZStack } from '@expo/ui/swift-ui';
import { accessibilityLabel, accessibilityAddTraits, accessibilityElement, accessibilityHidden, blur, buttonBorderShape, buttonStyle, clipShape, contentShape, controlSize, disabled, font, frame, ignoreSafeArea, lineLimit, listStyle, monospacedDigit, multilineTextAlignment, offset, onTapGesture, opacity, padding, presentationDetents, presentationDragIndicator, scrollContentBackground, shapes, type ViewModifier } from '@expo/ui/swift-ui/modifiers';
import type { SFSymbol } from 'sf-symbols-typescript';
import { ReactNode, useState } from 'react';
import { Alert, Platform, PlatformColor, useWindowDimensions, type ColorValue } from 'react-native';
import { classesClash, formatScheduleTime, sameCourse, type DayIndex, type ScheduleColor, type ScheduleEntry } from '../schedule-data';
import { UI } from '../ui-structure';
import { background, foregroundStyle, tint } from '../native-colors';
import { background as shapeBackground, scrollClipDisabled, zIndex } from '@expo/ui/swift-ui/modifiers';

export type ThemeMode = 'system' | 'light' | 'dark';
export type Screen = 'home' | 'miniapps' | 'settings';
export type ScheduleView = 'day' | 'week';

export type ThemeTokens = {
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

export const THEME_KEY = '@miniapps/theme';
export const DATA_SAVER_KEY = '@miniapps/data-saver';
export const SCRIPT_SHAKE_KEY = '@miniapps/script-shake';
export const SHEET_ACTION_INSET = UI.sheetActionInset;
export const CIRCLE_CONTROL_SIZE = UI.circleControlSize;
// Keep the label box smaller than the outer control so SwiftUI's glass style
// can contribute its own insets without changing the diameter per symbol.
const CIRCLE_ICON_LAYOUT_SIZE = 16;

export const DAYS: Array<{ initial: string; short: string; long: string; index: DayIndex }> = [
  { initial: 'L', short: 'Lun', long: 'Lunes', index: 0 },
  { initial: 'M', short: 'Mar', long: 'Martes', index: 1 },
  { initial: 'X', short: 'Mié', long: 'Miércoles', index: 2 },
  { initial: 'J', short: 'Jue', long: 'Jueves', index: 3 },
  { initial: 'V', short: 'Vie', long: 'Viernes', index: 4 },
  { initial: 'S', short: 'Sáb', long: 'Sábado', index: 5 },
  { initial: 'D', short: 'Dom', long: 'Domingo', index: 6 },
];

// Class colours are the app's colour: they tint Hoy, fill the week grid and
// mark agenda rows. Values are iOS's system hues, light and dark, kept as hex
// so tints and halos can be derived from them.
const COLORS: Array<{ key: ScheduleColor; label: string; light: string; dark: string }> = [
  { key: 'red', label: 'Rojo', light: '#FF3B30', dark: '#FF453A' },
  { key: 'orange', label: 'Naranja', light: '#FF9500', dark: '#FF9F0A' },
  { key: 'yellow', label: 'Amarillo', light: '#FFCC00', dark: '#FFD60A' },
  { key: 'green', label: 'Verde', light: '#34C759', dark: '#30D158' },
  { key: 'teal', label: 'Turquesa', light: '#30B0C7', dark: '#40CBE0' },
  { key: 'blue', label: 'Azul', light: '#007AFF', dark: '#0A84FF' },
  { key: 'indigo', label: 'Índigo', light: '#5856D6', dark: '#5E5CE6' },
  { key: 'purple', label: 'Morado', light: '#AF52DE', dark: '#BF5AF2' },
  { key: 'pink', label: 'Rosa', light: '#FF2D55', dark: '#FF375F' },
  { key: 'brown', label: 'Marrón', light: '#A2845E', dark: '#AC8E68' },
];

type Moment = 'morning' | 'afternoon' | 'night';

// The page ground is never flat white or black: a faint tint that follows the
// time of day, warm in the morning, neutral in the afternoon, indigo at night.
const GROUNDS: Record<Moment, { light: string; dark: string }> = {
  morning: { light: '#F3F1EC', dark: '#12110F' },
  afternoon: { light: '#EEF1F5', dark: '#0F1217' },
  night: { light: '#ECEBF5', dark: '#0D0C18' },
};

export function momentFor(date: Date): Moment {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 19) return 'afternoon';
  return 'night';
}

// `blue` is the app accent (ink indigo); the key name is kept so call sites stay stable.
const LIGHT: ThemeTokens = {
  mode: 'light',
  background: GROUNDS.afternoon.light,
  surface: '#FFFFFF',
  surfaceRaised: '#FFFFFF',
  text: PlatformColor('label'),
  secondary: PlatformColor('secondaryLabel'),
  muted: PlatformColor('secondaryLabel'),
  border: PlatformColor('separator'),
  slate: '#3A3F4B',
  slateSoft: '#E4E6EC',
  blue: '#4338CA',
  blueSoft: '#E5E3FA',
  sage: '#486553',
  sageSoft: '#DCE9DF',
  danger: '#B42318',
  inverseText: '#FFFFFF',
};

const DARK: ThemeTokens = {
  mode: 'dark',
  background: GROUNDS.afternoon.dark,
  surface: '#1B1A26',
  surfaceRaised: '#2A2938',
  text: PlatformColor('label'),
  secondary: PlatformColor('secondaryLabel'),
  muted: PlatformColor('secondaryLabel'),
  border: PlatformColor('separator'),
  slate: '#C4C8D4',
  slateSoft: '#2A2938',
  blue: '#A5A1FF',
  blueSoft: '#27254A',
  sage: '#B3D5BE',
  sageSoft: '#294033',
  danger: '#FF8E86',
  inverseText: '#14123A',
};

export const nativeGlassAvailable = Number(Platform.Version) >= 26;

export function getTokens(themeMode: ThemeMode, systemScheme: 'light' | 'dark' | 'unspecified' | null | undefined, moment: Moment): ThemeTokens {
  const base = themeMode === 'dark' || (themeMode === 'system' && systemScheme === 'dark') ? DARK : LIGHT;
  return { ...base, background: GROUNDS[moment][base.mode] };
}

function hexChannels(hex: string) {
  return [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
}

// Blends a colour toward another; used to derive readable ink from a class hue.
export function mixHex(hex: string, target: string, amount: number) {
  const from = hexChannels(hex);
  const to = hexChannels(target);
  return `#${from.map((value, index) => Math.round(value + (to[index] - value) * amount).toString(16).padStart(2, '0')).join('')}`;
}

export function withAlpha(hex: string, alpha: number) {
  return `${hex}${Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, '0')}`;
}

// Mixes a #RRGGBB colour toward black; 0.62 keeps the hue while white text on it
// stays above 4.5:1 even for pale anime colours.
export function darken(hex: string, amount: number) {
  const channel = (i: number) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - amount)).toString(16).padStart(2, '0');
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

export function currentDayIndex(): DayIndex {
  return ((new Date().getDay() + 6) % 7) as DayIndex;
}

export function capitalize(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

export function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function minutesFromTime(value: string) {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

export function isValidTime(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function sortedEntries(entries: ScheduleEntry[]) {
  return [...entries].sort((a, b) => a.start.localeCompare(b.start));
}

export function timeToDate(value: string) {
  const [hours, minutes] = value.split(':').map(Number);
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date;
}

export function dateToTime(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function durationLabel(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${Math.max(1, rest)} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export function timeRange(entry: ScheduleEntry) {
  return `${formatScheduleTime(entry.start)} – ${formatScheduleTime(entry.end)}`;
}

// First class on a following day, used when today has nothing left.
export function nextClassAfterToday(entries: ScheduleEntry[], today: DayIndex) {
  for (let offset = 1; offset <= 7; offset++) {
    const day = ((today + offset) % 7) as DayIndex;
    const first = sortedEntries(entries.filter((entry) => entry.day === day))[0];
    if (first) return { entry: first, offset };
  }
  return null;
}

export function findConflict(entry: ScheduleEntry, others: ScheduleEntry[]) {
  return others.find((item) => classesClash(entry, item));
}

export function colorForKey(key: ScheduleColor, mode: 'light' | 'dark' = 'light') {
  const match = COLORS.find((item) => item.key === key) ?? COLORS[6];
  const main = mode === 'dark' ? match.dark : match.light;
  // Ink keeps the hue but reaches text contrast on the tinted grounds.
  const ink = mode === 'dark' ? mixHex(main, '#FFFFFF', 0.4) : mixHex(main, '#000000', 0.35);
  return { main, ink, label: match.label };
}

export function ColorSwatchesNative({ selection, tokens, onChange }: { selection: ScheduleColor; tokens: ThemeTokens; onChange: (color: ScheduleColor) => void }) {
  const rows = [COLORS.slice(0, 5), COLORS.slice(5)];
  return <VStack alignment="leading" spacing={10} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ vertical: 6 })]}>
    <HStack alignment="firstTextBaseline" spacing={8}>
      <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'subheadline', weight: 'semibold' })}>Color</NativeText>
      <NativeText modifiers={textModifiers(tokens, { style: 'subheadline' })}>{colorForKey(selection).label}</NativeText>
    </HStack>
    {rows.map((row, index) => <HStack key={index} alignment="center" spacing={0} modifiers={[frame({ maxWidth: Infinity })]}>
      {row.map((item) => {
        const selected = item.key === selection;
        return <NativeButton key={item.key} onPress={() => onChange(item.key)} modifiers={[buttonStyle('plain'), frame({ maxWidth: Infinity, minHeight: 44 }), accessibilityLabel(item.label), ...(selected ? [accessibilityAddTraits(['isSelected'])] : [])]}>
          <ZStack alignment="center" modifiers={[frame({ width: 44, height: 44 }), contentShape(shapes.circle())]}>
            <NativeImage systemName={selected ? 'checkmark.circle.fill' : 'circle.fill'} modifiers={[font({ size: 34 }), foregroundStyle(tokens.mode === 'dark' ? item.dark : item.light)]} />
          </ZStack>
        </NativeButton>;
      })}
    </HStack>)}
  </VStack>;
}

export function textModifiers(tokens: ThemeTokens, options: { color?: ColorValue; style?: 'largeTitle' | 'title' | 'title2' | 'title3' | 'headline' | 'subheadline' | 'body' | 'callout' | 'footnote' | 'caption' | 'caption2'; weight?: 'regular' | 'medium' | 'semibold' | 'bold' } = {}): ViewModifier[] {
  const display = ['largeTitle', 'title', 'title2'].includes(options.style ?? '');
  return [
    foregroundStyle(options.color ?? tokens.text),
    // Titles use SF Pro Rounded for character; body and controls stay SF Pro.
    font({ textStyle: options.style ?? 'body', weight: options.weight ?? 'regular', ...(display ? { design: 'rounded' as const } : {}) }),
    ...(['largeTitle', 'title', 'title2', 'title3'].includes(options.style ?? '') ? [accessibilityAddTraits(['isHeader'])] : []),
  ];
}

export function AdaptiveRow({ children, modifiers }: { children: ReactNode; modifiers?: ViewModifier[] }) {
  const { width, fontScale } = useWindowDimensions();
  return width < 350 || fontScale >= 1.3
    ? <VStack alignment="leading" spacing={12} modifiers={modifiers}>{children}</VStack>
    : <HStack alignment="top" spacing={12} modifiers={modifiers}>{children}</HStack>;
}

export function surfaceModifiers(tokens: ThemeTokens, radius = 22): ViewModifier[] {
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
  // Primary controls are tinted glass in the accent. Neutral ones are plain
  // glass: a solid white tint read as a bright disc on the tinted grounds.
  // Both sit in the same fixed frame, so peers keep one diameter.
  if (accent) {
    return [
      buttonStyle(nativeGlassAvailable ? 'glassProminent' : 'borderedProminent'),
      buttonBorderShape('circle'),
      controlSize('large'),
      tint(tokens.blue),
      foregroundStyle(tokens.inverseText),
    ];
  }
  return [
    buttonStyle(nativeGlassAvailable ? 'glass' : 'bordered'),
    buttonBorderShape('circle'),
    controlSize('large'),
    foregroundStyle(tokens.text),
  ];
}

export function NativeCircleButton({
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
        {busy ? <ProgressView modifiers={[controlSize('small')]} /> : <NativeImage systemName={systemName} modifiers={[font({ size: 20 }), foregroundStyle(iconColor)]} />}
      </ZStack>
    </NativeButton>
  );
}

// Peer glass controls share one container so iOS 26 can blend and morph them
// as a single Liquid Glass group instead of separate floating discs.
export function GlassControlGroup({ children }: { children: ReactNode }) {
  if (!nativeGlassAvailable) return <HStack alignment="center" spacing={8}>{children}</HStack>;
  return <GlassEffectContainer spacing={8}><HStack alignment="center" spacing={8}>{children}</HStack></GlassEffectContainer>;
}

// A soft blurred glow of the page's own colour (the current class, the video
// being downloaded). It sits in the content layer, so the glass bars pick it up.
function AmbientGlowNative({ color, tokens }: { color: string; tokens: ThemeTokens }) {
  // A zero-size anchor: the glow draws past it but reports no size, so it can
  // never widen the page. (A flexible frame would accept its 460 pt width.)
  return <ZStack alignment="topLeading" modifiers={[frame({ width: 0, height: 0, alignment: 'topLeading' }), accessibilityHidden()]}>
    <VStack modifiers={[frame({ width: 460, height: 420 }), background(color), clipShape('circle'), blur(110), opacity(tokens.mode === 'dark' ? 0.42 : 0.3), offset({ x: -90, y: -190 })]}>{null}</VStack>
  </ZStack>;
}

export function PageNative({ title, subtitle, tokens, onBack, backLabel, titleOpacity, action, onHeaderTap, ambient, backdrop, settings, children }: { title: string; subtitle?: string; tokens: ThemeTokens; onBack?: () => void; backLabel?: string; titleOpacity?: number; action?: ReactNode; onHeaderTap?: () => void; ambient?: string | null; backdrop?: ReactNode; settings?: ReactNode; children: ReactNode }) {
  return <ZStack alignment="topLeading" modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'topLeading' })]}>
    {/* Ground and glow run under the status bar so the clock and icons sit on the page's own colour. */}
    <ZStack alignment="topLeading" modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'topLeading' }), background(tokens.background), ignoreSafeArea({ edges: 'top' })]}>
      {backdrop ?? null}
      {ambient ? <AmbientGlowNative color={ambient} tokens={tokens} /> : null}
    </ZStack>
    <PageBodyNative title={title} subtitle={subtitle} tokens={tokens} onBack={onBack} backLabel={backLabel} titleOpacity={titleOpacity} action={action} onHeaderTap={onHeaderTap} settings={settings}>{children}</PageBodyNative>
  </ZStack>;
}

// Scroll edge effect: content keeps drawing as it scrolls up under the header
// (scroll clipping off), and the header's ground fades from the page colour at
// the top to clear at its bottom, so content dissolves instead of being cut.
// The gradient also runs under the status bar.
function headerFade(tokens: ThemeTokens): ViewModifier {
  const ground = String(tokens.background);
  return shapeBackground({
    type: 'linearGradient',
    colors: [withAlpha(ground, 0.8), withAlpha(ground, 0.62), withAlpha(ground, 0)],
    startPoint: { x: 0.5, y: 0 },
    endPoint: { x: 0.5, y: 1 },
  });
}

// Expo Go only ships the native views it was built with; Mask and Background
// are recent, so the header checks for them before using them.
export function hasNativeView(viewName: string) {
  try {
    const expoGlobal = (globalThis as { expo?: { getViewConfig?: (module: string, view?: string) => unknown } }).expo;
    return Boolean(expoGlobal?.getViewConfig?.('ExpoUI', viewName));
  } catch {
    return false;
  }
}
const supportsProgressiveBlur = hasNativeView('MaskView') && hasNativeView('BackgroundView');

// The header's ground. Where available it is the iOS scroll edge look: a
// native blur (material) masked by a gradient, strong at the top and fading
// out at the header's bottom edge, running under the status bar. Otherwise a
// plain fade of the page colour.
function HeaderSurfaceNative({ tokens, children }: { tokens: ThemeTokens; children: ReactNode }) {
  if (!supportsProgressiveBlur) {
    return <VStack alignment="leading" spacing={0} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), headerFade(tokens), zIndex(1)]}>{children}</VStack>;
  }
  // Like the Photos header: the thinnest material (blur with almost no milky
  // tint), its mask fading from full at the top to nothing, reaching 40 pt past
  // the header so the blur dissolves into the content instead of ending on an
  // edge, plus a light scrim of the page colour at the very top for the title.
  const fill: ViewModifier[] = [frame({ maxWidth: Infinity, maxHeight: Infinity }), ignoreSafeArea({ edges: 'top' })];
  const ground = String(tokens.background);
  const downward = { startPoint: { x: 0.5, y: 0 }, endPoint: { x: 0.5, y: 1 } };
  return <Background alignment="top" modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), zIndex(1)]}>
    <VStack alignment="leading" spacing={0} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>{children}</VStack>
    <Background.Content>
      <ZStack alignment="top" modifiers={[...fill, padding({ bottom: -40 })]}>
        <Mask alignment="top" modifiers={fill}>
          <VStack modifiers={[...fill, shapeBackground({ type: 'material', material: 'ultraThin' })]}>{null}</VStack>
          <Mask.Content>
            <VStack modifiers={[...fill, shapeBackground({ type: 'linearGradient', colors: ['#000000', '#000000F2', '#000000A6', '#00000040', '#00000000'], ...downward })]}>{null}</VStack>
          </Mask.Content>
        </Mask>
        <VStack modifiers={[...fill, shapeBackground({ type: 'linearGradient', colors: [withAlpha(ground, 0.55), withAlpha(ground, 0.2), withAlpha(ground, 0)], ...downward })]}>{null}</VStack>
      </ZStack>
    </Background.Content>
  </Background>;
}

// titleOpacity lets a page hide the navigation title while its own large title
// is on screen and bring it in as that title scrolls away (it rises 8 pt as it fades in).
function PageBodyNative({ title, subtitle, tokens, onBack, backLabel = 'Volver a Miniapps', titleOpacity = 1, action, onHeaderTap, settings, children }: { title: string; subtitle?: string; tokens: ThemeTokens; onBack?: () => void; backLabel?: string; titleOpacity?: number; action?: ReactNode; onHeaderTap?: () => void; settings?: ReactNode; children: ReactNode }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const titleModifiers: ViewModifier[] = [...textModifiers(tokens, { style: 'headline', weight: 'semibold' }), lineLimit(1)];
  // A miniapp with its own settings turns its title into a title menu, like
  // Notes or Files: the title and a small chevron open the settings sheet.
  const centredTitle = settings
    ? <NativeButton onPress={() => setSettingsOpen(true)} modifiers={[buttonStyle('plain'), padding({ horizontal: CIRCLE_CONTROL_SIZE * 2 + 16 }), opacity(titleOpacity), offset({ y: (1 - titleOpacity) * 8 }), accessibilityLabel(`Ajustes de ${title}`), accessibilityAddTraits(['isHeader'])]}>
      <HStack alignment="center" spacing={5} modifiers={[contentShape(shapes.rectangle())]}>
        <NativeText modifiers={titleModifiers}>{title}</NativeText>
        <NativeImage systemName="chevron.down" modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle(tokens.secondary), accessibilityHidden()]} />
      </HStack>
    </NativeButton>
    : <NativeText modifiers={[...titleModifiers, padding({ horizontal: CIRCLE_CONTROL_SIZE * 2 + 16 }), opacity(titleOpacity), offset({ y: (1 - titleOpacity) * 8 }), accessibilityAddTraits(['isHeader'])]}>{title}</NativeText>;
  return <VStack spacing={0} modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'topLeading' })]}>
    <HeaderSurfaceNative tokens={tokens}>
    <VStack alignment="leading" spacing={12} modifiers={[frame({ maxWidth: UI.contentWidth, alignment: 'leading' }), padding({ horizontal: UI.pageInset, top: 12, bottom: 18 }), ...(onHeaderTap ? [contentShape(shapes.rectangle()), onTapGesture(onHeaderTap)] : [])]}>
      {onBack ? <ZStack alignment="center" modifiers={[frame({ maxWidth: Infinity, minHeight: CIRCLE_CONTROL_SIZE })]}>
        {/* The title sits in its own layer so it stays centred when the two sides hold a different number of controls. */}
        {centredTitle}
        <HStack alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity })]}>
          <NativeCircleButton tokens={tokens} label={backLabel} systemName="chevron.left" onPress={onBack} />
          <Spacer />
          {action ?? null}
        </HStack>
      </ZStack> : null}
      {!onBack && <HStack alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
        <VStack alignment="leading" spacing={2}>
          <NativeText modifiers={[...textModifiers(tokens, { style: 'largeTitle', weight: 'bold' }), accessibilityAddTraits(['isHeader'])]}>{title}</NativeText>
          {subtitle ? <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'subheadline', weight: 'medium' })}>{subtitle}</NativeText> : null}
        </VStack>
        <Spacer />
        {action ?? null}
      </HStack>}
    </VStack>
    </HeaderSurfaceNative>
    <VStack spacing={0} modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'top' }), scrollClipDisabled()]}>{children}</VStack>
    {settings ? <BottomSheet isPresented={settingsOpen} onIsPresentedChange={setSettingsOpen} onDismiss={() => setSettingsOpen(false)}>
      {settingsOpen ? <Group modifiers={[presentationDetents(['medium', 'large']), presentationDragIndicator('visible')]}>
        <VStack spacing={0} modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'top' }), background(tokens.background)]}>
          <HStack alignment="center" spacing={12} modifiers={[padding({ all: SHEET_ACTION_INSET })]}>
            <NativeCircleButton tokens={tokens} label="Cerrar" systemName="xmark" onPress={() => setSettingsOpen(false)} />
            <Spacer />
            <NativeText modifiers={[...textModifiers(tokens, { style: 'headline', weight: 'semibold' }), accessibilityAddTraits(['isHeader'])]}>{title}</NativeText>
            <Spacer />
            <VStack modifiers={[frame({ width: CIRCLE_CONTROL_SIZE, height: CIRCLE_CONTROL_SIZE })]}>{null}</VStack>
          </HStack>
          <Form modifiers={[listStyle('insetGrouped'), scrollContentBackground('hidden'), background(tokens.background), frame({ maxWidth: Infinity, maxHeight: Infinity })]}>{settings}</Form>
        </VStack>
      </Group> : null}
    </BottomSheet> : null}
  </VStack>;
}

// The width available to a page's content column. Scrolling columns get this
// exact width: with only a maximum, a child that asks for more (a text field
// holding a long URL, an embedded React Native view) widens the whole page
// past the screen.
export function usePageWidth() {
  const { width } = useWindowDimensions();
  return Math.min(width, UI.contentWidth) - UI.pageInset * 2;
}

export function ReadingCanvasNative({ tokens, children }: { tokens: ThemeTokens; children: ReactNode }) {
  const pageWidth = usePageWidth();
  return <ScrollView modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity })]}>
    <VStack alignment="leading" spacing={24} modifiers={[frame({ width: pageWidth, alignment: 'leading' }), padding({ horizontal: UI.pageInset, top: 6, bottom: 32 })]}>{children}</VStack>
  </ScrollView>;
}

export function groupedListModifiers(tokens: ThemeTokens): ViewModifier[] {
  return [listStyle('insetGrouped'), scrollContentBackground('hidden'), background(tokens.background), frame({ maxWidth: UI.contentWidth, maxHeight: Infinity })];
}

export function SymbolImage({ name, color, size = 22 }: { name: SFSymbol; color: ColorValue; size?: number }) {
  const textStyle = size >= 25 ? 'title' : size >= 22 ? 'title2' : size >= 18 ? 'body' : 'caption';
  return <NativeImage systemName={name} modifiers={[font({ textStyle }), foregroundStyle(color), accessibilityHidden()]} />;
}

export function DataStateNative({ loading, error, tokens, onRetry }: { loading: boolean; error: string | null; tokens: ThemeTokens; onRetry: () => void }) {
  return <VStack alignment="leading" spacing={12} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ horizontal: 4, vertical: 8 })]}>
    {loading ? <ProgressView /> : <SymbolImage name="exclamationmark.triangle" color={tokens.danger} />}
    <NativeText modifiers={textModifiers(tokens)}>{loading ? 'Cargando horario…' : error}</NativeText>
    {!loading && <NativeButton label="Reintentar" onPress={onRetry} modifiers={[buttonStyle('bordered'), controlSize('large')]} />}
  </VStack>;
}

// A store that could not be read: its data is kept, untouched, until it loads.
export function StoreErrorNative({ message, tokens, onRetry }: { message: string; tokens: ThemeTokens; onRetry: () => void }) {
  return <VStack alignment="center" spacing={10} modifiers={[frame({ maxWidth: Infinity, alignment: 'center' }), padding({ vertical: 32 })]}>
    <SymbolImage name="exclamationmark.triangle" color={tokens.danger} size={26} />
    <NativeText modifiers={[...textModifiers(tokens, { style: 'headline', weight: 'semibold' }), multilineTextAlignment('center')]}>{message}</NativeText>
    <NativeButton label="Reintentar" onPress={onRetry} modifiers={[buttonStyle('bordered'), controlSize('regular'), tint(tokens.blue)]} />
  </VStack>;
}

// A change that could not be stored has already been undone on screen.
export function alertUnsaved(saved: boolean) {
  if (!saved) Alert.alert('No se pudo guardar', 'El cambio no se aplicó. Inténtalo de nuevo.');
  return saved;
}

export function SectionHeadingNative({ title, detail, tokens }: { title: string; detail?: string; tokens: ThemeTokens }) {
  return <HStack alignment="firstTextBaseline" spacing={8} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ horizontal: 4 })]}>
    <NativeText modifiers={[...textModifiers(tokens, { style: 'title3', weight: 'bold' }), accessibilityAddTraits(['isHeader'])]}>{title}</NativeText>
    <Spacer />
    {detail ? <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'subheadline' })}>{detail}</NativeText> : null}
  </HStack>;
}

export function GroupedSurfaceNative({ tokens, children, spacing = 0, inset = 16 }: { tokens: ThemeTokens; children: ReactNode; spacing?: number; inset?: number }) {
  return <VStack alignment="leading" spacing={spacing} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ horizontal: inset, vertical: inset / 2 }), background(tokens.surface), clipShape('roundedRectangle', UI.groupRadius)]}>{children}</VStack>;
}

// A course taught in several sessions (theory, practice) counts once.
export function courseCount(entries: ScheduleEntry[]) {
  return entries.filter((entry, index) => entries.findIndex((other) => sameCourse(other, entry)) === index).length;
}

export function WeekStripNative({ entries, tokens, today, accent }: { entries: ScheduleEntry[]; tokens: ThemeTokens; today: DayIndex; accent?: { main: string; ink: string } | null }) {
  const todayInk = accent?.ink ?? tokens.blue;
  const todayFill = accent ? withAlpha(accent.main, tokens.mode === 'dark' ? 0.24 : 0.16) : tokens.blueSoft;
  return <HStack alignment="center" spacing={4} modifiers={[frame({ maxWidth: Infinity })]}>
    {DAYS.map((day) => {
      const count = courseCount(entries.filter((entry) => entry.day === day.index));
      const isToday = day.index === today;
      return <VStack key={day.index} alignment="center" spacing={6} modifiers={[
        frame({ maxWidth: Infinity, minHeight: 60 }),
        ...(isToday ? [background(todayFill), clipShape('roundedRectangle', 14)] : []),
        accessibilityElement('ignore'),
        accessibilityLabel(`${day.long}${isToday ? ', hoy' : ''}, ${count === 1 ? '1 curso' : `${count} cursos`}`),
      ]}>
        <NativeText modifiers={textModifiers(tokens, { color: isToday ? todayInk : tokens.secondary, style: 'caption', weight: 'bold' })}>{day.initial}</NativeText>
        <NativeText modifiers={[foregroundStyle(count ? (isToday ? todayInk : tokens.text) : tokens.secondary), font({ textStyle: 'title3', weight: count ? 'bold' : 'regular', design: 'rounded' }), monospacedDigit()]}>{count ? String(count) : '–'}</NativeText>
      </VStack>;
    })}
  </HStack>;
}
export const CHIP_GAP = 8;

export type FilterChip = { key: string; label: string; symbol?: SFSymbol; dot?: string; selected: boolean; onPress: () => void };

function FilterChipNative({ chip, tokens }: { chip: FilterChip; tokens: ThemeTokens }) {
  const ink = chip.selected ? tokens.inverseText : tokens.text;
  return <NativeButton onPress={chip.onPress} modifiers={[buttonStyle('plain'), accessibilityLabel(chip.label), ...(chip.selected ? [accessibilityAddTraits(['isSelected'])] : [])]}>
    <HStack alignment="center" spacing={6} modifiers={[padding({ horizontal: 14, vertical: 9 }), background(chip.selected ? tokens.blue : tokens.surface), clipShape('capsule'), contentShape(shapes.capsule())]}>
      {chip.dot ? <VStack modifiers={[frame({ width: 8, height: 8 }), background(chip.dot), clipShape('circle')]}>{null}</VStack> : null}
      {chip.symbol ? <NativeImage systemName={chip.symbol} modifiers={[font({ textStyle: 'footnote', weight: 'semibold' }), foregroundStyle(chip.selected ? tokens.inverseText : tokens.secondary)]} /> : null}
      <NativeText modifiers={[...textModifiers(tokens, { color: ink, style: 'subheadline', weight: chip.selected ? 'semibold' : 'medium' }), lineLimit(1)]}>{chip.label}</NativeText>
    </HStack>
  </NativeButton>;
}

// Chips wrap onto as many rows as they need. Expo UI has no flow layout, so
// rows are packed from an estimate of each chip's width at the current text size.
export function FilterChipsNative({ chips, width, tokens }: { chips: FilterChip[]; width: number; tokens: ThemeTokens }) {
  const { fontScale } = useWindowDimensions();
  const rows: FilterChip[][] = [];
  let used = width;
  for (const chip of chips) {
    const estimate = 30 + (chip.symbol ? 20 : 0) + (chip.dot ? 14 : 0) + chip.label.length * 8.6 * fontScale;
    if (used + CHIP_GAP + estimate > width) {
      rows.push([chip]);
      used = estimate;
    } else {
      rows[rows.length - 1].push(chip);
      used += CHIP_GAP + estimate;
    }
  }
  return <VStack alignment="leading" spacing={CHIP_GAP} modifiers={[frame({ width, alignment: 'leading' })]}>
    {rows.map((row) => <HStack key={row[0].key} alignment="center" spacing={CHIP_GAP}>
      {row.map((chip) => <FilterChipNative key={chip.key} chip={chip} tokens={tokens} />)}
    </HStack>)}
  </VStack>;
}

// A tool in Biblioteca: icon tile, name and a live detail line.
export function MiniappRowNative({ title, detail, icon, iconColor, iconBackground, tokens, onPress, label }: { title: string; detail: string; icon: SFSymbol; iconColor: string; iconBackground: string; tokens: ThemeTokens; onPress: () => void; label: string }) {
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
