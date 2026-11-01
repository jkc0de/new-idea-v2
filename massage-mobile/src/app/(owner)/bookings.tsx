import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, SectionList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar, Card, Empty, ErrorBanner, Fab, IconButton, Loading, Segmented, StatusPill, T } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { addDays, money, relativeDay, time } from '@/lib/format';
import { space, useColors } from '@/lib/theme';
import type { Appointment, Stats } from '@/lib/types';
import { useApi } from '@/lib/use-api';

type Filter = 'upcoming' | 'past' | 'cancelled';

export default function Bookings() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { business } = useAuth();
  const [filter, setFilter] = useState<Filter>('upcoming');
  const stats = useApi<Stats>('/api/stats');
  const today = stats.data?.today;

  const path = !today ? null
    : filter === 'upcoming' ? `/api/appointments?status=booked&from=${today}&to=${addDays(today, 90)}`
      : filter === 'past' ? `/api/appointments?from=${addDays(today, -90)}&to=${today}`
        : `/api/appointments?status=cancelled&from=${addDays(today, -90)}&to=${addDays(today, 90)}`;
  const q = useApi<{ appointments: Appointment[] }>(path);

  const sections = useMemo(() => {
    let list = q.data?.appointments ?? [];
    if (filter === 'past') list = list.filter((a) => a.status === 'completed' || a.status === 'no_show').reverse();
    const map = new Map<string, Appointment[]>();
    for (const a of list) {
      if (!map.has(a.date)) map.set(a.date, []);
      map.get(a.date)!.push(a);
    }
    return [...map.entries()].map(([date, data]) => ({ date, data }));
  }, [q.data, filter]);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ paddingTop: insets.top + space.md, paddingHorizontal: space.lg, paddingBottom: space.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.lg }}>
          <T v="title">Bookings</T>
          <IconButton icon="search" label="Search booking history" onPress={() => router.push('/history')} />
        </View>
        <Segmented options={[{ key: 'upcoming', label: 'Upcoming' }, { key: 'past', label: 'Past' }, { key: 'cancelled', label: 'Cancelled' }]} value={filter} onChange={setFilter} />
      </View>
      <ErrorBanner message={q.error} onRetry={q.reload} />
      {q.loading && !q.data ? <Loading /> : (
        <SectionList
          sections={sections}
          keyExtractor={(a) => String(a.id)}
          stickySectionHeadersEnabled
          contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 120 }}
          refreshControl={<RefreshControl refreshing={q.refreshing} onRefresh={q.refresh} tintColor={c.accent} />}
          renderSectionHeader={({ section }) => (
            <View style={{ backgroundColor: c.bg, paddingTop: space.lg, paddingBottom: space.sm }}>
              <T v="caption" color={c.muted}>{(today ? relativeDay(section.date, today) : section.date).toUpperCase()}</T>
            </View>
          )}
          renderItem={({ item: a }) => (
            <Card style={{ marginBottom: space.sm }} onPress={() => router.push({ pathname: '/appointment/[id]', params: { id: String(a.id) } })}>
              <View style={styles.row}>
                <Avatar name={a.clientName} seed={a.clientId ?? a.id} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <T v="bodyStrong" numberOfLines={1}>{a.clientName}</T>
                  <T v="small" color={c.muted} numberOfLines={1}>{[a.serviceName, a.therapistName, a.roomName].filter(Boolean).join(' · ')}</T>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <T v="bodyStrong" style={{ fontSize: 15 }}>{time(a.startMin)}</T>
                  {a.status === 'booked' ? <T v="small" color={c.muted}>{money(a.priceCents, business?.currency)}</T> : <StatusPill status={a.status} />}
                </View>
              </View>
            </Card>
          )}
          ListEmptyComponent={
            <Empty
              icon={filter === 'cancelled' ? 'close-circle-outline' : 'calendar-outline'}
              title={filter === 'upcoming' ? 'No upcoming bookings' : filter === 'past' ? 'No past visits yet' : 'No cancellations'}
              body={filter === 'upcoming' ? 'Share your booking link from the Studio tab to start getting bookings.' : undefined}
            />
          }
        />
      )}
      <Fab label="New booking" onPress={() => router.push('/new-booking')} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
});
