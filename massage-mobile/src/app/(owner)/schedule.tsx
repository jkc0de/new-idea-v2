import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { hrs, isFull, pct, weekStart } from '@/components/sched-format';
import { Avatar, ErrorBanner, IconButton, Ionicons, Loading, T, tap } from '@/components/ui';
import { addDays, fmtDate, parseDate } from '@/lib/format';
import { radius, space, type, useColors, type Colors } from '@/lib/theme';
import type { DayInventory, Inventory, Stats } from '@/lib/types';
import { useApi } from '@/lib/use-api';

const NAME_COL = 58;

/** Fill color for a cell, from empty (light) to fully booked (strong). */
function cellTone(d: DayInventory, c: Colors) {
  if (!d.working) return { bg: 'transparent', fg: c.faint, fill: 'transparent' };
  if (isFull(d)) return { bg: c.dangerSoft, fg: c.danger, fill: c.danger };
  return { bg: c.surface, fg: c.text, fill: c.accent };
}

export default function Schedule() {
  const c = useColors();
  const scheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const stats = useApi<Stats>('/api/stats');
  const today = stats.data?.today ?? null;
  const [from, setFrom] = useState<string | null>(null);
  const start = from ?? (today ? weekStart(today) : null);
  const inv = useApi<Inventory>(start ? `/api/inventory?from=${start}&days=7` : null);
  const data = inv.data;

  if (!data || !start) {
    return inv.error || stats.error
      ? <View style={{ flex: 1, backgroundColor: c.bg, padding: space.lg, paddingTop: insets.top + space.lg }}><ErrorBanner message={inv.error || stats.error} onRetry={() => { stats.reload(); inv.reload(); }} /></View>
      : <Loading />;
  }

  const t0 = data.today;
  const thisWeek = weekStart(t0);
  // Free time that can still be sold: today onwards only.
  const sellable = data.totals.filter((d) => d.date >= t0);
  const freeLeft = sellable.reduce((n, d) => n + d.freeMin, 0);
  const avail = data.totals.reduce((n, d) => n + d.availableMin, 0);
  const booked = data.totals.reduce((n, d) => n + d.bookedMin, 0);
  const sessions = data.totals.reduce((n, d) => n + d.sessions, 0);
  const weekLabel = `${fmtDate(data.days[0], { month: 'short', day: 'numeric' })} – ${fmtDate(data.days[6], { month: 'short', day: 'numeric' })}`;

  const openDay = (date: string, therapistId?: number) => {
    tap();
    router.push({ pathname: '/(owner)', params: therapistId ? { date, therapistId: String(therapistId) } : { date } });
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={{ paddingTop: insets.top + space.md, paddingBottom: 60 }}
      refreshControl={<RefreshControl refreshing={inv.refreshing} onRefresh={inv.refresh} tintColor={c.accent} />}
    >
      <View style={styles.pad}>
        <T v="title">Schedule</T>
        <T v="small" color={c.muted} style={{ marginTop: 2 }}>Who’s free, who’s full — your team’s time at a glance.</T>

        {/* week navigation */}
        <View style={styles.weekRow}>
          <IconButton icon="chevron-back" label="Previous week" size={38} onPress={() => setFrom(addDays(start, -7))} />
          <View style={{ flex: 1, alignItems: 'center' }}>
            <T v="bodyStrong">{weekLabel}</T>
            <T v="small" color={c.muted}>{start === thisWeek ? 'This week' : start < thisWeek ? 'Past week' : `In ${Math.round((parseDate(start).getTime() - parseDate(thisWeek).getTime()) / 604800000)} wk`}</T>
          </View>
          <IconButton icon="chevron-forward" label="Next week" size={38} onPress={() => setFrom(addDays(start, 7))} />
        </View>
        {start !== thisWeek && (
          <Pressable onPress={() => { tap(); setFrom(null); }} style={[styles.reset, { backgroundColor: c.accentSoft }]} accessibilityRole="button">
            <T v="small" color={c.accentStrong} style={{ fontWeight: '700' }}>Back to this week</T>
          </Pressable>
        )}

        {/* summary */}
        <View style={styles.summary}>
          <Summary icon="hourglass-outline" label={start < thisWeek ? 'Unsold time' : 'Free to sell'} value={hrs(start < thisWeek ? Math.max(0, avail - booked) : freeLeft)} tint={c.accentSoft} fg={c.accentStrong} />
          <Summary icon="pie-chart-outline" label="Booked" value={pct(avail ? booked / avail : 0)} tint={c.warnSoft} fg={c.warn} />
          <Summary icon="people-outline" label="Sessions" value={String(sessions)} tint={c.surface2} fg={c.text} />
        </View>
      </View>

      {/* grid */}
      <View style={[styles.grid, { backgroundColor: c.surface, borderColor: c.border }]}>
        <View style={styles.gridRow}>
          <View style={{ width: NAME_COL }} />
          {data.days.map((d) => {
            const isToday = d === t0;
            return (
              <Pressable key={d} style={styles.dayHead} onPress={() => openDay(d)} accessibilityRole="button" accessibilityLabel={`Open ${fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric' })}`}>
                <Text style={[type.caption, { color: isToday ? c.accentStrong : c.muted }]}>{fmtDate(d, { weekday: 'narrow' })}</Text>
                <View style={[styles.dayNum, isToday && { backgroundColor: c.accent }]}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: isToday ? c.onAccent : d < t0 ? c.faint : c.text }}>{parseDate(d).getDate()}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        {data.therapists.map((t) => (
          <View key={t.id} style={[styles.gridRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border }]}>
            <View style={[styles.nameCell, { width: NAME_COL }]}>
              <Avatar name={t.name} seed={t.id} size={30} />
              <Text style={[type.caption, { color: c.text, marginTop: 3 }]} numberOfLines={1}>{t.name.split(' ')[0]}</Text>
            </View>
            {t.days.map((d) => {
              const date = d.date!;
              const tone = cellTone(d, c);
              const past = date < t0;
              const full = isFull(d);
              const label = !d.working ? (d.hasTimeOff ? 'Time off' : 'Off')
                : full ? 'Full' : `${hrs(d.freeMin)} free`;
              return (
                <Pressable
                  key={date}
                  onPress={() => openDay(date, t.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`${t.name}, ${fmtDate(date, { weekday: 'long' })}: ${label}${d.working ? `, ${hrs(d.bookedMin)} of ${hrs(d.availableMin)} booked, ${d.sessions} sessions` : ''}`}
                  style={({ pressed }) => [
                    styles.cell,
                    { backgroundColor: d.hasTimeOff && !d.working ? c.warnSoft : tone.bg, borderColor: date === t0 ? c.accent : 'transparent' },
                    past && { opacity: 0.55 },
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  {d.working ? (
                    <>
                      {/* fill rises with how booked the day is */}
                      <View style={[styles.fill, { height: `${Math.round(d.utilization * 100)}%`, backgroundColor: tone.fill, opacity: full ? 0.2 : 0.32 }]} />
                      <Text style={[styles.cellMain, { color: full ? c.danger : c.text }]} numberOfLines={1}>{full ? 'Full' : hrs(d.freeMin)}</Text>
                      <Text style={[styles.cellSub, { color: (d.maxSessions && d.sessions >= d.maxSessions) ? c.danger : c.muted }]} numberOfLines={1}>
                        {d.maxSessions ? `${d.sessions}/${d.maxSessions}` : `${d.sessions}`}
                      </Text>
                    </>
                  ) : d.hasTimeOff ? (
                    <Ionicons name="airplane-outline" size={15} color={c.warn} />
                  ) : (
                    <Text style={[styles.cellSub, { color: c.faint }]}>Off</Text>
                  )}
                  {d.overridden && <View style={[styles.dot, { backgroundColor: c.warn }]} />}
                  {d.hasTimeOff && d.working && <Ionicons name="airplane" size={9} color={c.warn} style={styles.planeCorner} />}
                </Pressable>
              );
            })}
          </View>
        ))}

        {/* day totals */}
        <View style={[styles.gridRow, styles.totalsRow, { borderTopColor: c.border, backgroundColor: c.surface2 }]}>
          <View style={[styles.nameCell, { width: NAME_COL }]}>
            <Text style={[type.caption, { color: c.muted }]}>TEAM</Text>
          </View>
          {data.totals.map((d) => (
            <View key={d.date} style={styles.totalCell}>
              <Text style={[styles.cellMain, { color: d.availableMin ? c.text : c.faint }]}>{d.availableMin ? pct(d.utilization) : '–'}</Text>
              <Text style={[styles.cellSub, { color: c.muted }]}>{d.availableMin ? hrs(d.freeMin) : ''}</Text>
            </View>
          ))}
        </View>

        {/* rooms: booked hours per day */}
        {data.rooms.length > 0 && data.rooms.map((rm) => (
          <View key={rm.id} style={[styles.gridRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border }]}>
            <View style={[styles.nameCell, { width: NAME_COL, alignItems: 'flex-start', paddingLeft: 8 }]}>
              <Ionicons name="bed-outline" size={14} color={c.muted} />
              <Text style={[type.caption, { color: c.text, marginTop: 2 }]} numberOfLines={1}>{rm.name}</Text>
            </View>
            {data.totals.map((d) => {
              const used = d.rooms.find((x) => x.roomId === rm.id)?.bookedMin ?? 0;
              return (
                <View key={d.date} style={styles.totalCell}>
                  <Text style={[styles.cellSub, { color: used ? c.text : c.faint, fontWeight: used ? '700' : '500' }]}>{used ? hrs(used) : '–'}</Text>
                </View>
              );
            })}
          </View>
        ))}
      </View>

      {/* legend */}
      <View style={[styles.pad, { marginTop: space.lg, gap: space.sm }]}>
        <T v="caption" color={c.muted}>HOW TO READ IT</T>
        <Legend swatch={<View style={[styles.sw, { backgroundColor: c.surface, borderColor: c.border, borderWidth: 1 }]}><View style={[styles.swFill, { backgroundColor: c.accent }]} /></View>} text="Big number = free time left. The green fill rises as the day books up." />
        <Legend swatch={<View style={[styles.sw, { backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, alignItems: 'center', justifyContent: 'center' }]}><Text style={{ fontSize: 9, color: c.muted, fontWeight: '700' }}>4/6</Text></View>} text="Small number = sessions booked (out of their daily limit)." />
        <Legend swatch={<View style={[styles.sw, { backgroundColor: c.dangerSoft }]} />} text="Full: no time or sessions left." />
        <Legend swatch={<View style={[styles.sw, { backgroundColor: c.warnSoft, alignItems: 'center', justifyContent: 'center' }]}><Ionicons name="airplane-outline" size={11} color={c.warn} /></View>} text="Time off.  Orange dot = custom hours that day." />
        <Legend swatch={<View style={[styles.sw, { backgroundColor: c.surface2 }]} />} text="Team row: % booked and free hours. Rooms: hours in use." />
        <T v="small" color={c.faint} style={{ marginTop: space.sm }}>Tap any cell to open that day.</T>
      </View>
    </ScrollView>
  );
}

function Summary({ icon, label, value, tint, fg }: { icon: any; label: string; value: string; tint: string; fg: string }) {
  const c = useColors();
  return (
    <View style={[styles.sumCard, { backgroundColor: c.surface, borderColor: c.border }]}>
      <View style={[styles.sumIcon, { backgroundColor: tint }]}><Ionicons name={icon} size={15} color={fg} /></View>
      <T v="heading" style={{ marginTop: space.sm }}>{value}</T>
      <T v="small" color={c.muted} numberOfLines={1}>{label}</T>
    </View>
  );
}

function Legend({ swatch, text }: { swatch: React.ReactNode; text: string }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
      {swatch}
      <T v="small" color={c.muted} style={{ flex: 1 }}>{text}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: space.lg },
  weekRow: { flexDirection: 'row', alignItems: 'center', marginTop: space.lg },
  reset: { alignSelf: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, marginTop: space.sm },
  summary: { flexDirection: 'row', gap: space.sm, marginTop: space.lg, marginBottom: space.lg },
  sumCard: { flex: 1, padding: space.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  sumIcon: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  grid: { marginHorizontal: space.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', paddingBottom: 0 },
  gridRow: { flexDirection: 'row', alignItems: 'stretch' },
  dayHead: { flex: 1, alignItems: 'center', paddingVertical: 8, minHeight: 52 },
  dayNum: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  nameCell: { alignItems: 'center', justifyContent: 'center', paddingVertical: 6 },
  cell: { flex: 1, height: 60, margin: 2, borderRadius: 9, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  cellMain: { fontSize: 12, fontWeight: '700' },
  cellSub: { fontSize: 10, fontWeight: '600', marginTop: 1 },
  dot: { position: 'absolute', top: 4, right: 4, width: 5, height: 5, borderRadius: 3 },
  planeCorner: { position: 'absolute', top: 3, left: 3 },
  totalsRow: { borderTopWidth: StyleSheet.hairlineWidth },
  totalCell: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 8 },
  sw: { width: 26, height: 22, borderRadius: 6, overflow: 'hidden' },
  swFill: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%', opacity: 0.25 },
});
