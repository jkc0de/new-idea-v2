import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Sheet } from '@/components/sheet';
import { Button, Field, Ionicons, T } from '@/components/ui';
import { getBaseUrl, setBaseUrl } from '@/lib/api';
import { space, useColors } from '@/lib/theme';

export default function Welcome() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [studioOpen, setStudioOpen] = useState(false);
  const [serverOpen, setServerOpen] = useState(false);
  const [studio, setStudio] = useState('');
  const [server, setServer] = useState(getBaseUrl());

  const goBook = () => {
    const slug = studio.trim().toLowerCase().replace(/^.*\/b\//, '').replace(/[^a-z0-9-]/g, '');
    if (!slug) return;
    setStudioOpen(false);
    router.push({ pathname: '/book/[slug]', params: { slug } });
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top, paddingBottom: insets.bottom + space.lg }}>
      <View style={styles.hero}>
        <View style={[styles.logo, { backgroundColor: c.accentSoft }]}>
          <Ionicons name="leaf" size={40} color={c.accent} />
        </View>
        <T v="hero" center style={{ marginTop: space.xl }}>Restful</T>
        <T v="body" color={c.muted} center style={{ marginTop: space.sm, maxWidth: 300 }}>
          Bookings, schedules and clients for massage studios — right from your phone.
        </T>

        <View style={{ marginTop: space.xxl, gap: space.md, alignSelf: 'stretch' }}>
          {[
            ['calendar-outline', 'Your whole day at a glance'],
            ['phone-portrait-outline', 'Clients book 24/7 from a link'],
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
        <Button title="I run a studio" icon="briefcase-outline" onPress={() => router.push('/login')} />
        <Button title="Book a massage" icon="calendar-outline" kind="secondary" onPress={() => setStudioOpen(true)} />
        <Pressable onPress={() => setServerOpen(true)} hitSlop={8} style={{ alignSelf: 'center', marginTop: space.sm }}>
          <T v="small" color={c.faint}>Server settings</T>
        </Pressable>
      </View>

      <Sheet visible={studioOpen} onClose={() => setStudioOpen(false)} title="Find your studio">
        <Field label="Studio booking link or code" value={studio} onChangeText={setStudio} autoCapitalize="none" autoCorrect={false} placeholder="e.g. serenity" onSubmitEditing={goBook} returnKeyType="go" autoFocus />
        <Button title="Continue" onPress={goBook} disabled={!studio.trim()} />
      </Sheet>

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
