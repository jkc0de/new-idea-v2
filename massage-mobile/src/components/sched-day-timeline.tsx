import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useColorScheme, type GestureResponderEvent } from 'react-native';

import { duration, time, timeShort } from '@/lib/format';
import { avatarColor, radius, space, type, useColors } from '@/lib/theme';
import type { Appointment, ScheduleDay } from '@/lib/types';

import { CapacityBar } from './sched-capacity';
import { hrs, isFull } from './sched-format';
import { Ionicons, T, tap } from './ui';

const PX = 1.25;      // pixels per minute
const GUTTER = 46;    // time labels column
const HEAD = 62;      // lane header height
const MIN_LANE = 112; // narrowest lane before we scroll sideways

/**
 * One vertical lane per therapist. White = working, muted = closed, labelled "Break" between shifts.
 * Tap free working time to book that slot; tap a booking to open it.
 */
export function DayTimeline({ day, onlyTherapist, nowMin, onPressAppointment, onPressSlot }: {
  day: ScheduleDay;
  onlyTherapist: number | null;
  nowMin: number | null;
  onPressAppointment: (a: Appointment) => void;
  onPressSlot: (therapistId: number, startMin: number) => void;
}) {
  const c = useColors();
  const scheme = useColorScheme();
  const [width, setWidth] = useState(0);
  const lanes = day.therapists.filter((t) => (onlyTherapist ? t.id === onlyTherapist : t.active || day.appointments.some((a) => a.therapistId === t.id)));

  // Visible range: earliest opening/booking to latest, padded to whole hours.
  let lo = 9 * 60;
  let hi = 18 * 60;
  for (const t of lanes) for (const w of t.hours) { lo = Math.min(lo, w.startMin); hi = Math.max(hi, w.endMin); }
  for (const a of day.appointments) { lo = Math.min(lo, a.startMin); hi = Math.max(hi, a.endMin); }
  lo = Math.max(0, Math.floor(lo / 60) * 60);
  hi = Math.min(1440, Math.ceil(hi / 60) * 60);
  const height = (hi - lo) * PX;
  const y = (m: number) => (m - lo) * PX;

  const avail = Math.max(0, width - GUTTER);
  const laneW = lanes.length ? Math.max(MIN_LANE, Math.floor(avail / lanes.length)) : MIN_LANE;
  const scrolls = laneW * lanes.length > avail + 1;

  const hours: number[] = [];
  for (let m = lo; m <= hi; m += 60) hours.push(m);

  const lanesView = (
    <View style={{ flexDirection: 'row' }}>
      {lanes.map((t) => {
        const color = avatarColor(t.id, scheme);
        const inv = t.inventory;
        const full = inv ? isFull(inv) : false;
        const appts = day.appointments.filter((a) => a.therapistId === t.id);
        const windows = [...t.hours].sort((a, b) => a.startMin - b.startMin);
        return (
          <View key={t.id} style={{ width: laneW }}>
            {/* lane header with today's capacity */}
            <View style={[styles.head, { borderColor: c.border, backgroundColor: c.bg }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
                <T v="small" style={{ fontWeight: '700', flex: 1 }} numberOfLines={1}>{t.name.split(' ')[0]}</T>
                {t.overridden && <Ionicons name="create-outline" size={12} color={c.muted} />}
              </View>
              {inv?.working ? (
                <>
                  <View style={{ marginVertical: 4 }}><CapacityBar used={inv.bookedMin} total={inv.availableMin} color={full ? c.danger : c.accent} height={4} /></View>
                  <Text style={[type.caption, { color: full ? c.danger : c.muted, fontWeight: '600' }]} numberOfLines={1}>
                    {full ? 'Full' : `${hrs(inv.freeMin)} free`}{inv.maxSessions ? ` · ${inv.sessions}/${inv.maxSessions}` : ''}
                  </Text>
                </>
              ) : (
                <Text style={[type.caption, { color: c.faint, marginTop: 6 }]}>{t.timeOff.length ? 'Time off' : 'Off'}</Text>
              )}
            </View>

            {/* lane body */}
            <View style={[styles.lane, { height, backgroundColor: c.surface2, borderColor: c.border }]}>
              {hours.slice(1, -1).map((m) => <View key={m} style={[styles.hourLine, { top: y(m), backgroundColor: c.border }]} />)}

              {/* breaks between shifts */}
              {windows.slice(1).map((w, i) => {
                const prev = windows[i];
                if (w.startMin - prev.endMin < 15) return null;
                return (
                  <View key={`brk-${w.startMin}`} style={[styles.breakLabel, { top: y(prev.endMin), height: (w.startMin - prev.endMin) * PX }]}>
                    <Text style={[type.caption, { color: c.faint }]}>Break</Text>
                  </View>
                );
              })}

              {/* working time: tap to book */}
              {windows.map((w) => (
                <Pressable
                  key={`w-${w.startMin}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Book ${t.name} between ${time(w.startMin)} and ${time(w.endMin)}`}
                  onPress={(e: GestureResponderEvent) => {
                    const offset = e.nativeEvent.locationY ?? 0;
                    const raw = w.startMin + offset / PX;
                    const start = Math.min(Math.max(w.startMin, Math.floor(raw / 15) * 15), w.endMin - 15);
                    tap();
                    onPressSlot(t.id, start);
                  }}
                  style={[styles.window, { top: y(w.startMin), height: (w.endMin - w.startMin) * PX, backgroundColor: c.surface }]}
                />
              ))}

              {/* time off */}
              {t.timeOff.map((o) => {
                const s = Math.max(o.startMin, lo);
                const e = Math.min(o.endMin, hi);
                if (e <= s) return null;
                return (
                  <View key={`off-${o.id}`} pointerEvents="none" style={[styles.off, { top: y(s), height: (e - s) * PX, backgroundColor: c.warnSoft }]}>
                    <Ionicons name="airplane-outline" size={13} color={c.warn} />
                    <Text style={[type.caption, { color: c.warn }]} numberOfLines={2}>{o.reason || 'Time off'}</Text>
                  </View>
                );
              })}

              {/* bookings */}
              {appts.map((a) => {
                const h = Math.max(26, (a.endMin - a.startMin) * PX - 2);
                const cancelled = a.status === 'cancelled';
                const flagged = !!a.issues?.length;
                return (
                  <Pressable
                    key={a.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${a.clientName}, ${a.serviceName}, ${time(a.startMin)}${flagged ? ', needs attention' : ''}`}
                    onPress={() => { tap(); onPressAppointment(a); }}
                    style={({ pressed }) => [
                      styles.appt,
                      {
                        top: y(a.startMin) + 1, height: h,
                        backgroundColor: cancelled ? 'transparent' : a.status === 'no_show' ? c.warnSoft : a.status === 'completed' ? c.surface2 : color,
                        borderColor: flagged ? c.danger : cancelled ? c.border : 'transparent',
                        borderWidth: flagged ? 2 : cancelled ? 1 : 0,
                        borderStyle: cancelled ? 'dashed' : 'solid',
                        opacity: cancelled ? 0.6 : pressed ? 0.8 : 1,
                      },
                    ]}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                      {flagged && <Ionicons name="warning" size={11} color={c.danger} />}
                      <Text style={[styles.apptName, { color: c.text }, cancelled && { textDecorationLine: 'line-through' }]} numberOfLines={1}>{a.clientName}</Text>
                    </View>
                    {h > 40 && <Text style={[styles.apptMeta, { color: c.text }]} numberOfLines={1}>{`${timeShort(a.startMin)} · ${duration(a.endMin - a.startMin)}`}</Text>}
                    {h > 62 && <Text style={[styles.apptMeta, { color: c.text }]} numberOfLines={2}>{a.serviceName.replace(/ – \d+ min$/, '')}</Text>}
                    {h > 90 && a.roomName ? <Text style={[styles.apptMeta, { color: c.text, opacity: 0.7 }]} numberOfLines={1}>{a.roomName}</Text> : null}
                  </Pressable>
                );
              })}

              {nowMin !== null && nowMin > lo && nowMin < hi && (
                <View pointerEvents="none" style={[styles.nowLine, { top: y(nowMin), backgroundColor: c.danger }]} />
              )}
            </View>
          </View>
        );
      })}
    </View>
  );

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 && (
        <View style={{ flexDirection: 'row' }}>
          <View style={{ width: GUTTER, paddingTop: HEAD }}>
            <View style={{ height }}>
              {hours.slice(1, -1).map((m) => (
                <Text key={m} style={[styles.hourLabel, { top: y(m) - 7, color: c.faint }]}>{timeShort(m)}{m < 720 ? 'a' : 'p'}</Text>
              ))}
              {nowMin !== null && nowMin > lo && nowMin < hi && <View style={[styles.nowDot, { top: y(nowMin) - 4, backgroundColor: c.danger }]} />}
            </View>
          </View>
          {scrolls ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>{lanesView}</ScrollView>
          ) : (
            <View style={{ flex: 1 }}>{lanesView}</View>
          )}
        </View>
      )}
      <View style={styles.legend}>
        <LegendSwatch color={c.surface} border={c.border} label="Open — tap to book" />
        <LegendSwatch color={c.surface2} label="Closed / break" />
        <LegendSwatch color={c.warnSoft} label="Time off" />
        <LegendSwatch color="transparent" border={c.danger} label="Needs attention" />
      </View>
    </View>
  );
}

function LegendSwatch({ color, border, label }: { color: string; border?: string; label: string }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 14, height: 14, borderRadius: 4, backgroundColor: color, borderWidth: border ? 1.5 : 0, borderColor: border }} />
      <T v="small" color={c.muted}>{label}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { height: HEAD, paddingHorizontal: 8, paddingTop: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  lane: { position: 'relative', borderLeftWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  hourLine: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, opacity: 0.8, zIndex: 2 },
  window: { position: 'absolute', left: 0, right: 0, zIndex: 1 },
  breakLabel: { position: 'absolute', left: 0, right: 0, alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  off: { position: 'absolute', left: 3, right: 3, borderRadius: 8, padding: 5, gap: 2, zIndex: 3 },
  appt: { position: 'absolute', left: 3, right: 3, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 4, overflow: 'hidden', zIndex: 4 },
  apptName: { fontSize: 12, fontWeight: '700', flexShrink: 1 },
  apptMeta: { fontSize: 11, marginTop: 1 },
  hourLabel: { position: 'absolute', right: 6, fontSize: 11, fontWeight: '600' },
  nowLine: { position: 'absolute', left: 0, right: 0, height: 2, zIndex: 5 },
  nowDot: { position: 'absolute', right: -4, width: 8, height: 8, borderRadius: 4 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginTop: space.md, paddingHorizontal: 2 },
});

export const TIMELINE_RADIUS = radius.md;
