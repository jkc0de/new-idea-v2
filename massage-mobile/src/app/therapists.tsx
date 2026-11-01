import { router } from 'expo-router';
import { View } from 'react-native';

import { Avatar, Button, Card, Divider, Empty, ErrorBanner, Loading, Row, Screen, Section, T } from '@/components/ui';
import { WEEKDAYS } from '@/lib/format';
import { space, useColors } from '@/lib/theme';
import type { Therapist } from '@/lib/types';
import { useApi } from '@/lib/use-api';

export default function Team() {
  const c = useColors();
  const q = useApi<{ therapists: Therapist[] }>('/api/therapists');
  if (!q.data) return q.error ? <ErrorBanner message={q.error} onRetry={q.reload} /> : <Loading />;
  const active = q.data.therapists.filter((t) => t.active);
  const inactive = q.data.therapists.filter((t) => !t.active);

  const row = (t: Therapist) => {
    const days = [...new Set((t.hours ?? []).map((h) => h.weekday))].sort().map((d) => WEEKDAYS[d].slice(0, 3));
    return (
      <Row key={t.id} left={<Avatar name={t.name} seed={t.id} />} title={t.name}
        subtitle={`${t.serviceIds.length} service${t.serviceIds.length === 1 ? '' : 's'} · ${days.length ? days.join(', ') : 'No hours set'}`}
        onPress={() => router.push({ pathname: '/therapist/[id]', params: { id: String(t.id) } })} />
    );
  };
  const list = (ts: Therapist[]) => (
    <Card padded={false} style={{ overflow: 'hidden' }}>
      {ts.map((t, i) => <View key={t.id}>{i > 0 && <Divider inset={space.lg + 44 + space.md} />}{row(t)}</View>)}
    </Card>
  );

  return (
    <Screen onRefresh={q.refresh} refreshing={q.refreshing}>
      {q.data.therapists.length === 0 ? (
        <Empty icon="people-outline" title="Add your first therapist" body="Set their services and working hours so clients can book them." />
      ) : (
        <>
          <T v="small" color={c.muted}>Tap someone to edit their hours, services or time off.</T>
          {active.length > 0 && <Section title="Taking bookings">{list(active)}</Section>}
          {inactive.length > 0 && <Section title="Inactive">{list(inactive)}</Section>}
        </>
      )}
      <Button title="Add therapist" icon="person-add-outline" style={{ marginTop: space.xl }} onPress={() => router.push({ pathname: '/therapist/[id]', params: { id: 'new' } })} />
    </Screen>
  );
}
