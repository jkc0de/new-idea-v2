import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar, Divider, Empty, ErrorBanner, Ionicons, Loading, Row, T } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { radius, space, useColors } from '@/lib/theme';
import type { Client } from '@/lib/types';
import { useApi } from '@/lib/use-api';

export default function Clients() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { const t = setTimeout(() => setQ(search.trim()), 250); return () => clearTimeout(t); }, [search]);
  const res = useApi<{ clients: Client[] }>(`/api/clients?q=${encodeURIComponent(q)}`);
  const clients = res.data?.clients ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ paddingTop: insets.top + space.md, paddingHorizontal: space.lg, paddingBottom: space.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: space.lg }}>
          <T v="title">Clients</T>
          {res.data && <T v="small" color={c.muted}>{`${clients.length}${q ? ' found' : ' total'}`}</T>}
        </View>
        <View style={[styles.search, { backgroundColor: c.surface2 }]}>
          <Ionicons name="search" size={18} color={c.muted} />
          <TextInput value={search} onChangeText={setSearch} placeholder="Search name, email or phone" placeholderTextColor={c.faint}
            style={{ flex: 1, fontSize: 16, color: c.text, height: 44 }} autoCorrect={false} clearButtonMode="while-editing" accessibilityLabel="Search clients" />
        </View>
      </View>
      <ErrorBanner message={res.error} onRetry={res.reload} />
      {res.loading && !res.data ? <Loading /> : (
        <FlatList
          data={clients}
          keyExtractor={(x) => String(x.id)}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={res.refreshing} onRefresh={res.refresh} tintColor={c.accent} />}
          contentContainerStyle={{ paddingBottom: 40 }}
          ItemSeparatorComponent={() => <Divider inset={space.lg + 44 + space.md} />}
          renderItem={({ item }) => (
            <Row
              left={<Avatar name={item.name} seed={item.id} />}
              title={item.name}
              subtitle={[
                item.visits ? `${item.visits} visit${item.visits === 1 ? '' : 's'}` : 'No visits yet',
                item.lastVisit ? `last ${fmtDate(item.lastVisit, { month: 'short', day: 'numeric' })}` : null,
              ].filter(Boolean).join(' · ')}
              right={item.notes ? <Ionicons name="document-text-outline" size={16} color={c.faint} /> : undefined}
              onPress={() => router.push({ pathname: '/client/[id]', params: { id: String(item.id) } })}
            />
          )}
          ListEmptyComponent={<Empty icon="people-outline" title={q ? 'No matches' : 'No clients yet'} body={q ? 'Try a different search.' : 'Clients appear here after their first booking.'} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, borderRadius: radius.md },
});
