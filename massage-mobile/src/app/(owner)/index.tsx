import { router, useLocalSearchParams } from 'expo-router';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useColorScheme, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CapacityStrip } from '@/components/sched-capacity';
import { DayTimeline } from '@/components/sched-day-timeline';
import { NotifyBell } from '@/components/notify-bell';
import { Card, Chip, Empty, ErrorBanner, Fab, IconButton, Ionicons, Loading, Segmented, StatusPill, T, tap } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { addDays, duration, fmtDate, money, parseDate, relativeDay, time } from '@/lib/format';
import { avatarColor, radius, space, type, useColors } from '@/lib/theme';
import type { Appointment, ScheduleDay, Stats } from '@/lib/types';
import { useApi } from '@/lib/use-api';

type View_ = 'agenda' | 'timeline';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Item =
  | { kind: 'appt'; start: number; appt: Appointment }
  | { kind: 'off'; start: number; end: number; who: string; reason: string }
  | { kind: 'gap'; start: number; end: number };

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function Today() {
  const c = useColors();
  const scheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const { business } = useAuth();
  // Deep links from the Schedule tab: ?date=YYYY-MM-DD&therapistId=N
  const params = useLocalSearchParams<{ date?: string; therapistId?: string }>();
  const [date, setDate] = useState<string | null>(params.date && DATE_RE.test(params.date) ? params.date : null);
  const [who, setWho] = useState<number | null>(params.therapistId ? Number(params.therapistId) : null);
  const [view, setView] = useState<View_>('agenda');
  useEffect(() => {
    if (params.date && DATE_RE.test(params.date)) setDate(params.date);
    setWho(params.therapistId ? Number(params.therapistId) : null);
  }, [params.date, params.therapistId]);
  const stats = useApi<Stats>('/api/stats');
  const sched = useApi<ScheduleDay>(`/api/schedule${date ? `?date=${date}` : ''}`);
  const conflicts = useApi<{ conflicts: Appointment[] }>('/api/conflicts');
  const today = stats.data?.today ?? sched.data?.today ?? null;
  const day = sched.data;
  const conflictList = conflicts.data?.conflicts ?? [];

  // Week strip: 3 weeks back to 5 weeks ahead, centred on today.
  const days = useMemo(() => (today ? Array.from({ length: 56 }, (_, i) => addDays(today, i - 21)) : []), [today]);
  const selected = date ?? today;
  const stripRef = useRef<ScrollViewInstance>(null);
  useEffect(() => {
    if (!selected || !days.length) return;
    const i = days.indexOf(selected);
    if (i >= 0) stripRef.current?.scrollTo({ x: Math.max(0, i * 56 - 120), animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days.length, selected]);

  const items = useMemo<Item[]>(() => {
    if (!day) return [];
    const appts = day.appointments.filter((a) => (who ? a.therapistId === who : true));
    const list: Item[] = appts.map((a) => ({ kind: 'appt', start: a.startMin, appt: a }));
    for (const t of day.therapists) {
      if (who && t.id !== who) continue;
      for (const o of t.timeOff) list.push({ kind: 'off', start: o.startMin, end: o.endMin, who: t.name, reason: o.reason });
    }
    // With one therapist selected, show open gaps in their working hours.
    if (who) {
      const t = day.therapists.find((x) => x.id === who);
      const busy = [...appts.filter((a) => a.status !== 'cancelled').map((a) => [a.startMin, a.endMin]), ...(t?.timeOff ?? []).map((o) => [o.startMin, o.endMin])].sort((a, b) => a[0] - b[0]);
      for (const w of t?.hours ?? []) {
        let cur = w.startMin;
        for (const [s, e] of busy) {
          if (e <= cur || s >= w.endMin) continue;
          if (s - cur >= 30) list.push({ kind: 'gap', start: cur, end: s });
          cur = Math.max(cur, e);
        }
        if (w.endMin - cur >= 30) list.push({ kind: 'gap', start: cur, end: w.endMin });
      }
    }
    return list.sort((a, b) => a.start - b.start || (a.kind === 'appt' ? -1 : 1));
  }, [day, who]);

  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const isToday = !!day && day.date === day.today;
  const nowIndex = isToday ? items.findIndex((i) => i.start > nowMin) : -1;
  const active = day?.appointments.filter((a) => a.status !== 'cancelled') ?? [];
  const dayRevenue = active.reduce((s, a) => s + a.priceCents, 0);

  if (!today && (stats.loading || sched.loading)) return <Loading />;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + space.md, paddingBottom: 120 }} stickyHeaderIndices={[3]}>
        {/* header */}
        <View style={[styles.pad, styles.header]}>
          <View style={{ flex: 1 }}>
            <T v="small" color={c.muted}>{greeting()}</T>
            <T v="title" numberOfLines={1}>{business?.name}</T>
          </View>
          <NotifyBell />
        </View>

        {/* bookings that no longer fit someone's schedule */}
        {conflictList.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${conflictList.length} bookings need attention`}
            onPress={() => { tap(); router.push('/conflicts'); }}
            style={({ pressed }) => [styles.alert, { backgroundColor: c.dangerSoft, borderColor: c.danger }, pressed && { opacity: 0.85 }]}
          >
            <View style={[styles.alertIcon, { backgroundColor: c.danger }]}><Ionicons name="warning" size={18} color={c.onAccent} /></View>
            <View style={{ flex: 1 }}>
              <T v="bodyStrong" color={c.danger}>{`${conflictList.length} booking${conflictList.length === 1 ? '' : 's'} need${conflictList.length === 1 ? 's' : ''} attention`}</T>
              <T v="small" color={c.danger} numberOfLines={1}>
                {`${conflictList[0].clientName} · ${fmtDate(conflictList[0].date)} — ${conflictList[0].issues?.[0]?.message ?? 'schedule changed'}`}
              </T>
            </View>
            <Ionicons name="chevron-forward" size={18} color={c.danger} />
          </Pressable>
        ) : <View />}

        {/* stats */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.pad, { gap: space.md, paddingVertical: space.lg }]}>
          <StatCard icon="calendar" label="Today" value={String(stats.data?.todayCount ?? '–')} tint={c.accentSoft} fg={c.accentStrong} />
          <StatCard icon="trending-up" label="Next 7 days" value={stats.data ? money(stats.data.next7RevenueCents, business?.currency) : '–'} sub={stats.data ? `${stats.data.next7Count} bookings` : undefined} tint={c.warnSoft} fg={c.warn} />
          <StatCard icon="checkmark-done" label="Last 30 days" value={stats.data ? money(stats.data.last30RevenueCents, business?.currency) : '–'} sub="completed" tint={c.surface2} fg={c.text} />
        </ScrollView>

        {/* sticky date strip + filters */}
        <View style={{ backgroundColor: c.bg, paddingBottom: space.sm }}>
          <View style={[styles.pad, styles.monthRow]}>
            <T v="heading">{selected ? fmtDate(selected, { month: 'long', year: 'numeric' }) : ''}</T>
            {selected !== today && (
              <Pressable onPress={() => { tap(); setDate(null); }} hitSlop={8} style={[styles.todayBtn, { backgroundColor: c.accentSoft }]}>
                <T v="small" color={c.accentStrong} style={{ fontWeight: '700' }}>Today</T>
              </Pressable>
            )}
          </View>
          <ScrollView ref={stripRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.pad, { gap: 6 }]}>
            {days.map((d) => {
              const on = d === selected;
              const isT = d === today;
              return (
                <Pressable key={d} onPress={() => { tap(); setDate(d === today ? null : d); }} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric' })}
                  style={[styles.day, { backgroundColor: on ? c.text : 'transparent' }]}>
                  <Text style={[type.caption, { color: on ? c.bg : c.muted }]}>{fmtDate(d, { weekday: 'narrow' })}</Text>
                  <Text style={{ fontSize: 18, fontWeight: '700', color: on ? c.bg : isT ? c.accent : c.text, marginTop: 2 }}>{parseDate(d).getDate()}</Text>
                  <View style={{ width: 4, height: 4, borderRadius: 2, marginTop: 3, backgroundColor: isT && !on ? c.accent : 'transparent' }} />
                </Pressable>
              );
            })}
          </ScrollView>
          {day && day.therapists.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.pad, { gap: space.sm, paddingTop: space.md }]}>
              <Chip label="Everyone" selected={who === null} onPress={() => setWho(null)} />
              {day.therapists.map((t) => <Chip key={t.id} label={t.name.split(' ')[0]} selected={who === t.id} onPress={() => setWho(who === t.id ? null : t.id)} />)}
            </ScrollView>
          )}
        </View>

        {/* day summary + view toggle */}
        <View style={[styles.pad, { marginTop: space.md }]}>
          <ErrorBanner message={sched.error || stats.error} onRetry={() => { sched.reload(); stats.reload(); }} />
          {day && (
            <View style={styles.daySummary}>
              <T v="bodyStrong">{relativeDay(day.date, day.today)}</T>
              <T v="small" color={c.muted}>{`${active.length} appointment${active.length === 1 ? '' : 's'}${active.length ? ` · ${money(dayRevenue, business?.currency)}` : ''}`}</T>
            </View>
          )}
          <Segmented options={[{ key: 'agenda', label: 'Agenda' }, { key: 'timeline', label: 'Timeline' }]} value={view} onChange={setView} />
        </View>

        {/* team capacity for the day */}
        {day && view === 'agenda' && day.therapists.length > 0 && (
          <View style={{ marginTop: space.md }}>
            <CapacityStrip therapists={day.therapists} selected={who} onSelect={(id) => setWho(id)} />
          </View>
        )}

        {view === 'timeline' && day && (
          <View style={{ paddingHorizontal: space.md, marginTop: space.md }}>
            {day.therapists.length === 0
              ? <Card><Empty icon="people-outline" title="No team yet" body="Add therapists under Studio → Team." /></Card>
              : (
                <DayTimeline
                  day={day}
                  onlyTherapist={who}
                  nowMin={isToday ? nowMin : null}
                  onPressAppointment={(a) => router.push({ pathname: '/appointment/[id]', params: { id: String(a.id) } })}
                  onPressSlot={(therapistId, startMin) => router.push({ pathname: '/new-booking', params: { therapistId: String(therapistId), date: day.date, startMin: String(startMin) } })}
                />
              )}
          </View>
        )}

        {/* agenda */}
        {view === 'agenda' && (
        <View style={[styles.pad, { marginTop: space.md }]}>
          {sched.loading && !day && <Loading />}
          {day && items.length === 0 && (
            <Card><Empty icon="sunny-outline" title="Nothing booked" body={day.therapists.length ? 'Enjoy the quiet — or add a booking.' : 'Add your team under Studio to start taking bookings.'} /></Card>
          )}
          {items.map((it, i) => (
            <Fragment key={`${it.kind}-${it.start}-${i}`}>
              {i === nowIndex && <NowLine />}
              {it.kind === 'appt' && <AgendaCard a={it.appt} color={avatarColor(it.appt.therapistId, scheme)} showTherapist={!who} />}
              {it.kind === 'off' && (
                <View style={[styles.offRow, { backgroundColor: c.warnSoft }]}>
                  <Ionicons name="airplane-outline" size={18} color={c.warn} />
                  <T v="small" color={c.warn} style={{ flex: 1, fontWeight: '600' }}>{`${it.who} off${it.reason ? ` · ${it.reason}` : ''}`}</T>
                  <T v="small" color={c.warn}>{it.start === 0 && it.end === 1440 ? 'All day' : `${time(it.start)} – ${time(it.end)}`}</T>
                </View>
              )}
              {it.kind === 'gap' && (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push({ pathname: '/new-booking', params: { date: day!.date, startMin: String(it.start), ...(who ? { therapistId: String(who) } : {}) } })}
                  style={[styles.gap, { borderColor: c.border }]}>
                  <T v="small" color={c.faint}>{`${time(it.start)} · Open for ${duration(it.end - it.start)}`}</T>
                  <Ionicons name="add-circle-outline" size={18} color={c.faint} />
                </Pressable>
              )}
            </Fragment>
          ))}
          {nowIndex === -1 && isToday && items.length > 0 && items[items.length - 1].start < nowMin && <NowLine />}
        </View>
        )}
      </ScrollView>
      <Fab label="New booking" onPress={() => router.push({ pathname: '/new-booking', params: { date: selected ?? '', ...(who ? { therapistId: String(who) } : {}) } })} />
    </View>
  );
}

function StatCard({ icon, label, value, sub, tint, fg }: { icon: any; label: string; value: string; sub?: string; tint: string; fg: string }) {
  const c = useColors();
  return (
    <View style={[styles.stat, { backgroundColor: c.surface, borderColor: c.border }]}>
      <View style={[styles.statIcon, { backgroundColor: tint }]}><Ionicons name={icon} size={16} color={fg} /></View>
      <T v="small" color={c.muted} style={{ marginTop: space.md }}>{label}</T>
      <T v="title" style={{ marginTop: 2 }}>{value}</T>
      {sub ? <T v="small" color={c.faint}>{sub}</T> : null}
    </View>
  );
}

function AgendaCard({ a, color, showTherapist }: { a: Appointment; color: string; showTherapist: boolean }) {
  const c = useColors();
  const dim = a.status === 'cancelled';
  const issue = a.issues?.[0];
  return (
    <View style={styles.agendaRow}>
      <View style={styles.timeCol}>
        <T v="bodyStrong" style={{ fontSize: 16 }} color={dim ? c.faint : c.text}>{time(a.startMin).split(' ')[0]}</T>
        <T v="small" color={c.muted}>{time(a.startMin).split(' ')[1]}</T>
        <T v="small" color={c.faint} style={{ marginTop: 2 }}>{duration(a.endMin - a.startMin)}</T>
      </View>
      <Card padded={false} style={[{ flex: 1, overflow: 'hidden', opacity: dim ? 0.55 : 1 }, issue && { borderColor: c.danger, borderWidth: 1.5 }]} onPress={() => router.push({ pathname: '/appointment/[id]', params: { id: String(a.id) } })}>
        {issue && (
          <View style={[styles.issueBar, { backgroundColor: c.dangerSoft }]}>
            <Ionicons name="warning" size={14} color={c.danger} />
            <T v="small" color={c.danger} style={{ flex: 1, fontWeight: '600' }} numberOfLines={2}>{issue.message}</T>
          </View>
        )}
        <View style={{ flexDirection: 'row' }}>
          <View style={{ width: 5, backgroundColor: color }} />
          <View style={{ flex: 1, padding: space.md, gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <T v="bodyStrong" style={[{ flex: 1 }, dim && { textDecorationLine: 'line-through' }]} numberOfLines={1}>{a.clientName}</T>
              {a.status !== 'booked' && <StatusPill status={a.status} />}
            </View>
            <T v="small" color={c.muted} numberOfLines={1}>{a.roomName ? `${a.serviceName} · ${a.roomName}` : a.serviceName}</T>
            {showTherapist && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
                <T v="small" color={c.muted}>{a.therapistName}</T>
                {a.clientNotes ? <Ionicons name="chatbubble-ellipses-outline" size={14} color={c.faint} style={{ marginLeft: 'auto' }} /> : null}
              </View>
            )}
          </View>
        </View>
      </Card>
    </View>
  );
}

function NowLine() {
  const c = useColors();
  return (
    <View style={styles.nowRow}>
      <View style={[styles.nowDot, { backgroundColor: c.danger }]} />
      <View style={{ flex: 1, height: 2, backgroundColor: c.danger, borderRadius: 1 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: space.lg },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  stat: { width: 156, padding: space.lg, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  statIcon: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: space.sm, paddingBottom: space.sm, minHeight: 44 },
  todayBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill },
  day: { width: 50, height: 68, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  daySummary: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: space.md },
  agendaRow: { flexDirection: 'row', gap: space.md, marginBottom: space.md },
  timeCol: { width: 56, paddingTop: space.md },
  offRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md, marginBottom: space.md, marginLeft: 68 },
  gap: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderStyle: 'dashed', borderRadius: radius.md, padding: space.md, marginBottom: space.md, marginLeft: 68 },
  nowRow: { flexDirection: 'row', alignItems: 'center', marginBottom: space.md, marginLeft: 62 },
  nowDot: { width: 10, height: 10, borderRadius: 5 },
  alert: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginHorizontal: space.lg, marginTop: space.lg, padding: space.md, borderRadius: radius.lg, borderWidth: 1 },
  alertIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  issueBar: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md, paddingVertical: 6 },
});
