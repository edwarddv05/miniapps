// Views for miniapps that go past a single screen of controls: a navigation
// stack with the swipe back, a canvas to draw SVG shapes and follow touches on,
// and a sketch pad for drawing by hand.

import { HStack, RNHostView, Text as NativeText, VStack, ZStack } from '@expo/ui/swift-ui';
import { accessibilityHidden, frame, hidden, lineLimit, offset, padding } from '@expo/ui/swift-ui/modifiers';
import React, { createContext, useContext, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { PanResponder, View, type GestureResponderEvent, type PanResponderGestureState } from 'react-native';
import SvgView, { Circle, ClipPath, Defs, Ellipse, G, Line, LinearGradient, Path, Polygon, Polyline, RadialGradient, Rect, Stop, TSpan, Text as SvgText } from 'react-native-svg';
import { background } from '../native-colors';
import { ScriptError, strokePath, type Stroke } from '../script-runtime';
import { UI } from '../ui-structure';
import { common, resolveColor, useTokens, type ViewProps } from './script-context';
import { NativeCircleButton, textModifiers, usePageWidth, type ThemeTokens } from './shared';

// The system background the runner draws on, as plain colours so every
// screen of a stack covers the one under it.
const ground = (tokens: ThemeTokens) => (tokens.mode === 'dark' ? '#000000' : '#FFFFFF');

/** A colour for SVG, which takes only plain strings. */
function svgColor(value: unknown, tokens: ThemeTokens) {
  const color = resolveColor(value, tokens);
  return typeof color === 'string' ? color : tokens.mode === 'dark' ? '#FFFFFF' : '#000000';
}

// ─── Navigation ────────────────────────────────────────────────────────────

type ScreenEntry = { key: number; component: ComponentType<Record<string, unknown>>; props: Record<string, unknown>; title?: string };
type PushOptions = { title?: string };
type Navigation = {
  push: (component: unknown, props?: Record<string, unknown>, options?: PushOptions) => void;
  replace: (component: unknown, props?: Record<string, unknown>, options?: PushOptions) => void;
  pop: () => void;
  popToRoot: () => void;
  depth: number;
  canGoBack: boolean;
};

const NavigationContext = createContext<Navigation | null>(null);

export function useNavigation() {
  const navigation = useContext(NavigationContext);
  if (!navigation) throw new ScriptError('useNavigation() solo funciona dentro de <Stack>.');
  return navigation;
}

const checked = (component: unknown) => {
  if (typeof component !== 'function') throw new ScriptError('push() necesita un componente, por ejemplo push(Detalle, { id }).');
  return component as ScreenEntry['component'];
};

/** Follows a swipe from the left edge; past a third of the way (or a quick flick) it goes back. */
function EdgeSwipe({ onMove, onEnd }: { onMove: (dx: number) => void; onEnd: (back: boolean) => void }) {
  const latest = useRef({ onMove, onEnd });
  latest.current = { onMove, onEnd };
  const width = usePageWidth() + UI.pageInset * 2;
  const responder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => gesture.dx > 6 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
    onPanResponderMove: (_, gesture) => latest.current.onMove(Math.max(0, gesture.dx)),
    onPanResponderRelease: (_, gesture) => latest.current.onEnd(gesture.dx > width / 3 || gesture.vx > 0.8),
    onPanResponderTerminate: () => latest.current.onEnd(false),
  }), [width]);
  return <VStack modifiers={[frame({ width: 20, maxHeight: Infinity }), accessibilityHidden()]}>
    <RNHostView><View style={{ flex: 1 }} {...responder.panHandlers} /></RNHostView>
  </VStack>;
}

/**
 * Screens on top of each other. `root` is the first; useNavigation().push
 * shows another with a back button and the swipe from the left edge. Screens
 * under the top one stay mounted, so they keep their scroll and state.
 */
export function Stack({ root, props, title, header = true }: { root: unknown; props?: Record<string, unknown>; title?: string; header?: boolean }) {
  const tokens = useTokens();
  const [entries, setEntries] = useState<ScreenEntry[]>(() => [{ key: 0, component: checked(root), props: props ?? {}, title }]);
  const [drag, setDrag] = useState(0);
  const nextKey = useRef(1);
  const actions = useMemo(() => ({
    push: (component: unknown, screenProps: Record<string, unknown> = {}, options: PushOptions = {}) => {
      const next = { key: nextKey.current++, component: checked(component), props: screenProps, title: options.title };
      setEntries((list) => [...list, next]);
    },
    replace: (component: unknown, screenProps: Record<string, unknown> = {}, options: PushOptions = {}) => {
      const next = { key: nextKey.current++, component: checked(component), props: screenProps, title: options.title };
      setEntries((list) => [...list.slice(0, -1), next]);
    },
    pop: () => setEntries((list) => (list.length > 1 ? list.slice(0, -1) : list)),
    popToRoot: () => setEntries((list) => list.slice(0, 1)),
  }), []);
  const navigation = useMemo(() => ({ ...actions, depth: entries.length, canGoBack: entries.length > 1 }), [actions, entries.length]);
  const topIndex = entries.length - 1;

  return <NavigationContext.Provider value={navigation}>
    <ZStack alignment="topLeading" modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'topLeading' })]}>
      {entries.map((entry, index) => {
        const top = index === topIndex;
        // While swiping back, the screen underneath shows through.
        const visible = top || (drag > 0 && index === topIndex - 1);
        return <VStack key={entry.key} spacing={0} modifiers={[
          frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'top' }),
          background(ground(tokens)),
          hidden(!visible),
          ...(!top ? [accessibilityHidden()] : []),
          ...(top && drag ? [offset({ x: drag })] : []),
        ]}>
          {header && index > 0 ? <HStack alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ horizontal: UI.pageInset, top: 8, bottom: 6 })]}>
            <NativeCircleButton tokens={tokens} label="Atrás" systemName="chevron.left" onPress={actions.pop} />
            {entry.title ? <NativeText modifiers={[...textModifiers(tokens, { style: 'headline', weight: 'semibold' }), lineLimit(1)]}>{entry.title}</NativeText> : null}
          </HStack> : null}
          <VStack spacing={0} modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'top' })]}>
            {React.createElement(entry.component, entry.props)}
          </VStack>
        </VStack>;
      })}
      {entries.length > 1 ? <EdgeSwipe onMove={setDrag} onEnd={(back) => {
        setDrag(0);
        if (back) actions.pop();
      }} /> : null}
    </ZStack>
  </NavigationContext.Provider>;
}

// ─── Drawing ───────────────────────────────────────────────────────────────

export type TouchPoint = { x: number; y: number };
export type DragPoint = TouchPoint & { dx: number; dy: number; vx: number; vy: number };
type TouchHandlers = {
  onPress?: (point: TouchPoint) => void;
  onDragStart?: (point: TouchPoint) => void;
  onDrag?: (point: DragPoint) => void;
  onDragEnd?: (point: DragPoint) => void;
};

/** Touches on a view, in its own coordinates: a tap, or a drag from start to end. */
function useTouches(handlers: TouchHandlers) {
  const latest = useRef(handlers);
  latest.current = handlers;
  const start = useRef<TouchPoint>({ x: 0, y: 0 });
  const moved = useRef(false);
  return useMemo(() => {
    const at = (event: GestureResponderEvent, gesture: PanResponderGestureState): DragPoint => ({
      x: start.current.x + gesture.dx,
      y: start.current.y + gesture.dy,
      dx: gesture.dx,
      dy: gesture.dy,
      vx: gesture.vx,
      vy: gesture.vy,
    });
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: (event) => {
        start.current = { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY };
        moved.current = false;
      },
      onPanResponderMove: (event, gesture) => {
        if (!moved.current) {
          if (Math.hypot(gesture.dx, gesture.dy) < 4) return;
          moved.current = true;
          latest.current.onDragStart?.(start.current);
        }
        latest.current.onDrag?.(at(event, gesture));
      },
      onPanResponderRelease: (event, gesture) => {
        if (moved.current) latest.current.onDragEnd?.(at(event, gesture));
        else latest.current.onPress?.(start.current);
      },
      onPanResponderTerminate: (event, gesture) => {
        if (moved.current) latest.current.onDragEnd?.(at(event, gesture));
      },
      // A drag inside a scrolling Page keeps going instead of turning into a scroll.
      onPanResponderTerminationRequest: () => false,
    });
  }, []);
}

/**
 * SVG shapes (`Svg.Path`, `Svg.Circle`…) at the page width, `height` tall.
 * Touches arrive in the canvas' coordinates through onPress and onDrag*.
 */
export function Canvas({ children, width, height = 240, color, onPress, onDragStart, onDrag, onDragEnd, ...rest }: ViewProps & TouchHandlers & { children?: ReactNode; color?: string }) {
  const tokens = useTokens();
  const w = width ?? usePageWidth();
  const touches = useTouches({ onPress, onDragStart, onDrag, onDragEnd });
  const listens = Boolean(onPress || onDragStart || onDrag || onDragEnd);
  const fill = color ? svgColor(color, tokens) : undefined;
  return <VStack modifiers={[frame({ width: w, height }), ...common(rest, tokens)]}>
    <RNHostView>
      <View style={{ flex: 1, backgroundColor: fill }} {...(listens ? touches.panHandlers : {})}>
        <SvgView width={w} height={height}>{children}</SvgView>
      </View>
    </RNHostView>
  </VStack>;
}

/**
 * A pad to draw on with a finger. `value` is the list of strokes and
 * `onChange` gets the new list after each one, so it can go in useStored.
 */
export function Sketch({ value, onChange, color = 'primary', lineWidth = 4, height = 320, ...rest }: ViewProps & { value?: Stroke[]; onChange?: (strokes: Stroke[]) => void; color?: string; lineWidth?: number }) {
  const tokens = useTokens();
  const [live, setLive] = useState<Stroke | null>(null);
  const liveRef = useRef<Stroke | null>(null);
  const strokes = Array.isArray(value) ? value : [];
  const ink = svgColor(color, tokens);
  const round = (n: number) => Math.round(n * 10) / 10;
  const update = (next: Stroke | null) => {
    liveRef.current = next;
    setLive(next);
  };
  const draw = (stroke: Stroke, key: string | number) => <Path key={key} d={strokePath(stroke.points)} stroke={stroke.color} strokeWidth={stroke.width} strokeLinecap="round" strokeLinejoin="round" fill="none" />;
  return <Canvas
    {...rest}
    height={height}
    onPress={(point) => onChange?.([...strokes, { color: ink, width: lineWidth, points: [[round(point.x), round(point.y)]] }])}
    onDragStart={(point) => update({ color: ink, width: lineWidth, points: [[round(point.x), round(point.y)]] })}
    onDrag={(point) => {
      const current = liveRef.current;
      if (!current) return;
      const [lx, ly] = current.points[current.points.length - 1];
      // Points closer than 1.5 pt add nothing visible.
      if (Math.hypot(point.x - lx, point.y - ly) < 1.5) return;
      update({ ...current, points: [...current.points, [round(point.x), round(point.y)]] });
    }}
    onDragEnd={() => {
      const done = liveRef.current;
      update(null);
      if (done) onChange?.([...strokes, done]);
    }}
  >
    {strokes.map(draw)}
    {live ? draw(live, 'live') : null}
  </Canvas>;
}

export const Svg = { Path, Circle, Rect, Line, Polyline, Polygon, Ellipse, G, Text: SvgText, TSpan, Defs, LinearGradient, RadialGradient, Stop, ClipPath };
export const SVG_TEXT_TYPES = [SvgText, TSpan];
export const SCRIPT_VIEWS = { Stack, Canvas, Sketch, Svg };
