import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Sheet } from '@/components/sheet';
import { Button, Field, Ionicons, T } from '@/components/ui';
import { getBaseUrl, setBaseUrl } from '@/lib/api';
import { storage } from '@/lib/storage';
import { space, useColors } from '@/lib/theme';

/** Staff sign-in. The app belongs to the studio, so it shows the studio's own name once known. */
export default function Welcome() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [serverOpen, setServerOpen] = useState(false);
  const [server, setServer] = useState(getBaseUrl());
  const [studioName, setStudioName] = useState<string | null>(null);

  useEffect(() => { storage.get('studioName').then(setStudioName); }, []);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top, paddingBottom: insets.bottom + space.lg }}>
      <View style={styles.hero}>
        <View style={[styles.logo, { backgroundColor: c.accentSoft }]}>
          <Ionicons name="leaf" size={40} color={c.accent} />
        </View>
        <T v="hero" center style={{ marginTop: space.xl }}>{studioName ?? 'Welcome'}</T>
        <T v="body" color={c.muted} center style={{ marginTop: space.sm, maxWidth: 300 }}>
          {studioName ? 'Sign in to see today’s bookings.' : 'Sign in to run your studio’s bookings, team schedule and clients.'}
        </T>

        <View style={{ marginTop: space.xxl, gap: space.md, alignSelf: 'stretch' }}>
          {[
            ['calendar-outline', 'Your team’s day and week at a glance'],
            ['notifications-outline', 'Alerts for new bookings and changes'],
            ['people-outline', 'Client notes & visit history'],
          ].map(([icon, label]) => (
            <View key={label} style={styles.feature}>
              <View style={[styles.featureIcon, { backgroundColor: c.surface }]}>
                <Ionicons name={icon as any} size={20} color={c.accentStrong} />
              </View>
              <T v="bodyStrong">{label}</T>
            </View>
          ))}
        </View>
      </View>

      <View style={{ paddingHorizontal: space.lg, gap: space.md }}>
        <Button title="Sign in" icon="log-in-outline" onPress={() => router.push('/login')} />
        {!studioName && (
          <Button title="Set up a new studio" icon="add-circle-outline" kind="secondary" onPress={() => router.push({ pathname: '/login', params: { mode: 'signup' } })} />
        )}
        <Pressable onPress={() => setServerOpen(true)} hitSlop={8} style={{ alignSelf: 'center', marginTop: space.sm }}>
          <T v="small" color={c.faint}>Server settings</T>
        </Pressable>
      </View>

      <Sheet visible={serverOpen} onClose={() => setServerOpen(false)} title="Server">
        <Field label="Booking server URL" value={server} onChangeText={setServer} autoCapitalize="none" autoCorrect={false} keyboardType="url"
          hint="On a phone, use your computer's network address, e.g. http://192.168.1.20:3000" />
        <Button title="Save" onPress={async () => { await setBaseUrl(server); setServer(getBaseUrl()); setServerOpen(false); }} />
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xl },
  logo: { width: 88, height: 88, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  feature: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  featureIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
