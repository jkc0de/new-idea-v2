import { useColorScheme } from 'react-native';

const light = {
  bg: '#F6F4EF',
  surface: '#FFFFFF',
  surface2: '#EFECE5',
  text: '#1F2A25',
  muted: '#6B7570',
  faint: '#9AA39E',
  border: '#E4DFD6',
  accent: '#4F7A63',
  accentStrong: '#3B604E',
  accentSoft: '#E3EDE6',
  onAccent: '#FFFFFF',
  danger: '#B4483C',
  dangerSoft: '#F8E5E2',
  warn: '#A0700F',
  warnSoft: '#FAF0D9',
  shadow: 'rgba(30, 40, 35, 0.08)',
};

const dark: typeof light = {
  bg: '#121715',
  surface: '#1B2220',
  surface2: '#242D2A',
  text: '#E8EDEA',
  muted: '#9BA6A1',
  faint: '#6E7974',
  border: '#2C3632',
  accent: '#7FB196',
  accentStrong: '#9CCBB1',
  accentSoft: '#213128',
  onAccent: '#0E1712',
  danger: '#E58276',
  dangerSoft: '#3A2523',
  warn: '#E2B656',
  warnSoft: '#3A3120',
  shadow: 'rgba(0, 0, 0, 0.4)',
};

export type Colors = typeof light;

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? dark : light;
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 10, md: 14, lg: 20, pill: 999 } as const;

export const type = {
  hero: { fontSize: 30, fontWeight: '700' as const, letterSpacing: -0.6 },
  title: { fontSize: 24, fontWeight: '700' as const, letterSpacing: -0.4 },
  heading: { fontSize: 18, fontWeight: '700' as const, letterSpacing: -0.2 },
  body: { fontSize: 16, fontWeight: '400' as const },
  bodyStrong: { fontSize: 16, fontWeight: '600' as const },
  small: { fontSize: 14, fontWeight: '400' as const },
  caption: { fontSize: 12, fontWeight: '600' as const, letterSpacing: 0.4 },
};

/** Soft colors for therapist avatars, picked by id so each person keeps their color. */
const AVATAR = ['#CFE3D6', '#E9D8C4', '#D6DDF0', '#F0D6DC', '#DCE8C8', '#E6DAF0'];
const AVATAR_DARK = ['#2D4537', '#4A3B2A', '#2F3850', '#4D2F36', '#3A4A2A', '#3F3350'];
export function avatarColor(seed: number, scheme: 'light' | 'dark' | null | undefined) {
  const list = scheme === 'dark' ? AVATAR_DARK : AVATAR;
  return list[Math.abs(seed) % list.length];
}
