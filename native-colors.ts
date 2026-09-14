import {
  background as expoBackground,
  foregroundStyle as expoForegroundStyle,
  presentationBackground as expoPresentationBackground,
  strokeBorder as expoStrokeBorder,
  tint as expoTint,
} from '@expo/ui/swift-ui/modifiers';
import type { ColorValue } from 'react-native';

// SDK 57 Expo Go builds may predate the ShapeStyle wire format introduced
// in @expo/ui 57.0.15–17. Send both formats until those clients are retired.
export function background(color: ColorValue) {
  return { ...expoBackground(color), color };
}

export function foregroundStyle(color: ColorValue) {
  return { ...expoForegroundStyle(color), styleType: 'color', color };
}

export function tint(color: ColorValue) {
  return { ...expoTint(color), color };
}

export function presentationBackground(color: ColorValue) {
  return { ...expoPresentationBackground(color), color };
}

export function strokeBorder(params: Parameters<typeof expoStrokeBorder>[0] & { content: ColorValue }) {
  return { ...expoStrokeBorder(params), color: params.content };
}
