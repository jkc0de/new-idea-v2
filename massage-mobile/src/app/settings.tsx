import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, Divider, ErrorBanner, Field, IconButton, Screen, Section, T, tap } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { space, useColors } from '@/lib/theme';
import type { Business } from '@/lib/types';

export default function Settings() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { business, setBusiness } = useAuth();
  const b = business!;
  const [name, setName] = useState(b.name);
  const [phone, setPhone] = useState(b.phone);
  const [address, setAddress] = useState(b.address);
  const [slug, setSlug] = useState(b.slug);
  const [lead, setLead] = useState(b.leadTimeMin / 60);
  const [windowDays, setWindowDays] = useState(b.bookingWindowDays);
  const [cutoff, setCutoff] = useState(b.cancelCutoffHours);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true); setError(null);
    try {
      const res = await api<{ business: Business }>('/api/business', {
        method: 'PUT',
        body: { name, phone, address, slug: slug.trim().toLowerCase(), leadTimeMin: Math.round(lead * 60), bookingWindowDays: windowDays, cancelCutoffHours: cutoff },
      });
      setBusiness(res.business);
      tap('success');
      router.back();
    } catch (e: any) { setError(e.message); setSaving(false); }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <ErrorBanner message={error} />
        <Field label="Studio name" value={name} onChangeText={setName} />
        <Field label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        <Field label="Address" value={address} onChangeText={setAddress} />
        <Field label="Booking link" value={slug} onChangeText={setSlug} autoCapitalize="none" autoCorrect={false} hint={`…/b/${slug || 'your-studio'}`} />

        <Section title="Booking rules" style={{ marginTop: space.sm }}>
          <Card padded={false} style={{ overflow: 'hidden' }}>
            <Stepper label="Minimum notice" value={lead} unit={lead === 1 ? 'hour' : 'hours'} step={lead < 2 ? 0.5 : 1} min={0} max={72} onChange={setLead} />
            <Divider inset={space.lg} />
            <Stepper label="Book up to" value={windowDays} unit="days ahead" step={windowDays < 30 ? 7 : 15} min={7} max={365} onChange={setWindowDays} />
            <Divider inset={space.lg} />
            <Stepper label="Free cancellation" value={cutoff} unit={cutoff ? 'hours before' : 'anytime'} step={cutoff < 24 ? 6 : 12} min={0} max={168} onChange={setCutoff} hideZero />
          </Card>
        </Section>
        <T v="small" color={c.faint} style={{ marginTop: space.md }}>{`Time zone: ${b.timezone} · Currency: ${b.currency}. Change these on the web dashboard.`}</T>
      </Screen>
      <View style={[styles.bottom, { paddingBottom: insets.bottom + space.md, borderTopColor: c.border, backgroundColor: c.bg }]}>
        <Button title="Save" onPress={save} loading={saving} />
      </View>
    </KeyboardAvoidingView>
  );
}

function Stepper({ label, value, unit, step, min, max, onChange, hideZero }: {
  label: string; value: number; unit: string; step: number; min: number; max: number; onChange: (v: number) => void; hideZero?: boolean;
}) {
  const c = useColors();
  return (
    <View style={styles.stepRow}>
      <View style={{ flex: 1 }}>
        <T v="bodyStrong">{label}</T>
        <T v="small" color={c.muted}>{hideZero && value === 0 ? unit : `${value} ${unit}`}</T>
      </View>
      <IconButton icon="remove" label={`Decrease ${label}`} size={36} onPress={() => onChange(Math.max(min, value - step))} />
      <IconButton icon="add" label={`Increase ${label}`} size={36} onPress={() => onChange(Math.min(max, value + step))} />
    </View>
  );
}

const styles = StyleSheet.create({
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.lg },
  bottom: { paddingHorizontal: space.lg, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth },
});
