import { Redirect } from 'expo-router';

import { useAuth } from '@/lib/auth';

export default function Index() {
  const { business } = useAuth();
  return <Redirect href={business ? '/(owner)' : '/welcome'} />;
}
