import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Bars, HeatStrip, Meter } from '@/components/cfg-charts';
import { Card, Empty, ErrorBanner, Ionicons, Loading, Screen, Section, Segmented, T, type IconName } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { addDays, fmtDate, money, WEEKDAYS } from '@/lib/format';
import { radius, space, useColors } from '@/lib/theme';
import type { Report, Stats } from '@/lib/types';
import { useApi } from '@/lib/use-api';

type Period = '7' | '30' | '90';
const pct = (x: number) => `${Math.round(x * 100)}%`;
const hrs = (min: number) => { const h = min / 60; return `${Number.isInteger(h) ? h : h.toFixed(1)}h`; };
const hourLabel = (h: number) => `${h % 12 || 12}${h < 12 ? 'a' : 'p'}`;

export default function Insights() {
  const c = useColors();
  const { business } = useAuth();
  const cur = business?.currency;
  const [period, setPeriod] = useState<Period>('30');
  const stats = useApi<Stats>('/api/stats');
  const today = stats.data?.today;
  const q = useApi<Report>(today ? `/api/reports?from=${addDays(today, -(Number(period) - 1))}&to=${today}` : null);
  const r = q.data;

  return (
    <Screen onRefresh={q.refresh} refreshing={q.refreshing}>
      <Segmented options={[{ key: '7', label: '7 days' }, { key: '30', label: '30 days' }, { key: '90', label: '90 days' }]} value={period} onChange={setPeriod} />
      <ErrorBanner message={q.error} onRetry={q.reload} />
      {!r ? <Loading /> : r.bookings === 0 ? (
        <Empty icon="stats-chart-outline" title="No bookings in this period" body="Insights appear once you have bookings." />
      ) : (
        <>
          {/* hero */}
          <Card style={{ marginTop: space.lg }}>
            <T v="caption" color={c.muted}>REVENUE · COMPLETED</T>
            <T v="hero" style={{ marginTop: 4 }}>{money(r.revenueCents, cur)}</T>
            <T v="small" color={c.muted}>{`${fmtDate(r.from, { month: 'short', day: 'numeric' })} – ${fmtDate(r.to, { month: 'short', day: 'numeric' })} · ${r.completed} sessions`}</T>
            {r.expectedCents > 0 && (
              <View style={[styles.expected, { backgroundColor: c.accentSoft }]}>
                <Ionicons name="time-outline" size={16} color={c.accentStrong} />
                <T v="small" color={c.accentStrong} style={{ fontWeight: '600' }}>{`${money(r.expectedCents, cur)} still booked in this period`}</T>
              </View>
            )}
          </Card>

          {/* KPIs */}
          <View style={styles.grid}>
            <Kpi icon="pie-chart-outline" label="Utilization" value={pct(r.utilization)} sub={`${hrs(r.bookedMin)} of ${hrs(r.availableMin)} sold`} />
            <Kpi icon="receipt-outline" label="Avg ticket" value={money(r.avgTicketCents, cur)} sub="per completed visit" />
            <Kpi icon="person-remove-outline" label="No-show rate" value={pct(r.noShowRate)} sub={`${r.noShows} no-show${r.noShows === 1 ? '' : 's'}`} warn={r.noShowRate > 0.08} />
            <Kpi icon="close-circle-outline" label="Cancellations" value={pct(r.cancellationRate)} sub={`${r.cancelled} of ${r.bookings} bookings`} warn={r.cancellationRate > 0.15} />
            <Kpi icon="people-outline" label="Clients" value={String(r.clients.total)} sub={`${r.clients.new} new · ${r.clients.returning} returning`} />
            <Kpi icon="calendar-outline" label="Bookings" value={String(r.bookings)} sub={`${r.upcoming} still upcoming`} />
          </View>

          {/* daily revenue */}
          <Section title="Daily revenue">
            <Card>
              <Bars
                values={r.daily.map((d) => d.revenueCents)}
                labels={r.daily.length <= 7 ? r.daily.map((d) => fmtDate(d.date, { weekday: 'short' })) : undefined}
                edgeLabels={r.daily.length > 7 ? [fmtDate(r.from, { month: 'short', day: 'numeric' }), fmtDate(r.to, { month: 'short', day: 'numeric' })] : undefined}
                describe={(i) => `${fmtDate(r.daily[i].date)} · ${money(r.daily[i].revenueCents, cur)} · ${r.daily[i].sessions} sessions · ${pct(r.daily[i].utilization)} booked`}
              />
            </Card>
          </Section>

          {/* utilization per day */}
          <Section title="How full each day was">
            <Card>
              <Bars
                height={70}
                values={r.daily.map((d) => d.utilization)}
                edgeLabels={r.daily.length > 7 ? [fmtDate(r.from, { month: 'short', day: 'numeric' }), fmtDate(r.to, { month: 'short', day: 'numeric' })] : undefined}
                describe={(i) => `${fmtDate(r.daily[i].date)} · ${pct(r.daily[i].utilization)} of therapist time booked`}
              />
              <T v="small" color={c.faint} style={{ marginTop: space.sm }}>Booked massage time ÷ working time (after time off).</T>
            </Card>
          </Section>

          {/* therapists */}
          <Section title="Therapist utilization">
            <Card>
              {r.byTherapist.map((t) => (
                <Meter key={t.id} label={t.name} value={pct(t.utilization)} ratio={t.utilization}
                  sub={`${hrs(t.bookedMin)} of ${hrs(t.availableMin)} · ${t.sessions} sessions · ${money(t.revenueCents, cur)}${t.noShows ? ` · ${t.noShows} no-show${t.noShows === 1 ? '' : 's'}` : ''}`} />
              ))}
              <T v="small" color={c.faint}>Low utilization = unsold time. Consider trimming shifts or promoting those hours.</T>
            </Card>
          </Section>

          {/* services */}
          <Section title="Top services">
            <Card>
              {r.byService.slice(0, 6).map((s) => (
                <Meter key={s.id} label={s.name} value={String(s.count)} ratio={s.count / Math.max(1, r.byService[0].count)} sub={`${money(s.revenueCents, cur)} revenue`} />
              ))}
            </Card>
          </Section>

          {/* weekdays */}
          <Section title="Busiest days">
            <Card>
              {(() => {
                // Monday-first for readability.
                const order = [1, 2, 3, 4, 5, 6, 0];
                const days = order.map((d) => r.byWeekday[d]);
                return (
                  <Bars height={90} values={days.map((d) => d.sessions)} labels={order.map((d) => WEEKDAYS[d].slice(0, 3))}
                    describe={(i) => `${WEEKDAYS[order[i]]} · ${days[i].sessions} sessions`} />
                );
              })()}
            </Card>
          </Section>

          {/* hours */}
          <Section title="Busiest start times">
            <Card>
              <HeatStrip cells={r.byHour.map((h) => ({ label: hourLabel(h.hour), value: h.sessions }))}
                describe={(i) => `${hourLabel(r.byHour[i].hour)}–${hourLabel(r.byHour[i].hour + 1)} · ${r.byHour[i].sessions} sessions`} />
            </Card>
          </Section>
        </>
      )}
    </Screen>
  );
}

function Kpi({ icon, label, value, sub, warn }: { icon: IconName; label: string; value: string; sub: string; warn?: boolean }) {
  const c = useColors();
  return (
    <View style={[styles.kpi, { backgroundColor: c.surface, borderColor: c.border }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Ionicons name={icon} size={15} color={warn ? c.warn : c.muted} />
        <T v="small" color={c.muted}>{label}</T>
      </View>
      <T v="title" style={{ marginTop: 4 }}>{value}</T>
      <T v="small" color={warn ? c.warn : c.faint} numberOfLines={2}>{sub}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  expected: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, marginTop: space.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },
  kpi: { width: '48.8%', flexGrow: 1, flexBasis: '45%', padding: space.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
});
