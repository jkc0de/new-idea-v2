import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Modal, ScrollView, Share, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BookingFlow, type BookedResult } from '@/components/booking-flow';
import { SlotPicker, type DayAvail } from '@/components/bk-slot-picker';
import { Button, Card, Chip, ErrorBanner, IconButton, Ionicons, T, tap } from '@/components/ui';
import { api, getBaseUrl, qs } from '@/lib/api';
import { confirmAsync } from '@/lib/confirm';
import { addDays, fmtDate, fmtDateLong, money, time } from '@/lib/format';
import { radius, space, useColors } from '@/lib/theme';
import type { Appointment, Business, Slot } from '@/lib/types';

export default function BookScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const [done, setDone] = useState<BookedResult | null>(null);
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  if (done) return <Confirmation result={done} slug={slug} onDone={close} onAgain={() => setDone(null)} />;
  return <BookingFlow slug={slug} mode="public" onClose={close} onBooked={setDone} />;
}

function Confirmation({ result, slug, onDone, onAgain }: { result: BookedResult; slug: string; onDone: () => void; onAgain: () => void }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { business: b, manageToken } = result;
  const [a, setA] = useState<Appointment>(result.appointment);
  const [changing, setChanging] = useState(false);
  const [moved, setMoved] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scale = useRef(new Animated.Value(0.4)).current;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, friction: 5, tension: 90, useNativeDriver: true }),
      Animated.timing(fade, { toValue: 1, duration: 350, delay: 150, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start();
  }, [scale, fade]);

  const manageUrl = `${getBaseUrl()}/b/${slug}/manage?ref=${encodeURIComponent(a.ref)}&token=${encodeURIComponent(manageToken ?? '')}`;

  async function cancel() {
    if (!(await confirmAsync('Cancel your appointment?', undefined, 'Cancel appointment', true))) return;
    try {
      await api(`/api/public/booking/${encodeURIComponent(a.ref)}/cancel`, { method: 'POST', body: { token: manageToken } });
      setCancelled(true);
    } catch (e: any) { setError(e.message); }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: space.lg, paddingTop: insets.top + space.xxl, paddingBottom: insets.bottom + space.xl }}>
      <View style={{ alignItems: 'center' }}>
        <Animated.View style={[styles.check, { backgroundColor: cancelled ? c.surface2 : c.accent, transform: [{ scale }] }]}>
          <Ionicons name={cancelled ? 'close' : 'checkmark'} size={48} color={cancelled ? c.muted : c.onAccent} />
        </Animated.View>
        <T v="title" center style={{ marginTop: space.xl }}>{cancelled ? 'Booking cancelled' : moved ? 'Time changed' : 'You’re booked!'}</T>
        <T v="body" color={c.muted} center style={{ marginTop: 6 }}>{cancelled ? 'We hope to see you another time.' : `See you soon at ${b.name}.`}</T>
      </View>

      <Animated.View style={{ opacity: fade }}>
        <Card style={{ marginTop: space.xl }}>
          <T v="heading">{a.serviceName}</T>
          <View style={styles.line}><Ionicons name="calendar-outline" size={18} color={c.muted} /><T v="body">{fmtDateLong(a.date)}</T></View>
          <View style={styles.line}><Ionicons name="time-outline" size={18} color={c.muted} /><T v="body">{`${time(a.startMin)} – ${time(a.endMin)}`}</T></View>
          <View style={styles.line}><Ionicons name="person-outline" size={18} color={c.muted} /><T v="body">{a.therapistName}</T></View>
          {b.address ? <View style={styles.line}><Ionicons name="location-outline" size={18} color={c.muted} /><T v="body" style={{ flex: 1 }}>{b.address}</T></View> : null}
          <View style={[styles.footer, { borderTopColor: c.border }]}>
            <View>
              <T v="caption" color={c.muted}>REFERENCE</T>
              <T v="bodyStrong" style={{ letterSpacing: 1.5, marginTop: 2 }}>{a.ref}</T>
            </View>
            <T v="heading" color={c.accentStrong}>{money(a.priceCents, b.currency)}</T>
          </View>
        </Card>

        <ErrorBanner message={error} />
        {!cancelled && (
          <View style={[styles.tip, { backgroundColor: c.surface2 }]}>
            <Ionicons name="bookmark-outline" size={18} color={c.muted} />
            <T v="small" color={c.muted} style={{ flex: 1 }}>Save your booking link so you can view or cancel it later.</T>
          </View>
        )}

        <View style={{ gap: space.sm, marginTop: space.xl }}>
          {!cancelled && <Button title="Change time" icon="calendar-outline" kind="secondary" onPress={() => { setError(null); setChanging(true); }} />}
          {!cancelled && <Button title="Save booking link" icon="share-outline" kind="secondary" onPress={() => Share.share({ message: `My ${b.name} booking (${a.ref}): ${manageUrl}`, url: manageUrl })} />}
          {cancelled ? <Button title="Book another time" onPress={onAgain} /> : <Button title="Done" onPress={onDone} />}
          {!cancelled && <Button title="Cancel booking" kind="ghost" onPress={cancel} />}
        </View>
      </Animated.View>

      <ChangeTime
        visible={changing}
        slug={slug}
        business={b}
        appointment={a}
        token={manageToken ?? ''}
        onClose={() => setChanging(false)}
        onChanged={(next) => { setA({ ...a, ...next }); setMoved(true); setChanging(false); }}
      />
    </ScrollView>
  );
}

/** Client picks a new time for the same treatment. Their current booking doesn't block its own slot. */
function ChangeTime({ visible, slug, business, appointment: a, token, onClose, onChanged }: {
  visible: boolean; slug: string; business: Business; appointment: Appointment; token: string;
  onClose: () => void; onChanged: (a: Appointment) => void;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [same, setSame] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<number | null>(null);
  const today = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);
  const base = `/api/public/${encodeURIComponent(slug)}`;
  const p = { serviceId: a.serviceId, therapistId: same ? a.therapistId : null, ref: a.ref, token };

  async function pick(s: Slot, date: string) {
    const ok = await confirmAsync('Move your appointment?', `${fmtDateLong(date)} at ${time(s.startMin)}`, 'Move');
    if (!ok) return;
    setSaving(s.startMin);
    setError(null);
    try {
      const r = await api<{ appointment: Appointment }>(`/api/public/booking/${encodeURIComponent(a.ref)}/reschedule`, {
        method: 'POST', body: { token, date, startMin: s.startMin, ...(same ? { therapistId: a.therapistId } : {}) },
      });
      tap('success');
      onChanged(r.appointment);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(null);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        <View style={[styles.modalHead, { paddingTop: space.lg, borderBottomColor: c.border }]}>
          <View style={{ flex: 1 }}>
            <T v="heading">Change time</T>
            <T v="small" color={c.muted} numberOfLines={1}>{`${a.serviceName} · now ${fmtDate(a.date)} ${time(a.startMin)}`}</T>
          </View>
          <IconButton icon="close" label="Close" onPress={onClose} />
        </View>
        <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl }}>
          <View style={{ flexDirection: 'row', gap: space.sm, marginBottom: space.xl }}>
            <Chip label={`With ${a.therapistName.split(' ')[0]}`} selected={same} onPress={() => setSame(true)} />
            <Chip label="Any therapist" icon="sparkles-outline" selected={!same} onPress={() => setSame(false)} />
          </View>
          <ErrorBanner message={error} />
          {saving !== null && <T v="small" color={c.muted} style={{ marginBottom: space.sm }}>{`Moving to ${time(saving)}…`}</T>}
          {visible && (
            <SlotPicker
              today={today}
              lastDay={addDays(today, business.bookingWindowDays)}
              reloadKey={same ? 'same' : 'any'}
              initialDate={a.date}
              selectedStart={{ date: a.date, startMin: a.startMin }}
              fetchDays={(from, count) => api<{ days: DayAvail[] }>(`${base}/days?${qs({ ...p, from, count })}`).then((r) => r.days)}
              fetchSlots={(date) => api<{ slots: Slot[] }>(`${base}/slots?${qs({ ...p, date })}`).then((r) => r.slots)}
              onPick={pick}
            />
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  check: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center' },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.md },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: space.lg, paddingTop: space.lg, borderTopWidth: StyleSheet.hairlineWidth },
  modalHead: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingBottom: space.md, borderBottomWidth: StyleSheet.hairlineWidth },
  tip: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md, marginTop: space.lg },
});
