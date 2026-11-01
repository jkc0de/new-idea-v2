import { Pressable, ScrollView, StyleSheet, View, useColorScheme } from 'react-native';

import { avatarColor, radius, space, useColors } from '@/lib/theme';
import type { ScheduleDay } from '@/lib/types';

import { hrs, isFull, pct } from './sched-format';
import { Avatar, Ionicons, T, tap } from './ui';

type Therapist = ScheduleDay['therapists'][number];

/** Horizontal bar: booked vs available time. */
export function CapacityBar({ used, total, color, height = 6 }: { used: number; total: number; color: string; height?: number }) {
  const c = useColors();
  const ratio = total > 0 ? Math.min(1, used / total) : 0;
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: c.surface2, overflow: 'hidden' }}>
      <View style={{ width: `${ratio * 100}%`, height: '100%', backgroundColor: color, borderRadius: height / 2 }} />
    </View>
  );
}

function statusLine(t: Therapist) {
  const inv = t.inventory;
  if (!inv || !inv.working) return t.timeOff.length ? 'Time off' : 'Not working';
  if (isFull(inv)) return 'Fully booked';
  return `${hrs(inv.freeMin)} free`;
}

/**
 * Day capacity per therapist. With one therapist selected it shows a single detailed card,
 * otherwise a swipeable strip of compact cards.
 */
export function CapacityStrip({ therapists, selected, onSelect }: { therapists: Therapist[]; selected: number | null; onSelect: (id: number | null) => void }) {
  const c = useColors();
  const scheme = useColorScheme();
  const list = selected ? therapists.filter((t) => t.id === selected) : therapists;
  if (!list.length) return null;

  if (selected && list[0]) {
    const t = list[0];
    const inv = t.inventory;
    return (
      <View style={[styles.detail, { backgroundColor: c.surface, borderColor: c.border }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <Avatar name={t.name} seed={t.id} size={40} />
          <View style={{ flex: 1 }}>
            <T v="bodyStrong">{t.name}</T>
            <T v="small" color={c.muted}>
              {[statusLine(t), t.overridden ? 'Custom hours today' : null].filter(Boolean).join(' · ')}
            </T>
          </View>
          {inv?.working ? <T v="heading" color={c.accentStrong}>{pct(inv.utilization)}</T> : null}
        </View>
        {inv?.working ? (
          <>
            <View style={{ marginTop: space.md }}><CapacityBar used={inv.bookedMin} total={inv.availableMin} color={c.accent} height={8} /></View>
            <View style={styles.detailStats}>
              <Stat label="Booked" value={hrs(inv.bookedMin)} />
              <Stat label="Available" value={hrs(inv.availableMin)} />
              <Stat label="Sessions" value={inv.maxSessions ? `${inv.sessions}/${inv.maxSessions}` : String(inv.sessions)} warn={!!inv.maxSessions && inv.sessions >= inv.maxSessions} />
            </View>
          </>
        ) : null}
      </View>
    );
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingHorizontal: space.lg }}>
      {list.map((t) => {
        const inv = t.inventory;
        const working = !!inv?.working;
        const full = inv ? isFull(inv) : false;
        return (
          <Pressable
            key={t.id}
            accessibilityRole="button"
            accessibilityLabel={`${t.name}: ${statusLine(t)}`}
            onPress={() => { tap(); onSelect(t.id); }}
            style={({ pressed }) => [styles.mini, { backgroundColor: c.surface, borderColor: c.border }, pressed && { opacity: 0.8 }]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: avatarColor(t.id, scheme) }} />
              <T v="small" style={{ fontWeight: '700', flex: 1 }} numberOfLines={1}>{t.name.split(' ')[0]}</T>
              {t.overridden && <Ionicons name="create-outline" size={13} color={c.muted} accessibilityLabel="Custom hours" />}
              {t.timeOff.length > 0 && <Ionicons name="airplane-outline" size={13} color={c.warn} accessibilityLabel="Time off" />}
            </View>
            {working && inv ? (
              <>
                <View style={{ marginVertical: 6 }}><CapacityBar used={inv.bookedMin} total={inv.availableMin} color={full ? c.danger : c.accent} /></View>
                <T v="small" color={full ? c.danger : c.muted} numberOfLines={1}>
                  {full ? 'Full' : `${hrs(inv.freeMin)} free`}{inv.maxSessions ? ` · ${inv.sessions}/${inv.maxSessions}` : ` · ${inv.sessions}`}
                </T>
              </>
            ) : (
              <T v="small" color={c.faint} style={{ marginTop: 6 }}>{t.timeOff.length ? 'Time off' : 'Not working'}</T>
            )}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  const c = useColors();
  return (
    <View style={{ flex: 1 }}>
      <T v="bodyStrong" color={warn ? c.danger : c.text}>{value}</T>
      <T v="small" color={c.muted}>{label}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  mini: { width: 132, padding: space.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  detail: { marginHorizontal: space.lg, padding: space.lg, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  detailStats: { flexDirection: 'row', marginTop: space.md },
});
