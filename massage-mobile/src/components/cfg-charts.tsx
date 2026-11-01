import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { radius, space, useColors } from '@/lib/theme';

import { T, tap } from './ui';

/**
 * Small chart primitives built from Views. One series each, single accent hue,
 * text stays in ink colors; marks get 4px rounded data-ends and a 2px gap.
 */

/** Vertical bars with tap-to-inspect. `label(i)` is shown above the chart for the selected bar. */
export function Bars({ values, height = 120, labels, describe, highlightLast = false }: {
  values: number[]; height?: number; labels?: (string | null)[]; describe: (i: number) => string; highlightLast?: boolean;
}) {
  const c = useColors();
  const [sel, setSel] = useState<number | null>(null);
  const max = Math.max(1, ...values);
  const gap = values.length > 40 ? 1 : 2;
  return (
    <View>
      <T v="small" color={sel === null ? c.faint : c.text} style={{ marginBottom: space.sm, fontWeight: sel === null ? '400' : '600' }}>
        {sel === null ? 'Tap a bar for details' : describe(sel)}
      </T>
      <View style={[styles.barsRow, { height, gap }]}>
        {values.map((v, i) => {
          const on = sel === i || (sel === null && highlightLast && i === values.length - 1);
          return (
            <Pressable key={i} onPress={() => { tap(); setSel(sel === i ? null : i); }} accessibilityLabel={describe(i)}
              style={{ flex: 1, height: '100%', justifyContent: 'flex-end' }} hitSlop={{ top: 8, bottom: 8 }}>
              <View style={{
                height: v > 0 ? Math.max(3, (v / max) * height) : 2,
                backgroundColor: v > 0 ? c.accent : c.border,
                opacity: sel === null || on ? 1 : 0.35,
                borderTopLeftRadius: 4, borderTopRightRadius: 4,
              }} />
            </Pressable>
          );
        })}
      </View>
      <View style={[styles.axis, { borderTopColor: c.border }]} />
      {labels && (
        <View style={{ flexDirection: 'row', gap }}>
          {labels.map((l, i) => (
            <View key={i} style={{ flex: 1, alignItems: 'center', overflow: 'visible' }}>
              {l ? <T v="caption" color={c.muted} style={{ fontWeight: '500', letterSpacing: 0, width: 48, textAlign: 'center' }} numberOfLines={1}>{l}</T> : null}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

/** Horizontal meter row: label, value text, and a fill on a track. */
export function Meter({ label, value, ratio, sub }: { label: string; value: string; ratio: number; sub?: string }) {
  const c = useColors();
  const pct = Math.max(0, Math.min(1, ratio));
  return (
    <View style={{ marginBottom: space.lg }}>
      <View style={styles.meterHead}>
        <T v="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>{label}</T>
        <T v="bodyStrong">{value}</T>
      </View>
      <View style={[styles.track, { backgroundColor: c.surface2 }]}>
        <View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: c.accent }]} />
      </View>
      {sub ? <T v="small" color={c.muted} style={{ marginTop: 4 }}>{sub}</T> : null}
    </View>
  );
}

/** Single-hue heat strip (light → dark = less → more). */
export function HeatStrip({ cells, describe }: { cells: { label: string; value: number }[]; describe: (i: number) => string }) {
  const c = useColors();
  const [sel, setSel] = useState<number | null>(null);
  const max = Math.max(1, ...cells.map((x) => x.value));
  return (
    <View>
      <T v="small" color={sel === null ? c.faint : c.text} style={{ marginBottom: space.sm, fontWeight: sel === null ? '400' : '600' }}>
        {sel === null ? 'Darker = busier. Tap for details' : describe(sel)}
      </T>
      <View style={{ flexDirection: 'row', gap: 2 }}>
        {cells.map((x, i) => (
          <Pressable key={i} onPress={() => { tap(); setSel(sel === i ? null : i); }} accessibilityLabel={describe(i)} style={{ flex: 1 }}>
            <View style={[styles.cell, { backgroundColor: x.value ? c.accent : c.surface2, opacity: x.value ? 0.15 + 0.85 * (x.value / max) : 1 }, sel === i && { borderWidth: 2, borderColor: c.text }]} />
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 2, marginTop: 4 }}>
        {cells.map((x, i) => (
          <View key={i} style={{ flex: 1, alignItems: 'center' }}>
            {i % 3 === 0 ? <T v="caption" color={c.muted} style={{ fontWeight: '500', letterSpacing: 0, width: 40, textAlign: 'center' }}>{x.label}</T> : null}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  barsRow: { flexDirection: 'row', alignItems: 'flex-end' },
  axis: { borderTopWidth: StyleSheet.hairlineWidth, marginBottom: 4 },
  meterHead: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, marginBottom: 6 },
  track: { height: 10, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
  cell: { height: 32, borderRadius: 4 },
});
