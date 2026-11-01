import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View, useColorScheme } from 'react-native';

import { Avatar, Button, Card, Empty, ErrorBanner, Ionicons, Loading, Screen, Section, T, tap } from '@/components/ui';
import { api } from '@/lib/api';
import { confirmAsync } from '@/lib/confirm';
import { fmtDate, relativeDay, time } from '@/lib/format';
import { avatarColor, radius, space, useColors } from '@/lib/theme';
import type { Appointment, Stats } from '@/lib/types';
import { useApi } from '@/lib/use-api';

/**
 * Bookings that no longer fit their therapist's schedule — e.g. time off was added,
 * hours changed, or the therapist stopped taking bookings. Move, reassign or cancel each one.
 */
export default function Conflicts() {
  const c = useColors();
  const scheme = useColorScheme();
  const q = useApi<{ conflicts: Appointment[] }>('/api/conflicts');
  const stats = useApi<Stats>('/api/stats');
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!q.data) return q.error ? <View style={{ padding: space.lg }}><ErrorBanner message={q.error} onRetry={q.reload} /></View> : <Loading />;
  const list = q.data.conflicts;
  const today = stats.data?.today;

  const groups = new Map<string, Appointment[]>();
  for (const a of list) {
    if (!groups.has(a.date)) groups.set(a.date, []);
    groups.get(a.date)!.push(a);
  }

  async function cancel(a: Appointment) {
    if (!(await confirmAsync(`Cancel ${a.clientName}'s booking?`, `${fmtDate(a.date)} at ${time(a.startMin)}. Let the client know.`, 'Cancel booking', true))) return;
    setBusy(a.id); setError(null);
    try {
      await api(`/api/appointments/${a.id}`, { method: 'PATCH', body: { status: 'cancelled', reason: a.issues?.[0]?.message } });
      tap('success');
      q.reload();
    } catch (e: any) { setError(e.message); } finally { setBusy(null); }
  }

  return (
    <Screen onRefresh={q.refresh} refreshing={q.refreshing}>
      {list.length === 0 ? (
        <Card style={{ marginTop: space.lg }}>
          <Empty icon="checkmark-done-circle-outline" title="All clear" body="Every upcoming booking fits your team's hours, time off and availability." />
        </Card>
      ) : (
        <>
          <View style={[styles.intro, { backgroundColor: c.dangerSoft }]}>
            <Ionicons name="warning" size={20} color={c.danger} />
            <T v="small" color={c.danger} style={{ flex: 1 }}>
              {`${list.length} booking${list.length === 1 ? '' : 's'} no longer fit${list.length === 1 ? 's' : ''} the schedule. Move ${list.length === 1 ? 'it' : 'them'} to another time or therapist, or cancel and let the client know.`}
            </T>
          </View>
          <ErrorBanner message={error} />
          {[...groups.entries()].map(([date, items]) => (
            <Section key={date} title={today ? relativeDay(date, today) : fmtDate(date)}>
              <View style={{ gap: space.md }}>
                {items.map((a) => (
                  <Card key={a.id} padded={false} style={{ overflow: 'hidden' }}>
                    <View style={{ flexDirection: 'row' }}>
                      <View style={{ width: 5, backgroundColor: avatarColor(a.therapistId, scheme) }} />
                      <View style={{ flex: 1, padding: space.lg, gap: space.sm }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                          <Avatar name={a.clientName} seed={a.clientId ?? a.id} size={40} />
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <T v="bodyStrong" numberOfLines={1}>{a.clientName}</T>
                            <T v="small" color={c.muted} numberOfLines={1}>{`${time(a.startMin)} – ${time(a.endMin)} · ${a.therapistName}`}</T>
                            <T v="small" color={c.muted} numberOfLines={1}>{a.serviceName}</T>
                          </View>
                        </View>
                        {(a.issues ?? []).map((i) => (
                          <View key={i.code} style={[styles.issue, { backgroundColor: c.dangerSoft }]}>
                            <Ionicons name={i.code === 'time_off' ? 'airplane-outline' : i.code === 'inactive' ? 'person-remove-outline' : 'time-outline'} size={15} color={c.danger} />
                            <T v="small" color={c.danger} style={{ flex: 1, fontWeight: '600' }}>{i.message}</T>
                          </View>
                        ))}
                        <View style={styles.actions}>
                          <Button title="Move" icon="swap-horizontal" size="sm" style={{ flex: 1.3 }}
                            onPress={() => router.push({ pathname: '/reschedule/[id]', params: { id: String(a.id) } })} />
                          <Button title="Open" kind="secondary" size="sm" style={{ flex: 1 }}
                            onPress={() => router.push({ pathname: '/appointment/[id]', params: { id: String(a.id) } })} />
                          <Button title="Cancel" kind="danger" size="sm" style={{ flex: 1 }} loading={busy === a.id} onPress={() => cancel(a)} />
                        </View>
                      </View>
                    </View>
                  </Card>
                ))}
              </View>
            </Section>
          ))}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { flexDirection: 'row', gap: space.sm, alignItems: 'center', padding: space.md, borderRadius: radius.md },
  issue: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.sm, paddingVertical: 6, borderRadius: radius.sm },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.xs },
});
