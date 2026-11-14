// Build-time stand-in for the subset of react-native this SDK uses, so the
// package type-checks without installing react-native. Apps use the real types.
declare module 'react-native' {
  import * as React from 'react';
  type Style = Record<string, unknown> | Array<Record<string, unknown> | false | null | undefined>;
  interface Base { style?: Style; accessibilityLabel?: string; testID?: string; children?: React.ReactNode }
  export const View: React.ComponentType<Base>;
  export const Text: React.ComponentType<Base & { numberOfLines?: number }>;
  export const TextInput: React.ComponentType<Base & {
    value?: string; onChangeText?: (t: string) => void; placeholder?: string; placeholderTextColor?: string;
    multiline?: boolean; onSubmitEditing?: () => void; editable?: boolean;
  }>;
  export const Pressable: React.ComponentType<Base & { onPress?: () => void; disabled?: boolean; accessibilityRole?: string }>;
  export const ActivityIndicator: React.ComponentType<Base & { color?: string }>;
  export const KeyboardAvoidingView: React.ComponentType<Base & { behavior?: 'padding' | 'height' }>;
  export const FlatList: React.ComponentType<Base & {
    data: readonly unknown[]; keyExtractor: (item: never) => string; renderItem: (info: { item: never }) => React.ReactElement | null;
    inverted?: boolean; contentContainerStyle?: Style;
  }>;
  export const Platform: { OS: 'ios' | 'android' | 'web' | string };
  export const AppState: {
    currentState: string;
    addEventListener(type: 'change', cb: (state: string) => void): { remove(): void };
  };
  export const StyleSheet: { create<T extends Record<string, Record<string, unknown>>>(s: T): T };
}
