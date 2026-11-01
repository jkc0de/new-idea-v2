import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
  useColorScheme, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { initials, STATUS_LABEL } from '@/lib/format';
import { avatarColor, radius, space, type, useColors } from '@/lib/theme';
import type { Status } from '@/lib/types';

export type IconName = ComponentProps<typeof Ionicons>['name'];
export { Ionicons };

export function tap(style: 'light' | 'medium' | 'success' = 'light') {
  if (Platform.OS === 'web') return;
  if (style === 'success') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  else Haptics.impactAsync(style === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

// ---------- text ----------
type Variant = keyof typeof type;
export function T({ v = 'body', color, style, children, numberOfLines, center }: {
  v?: Variant; color?: string; style?: StyleProp<TextStyle>; children: ReactNode; numberOfLines?: number; center?: boolean;
}) {
  const c = useColors();
  return (
    <Text numberOfLines={numberOfLines} style={[type[v], { color: color ?? c.text }, center && { textAlign: 'center' }, style]}>
      {children}
    </Text>
  );
}

// ---------- layout ----------
export function Screen({ children, refreshing, onRefresh, padded = true, bottomInset = 0, contentStyle }: {
  children: ReactNode; refreshing?: boolean; onRefresh?: () => void; padded?: boolean; bottomInset?: number; contentStyle?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={[padded && { padding: space.lg }, { paddingBottom: insets.bottom + space.xxl + bottomInset }, contentStyle]}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={c.accent} /> : undefined}
    >
      {children}
    </ScrollView>
  );
}

export function Card({ children, style, onPress, padded = true }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; padded?: boolean }) {
  const c = useColors();
  const base = [styles.card, { backgroundColor: c.surface, borderColor: c.border, shadowColor: c.shadow }, padded && { padding: space.lg }, style];
  if (!onPress) return <View style={base}>{children}</View>;
  return (
    <Pressable onPress={() => { tap(); onPress(); }} style={({ pressed }) => [base, pressed && { opacity: 0.85, transform: [{ scale: 0.99 }] }]}>
      {children}
    </Pressable>
  );
}

export function Section({ title, action, children, style }: { title?: string; action?: ReactNode; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return (
    <View style={[{ marginTop: space.xl }, style]}>
      {(title || action) && (
        <View style={styles.sectionHead}>
          {title ? <T v="caption" color={c.muted} style={{ textTransform: 'uppercase' }}>{title}</T> : <View />}
          {action}
        </View>
      )}
      {children}
    </View>
  );
}

export function Divider({ inset = 0 }: { inset?: number }) {
  const c = useColors();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginLeft: inset }} />;
}

// ---------- buttons ----------
type ButtonKind = 'primary' | 'secondary' | 'danger' | 'ghost';
export function Button({ title, onPress, kind = 'primary', icon, loading, disabled, size = 'lg', style }: {
  title: string; onPress: () => void; kind?: ButtonKind; icon?: IconName; loading?: boolean; disabled?: boolean; size?: 'lg' | 'md' | 'sm'; style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const palette = {
    primary: { bg: c.accent, fg: c.onAccent, border: c.accent },
    secondary: { bg: c.surface, fg: c.text, border: c.border },
    danger: { bg: c.dangerSoft, fg: c.danger, border: c.dangerSoft },
    ghost: { bg: 'transparent', fg: c.accentStrong, border: 'transparent' },
  }[kind];
  const h = { lg: 54, md: 44, sm: 36 }[size];
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={() => { tap(kind === 'primary' ? 'medium' : 'light'); onPress(); }}
      style={({ pressed }) => [
        styles.button,
        { height: h, backgroundColor: palette.bg, borderColor: palette.border, paddingHorizontal: size === 'sm' ? space.md : space.lg },
        (disabled || loading) && { opacity: 0.5 },
        pressed && { opacity: 0.8, transform: [{ scale: 0.98 }] },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={palette.fg} /> : (
        <>
          {icon && <Ionicons name={icon} size={size === 'sm' ? 16 : 19} color={palette.fg} />}
          <Text style={[size === 'sm' ? type.small : type.bodyStrong, { color: palette.fg, fontWeight: '600' }]}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

export function IconButton({ icon, onPress, label, color, bg, size = 40 }: { icon: IconName; onPress: () => void; label: string; color?: string; bg?: string; size?: number }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={8}
      onPress={() => { tap(); onPress(); }}
      style={({ pressed }) => [{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: bg ?? c.surface2 }, pressed && { opacity: 0.7 }]}
    >
      <Ionicons name={icon} size={size * 0.5} color={color ?? c.text} />
    </Pressable>
  );
}

/** Floating action button that sits above the tab bar. */
export function Fab({ icon = 'add', onPress, label }: { icon?: IconName; onPress: () => void; label: string }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={() => { tap('medium'); onPress(); }}
      style={({ pressed }) => [styles.fab, { backgroundColor: c.accent, shadowColor: c.shadow }, pressed && { transform: [{ scale: 0.94 }] }]}
    >
      <Ionicons name={icon} size={28} color={c.onAccent} />
    </Pressable>
  );
}

// ---------- chips & pills ----------
export function Chip({ label, selected, onPress, icon }: { label: string; selected?: boolean; onPress: () => void; icon?: IconName }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={() => { tap(); onPress(); }}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: selected ? c.text : c.surface, borderColor: selected ? c.text : c.border },
        pressed && { opacity: 0.8 },
      ]}
    >
      {icon && <Ionicons name={icon} size={15} color={selected ? c.bg : c.muted} />}
      <Text style={[type.small, { color: selected ? c.bg : c.text, fontWeight: '600' }]}>{label}</Text>
    </Pressable>
  );
}

export function StatusPill({ status }: { status: Status }) {
  const c = useColors();
  const map = {
    booked: [c.accentSoft, c.accentStrong],
    completed: [c.surface2, c.muted],
    cancelled: [c.dangerSoft, c.danger],
    no_show: [c.warnSoft, c.warn],
  } as const;
  const [bg, fg] = map[status];
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[type.caption, { color: fg }]}>{STATUS_LABEL[status]}</Text>
    </View>
  );
}

export function Segmented<K extends string>({ options, value, onChange }: { options: { key: K; label: string }[]; value: K; onChange: (k: K) => void }) {
  const c = useColors();
  return (
    <View style={[styles.segmented, { backgroundColor: c.surface2 }]}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => { tap(); onChange(o.key); }}
            style={[styles.segment, on && { backgroundColor: c.surface, shadowColor: c.shadow, shadowOpacity: 1, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } }]}
          >
            <Text style={[type.small, { color: on ? c.text : c.muted, fontWeight: on ? '700' : '500' }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------- avatars ----------
export function Avatar({ name, seed = 0, size = 44 }: { name: string; seed?: number; size?: number }) {
  const c = useColors();
  const scheme = useColorScheme();
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: avatarColor(seed, scheme), alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: c.text, fontWeight: '700', fontSize: size * 0.36 }}>{initials(name)}</Text>
    </View>
  );
}

// ---------- rows ----------
export function Row({ title, subtitle, left, right, onPress, chevron = !!onPress, danger }: {
  title: string; subtitle?: string; left?: ReactNode; right?: ReactNode; onPress?: () => void; chevron?: boolean; danger?: boolean;
}) {
  const c = useColors();
  const content = (
    <>
      {left}
      <View style={{ flex: 1, minWidth: 0 }}>
        <T v="bodyStrong" color={danger ? c.danger : c.text} numberOfLines={1}>{title}</T>
        {subtitle ? <T v="small" color={c.muted} numberOfLines={2}>{subtitle}</T> : null}
      </View>
      {right}
      {chevron && <Ionicons name="chevron-forward" size={18} color={c.faint} />}
    </>
  );
  if (!onPress) return <View style={styles.row}>{content}</View>;
  return (
    <Pressable onPress={() => { tap(); onPress(); }} style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.surface2 }]}>
      {content}
    </Pressable>
  );
}

export function RowIcon({ icon, color, bg }: { icon: IconName; color?: string; bg?: string }) {
  const c = useColors();
  return (
    <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: bg ?? c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={icon} size={19} color={color ?? c.accentStrong} />
    </View>
  );
}

// ---------- inputs ----------
export function Field({ label, hint, style, ...props }: TextInputProps & { label: string; hint?: string }) {
  const c = useColors();
  return (
    <View style={{ marginBottom: space.lg }}>
      <T v="small" color={c.muted} style={{ marginBottom: 6, fontWeight: '600' }}>{label}</T>
      <TextInput
        placeholderTextColor={c.faint}
        {...props}
        style={[styles.input, { backgroundColor: c.surface, borderColor: c.border, color: c.text }, props.multiline && { minHeight: 96, paddingTop: 14, textAlignVertical: 'top' }, style]}
      />
      {hint ? <T v="small" color={c.faint} style={{ marginTop: 6 }}>{hint}</T> : null}
    </View>
  );
}

// ---------- states ----------
export function Loading() {
  const c = useColors();
  return <View style={{ flex: 1, padding: space.xxl, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg }}><ActivityIndicator color={c.accent} size="large" /></View>;
}

export function ErrorBanner({ message, onRetry }: { message: string | null; onRetry?: () => void }) {
  const c = useColors();
  if (!message) return null;
  return (
    <View style={[styles.banner, { backgroundColor: c.dangerSoft }]}>
      <Ionicons name="alert-circle" size={20} color={c.danger} />
      <T v="small" color={c.danger} style={{ flex: 1 }}>{message}</T>
      {onRetry && <Pressable onPress={onRetry} hitSlop={8}><T v="small" color={c.danger} style={{ fontWeight: '700' }}>Retry</T></Pressable>}
    </View>
  );
}

export function Empty({ icon, title, body, action }: { icon: IconName; title: string; body?: string; action?: ReactNode }) {
  const c = useColors();
  return (
    <View style={{ alignItems: 'center', paddingVertical: space.xxl, paddingHorizontal: space.lg, gap: space.sm }}>
      <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center', marginBottom: space.sm }}>
        <Ionicons name={icon} size={28} color={c.muted} />
      </View>
      <T v="heading" center>{title}</T>
      {body ? <T v="small" color={c.muted} center>{body}</T> : null}
      {action ? <View style={{ marginTop: space.md }}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, shadowOpacity: 1, shadowRadius: 12, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.sm, paddingHorizontal: 4 },
  button: { borderRadius: radius.md, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm },
  fab: { position: 'absolute', right: space.lg, bottom: space.lg, width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', shadowOpacity: 1, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1 },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, alignSelf: 'flex-start' },
  segmented: { flexDirection: 'row', borderRadius: 12, padding: 3 },
  segment: { flex: 1, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 14, paddingHorizontal: space.lg, minHeight: 60 },
  input: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 14, height: 52, fontSize: 16 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md, marginBottom: space.md },
});
