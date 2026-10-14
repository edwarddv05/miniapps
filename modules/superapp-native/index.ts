import { requireOptionalNativeModule } from 'expo-modules-core';

type SuperappNativeModule = {
  python(name: string, payload: string): Promise<string>;
  joinMedia(video: string, audio: string | null, output: string): Promise<void>;
  remuxAudio(input: string, output: string): Promise<void>;
  ambientColor(url: string): Promise<string | null>;
  setWidgetSchedule(json: string): void;
};

/** Present only in the standalone build; Expo Go and web get null. */
export const SuperappNative = requireOptionalNativeModule<SuperappNativeModule>('SuperappNative');
