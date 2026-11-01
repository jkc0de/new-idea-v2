import { Alert, Platform } from 'react-native';

/** Cross-platform yes/no prompt. */
export function confirmAsync(title: string, message?: string, confirmText = 'OK', destructive = false): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(globalThis.confirm?.([title, message].filter(Boolean).join('\n\n')) ?? true);
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
      { text: confirmText, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}
