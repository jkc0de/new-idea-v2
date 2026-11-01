import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OverrideCard } from '@/components/booking-flow';
import { SlotPicker, type DayAvail } from '@/components/bk-slot-picker';
import { Sheet } from '@/components/sheet';
import { Avatar, Button, Card, Chip, ErrorBanner, Field, Ionicons, Loading, T, tap } from '@/components/ui';
import { api, ApiError, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { duration, fmtDate, money, time } from '@/lib/format';
import { radius, space, useColors } from '@/lib/theme';
import type { Appointment, AppointmentEvent, Issue, Service, Slot, Stats, Therapist } from '@/lib/types';
import { useApi } from '@/lib/use-api';

const REASONS = ['Client request', 'Therapist unavailable', 'Running late', 'Studio change'];

interface Target { date: string; startMin: number; therapistId: number }

export default function Reschedule() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { business } = useAuth();
  const appt = useApi<{ appointment: Appointment; events: AppointmentEvent[] }>(`/api/appointments/${id}`);
  const team = useApi<{ therapists: Therapist[] }>('/api/therapists');
  const svc = useApi<{ services: Service[] }>('/api/services');
  const stats = useApi<Stats>('/api/stats');

  const a = appt.data?.appointment;
  const [therapistId, setTherapistId] = useState<number | null | undefined>(undefined); // undefined = current, null = any
  const [serviceId, setServiceId] = useState<number | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<Issue[] | null>(null);

  const service = svc.data?.services.find((s) => s.id === (serviceId ?? a?.serviceId)) ?? null;
  const chosenTherapist = therapistId === undefined ? a?.therapistId ?? null : therapistId;
  const options = useMemo(
    () => (team.data?.therapists ?? []).filter((t) => t.active && service && t.serviceIds.includes(service.id))
      .sort((x, y) => (x.id === a?.therapistId ? -1 : y.id === a?.therapistId ? 1 : x.name.localeCompare(y.name))),
    [team.data, service, a?.therapistId],
  );

  const fetchers = useMemo(() => {
    if (!service || !a) return null;
    const p = { serviceId: service.id, therapistId: chosenTherapist, excludeId: a.id };
    return {
      fetchDays: (from: string, count: number) => api<{ days: DayAvail[] }>(`/api/staff/days?${qs({ ...p, from, count })}`).then((r) => r.days),
      fetchSlots: (date: string) => api<{ slots: Slot[] }>(`/api/staff/slots?${qs({ ...p, date })}`).then((r) => r.slots),
    };
  }, [service, a, chosenTherapist]);

  if (!a || !team.data || !svc.data || !stats.data || !service || !fetchers) {
    const err = appt.error || team.error || svc.error || stats.error;
    return err ? <View style={{ padding: space.lg }}><ErrorBanner message={err} onRetry={appt.reload} /></View> : <Loading />;
  }

  const nameOf = (tid: number) => team.data!.therapists.find((t) => t.id === tid)?.name ?? 'Therapist';
  const serviceChanged = service.id !== a.serviceId;
  const today = stats.data.today;

  function pick(s: Slot, date: string) {
    // Keep the current therapist when they're free at that time; otherwise take the first free one.
    const tid = chosenTherapist ?? (s.therapistIds.includes(a!.therapistId) ? a!.therapistId : s.therapistIds[0]);
    setTarget({ date, startMin: s.startMin, therapistId: tid });
    setWarning(null);
    setError(null);
  }

  async function save(override = false) {
    if (!target) return;
    setSaving(true);
    setError(null);
    try {
      await api(`/api/appointments/${a!.id}`, {
        method: 'PATCH',
        body: {
          date: target.date, startMin: target.startMin, therapistId: target.therapistId,
          ...(serviceChanged ? { serviceId: service!.id } : {}),
          ...(reason.trim() ? { reason: reason.trim() } : {}),
          ...(override ? { override: true } : {}),
        },
      });
      tap('success');
      setTarget(null);
      if (router.canGoBack()) router.back();
      else router.replace({ pathname: '/appointment/[id]', params: { id: String(a!.id) } });
    } catch (e: any) {
      setSaving(false);
      if (e instanceof ApiError && e.canOverride) setWarning(e.data.issues ?? [{ code: 'rule', message: e.message }]);
      else setError(e.message);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl }}>
        {/* current booking */}
        <Card>
          <T v="caption" color={c.muted}>CURRENTLY</T>
          <View style={styles.currentRow}>
            <Avatar name={a.clientName} seed={a.clientId ?? a.id} size={44} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <T v="bodyStrong" numberOfLines={1}>{a.clientName}</T>
              <T v="small" color={c.muted} numberOfLines={1}>{a.serviceName}</T>
              <T v="small" color={c.muted}>{`${fmtDate(a.date)} · ${time(a.startMin)} · ${a.therapistName}${a.roomName ? ` · ${a.roomName}` : ''}`}</T>
            </View>
          </View>
        </Card>
        {a.issues?.length ? (
          <View style={[styles.issue, { backgroundColor: c.dangerSoft }]}>
            <Ionicons name="alert-circle" size={18} color={c.danger} />
            <T v="small" color={c.danger} style={{ flex: 1 }}>{a.issues.map((i) => i.message).join('. ')}</T>
          </View>
        ) : null}

        {/* therapist */}
        <T v="caption" color={c.muted} style={styles.label}>THERAPIST</T>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -space.lg }} contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.sm }}>
          {options.map((t) => (
            <Chip key={t.id} label={t.id === a.therapistId ? `${t.name.split(' ')[0]} (current)` : t.name.split(' ')[0]}
              selected={chosenTherapist === t.id} onPress={() => setTherapistId(t.id === a.therapistId ? undefined : t.id)} />
          ))}
          {options.length > 1 && <Chip label="Any available" icon="sparkles-outline" selected={chosenTherapist === null} onPress={() => setTherapistId(null)} />}
        </ScrollView>

        {/* service (optional) */}
        <T v="caption" color={c.muted} style={styles.label}>SERVICE</T>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -space.lg }} contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.sm }}>
          {svc.data.services.filter((s) => s.active || s.id === a.serviceId).map((s) => (
            <Chip key={s.id} label={`${s.name.replace(/ – \d+ min$/, '')} · ${duration(s.durationMin)}`} selected={s.id === service.id}
              onPress={() => { setServiceId(s.id === a.serviceId ? null : s.id); setTherapistId(undefined); }} />
          ))}
        </ScrollView>
        {serviceChanged && (
          <T v="small" color={c.muted} style={{ marginTop: space.sm }}>
            {`Price changes from ${money(a.priceCents, business?.currency)} to ${money(service.priceCents, business?.currency)}.`}
          </T>
        )}

        <View style={{ height: space.xl }} />
        <SlotPicker
          today={today}
          reloadKey={`${service.id}-${chosenTherapist ?? 'any'}`}
          initialDate={a.date >= today ? a.date : today}
          selectedStart={serviceChanged || (chosenTherapist !== null && chosenTherapist !== a.therapistId) ? null : { date: a.date, startMin: a.startMin }}
          fetchDays={fetchers.fetchDays}
          fetchSlots={fetchers.fetchSlots}
          onPick={pick}
          custom={{
            hint: `For ${nameOf(chosenTherapist ?? a.therapistId)}. If it breaks a scheduling rule you'll be asked to confirm.`,
            onPick: (date, m) => { setTarget({ date, startMin: m, therapistId: chosenTherapist ?? a.therapistId }); setWarning(null); setError(null); },
          }}
        />
      </ScrollView>

      <Sheet visible={!!target} onClose={() => !saving && setTarget(null)} title="Move this booking?">
        {target && (
          <View>
            <View style={styles.compare}>
              <MoveCard label="FROM" date={a.date} startMin={a.startMin} who={a.therapistName} muted />
              <Ionicons name="arrow-forward" size={20} color={c.faint} />
              <MoveCard label="TO" date={target.date} startMin={target.startMin} who={nameOf(target.therapistId)} />
            </View>
            {serviceChanged && <T v="small" color={c.muted} style={{ marginBottom: space.md }}>{`Service changes to ${service.name}.`}</T>}
            <ErrorBanner message={error} />
            {warning ? (
              <OverrideCard issues={warning} loading={saving} confirmLabel="Move anyway" cancelLabel="Pick another"
                onConfirm={() => save(true)} onCancel={() => { setWarning(null); setTarget(null); }} />
            ) : (
              <>
                <T v="small" color={c.muted} style={{ marginBottom: space.sm, fontWeight: '600' }}>Reason (optional)</T>
                <View style={styles.reasons}>
                  {REASONS.map((r) => <Chip key={r} label={r} selected={reason === r} onPress={() => setReason(reason === r ? '' : r)} />)}
                </View>
                <Field label="" value={REASONS.includes(reason) ? '' : reason} onChangeText={setReason} placeholder="Or type a reason…" />
                <Button title="Confirm move" icon="checkmark" loading={saving} onPress={() => save(false)} />
              </>
            )}
          </View>
        )}
      </Sheet>
    </View>
  );
}

function MoveCard({ label, date, startMin, who, muted }: { label: string; date: string; startMin: number; who: string; muted?: boolean }) {
  const c = useColors();
  return (
    <View style={[styles.moveCard, { backgroundColor: muted ? c.surface2 : c.accentSoft }]}>
      <T v="caption" color={muted ? c.muted : c.accentStrong}>{label}</T>
      <T v="bodyStrong" color={muted ? c.muted : c.text} style={muted ? { textDecorationLine: 'line-through' } : undefined}>{fmtDate(date)}</T>
      <T v="bodyStrong" color={muted ? c.muted : c.accentStrong}>{time(startMin)}</T>
      <T v="small" color={c.muted} numberOfLines={1}>{who}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  currentRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.sm },
  issue: { flexDirection: 'row', gap: space.sm, alignItems: 'center', padding: space.md, borderRadius: radius.md, marginTop: space.md },
  label: { marginTop: space.xl, marginBottom: space.sm },
  compare: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.lg },
  moveCard: { flex: 1, padding: space.md, borderRadius: radius.md, gap: 2 },
  reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.md },
});
