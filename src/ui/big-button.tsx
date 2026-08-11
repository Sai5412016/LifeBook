import { Pressable, StyleSheet, type GestureResponderEvent } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

export type BigButtonProps = {
  label: string;
  color: string;
  onPress: (event: GestureResponderEvent) => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
};

/**
 * A full-width, tall button for actions used many times a day, one-handed,
 * often in the dark: large tap target, high contrast, no small hit areas.
 * Shared across the "Heute" screen's sections (Füttern, Wickeln, …) so every
 * tracking feature's primary actions look and behave the same way.
 */
export function BigButton({ label, color, onPress, disabled, variant = 'primary' }: BigButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary'
          ? { backgroundColor: color }
          : { backgroundColor: 'transparent', borderWidth: 2, borderColor: color },
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}>
      <ThemedText style={[styles.label, variant === 'primary' ? { color: '#ffffff' } : { color }]}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 88,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.85 },
  label: { fontSize: 22, fontWeight: '700' },
});
