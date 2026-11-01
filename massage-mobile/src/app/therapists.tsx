import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Avatar, Button, Card, Divider, Empty, ErrorBanner, Ionicons, Loading, Row, Screen, Section, T } from '@/components/ui';
import { WEEKDAYS } from '@/lib/format';
import { radius, space, useColors } from '@/lib/theme';
import type { Therapist } from '@/lib/types';
import { useApi } from '@/lib/use-api';

function summary(t: Therapist) {
  const hours = t.hours ?? [];
  const weeklyMin = hours.reduce((n, h) => n + (h.endMin - h.startMin), 0);
  const days = [...new Set(hours.map((h) => h.weekday))].sort();
  const split = days.some((d) => hours.filter((h) => h.weekday === d).length > 1);
  const h = weeklyMin / 60;
  return { weekly: weeklyMin ? `${Number.isInteger(h) ? h : h.toFixed(1)}h/week` : 'No hours set', days, split };
}

function Tag({ icon, label }: { icon: any; label: string }) {
  const c = useColors();
  return (
    <View style={[styles.tag, { backgroundColor: c.surface2 }]}>
      <Ionicons name={icon} size={12} color={c.muted} />
      <T v="caption" color={c.muted} style={{ letterSpacing: 0 }}>{label}</T>
    </View>
  );
}

export default function Team() {
  const c = useColors();
  const q = useApi<{ therapists: Therapist[] }>('/api/therapists');
  if (!q.data) return q.error ? <ErrorBanner message={q.error} onRetry={q.reload} /> : <Loading />;
  const active = q.data.therapists.filter((t) => t.active);
  const inactive = q.data.therapists.filter((t) => !t.active);

  const row = (t: Therapist) => {
    const s = summary(t);
    return (
      <View key={t.id}>
        <Row left={<Avatar name={t.name} seed={t.id} />} title={t.name}
          subtitle={`${s.weekly} · ${s.days.length ? s.days.map((d) => WEEKDAYS[d].slice(0, 2)).join(' ') : 'No days'}`}
          onPress={() => router.push({ pathname: '/therapist/[id]', params: { id: String(t.id) } })} />
        <View style={styles.tags}>
          <Tag icon="leaf-outline" label={`${t.serviceIds.length} service${t.serviceIds.length === 1 ? '' : 's'}`} />
          {s.split && <Tag icon="cafe-outline" label="Split shifts" />}
          {t.maxSessionsPerDay ? <Tag icon="speedometer-outline" label={`Max ${t.maxSessionsPerDay}/day`} /> : null}
          {t.maxConsecutiveMin ? <Tag icon="pause-circle-outline" label={`Break after ${t.maxConsecutiveMin / 60}h`} /> : null}
        </View>
      </View>
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
        <Empty icon="people-outline" title="Add your first therapist" body="Set their services, shifts and limits so clients can book them." />
      ) : (
        <>
          <T v="small" color={c.muted}>Tap someone to edit shifts, workload limits, custom hours or time off.</T>
          {active.length > 0 && <Section title="Taking bookings">{list(active)}</Section>}
          {inactive.length > 0 && <Section title="Inactive">{list(inactive)}</Section>}
        </>
      )}
      <Button title="Add therapist" icon="person-add-outline" style={{ marginTop: space.xl }} onPress={() => router.push({ pathname: '/therapist/[id]', params: { id: 'new' } })} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingLeft: space.lg + 44 + space.md, paddingRight: space.lg, marginTop: -6, paddingBottom: space.md },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
});
