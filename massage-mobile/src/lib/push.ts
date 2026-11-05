import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { api } from './api';
import { storage } from './storage';

/**
 * Push notifications for studio staff.
 *
 * Needs:
 *  - a real phone (simulators can't get push tokens),
 *  - a development or store build — Expo Go doesn't support push on Android,
 *  - an EAS project id (run `npx eas-cli init` once; it's saved in app.json under extra.eas.projectId).
 */

export type PushStatus =
  | { state: 'on'; token: string }
  | { state: 'denied' }
  | { state: 'unsupported'; reason: string };

// Show alerts while the app is open, too.
if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }),
  });
}

function projectId(): string | undefined {
  return (Constants.expoConfig?.extra as any)?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;
}

/** Ask for permission (if needed), get this phone's push token and register it with the studio. */
export async function enablePush({ prompt = true } = {}): Promise<PushStatus> {
  if (Platform.OS === 'web') return { state: 'unsupported', reason: 'Push alerts work in the phone app, not the browser.' };
  if (!Device.isDevice) return { state: 'unsupported', reason: 'Simulators can’t receive push alerts. Use a real phone.' };
  const id = projectId();
  if (!id) return { state: 'unsupported', reason: 'This build isn’t linked to an Expo project yet (run `npx eas-cli init`).' };

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('bookings', {
      name: 'Bookings',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 200, 120, 200],
      lightColor: '#4F7A63',
    });
  }

  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted' && prompt) status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return { state: 'denied' };

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: id });
    await api('/api/push/devices', { method: 'POST', body: { token, platform: Platform.OS } });
    await storage.set('pushToken', token);
    return { state: 'on', token };
  } catch (e: any) {
    return { state: 'unsupported', reason: e?.message ?? 'Couldn’t get a push token on this device.' };
  }
}

/** Stop pushes to this phone (on logout). */
export async function disablePush() {
  const token = await storage.get('pushToken');
  if (!token) return;
  try { await api('/api/push/devices/remove', { method: 'POST', body: { token } }); } catch { /* already gone */ }
  await storage.set('pushToken', null);
}

export async function setAppBadge(count: number) {
  if (Platform.OS === 'web') return;
  try { await Notifications.setBadgeCountAsync(count); } catch { /* not supported */ }
}

export { Notifications };
