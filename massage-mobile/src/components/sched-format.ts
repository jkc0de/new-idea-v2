import { addDays, parseDate } from '@/lib/format';

/** Compact hours: 0 → "0h", 45 → "45m", 90 → "1.5h", 480 → "8h". */
export function hrs(min: number) {
  if (min <= 0) return '0h';
  if (min < 60) return `${Math.round(min)}m`;
  const h = min / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1).replace(/\.0$/, '')}h`;
}

export function pct(x: number) {
  return `${Math.round(x * 100)}%`;
}

/** Monday of the week that contains `date`. */
export function weekStart(date: string) {
  const wd = parseDate(date).getDay(); // 0 = Sunday
  return addDays(date, wd === 0 ? -6 : 1 - wd);
}

/** True when a day is effectively sold out: no free time left or the session cap reached. */
export function isFull(d: { availableMin: number; freeMin: number; sessions: number; maxSessions: number | null; working: boolean }) {
  if (!d.working) return false;
  return d.freeMin < 30 || (!!d.maxSessions && d.sessions >= d.maxSessions);
}
