import { router, Stack } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { Button, Empty, ErrorBanner, Ionicons, Loading, T, tap, type IconName } from '@/components/ui';
import { api } from '@/lib/api';
import { setAppBadge } from '@/lib/push';
import { radius, space, useColors } from '@/lib/theme';
import { useApi } from '@/lib/use-api';

interface Note {
  id: number; type: string; title: string; body: string; data: { url?: string }; createdAt: string; read: boolean;
}

const ICON: Record<string, [IconName, 'accent' | 'danger' | 'warn' | 'muted']> = {
  new_booking: ['calendar', 'accent'],
  cancelled: ['close-circle', 'danger'],
  rescheduled: ['swap-horizontal', 'warn'],
  digest: ['sunny', 'warn'],
  test: ['notifications', 'muted'],
};

/** "2m ago", "3h ago", "Yesterday", or a date. `at` is UTC "YYYY-MM-DD HH:MM:SS". */
function ago(at: string) {
  const then = new Date(at.replace(' ', 'T') + 'Z');
  const mins = Math.round((Date.now() - then.getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)}h ago`;
  if (mins < 48 * 60) return 'Yesterday';
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function NotificationsScreen() {
  const c = useColors();
  const q = useApi<{ notifications: Note[]; unread: number }>('/api/notifications?limit=100');
  const unread = q.data?.unread ?? 0;
  useEffect(() => { if (q.data) setAppBadge(unread); }, [q.data, unread]);

  const markAll = useCallback(async () => {
    tap();
    const r = await api<{ unread: number }>('/api/notifications/read', { method: 'POST', body: {} });
    if (q.data) q.setData({ notifications: q.data.notifications.map((n) => ({ ...n, read: true })), unread: r.unread });
  }, [q]);

  const open = async (n: Note) => {
    tap();
    if (!n.read) {
      api('/api/notifications/read', { method: 'POST', body: { ids: [n.id] } }).catch(() => {});
      if (q.data) q.setData({ notifications: q.data.notifications.map((x) => (x.id === n.id ? { ...x, read: true } : x)), unread: Math.max(0, unread - 1) });
    }
    if (n.data?.url && n.data.url !== '/notifications') router.push(n.data.url as any);
  };

  if (!q.data) return q.error ? <View style={{ padding: space.lg }}><ErrorBanner message={q.error} onRetry={q.reload} /></View> : <Loading />;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Stack.Screen options={{
        headerRight: () => (
          <Pressable onPress={() => router.push('/notification-settings')} hitSlop={10} accessibilityLabel="Notification settings">
            <Ionicons name="settings-outline" size={22} color={c.accentStrong} />
          </Pressable>
        ),
      }} />
      <FlatList
        data={q.data.notifications}
        keyExtractor={(n) => String(n.id)}
        refreshControl={<RefreshControl refreshing={q.refreshing} onRefresh={q.refresh} tintColor={c.accent} />}
        contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxl, gap: space.sm }}
        ListHeaderComponent={unread ? (
          <View style={styles.head}>
            <T v="small" color={c.muted}>{`${unread} unread`}</T>
            <Button title="Mark all read" kind="ghost" size="sm" onPress={markAll} />
          </View>
        ) : undefined}
        renderItem={({ item: n }) => {
          const [icon, tone] = ICON[n.type] ?? ['notifications', 'muted'];
          const fg = { accent: c.accentStrong, danger: c.danger, warn: c.warn, muted: c.muted }[tone];
          const bg = { accent: c.accentSoft, danger: c.dangerSoft, warn: c.warnSoft, muted: c.surface2 }[tone];
          return (
            <Pressable onPress={() => open(n)} accessibilityRole="button" accessibilityLabel={`${n.read ? '' : 'Unread. '}${n.title}. ${n.body}`}
              style={({ pressed }) => [styles.item, { backgroundColor: n.read ? c.bg : c.surface, borderColor: n.read ? c.border : c.surface }, pressed && { opacity: 0.8 }]}>
              <View style={[styles.icon, { backgroundColor: bg }]}><Ionicons name={icon} size={18} color={fg} /></View>
              <View style={{ flex: 1, gap: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                  <T v="bodyStrong" style={{ flex: 1, fontSize: 15 }} numberOfLines={1}>{n.title}</T>
                  <T v="small" color={c.faint}>{ago(n.createdAt)}</T>
                </View>
                <T v="small" color={c.muted}>{n.body}</T>
              </View>
              {!n.read && <View style={[styles.dot, { backgroundColor: c.accent }]} />}
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <Empty icon="notifications-outline" title="No notifications yet"
            body="You'll be alerted here when clients book, cancel or move a booking online — and each morning with the day ahead."
            action={<Button title="Notification settings" kind="secondary" size="md" onPress={() => router.push('/notification-settings')} />} />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.xs },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 9, height: 9, borderRadius: 5, marginTop: 6 },
});
