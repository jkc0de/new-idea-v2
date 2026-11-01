import { router } from 'expo-router';
import { Alert, Platform, Share, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, Divider, Row, RowIcon, Screen, Section, T } from '@/components/ui';
import { getBaseUrl } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { space, useColors } from '@/lib/theme';
import type { Room, Service, Therapist } from '@/lib/types';
import { useApi } from '@/lib/use-api';

export default function Studio() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { business, logout } = useAuth();
  const team = useApi<{ therapists: Therapist[] }>('/api/therapists');
  const services = useApi<{ services: Service[] }>('/api/services');
  const rooms = useApi<{ rooms: Room[] }>('/api/rooms');
  const activeRooms = rooms.data?.rooms.filter((r) => r.active).length;
  if (!business) return null;
  const link = `${getBaseUrl()}/b/${business.slug}`;
  const activeTeam = team.data?.therapists.filter((t) => t.active).length;
  const activeServices = services.data?.services.filter((s) => s.active).length;

  async function share() {
    if (Platform.OS === 'web') {
      try { await navigator.clipboard.writeText(link); alert('Booking link copied'); } catch { alert(link); }
      return;
    }
    await Share.share({ message: `Book your next massage at ${business!.name}: ${link}`, url: link });
  }

  function confirmLogout() {
    if (Platform.OS === 'web') { if (confirm('Log out?')) logout(); return; }
    Alert.alert('Log out?', undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Log out', style: 'destructive', onPress: logout }]);
  }

  return (
    <Screen contentStyle={{ paddingTop: insets.top + space.md }}>
      <T v="title">Studio</T>

      <Card style={{ marginTop: space.lg, backgroundColor: c.accent, borderColor: c.accent }}>
        <T v="caption" color={c.onAccent} style={{ opacity: 0.8 }}>YOUR BOOKING PAGE</T>
        <T v="heading" color={c.onAccent} style={{ marginTop: space.sm }}>{business.name}</T>
        <T v="small" color={c.onAccent} style={{ opacity: 0.85, marginTop: 2 }} numberOfLines={1}>{link.replace(/^https?:\/\//, '')}</T>
        <View style={styles.linkActions}>
          <Button title="Share link" icon="share-outline" size="md" kind="secondary" onPress={share} style={{ flex: 1, borderColor: 'transparent' }} />
          <Button title="Preview" icon="eye-outline" size="md" kind="secondary" style={{ flex: 1, borderColor: 'transparent' }}
            onPress={() => router.push({ pathname: '/book/[slug]', params: { slug: business.slug } })} />
        </View>
      </Card>

      <Section title="Manage">
        <Card padded={false} style={{ overflow: 'hidden' }}>
          <Row left={<RowIcon icon="people" />} title="Team" subtitle={activeTeam !== undefined ? `${activeTeam} therapist${activeTeam === 1 ? '' : 's'} · hours & time off` : 'Hours & time off'} onPress={() => router.push('/therapists')} />
          <Divider inset={space.lg + 36 + space.md} />
          <Row left={<RowIcon icon="leaf" />} title="Services" subtitle={activeServices !== undefined ? `${activeServices} on your menu` : 'Treatments & prices'} onPress={() => router.push('/services')} />
          <Divider inset={space.lg + 36 + space.md} />
          <Row left={<RowIcon icon="bed" />} title="Rooms" subtitle={activeRooms ? `${activeRooms} room${activeRooms === 1 ? '' : 's'} · never double-book a room` : 'Add treatment rooms'} onPress={() => router.push('/rooms')} />
          <Divider inset={space.lg + 36 + space.md} />
          <Row left={<RowIcon icon="options" />} title="Business settings" subtitle="Contact, booking rules, cancellation" onPress={() => router.push('/settings')} />
        </Card>
      </Section>

      <Section title="Look back">
        <Card padded={false} style={{ overflow: 'hidden' }}>
          <Row left={<RowIcon icon="stats-chart" bg={c.warnSoft} color={c.warn} />} title="Insights" subtitle="Revenue, utilization, no-shows, busiest times" onPress={() => router.push('/insights')} />
          <Divider inset={space.lg + 36 + space.md} />
          <Row left={<RowIcon icon="time" bg={c.surface2} color={c.text} />} title="Booking history" subtitle="Search every past booking" onPress={() => router.push('/history')} />
        </Card>
      </Section>

      <Section title="Account">
        <Card padded={false} style={{ overflow: 'hidden' }}>
          <Row left={<RowIcon icon="mail" bg={c.surface2} color={c.muted} />} title={business.email ?? ''} subtitle="Signed in" chevron={false} />
          <Divider inset={space.lg + 36 + space.md} />
          <Row left={<RowIcon icon="log-out" bg={c.dangerSoft} color={c.danger} />} title="Log out" danger onPress={confirmLogout} chevron={false} />
        </Card>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  linkActions: { flexDirection: 'row', gap: space.sm, marginTop: space.lg },
});
