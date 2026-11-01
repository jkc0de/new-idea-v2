import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, ErrorBanner, Field, Loading, Screen, Section, T, tap } from '@/components/ui';
import { api } from '@/lib/api';
import { confirmAsync } from '@/lib/confirm';
import { space, useColors } from '@/lib/theme';
import type { Room, Service } from '@/lib/types';
import { useApi } from '@/lib/use-api';

export default function RoomEdit() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const c = useColors();
  const insets = useSafeAreaInsets();
  const q = useApi<{ rooms: Room[] }>(isNew ? null : '/api/rooms');
  const svc = useApi<{ services: Service[] }>('/api/services');
  const [loaded, setLoaded] = useState(isNew);
  const [room, setRoom] = useState<Room | null>(null);
  const [name, setName] = useState('');
  const [active, setActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const r = q.data?.rooms.find((x) => String(x.id) === id);
    if (!r || loaded) return;
    setRoom(r); setName(r.name); setActive(r.active); setLoaded(true);
  }, [q.data, id, loaded]);

  if (!loaded) return <Loading />;

  async function save() {
    if (!name.trim()) return setError('Room name is required');
    setSaving(true); setError(null);
    try {
      await api(isNew ? '/api/rooms' : `/api/rooms/${id}`, { method: isNew ? 'POST' : 'PUT', body: { name, active } });
      tap('success');
      router.back();
    } catch (e: any) { setError(e.message); setSaving(false); }
  }

  async function remove() {
    if (!(await confirmAsync(`Delete ${name}?`, 'Rooms with past bookings are closed instead, so history stays intact.', 'Delete', true))) return;
    try { await api(`/api/rooms/${id}`, { method: 'DELETE' }); router.back(); } catch (e: any) { setError(e.message); }
  }

  const restricted = (svc.data?.services ?? []).filter((s) => room?.serviceIds.includes(s.id));

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: isNew ? 'New room' : 'Edit room' }} />
      <Screen>
        <ErrorBanner message={error} />
        <Field label="Room name" value={name} onChangeText={setName} placeholder="e.g. Willow, Room 2, Couples suite" autoFocus={isNew} />
        <Card padded={false}>
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <T v="bodyStrong">Open for bookings</T>
              <T v="small" color={c.muted}>Close it during renovations or repairs</T>
            </View>
            <Switch value={active} onValueChange={setActive} trackColor={{ true: c.accent, false: c.border }} thumbColor="#fff" accessibilityLabel="Open for bookings" />
          </View>
        </Card>
        {!isNew && (
          <Section title="Services limited to this room">
            <Card>
              {restricted.length ? (
                <T v="body">{restricted.map((s) => s.name).join(', ')}</T>
              ) : <T v="small" color={c.muted}>None — every service can use this room.</T>}
              <T v="small" color={c.faint} style={{ marginTop: space.sm }}>Set room rules on each service (Studio → Services).</T>
            </Card>
          </Section>
        )}
        {!isNew && <Button title="Delete room" kind="ghost" style={{ marginTop: space.xl }} onPress={remove} />}
      </Screen>
      <View style={[styles.bottom, { paddingBottom: insets.bottom + space.md, borderTopColor: c.border, backgroundColor: c.bg }]}>
        <Button title={isNew ? 'Add room' : 'Save changes'} onPress={save} loading={saving} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg },
  bottom: { paddingHorizontal: space.lg, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth },
});
