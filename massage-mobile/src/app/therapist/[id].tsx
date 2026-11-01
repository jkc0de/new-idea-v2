import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Sheet } from '@/components/sheet';
import { Button, Card, Chip, Divider, ErrorBanner, Field, IconButton, Ionicons, Loading, Section, T, tap } from '@/components/ui';
import { api } from '@/lib/api';
import { confirmAsync } from '@/lib/confirm';
import { addDays, fmtDate, parseDate, time, WEEKDAYS } from '@/lib/format';
import { radius, space, type, useColors } from '@/lib/theme';
import type { Service, Stats, Therapist } from '@/lib/types';
import { useApi } from '@/lib/use-api';

type DayHours = { on: boolean; start: number; end: number };
const DEFAULT_DAY: DayHours = { on: false, start: 9 * 60, end: 17 * 60 };

export default function TherapistEdit() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const c = useColors();
  const insets = useSafeAreaInsets();
  const team = useApi<{ therapists: Therapist[] }>('/api/therapists');
  const svc = useApi<{ services: Service[] }>('/api/services');
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [active, setActive] = useState(true);
  const [serviceIds, setServiceIds] = useState<number[]>([]);
  const [week, setWeek] = useState<DayHours[]>(() => WEEKDAYS.map(() => ({ ...DEFAULT_DAY })));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (loaded || !team.data || !svc.data) return;
    const t = team.data.therapists.find((x) => String(x.id) === id);
    if (t) {
      setName(t.name); setBio(t.bio); setActive(t.active); setServiceIds(t.serviceIds);
      setWeek(WEEKDAYS.map((_, d) => {
        const h = t.hours?.find((x) => x.weekday === d);
        return h ? { on: true, start: h.startMin, end: h.endMin } : { ...DEFAULT_DAY };
      }));
    } else if (isNew) {
      setServiceIds(svc.data.services.filter((s) => s.active).map((s) => s.id));
      setWeek(WEEKDAYS.map((_, d) => ({ ...DEFAULT_DAY, on: d >= 1 && d <= 5 })));
    }
    setLoaded(true);
  }, [team.data, svc.data, id, isNew, loaded]);

  if (!loaded) return <Loading />;

  const setDay = (d: number, patch: Partial<DayHours>) => setWeek((w) => w.map((x, i) => (i === d ? { ...x, ...patch } : x)));

  async function save() {
    if (!name.trim()) return setError('Name is required');
    const hours = week.map((h, weekday) => ({ ...h, weekday })).filter((h) => h.on).map((h) => ({ weekday: h.weekday, startMin: h.start, endMin: h.end }));
    if (hours.some((h) => h.endMin <= h.startMin)) return setError('Each working day must end after it starts');
    setSaving(true); setError(null);
    try {
      const body = { name, bio, active, serviceIds, hours };
      await api(isNew ? '/api/therapists' : `/api/therapists/${id}`, { method: isNew ? 'POST' : 'PUT', body });
      tap('success');
      router.back();
    } catch (e: any) { setError(e.message); setSaving(false); }
  }

  async function remove() {
    if (!(await confirmAsync(`Remove ${name}?`, 'Therapists with past bookings are made inactive instead.', 'Remove', true))) return;
    try { await api(`/api/therapists/${id}`, { method: 'DELETE' }); router.back(); } catch (e: any) { setError(e.message); }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: isNew ? 'New therapist' : name || 'Therapist' }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxl }} keyboardShouldPersistTaps="handled">
        <ErrorBanner message={error} />
        <Field label="Name" value={name} onChangeText={setName} placeholder="Full name" />
        <Field label="Bio" value={bio} onChangeText={setBio} multiline placeholder="Shown to clients when they pick a therapist" />
        <Card padded={false}>
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <T v="bodyStrong">Taking bookings</T>
              <T v="small" color={c.muted}>Turn off to hide from the booking page</T>
            </View>
            <Switch value={active} onValueChange={setActive} trackColor={{ true: c.accent, false: c.border }} thumbColor="#fff" />
          </View>
        </Card>

        <Section title="Services">
          {svc.data!.services.length === 0 ? <T v="small" color={c.muted}>Add services first, then assign them here.</T> : (
            <View style={styles.wrap}>
              {svc.data!.services.map((s) => (
                <Chip key={s.id} label={s.name} icon={serviceIds.includes(s.id) ? 'checkmark' : undefined} selected={serviceIds.includes(s.id)}
                  onPress={() => setServiceIds((ids) => (ids.includes(s.id) ? ids.filter((x) => x !== s.id) : [...ids, s.id]))} />
              ))}
            </View>
          )}
        </Section>

        <Section title="Weekly hours">
          <Card padded={false} style={{ overflow: 'hidden' }}>
            {week.map((h, d) => (
              <View key={d}>
                {d > 0 && <Divider inset={space.lg} />}
                <View style={styles.dayRow}>
                  <Pressable onPress={() => { tap(); setDay(d, { on: !h.on }); }} style={styles.dayToggle} accessibilityRole="switch" accessibilityState={{ checked: h.on }} accessibilityLabel={WEEKDAYS[d]}>
                    <View style={[styles.checkbox, { borderColor: h.on ? c.accent : c.border, backgroundColor: h.on ? c.accent : 'transparent' }]}>
                      {h.on && <Ionicons name="checkmark" size={14} color={c.onAccent} />}
                    </View>
                    <T v="bodyStrong" color={h.on ? c.text : c.faint}>{WEEKDAYS[d].slice(0, 3)}</T>
                  </Pressable>
                  {h.on ? (
                    <View style={styles.times}>
                      <TimeStepper value={h.start} onChange={(v) => setDay(d, { start: v })} />
                      <T v="small" color={c.faint}>–</T>
                      <TimeStepper value={h.end} onChange={(v) => setDay(d, { end: v })} />
                    </View>
                  ) : <T v="small" color={c.faint} style={{ flex: 1, textAlign: 'right' }}>Day off</T>}
                </View>
              </View>
            ))}
          </Card>
        </Section>

        {!isNew && <TimeOff therapistId={Number(id)} />}
        {!isNew && <Button title="Remove therapist" kind="ghost" style={{ marginTop: space.xl }} onPress={remove} />}
      </ScrollView>
      <View style={[styles.bottom, { paddingBottom: insets.bottom + space.md, borderTopColor: c.border }]}>
        <Button title={isNew ? 'Add therapist' : 'Save changes'} onPress={save} loading={saving} />
      </View>
    </KeyboardAvoidingView>
  );
}

/** Compact −/+ time control in 30-minute steps; tap the time to jump an hour. */
function TimeStepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const c = useColors();
  const set = (v: number) => { tap(); onChange(Math.max(0, Math.min(24 * 60, v))); };
  return (
    <View style={[styles.stepper, { backgroundColor: c.surface2 }]}>
      <Pressable onPress={() => set(value - 30)} hitSlop={6} accessibilityLabel="Earlier" style={styles.stepBtn}><Ionicons name="remove" size={16} color={c.muted} /></Pressable>
      <Text style={[type.small, { color: c.text, fontWeight: '700', minWidth: 62, textAlign: 'center' }]}>{value === 1440 ? 'Midnight' : time(value)}</Text>
      <Pressable onPress={() => set(value + 30)} hitSlop={6} accessibilityLabel="Later" style={styles.stepBtn}><Ionicons name="add" size={16} color={c.muted} /></Pressable>
    </View>
  );
}

function TimeOff({ therapistId }: { therapistId: number }) {
  const c = useColors();
  const q = useApi<{ timeOff: { id: number; date: string; startMin: number; endMin: number; reason: string }[] }>(`/api/therapists/${therapistId}/time-off`);
  const stats = useApi<Stats>('/api/stats');
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState<string | null>(null);
  const [days, setDays] = useState(1);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const today = stats.data?.today;
  const choices = today ? Array.from({ length: 60 }, (_, i) => addDays(today, i)) : [];

  async function add() {
    if (!from) return setError('Pick a start date');
    try {
      await api(`/api/therapists/${therapistId}/time-off`, { method: 'POST', body: { date: from, endDate: addDays(from, days - 1), reason } });
      setOpen(false); setFrom(null); setDays(1); setReason(''); setError(null);
      q.reload();
    } catch (e: any) { setError(e.message); }
  }

  return (
    <Section title="Time off" action={<Button title="Add" size="sm" kind="ghost" icon="add" onPress={() => setOpen(true)} />}>
      <Card padded={false} style={{ overflow: 'hidden' }}>
        {q.data?.timeOff.length ? q.data.timeOff.map((o, i) => (
          <View key={o.id}>
            {i > 0 && <Divider inset={space.lg} />}
            <View style={styles.offRow}>
              <View style={{ flex: 1 }}>
                <T v="bodyStrong">{fmtDate(o.date, { weekday: 'short', month: 'short', day: 'numeric' })}</T>
                <T v="small" color={c.muted}>{[o.startMin === 0 && o.endMin === 1440 ? 'All day' : `${time(o.startMin)} – ${time(o.endMin)}`, o.reason].filter(Boolean).join(' · ')}</T>
              </View>
              <IconButton icon="trash-outline" label="Remove time off" color={c.danger} bg={c.dangerSoft} size={34}
                onPress={async () => { await api(`/api/time-off/${o.id}`, { method: 'DELETE' }); q.reload(); }} />
            </View>
          </View>
        )) : <T v="small" color={c.muted} style={{ padding: space.lg }}>No upcoming time off.</T>}
      </Card>

      <Sheet visible={open} onClose={() => setOpen(false)} title="Add time off">
        <ErrorBanner message={error} />
        <T v="small" color={c.muted} style={{ marginBottom: space.sm, fontWeight: '600' }}>Starting</T>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: space.lg }}>
          {choices.map((d) => {
            const on = d === from;
            return (
              <Pressable key={d} onPress={() => { tap(); setFrom(d); }} style={[styles.dateChip, { backgroundColor: on ? c.accent : c.surface, borderColor: on ? c.accent : c.border }]}>
                <Text style={[type.caption, { color: on ? c.onAccent : c.muted }]}>{fmtDate(d, { weekday: 'short' }).toUpperCase()}</Text>
                <Text style={{ fontSize: 18, fontWeight: '700', color: on ? c.onAccent : c.text }}>{parseDate(d).getDate()}</Text>
                <Text style={[type.caption, { color: on ? c.onAccent : c.faint, fontWeight: '500' }]}>{fmtDate(d, { month: 'short' })}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={styles.daysRow}>
          <T v="bodyStrong" style={{ flex: 1 }}>{`${days} day${days === 1 ? '' : 's'}`}</T>
          <IconButton icon="remove" label="Fewer days" onPress={() => setDays(Math.max(1, days - 1))} />
          <IconButton icon="add" label="More days" onPress={() => setDays(Math.min(60, days + 1))} />
        </View>
        <Field label="Reason (optional)" value={reason} onChangeText={setReason} placeholder="Vacation, training…" />
        <T v="small" color={c.faint} style={{ marginBottom: space.md }}>Existing bookings in this period aren't cancelled automatically.</T>
        <Button title="Add time off" onPress={add} disabled={!from} />
      </Sheet>
    </Section>
  );
}

const styles = StyleSheet.create({
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  dayRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, minHeight: 56, gap: space.sm },
  dayToggle: { flexDirection: 'row', alignItems: 'center', gap: space.sm, width: 72, height: 44 },
  checkbox: { width: 22, height: 22, borderRadius: 7, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  times: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  stepper: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.sm, height: 36 },
  stepBtn: { width: 26, height: 36, alignItems: 'center', justifyContent: 'center' },
  offRow: { flexDirection: 'row', alignItems: 'center', padding: space.lg, gap: space.md },
  dateChip: { width: 58, height: 74, borderRadius: radius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  daysRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.lg },
  bottom: { paddingHorizontal: space.lg, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth },
});
