import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from './api';

/**
 * Fetch JSON for a screen. Refetches when the path changes and when the screen regains focus
 * (so edits made on a pushed screen show up after going back).
 */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [refreshing, setRefreshing] = useState(false);
  const latest = useRef(path);
  latest.current = path;

  const load = useCallback(async (mode: 'initial' | 'refresh' | 'silent' = 'initial') => {
    if (!path) return;
    if (mode === 'initial') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);
    try {
      const res = await api<T>(path);
      if (latest.current === path) { setData(res); setError(null); }
    } catch (e: any) {
      if (latest.current === path) setError(e.message);
    } finally {
      if (latest.current === path) { setLoading(false); setRefreshing(false); }
    }
  }, [path]);

  useEffect(() => { load('initial'); }, [load]);

  const first = useRef(true);
  useFocusEffect(useCallback(() => {
    if (first.current) { first.current = false; return; }
    load('silent');
  }, [load]));

  return { data, error, loading, refreshing, reload: () => load('silent'), refresh: () => load('refresh'), setData };
}
