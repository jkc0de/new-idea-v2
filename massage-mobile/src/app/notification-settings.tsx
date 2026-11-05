import { useEffect, useState } from 'react';
import { Linking, Platform, StyleSheet, Switch, View } from 'react-native';

import { Button, Card, Divider, ErrorBanner, IconButton, Ionicons, Loading, Screen, Section, T, tap } from '@/components/ui';
import { api } from '@/lib/api';
import { time } from '@/lib/format';
import { enablePush, type PushStatus } from '@/lib/push';
import { space, useColors } from '@/lib/theme';
import { useApi } from '@/lib/use-api';

interface Prefs { newBooking: boolean; cancelled: boolean; rescheduled: boolean; digest: boolean; digestHour: number }

const ROWS: { key: keyof Omit<Prefs, 'digestHour' | 'digest'>; title: string; body: string }[] = [
  { key: 'newBooking', title: 'New online bookings', body: 'When a client books through your link' },
  { key: 'cancelled', title: 'Cancellations', body: 'When a client cancels online — the time is open again' },
  { key: 'rescheduled', title: 'Changed times', body: 'When a client moves their booking' },
];

export default function NotificationSettings() {
  const c = useColors();
  const q = useApi<{ prefs: Prefs; devices: number }>('/api/notifications/prefs');
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [push, setPush] = useState<PushStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (q.data && !prefs) setPrefs(q.data.prefs); }, [q.data, prefs]);
  // Check (without prompting) whether this phone can get pushes.
  useEffect(() => { enablePush({ prompt: false }).then(setPush); }, []);

  if (!prefs) return q.error ? <View style={{ padding: space.lg }}><ErrorBanner message={q.error} /></View> : <Loading />;

  async function save(patch: Partial<Prefs>) {
    const next = { ...prefs!, ...patch };
    setPrefs(next);
    setError(null);
    try { setPrefs((await api<{ prefs: Prefs }>('/api/notifications/prefs', { method: 'PUT', body: patch })).prefs); }
    catch (e: any) { setError(e.message); }
  }

  async function turnOn() {
    setChecking(true);
    const s = await enablePush({ prompt: true });
    setPush(s);
    setChecking(false);
    if (s.state === 'denied' && Platform.OS !== 'web') Linking.openSettings().catch(() => {});
  }

  async function sendTest() {
    setMessage(null); setError(null);
    try {
      const r = await api<{ devices: number; sent: number; error: string | null }>('/api/push/test', { method: 'POST' });
      tap('success');
      setMessage(r.error ? `Saved to your inbox, but sending failed: ${r.error}` : r.sent ? `Sent to ${r.sent} phone${r.sent === 1 ? '' : 's'}.` : 'Saved to your inbox. No phones are signed up for push yet.');
    } catch (e: any) { setError(e.message); }
  }

  const status = push?.state === 'on'
    ? { icon: 'checkmark-circle' as const, color: c.accentStrong, bg: c.accentSoft, title: 'Push alerts are on for this phone', body: `${q.data?.devices ?? 1} phone${(q.data?.devices ?? 1) === 1 ? '' : 's'} signed up for this studio.` }
    : push?.state === 'denied'
      ? { icon: 'notifications-off' as const, color: c.danger, bg: c.dangerSoft, title: 'Notifications are blocked', body: 'Allow notifications for this app in your phone’s Settings.' }
      : { icon: 'information-circle' as const, color: c.warn, bg: c.warnSoft, title: 'Push alerts aren’t available here', body: push?.state === 'unsupported' ? push.reason : 'Checking…' };

  return (
    <Screen>
      <View style={[styles.status, { backgroundColor: status.bg }]}>
        <Ionicons name={status.icon} size={22} color={status.color} />
        <View style={{ flex: 1 }}>
          <T v="bodyStrong" color={status.color}>{status.title}</T>
          <T v="small" color={c.text} style={{ marginTop: 2 }}>{status.body}</T>
        </View>
      </View>
      {push && push.state !== 'on' && push.state !== 'unsupported' && (
        <Button title="Turn on push alerts" icon="notifications-outline" style={{ marginTop: space.md }} loading={checking} onPress={turnOn} />
      )}
      <T v="small" color={c.faint} style={{ marginTop: space.md }}>Everything also lands in the in-app inbox (the bell on Today), even when push is off.</T>

      <ErrorBanner message={error} />
      <Section title="Alert me about">
        <Card padded={false} style={{ overflow: 'hidden' }}>
          {ROWS.map((r, i) => (
            <View key={r.key}>
              {i > 0 && <Divider inset={space.lg} />}
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <T v="bodyStrong">{r.title}</T>
                  <T v="small" color={c.muted}>{r.body}</T>
                </View>
                <Switch value={prefs[r.key]} onValueChange={(v) => save({ [r.key]: v })} trackColor={{ true: c.accent, false: c.border }} thumbColor="#fff" accessibilityLabel={r.title} />
              </View>
            </View>
          ))}
        </Card>
        <T v="small" color={c.faint} style={{ marginTop: space.sm }}>Bookings and changes your team makes in the app don’t send alerts.</T>
      </Section>

      <Section title="Morning summary">
        <Card padded={false} style={{ overflow: 'hidden' }}>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <T v="bodyStrong">Daily summary</T>
              <T v="small" color={c.muted}>Today’s bookings, first appointment, expected takings and anything that needs fixing</T>
            </View>
            <Switch value={prefs.digest} onValueChange={(v) => save({ digest: v })} trackColor={{ true: c.accent, false: c.border }} thumbColor="#fff" accessibilityLabel="Daily summary" />
          </View>
          {prefs.digest && (
            <>
              <Divider inset={space.lg} />
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <T v="bodyStrong">Send at</T>
                  <T v="small" color={c.muted}>Studio time</T>
                </View>
                <IconButton icon="remove" label="Earlier" size={36} onPress={() => save({ digestHour: (prefs.digestHour + 23) % 24 })} />
                <T v="bodyStrong" style={{ minWidth: 76, textAlign: 'center' }}>{time(prefs.digestHour * 60)}</T>
                <IconButton icon="add" label="Later" size={36} onPress={() => save({ digestHour: (prefs.digestHour + 1) % 24 })} />
              </View>
            </>
          )}
        </Card>
      </Section>

      <Button title="Send a test notification" kind="secondary" icon="paper-plane-outline" style={{ marginTop: space.xl }} onPress={sendTest} />
      {message ? <T v="small" color={c.muted} center style={{ marginTop: space.sm }}>{message}</T> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  status: { flexDirection: 'row', gap: space.md, padding: space.lg, borderRadius: 16, alignItems: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.lg },
});
