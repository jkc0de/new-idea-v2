import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConflictSheet, NumberStepper, TimeStepper } from '@/components/cfg-controls';
import { Sheet } from '@/components/sheet';
import { Button, Card, Chip, Divider, ErrorBanner, Field, IconButton, Ionicons, Loading, Section, T, tap } from '@/components/ui';
import { api } from '@/lib/api';
import { confirmAsync } from '@/lib/confirm';
import { addDays, duration, fmtDate, parseDate, time, WEEKDAYS } from '@/lib/format';
import { radius, space, type, useColors } from '@/lib/theme';
import type { Appointment, Override, Service, Stats, Therapist } from '@/lib/types';
import { useApi } from '@/lib/use-api';

type Shift = { start: number; end: number };
type Conflict = Appointment & { issues?: { code: string; message: string }[] };

const DEFAULT_SHIFT: Shift = { start: 9 * 60, end: 17 * 60 };
const BREAKS = [15, 30, 45, 60];

/** Suggest the next shift after the last one: 1h later, 4h long, clamped to the day. */
function nextShift(shifts: Shift[]): Shift | null {
  const last = shifts[shifts.length - 1];
  if (!last) return { ...DEFAULT_SHIFT };
  const start = last.end + 60;
  if (start + 60 > 1440) return null;
  return { start, end: Math.min(1440, start + 240) };
}

function validateDay(shifts: Shift[], label: string): string | null {
  const sorted = [...shifts].sort((a, b) => a.start - b.start);
  for (const s of sorted) if (s.end <= s.start) return `${label}: each shift must end after it starts`;
  for (let i = 1; i < sorted.length; i++) if (sorted[i].start < sorted[i - 1].end) return `${label}: shifts overlap (${time(sorted[i].start)} starts before ${time(sorted[i - 1].end)})`;
  return null;
}

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
  const [week, setWeek] = useState<Shift[][]>(() => WEEKDAYS.map(() => []));
  const [maxSessions, setMaxSessions] = useState(0);
  const [maxHours, setMaxHours] = useState(0);
  const [minBreak, setMinBreak] = useState(30);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null);
  const [afterConflicts, setAfterConflicts] = useState<(() => void) | null>(null);

  useEffect(() => {
    if (loaded || !team.data || !svc.data) return;
    const t = team.data.therapists.find((x) => String(x.id) === id);
    if (t) {
      setName(t.name); setBio(t.bio); setActive(t.active); setServiceIds(t.serviceIds);
      setWeek(WEEKDAYS.map((_, d) => (t.hours ?? []).filter((h) => h.weekday === d).sort((a, b) => a.startMin - b.startMin).map((h) => ({ start: h.startMin, end: h.endMin }))));
      setMaxSessions(t.maxSessionsPerDay ?? 0);
      setMaxHours(t.maxConsecutiveMin ? t.maxConsecutiveMin / 60 : 0);
      setMinBreak(t.minBreakMin ?? 30);
    } else if (isNew) {
      setServiceIds(svc.data.services.filter((s) => s.active).map((s) => s.id));
      setWeek(WEEKDAYS.map((_, d) => (d >= 1 && d <= 5 ? [{ ...DEFAULT_SHIFT }] : [])));
    }
    setLoaded(true);
  }, [team.data, svc.data, id, isNew, loaded]);

  if (!loaded) return <Loading />;

  const setDay = (d: number, shifts: Shift[]) => setWeek((w) => w.map((x, i) => (i === d ? shifts : x)));
  const weeklyMin = week.flat().reduce((n, s) => n + Math.max(0, s.end - s.start), 0);

  /** Show clashing bookings first (if any), then run `next`. */
  function handleConflicts(list: Conflict[] | undefined, next: () => void) {
    if (list && list.length) { setConflicts(list); setAfterConflicts(() => next); } else next();
  }

  async function save() {
    setError(null);
    if (!name.trim()) return setError('Name is required');
    for (let d = 0; d < 7; d++) {
      const msg = validateDay(week[d], WEEKDAYS[d]);
      if (msg) return setError(msg);
    }
    const hours = week.flatMap((shifts, weekday) => shifts.map((s) => ({ weekday, startMin: s.start, endMin: s.end })));
    setSaving(true);
    try {
      const body = {
        name, bio, active, serviceIds, hours,
        maxSessionsPerDay: maxSessions || null,
        maxConsecutiveMin: maxHours ? Math.round(maxHours * 60) : null,
        minBreakMin: minBreak,
      };
      const res = await api<{ therapist: Therapist; conflicts?: Conflict[] }>(isNew ? '/api/therapists' : `/api/therapists/${id}`, { method: isNew ? 'POST' : 'PUT', body });
      tap('success');
      setSaving(false);
      handleConflicts(res.conflicts, () => router.back());
    } catch (e: any) { setError(e.message); setSaving(false); }
  }

  async function remove() {
    if (!(await confirmAsync(`Remove ${name}?`, 'Therapists with past bookings are made inactive instead.', 'Remove', true))) return;
    try {
      const res = await api<{ conflicts?: Conflict[] }>(`/api/therapists/${id}`, { method: 'DELETE' });
      handleConflicts(res.conflicts, () => router.back());
    } catch (e: any) { setError(e.message); }
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
            <Switch value={active} onValueChange={setActive} trackColor={{ true: c.accent, false: c.border }} thumbColor="#fff" accessibilityLabel="Taking bookings" />
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

        <Section title="Weekly hours" action={<T v="small" color={c.muted}>{`${duration(weeklyMin)} / week`}</T>}>
          <Card padded={false} style={{ overflow: 'hidden' }}>
            {week.map((shifts, d) => (
              <View key={d}>
                {d > 0 && <Divider inset={space.lg} />}
                <DayEditor day={d} shifts={shifts} onChange={(s) => setDay(d, s)} />
              </View>
            ))}
          </Card>
          <T v="small" color={c.faint} style={{ marginTop: space.sm }}>Add a second shift to give a lunch break — nothing can be booked in the gap.</T>
        </Section>

        <Section title="Workload limits">
          <Card padded={false} style={{ overflow: 'hidden' }}>
            <NumberStepper label="Max sessions a day" sub={maxSessions ? 'Online booking stops after this' : 'No daily cap'}
              value={maxSessions} display={maxSessions ? String(maxSessions) : 'No limit'} onChange={setMaxSessions} min={0} max={15} />
            <Divider inset={space.lg} />
            <NumberStepper label="Max continuous work" sub={maxHours ? 'Then a break is required' : 'No limit'}
              value={maxHours} display={maxHours ? `${maxHours} hr` : 'No limit'} onChange={setMaxHours} step={0.5} min={0} max={8} />
            {maxHours > 0 && (
              <>
                <Divider inset={space.lg} />
                <View style={{ padding: space.lg, paddingTop: space.md }}>
                  <T v="bodyStrong" style={{ marginBottom: space.sm }}>Break length</T>
                  <View style={styles.wrap}>
                    {BREAKS.map((b) => <Chip key={b} label={`${b} min`} selected={minBreak === b} onPress={() => setMinBreak(b)} />)}
                  </View>
                </View>
              </>
            )}
          </Card>
          <T v="small" color={c.faint} style={{ marginTop: space.sm }}>
            {maxHours
              ? `Stops back-to-back bookings beyond ${maxHours}h without a ${minBreak}-minute break. Staff can still override.`
              : 'Protect your team from burnout: cap sessions and require breaks between long runs.'}
          </T>
        </Section>

        {!isNew && <CustomHours therapistId={Number(id)} week={week} onConflicts={(list) => handleConflicts(list, () => {})} />}
        {!isNew && <TimeOff therapistId={Number(id)} onConflicts={(list) => handleConflicts(list, () => {})} />}
        {!isNew && <Button title="Remove therapist" kind="ghost" style={{ marginTop: space.xl }} onPress={remove} />}
      </ScrollView>
      <View style={[styles.bottom, { paddingBottom: insets.bottom + space.md, borderTopColor: c.border }]}>
        <Button title={isNew ? 'Add therapist' : 'Save changes'} onPress={save} loading={saving} />
      </View>
      <ConflictSheet conflicts={conflicts} onClose={() => { setConflicts(null); const next = afterConflicts; setAfterConflicts(null); next?.(); }} />
    </KeyboardAvoidingView>
  );
}

// ---------- one weekday: toggle + list of shifts ----------
function DayEditor({ day, shifts, onChange }: { day: number; shifts: Shift[]; onChange: (s: Shift[]) => void }) {
  const c = useColors();
  const on = shifts.length > 0;
  const update = (i: number, patch: Partial<Shift>) => onChange(shifts.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const add = () => { const n = nextShift(shifts); if (n) { tap(); onChange([...shifts, n]); } };
  const canAdd = !!nextShift(shifts);
  return (
    <View style={styles.dayBlock}>
      <View style={styles.dayHead}>
        <Pressable onPress={() => { tap(); onChange(on ? [] : [{ ...DEFAULT_SHIFT }]); }} style={styles.dayToggle}
          accessibilityRole="switch" accessibilityState={{ checked: on }} accessibilityLabel={`Works ${WEEKDAYS[day]}`}>
          <View style={[styles.checkbox, { borderColor: on ? c.accent : c.border, backgroundColor: on ? c.accent : 'transparent' }]}>
            {on && <Ionicons name="checkmark" size={14} color={c.onAccent} />}
          </View>
          <T v="bodyStrong" color={on ? c.text : c.faint}>{WEEKDAYS[day]}</T>
        </Pressable>
        {on ? (
          <T v="small" color={c.muted}>{duration(shifts.reduce((n, s) => n + Math.max(0, s.end - s.start), 0))}</T>
        ) : <T v="small" color={c.faint}>Day off</T>}
      </View>
      {shifts.map((s, i) => (
        <View key={i}>
          {i > 0 && (
            <View style={styles.breakRow}>
              <View style={[styles.breakLine, { backgroundColor: c.border }]} />
              <T v="caption" color={s.start > shifts[i - 1].end ? c.faint : c.danger}>
                {s.start > shifts[i - 1].end ? `BREAK ${duration(s.start - shifts[i - 1].end).toUpperCase()}` : 'OVERLAPS'}
              </T>
              <View style={[styles.breakLine, { backgroundColor: c.border }]} />
            </View>
          )}
          <View style={styles.shiftRow}>
            <TimeStepper label="Start" value={s.start} onChange={(v) => update(i, { start: v })} />
            <T v="small" color={c.faint}>–</T>
            <TimeStepper label="End" value={s.end} onChange={(v) => update(i, { end: v })} />
            {shifts.length > 1 ? (
              <Pressable onPress={() => { tap(); onChange(shifts.filter((_, j) => j !== i)); }} hitSlop={8} accessibilityLabel="Remove shift" style={styles.removeBtn}>
                <Ionicons name="close-circle" size={20} color={c.faint} />
              </Pressable>
            ) : <View style={styles.removeBtn} />}
          </View>
        </View>
      ))}
      {on && canAdd && (
        <Pressable onPress={add} style={styles.addShift} accessibilityRole="button" accessibilityLabel={`Add shift on ${WEEKDAYS[day]}`}>
          <Ionicons name="add" size={16} color={c.accentStrong} />
          <T v="small" color={c.accentStrong} style={{ fontWeight: '600' }}>Add shift</T>
        </Pressable>
      )}
    </View>
  );
}

// ---------- shared date picker strip ----------
function DateStrip({ dates, value, onPick, marked }: { dates: string[]; value: string | null; onPick: (d: string) => void; marked?: Set<string> }) {
  const c = useColors();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: space.lg }}>
      {dates.map((d) => {
        const on = d === value;
        return (
          <Pressable key={d} onPress={() => { tap(); onPick(d); }} accessibilityLabel={fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric' })}
            style={[styles.dateChip, { backgroundColor: on ? c.accent : c.surface, borderColor: on ? c.accent : c.border }]}>
            <Text style={[type.caption, { color: on ? c.onAccent : c.muted }]}>{fmtDate(d, { weekday: 'short' }).toUpperCase()}</Text>
            <Text style={{ fontSize: 18, fontWeight: '700', color: on ? c.onAccent : c.text }}>{parseDate(d).getDate()}</Text>
            <Text style={[type.caption, { color: on ? c.onAccent : c.faint, fontWeight: '500' }]}>{fmtDate(d, { month: 'short' })}</Text>
            {marked?.has(d) && <View style={[styles.dot, { backgroundColor: on ? c.onAccent : c.warn }]} />}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// ---------- custom hours for specific dates ----------
function CustomHours({ therapistId, week, onConflicts }: { therapistId: number; week: Shift[][]; onConflicts: (list: Conflict[]) => void }) {
  const c = useColors();
  const q = useApi<{ overrides: Override[] }>(`/api/therapists/${therapistId}/overrides`);
  const stats = useApi<Stats>('/api/stats');
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<Shift[]>([]);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const today = stats.data?.today;
  const dates = today ? Array.from({ length: 60 }, (_, i) => addDays(today, i)) : [];
  const existing = new Set((q.data?.overrides ?? []).map((o) => o.date));

  function pickDate(d: string) {
    setDate(d);
    const found = q.data?.overrides.find((o) => o.date === d);
    if (found) { setBlocks(found.blocks.map((b) => ({ start: b.startMin, end: b.endMin }))); setNote(found.note); return; }
    const normal = week[parseDate(d).getDay()];
    setBlocks(normal.length ? normal.map((s) => ({ ...s })) : [{ ...DEFAULT_SHIFT }]);
  }

  function openFor(d?: string) { setError(null); setNote(''); setDate(null); setBlocks([]); if (d) pickDate(d); setOpen(true); }

  async function save(clear = false, forDate = date) {
    if (!forDate) return setError('Pick a date');
    if (!clear) { const msg = validateDay(blocks, 'Hours'); if (msg) return setError(msg); }
    setSaving(true);
    try {
      const res = await api<{ conflicts?: Conflict[] }>(`/api/therapists/${therapistId}/overrides/${forDate}`, {
        method: 'PUT', body: { blocks: clear ? [] : blocks.map((b) => ({ startMin: b.start, endMin: b.end })), note },
      });
      setOpen(false); setSaving(false);
      q.reload();
      if (res.conflicts?.length) onConflicts(res.conflicts);
    } catch (e: any) { setError(e.message); setSaving(false); }
  }

  return (
    <Section title="Custom hours" action={<Button title="Add" size="sm" kind="ghost" icon="add" onPress={() => openFor()} />}>
      <Card padded={false} style={{ overflow: 'hidden' }}>
        {q.data?.overrides.length ? q.data.overrides.map((o, i) => (
          <View key={o.date}>
            {i > 0 && <Divider inset={space.lg} />}
            <Pressable onPress={() => openFor(o.date)} style={styles.listRow} accessibilityRole="button">
              <View style={[styles.iconBox, { backgroundColor: c.accentSoft }]}><Ionicons name="calendar" size={18} color={c.accentStrong} /></View>
              <View style={{ flex: 1 }}>
                <T v="bodyStrong">{fmtDate(o.date, { weekday: 'short', month: 'short', day: 'numeric' })}</T>
                <T v="small" color={c.muted}>{[o.blocks.map((b) => `${time(b.startMin)}–${time(b.endMin)}`).join(', '), o.note].filter(Boolean).join(' · ')}</T>
              </View>
              <IconButton icon="trash-outline" label="Back to normal hours" color={c.danger} bg={c.dangerSoft} size={34} onPress={() => save(true, o.date)} />
            </Pressable>
          </View>
        )) : <T v="small" color={c.muted} style={{ padding: space.lg }}>Working a different shift on a specific day? Set custom hours — they replace the weekly hours for that date.</T>}
      </Card>

      <Sheet visible={open} onClose={() => setOpen(false)} title="Custom hours">
        <ErrorBanner message={error} />
        <T v="small" color={c.muted} style={{ marginBottom: space.sm, fontWeight: '600' }}>Date</T>
        <DateStrip dates={dates} value={date} onPick={pickDate} marked={existing} />
        {date && (
          <>
            <T v="small" color={c.muted} style={{ marginBottom: space.sm, fontWeight: '600' }}>
              {`Hours on ${fmtDate(date, { weekday: 'long' })} (normally ${week[parseDate(date).getDay()].length ? week[parseDate(date).getDay()].map((s) => `${time(s.start)}–${time(s.end)}`).join(', ') : 'off'})`}
            </T>
            <View style={{ gap: space.sm, marginBottom: space.md }}>
              {blocks.map((b, i) => (
                <View key={i} style={styles.shiftRow}>
                  <TimeStepper label="Start" value={b.start} onChange={(v) => setBlocks(blocks.map((x, j) => (j === i ? { ...x, start: v } : x)))} />
                  <T v="small" color={c.faint}>–</T>
                  <TimeStepper label="End" value={b.end} onChange={(v) => setBlocks(blocks.map((x, j) => (j === i ? { ...x, end: v } : x)))} />
                  {blocks.length > 1 ? (
                    <Pressable onPress={() => setBlocks(blocks.filter((_, j) => j !== i))} hitSlop={8} accessibilityLabel="Remove block" style={styles.removeBtn}>
                      <Ionicons name="close-circle" size={20} color={c.faint} />
                    </Pressable>
                  ) : <View style={styles.removeBtn} />}
                </View>
              ))}
              {nextShift(blocks) && (
                <Pressable onPress={() => setBlocks([...blocks, nextShift(blocks)!])} style={[styles.addShift, { paddingLeft: 0 }]} accessibilityRole="button">
                  <Ionicons name="add" size={16} color={c.accentStrong} />
                  <T v="small" color={c.accentStrong} style={{ fontWeight: '600' }}>Add block</T>
                </Pressable>
              )}
            </View>
            <Field label="Note (optional)" value={note} onChangeText={setNote} placeholder="e.g. Covering evening shift" />
          </>
        )}
        <Button title="Save custom hours" onPress={() => save(false)} disabled={!date} loading={saving} />
        <T v="small" color={c.faint} center style={{ marginTop: space.sm }}>To give a full day off, use Time off instead.</T>
      </Sheet>
    </Section>
  );
}

// ---------- time off ----------
function TimeOff({ therapistId, onConflicts }: { therapistId: number; onConflicts: (list: Conflict[]) => void }) {
  const c = useColors();
  const q = useApi<{ timeOff: { id: number; date: string; startMin: number; endMin: number; reason: string }[] }>(`/api/therapists/${therapistId}/time-off`);
  const stats = useApi<Stats>('/api/stats');
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState<string | null>(null);
  const [days, setDays] = useState(1);
  const [allDay, setAllDay] = useState(true);
  const [start, setStart] = useState(12 * 60);
  const [end, setEnd] = useState(14 * 60);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const today = stats.data?.today;
  const choices = today ? Array.from({ length: 90 }, (_, i) => addDays(today, i)) : [];

  async function add() {
    if (!from) return setError('Pick a start date');
    if (!allDay && end <= start) return setError('Time off must end after it starts');
    try {
      const res = await api<{ created: number; conflicts?: Conflict[] }>(`/api/therapists/${therapistId}/time-off`, {
        method: 'POST',
        body: { date: from, endDate: addDays(from, days - 1), reason, ...(allDay ? {} : { startMin: start, endMin: end }) },
      });
      setOpen(false); setFrom(null); setDays(1); setReason(''); setError(null); setAllDay(true);
      q.reload();
      tap('success');
      if (res.conflicts?.length) onConflicts(res.conflicts);
    } catch (e: any) { setError(e.message); }
  }

  return (
    <Section title="Time off" action={<Button title="Add" size="sm" kind="ghost" icon="add" onPress={() => { setError(null); setOpen(true); }} />}>
      <Card padded={false} style={{ overflow: 'hidden' }}>
        {q.data?.timeOff.length ? q.data.timeOff.map((o, i) => (
          <View key={o.id}>
            {i > 0 && <Divider inset={space.lg} />}
            <View style={styles.listRow}>
              <View style={[styles.iconBox, { backgroundColor: c.warnSoft }]}><Ionicons name="airplane" size={18} color={c.warn} /></View>
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
        <DateStrip dates={choices} value={from} onPick={setFrom} />
        <View style={styles.daysRow}>
          <T v="bodyStrong" style={{ flex: 1 }}>{`${days} day${days === 1 ? '' : 's'}${from && days > 1 ? ` · until ${fmtDate(addDays(from, days - 1), { month: 'short', day: 'numeric' })}` : ''}`}</T>
          <IconButton icon="remove" label="Fewer days" onPress={() => setDays(Math.max(1, days - 1))} />
          <IconButton icon="add" label="More days" onPress={() => setDays(Math.min(60, days + 1))} />
        </View>
        <View style={[styles.daysRow, { justifyContent: 'space-between' }]}>
          <T v="bodyStrong">All day</T>
          <Switch value={allDay} onValueChange={setAllDay} trackColor={{ true: c.accent, false: c.border }} thumbColor="#fff" accessibilityLabel="All day" />
        </View>
        {!allDay && (
          <View style={[styles.shiftRow, { marginBottom: space.lg }]}>
            <TimeStepper label="From" value={start} onChange={setStart} />
            <T v="small" color={c.faint}>–</T>
            <TimeStepper label="Until" value={end} onChange={setEnd} />
          </View>
        )}
        <Field label="Reason (optional)" value={reason} onChangeText={setReason} placeholder="Vacation, training, sick…" />
        <Button title="Add time off" onPress={add} disabled={!from} />
        <T v="small" color={c.faint} center style={{ marginTop: space.sm }}>We'll show any bookings that clash so you can move them.</T>
      </Sheet>
    </Section>
  );
}

const styles = StyleSheet.create({
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  dayBlock: { paddingHorizontal: space.lg, paddingVertical: space.sm },
  dayHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  dayToggle: { flexDirection: 'row', alignItems: 'center', gap: space.sm, height: 44, flex: 1 },
  checkbox: { width: 22, height: 22, borderRadius: 7, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  shiftRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  removeBtn: { width: 28, alignItems: 'center', justifyContent: 'center' },
  breakRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 2, paddingRight: 34 },
  breakLine: { flex: 1, height: StyleSheet.hairlineWidth },
  addShift: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: space.sm, alignSelf: 'flex-start' },
  listRow: { flexDirection: 'row', alignItems: 'center', padding: space.lg, gap: space.md },
  iconBox: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  dateChip: { width: 58, height: 78, borderRadius: radius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 5, height: 5, borderRadius: 3, marginTop: 2 },
  daysRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.lg },
  bottom: { paddingHorizontal: space.lg, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth },
});
