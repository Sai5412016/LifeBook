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
};

/** A selectable pill for a small, fixed set of choices — bottle kind, diaper consistency/color, … */
export function Chip({ label, selected, onPress, color }: ChipProps) {
  const { accent, chipBorder } = useUiColors();
  const fill = color ?? accent;

  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, { borderColor: chipBorder }, selected && { backgroundColor: fill, borderColor: fill }]}>
      <ThemedText style={selected ? styles.labelSelected : styles.label}>{label}</ThemedText>
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
  label: { fontSize: 16, fontWeight: '600' },
  labelSelected: { fontSize: 16, fontWeight: '700', color: '#ffffff' },
});
