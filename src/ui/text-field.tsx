import { forwardRef } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { useReportFieldFocus } from './keyboard-safe-screen';

export type TextFieldProps = TextInputProps & {
  label: string;
  errorText?: string;
};

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, errorText, style, onFocus, ...rest },
  ref,
) {
  const theme = useTheme();
  const reportFieldFocus = useReportFieldFocus();

  // Every TextField reports its own focus to the nearest KeyboardSafeScreen
  // (a no-op outside one — see ./keyboard-inset#noopFieldFocusReport), so a
  // field further down a form still gets scrolled into view when focus
  // moves to it while the keyboard is already open. The caller's own
  // onFocus — if any — still has to run too; swallowing it here would be a
  // hard-to-find bug for whoever passes one in later.
  const handleFocus: TextFieldProps['onFocus'] = (event) => {
    reportFieldFocus();
    onFocus?.(event);
  };

  return (
    <View style={styles.wrapper}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <TextInput
        ref={ref}
        placeholderTextColor={theme.textSecondary}
        style={[
          styles.input,
          {
            color: theme.text,
            backgroundColor: theme.backgroundElement,
            borderColor: errorText ? theme.dangerText : 'transparent',
          },
          style,
        ]}
        onFocus={handleFocus}
        {...rest}
      />
      {errorText ? (
        <ThemedText type="small" style={{ color: theme.dangerText }}>
          {errorText}
        </ThemedText>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrapper: {
    gap: Spacing.one,
  },
  input: {
    height: 52,
    borderRadius: Spacing.three,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
});
