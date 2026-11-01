import { router } from 'expo-router';
import { View } from 'react-native';

import { Button, Card, Divider, Empty, ErrorBanner, Loading, Row, RowIcon, Screen, Section } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { duration, money } from '@/lib/format';
import { space, useColors } from '@/lib/theme';
import type { Service } from '@/lib/types';
import { useApi } from '@/lib/use-api';

export default function Services() {
  const c = useColors();
  const { business } = useAuth();
  const q = useApi<{ services: Service[] }>('/api/services');
  if (!q.data) return q.error ? <ErrorBanner message={q.error} onRetry={q.reload} /> : <Loading />;
  const active = q.data.services.filter((s) => s.active);
  const hidden = q.data.services.filter((s) => !s.active);

  const list = (items: Service[], dim = false) => (
    <Card padded={false} style={{ overflow: 'hidden' }}>
      {items.map((s, i) => (
        <View key={s.id}>
          {i > 0 && <Divider inset={space.lg + 36 + space.md} />}
          <Row
            left={<RowIcon icon="leaf" bg={dim ? c.surface2 : c.accentSoft} color={dim ? c.faint : c.accentStrong} />}
            title={s.name}
            subtitle={`${duration(s.durationMin)} · ${money(s.priceCents, business?.currency)}${s.bufferMin ? ` · ${s.bufferMin}m reset` : ''}`}
            onPress={() => router.push({ pathname: '/service/[id]', params: { id: String(s.id) } })}
          />
        </View>
      ))}
    </Card>
  );

  return (
    <Screen onRefresh={q.refresh} refreshing={q.refreshing}>
      {q.data.services.length === 0 && <Empty icon="leaf-outline" title="Build your menu" body="Add treatments with their length and price. Then assign them to your team." />}
      {active.length > 0 && <Section title="On your menu" style={{ marginTop: 0 }}>{list(active)}</Section>}
      {hidden.length > 0 && <Section title="Hidden">{list(hidden, true)}</Section>}
      <Button title="Add service" icon="add" style={{ marginTop: space.xl }} onPress={() => router.push({ pathname: '/service/[id]', params: { id: 'new' } })} />
    </Screen>
  );
}
