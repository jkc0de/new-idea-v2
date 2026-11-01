import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Avatar, Button, Card, Divider, Empty, ErrorBanner, Ionicons, Loading, Row, Screen, Section, StatusPill, T, tap } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, money, time } from '@/lib/format';
import { radius, space, useColors } from '@/lib/theme';
import type { Appointment, Client } from '@/lib/types';
import { useApi } from '@/lib/use-api';

export default function ClientScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useColors();
  const { business } = useAuth();
  const q = useApi<{ client: Client; appointments: Appointment[] }>(`/api/clients/${id}`);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const client = q.data?.client;
  useEffect(() => { if (client) setNotes(client.notes ?? ''); }, [client?.id, client?.notes]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!q.data || !client) return q.error ? <View style={{ padding: space.lg }}><ErrorBanner message={q.error} /></View> : <Loading />;
  const appts = q.data.appointments;
  const visits = appts.filter((a) => a.status === 'completed');
  const spent = visits.reduce((s, a) => s + a.priceCents, 0);
  const upcoming = appts.filter((a) => a.status === 'booked').reverse();
  const past = appts.filter((a) => a.status !== 'booked');
  const phone = client.phone?.replace(/[^\d+]/g, '');

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
      subtitle={`${a.serviceName} · ${a.therapistName}`}
      right={a.status !== 'booked' ? <StatusPill status={a.status} /> : undefined}
      onPress={() => router.push({ pathname: '/appointment/[id]', params: { id: String(a.id) } })}
    />
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={100}>
      <Stack.Screen options={{ title: '' }} />
      <Screen>
        <View style={{ alignItems: 'center' }}>
          <Avatar name={client.name} seed={client.id} size={84} />
          <T v="title" style={{ marginTop: space.md }} center>{client.name}</T>
          <T v="small" color={c.muted} center>{[client.email, client.phone].filter(Boolean).join(' · ')}</T>
        </View>

        <View style={styles.quick}>
          {[
            { icon: 'call' as const, label: 'Call', on: !!phone, go: () => Linking.openURL(`tel:${phone}`) },
            { icon: 'chatbubble' as const, label: 'Text', on: !!phone, go: () => Linking.openURL(`sms:${phone}`) },
            { icon: 'mail' as const, label: 'Email', on: true, go: () => Linking.openURL(`mailto:${client.email}`) },
            { icon: 'add' as const, label: 'Book', on: true, go: () => router.push({ pathname: '/new-booking', params: { clientName: client.name, clientEmail: client.email, clientPhone: client.phone } }) },
          ].map((b) => (
            <Pressable key={b.label} disabled={!b.on} onPress={() => { tap(); b.go(); }} accessibilityRole="button" accessibilityLabel={b.label}
              style={({ pressed }) => [styles.quickBtn, { backgroundColor: b.label === 'Book' ? c.accent : c.surface, borderColor: c.border }, !b.on && { opacity: 0.35 }, pressed && { opacity: 0.7 }]}>
              <Ionicons name={b.icon} size={20} color={b.label === 'Book' ? c.onAccent : c.accentStrong} />
              <T v="small" color={b.label === 'Book' ? c.onAccent : c.text} style={{ fontWeight: '600' }}>{b.label}</T>
            </Pressable>
          ))}
        </View>

        <View style={styles.stats}>
          <Stat label="Visits" value={String(visits.length)} />
          <Stat label="Spent" value={money(spent, business?.currency)} />
          <Stat label="No-shows" value={String(appts.filter((a) => a.status === 'no_show').length)} />
        </View>

        <ErrorBanner message={error} />
        <Section title="Notes" action={notes !== (client.notes ?? '') ? <Button title="Save" size="sm" kind="ghost" loading={saving} onPress={saveNotes} /> : undefined}>
          <TextInput value={notes} onChangeText={setNotes} multiline placeholder="Pressure preference, injuries, allergies…" placeholderTextColor={c.faint}
            style={[styles.notes, { backgroundColor: c.surface, borderColor: c.border, color: c.text }]} />
        </Section>

        {upcoming.length > 0 && (
          <Section title="Upcoming">
            <Card padded={false} style={{ overflow: 'hidden' }}>{upcoming.map((a, i) => <View key={a.id}>{i > 0 && <Divider inset={space.lg} />}{apptRow(a)}</View>)}</Card>
          </Section>
        )}
        <Section title="History">
          <Card padded={false} style={{ overflow: 'hidden' }}>
            {past.length ? past.map((a, i) => <View key={a.id}>{i > 0 && <Divider inset={space.lg} />}{apptRow(a)}</View>) : <Empty icon="time-outline" title="No past visits" />}
          </Card>
        </Section>
      </Screen>
    </KeyboardAvoidingView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const c = useColors();
  return (
    <View style={[styles.stat, { backgroundColor: c.surface, borderColor: c.border }]}>
      <T v="heading">{value}</T>
      <T v="small" color={c.muted}>{label}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  quick: { flexDirection: 'row', gap: space.sm, marginTop: space.xl },
  quickBtn: { flex: 1, height: 66, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center', gap: 4 },
  stats: { flexDirection: 'row', gap: space.sm, marginTop: space.md, marginBottom: space.sm },
  stat: { flex: 1, padding: space.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center' },
  notes: { borderWidth: 1, borderRadius: radius.md, padding: space.md, minHeight: 100, fontSize: 16, textAlignVertical: 'top' },
});
