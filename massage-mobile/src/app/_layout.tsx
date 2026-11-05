import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform, useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { api } from '@/lib/api';
import { AuthProvider, useAuth } from '@/lib/auth';
import { enablePush, Notifications } from '@/lib/push';
import { storage } from '@/lib/storage';
import { useColors } from '@/lib/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

/**
 * Signs this phone up for push once a studio is signed in (asks permission the first time only),
 * and opens the right screen when a notification is tapped.
 */
function PushBridge() {
  const { business } = useAuth();

  useEffect(() => {
    if (!business || Platform.OS === 'web') return;
    (async () => {
      const asked = await storage.get('pushAsked');
      if (!asked) await storage.set('pushAsked', '1');
      await enablePush({ prompt: !asked });
    })().catch(() => {});
  }, [business?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!business || Platform.OS === 'web') return;
    const open = (data: any) => {
      if (data?.notificationId) api('/api/notifications/read', { method: 'POST', body: { ids: [data.notificationId] } }).catch(() => {});
      if (typeof data?.url === 'string') router.push(data.url as any);
    };
    // Tapped while the app was closed.
    const last = Notifications.getLastNotificationResponse();
    if (last) { open(last.notification.request.content.data); Notifications.clearLastNotificationResponse(); }
    const sub = Notifications.addNotificationResponseReceivedListener((r) => open(r.notification.request.content.data));
    return () => sub.remove();
  }, [business?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

function RootStack() {
  const { ready } = useAuth();
  const c = useColors();
  useEffect(() => { if (ready) SplashScreen.hideAsync().catch(() => {}); }, [ready]);
  if (!ready) return null;
  return (
    <>
    <PushBridge />
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: c.bg },
        headerShadowVisible: false,
        headerTintColor: c.accentStrong,
        headerTitleStyle: { color: c.text, fontWeight: '700' },
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: c.bg },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="welcome" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ title: '', presentation: 'modal' }} />
      <Stack.Screen name="(owner)" options={{ headerShown: false }} />
      <Stack.Screen name="book/[slug]" options={{ headerShown: false }} />
      <Stack.Screen name="new-booking" options={{ headerShown: false, presentation: 'fullScreenModal' }} />
      <Stack.Screen name="appointment/[id]" options={{ title: 'Appointment' }} />
      <Stack.Screen name="client/[id]" options={{ title: 'Client' }} />
      <Stack.Screen name="therapists" options={{ title: 'Team' }} />
      <Stack.Screen name="therapist/[id]" options={{ title: 'Therapist', presentation: 'modal' }} />
      <Stack.Screen name="services" options={{ title: 'Services' }} />
      <Stack.Screen name="service/[id]" options={{ title: 'Service', presentation: 'modal' }} />
      <Stack.Screen name="settings" options={{ title: 'Business settings' }} />
      <Stack.Screen name="reschedule/[id]" options={{ title: 'Move booking', presentation: 'modal' }} />
      <Stack.Screen name="rooms" options={{ title: 'Rooms' }} />
      <Stack.Screen name="room/[id]" options={{ title: 'Room', presentation: 'modal' }} />
      <Stack.Screen name="insights" options={{ title: 'Insights' }} />
      <Stack.Screen name="conflicts" options={{ title: 'Needs attention' }} />
      <Stack.Screen name="history" options={{ title: 'Booking history' }} />
      <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
      <Stack.Screen name="notification-settings" options={{ title: 'Notification settings' }} />
    </Stack>
    </>
  );
}

export default function RootLayout() {
  const scheme = useColorScheme();
  const c = useColors();
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const theme = { ...base, colors: { ...base.colors, background: c.bg, card: c.bg, primary: c.accent, text: c.text, border: c.border } };
  return (
    <SafeAreaProvider>
      <ThemeProvider value={theme}>
        <AuthProvider>
          <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
          <RootStack />
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
