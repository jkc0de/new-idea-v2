import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { addDays, fmtDate, fmtDateLong, parseDate, time } from '@/lib/format';
import { radius, space, type, useColors } from '@/lib/theme';
import type { Slot } from '@/lib/types';

import { Sheet } from './sheet';
import { Button, Chip, Empty, ErrorBanner, IconButton, Ionicons, T, tap } from './ui';

export type DayAvail = { date: string; available: number };

const PAGE = 21;

/**
 * Date strip + grouped time grid. Data comes from the fetchers, so the same picker
 * serves online booking, staff booking, moving a booking and client self-reschedule.
 * Render inside a ScrollView.
 */
export function SlotPicker({
  today, lastDay, fetchDays, fetchSlots, reloadKey, initialDate, onPick, selectedStart, custom,
}: {
  today: string;
  /** Last bookable date (inclusive). Defaults to 90 days out. */
  lastDay?: string;
  fetchDays: (from: string, count: number) => Promise<DayAvail[]>;
  fetchSlots: (date: string) => Promise<Slot[]>;
  /** Change this to refetch (e.g. when therapist or service changes). */
  reloadKey?: string;
  initialDate?: string | null;
  onPick: (slot: Slot, date: string) => void;
  /** Highlights a time (e.g. the booking's current time). */
  selectedStart?: { date: string; startMin: number } | null;
  /** Staff only: lets them type any time, e.g. for walk-ins. */
  custom?: { onPick: (date: string, startMin: number) => void; hint?: string };
}) {
  const c = useColors();
  const last = lastDay ?? addDays(today, 90);
  const startFrom = initialDate && initialDate >= today ? initialDate : today;
  // Keep the chosen date inside the first visible page.
  const [from, setFrom] = useState(() => (startFrom > addDays(today, PAGE - 4) ? addDays(startFrom, -3) : today));
  const [days, setDays] = useState<DayAvail[] | null>(null);
  const [date, setDate] = useState<string | null>(initialDate && initialDate >= today ? initialDate : null);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);

  useEffect(() => {
    let live = true;
    setDays(null);
    setError(null);
    fetchDays(from, PAGE)
      .then((list) => {
        if (!live) return;
        const visible = list.filter((d) => d.date <= last);
        setDays(visible);
        setDate((cur) => {
          // Keep the chosen day if it has openings; otherwise jump to the next day that does.
          if (cur && visible.some((d) => d.date === cur && d.available > 0)) return cur;
          if (cur) {
            const next = visible.find((d) => d.date >= cur && d.available > 0);
            if (next) return next.date;
          }
          return (visible.find((d) => d.available > 0) ?? visible[0])?.date ?? null;
        });
      })
      .catch((e) => live && setError(e.message));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, reloadKey]);

  useEffect(() => {
    if (!date) return;
    let live = true;
    setSlots(null);
    fetchSlots(date)
      .then((r) => { if (live) setSlots(r); })
      .catch((e) => live && setError(e.message));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, reloadKey]);

  const groups = useMemo(() => {
    if (!slots) return [];
    return ([
      ['Morning', 'sunny-outline', (m: number) => m < 720],
      ['Afternoon', 'partly-sunny-outline', (m: number) => m >= 720 && m < 1020],
      ['Evening', 'moon-outline', (m: number) => m >= 1020],
    ] as const).map(([label, icon, test]) => ({ label, icon, items: slots.filter((s) => test(s.startMin)) })).filter((g) => g.items.length);
  }, [slots]);

  const canBack = from > today;
  const canForward = addDays(from, PAGE) <= last;
  const monthLabel = days?.length ? fmtDate(date && days.some((d) => d.date === date) ? date : days[0].date, { month: 'long', year: 'numeric' }) : '';

  return (
    <View>
      <ErrorBanner message={error} />
      <View style={styles.monthRow}>
        <T v="heading">{monthLabel}</T>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <IconButton icon="chevron-back" label="Earlier dates" size={36} color={canBack ? c.text : c.faint}
            onPress={() => canBack && setFrom(addDays(from, -PAGE) < today ? today : addDays(from, -PAGE))} />
          <IconButton icon="chevron-forward" label="Later dates" size={36} color={canForward ? c.text : c.faint}
            onPress={() => canForward && setFrom(addDays(from, PAGE))} />
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -space.lg }} contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.sm, paddingVertical: 4 }}>
        {!days && <View style={{ height: 84, justifyContent: 'center' }}><ActivityIndicator color={c.accent} /></View>}
        {days?.map((d) => {
          const on = d.date === date;
          const off = d.available === 0;
          return (
            <Pressable
              key={d.date}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${fmtDateLong(d.date)}, ${off ? 'no open times' : `${d.available} times`}`}
              // Staff can still open a full day to enter a custom time.
              disabled={off && !custom}
              onPress={() => { tap(); setDate(d.date); }}
              style={[styles.day, { backgroundColor: on ? c.accent : c.surface, borderColor: on ? c.accent : c.border }, off && !on && { opacity: 0.4 }]}
            >
              <Text style={[type.caption, { color: on ? c.onAccent : c.muted }]}>{fmtDate(d.date, { weekday: 'short' }).toUpperCase()}</Text>
              <Text style={{ fontSize: 22, fontWeight: '700', color: on ? c.onAccent : c.text, marginVertical: 2 }}>{parseDate(d.date).getDate()}</Text>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: off ? 'transparent' : on ? c.onAccent : c.accent }} />
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={{ marginTop: space.lg }}>
        {date && (
          <View style={styles.dateRow}>
            <T v="bodyStrong" style={{ flex: 1 }}>{fmtDateLong(date)}</T>
            {custom && (
              <Pressable onPress={() => { tap(); setCustomOpen(true); }} hitSlop={8} accessibilityRole="button" style={[styles.customBtn, { backgroundColor: c.surface2 }]}>
                <Ionicons name="create-outline" size={15} color={c.accentStrong} />
                <T v="small" color={c.accentStrong} style={{ fontWeight: '700' }}>Custom time</T>
              </Pressable>
            )}
          </View>
        )}
        {!slots && date && !error && <ActivityIndicator color={c.accent} style={{ marginTop: space.xl }} />}
        {slots && slots.length === 0 && (
          <Empty icon="calendar-clear-outline" title="No open times" body={custom ? 'Try another day, or set a custom time.' : 'Try another day.'} />
        )}
        {groups.map((g) => (
          <View key={g.label} style={{ marginTop: space.md }}>
            <View style={styles.groupHead}>
              <Ionicons name={g.icon} size={16} color={c.muted} />
              <T v="small" color={c.muted} style={{ fontWeight: '600' }}>{g.label}</T>
            </View>
            <View style={styles.grid}>
              {g.items.map((s) => {
                const current = selectedStart && selectedStart.date === date && selectedStart.startMin === s.startMin;
                return (
                  <Pressable
                    key={s.startMin}
                    accessibilityRole="button"
                    accessibilityLabel={`${time(s.startMin)}${current ? ', current time' : ''}`}
                    onPress={() => { tap('medium'); onPick(s, date!); }}
                    style={({ pressed }) => [styles.slot, {
                      backgroundColor: pressed ? c.accent : current ? c.accentSoft : c.surface,
                      borderColor: pressed || current ? c.accent : c.border,
                    }]}
                  >
                    {({ pressed }) => (
                      <Text style={[type.bodyStrong, { color: pressed ? c.onAccent : current ? c.accentStrong : c.text, fontSize: 15 }]}>{time(s.startMin)}</Text>
                    )}
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
      </View>

      {custom && date && (
        <CustomTimeSheet
          visible={customOpen}
          date={date}
          hint={custom.hint}
          onClose={() => setCustomOpen(false)}
          onPick={(m) => { setCustomOpen(false); custom.onPick(date, m); }}
        />
      )}
    </View>
  );
}

/** Pick any start time with big, thumb-friendly controls. */
export function CustomTimeSheet({ visible, date, hint, onClose, onPick, initial = 600 }: {
  visible: boolean; date: string; hint?: string; onClose: () => void; onPick: (startMin: number) => void; initial?: number;
}) {
  const c = useColors();
  const [m, setM] = useState(initial);
  const clamp = (v: number) => Math.max(0, Math.min(23 * 60 + 45, v));
  const hours = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
  return (
    <Sheet visible={visible} onClose={onClose} title={`Custom time · ${fmtDate(date)}`}>
      <View style={styles.bigTimeRow}>
        <IconButton icon="remove" label="15 minutes earlier" size={48} onPress={() => setM(clamp(m - 15))} />
        <Text style={{ fontSize: 40, fontWeight: '700', color: c.text, minWidth: 170, textAlign: 'center' }} accessibilityLiveRegion="polite">{time(m)}</Text>
        <IconButton icon="add" label="15 minutes later" size={48} onPress={() => setM(clamp(m + 15))} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingVertical: space.md }}>
        {hours.map((h) => (
          <Chip key={h} label={time(h * 60).replace(':00', '')} selected={Math.floor(m / 60) === h} onPress={() => setM(h * 60 + (m % 60))} />
        ))}
      </ScrollView>
      <View style={{ flexDirection: 'row', gap: space.sm, marginBottom: space.lg }}>
        {[0, 15, 30, 45].map((mm) => (
          <View key={mm} style={{ flex: 1 }}>
            <Chip label={`:${String(mm).padStart(2, '0')}`} selected={m % 60 === mm} onPress={() => setM(Math.floor(m / 60) * 60 + mm)} />
          </View>
        ))}
      </View>
      {hint ? <T v="small" color={c.muted} style={{ marginBottom: space.md }}>{hint}</T> : null}
      <Button title={`Use ${time(m)}`} onPress={() => onPick(m)} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.md },
  day: { width: 62, height: 84, borderRadius: radius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.xs },
  customBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, height: 32, borderRadius: radius.pill },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: space.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  slot: { width: '31.5%', height: 48, borderRadius: radius.sm, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  bigTimeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
