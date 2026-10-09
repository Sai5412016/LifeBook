import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useUiColors } from './colors';

export type ChipProps = {
  label: string;
  selected: boolean;
  onPress: () => void;
  /** Fill color when selected. Defaults to the shared accent. */
  color?: string;
  /** `large` = a deliberate either/or choice that must not be missed (e.g. the plan's Rhythmus), instead of one option among many. */
  size?: 'normal' | 'large';
};

/** A selectable pill for a small, fixed set of choices — bottle kind, diaper consistency/color, … */
export function Chip({ label, selected, onPress, color, size = 'normal' }: ChipProps) {
  const { accent, chipBorder } = useUiColors();
  const fill = color ?? accent;

  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, size === 'large' && styles.chipLarge, { borderColor: chipBorder }, selected && { backgroundColor: fill, borderColor: fill }]}>
      <ThemedText style={[selected ? styles.labelSelected : styles.label, size === 'large' && styles.labelLarge]}>{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flex: 1,
    minHeight: 56,
    borderRadius: Spacing.two,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipLarge: { minHeight: 72 },
  labelLarge: { fontSize: 18 },
  label: { fontSize: 16, fontWeight: '600' },
  labelSelected: { fontSize: 16, fontWeight: '700', color: '#ffffff' },
});
