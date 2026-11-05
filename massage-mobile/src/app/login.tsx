import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';

import { Button, ErrorBanner, Field, Screen, Segmented, T } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { space, useColors } from '@/lib/theme';

export default function Login() {
  const c = useColors();
  const { login, signup } = useAuth();
  const params = useLocalSearchParams<{ mode?: string }>();
  const [mode, setMode] = useState<'login' | 'signup'>(params.mode === 'signup' ? 'signup' : 'login');
  const [businessName, setBusinessName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      if (mode === 'login') await login(email.trim(), password);
      else await signup(businessName.trim(), email.trim(), password);
      router.dismissAll();
      router.replace('/(owner)');
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <T v="title">{mode === 'login' ? 'Welcome back' : 'Set up your studio'}</T>
        <T v="body" color={c.muted} style={{ marginTop: 6, marginBottom: space.xl }}>
          {mode === 'login' ? 'Log in to manage your bookings.' : 'Free to start. Takes about a minute.'}
        </T>
        <Segmented options={[{ key: 'login', label: 'Log in' }, { key: 'signup', label: 'Create account' }]} value={mode} onChange={(m) => { setMode(m); setError(null); }} />
        <View style={{ height: space.xl }} />
        <ErrorBanner message={error} />
        {mode === 'signup' && <Field label="Studio name" value={businessName} onChangeText={setBusinessName} placeholder="e.g. Harmony Massage" />}
        <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="username" placeholder="you@studio.com" />
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          textContentType={mode === 'login' ? 'password' : 'newPassword'} placeholder={mode === 'signup' ? 'At least 8 characters' : ''} onSubmitEditing={submit} returnKeyType="go" />
        <Button title={mode === 'login' ? 'Log in' : 'Create account'} onPress={submit} loading={busy} />
        {mode === 'login' && <T v="small" color={c.faint} center style={{ marginTop: space.lg }}>Demo: demo@serenity.test / demo1234</T>}
      </Screen>
    </KeyboardAvoidingView>
  );
}
