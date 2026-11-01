import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from '@/lib/auth';
import { useColors } from '@/lib/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

function RootStack() {
  const { ready } = useAuth();
  const c = useColors();
  useEffect(() => { if (ready) SplashScreen.hideAsync().catch(() => {}); }, [ready]);
  if (!ready) return null;
  return (
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
    </Stack>
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
