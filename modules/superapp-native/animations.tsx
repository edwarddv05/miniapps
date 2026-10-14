import { requireNativeView } from 'expo';
import type { ComponentType, ReactNode } from 'react';
import type { ColorValue } from 'react-native';
import type { CommonViewModifierProps } from '@expo/ui/swift-ui';
import { SuperappNative } from './index';

// Animated SwiftUI views from AnimationViews.swift. They exist only in the
// standalone build; elsewhere each component renders its `fallback`.

type Native<P> = ComponentType<P & CommonViewModifierProps & { children?: ReactNode }>;

function nativeView<P>(name: string): Native<P> | null {
  return SuperappNative ? requireNativeView<P & CommonViewModifierProps>('SuperappNative', name) as Native<P> : null;
}

const PopInNative = nativeView<{ trigger: number }>('PopInView');
const LiquidProgressNative = nativeView<{ progress: number; color: ColorValue }>('LiquidProgressView');
const SkyNative = nativeView<{ minute: number; dark: boolean }>('SkyView');
const SteamCupNative = nativeView<{ color: ColorValue; steam: ColorValue }>('SteamCupView');

export const animationsAvailable = Boolean(SuperappNative);

/** Pops its content with a spring each time `trigger` changes. */
export function PopIn({ trigger, children, modifiers }: { trigger: number; children: ReactNode } & CommonViewModifierProps) {
  return PopInNative ? <PopInNative trigger={trigger} modifiers={modifiers}>{children}</PopInNative> : <>{children}</>;
}

/** Liquid fill for a progress bar; `progress` below 0 while the size is unknown. */
export function LiquidProgress({ progress, color, fallback, modifiers }: { progress: number; color: ColorValue; fallback: ReactNode } & CommonViewModifierProps) {
  return LiquidProgressNative ? <LiquidProgressNative progress={progress} color={color} modifiers={modifiers} /> : <>{fallback}</>;
}

/** The page's top glow in the colour of the sky at this minute, with the sun or moon in it. */
export function Sky(props: { minute: number; dark: boolean } & CommonViewModifierProps) {
  return SkyNative ? <SkyNative {...props} /> : null;
}

export function SteamCup({ color, steam, fallback, modifiers }: { color: ColorValue; steam: ColorValue; fallback: ReactNode } & CommonViewModifierProps) {
  return SteamCupNative ? <SteamCupNative color={color} steam={steam} modifiers={modifiers} /> : <>{fallback}</>;
}
