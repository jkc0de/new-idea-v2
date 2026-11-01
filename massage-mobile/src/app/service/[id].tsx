import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, Chip, ErrorBanner, Field, Loading, Screen, Section, T, tap } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { confirmAsync } from '@/lib/confirm';
import { duration as fmtDuration } from '@/lib/format';
import { space, useColors } from '@/lib/theme';
import type { Room, Service } from '@/lib/types';
import { useApi } from '@/lib/use-api';

const DURATIONS = [30, 45, 60, 75, 90, 120];
const BUFFERS = [0, 5, 10, 15, 20, 30];

export default function ServiceEdit() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { business } = useAuth();
  const q = useApi<{ services: Service[] }>(isNew ? null : '/api/services');
  const [loaded, setLoaded] = useState(isNew);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [mins, setMins] = useState(60);
  const [price, setPrice] = useState('');
  const [buffer, setBuffer] = useState(15);
  const [active, setActive] = useState(true);
  const [roomIds, setRoomIds] = useState<number[]>([]);
  const rooms = useApi<{ rooms: Room[] }>('/api/rooms');
  const openRooms = (rooms.data?.rooms ?? []).filter((r) => r.active || roomIds.includes(r.id));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const s = q.data?.services.find((x) => String(x.id) === id);
    if (!s || loaded) return;
    setName(s.name); setDescription(s.description); setMins(s.durationMin);
    setPrice((s.priceCents / 100).toFixed(2).replace(/\.00$/, '')); setBuffer(s.bufferMin); setActive(s.active); setRoomIds(s.roomIds ?? []);
    setLoaded(true);
  }, [q.data, id, loaded]);

  if (!loaded) return <Loading />;

  async function save() {
    const cents = Math.round(Number(price.replace(/[^\d.]/g, '') || 0) * 100);
    if (!name.trim()) return setError('Name is required');
    setSaving(true); setError(null);
    try {
      await api(isNew ? '/api/services' : `/api/services/${id}`, {
        method: isNew ? 'POST' : 'PUT',
        body: { name, description, durationMin: mins, priceCents: cents, bufferMin: buffer, active, roomIds },
      });
      tap('success');
      router.back();
    } catch (e: any) { setError(e.message); setSaving(false); }
  }

  async function remove() {
    if (!(await confirmAsync(`Delete ${name}?`, 'Services with bookings are hidden instead.', 'Delete', true))) return;
    try { await api(`/api/services/${id}`, { method: 'DELETE' }); router.back(); } catch (e: any) { setError(e.message); }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: isNew ? 'New service' : 'Edit service' }} />
      <Screen>
        <ErrorBanner message={error} />
        <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. Deep Tissue – 60 min" />
        <Field label="Description" value={description} onChangeText={setDescription} multiline placeholder="What clients can expect" />
        <Field label={`Price (${business?.currency ?? 'USD'})`} value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="0" />

        <Section title={`Length · ${fmtDuration(mins)}`} style={{ marginTop: space.sm }}>
          <View style={styles.wrap}>
            {DURATIONS.map((d) => <Chip key={d} label={fmtDuration(d)} selected={mins === d} onPress={() => setMins(d)} />)}
            {!DURATIONS.includes(mins) && <Chip label={fmtDuration(mins)} selected onPress={() => {}} />}
          </View>
        </Section>

        <Section title={`Reset time after · ${buffer ? `${buffer} min` : 'none'}`}>
          <View style={styles.wrap}>
            {BUFFERS.map((b) => <Chip key={b} label={b ? `${b}m` : 'None'} selected={buffer === b} onPress={() => setBuffer(b)} />)}
          </View>
          <T v="small" color={c.faint} style={{ marginTop: space.sm }}>Blocked after each session for cleanup. Clients don't see it.</T>
        </Section>

        {openRooms.length > 0 && (
          <Section title={`Rooms · ${roomIds.length ? `${roomIds.length} selected` : 'any room'}`}>
            <View style={styles.wrap}>
              <Chip label="Any room" icon={roomIds.length ? undefined : 'checkmark'} selected={!roomIds.length} onPress={() => setRoomIds([])} />
              {openRooms.map((r) => (
                <Chip key={r.id} label={r.name} icon={roomIds.includes(r.id) ? 'checkmark' : undefined} selected={roomIds.includes(r.id)}
                  onPress={() => setRoomIds((ids) => (ids.includes(r.id) ? ids.filter((x) => x !== r.id) : [...ids, r.id]))} />
              ))}
            </View>
            <T v="small" color={c.faint} style={{ marginTop: space.sm }}>Limit to rooms with the right equipment, e.g. hot stone → Stone Room.</T>
          </Section>
        )}

        <Card padded={false} style={{ marginTop: space.xl }}>
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <T v="bodyStrong">Show on booking page</T>
              <T v="small" color={c.muted}>Hidden services can still be booked by staff</T>
            </View>
            <Switch value={active} onValueChange={setActive} trackColor={{ true: c.accent, false: c.border }} thumbColor="#fff" />
          </View>
        </Card>

        {!isNew && <Button title="Delete service" kind="ghost" style={{ marginTop: space.xl }} onPress={remove} />}
      </Screen>
      <View style={[styles.bottom, { paddingBottom: insets.bottom + space.md, borderTopColor: c.border, backgroundColor: c.bg }]}>
        <Button title={isNew ? 'Add service' : 'Save changes'} onPress={save} loading={saving} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg },
  bottom: { paddingHorizontal: space.lg, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth },
});
