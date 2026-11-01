import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, ApiError, qs } from '@/lib/api';
import { addDays, duration, fmtDate, money, parseDate, time } from '@/lib/format';
import { radius, space, useColors } from '@/lib/theme';
import type { Appointment, Business, Client, Issue, Service, Slot, Therapist } from '@/lib/types';

import { SlotPicker, type DayAvail } from './bk-slot-picker';
import { Avatar, Button, Card, Empty, ErrorBanner, Field, IconButton, Ionicons, Loading, T, tap } from './ui';

type Step = 'service' | 'therapist' | 'time' | 'details';
const STEPS: Step[] = ['service', 'therapist', 'time', 'details'];

interface PublicInfo { business: Business; services: Service[]; therapists: Therapist[]; today: string }
export interface BookedResult { appointment: Appointment; manageToken?: string; business: Business }

export interface BookingInitial {
  serviceId?: number;
  therapistId?: number;
  date?: string;
  startMin?: number;
  client?: Partial<Client>;
}

/** Availability fetchers: staff see every rule-abiding time; clients also get lead time + booking window. */
function makeFetchers(slug: string, mode: 'public' | 'staff', serviceId: number, therapistId: number | null) {
  const base = mode === 'staff' ? '/api/staff' : `/api/public/${encodeURIComponent(slug)}`;
  return {
    fetchDays: (from: string, count: number) =>
      api<{ days: DayAvail[] }>(`${base}/days?${qs({ serviceId, therapistId, from, count })}`).then((r) => r.days),
    fetchSlots: (date: string) =>
      api<{ slots: Slot[] }>(`${base}/slots?${qs({ serviceId, therapistId, date })}`).then((r) => r.slots),
  };
}

export function BookingFlow({ slug, mode, onClose, onBooked, initial }: {
  slug: string;
  mode: 'public' | 'staff';
  onClose?: () => void;
  onBooked: (r: BookedResult) => void;
  initial?: BookingInitial;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [info, setInfo] = useState<PublicInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('service');
  const [service, setService] = useState<Service | null>(null);
  const [therapist, setTherapist] = useState<Therapist | null>(null); // null = any
  const [date, setDate] = useState<string | null>(initial?.date ?? null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [checking, setChecking] = useState(false);
  // When the flow was opened from a tapped time slot, the service list is limited to that therapist.
  const [pinned, setPinned] = useState<{ therapist: Therapist; date: string; startMin: number } | null>(null);
  const started = useRef(false);

  useEffect(() => {
    api<PublicInfo>(`/api/public/${encodeURIComponent(slug)}`).then(setInfo).catch((e) => setLoadError(e.message));
  }, [slug]);

  // Jump to the furthest step the initial values allow.
  useEffect(() => {
    if (!info || started.current) return;
    started.current = true;
    const s = info.services.find((x) => x.id === initial?.serviceId) ?? null;
    const t = info.therapists.find((x) => x.id === initial?.therapistId) ?? null;
    const hasTime = !!initial?.date && Number.isInteger(initial?.startMin);
    if (s) setService(s);
    if (t) setTherapist(t);
    if (s && t && hasTime) {
      setSlot({ startMin: initial!.startMin!, therapistIds: [t.id] });
      setStep('details');
    } else if (!s && t && hasTime) {
      setPinned({ therapist: t, date: initial!.date!, startMin: initial!.startMin! });
      setStep('service');
    } else if (s && t) {
      setStep('time');
    } else if (s) {
      setStep('therapist');
    }
  }, [info, initial]);

  const stepIndex = STEPS.indexOf(step);
  const back = () => {
    if (stepIndex === 0) onClose?.();
    else setStep(STEPS[stepIndex - 1]);
  };

  async function pickService(s: Service) {
    setService(s);
    setSlot(null);
    if (!pinned) { setTherapist(null); setStep('therapist'); return; }
    // Opened from an empty timeline slot: go straight to details if that time still works.
    setTherapist(pinned.therapist);
    setDate(pinned.date);
    if (mode !== 'staff') { setStep('time'); return; }
    setChecking(true);
    try {
      const r = await api<{ ok: boolean }>(`/api/staff/check?${qs({ serviceId: s.id, therapistId: pinned.therapist.id, date: pinned.date, startMin: pinned.startMin })}`);
      if (r.ok) {
        setSlot({ startMin: pinned.startMin, therapistIds: [pinned.therapist.id] });
        setStep('details');
      } else {
        setStep('time');
      }
    } catch {
      setStep('time');
    } finally {
      setChecking(false);
    }
  }

  if (loadError) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, padding: space.lg, paddingTop: insets.top + space.lg }}>
        <ErrorBanner message={loadError} />
        {onClose && <Button kind="secondary" title="Close" onPress={onClose} />}
      </View>
    );
  }
  if (!info) return <Loading />;

  const serviceList = pinned ? info.services.filter((s) => pinned.therapist.serviceIds.includes(s.id)) : info.services;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={[styles.top, { paddingTop: insets.top + space.sm, backgroundColor: c.bg }]}>
        <View style={styles.topRow}>
          {stepIndex === 0 && !onClose ? <View style={{ width: 40 }} /> : (
            <IconButton icon={stepIndex === 0 ? 'close' : 'chevron-back'} label={stepIndex === 0 ? 'Close' : 'Back'} onPress={back} />
          )}
          <View style={{ flex: 1, alignItems: 'center' }}>
            <T v="caption" color={c.muted} numberOfLines={1}>{mode === 'public' ? info.business.name.toUpperCase() : 'NEW BOOKING'}</T>
            <T v="bodyStrong">{`Step ${stepIndex + 1} of 4`}</T>
          </View>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.progress}>
          {STEPS.map((s, i) => <View key={s} style={[styles.progressSeg, { backgroundColor: i <= stepIndex ? c.accent : c.border }]} />)}
        </View>
      </View>

      {step === 'service' && (
        <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl }}>
          <T v="title">{mode === 'staff' ? 'Choose a service' : 'Choose a treatment'}</T>
          {pinned ? (
            <View style={[styles.pinned, { backgroundColor: c.accentSoft }]}>
              <Ionicons name="time-outline" size={18} color={c.accentStrong} />
              <T v="small" color={c.accentStrong} style={{ flex: 1, fontWeight: '600' }}>
                {`${pinned.therapist.name} · ${fmtDate(pinned.date)} · ${time(pinned.startMin)}`}
              </T>
              <Pressable onPress={() => { tap(); setPinned(null); }} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear selected time">
                <Ionicons name="close-circle" size={20} color={c.accentStrong} />
              </Pressable>
            </View>
          ) : <View style={{ height: space.lg }} />}
          {checking && <ActivityIndicator color={c.accent} style={{ marginBottom: space.md }} />}
          {serviceList.length === 0 && <Empty icon="leaf-outline" title="No services yet" body={mode === 'staff' ? 'Add services and assign them to your team first.' : 'Online booking isn’t set up for this studio yet.'} />}
          <View style={{ gap: space.md }}>
            {serviceList.map((s) => (
              <Card key={s.id} onPress={() => !checking && pickService(s)}>
                <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }}>
                  <View style={{ flex: 1 }}>
                    <T v="bodyStrong">{s.name}</T>
                    {s.description ? <T v="small" color={c.muted} style={{ marginTop: 4 }} numberOfLines={2}>{s.description}</T> : null}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.sm }}>
                      <Ionicons name="time-outline" size={15} color={c.muted} />
                      <T v="small" color={c.muted}>{duration(s.durationMin)}</T>
                    </View>
                  </View>
                  <T v="heading" color={c.accentStrong}>{money(s.priceCents, info.business.currency)}</T>
                </View>
              </Card>
            ))}
          </View>
        </ScrollView>
      )}

      {step === 'therapist' && service && (
        <TherapistStep info={info} service={service} onPick={(t) => { setTherapist(t); setSlot(null); setStep('time'); }} />
      )}

      {step === 'time' && service && (
        <TimeStep
          slug={slug}
          mode={mode}
          info={info}
          service={service}
          therapist={therapist}
          initialDate={date}
          onPick={(s, d) => { setDate(d); setSlot(s); setStep('details'); }}
        />
      )}

      {step === 'details' && service && date && slot && (
        <DetailsStep
          slug={slug}
          mode={mode}
          info={info}
          service={service}
          therapist={therapist}
          date={date}
          slot={slot}
          initialClient={initial?.client}
          onPickAnother={() => { setSlot(null); setStep('time'); }}
          onBooked={onBooked}
        />
      )}
    </View>
  );
}

// ---------- therapist ----------
function TherapistStep({ info, service, onPick }: { info: PublicInfo; service: Service; onPick: (t: Therapist | null) => void }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const options = info.therapists.filter((t) => t.serviceIds.includes(service.id));
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl }}>
      <T v="title">Choose a therapist</T>
      <T v="small" color={c.muted} style={{ marginTop: 4, marginBottom: space.lg }}>{service.name}</T>
      <View style={{ gap: space.md }}>
        {options.length > 1 && (
          <Card onPress={() => onPick(null)}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="sparkles" size={22} color={c.accentStrong} />
              </View>
              <View style={{ flex: 1 }}>
                <T v="bodyStrong">No preference</T>
                <T v="small" color={c.muted}>See the most available times</T>
              </View>
              <Ionicons name="chevron-forward" size={18} color={c.faint} />
            </View>
          </Card>
        )}
        {options.map((t) => (
          <Card key={t.id} onPress={() => onPick(t)}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <Avatar name={t.name} seed={t.id} size={52} />
              <View style={{ flex: 1 }}>
                <T v="bodyStrong">{t.name}</T>
                {t.bio ? <T v="small" color={c.muted} numberOfLines={2}>{t.bio}</T> : null}
              </View>
              <Ionicons name="chevron-forward" size={18} color={c.faint} />
            </View>
          </Card>
        ))}
        {options.length === 0 && <Empty icon="person-outline" title="Nobody offers this yet" body="Assign this service to a therapist first." />}
      </View>
    </ScrollView>
  );
}

// ---------- date & time ----------
function TimeStep({ slug, mode, info, service, therapist, initialDate, onPick }: {
  slug: string; mode: 'public' | 'staff'; info: PublicInfo; service: Service; therapist: Therapist | null;
  initialDate: string | null; onPick: (s: Slot, date: string) => void;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const f = useMemo(() => makeFetchers(slug, mode, service.id, therapist?.id ?? null), [slug, mode, service.id, therapist?.id]);
  const options = info.therapists.filter((t) => t.serviceIds.includes(service.id));
  // Custom times need a specific therapist; "any" falls back to the first who offers the service.
  const customFor = therapist ?? options[0] ?? null;
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl }}>
      <T v="title">Pick a time</T>
      <T v="small" color={c.muted} style={{ marginTop: 4, marginBottom: space.xl }}>
        {`${service.name} · ${therapist ? therapist.name : 'Any therapist'}`}
      </T>
      <SlotPicker
        today={info.today}
        lastDay={mode === 'public' ? addDays(info.today, info.business.bookingWindowDays) : undefined}
        reloadKey={`${service.id}-${therapist?.id ?? 'any'}`}
        initialDate={initialDate}
        fetchDays={f.fetchDays}
        fetchSlots={f.fetchSlots}
        onPick={onPick}
        custom={mode === 'staff' && customFor ? {
          hint: `For ${customFor.name}. If it breaks a scheduling rule you'll be asked to confirm.`,
          onPick: (d, m) => onPick({ startMin: m, therapistIds: [customFor.id] }, d),
        } : undefined}
      />
    </ScrollView>
  );
}

// ---------- details & confirm ----------
function DetailsStep({ slug, mode, info, service, therapist, date, slot, initialClient, onPickAnother, onBooked }: {
  slug: string; mode: 'public' | 'staff'; info: PublicInfo; service: Service; therapist: Therapist | null;
  date: string; slot: Slot; initialClient?: Partial<Client>; onPickAnother: () => void; onBooked: (r: BookedResult) => void;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(initialClient?.name ?? '');
  const [email, setEmail] = useState(initialClient?.email ?? '');
  const [phone, setPhone] = useState(initialClient?.phone ?? '');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [matches, setMatches] = useState<Client[]>([]);
  // Staff pre-check: which room it lands in, and any rule warnings before they hit Book.
  const [check, setCheck] = useState<{ roomName: string | null; soft: Issue[]; hard: Issue[] } | null>(null);
  const [warning, setWarning] = useState<Issue[] | null>(null);

  const staffTherapistId = therapist?.id ?? slot.therapistIds[0];
  const assigned = info.therapists.find((t) => t.id === staffTherapistId) ?? null;
  const cur = info.business.currency;

  useEffect(() => {
    if (mode !== 'staff') return;
    let live = true;
    Promise.all([
      api<{ ok: boolean; roomId: number | null; soft: Issue[]; hard: Issue[] }>(`/api/staff/check?${qs({ serviceId: service.id, therapistId: staffTherapistId, date, startMin: slot.startMin })}`),
      api<{ rooms: { id: number; name: string }[] }>('/api/rooms').catch(() => ({ rooms: [] })),
    ]).then(([r, rooms]) => {
      if (!live) return;
      setCheck({ roomName: rooms.rooms.find((x) => x.id === r.roomId)?.name ?? null, soft: r.soft, hard: r.hard });
    }).catch(() => {});
    return () => { live = false; };
  }, [mode, service.id, staffTherapistId, date, slot.startMin]);

  // Staff: suggest existing clients while typing a name.
  useEffect(() => {
    if (mode !== 'staff' || name.trim().length < 2 || email) { setMatches([]); return; }
    const t = setTimeout(() => {
      api<{ clients: Client[] }>(`/api/clients?${qs({ q: name.trim() })}`).then((r) => setMatches(r.clients.slice(0, 4))).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [mode, name, email]);

  async function submit(override = false) {
    setError(null);
    if (!name.trim()) return setError('Please enter a name');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('Please enter a valid email');
    if (mode === 'public' && !phone.trim()) return setError('Please enter a phone number');
    setSaving(true);
    try {
      let res: BookedResult;
      if (mode === 'public') {
        res = await api(`/api/public/${encodeURIComponent(slug)}/book`, {
          method: 'POST',
          body: { serviceId: service.id, therapistId: therapist?.id ?? null, date, startMin: slot.startMin, name, email, phone, notes },
        });
      } else {
        const r = await api<{ appointment: Appointment }>('/api/appointments', {
          method: 'POST',
          body: { serviceId: service.id, therapistId: staffTherapistId, date, startMin: slot.startMin, name, email, phone, notes, ...(override ? { override: true } : {}) },
        });
        res = { appointment: r.appointment, business: info.business };
      }
      tap('success');
      onBooked(res);
    } catch (e: any) {
      setSaving(false);
      if (e instanceof ApiError && e.canOverride && mode === 'staff') {
        setWarning(e.data.issues ?? [{ code: 'rule', message: e.message }]);
        return;
      }
      setError(e.message);
      if (e.status === 409) setTimeout(onPickAnother, 1800);
    }
  }

  const softNow = mode === 'staff' && check?.soft.length ? check.soft : null;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl }} keyboardShouldPersistTaps="handled">
        <T v="title" style={{ marginBottom: space.lg }}>{mode === 'staff' ? 'Client details' : 'Your details'}</T>

        <Card style={{ marginBottom: space.lg }}>
          <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
            <View style={[styles.dateBadge, { backgroundColor: c.accentSoft }]}>
              <T v="caption" color={c.accentStrong}>{fmtDate(date, { month: 'short' }).toUpperCase()}</T>
              <T v="title" color={c.accentStrong} style={{ lineHeight: 28 }}>{String(parseDate(date).getDate())}</T>
            </View>
            <View style={{ flex: 1 }}>
              <T v="bodyStrong" numberOfLines={1}>{service.name}</T>
              <T v="small" color={c.muted}>{`${fmtDate(date, { weekday: 'long' })} · ${time(slot.startMin)} – ${time(slot.startMin + service.durationMin)}`}</T>
              <T v="small" color={c.muted}>
                {therapist ? `with ${therapist.name}` : mode === 'staff' && assigned ? `with ${assigned.name}` : 'First available therapist'}
                {mode === 'staff' && check?.roomName ? ` · ${check.roomName}` : ''}
              </T>
            </View>
            <Pressable onPress={() => { tap(); onPickAnother(); }} hitSlop={8} accessibilityRole="button" accessibilityLabel="Change time">
              <T v="small" color={c.accentStrong} style={{ fontWeight: '700' }}>Change</T>
            </Pressable>
          </View>
          <View style={[styles.totalRow, { borderTopColor: c.border }]}>
            <T v="small" color={c.muted}>Total</T>
            <T v="bodyStrong">{money(service.priceCents, cur)}</T>
          </View>
        </Card>

        {softNow && !warning && (
          <View style={[styles.heads, { backgroundColor: c.warnSoft }]}>
            <Ionicons name="alert-circle-outline" size={18} color={c.warn} />
            <View style={{ flex: 1 }}>
              <T v="small" color={c.warn} style={{ fontWeight: '700' }}>Heads up</T>
              {softNow.map((i) => <T key={i.code} v="small" color={c.warn}>{i.message}</T>)}
            </View>
          </View>
        )}
        {mode === 'staff' && check?.hard.length ? <ErrorBanner message={check.hard.map((i) => i.message).join('. ')} /> : null}

        <ErrorBanner message={error} />
        <Field label="Full name" value={name} onChangeText={setName} autoComplete="name" textContentType="name" placeholder="Jane Smith" returnKeyType="next" />
        {matches.length > 0 && (
          <View style={{ marginTop: -space.sm, marginBottom: space.lg, gap: space.sm }}>
            <T v="small" color={c.muted}>Existing clients</T>
            {matches.map((m) => (
              <Pressable key={m.id} onPress={() => { tap(); setName(m.name); setEmail(m.email); setPhone(m.phone); setMatches([]); }}
                style={({ pressed }) => [styles.match, { backgroundColor: pressed ? c.surface2 : c.surface, borderColor: c.border }]}>
                <Avatar name={m.name} seed={m.id} size={32} />
                <View style={{ flex: 1 }}><T v="bodyStrong">{m.name}</T><T v="small" color={c.muted}>{m.email}</T></View>
                <Ionicons name="arrow-up-circle-outline" size={20} color={c.accent} />
              </Pressable>
            ))}
          </View>
        )}
        <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" placeholder="jane@example.com" />
        <Field label={mode === 'staff' ? 'Phone (optional)' : 'Phone'} value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" placeholder="(555) 123-4567" />
        <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline placeholder="Injuries, focus areas, pressure preference…" />
        {mode === 'public' && info.business.cancelCutoffHours > 0 && (
          <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
            <Ionicons name="shield-checkmark-outline" size={18} color={c.accent} />
            <T v="small" color={c.muted} style={{ flex: 1 }}>{`Free cancellation up to ${info.business.cancelCutoffHours} hours before.`}</T>
          </View>
        )}
      </ScrollView>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + space.md, backgroundColor: c.bg, borderTopColor: c.border }]}>
        {warning ? (
          <OverrideCard issues={warning} loading={saving} confirmLabel="Book anyway"
            onConfirm={() => submit(true)} onCancel={() => { setWarning(null); onPickAnother(); }} />
        ) : (
          <Button
            title={mode === 'staff' ? (softNow ? 'Book anyway' : 'Create booking') : `Confirm · ${money(service.priceCents, cur)}`}
            onPress={() => submit(!!softNow)}
            loading={saving}
          />
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

/** Warning shown when a booking breaks a soft rule (outside hours, time off, limits). */
export function OverrideCard({ issues, onConfirm, onCancel, loading, confirmLabel, cancelLabel = 'Pick another time' }: {
  issues: Issue[]; onConfirm: () => void; onCancel: () => void; loading?: boolean; confirmLabel: string; cancelLabel?: string;
}) {
  const c = useColors();
  return (
    <View style={{ gap: space.sm }}>
      <View style={[styles.heads, { backgroundColor: c.warnSoft, marginBottom: 0 }]}>
        <Ionicons name="warning-outline" size={20} color={c.warn} />
        <View style={{ flex: 1, gap: 2 }}>
          <T v="bodyStrong" color={c.warn}>This breaks a scheduling rule</T>
          {issues.map((i) => <T key={i.code} v="small" color={c.warn}>{`• ${i.message}`}</T>)}
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Button title={cancelLabel} kind="secondary" size="md" style={{ flex: 1 }} onPress={onCancel} />
        <Button title={confirmLabel} size="md" style={{ flex: 1 }} loading={loading} onPress={onConfirm} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { paddingHorizontal: space.lg, paddingBottom: space.sm },
  topRow: { flexDirection: 'row', alignItems: 'center' },
  progress: { flexDirection: 'row', gap: 6, marginTop: space.md },
  progressSeg: { flex: 1, height: 4, borderRadius: 2 },
  pinned: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md, marginTop: space.md, marginBottom: space.lg },
  dateBadge: { width: 58, height: 64, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space.md, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth },
  heads: { flexDirection: 'row', gap: space.sm, padding: space.md, borderRadius: radius.md, marginBottom: space.lg },
  match: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: 1 },
  bottomBar: { paddingHorizontal: space.lg, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth },
});
