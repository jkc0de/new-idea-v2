import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button, Card, Divider, Empty, ErrorBanner, Ionicons, Loading, Row, RowIcon, Screen, Section, T } from '@/components/ui';
import { radius, space, useColors } from '@/lib/theme';
import type { Room, Service } from '@/lib/types';
import { useApi } from '@/lib/use-api';

export default function Rooms() {
  const c = useColors();
  const q = useApi<{ rooms: Room[] }>('/api/rooms');
  const svc = useApi<{ services: Service[] }>('/api/services');
  if (!q.data) return q.error ? <ErrorBanner message={q.error} onRetry={q.reload} /> : <Loading />;
  const names = new Map((svc.data?.services ?? []).map((s) => [s.id, s.name]));
  const active = q.data.rooms.filter((r) => r.active);
  const inactive = q.data.rooms.filter((r) => !r.active);

  const list = (rooms: Room[], dim = false) => (
    <Card padded={false} style={{ overflow: 'hidden' }}>
      {rooms.map((r, i) => (
        <View key={r.id}>
          {i > 0 && <Divider inset={space.lg + 36 + space.md} />}
          <Row
            left={<RowIcon icon="bed" bg={dim ? c.surface2 : c.accentSoft} color={dim ? c.faint : c.accentStrong} />}
            title={r.name}
            subtitle={r.serviceIds.length ? `Only room for: ${r.serviceIds.map((id) => names.get(id) ?? 'service').join(', ')}` : 'Any service'}
            onPress={() => router.push({ pathname: '/room/[id]', params: { id: String(r.id) } })}
          />
        </View>
      ))}
    </Card>
  );

  return (
    <Screen onRefresh={q.refresh} refreshing={q.refreshing}>
      <View style={[styles.explain, { backgroundColor: c.accentSoft }]}>
        <Ionicons name="cube-outline" size={20} color={c.accentStrong} />
        <T v="small" color={c.text} style={{ flex: 1 }}>
          Rooms are inventory too — a booking needs a free therapist <T v="small" style={{ fontWeight: '700' }}>and</T> a free room. Add your treatment rooms so you never double-book one.
        </T>
      </View>
      {q.data.rooms.length === 0 ? (
        <Empty icon="bed-outline" title="No rooms yet" body="Room checks are off until you add a room. With rooms set up, each booking is given the best free room automatically." />
      ) : (
        <>
          {active.length > 0 && <Section title={`In use · ${active.length}`}>{list(active)}</Section>}
          {inactive.length > 0 && <Section title="Closed">{list(inactive, true)}</Section>}
          <T v="small" color={c.faint} style={{ marginTop: space.md }}>
            Special rooms (like a stone room) are kept free for the services that need them whenever another room will do.
          </T>
        </>
      )}
      <Button title="Add room" icon="add" style={{ marginTop: space.xl }} onPress={() => router.push({ pathname: '/room/[id]', params: { id: 'new' } })} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  explain: { flexDirection: 'row', gap: space.md, padding: space.lg, borderRadius: radius.lg, alignItems: 'flex-start' },
});
