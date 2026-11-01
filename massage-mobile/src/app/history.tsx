import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, SectionList, StyleSheet, TextInput, View } from 'react-native';

import { Avatar, Chip, Empty, ErrorBanner, Ionicons, StatusPill, T, tap } from '@/components/ui';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { addDays, fmtDate, money, time } from '@/lib/format';
import { radius, space, useColors } from '@/lib/theme';
import type { Appointment, Stats, Therapist } from '@/lib/types';
import { useApi } from '@/lib/use-api';

const PAGE = 50;
const STATUS: { key: string; label: string }[] = [
  { key: '', label: 'All' },
  { key: 'completed', label: 'Completed' },
  { key: 'booked', label: 'Upcoming' },
  { key: 'no_show', label: 'No-show' },
  { key: 'cancelled', label: 'Cancelled' },
];

export default function History() {
  const c = useColors();
  const { business } = useAuth();
  const stats = useApi<Stats>('/api/stats');
  const team = useApi<{ therapists: Therapist[] }>('/api/therapists');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [therapistId, setTherapistId] = useState<number | null>(null);
  const [items, setItems] = useState<Appointment[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);
  const today = stats.data?.today;

  useEffect(() => { const t = setTimeout(() => setQ(search.trim()), 300); return () => clearTimeout(t); }, [search]);

  const load = useCallback(async (offset: number) => {
    if (!today) return;
    const id = ++reqId.current;
    setLoading(true);
    try {
      const res = await api<{ appointments: Appointment[]; hasMore: boolean }>(`/api/appointments?${qs({
        q, status, therapistId, order: 'desc', limit: PAGE, offset,
        ...(q ? {} : { from: '2000-01-01', to: addDays(today, 365) }),
      })}`);
      if (id !== reqId.current) return;
      setItems((prev) => (offset === 0 ? res.appointments : [...prev, ...res.appointments]));
      setHasMore(res.hasMore);
      setError(null);
    } catch (e: any) {
      if (id === reqId.current) setError(e.message);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [q, status, therapistId, today]);

  useEffect(() => { setItems([]); setHasMore(true); load(0); }, [load]);

  // Month → day sections.
  const sections = useMemo(() => {
    const out: { key: string; month: string | null; date: string; data: Appointment[] }[] = [];
    let lastMonth = '';
    for (const a of items) {
      const last = out[out.length - 1];
      if (last && last.date === a.date) { last.data.push(a); continue; }
      const month = a.date.slice(0, 7);
      out.push({ key: a.date, month: month !== lastMonth ? month : null, date: a.date, data: [a] });
      lastMonth = month;
    }
    return out;
  }, [items]);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ paddingHorizontal: space.lg, paddingTop: space.md }}>
        <View style={[styles.search, { backgroundColor: c.surface2 }]}>
          <Ionicons name="search" size={18} color={c.muted} />
          <TextInput value={search} onChangeText={setSearch} placeholder="Client name, email, phone or reference" placeholderTextColor={c.faint}
            style={{ flex: 1, fontSize: 16, color: c.text, height: 44 }} autoCorrect={false} autoCapitalize="none" clearButtonMode="while-editing" accessibilityLabel="Search bookings" />
          {search ? <Pressable onPress={() => setSearch('')} hitSlop={8} accessibilityLabel="Clear search"><Ionicons name="close-circle" size={18} color={c.faint} /></Pressable> : null}
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={styles.chips}>
        {STATUS.map((s) => <Chip key={s.key || 'all'} label={s.label} selected={status === s.key} onPress={() => setStatus(s.key)} />)}
      </ScrollView>
      {(team.data?.therapists.length ?? 0) > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={[styles.chips, { paddingTop: 0 }]}>
          <Chip label="Everyone" icon="people-outline" selected={therapistId === null} onPress={() => setTherapistId(null)} />
          {team.data!.therapists.map((t) => <Chip key={t.id} label={t.name.split(' ')[0]} selected={therapistId === t.id} onPress={() => setTherapistId(therapistId === t.id ? null : t.id)} />)}
        </ScrollView>
      )}
      <ErrorBanner message={error} onRetry={() => load(0)} />
      <SectionList
        sections={sections}
        keyExtractor={(a) => String(a.id)}
        stickySectionHeadersEnabled
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 60 }}
        onEndReachedThreshold={0.4}
        onEndReached={() => { if (hasMore && !loading && items.length) load(items.length); }}
        renderSectionHeader={({ section }) => (
          <View style={{ backgroundColor: c.bg }}>
            {section.month && <T v="heading" style={{ paddingTop: space.lg }}>{fmtDate(`${section.month}-01`, { month: 'long', year: 'numeric' })}</T>}
            <T v="caption" color={c.muted} style={{ paddingTop: space.md, paddingBottom: space.sm }}>
              {(section.date === today ? 'Today' : fmtDate(section.date, { weekday: 'long', month: 'short', day: 'numeric' })).toUpperCase()}
            </T>
          </View>
        )}
        renderItem={({ item: a, index, section }) => (
          <Pressable onPress={() => { tap(); router.push({ pathname: '/appointment/[id]', params: { id: String(a.id) } }); }}
            style={({ pressed }) => [styles.row, { backgroundColor: pressed ? c.surface2 : c.surface, borderColor: c.border },
              index === 0 && styles.first, index === section.data.length - 1 && styles.last, index > 0 && { borderTopWidth: 0 }]}>
            <Avatar name={a.clientName} seed={a.clientId ?? a.id} size={38} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <T v="bodyStrong" numberOfLines={1}>{a.clientName}</T>
              <T v="small" color={c.muted} numberOfLines={1}>{[a.serviceName, a.therapistName, a.roomName].filter(Boolean).join(' · ')}</T>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 3 }}>
              <T v="small" style={{ fontWeight: '600' }}>{time(a.startMin)}</T>
              {a.status === 'completed' ? <T v="small" color={c.muted}>{money(a.priceCents, business?.currency)}</T> : <StatusPill status={a.status} />}
            </View>
          </Pressable>
        )}
        ListFooterComponent={loading ? <ActivityIndicator color={c.accent} style={{ marginVertical: space.xl }} /> : (!hasMore && items.length > PAGE ? <T v="small" color={c.faint} center style={{ marginVertical: space.xl }}>That's everything</T> : undefined)}
        ListEmptyComponent={!loading ? <Empty icon="time-outline" title={q ? 'No matching bookings' : 'No bookings yet'} body={q ? 'Try a name, email, phone number or booking reference.' : undefined} /> : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, borderRadius: radius.md },
  chips: { gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderWidth: StyleSheet.hairlineWidth },
  first: { borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md },
  last: { borderBottomLeftRadius: radius.md, borderBottomRightRadius: radius.md },
});
