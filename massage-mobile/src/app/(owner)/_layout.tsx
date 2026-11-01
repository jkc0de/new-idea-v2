import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { Platform } from 'react-native';

import { Ionicons, type IconName } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useColors } from '@/lib/theme';

const TABS: { name: string; title: string; icon: IconName; iconOn: IconName }[] = [
  { name: 'index', title: 'Today', icon: 'today-outline', iconOn: 'today' },
  { name: 'schedule', title: 'Schedule', icon: 'grid-outline', iconOn: 'grid' },
  { name: 'bookings', title: 'Bookings', icon: 'calendar-outline', iconOn: 'calendar' },
  { name: 'clients', title: 'Clients', icon: 'people-outline', iconOn: 'people' },
  { name: 'more', title: 'Studio', icon: 'storefront-outline', iconOn: 'storefront' },
];

export default function OwnerTabs() {
  const { business } = useAuth();
  const c = useColors();
  if (!business) return <Redirect href="/welcome" />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.accentStrong,
        tabBarInactiveTintColor: c.faint,
        // Web has no safe-area inset, so give the labels a little room there.
        tabBarStyle: [{ backgroundColor: c.surface, borderTopColor: c.border }, Platform.OS === 'web' && { height: 64, paddingBottom: 8 }],
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        sceneStyle: { backgroundColor: c.bg },
      }}
    >
      {TABS.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          options={{
            title: t.title,
            tabBarIcon: ({ focused, color, size }) => <Ionicons name={focused ? t.iconOn : t.icon} size={size} color={color as string} />,
          }}
        />
      ))}
    </Tabs>
  );
}
