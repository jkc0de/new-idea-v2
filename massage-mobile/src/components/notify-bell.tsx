import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { setAppBadge } from '@/lib/push';
import { useColors } from '@/lib/theme';
import { useApi } from '@/lib/use-api';

import { Ionicons, tap } from './ui';

/** Bell with an unread count; opens the notification inbox. Refreshes when the screen regains focus. */
export function NotifyBell() {
  const c = useColors();
  const q = useApi<{ unread: number }>('/api/notifications?limit=1');
  const unread = q.data?.unread ?? 0;
  useEffect(() => { if (q.data) setAppBadge(unread); }, [q.data, unread]);
  return (
    <Pressable
      onPress={() => { tap(); router.push('/notifications'); }}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={unread ? `Notifications, ${unread} unread` : 'Notifications'}
      style={({ pressed }) => [styles.btn, { backgroundColor: c.surface2 }, pressed && { opacity: 0.7 }]}
    >
      <Ionicons name={unread ? 'notifications' : 'notifications-outline'} size={20} color={c.text} />
      {unread > 0 && (
        <View style={[styles.badge, { backgroundColor: c.danger, borderColor: c.bg }]}>
          <Text style={styles.badgeText}>{unread > 99 ? '99+' : unread}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: -3, right: -4, minWidth: 19, height: 19, borderRadius: 10, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
});
