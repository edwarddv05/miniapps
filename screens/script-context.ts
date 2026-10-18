// What every miniapp view shares: the app's theme, the running file's name and
// the props all views take (padding, frame, background…).

import { clipShape, disabled, frame, onTapGesture, opacity, padding, type ViewModifier } from '@expo/ui/swift-ui/modifiers';
import { createContext, useContext } from 'react';
import type { ColorValue } from 'react-native';
import { background } from '../native-colors';
import type { ScheduleColor } from '../schedule-data';
import { colorForKey, type ThemeTokens } from './shared';

export const TokensContext = createContext<ThemeTokens | null>(null);
export const InListContext = createContext(false);
// The running file's name, so Photo, Video and the media hooks find that miniapp's files.
export const ScriptFileContext = createContext('');
export const useTokens = () => useContext(TokensContext) as ThemeTokens;

const CLASS_COLORS = new Set<string>(['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'indigo', 'purple', 'pink', 'brown']);

/** 'accent', 'secondary', 'danger', a class colour name ('orange') or any hex. */
export function resolveColor(value: unknown, tokens: ThemeTokens, role: 'main' | 'ink' = 'main'): ColorValue | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  if (value === 'accent') return tokens.blue;
  if (value === 'secondary') return tokens.secondary;
  if (value === 'primary') return tokens.text;
  if (value === 'danger') return tokens.danger;
  if (value === 'surface') return tokens.surface;
  if (value === 'background') return tokens.background;
  if (CLASS_COLORS.has(value)) {
    const color = colorForKey(value as ScheduleColor, tokens.mode);
    return role === 'ink' ? color.ink : color.main;
  }
  return value;
}

export type FrameAlignment = 'center' | 'leading' | 'trailing' | 'top' | 'bottom' | 'topLeading' | 'topTrailing' | 'bottomLeading' | 'bottomTrailing';
export type ViewProps = {
  padding?: number | { top?: number; bottom?: number; leading?: number; trailing?: number; horizontal?: number; vertical?: number };
  width?: number;
  height?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  fill?: boolean;
  frameAlignment?: FrameAlignment;
  background?: string;
  radius?: number;
  opacity?: number;
  disabled?: boolean;
  onTap?: () => void;
  modifiers?: ViewModifier[];
};

export function common(props: ViewProps, tokens: ThemeTokens): ViewModifier[] {
  const result: ViewModifier[] = [];
  if (typeof props.padding === 'number') result.push(padding({ all: props.padding }));
  else if (props.padding) result.push(padding(props.padding));
  const size = { width: props.width, height: props.height, minHeight: props.minHeight, maxWidth: props.fill ? Infinity : props.maxWidth, maxHeight: props.maxHeight };
  if (Object.values(size).some((value) => value !== undefined)) result.push(frame({ ...size, alignment: props.frameAlignment ?? (props.fill ? 'leading' : undefined) }));
  const fill = resolveColor(props.background, tokens);
  if (fill) result.push(background(fill));
  if (props.radius !== undefined) result.push(clipShape('roundedRectangle', props.radius));
  if (props.opacity !== undefined) result.push(opacity(props.opacity));
  if (props.disabled) result.push(disabled(true));
  if (props.onTap) result.push(onTapGesture(props.onTap));
  return [...result, ...(Array.isArray(props.modifiers) ? props.modifiers : [])];
}

/** How a run started: from Biblioteca, a miniapps:// link (`data` holds its query) or a tapped notification (`data` as scheduled). */
export type ScriptLaunch = { source: 'library' | 'link' | 'notification'; data: unknown };
