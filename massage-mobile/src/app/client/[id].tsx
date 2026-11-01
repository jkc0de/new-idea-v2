import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Avatar, Button, Card, Divider, Empty, ErrorBanner, Ionicons, Loading, Row, Screen, Section, StatusPill, T, tap, type IconName } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, money, time } from '@/lib/format';
import { radius, space, useColors } from '@/lib/theme';
import type { Appointment, Client, ClientStats } from '@/lib/types';
import { useApi } from '@/lib/use-api';

export default function ClientScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useColors();
  const { business } = useAuth();
  const q = useApi<{ client: Client; appointments: Appointment[]; stats: ClientStats }>(`/api/clients/${id}`);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const client = q.data?.client;
  useEffect(() => { if (client) setNotes(client.notes ?? ''); }, [client?.id, client?.notes]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!q.data || !client) return q.error ? <View style={{ padding: space.lg }}><ErrorBanner message={q.error} /></View> : <Loading />;
  const { appointments: appts, stats } = q.data;
  const upcoming = appts.filter((a) => a.status === 'booked').reverse();
  const past = appts.filter((a) => a.status !== 'booked');
  const phone = client.phone?.replace(/[^\d+]/g, '');
  const rebook = stats.rebook;

  function bookAgain() {
    router.push({
      pathname: '/new-booking',
      params: {
        ...(rebook ? { serviceId: String(rebook.serviceId), therapistId: String(rebook.therapistId) } : {}),
        clientName: client!.name, clientEmail: client!.email, clientPhone: client!.phone ?? '',
      },
    });
  }

  async function saveNotes() {
    setSaving(true); setError(null);
    try {
      await api(`/api/clients/${client!.id}`, { method: 'PUT', body: { notes } });
      q.setData({ ...q.data!, client: { ...client!, notes } });
      tap('success');
    } catch (e: any) { setError(e.message); } finally { setSaving(false); }
  }

  const apptRow = (a: Appointment) => (
    <Row
      key={a.id}
      title={`${fmtDate(a.date, { month: 'short', day: 'numeric', year: 'numeric' })} · ${time(a.startMin)}`}
      subtitle={[a.serviceName, a.therapistName, a.roomName].filter(Boolean).join(' · ')}
      right={a.status !== 'booked' ? <StatusPill status={a.status} /> : undefined}
      onPress={() => router.push({ pathname: '/appointment/[id]', params: { id: String(a.id) } })}
    />
  );
  const shownPast = showAll ? past : past.slice(0, 8);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={100}>
      <Stack.Screen options={{ title: '' }} />
      <Screen>
        <View style={{ alignItems: 'center' }}>
          <Avatar name={client.name} seed={client.id} size={84} />
          <T v="title" style={{ marginTop: space.md }} center>{client.name}</T>
          <T v="small" color={c.muted} center>{[client.email, client.phone].filter(Boolean).join(' · ')}</T>
          {stats.firstVisit && <T v="small" color={c.faint} center style={{ marginTop: 2 }}>{`Client since ${fmtDate(stats.firstVisit, { month: 'short', year: 'numeric' })}`}</T>}
        </View>

        <View style={styles.quick}>
          {[
            { icon: 'call' as const, label: 'Call', on: !!phone, go: () => Linking.openURL(`tel:${phone}`) },
            { icon: 'chatbubble' as const, label: 'Text', on: !!phone, go: () => Linking.openURL(`sms:${phone}`) },
            { icon: 'mail' as const, label: 'Email', on: true, go: () => Linking.openURL(`mailto:${client.email}`) },
          ].map((b) => (
            <Pressable key={b.label} disabled={!b.on} onPress={() => { tap(); b.go(); }} accessibilityRole="button" accessibilityLabel={b.label}
              style={({ pressed }) => [styles.quickBtn, { backgroundColor: c.surface, borderColor: c.border }, !b.on && { opacity: 0.35 }, pressed && { opacity: 0.7 }]}>
              <Ionicons name={b.icon} size={20} color={c.accentStrong} />
              <T v="small" style={{ fontWeight: '600' }}>{b.label}</T>
            </Pressable>
          ))}
        </View>

        <Button title={rebook ? 'Book again' : 'Book an appointment'} icon="add-circle" style={{ marginTop: space.md }} onPress={bookAgain} />
        {rebook && <T v="small" color={c.muted} center style={{ marginTop: 6 }}>{`Pre-filled: ${rebook.serviceName} with ${rebook.therapistName}`}</T>}

        <View style={styles.stats}>
          <Stat label="Visits" value={String(stats.visits)} />
          <Stat label="Spent" value={money(stats.spentCents, business?.currency)} />
          <Stat label="No-shows" value={String(stats.noShows)} warn={stats.noShows > 0} />
          <Stat label="Cancelled" value={String(stats.cancellations)} />
        </View>

        {(stats.favoriteTherapist || stats.favoriteService || stats.avgGapDays || stats.lastVisit) && (
          <Card padded={false} style={{ marginTop: space.md, overflow: 'hidden' }}>
            {stats.lastVisit && <Fact icon="time-outline" label="Last visit" value={fmtDate(stats.lastVisit, { month: 'short', day: 'numeric', year: 'numeric' })} />}
            {stats.avgGapDays ? <Fact icon="repeat-outline" label="Usually books" value={`every ~${stats.avgGapDays} days`} /> : null}
            {stats.favoriteTherapist && <Fact icon="person-outline" label="Favorite therapist" value={`${stats.favoriteTherapist.name} (${stats.favoriteTherapist.count})`} />}
            {stats.favoriteService && <Fact icon="leaf-outline" label="Favorite treatment" value={stats.favoriteService.name.split(' – ')[0]} last />}
          </Card>
        )}

        <ErrorBanner message={error} />
        <Section title="Notes" action={notes !== (client.notes ?? '') ? <Button title="Save" size="sm" kind="ghost" loading={saving} onPress={saveNotes} /> : undefined}>
          <TextInput value={notes} onChangeText={setNotes} multiline placeholder="Pressure preference, injuries, allergies…" placeholderTextColor={c.faint}
            accessibilityLabel="Client notes" style={[styles.notes, { backgroundColor: c.surface, borderColor: c.border, color: c.text }]} />
        </Section>

        {upcoming.length > 0 && (
          <Section title="Upcoming">
            <Card padded={false} style={{ overflow: 'hidden' }}>{upcoming.map((a, i) => <View key={a.id}>{i > 0 && <Divider inset={space.lg} />}{apptRow(a)}</View>)}</Card>
          </Section>
        )}
        <Section title={`History · ${past.length}`}>
          <Card padded={false} style={{ overflow: 'hidden' }}>
            {past.length ? shownPast.map((a, i) => <View key={a.id}>{i > 0 && <Divider inset={space.lg} />}{apptRow(a)}</View>) : <Empty icon="time-outline" title="No past visits" />}
          </Card>
          {past.length > shownPast.length && <Button title={`Show all ${past.length}`} kind="ghost" size="md" onPress={() => setShowAll(true)} style={{ marginTop: space.sm }} />}
        </Section>
      </Screen>
    </KeyboardAvoidingView>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  const c = useColors();
  return (
    <View style={[styles.stat, { backgroundColor: c.surface, borderColor: c.border }]}>
      <T v="heading" color={warn ? c.warn : c.text} numberOfLines={1}>{value}</T>
      <T v="small" color={c.muted}>{label}</T>
    </View>
  );
}

function Fact({ icon, label, value, last }: { icon: IconName; label: string; value: string; last?: boolean }) {
  const c = useColors();
  return (
    <View style={[styles.fact, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border }]}>
      <Ionicons name={icon} size={18} color={c.muted} />
      <T v="body" color={c.muted} style={{ flex: 1 }}>{label}</T>
      <T v="bodyStrong" numberOfLines={1} style={{ flexShrink: 1, textAlign: 'right' }}>{value}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  quick: { flexDirection: 'row', gap: space.sm, marginTop: space.xl },
  quickBtn: { flex: 1, height: 62, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center', gap: 4 },
  stats: { flexDirection: 'row', gap: space.sm, marginTop: space.lg },
  stat: { flex: 1, paddingVertical: space.md, paddingHorizontal: 4, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center' },
  fact: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, minHeight: 50 },
  notes: { borderWidth: 1, borderRadius: radius.md, padding: space.md, minHeight: 100, fontSize: 16, textAlignVertical: 'top' },
});
