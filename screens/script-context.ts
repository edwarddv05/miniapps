// What every miniapp view shares: the app's theme, the running file's name and
// the props all views take (padding, frame, background…).

import { Animation, animation, clipShape, disabled, frame, offset, onLongPressGesture, onTapGesture, opacity, padding, rotationEffect, scaleEffect, type ViewModifier } from '@expo/ui/swift-ui/modifiers';
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
  onLongPress?: () => void;
  /** Moves the view by this many points without changing the layout. */
  x?: number;
  y?: number;
  scale?: number;
  /** Degrees, clockwise. */
  rotation?: number;
  /** Animates the changes above whenever `animateOn` changes. */
  animation?: AnimationKind | { type: AnimationKind; duration?: number };
  animateOn?: unknown;
  modifiers?: ViewModifier[];
};

type AnimationKind = 'default' | 'spring' | 'bouncy' | 'easeInOut' | 'easeIn' | 'easeOut' | 'linear';

function animationFor(value: ViewProps['animation']) {
  const kind = typeof value === 'object' && value ? value.type : value ?? 'default';
  const duration = typeof value === 'object' && value ? value.duration : undefined;
  if (kind === 'spring') return Animation.spring();
  if (kind === 'bouncy') return Animation.spring({ response: 0.45, dampingFraction: 0.55 });
  if (kind === 'easeIn' || kind === 'easeOut' || kind === 'easeInOut' || kind === 'linear') return Animation[kind]({ duration });
  return Animation.default;
}

// SwiftUI animates on a number or a boolean; anything else is reduced to a number that changes with it.
function animatedValue(value: unknown): number | boolean {
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  let text: string;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  let hash = 0;
  for (let index = 0; index < text.length; index++) hash = (hash * 31 + text.charCodeAt(index)) | 0;
  return hash;
}

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
  if (props.x !== undefined || props.y !== undefined) result.push(offset({ x: props.x ?? 0, y: props.y ?? 0 }));
  if (props.scale !== undefined) result.push(scaleEffect(props.scale));
  if (props.rotation !== undefined) result.push(rotationEffect(props.rotation));
  if (props.onTap) result.push(onTapGesture(props.onTap));
  if (props.onLongPress) result.push(onLongPressGesture(props.onLongPress));
  if (props.animateOn !== undefined) result.push(animation(animationFor(props.animation), animatedValue(props.animateOn)));
  return [...result, ...(Array.isArray(props.modifiers) ? props.modifiers : [])];
}

/** How a run started: from Biblioteca, a miniapps:// link (`data` holds its query) or a tapped notification (`data` as scheduled). */
export type ScriptLaunch = { source: 'library' | 'link' | 'notification'; data: unknown };
