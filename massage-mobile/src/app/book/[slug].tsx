import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, ScrollView, Share, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BookingFlow, type BookedResult } from '@/components/booking-flow';
import { Button, Card, ErrorBanner, Ionicons, T } from '@/components/ui';
import { api, getBaseUrl } from '@/lib/api';
import { confirmAsync } from '@/lib/confirm';
import { fmtDateLong, money, time } from '@/lib/format';
import { radius, space, useColors } from '@/lib/theme';

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
  const { appointment: a, business: b, manageToken } = result;
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
        <T v="title" center style={{ marginTop: space.xl }}>{cancelled ? 'Booking cancelled' : 'You’re booked!'}</T>
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
          {!cancelled && <Button title="Save booking link" icon="share-outline" kind="secondary" onPress={() => Share.share({ message: `My ${b.name} booking (${a.ref}): ${manageUrl}`, url: manageUrl })} />}
          {cancelled ? <Button title="Book another time" onPress={onAgain} /> : <Button title="Done" onPress={onDone} />}
          {!cancelled && <Button title="Cancel booking" kind="ghost" onPress={cancel} />}
        </View>
      </Animated.View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  check: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center' },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.md },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: space.lg, paddingTop: space.lg, borderTopWidth: StyleSheet.hairlineWidth },
  tip: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md, marginTop: space.lg },
});
