import { StyleSheet, View } from 'react-native';

import { fmtDate, time } from '@/lib/format';
import { radius, space, useColors } from '@/lib/theme';
import type { AppointmentEvent } from '@/lib/types';

import { Ionicons, T, type IconName } from './ui';

export interface NameLookup {
  therapist: (id?: number | null) => string | null;
  room: (id?: number | null) => string | null;
  service: (id?: number | null) => string | null;
}

const OVERRIDE_TEXT: Record<string, string> = {
  outside_hours: 'outside working hours',
  time_off: 'during time off',
  daily_limit: 'over the daily session limit',
  needs_break: 'without the required break',
  inactive: 'with an inactive therapist',
};

const STATUS_TEXT: Record<string, [string, IconName]> = {
  completed: ['Checked out', 'checkmark-circle'],
  no_show: ['Marked as no-show', 'eye-off'],
  cancelled: ['Cancelled', 'close-circle'],
  booked: ['Restored to booked', 'arrow-undo'],
};

/** "2026-11-01 15:04:05" (UTC) → "Today 3:04 PM" / "Yesterday …" / "Mon, Nov 2, 3:04 PM" */
export function whenLabel(at: string) {
  const d = new Date(at.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return at;
  const mins = d.getHours() * 60 + d.getMinutes();
  const dayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  const yStr = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
  const prefix = dayStr === todayStr ? 'Today' : dayStr === yStr ? 'Yesterday' : fmtDate(dayStr, { weekday: 'short', month: 'short', day: 'numeric' });
  return `${prefix}, ${time(mins)}`;
}

function by(actor: string) { return actor === 'client' ? 'by client' : actor === 'staff' ? 'by staff' : ''; }

function slotText(x: any, names: NameLookup) {
  if (!x) return '';
  const parts = [];
  if (x.date) parts.push(fmtDate(x.date, { weekday: 'short', month: 'short', day: 'numeric' }));
  if (Number.isInteger(x.startMin)) parts.push(time(x.startMin));
  const who = names.therapist(x.therapistId);
  return `${parts.join(' ')}${who ? ` (${who.split(' ')[0]})` : ''}`;
}

/** Turn a raw event into a sentence + icon. */
export function describeEvent(e: AppointmentEvent, names: NameLookup): { title: string; sub?: string; icon: IconName; tone: 'accent' | 'muted' | 'danger' | 'warn' } {
  const d = e.detail || {};
  const override = Array.isArray(d.override) && d.override.length
    ? `Override: ${d.override.map((c: string) => OVERRIDE_TEXT[c] ?? c).join(', ')}` : undefined;
  if (e.type === 'created') {
    const room = names.room(d.roomId);
    return {
      title: e.actor === 'client' ? 'Booked online by client' : 'Booked by staff',
      sub: [slotText(d, names), room, override].filter(Boolean).join(' · ') || undefined,
      icon: e.actor === 'client' ? 'globe-outline' : 'call-outline',
      tone: override ? 'warn' : 'accent',
    };
  }
  if (e.type === 'rescheduled') {
    const f = d.from || {};
    const t = d.to || {};
    const timeMoved = f.date !== t.date || f.startMin !== t.startMin;
    const therapistMoved = f.therapistId !== t.therapistId && t.therapistId !== undefined;
    const serviceMoved = t.serviceId && f.serviceId && f.serviceId !== t.serviceId;
    let title = `Moved ${by(e.actor)}`;
    let sub = `${slotText(f, names)} → ${slotText(t, names)}`;
    if (!timeMoved && therapistMoved) {
      title = `Reassigned ${by(e.actor)}`;
      sub = `${names.therapist(f.therapistId) ?? 'Therapist'} → ${names.therapist(t.therapistId) ?? 'Therapist'}`;
    } else if (!timeMoved && !therapistMoved && serviceMoved) {
      title = `Service changed ${by(e.actor)}`;
      sub = `${names.service(f.serviceId) ?? ''} → ${names.service(t.serviceId) ?? ''}`;
    } else if (!timeMoved && !therapistMoved && f.roomId !== t.roomId) {
      title = `Room changed ${by(e.actor)}`;
      sub = `${names.room(f.roomId) ?? 'No room'} → ${names.room(t.roomId) ?? 'No room'}`;
    }
    if (serviceMoved && (timeMoved || therapistMoved)) sub += ` · now ${names.service(t.serviceId) ?? 'new service'}`;
    return { title, sub: [sub, d.reason ? `“${d.reason}”` : null, override].filter(Boolean).join(' · '), icon: 'swap-horizontal', tone: override ? 'warn' : 'accent' };
  }
  if (e.type === 'status') {
    const [label, icon] = STATUS_TEXT[d.to] ?? [`Status: ${d.to}`, 'ellipse-outline'];
    const title = d.to === 'cancelled' ? `Cancelled ${by(e.actor)}` : d.to === 'booked' && d.from !== 'cancelled' ? 'Moved back to booked' : label;
    return { title, sub: d.reason ? `“${d.reason}”` : undefined, icon, tone: d.to === 'cancelled' ? 'danger' : d.to === 'no_show' ? 'warn' : d.to === 'completed' ? 'accent' : 'muted' };
  }
  if (e.type === 'notes') return { title: 'Staff notes updated', icon: 'create-outline', tone: 'muted' };
  return { title: e.type, icon: 'ellipse-outline', tone: 'muted' };
}

/** Vertical timeline of everything that happened to a booking, newest first. */
export function ActivityTimeline({ events, names }: { events: AppointmentEvent[]; names: NameLookup }) {
  const c = useColors();
  const tones = {
    accent: [c.accentSoft, c.accentStrong],
    muted: [c.surface2, c.muted],
    danger: [c.dangerSoft, c.danger],
    warn: [c.warnSoft, c.warn],
  } as const;
  const list = [...events].reverse();
  if (!list.length) return <T v="small" color={c.muted}>No activity recorded yet.</T>;
  return (
    <View>
      {list.map((e, i) => {
        const x = describeEvent(e, names);
        const [bg, fg] = tones[x.tone];
        const last = i === list.length - 1;
        return (
          <View key={e.id} style={styles.row} accessible accessibilityLabel={`${x.title}. ${x.sub ?? ''}. ${whenLabel(e.at)}`}>
            <View style={styles.rail}>
              <View style={[styles.dot, { backgroundColor: bg }]}><Ionicons name={x.icon} size={16} color={fg} /></View>
              {!last && <View style={[styles.line, { backgroundColor: c.border }]} />}
            </View>
            <View style={{ flex: 1, paddingBottom: last ? 0 : space.lg, minWidth: 0 }}>
              <T v="bodyStrong" style={{ fontSize: 15 }}>{x.title}</T>
              {x.sub ? <T v="small" color={c.muted}>{x.sub}</T> : null}
              <T v="small" color={c.faint} style={{ marginTop: 2 }}>{whenLabel(e.at)}</T>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.md },
  rail: { alignItems: 'center', width: 32 },
  dot: { width: 32, height: 32, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  line: { width: 2, flex: 1, marginTop: 4, marginBottom: 4, borderRadius: 1 },
});
