import { Redirect, useLocalSearchParams } from 'expo-router';

import { useAuth } from '@/lib/auth';

export default function Index() {
  const { business } = useAuth();
  // Keep deep-link params like ?date=…&therapistId=… when forwarding to Today.
  const params = useLocalSearchParams<Record<string, string>>();
  if (!business) return <Redirect href="/welcome" />;
  return <Redirect href={{ pathname: '/(owner)', params }} />;
}
