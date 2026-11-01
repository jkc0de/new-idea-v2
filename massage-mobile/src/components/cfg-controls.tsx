import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fmtDate, time } from '@/lib/format';
import { radius, space, type, useColors } from '@/lib/theme';
import type { Appointment } from '@/lib/types';

import { Sheet } from './sheet';
import { Button, Ionicons, T, tap } from './ui';

/** Compact −/+ time control in 15/30-minute steps. */
export function TimeStepper({ value, onChange, step = 30, min = 0, max = 1440, label }: {
  value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; label?: string;
}) {
  const c = useColors();
  const set = (v: number) => { tap(); onChange(Math.max(min, Math.min(max, v))); };
  return (
    <View style={[styles.stepper, { backgroundColor: c.surface2 }]}>
      <Pressable onPress={() => set(value - step)} hitSlop={6} accessibilityLabel={`${label ?? 'Time'} earlier`} style={styles.stepBtn}>
        <Ionicons name="remove" size={16} color={c.muted} />
      </Pressable>
      <Text style={[type.small, { color: c.text, fontWeight: '700', minWidth: 64, textAlign: 'center' }]}>{value >= 1440 ? 'Midnight' : time(value)}</Text>
      <Pressable onPress={() => set(value + step)} hitSlop={6} accessibilityLabel={`${label ?? 'Time'} later`} style={styles.stepBtn}>
        <Ionicons name="add" size={16} color={c.muted} />
      </Pressable>
    </View>
  );
}

/** Row with a label, description and −/+ buttons for a number. */
export function NumberStepper({ label, sub, value, display, onChange, step = 1, min = 0, max = 99 }: {
  label: string; sub?: string; value: number; display: string; onChange: (v: number) => void; step?: number; min?: number; max?: number;
}) {
  const c = useColors();
  const set = (v: number) => { tap(); onChange(Math.max(min, Math.min(max, Math.round(v * 100) / 100))); };
  return (
    <View style={styles.numRow}>
      <View style={{ flex: 1 }}>
        <T v="bodyStrong">{label}</T>
        {sub ? <T v="small" color={c.muted}>{sub}</T> : null}
      </View>
      <Pressable onPress={() => set(value - step)} accessibilityLabel={`Decrease ${label}`} style={[styles.round, { backgroundColor: c.surface2 }, value <= min && { opacity: 0.4 }]}>
        <Ionicons name="remove" size={18} color={c.text} />
      </Pressable>
      <Text style={[type.bodyStrong, { color: c.text, minWidth: 76, textAlign: 'center' }]}>{display}</Text>
      <Pressable onPress={() => set(value + step)} accessibilityLabel={`Increase ${label}`} style={[styles.round, { backgroundColor: c.surface2 }, value >= max && { opacity: 0.4 }]}>
        <Ionicons name="add" size={18} color={c.text} />
      </Pressable>
    </View>
  );
}

/** Shown after a schedule change when existing bookings no longer fit. */
export function ConflictSheet({ conflicts, onClose }: { conflicts: (Appointment & { issues?: { message: string }[] })[] | null; onClose: () => void }) {
  const c = useColors();
  const list = conflicts ?? [];
  return (
    <Sheet visible={list.length > 0} onClose={onClose} title={`${list.length} booking${list.length === 1 ? '' : 's'} need${list.length === 1 ? 's' : ''} attention`}>
      <T v="small" color={c.muted} style={{ marginTop: -space.sm, marginBottom: space.md }}>
        These bookings no longer fit the schedule. Move or reassign them so no client turns up to an empty room.
      </T>
      <View style={{ gap: space.sm, marginBottom: space.lg }}>
        {list.slice(0, 5).map((a) => (
          <View key={a.id} style={[styles.conflict, { backgroundColor: c.warnSoft }]}>
            <Ionicons name="alert-circle" size={18} color={c.warn} />
            <View style={{ flex: 1 }}>
              <T v="bodyStrong">{`${a.clientName} · ${fmtDate(a.date)} ${time(a.startMin)}`}</T>
              <T v="small" color={c.muted} numberOfLines={1}>{a.issues?.[0]?.message ?? `${a.serviceName} with ${a.therapistName}`}</T>
            </View>
          </View>
        ))}
        {list.length > 5 && <T v="small" color={c.muted}>{`+ ${list.length - 5} more`}</T>}
      </View>
      <View style={{ gap: space.sm }}>
        <Button title="Review & fix" icon="construct-outline" onPress={() => { onClose(); router.push('/conflicts'); }} />
        <Button title="Later" kind="ghost" onPress={onClose} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  stepper: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.sm, height: 36 },
  stepBtn: { width: 28, height: 36, alignItems: 'center', justifyContent: 'center' },
  numRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.lg },
  round: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  conflict: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.md },
});
