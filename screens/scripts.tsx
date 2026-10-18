// Miniapps from .js files: the API a file gets, the SwiftUI views it draws
// with, and the screens that list, run and edit the files.

import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { Accelerometer } from 'expo-sensors';
import { Host } from '@expo/ui';
import * as SwiftUI from '@expo/ui/swift-ui';
import * as Modifiers from '@expo/ui/swift-ui/modifiers';
import { BottomSheet, Button as NativeButton, ContentUnavailableView, ContextMenu, Divider as NativeDivider, Form, HStack as NativeHStack, Image as NativeImage, Menu, Picker as NativePicker, ProgressView, ScrollView, Section as NativeSection, Slider as NativeSlider, Spacer as NativeSpacer, Stepper as NativeStepper, Text as NativeText, TextField as NativeTextField, Toggle as NativeToggle, VStack as NativeVStack, ZStack as NativeZStack, useNativeState } from '@expo/ui/swift-ui';
import { accessibilityLabel, autocorrectionDisabled, buttonStyle, clipShape, controlSize, disabled, font, frame, glassEffect, keyboardType, lineLimit, menuIndicator, multilineTextAlignment, onSubmit, onTapGesture, opacity, padding, pickerStyle, scrollDismissesKeyboard, tag, textFieldStyle, textInputAutocapitalization, textSelection, type ViewModifier } from '@expo/ui/swift-ui/modifiers';
import type { SFSymbol } from 'sf-symbols-typescript';
import React, { Component, Fragment, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Alert, Linking, Modal, PlatformColor, Share, type ColorValue } from 'react-native';
import { background, foregroundStyle, tint } from '../native-colors';
import { UI } from '../ui-structure';
import { InListContext, ScriptFileContext, TokensContext, common, resolveColor, useTokens, type FrameAlignment, type ScriptLaunch, type ViewProps } from './script-context';
import { createShakeDetector } from '../shake-detector';
import type { ScheduleColor } from '../schedule-data';
import { NEW_SCRIPT, ScriptError, baseName, checkScript, evaluateScript, formatLog, readMeta, scriptComponent, scriptFileName, staticMeta, type ScriptMeta } from '../script-runtime';
import { deleteScript, deleteScriptMedia, importScripts, loadScriptData, readScript, refreshScripts, renameScript, saveScriptImage, saveScriptValues, scriptImageUri, shareScript, useScripts, writeScript, type ScriptFile } from '../script-files';
import { DEVICE_COMPONENTS, DEVICE_HOOKS, createDeviceApi } from './script-device';
import { CIRCLE_CONTROL_SIZE, MiniappRowNative, NativeCircleButton, PageNative, SectionHeadingNative, SymbolImage, colorForKey, nativeGlassAvailable, textModifiers, usePageWidth, withAlpha, type ThemeTokens } from './shared';

// ---------------------------------------------------------------------------
// Views a miniapp can use. Each takes a few plain props and maps them onto the
// app's SwiftUI views and theme; `modifiers` passes raw SwiftUI modifiers on.

function textOf(children: ReactNode) {
  return React.Children.toArray(children).map((child) => (typeof child === 'string' || typeof child === 'number' ? String(child) : '')).join('');
}

type TextStyle = 'largeTitle' | 'title' | 'title2' | 'title3' | 'headline' | 'subheadline' | 'body' | 'callout' | 'footnote' | 'caption' | 'caption2';
type Weight = 'ultraLight' | 'thin' | 'light' | 'regular' | 'medium' | 'semibold' | 'bold' | 'heavy' | 'black';
type Design = 'default' | 'rounded' | 'serif' | 'monospaced';
const DISPLAY_STYLES = new Set(['largeTitle', 'title', 'title2']);

// One font per Text: SwiftUI keeps the innermost font, so a second one added
// later would be ignored. Titles default to SF Pro Rounded, like the app's.
function Text({ children, style, size, weight, design, color, mono, rounded, align, lines, selectable, ...rest }: ViewProps & { children?: ReactNode; style?: TextStyle; size?: number; weight?: Weight; design?: Design; color?: string; mono?: boolean; rounded?: boolean; align?: 'leading' | 'center' | 'trailing'; lines?: number; selectable?: boolean }) {
  const tokens = useTokens();
  const textStyle = style ?? 'body';
  const face: Design = design ?? (mono ? 'monospaced' : rounded || (!size && DISPLAY_STYLES.has(textStyle)) ? 'rounded' : 'default');
  const modifiers: ViewModifier[] = [
    foregroundStyle(resolveColor(color, tokens, 'ink') ?? tokens.text),
    size ? font({ size, weight: weight ?? 'regular', design: face }) : font({ textStyle, weight: weight ?? 'regular', design: face }),
  ];
  if (style && ['largeTitle', 'title', 'title2', 'title3'].includes(style)) modifiers.push(Modifiers.accessibilityAddTraits(['isHeader']));
  if (align) modifiers.push(multilineTextAlignment(align));
  if (lines) modifiers.push(lineLimit(lines));
  if (selectable) modifiers.push(textSelection(true));
  return <NativeText modifiers={[...modifiers, ...common(rest, tokens)]}>{textOf(children)}</NativeText>;
}

function VStack({ children, spacing, alignment, ...rest }: ViewProps & { children?: ReactNode; spacing?: number; alignment?: 'leading' | 'center' | 'trailing' }) {
  return <NativeVStack alignment={alignment} spacing={spacing} modifiers={common(rest, useTokens())}>{children}</NativeVStack>;
}

function HStack({ children, spacing, alignment, ...rest }: ViewProps & { children?: ReactNode; spacing?: number; alignment?: 'top' | 'center' | 'bottom' | 'firstTextBaseline' | 'lastTextBaseline' }) {
  return <NativeHStack alignment={alignment} spacing={spacing} modifiers={common(rest, useTokens())}>{children}</NativeHStack>;
}

function ZStack({ children, alignment, ...rest }: ViewProps & { children?: ReactNode; alignment?: FrameAlignment }) {
  return <NativeZStack alignment={alignment} modifiers={common(rest, useTokens())}>{children}</NativeZStack>;
}

function Spacer({ minLength }: { minLength?: number }) {
  return <NativeSpacer minLength={minLength} />;
}

function Divider() {
  return <NativeDivider />;
}

/** A scrolling page column with the app's insets. */
function Page({ children, spacing = 20, alignment = 'leading' }: { children?: ReactNode; spacing?: number; alignment?: 'leading' | 'center' | 'trailing' }) {
  const width = usePageWidth();
  return <ScrollView modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity }), scrollDismissesKeyboard('interactively')]}>
    <NativeVStack alignment={alignment} spacing={spacing} modifiers={[frame({ width, alignment: alignment === 'center' ? 'center' : alignment === 'trailing' ? 'trailing' : 'leading' }), padding({ horizontal: UI.pageInset, top: 6, bottom: 32 })]}>{children}</NativeVStack>
  </ScrollView>;
}

/** A native grouped list, like Ajustes. Holds Sections. */
function List({ children }: { children?: ReactNode }) {
  const tokens = useTokens();
  return <InListContext.Provider value>
    <Form modifiers={[Modifiers.listStyle('insetGrouped'), Modifiers.scrollContentBackground('hidden'), background(tokens.background), frame({ maxWidth: UI.contentWidth, maxHeight: Infinity }), scrollDismissesKeyboard('interactively')]}>{children}</Form>
  </InListContext.Provider>;
}

function Section({ title, footer, children }: { title?: string; footer?: string; children?: ReactNode }) {
  const tokens = useTokens();
  return <NativeSection title={title} footer={footer ? <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary, style: 'footnote' })}>{footer}</NativeText> : undefined}>{children}</NativeSection>;
}

/** A surface for grouping content on a Page. */
function Card({ children, spacing = 12, ...rest }: ViewProps & { children?: ReactNode; spacing?: number }) {
  const tokens = useTokens();
  return <NativeVStack alignment="leading" spacing={spacing} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ all: 16 }), background(tokens.surface), clipShape('roundedRectangle', UI.groupRadius), ...common(rest, tokens)]}>{children}</NativeVStack>;
}

function Heading({ title, detail }: { title: string; detail?: string }) {
  return <SectionHeadingNative title={title} detail={detail} tokens={useTokens()} />;
}

/** A label and its value on one line; tappable when it has onPress. */
function Row({ label, value, icon, color, onPress, ...rest }: ViewProps & { label: string; value?: string | number; icon?: string; color?: string; onPress?: () => void }) {
  const tokens = useTokens();
  const content = <NativeHStack alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity, minHeight: 32, alignment: 'leading' }), ...common(rest, tokens)]}>
    {icon ? <SymbolImage name={icon as SFSymbol} color={resolveColor(color, tokens) ?? tokens.secondary} size={18} /> : null}
    <NativeText modifiers={textModifiers(tokens)}>{label}</NativeText>
    <NativeSpacer />
    {value !== undefined && value !== null ? <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary }), Modifiers.monospacedDigit()]}>{String(value)}</NativeText> : null}
    {onPress ? <SymbolImage name="chevron.right" color={tokens.secondary} size={14} /> : null}
  </NativeHStack>;
  return onPress ? <NativeButton onPress={onPress} modifiers={[buttonStyle('plain')]}>{content}</NativeButton> : content;
}

type ButtonKind = 'prominent' | 'glass' | 'bordered' | 'plain' | 'destructive';

function Button({ title, icon, onPress, style, color, ...rest }: ViewProps & { title?: string; icon?: string; onPress?: () => void; style?: ButtonKind; color?: string }) {
  const tokens = useTokens();
  const accent = resolveColor(color, tokens) ?? tokens.blue;
  const look: ViewModifier[] = style === 'prominent'
    ? [buttonStyle(nativeGlassAvailable ? 'glassProminent' : 'borderedProminent'), controlSize('large'), tint(accent)]
    : style === 'glass' ? [buttonStyle(nativeGlassAvailable ? 'glass' : 'bordered'), controlSize('large'), tint(accent)]
    : style === 'bordered' ? [buttonStyle('bordered'), tint(accent)]
    : style === 'plain' ? [buttonStyle('plain')]
    : style === 'destructive' ? []
    : [tint(accent)];
  return <NativeButton label={title} systemImage={icon as SFSymbol | undefined} role={style === 'destructive' ? 'destructive' : undefined} onPress={onPress} modifiers={[...look, ...common(rest, tokens)]} />;
}

/** The app's round glass button, icon only. */
function IconButton({ icon, label, onPress, prominent, busy, disabled: isDisabled }: { icon: string; label?: string; onPress?: () => void; prominent?: boolean; busy?: boolean; disabled?: boolean }) {
  return <NativeCircleButton tokens={useTokens()} accent={prominent} label={label ?? icon} systemName={icon as SFSymbol} onPress={onPress ?? (() => {})} busy={busy} disabled={isDisabled} />;
}

function Image({ symbol, size = 22, color, ...rest }: ViewProps & { symbol: string; size?: number; color?: string }) {
  const tokens = useTokens();
  return <NativeImage systemName={symbol as SFSymbol} modifiers={[font({ size }), foregroundStyle(resolveColor(color, tokens) ?? tokens.text), ...common(rest, tokens)]} />;
}

function Toggle({ label, icon, value, onChange, ...rest }: ViewProps & { label?: string; icon?: string; value?: boolean; onChange?: (value: boolean) => void }) {
  const tokens = useTokens();
  return <NativeToggle label={label} systemImage={icon as SFSymbol | undefined} isOn={Boolean(value)} onIsOnChange={onChange} modifiers={[tint(tokens.blue), ...common(rest, tokens)]} />;
}

function Slider({ value, min = 0, max = 1, step, onChange, ...rest }: ViewProps & { value?: number; min?: number; max?: number; step?: number; onChange?: (value: number) => void }) {
  const tokens = useTokens();
  return <NativeSlider value={value} min={min} max={max} step={step} onValueChange={onChange} modifiers={[tint(tokens.blue), ...common(rest, tokens)]} />;
}

function Stepper({ label, value, min, max, step, onChange, ...rest }: ViewProps & { label?: string; value?: number; min?: number; max?: number; step?: number; onChange?: (value: number) => void }) {
  return <NativeStepper label={label ?? String(value ?? '')} value={value} min={min} max={max} step={step} onValueChange={onChange ?? (() => {})} modifiers={common(rest, useTokens())} />;
}

const KEYBOARDS = { text: 'default', number: 'numeric', decimal: 'decimal-pad', email: 'email-address', url: 'url', phone: 'phone-pad' } as const;

/** Controlled like a React input: `value` and `onChange`. */
function TextField({ value, onChange, onSubmit: submit, placeholder, multiline, lines, plain, keyboard, autocorrect = true, ...rest }: ViewProps & { value?: string; onChange?: (text: string) => void; onSubmit?: () => void; placeholder?: string; multiline?: boolean; lines?: number; plain?: boolean; keyboard?: keyof typeof KEYBOARDS; autocorrect?: boolean }) {
  const tokens = useTokens();
  const inList = useContext(InListContext);
  const text = useNativeState(value ?? '');
  const last = useRef(value ?? '');
  useEffect(() => {
    // Only a change made by the miniapp itself is pushed into the field.
    if (value !== undefined && value !== last.current) {
      last.current = value;
      text.set(value);
    }
  }, [value, text]);
  return <NativeTextField
    text={text}
    placeholder={placeholder}
    axis={multiline ? 'vertical' : 'horizontal'}
    onTextChange={(next) => {
      last.current = next;
      onChange?.(next);
    }}
    modifiers={[
      textFieldStyle(plain ? 'plain' : inList ? 'automatic' : 'roundedBorder'),
      frame({ maxWidth: Infinity }),
      ...(keyboard && KEYBOARDS[keyboard] ? [keyboardType(KEYBOARDS[keyboard])] : []),
      ...(autocorrect ? [] : [autocorrectionDisabled(), textInputAutocapitalization('never')]),
      ...(submit ? [onSubmit(submit)] : []),
      // A multiline field shows 3 lines unless `lines` says otherwise; 0 lets it grow freely.
      ...(multiline && (lines ?? 3) > 0 ? [lineLimit(lines ?? 3)] : []),
      ...common(rest, tokens),
    ]}
  />;
}

type Option = string | number | { label: string; value: string | number };

function Picker({ value, onChange, options = [], label, style = 'menu', ...rest }: ViewProps & { value?: string | number; onChange?: (value: string | number) => void; options?: Option[]; label?: string; style?: 'menu' | 'segmented' | 'wheel' | 'inline' }) {
  const tokens = useTokens();
  const items = options.map((option) => (typeof option === 'object' ? option : { label: String(option), value: option }));
  return <NativePicker label={label} selection={value} onSelectionChange={(next) => onChange?.(next as string | number)} modifiers={[pickerStyle(style), tint(tokens.blue), ...common(rest, tokens)]}>
    {items.map((item) => <NativeText key={String(item.value)} modifiers={[tag(item.value)]}>{item.label}</NativeText>)}
  </NativePicker>;
}

/** A bar for a value from 0 to 1, or a spinner without one. */
function Progress({ value, color, ...rest }: ViewProps & { value?: number; color?: string }) {
  const tokens = useTokens();
  return <ProgressView value={typeof value === 'number' ? Math.max(0, Math.min(1, value)) : undefined} modifiers={[tint(resolveColor(color, tokens) ?? tokens.blue), ...common(rest, tokens)]} />;
}

/** An image the miniapp saved with pickImages() or takePhoto(), by its id. `thumb` uses the small copy. */
function Photo({ id, thumb, mode = 'fill', aspect, width, height, maxWidth, maxHeight, fill, radius, ...rest }: ViewProps & { id?: string; thumb?: boolean; mode?: 'fill' | 'fit'; aspect?: number }) {
  const tokens = useTokens();
  const src = scriptImageUri(useContext(ScriptFileContext), String(id ?? ''), thumb);
  if (!src) return null;
  const size = { width, height, maxWidth: fill ? Infinity : maxWidth, maxHeight };
  return <NativeImage uiImage={src} modifiers={[
    Modifiers.resizable(),
    Modifiers.aspectRatio({ ratio: aspect, contentMode: mode }),
    ...(Object.values(size).some((value) => value !== undefined) ? [frame(size)] : []),
    Modifiers.clipped(),
    ...(radius ? [clipShape('roundedRectangle', radius)] : []),
    ...common(rest, tokens),
  ]} />;
}

function Empty({ title, icon, detail }: { title: string; icon?: string; detail?: string }) {
  return <ContentUnavailableView title={title} systemImage={icon as SFSymbol | undefined} description={detail} modifiers={[frame({ maxWidth: Infinity })]} />;
}

function useTheme() {
  const tokens = useTokens();
  return useMemo(() => ({ mode: tokens.mode, accent: tokens.blue, text: tokens.text, secondary: tokens.secondary, background: tokens.background, surface: tokens.surface, danger: tokens.danger, color: (name: string) => resolveColor(name, tokens) }), [tokens]);
}

const COMPONENTS = { Text, VStack, HStack, ZStack, Spacer, Divider, Page, List, Section, Card, Heading, Row, Button, IconButton, Image, Photo, Toggle, Slider, Stepper, TextField, Picker, Progress, Empty, ...DEVICE_COMPONENTS };
const TEXT_TYPES = new Set<unknown>([Text, SwiftUI.Text]);

// Raw SwiftUI for anything the views above do not cover. Colour modifiers are
// the app's versions, which older Expo Go builds also understand.
const RAW_MODIFIERS = { ...Modifiers, background, foregroundStyle, tint };

// ---------------------------------------------------------------------------
// The runtime: one per run of a file. It owns the file's timers and stored
// values, and reports any error the file throws, also from event handlers.

type Report = (error: unknown) => void;
type Runtime = { scope: Record<string, unknown>; modules: Record<string, unknown>; dispose: () => void };

// What a miniapp writes with console.*, kept per run outside React state, so
// logging while drawing never redraws the miniapp.
type LogLevel = 'log' | 'info' | 'warn' | 'error';
type LogEntry = { id: number; level: LogLevel; text: string; time: number };
const MAX_LOGS = 500;

function createLogBook() {
  let entries: LogEntry[] = [];
  let next = 0;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  return {
    add(level: LogLevel, text: string) {
      entries = [...entries.slice(-(MAX_LOGS - 1)), { id: next++, level, text, time: Date.now() }];
      emit();
    },
    clear() {
      entries = [];
      emit();
    },
    get: () => entries,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
type LogBook = ReturnType<typeof createLogBook>;

function createRuntime(fileName: string, data: Record<string, unknown>, report: Report, close: () => void, logs: LogBook, launch: ScriptLaunch): Runtime {
  let disposed = false;
  const timers = new Map<ReturnType<typeof globalThis.setTimeout>, 'timeout' | 'interval'>();
  // Players, speech and other things to stop when the run ends.
  const cleanups = new Set<() => void>();
  const track = (cleanup: () => void) => {
    cleanups.add(cleanup);
    return () => {
      cleanups.delete(cleanup);
    };
  };

  const guard = <T extends (...args: never[]) => unknown>(fn: T) => (...args: Parameters<T>) => {
    if (disposed) return undefined;
    try {
      const result = fn(...args);
      if (result && typeof (result as Promise<unknown>).then === 'function') (result as Promise<unknown>).then(undefined, report);
      return result;
    } catch (error) {
      report(error);
      return undefined;
    }
  };

  // JSX lands here. Event handlers are guarded, lowercase tags are refused, and
  // loose text inside a stack becomes a Text so SwiftUI always gets views.
  function h(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) {
    if (typeof type === 'string') throw new ScriptError(`<${type}> no es un componente. Usa <Text>, <VStack>…`);
    if (type === undefined || type === null) throw new ScriptError('Un componente del JSX no existe.');
    let next = props;
    if (props) {
      for (const key of Object.keys(props)) {
        if (/^on[A-Z]/.test(key) && typeof props[key] === 'function') {
          if (next === props) next = { ...props };
          next![key] = guard(props[key] as (...args: never[]) => unknown);
        }
      }
    }
    const kids = TEXT_TYPES.has(type) ? children : children.map((child) => (typeof child === 'string' || typeof child === 'number' ? React.createElement(Text, null, String(child)) : child));
    return React.createElement(type as React.ElementType, next, ...(kids as ReactNode[]));
  }

  // Only the keys changed since the last write are saved, each as its own entry.
  const dirty = new Set<string>();
  let saveTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  const flush = () => {
    if (saveTimer) globalThis.clearTimeout(saveTimer);
    saveTimer = null;
    if (!dirty.size) return;
    const changes = [...dirty].map((key): [string, unknown] => [key, data[key]]);
    dirty.clear();
    void saveScriptValues(fileName, changes).catch(() => Alert.alert('No se pudieron guardar los datos', baseName(fileName)));
  };
  const scheduleSave = () => {
    if (saveTimer) globalThis.clearTimeout(saveTimer);
    saveTimer = globalThis.setTimeout(flush, 300);
  };

  const storage = {
    get: (key: string, fallback: unknown = null) => (Object.prototype.hasOwnProperty.call(data, key) ? data[key] : fallback),
    set: (key: string, value: unknown) => {
      key = String(key);
      if (value === undefined) delete data[key];
      else data[key] = JSON.parse(JSON.stringify(value));
      dirty.add(key);
      scheduleSave();
    },
    remove: (key: string) => {
      key = String(key);
      delete data[key];
      dirty.add(key);
      scheduleSave();
    },
    keys: () => Object.keys(data),
    clear: () => {
      for (const key of Object.keys(data)) {
        delete data[key];
        dirty.add(key);
      }
      scheduleSave();
    },
  };

  function useStored<T>(key: string, initial: T) {
    const [value, setValue] = useState<T>(() => storage.get(key, initial) as T);
    const set = useCallback((next: T | ((previous: T) => T)) => {
      setValue((previous) => {
        const resolved = typeof next === 'function' ? (next as (previous: T) => T)(previous) : next;
        storage.set(key, resolved);
        return resolved;
      });
    }, [key]);
    return [value, set] as const;
  }

  const startTimer = (kind: 'timeout' | 'interval') => (fn: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
    const run = guard(fn);
    const id: ReturnType<typeof globalThis.setTimeout> = kind === 'timeout'
      ? globalThis.setTimeout(() => { timers.delete(id); run(...args); }, ms)
      : globalThis.setInterval(() => run(...args), ms);
    timers.set(id, kind);
    return id;
  };
  const stopTimer = (id: ReturnType<typeof globalThis.setTimeout>) => {
    const kind = timers.get(id);
    if (kind === 'interval') globalThis.clearInterval(id);
    else if (kind) globalThis.clearTimeout(id);
    timers.delete(id);
  };

  const haptic = (kind: string = 'light') => {
    if (kind === 'success') return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (kind === 'warning') return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    if (kind === 'error') return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    if (kind === 'selection') return Haptics.selectionAsync();
    return Haptics.impactAsync(kind === 'heavy' ? Haptics.ImpactFeedbackStyle.Heavy : kind === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
  };

  const alert = (title: string, message?: string) => new Promise<void>((resolve) => Alert.alert(String(title), message === undefined ? undefined : String(message), [{ text: 'OK', onPress: () => resolve() }], { onDismiss: () => resolve() }));
  const confirm = (title: string, message?: string, options: { confirm?: string; destructive?: boolean } = {}) => new Promise<boolean>((resolve) => Alert.alert(String(title), message === undefined ? undefined : String(message), [
    { text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) },
    { text: options.confirm ?? 'Aceptar', style: options.destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
  ], { onDismiss: () => resolve(false) }));
  const prompt = (title: string, message?: string, initial = '') => new Promise<string | null>((resolve) => Alert.prompt(String(title), message === undefined ? undefined : String(message), [
    { text: 'Cancelar', style: 'cancel', onPress: () => resolve(null) },
    { text: 'Aceptar', onPress: (value?: string) => resolve(value ?? '') },
  ], 'plain-text', initial));

  // Photos are copied into the miniapp's own folder at once, so they survive
  // the photo being deleted from the library.
  const pickImages = async (options: { multiple?: boolean; limit?: number } = {}) => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: options.multiple === true, selectionLimit: options.multiple ? Math.max(1, options.limit ?? 10) : 1, quality: 1 });
    if (result.canceled || disposed) return [];
    const saved = [];
    for (const asset of result.assets) saved.push(await saveScriptImage(fileName, asset));
    return saved;
  };
  const takePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Sin acceso a la cámara', 'Actívalo en Ajustes de iOS.');
      return null;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
    if (result.canceled || disposed) return null;
    return saveScriptImage(fileName, result.assets[0]);
  };

  const write = (level: LogLevel) => (...args: unknown[]) => {
    if (!disposed) logs.add(level, formatLog(args));
  };
  const console = { log: write('log'), info: write('info'), debug: write('log'), warn: write('warn'), error: write('error'), clear: () => logs.clear() };

  const scope: Record<string, unknown> = {
    React, Fragment, h,
    useState, useEffect, useMemo, useRef, useCallback, useReducer, useStored, useTheme,
    ...DEVICE_HOOKS,
    ...COMPONENTS,
    storage, haptic, alert, confirm, prompt, console,
    launch: Object.freeze({ ...launch }),
    ...createDeviceApi({ fileName, track }),
    pickImages, takePhoto,
    deleteImage: (id: string) => deleteScriptMedia(fileName, String(id)),
    close: () => {
      if (!disposed) close();
    },
    share: (text: string) => Share.share({ message: String(text) }),
    openURL: (url: string) => Linking.openURL(String(url)),
    clipboard: { get: () => Clipboard.getStringAsync(), set: (text: string) => Clipboard.setStringAsync(String(text)) },
    setTimeout: startTimer('timeout'),
    setInterval: startTimer('interval'),
    clearTimeout: stopTimer,
    clearInterval: stopTimer,
    SwiftUI,
    modifiers: RAW_MODIFIERS,
  };
  const modules = { superapp: scope, react: React, '@expo/ui/swift-ui': SwiftUI, '@expo/ui/swift-ui/modifiers': RAW_MODIFIERS };

  return {
    scope,
    modules,
    dispose: () => {
      disposed = true;
      for (const id of [...timers.keys()]) stopTimer(id);
      for (const cleanup of [...cleanups]) {
        try {
          cleanup();
        } catch {
          // A player that is already gone has nothing left to stop.
        }
      }
      cleanups.clear();
      flush();
    },
  };
}

type Failure = { message: string; line: number | null };

function describe(error: unknown): Failure {
  if (error instanceof ScriptError) return { message: error.message, line: error.line };
  return { message: error instanceof Error ? error.message : String(error), line: null };
}

class ScriptBoundary extends Component<{ onError: Report; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    this.props.onError(error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function FailureNative({ failure, tokens, onEdit, onRetry, onConsole, onClose }: { failure: Failure; tokens: ThemeTokens; onEdit: () => void; onRetry: () => void; onConsole: () => void; onClose: () => void }) {
  return <ScrollView modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity })]}>
    <NativeVStack alignment="leading" spacing={12} modifiers={[frame({ width: usePageWidth(), alignment: 'leading' }), padding({ horizontal: UI.pageInset, top: 24, bottom: 32 })]}>
      <NativeHStack alignment="center" spacing={10}>
        <SymbolImage name="exclamationmark.triangle.fill" color={tokens.danger} size={20} />
        <NativeText modifiers={textModifiers(tokens, { style: 'headline', weight: 'semibold' })}>{failure.line ? `Error en la línea ${failure.line}` : 'Error'}</NativeText>
      </NativeHStack>
      <NativeText modifiers={[foregroundStyle(tokens.text), font({ textStyle: 'callout', design: 'monospaced' }), textSelection(true)]}>{failure.message}</NativeText>
      <NativeHStack alignment="center" spacing={12} modifiers={[padding({ top: 6 })]}>
        <NativeButton label="Editar" systemImage="pencil" onPress={onEdit} modifiers={[buttonStyle(nativeGlassAvailable ? 'glassProminent' : 'borderedProminent'), controlSize('large'), tint(tokens.blue)]} />
        <NativeButton label="Reintentar" systemImage="arrow.clockwise" onPress={onRetry} modifiers={[buttonStyle(nativeGlassAvailable ? 'glass' : 'bordered'), controlSize('large'), foregroundStyle(tokens.text)]} />
        <NativeButton label="Cerrar" systemImage="xmark" onPress={onClose} modifiers={[buttonStyle(nativeGlassAvailable ? 'glass' : 'bordered'), controlSize('large'), foregroundStyle(tokens.text)]} />
      </NativeHStack>
      <NativeButton label="Consola" systemImage="terminal" onPress={onConsole} modifiers={[buttonStyle('plain'), foregroundStyle(tokens.blue)]} />
    </NativeVStack>
  </ScrollView>;
}

/** Calls `onShake` when the phone is shaken, while `enabled`. The accelerometer runs only then. */
function useShake(enabled: boolean, onShake: () => void) {
  const latest = useRef(onShake);
  latest.current = onShake;
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let subscription: { remove: () => void } | null = null;
    const detect = createShakeDetector();
    Accelerometer.isAvailableAsync().then((available) => {
      if (!available || cancelled) return;
      Accelerometer.setUpdateInterval(50);
      subscription = Accelerometer.addListener(({ x, y, z }) => {
        if (detect(x, y, z, Date.now())) latest.current();
      });
    }, () => {});
    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [enabled]);
}

/** The app's own panel over a running miniapp, opened by shaking. */
function ScriptMenuNative({ meta, name, tokens, logCount, onRestart, onEdit, onConsole, onClose }: { meta: ScriptMeta | null; name: string; tokens: ThemeTokens; logCount: number; onRestart: () => void; onEdit: () => void; onConsole: () => void; onClose: () => void }) {
  const hue = meta?.color ? resolveColor(meta.color, tokens) : null;
  const iconColor = typeof hue === 'string' ? hue : tokens.slate;
  return <NativeVStack spacing={0} modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'top' }), background(tokens.background)]}>
    <NativeHStack alignment="center" spacing={14} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ horizontal: UI.pageInset, top: 24, bottom: 4 })]}>
      <NativeVStack alignment="center" spacing={0} modifiers={[frame({ width: 44, height: 44 }), background(typeof hue === 'string' ? withAlpha(hue, tokens.mode === 'dark' ? 0.18 : 0.14) : tokens.slateSoft), clipShape('roundedRectangle', UI.iconRadius)]}>
        <SymbolImage name={(meta?.icon ?? 'curlybraces') as SFSymbol} color={iconColor} size={22} />
      </NativeVStack>
      <NativeVStack alignment="leading" spacing={2}>
        <NativeText modifiers={[...textModifiers(tokens, { style: 'title3', weight: 'semibold' }), lineLimit(1)]}>{meta?.title ?? baseName(name)}</NativeText>
        <NativeText modifiers={[...textModifiers(tokens, { color: tokens.secondary, style: 'subheadline' }), lineLimit(1)]}>{name}</NativeText>
      </NativeVStack>
    </NativeHStack>
    <Form modifiers={[Modifiers.listStyle('insetGrouped'), Modifiers.scrollContentBackground('hidden'), background(tokens.background), frame({ maxWidth: Infinity, maxHeight: Infinity }), Modifiers.scrollDisabled(true)]}>
      <NativeSection>
        <NativeButton label="Reiniciar" systemImage="arrow.clockwise" onPress={onRestart} modifiers={[tint(tokens.blue)]} />
        <NativeButton label="Editar" systemImage="pencil" onPress={onEdit} modifiers={[tint(tokens.blue)]} />
        <NativeButton onPress={onConsole} modifiers={[tint(tokens.blue)]}>
          <NativeHStack alignment="center" spacing={0}>
            <SwiftUI.Label title="Consola" systemImage="terminal" />
            <NativeSpacer />
            {logCount ? <NativeText modifiers={[foregroundStyle(tokens.secondary), Modifiers.monospacedDigit()]}>{String(logCount)}</NativeText> : null}
          </NativeHStack>
        </NativeButton>
      </NativeSection>
      <NativeSection>
        <NativeButton label="Cerrar miniapp" systemImage="xmark.circle" role="destructive" onPress={onClose} />
      </NativeSection>
    </Form>
  </NativeVStack>;
}

const LOG_COLORS: Record<LogLevel, (tokens: ThemeTokens) => ColorValue> = {
  log: (tokens) => tokens.text,
  info: (tokens) => tokens.blue,
  warn: (tokens) => colorForKey('orange', tokens.mode).ink,
  error: (tokens) => tokens.danger,
};
const timeFormat = new Intl.DateTimeFormat('es-PE', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

/** What the miniapp wrote with console.*, newest last. */
function ConsoleNative({ logs, tokens, onBack }: { logs: LogBook; tokens: ThemeTokens; onBack: () => void }) {
  const entries = useSyncExternalStore(logs.subscribe, logs.get);
  const copy = () => {
    void Clipboard.setStringAsync(entries.map((entry) => `${timeFormat.format(entry.time)} ${entry.level === 'log' ? '' : `[${entry.level}] `}${entry.text}`).join('\n'));
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };
  return <NativeVStack spacing={0} modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'top' }), background(tokens.background)]}>
    <NativeHStack alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity }), padding({ horizontal: UI.pageInset, top: 20, bottom: 10 })]}>
      <NativeCircleButton tokens={tokens} label="Volver" systemName="chevron.left" onPress={onBack} />
      <NativeText modifiers={[...textModifiers(tokens, { style: 'headline', weight: 'semibold' }), frame({ maxWidth: Infinity })]}>Consola</NativeText>
      <NativeCircleButton tokens={tokens} label="Copiar" systemName="doc.on.doc" onPress={copy} disabled={!entries.length} />
      <NativeCircleButton tokens={tokens} label="Borrar" systemName="trash" onPress={logs.clear} disabled={!entries.length} />
    </NativeHStack>
    {entries.length ? <ScrollView modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity }), Modifiers.defaultScrollAnchor('bottom')]}>
      <SwiftUI.LazyVStack alignment="leading" spacing={8} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ horizontal: UI.pageInset, bottom: 24 })]}>
        {entries.map((entry) => <NativeHStack key={entry.id} alignment="firstTextBaseline" spacing={8} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
          <NativeText modifiers={[foregroundStyle(tokens.secondary), font({ size: 11, design: 'monospaced' })]}>{timeFormat.format(entry.time)}</NativeText>
          <NativeText modifiers={[foregroundStyle(LOG_COLORS[entry.level](tokens)), font({ size: 13, design: 'monospaced' }), textSelection(true), frame({ maxWidth: Infinity, alignment: 'leading' })]}>{entry.text}</NativeText>
        </NativeHStack>)}
      </SwiftUI.LazyVStack>
    </ScrollView> : <NativeVStack modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity })]}>
      <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary })}>Sin mensajes</NativeText>
    </NativeVStack>}
  </NativeVStack>;
}

type Loaded = { App: (props: Record<string, never>) => unknown; meta: ScriptMeta; runtime: Runtime };

/**
 * Runs one file on the whole screen: no header, ground, tab bar or control
 * from the app, only what the file draws. Shaking the phone (when enabled in
 * Ajustes) opens the app's panel to restart, edit or close it; otherwise only
 * the file's own close() or quitting the app leaves it. Errors replace the
 * view until the file is edited or run again.
 */
function ScriptNative({ name, tokens, shake, launch, onClose, onEdit }: { name: string; tokens: ThemeTokens; shake: boolean; launch: ScriptLaunch; onClose: () => void; onEdit: () => void }) {
  const [run, setRun] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [panel, setPanel] = useState<'menu' | 'console' | null>(null);
  const logs = useMemo(createLogBook, []);
  const report = useCallback((error: unknown) => {
    const found = describe(error);
    logs.add('error', found.line ? `Línea ${found.line}: ${found.message}` : found.message);
    setFailure((current) => current ?? found);
  }, [logs]);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const launchRef = useRef(launch);
  launchRef.current = launch;

  useShake(shake && !panel, () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPanel('menu');
  });

  useEffect(() => {
    let cancelled = false;
    let runtime: Runtime | null = null;
    setLoaded(null);
    setFailure(null);
    void (async () => {
      try {
        const [source, data] = await Promise.all([readScript(name), loadScriptData(name)]);
        if (cancelled) return;
        const { code } = checkScript(source);
        runtime = createRuntime(name, data, report, () => closeRef.current(), logs, launchRef.current);
        const exports = evaluateScript(code, runtime.scope, runtime.modules);
        if (cancelled) return;
        setLoaded({ App: scriptComponent(exports), meta: readMeta(exports, name), runtime });
      } catch (error) {
        if (!cancelled) report(error);
      }
    })();
    return () => {
      cancelled = true;
      runtime?.dispose();
    };
  }, [name, run, report, logs]);

  // A failed run stops its timers so nothing keeps firing behind the error.
  useEffect(() => {
    if (failure) loaded?.runtime.dispose();
  }, [failure, loaded]);

  const restart = () => {
    setPanel(null);
    setRun((value) => value + 1);
  };
  return <NativeZStack alignment="top" modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity })]}>
    {failure ? <FailureNative failure={failure} tokens={tokens} onEdit={onEdit} onRetry={restart} onConsole={() => setPanel('console')} onClose={onClose} />
      : !loaded ? <NativeVStack modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity })]}><ProgressView /></NativeVStack>
      : <TokensContext.Provider value={tokens}>
        <ScriptFileContext.Provider value={name}>
          <ScriptBoundary key={run} onError={report}>
            <NativeVStack spacing={0} modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity })]}>
              {React.createElement(loaded.App as React.ComponentType)}
            </NativeVStack>
          </ScriptBoundary>
        </ScriptFileContext.Provider>
      </TokensContext.Provider>}
    <BottomSheet isPresented={panel !== null} onIsPresentedChange={(open) => { if (!open) setPanel(null); }} onDismiss={() => setPanel(null)}>
      {panel === 'menu' ? <SwiftUI.Group modifiers={[Modifiers.presentationDetents([{ height: 340 }]), Modifiers.presentationDragIndicator('visible')]}>
        <ScriptMenuNative meta={loaded?.meta ?? null} name={name} tokens={tokens} logCount={logs.get().length} onRestart={restart} onEdit={() => { setPanel(null); onEdit(); }} onConsole={() => setPanel('console')} onClose={() => { setPanel(null); onClose(); }} />
      </SwiftUI.Group> : panel === 'console' ? <SwiftUI.Group modifiers={[Modifiers.presentationDetents(['medium', 'large']), Modifiers.presentationDragIndicator('visible')]}>
        <ConsoleNative logs={logs} tokens={tokens} onBack={() => setPanel(failure ? null : 'menu')} />
      </SwiftUI.Group> : null}
    </BottomSheet>
  </NativeZStack>;
}

const LIBRARY_LAUNCH: ScriptLaunch = { source: 'library', data: null };

/** Presents a running miniapp full screen, over the tab bar, in its own SwiftUI host. `runKey` starts it afresh. */
export function ScriptRunnerNative({ name, visible, shake, tokens, launch = LIBRARY_LAUNCH, runKey = 0, onClose, onEdit }: { name: string | null; visible: boolean; shake: boolean; tokens: ThemeTokens; launch?: ScriptLaunch; runKey?: number; onClose: () => void; onEdit: (name: string) => void }) {
  return <Modal visible={visible && Boolean(name)} presentationStyle="fullScreen" animationType="slide" onRequestClose={onClose}>
    <Host style={{ flex: 1, backgroundColor: PlatformColor('systemBackground') }} colorScheme={tokens.mode} seedColor={tokens.blue} useViewportSizeMeasurement>
      {name ? <ScriptNative key={`${name}#${runKey}`} name={name} tokens={tokens} shake={shake} launch={launch} onClose={onClose} onEdit={() => onEdit(name)} /> : <NativeVStack>{null}</NativeVStack>}
    </Host>
  </Modal>;
}

// ---------------------------------------------------------------------------
// Editor

/** Edits a file, or writes a new one when `name` is null. Saving checks the code and keeps any error on screen. */
export function ScriptEditorNative({ name, tokens, onClose, onSaved }: { name: string | null; tokens: ThemeTokens; onClose: () => void; onSaved: (name: string) => void }) {
  const files = useScripts().files;
  const width = usePageWidth();
  const nameState = useNativeState(name ? baseName(name) : '');
  const sourceState = useNativeState('');
  const [nameDraft, setNameDraft] = useState(name ? baseName(name) : '');
  const [source, setSource] = useState<string | null>(name ? null : NEW_SCRIPT);
  const [saved, setSaved] = useState({ name: name ? baseName(name) : '', source: name ? '' : NEW_SCRIPT });
  const [current, setCurrent] = useState(name);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [issue, setIssue] = useState<Failure | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    if (!name) {
      sourceState.set(NEW_SCRIPT);
      return;
    }
    setLoadError(null);
    readScript(name).then((text) => {
      sourceState.set(text);
      setSource(text);
      setSaved({ name: baseName(name), source: text });
    }, () => setLoadError(`No se pudo abrir "${name}".`));
  }, [name, sourceState]);
  useEffect(load, [load]);

  const dirty = source !== null && (source !== saved.source || nameDraft.trim() !== saved.name);

  const save = async () => {
    if (source === null || saving) return;
    const extension = current && /\.jsx$/i.test(current) ? '.jsx' : '.js';
    const fileName = scriptFileName(/\.jsx?$/i.test(nameDraft.trim()) ? nameDraft : `${nameDraft}${extension}`);
    if (!fileName) {
      setIssue({ message: 'Escribe un nombre.', line: null });
      return;
    }
    const taken = files.some((file) => file.name.toLowerCase() === fileName.toLowerCase() && file.name.toLowerCase() !== current?.toLowerCase());
    if (taken) {
      setIssue({ message: `Ya existe "${fileName}".`, line: null });
      return;
    }
    let text = source;
    let problem: Failure | null = null;
    try {
      const checked = checkScript(source);
      if (checked.fixed) {
        text = checked.fixed;
        sourceState.set(text);
        setSource(text);
      }
    } catch (error) {
      problem = describe(error);
    }
    setSaving(true);
    try {
      if (current && current !== fileName) await renameScript(current, fileName);
      await writeScript(fileName, text);
    } catch (error) {
      setSaving(false);
      setIssue({ message: error instanceof Error ? error.message : 'No se pudo guardar.', line: null });
      return;
    }
    setSaving(false);
    setCurrent(fileName);
    setSaved({ name: baseName(fileName), source: text });
    setIssue(problem);
    if (problem) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onSaved(fileName);
  };

  const close = () => {
    if (!dirty) {
      onClose();
      return;
    }
    Alert.alert('Descartar cambios', undefined, [
      { text: 'Seguir editando', style: 'cancel' },
      { text: 'Descartar', style: 'destructive', onPress: onClose },
    ]);
  };

  const action = <NativeCircleButton tokens={tokens} accent label="Guardar" systemName="checkmark" onPress={() => void save()} busy={saving} disabled={source === null || (!dirty && current !== null)} />;
  return <PageNative title={current ? baseName(current) : 'Nueva miniapp'} tokens={tokens} onBack={close} backLabel="Cerrar" action={action}>
    {loadError ? <NativeVStack alignment="leading" spacing={12} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ horizontal: UI.pageInset, top: 6 })]}>
      <NativeText modifiers={textModifiers(tokens)}>{loadError}</NativeText>
      <NativeButton label="Reintentar" onPress={load} modifiers={[buttonStyle('bordered'), tint(tokens.blue)]} />
    </NativeVStack> : source === null ? <NativeVStack modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'top' }), padding({ top: 24 })]}><ProgressView /></NativeVStack>
    : <ScrollView modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity }), scrollDismissesKeyboard('interactively')]}>
      <NativeVStack alignment="leading" spacing={14} modifiers={[frame({ width, alignment: 'leading' }), padding({ horizontal: UI.pageInset, top: 6, bottom: 32 })]}>
        <NativeTextField
          text={nameState}
          placeholder="Nombre"
          onTextChange={(text) => {
            setNameDraft(text);
            setIssue(null);
          }}
          modifiers={[frame({ maxWidth: Infinity }), font({ textStyle: 'title3', weight: 'semibold' }), autocorrectionDisabled(), accessibilityLabel('Nombre del archivo')]}
        />
        <NativeDivider />
        {issue ? <NativeHStack alignment="top" spacing={8} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
          <SymbolImage name="exclamationmark.triangle.fill" color={tokens.danger} size={14} />
          <NativeText modifiers={[foregroundStyle(tokens.danger), font({ textStyle: 'footnote', design: 'monospaced' })]}>{issue.line ? `Línea ${issue.line}: ${issue.message}` : issue.message}</NativeText>
        </NativeHStack> : null}
        <NativeTextField
          text={sourceState}
          axis="vertical"
          onTextChange={(text) => {
            setSource(text);
            if (issue?.line) setIssue(null);
          }}
          modifiers={[
            frame({ maxWidth: Infinity, minHeight: 320, alignment: 'topLeading' }),
            font({ size: 13, design: 'monospaced' }),
            autocorrectionDisabled(),
            textInputAutocapitalization('never'),
            keyboardType('ascii-capable'),
            accessibilityLabel('Código'),
          ]}
        />
      </NativeVStack>
    </ScrollView>}
  </PageNative>;
}

// ---------------------------------------------------------------------------
// Biblioteca

const metaCache = new Map<string, { modified: number; meta: ScriptMeta }>();

/** Each file's meta, read from its text and kept until the file changes. */
function useScriptMetas(files: ScriptFile[]) {
  const [, bump] = useReducer((value: number) => value + 1, 0);
  useEffect(() => {
    let cancelled = false;
    const stale = files.filter((file) => metaCache.get(file.name)?.modified !== file.modified);
    if (!stale.length) return;
    void Promise.all(stale.map(async (file) => {
      try {
        metaCache.set(file.name, { modified: file.modified, meta: staticMeta(await readScript(file.name), file.name) });
      } catch {
        metaCache.set(file.name, { modified: file.modified, meta: readMeta(null, file.name) });
      }
    })).then(() => {
      if (!cancelled) bump();
    });
    return () => {
      cancelled = true;
    };
  }, [files]);
  return (name: string) => metaCache.get(name)?.meta ?? readMeta(null, name);
}

export function ScriptRowsNative({ tokens, onOpen, onEdit }: { tokens: ThemeTokens; onOpen: (name: string) => void; onEdit: (name: string) => void }) {
  const { files, failed } = useScripts();
  const metaFor = useScriptMetas(files);
  useEffect(() => {
    void refreshScripts();
  }, []);

  const remove = (name: string) => Alert.alert(`Eliminar "${name}"`, 'Se borran el archivo y sus datos guardados.', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Eliminar', style: 'destructive', onPress: () => void deleteScript(name).catch(() => Alert.alert('No se pudo eliminar', name)) },
  ]);

  if (failed && !files.length) return <NativeHStack alignment="center" spacing={10} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ horizontal: 4 })]}>
    <NativeText modifiers={textModifiers(tokens, { color: tokens.secondary })}>No se pudo leer la carpeta de miniapps.</NativeText>
    <NativeSpacer />
    <NativeButton label="Reintentar" onPress={() => void refreshScripts()} modifiers={[tint(tokens.blue)]} />
  </NativeHStack>;

  return <>
    {files.map((file) => {
      const meta = metaFor(file.name);
      const hue = meta.color ? resolveColor(meta.color, tokens) : null;
      const iconColor = typeof hue === 'string' ? hue : tokens.slate;
      return <ContextMenu key={file.name}>
        <ContextMenu.Trigger>
          <NativeVStack alignment="leading" spacing={0} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ horizontal: 16, vertical: 4 }), background(tokens.surface), clipShape('roundedRectangle', UI.groupRadius)]}>
            <MiniappRowNative title={meta.title} detail={meta.detail ?? file.name} icon={meta.icon as SFSymbol} iconColor={iconColor} iconBackground={typeof hue === 'string' ? withAlpha(hue, tokens.mode === 'dark' ? 0.18 : 0.14) : tokens.slateSoft} tokens={tokens} onPress={() => onOpen(file.name)} label={`Abrir ${meta.title}`} />
          </NativeVStack>
        </ContextMenu.Trigger>
        <ContextMenu.Items>
          <NativeButton label="Editar" systemImage="pencil" onPress={() => onEdit(file.name)} />
          <NativeButton label="Compartir archivo" systemImage="square.and.arrow.up" onPress={() => void shareScript(file.name).catch(() => Alert.alert('No se pudo compartir', file.name))} />
          <NativeButton label="Eliminar" systemImage="trash" role="destructive" onPress={() => remove(file.name)} />
        </ContextMenu.Items>
      </ContextMenu>;
    })}
  </>;
}

/** Biblioteca's header control: a new file, or files from the Files app. */
export function ScriptsMenuNative({ tokens, onCreate, onImported }: { tokens: ThemeTokens; onCreate: () => void; onImported: (names: string[]) => void }) {
  const doImport = async () => {
    try {
      const names = await importScripts();
      if (names.length) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onImported(names);
      }
    } catch (error) {
      Alert.alert('No se pudo importar', error instanceof Error ? error.message : 'Inténtalo de nuevo.');
    }
  };
  const glass: ViewModifier[] = nativeGlassAvailable
    ? [glassEffect({ glass: { variant: 'regular', interactive: true }, shape: 'circle' })]
    : [background(tokens.surface), clipShape('circle')];
  return <Menu label={<NativeZStack alignment="center" modifiers={[frame({ width: CIRCLE_CONTROL_SIZE, height: CIRCLE_CONTROL_SIZE }), ...glass]}>
    <NativeImage systemName="plus" modifiers={[font({ size: 20 }), foregroundStyle(tokens.text)]} />
  </NativeZStack>} modifiers={[menuIndicator('hidden'), accessibilityLabel('Agregar miniapp')]}>
    <NativeButton label="Nueva miniapp" systemImage="doc.badge.plus" onPress={onCreate} />
    <NativeButton label="Importar archivo" systemImage="square.and.arrow.down" onPress={() => void doImport()} />
  </Menu>;
}
