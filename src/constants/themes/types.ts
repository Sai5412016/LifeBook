/**
 * constants/themes — the shape every theme file must fill in. A theme is a
 * plain data file, nothing else: to reskin the app, add a new file that
 * satisfies `Theme` and point `constants/theme.ts` at it — no other file
 * needs to change (see that file's doc comment).
 */

/** One color scheme's full palette — every color the app reads by name, never a raw hex. */
export type ThemePalette = {
  /** Primary text. */
  text: string;
  /** De-emphasized text — captions, secondary labels. */
  textSecondary: string;
  /** Screen background. */
  background: string;
  /** Cards, panels, rows — a surface raised slightly above `background`. */
  backgroundElement: string;
  /** A `backgroundElement` in its selected/active state. */
  backgroundSelected: string;
  /** Brand accent — primary buttons, links, selection marks. Same across light/dark by design. */
  accent: string;
  /** `accent` while pressed. */
  accentPressed: string;
  /** Secondary action-button hue (e.g. the diaper "Stuhl" button). */
  amber: string;
  /** Tertiary action-button hue (e.g. the diaper "Beides" button). */
  green: string;
  /** Background of a "please check this" banner (multi-device conflicts, …). */
  warningBackground: string;
  /** Text/icon color on `warningBackground`. */
  warningText: string;
  /** Background of a "something needs attention now" banner or destructive-action accent. */
  dangerBackground: string;
  /** Text/icon color on `dangerBackground`, and the color for destructive text/icons generally. */
  dangerText: string;
  /** Border of an unselected chip / outlined control. */
  chipBorder: string;
};

export type Theme = {
  /** Identifies the theme in logs/diagnostics — not shown to users. */
  name: string;
  light: ThemePalette;
  dark: ThemePalette;
};
