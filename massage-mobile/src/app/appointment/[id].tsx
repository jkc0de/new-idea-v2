import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActivityTimeline, type NameLookup } from '@/components/bk-activity';
import { Avatar, Button, Card, ErrorBanner, Ionicons, Loading, Section, StatusPill, T, tap, type IconName } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { confirmAsync } from '@/lib/confirm';
import { duration, fmtDate, money, parseDate, time } from '@/lib/format';
import { radius, space, useColors } from '@/lib/theme';
import type { Appointment, AppointmentEvent, Room, Service, Status, Therapist } from '@/lib/types';
import { useApi } from '@/lib/use-api';

export default function AppointmentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { business } = useAuth();
  const q = useApi<{ appointment: Appointment; events: AppointmentEvent[] }>(`/api/appointments/${id}`);
  const team = useApi<{ therapists: Therapist[] }>('/api/therapists');
  const rooms = useApi<{ rooms: Room[] }>('/api/rooms');
  const services = useApi<{ services: Service[] }>('/api/services');
  const a = q.data?.appointment;
  const names: NameLookup = {
    therapist: (tid) => team.data?.therapists.find((t) => t.id === tid)?.name ?? null,
    room: (rid) => rooms.data?.rooms.find((r) => r.id === rid)?.name ?? null,
    service: (sid) => services.data?.services.find((x) => x.id === sid)?.name ?? null,
  };
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState<Status | 'notes' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (a) setNotes(a.internalNotes ?? ''); }, [a?.id, a?.internalNotes]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!a) return q.error ? <View style={{ padding: space.lg }}><ErrorBanner message={q.error} onRetry={q.reload} /></View> : <Loading />;

  async function update(status: Status, what: Status | 'notes' = status) {
    if (status === 'cancelled' && a!.status !== 'cancelled' && !(await confirmAsync('Cancel this appointment?', `${a!.clientName} · ${fmtDate(a!.date)} at ${time(a!.startMin)}`, 'Cancel appointment', true))) return;
    if (status === 'no_show' && !(await confirmAsync('Mark as no-show?', undefined, 'Mark no-show'))) return;
    setSaving(what);
    setError(null);
    try {
      const res = await api<{ appointment: Appointment; events: AppointmentEvent[] }>(`/api/appointments/${a!.id}`, { method: 'PATCH', body: { status, internalNotes: notes } });
      q.setData(res);
      tap('success');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(null);
    }
  }

  const notesDirty = notes !== (a.internalNotes ?? '');
  const move = () => router.push({ pathname: '/reschedule/[id]', params: { id: String(a.id) } });
  const phone = a.clientPhone?.replace(/[^\d+]/g, '');

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={100}>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxl }} keyboardShouldPersistTaps="handled">
        <ErrorBanner message={error} />

        {/* schedule problem (e.g. therapist went on time off after this was booked) */}
        {a.issues?.length ? (
          <View style={[styles.issue, { backgroundColor: c.dangerSoft }]}>
            <Ionicons name="alert-circle" size={22} color={c.danger} />
            <View style={{ flex: 1 }}>
              <T v="bodyStrong" color={c.danger}>Needs attention</T>
              {a.issues.map((i) => <T key={i.code} v="small" color={c.danger}>{i.message}</T>)}
            </View>
            <Button title="Fix" size="sm" kind="secondary" onPress={move} />
          </View>
        ) : null}

        {/* when & what */}
        <View style={styles.hero}>
          <View style={[styles.dateBadge, { backgroundColor: c.accentSoft }]}>
            <T v="caption" color={c.accentStrong}>{fmtDate(a.date, { month: 'short' }).toUpperCase()}</T>
            <T v="hero" color={c.accentStrong} style={{ lineHeight: 34 }}>{String(parseDate(a.date).getDate())}</T>
            <T v="caption" color={c.accentStrong}>{fmtDate(a.date, { weekday: 'short' }).toUpperCase()}</T>
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <StatusPill status={a.status} />
            <T v="heading">{a.serviceName}</T>
            <T v="body" color={c.muted}>{`${time(a.startMin)} – ${time(a.endMin)}`}</T>
          </View>
        </View>

        <Card style={{ marginTop: space.lg }} padded={false}>
          <Detail icon="person-circle-outline" label="Therapist" value={a.therapistName} />
          {a.roomName ? <Detail icon="bed-outline" label="Room" value={a.roomName} /> : null}
          <Detail icon="hourglass-outline" label="Duration" value={duration(a.endMin - a.startMin)} />
          <Detail icon="pricetag-outline" label="Price" value={money(a.priceCents, business?.currency)} />
          <Detail icon={a.source === 'online' ? 'globe-outline' : 'call-outline'} label="Booked" value={a.source === 'online' ? 'Online' : 'By staff'} />
          <Detail icon="barcode-outline" label="Reference" value={a.ref} last />
        </Card>

        {/* client */}
        <Section title="Client">
          <Card>
            <Pressable style={styles.clientRow} onPress={() => a.clientId && router.push({ pathname: '/client/[id]', params: { id: String(a.clientId) } })}>
              <Avatar name={a.clientName} seed={a.clientId ?? 0} size={52} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <T v="bodyStrong">{a.clientName}</T>
                <T v="small" color={c.muted} numberOfLines={1}>{a.clientEmail}</T>
              </View>
              <Ionicons name="chevron-forward" size={18} color={c.faint} />
            </Pressable>
            <View style={styles.contactRow}>
              <Contact icon="call" label="Call" disabled={!phone} onPress={() => Linking.openURL(`tel:${phone}`)} />
              <Contact icon="chatbubble" label="Text" disabled={!phone} onPress={() => Linking.openURL(`sms:${phone}`)} />
              <Contact icon="mail" label="Email" onPress={() => Linking.openURL(`mailto:${a.clientEmail}?subject=${encodeURIComponent(`Your appointment at ${business?.name ?? 'our studio'}`)}`)} />
            </View>
          </Card>
          {a.clientNotes ? (
            <View style={[styles.note, { backgroundColor: c.warnSoft }]}>
              <Ionicons name="chatbubble-ellipses" size={18} color={c.warn} />
              <View style={{ flex: 1 }}>
                <T v="caption" color={c.warn}>CLIENT'S NOTE</T>
                <T v="body" style={{ marginTop: 2 }}>{a.clientNotes}</T>
              </View>
            </View>
          ) : null}
        </Section>

        {/* staff notes */}
        <Section title="Staff notes" action={notesDirty ? <Button title="Save" size="sm" kind="ghost" loading={saving === 'notes'} onPress={() => update(a.status, 'notes')} /> : undefined}>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            multiline
            placeholder="Private — only your team sees this"
            placeholderTextColor={c.faint}
            style={[styles.notes, { backgroundColor: c.surface, borderColor: c.border, color: c.text }]}
          />
        </Section>

        {/* history */}
        <Section title="Activity">
          <Card>
            <ActivityTimeline events={q.data!.events ?? []} names={names} />
          </Card>
        </Section>
      </ScrollView>

      {/* actions */}
      <View style={[styles.actions, { paddingBottom: insets.bottom + space.md, borderTopColor: c.border, backgroundColor: c.bg }]}>
        {a.status === 'booked' ? (
          <>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button title="Move" icon="swap-horizontal" kind="secondary" size="md" style={{ flex: 1 }} onPress={move} />
              <Button title="No-show" kind="secondary" size="md" style={{ flex: 1 }} loading={saving === 'no_show'} onPress={() => update('no_show')} />
              <Button title="Cancel" kind="danger" size="md" style={{ flex: 1 }} loading={saving === 'cancelled'} onPress={() => update('cancelled')} />
            </View>
            <Button title="Check out · mark completed" icon="checkmark-circle" loading={saving === 'completed'} onPress={() => update('completed')} />
          </>
        ) : (
          <Button title={a.status === 'cancelled' ? 'Restore booking' : 'Undo · back to booked'} kind="secondary" icon="arrow-undo" loading={saving === 'booked'} onPress={() => update('booked')} />
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

function Detail({ icon, label, value, last }: { icon: IconName; label: string; value: string; last?: boolean }) {
  const c = useColors();
  return (
    <View style={[styles.detail, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border }]}>
      <Ionicons name={icon} size={20} color={c.muted} />
      <T v="body" color={c.muted} style={{ flex: 1 }}>{label}</T>
      <T v="bodyStrong">{value}</T>
    </View>
  );
}

function Contact({ icon, label, onPress, disabled }: { icon: IconName; label: string; onPress: () => void; disabled?: boolean }) {
  const c = useColors();
  return (
    <Pressable disabled={disabled} onPress={() => { tap(); onPress(); }} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => [styles.contact, { backgroundColor: c.accentSoft }, disabled && { opacity: 0.35 }, pressed && { opacity: 0.7 }]}>
      <Ionicons name={icon} size={20} color={c.accentStrong} />
      <T v="small" color={c.accentStrong} style={{ fontWeight: '600' }}>{label}</T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', gap: space.lg, alignItems: 'center' },
  issue: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, marginBottom: space.lg },
  dateBadge: { width: 80, height: 96, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
  detail: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, height: 52 },
  clientRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  contactRow: { flexDirection: 'row', gap: space.sm, marginTop: space.lg },
  contact: { flex: 1, height: 64, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', gap: 4 },
  note: { flexDirection: 'row', gap: space.md, padding: space.lg, borderRadius: radius.lg, marginTop: space.md },
  notes: { borderWidth: 1, borderRadius: radius.md, padding: space.md, minHeight: 100, fontSize: 16, textAlignVertical: 'top' },
  actions: { paddingHorizontal: space.lg, paddingTop: space.md, gap: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
});
