import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, qs } from '@/lib/api';
import { addDays, duration, fmtDate, fmtDateLong, money, parseDate, time } from '@/lib/format';
import { radius, space, type, useColors } from '@/lib/theme';
import type { Appointment, Business, Client, Service, Slot, Therapist } from '@/lib/types';

import { Avatar, Button, Card, Empty, ErrorBanner, Field, IconButton, Ionicons, Loading, T, tap } from './ui';

type Step = 'service' | 'therapist' | 'time' | 'details';
const STEPS: Step[] = ['service', 'therapist', 'time', 'details'];

interface PublicInfo { business: Business; services: Service[]; therapists: Therapist[]; today: string }
export interface BookedResult { appointment: Appointment; manageToken?: string; business: Business }

export function BookingFlow({ slug, mode, onClose, onBooked, initialClient }: {
  slug: string;
  mode: 'public' | 'staff';
  onClose?: () => void;
  onBooked: (r: BookedResult) => void;
  initialClient?: Partial<Client>;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [info, setInfo] = useState<PublicInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('service');
  const [service, setService] = useState<Service | null>(null);
  const [therapist, setTherapist] = useState<Therapist | null>(null); // null = any
  const [date, setDate] = useState<string | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);

  useEffect(() => {
    api<PublicInfo>(`/api/public/${encodeURIComponent(slug)}`).then(setInfo).catch((e) => setLoadError(e.message));
  }, [slug]);

  const stepIndex = STEPS.indexOf(step);
  const back = () => {
    if (stepIndex === 0) onClose?.();
    else setStep(STEPS[stepIndex - 1]);
  };

  if (loadError) return <View style={{ flex: 1, backgroundColor: c.bg, padding: space.lg, paddingTop: insets.top + space.lg }}><ErrorBanner message={loadError} />{onClose && <Button kind="secondary" title="Close" onPress={onClose} />}</View>;
  if (!info) return <Loading />;

  const titles: Record<Step, string> = {
    service: mode === 'staff' ? 'New booking' : 'Choose a treatment',
    therapist: 'Choose a therapist',
    time: 'Pick a time',
    details: mode === 'staff' ? 'Client details' : 'Your details',
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={[styles.top, { paddingTop: insets.top + space.sm, backgroundColor: c.bg }]}>
        <View style={styles.topRow}>
          {stepIndex === 0 && !onClose ? <View style={{ width: 40 }} /> : (
            <IconButton icon={stepIndex === 0 ? 'close' : 'chevron-back'} label={stepIndex === 0 ? 'Close' : 'Back'} onPress={back} />
          )}
          <View style={{ flex: 1, alignItems: 'center' }}>
            {mode === 'public' && <T v="caption" color={c.muted} numberOfLines={1}>{info.business.name.toUpperCase()}</T>}
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
          <T v="title" style={{ marginBottom: space.lg }}>{titles.service}</T>
          {info.services.length === 0 && <Empty icon="leaf-outline" title="No services yet" body="Online booking isn't set up for this studio yet." />}
          <View style={{ gap: space.md }}>
            {info.services.map((s) => (
              <Card key={s.id} onPress={() => { setService(s); setTherapist(null); setSlot(null); setStep('therapist'); }}>
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
        <TherapistStep
          info={info}
          service={service}
          title={titles.therapist}
          onPick={(t) => { setTherapist(t); setDate(null); setSlot(null); setStep('time'); }}
        />
      )}

      {step === 'time' && service && (
        <TimeStep
          slug={slug}
          info={info}
          service={service}
          therapist={therapist}
          date={date}
          setDate={setDate}
          onPick={(s) => { setSlot(s); setStep('details'); }}
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
          initialClient={initialClient}
          onTaken={() => { setSlot(null); setStep('time'); }}
          onBooked={onBooked}
        />
      )}
    </View>
  );
}

// ---------- therapist ----------
function TherapistStep({ info, service, title, onPick }: { info: PublicInfo; service: Service; title: string; onPick: (t: Therapist | null) => void }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const options = info.therapists.filter((t) => t.serviceIds.includes(service.id));
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl }}>
      <T v="title">{title}</T>
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
      </View>
    </ScrollView>
  );
}

// ---------- date & time ----------
const PAGE = 21;

function TimeStep({ slug, info, service, therapist, date, setDate, onPick }: {
  slug: string; info: PublicInfo; service: Service; therapist: Therapist | null;
  date: string | null; setDate: (d: string) => void; onPick: (s: Slot) => void;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [from, setFrom] = useState(info.today);
  const [days, setDays] = useState<{ date: string; available: number }[] | null>(null);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stripRef = useRef<ScrollViewInstance>(null);
  const lastDay = addDays(info.today, info.business.bookingWindowDays);

  useEffect(() => {
    setDays(null);
    api<{ days: { date: string; available: number }[] }>(`/api/public/${encodeURIComponent(slug)}/days?${qs({ serviceId: service.id, therapistId: therapist?.id, from, count: PAGE })}`)
      .then((r) => {
        const list = r.days.filter((d) => d.date <= lastDay);
        setDays(list);
        if (!date || !list.some((d) => d.date === date)) {
          const first = list.find((d) => d.available > 0) ?? list[0];
          if (first) setDate(first.date);
        }
      })
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, service.id, therapist?.id, from]);

  useEffect(() => {
    if (!date) return;
    setSlots(null);
    let live = true;
    api<{ slots: Slot[] }>(`/api/public/${encodeURIComponent(slug)}/slots?${qs({ serviceId: service.id, therapistId: therapist?.id, date })}`)
      .then((r) => { if (live) setSlots(r.slots); })
      .catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [slug, service.id, therapist?.id, date]);

  const groups = useMemo(() => {
    if (!slots) return [];
    return ([
      ['Morning', 'sunny-outline', (m: number) => m < 720],
      ['Afternoon', 'partly-sunny-outline', (m: number) => m >= 720 && m < 1020],
      ['Evening', 'moon-outline', (m: number) => m >= 1020],
    ] as const).map(([label, icon, test]) => ({ label, icon, items: slots.filter((s) => test(s.startMin)) })).filter((g) => g.items.length);
  }, [slots]);

  const monthLabel = days?.length ? fmtDate((date && days.some((d) => d.date === date)) ? date : days[0].date, { month: 'long', year: 'numeric' }) : '';

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + space.xxl }}>
      <View style={{ paddingHorizontal: space.lg, paddingTop: space.lg }}>
        <T v="title">Pick a time</T>
        <T v="small" color={c.muted} style={{ marginTop: 4 }}>
          {`${service.name} · ${therapist ? therapist.name : 'Any therapist'}`}
        </T>
        <ErrorBanner message={error} />
        <View style={[styles.monthRow]}>
          <T v="heading">{monthLabel}</T>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <IconButton icon="chevron-back" label="Earlier dates" size={36} onPress={() => from > info.today && setFrom(addDays(from, -PAGE) < info.today ? info.today : addDays(from, -PAGE))} color={from > info.today ? c.text : c.faint} />
            <IconButton icon="chevron-forward" label="Later dates" size={36} onPress={() => addDays(from, PAGE) <= lastDay && setFrom(addDays(from, PAGE))} color={addDays(from, PAGE) <= lastDay ? c.text : c.faint} />
          </View>
        </View>
      </View>

      <ScrollView ref={stripRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.sm, paddingVertical: 4 }}>
        {!days && <View style={{ height: 84, justifyContent: 'center' }}><ActivityIndicator color={c.accent} /></View>}
        {days?.map((d) => {
          const on = d.date === date;
          const off = d.available === 0;
          return (
            <Pressable
              key={d.date}
              disabled={off}
              accessibilityRole="button"
              accessibilityState={{ selected: on, disabled: off }}
              accessibilityLabel={`${fmtDateLong(d.date)}, ${off ? 'fully booked' : `${d.available} times`}`}
              onPress={() => { tap(); setDate(d.date); }}
              style={[styles.day, { backgroundColor: on ? c.accent : c.surface, borderColor: on ? c.accent : c.border }, off && { opacity: 0.4 }]}
            >
              <Text style={[type.caption, { color: on ? c.onAccent : c.muted }]}>{fmtDate(d.date, { weekday: 'short' }).toUpperCase()}</Text>
              <Text style={{ fontSize: 22, fontWeight: '700', color: on ? c.onAccent : c.text, marginVertical: 2 }}>{parseDate(d.date).getDate()}</Text>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: off ? 'transparent' : on ? c.onAccent : c.accent }} />
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={{ paddingHorizontal: space.lg, marginTop: space.lg }}>
        {date && <T v="bodyStrong" style={{ marginBottom: space.sm }}>{fmtDateLong(date)}</T>}
        {!slots && date && <ActivityIndicator color={c.accent} style={{ marginTop: space.xl }} />}
        {slots && slots.length === 0 && <Empty icon="calendar-clear-outline" title="Fully booked" body="Try another day." />}
        {groups.map((g) => (
          <View key={g.label} style={{ marginTop: space.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: space.sm }}>
              <Ionicons name={g.icon} size={16} color={c.muted} />
              <T v="small" color={c.muted} style={{ fontWeight: '600' }}>{g.label}</T>
            </View>
            <View style={styles.slotGrid}>
              {g.items.map((s) => (
                <Pressable
                  key={s.startMin}
                  accessibilityRole="button"
                  onPress={() => { tap('medium'); onPick(s); }}
                  style={({ pressed }) => [styles.slot, { backgroundColor: pressed ? c.accent : c.surface, borderColor: pressed ? c.accent : c.border }]}
                >
                  {({ pressed }) => <Text style={[type.bodyStrong, { color: pressed ? c.onAccent : c.text, fontSize: 15 }]}>{time(s.startMin)}</Text>}
                </Pressable>
              ))}
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

// ---------- details & confirm ----------
function DetailsStep({ slug, mode, info, service, therapist, date, slot, initialClient, onTaken, onBooked }: {
  slug: string; mode: 'public' | 'staff'; info: PublicInfo; service: Service; therapist: Therapist | null;
  date: string; slot: Slot; initialClient?: Partial<Client>; onTaken: () => void; onBooked: (r: BookedResult) => void;
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

  // Staff: suggest existing clients while typing a name.
  useEffect(() => {
    if (mode !== 'staff' || name.trim().length < 2 || email) { setMatches([]); return; }
    const t = setTimeout(() => {
      api<{ clients: Client[] }>(`/api/clients?${qs({ q: name.trim() })}`).then((r) => setMatches(r.clients.slice(0, 4))).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [mode, name, email]);

  const assigned = therapist ?? info.therapists.find((t) => t.id === slot.therapistIds[0]) ?? null;
  const cur = info.business.currency;

  async function submit() {
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
          body: { serviceId: service.id, therapistId: therapist?.id ?? slot.therapistIds[0], date, startMin: slot.startMin, name, email, phone, notes },
        });
        res = { appointment: r.appointment, business: info.business };
      }
      tap('success');
      onBooked(res);
    } catch (e: any) {
      setSaving(false);
      setError(e.message);
      if (e.status === 409) setTimeout(onTaken, 1600);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl }} keyboardShouldPersistTaps="handled">
        <T v="title" style={{ marginBottom: space.lg }}>{mode === 'staff' ? 'Client details' : 'Your details'}</T>

        <Card style={{ marginBottom: space.xl }}>
          <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
            <View style={[styles.dateBadge, { backgroundColor: c.accentSoft }]}>
              <T v="caption" color={c.accentStrong}>{fmtDate(date, { month: 'short' }).toUpperCase()}</T>
              <T v="title" color={c.accentStrong} style={{ lineHeight: 28 }}>{String(parseDate(date).getDate())}</T>
            </View>
            <View style={{ flex: 1 }}>
              <T v="bodyStrong" numberOfLines={1}>{service.name}</T>
              <T v="small" color={c.muted}>{`${fmtDate(date, { weekday: 'long' })} · ${time(slot.startMin)} – ${time(slot.startMin + service.durationMin)}`}</T>
              <T v="small" color={c.muted}>{therapist ? `with ${therapist.name}` : assigned && mode === 'staff' ? `with ${assigned.name}` : 'First available therapist'}</T>
            </View>
          </View>
          <View style={[styles.totalRow, { borderTopColor: c.border }]}>
            <T v="small" color={c.muted}>Total</T>
            <T v="bodyStrong">{money(service.priceCents, cur)}</T>
          </View>
        </Card>

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
        <Button title={mode === 'staff' ? 'Create booking' : `Confirm · ${money(service.priceCents, cur)}`} onPress={submit} loading={saving} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  top: { paddingHorizontal: space.lg, paddingBottom: space.sm },
  topRow: { flexDirection: 'row', alignItems: 'center' },
  progress: { flexDirection: 'row', gap: 6, marginTop: space.md },
  progressSeg: { flex: 1, height: 4, borderRadius: 2 },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.xl, marginBottom: space.md },
  day: { width: 62, height: 84, borderRadius: radius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  slotGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  slot: { width: '31.5%', height: 48, borderRadius: radius.sm, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexGrow: 0 },
  dateBadge: { width: 58, height: 64, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space.md, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth },
  match: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: 1 },
  bottomBar: { paddingHorizontal: space.lg, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth },
});
