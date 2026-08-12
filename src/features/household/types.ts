// household — types (Spec §5.2).

export type HouseholdRole = 'owner' | 'caregiver' | 'viewer';

export type CreateHouseholdInput = {
  /** Supabase auth user id of the person creating the household — becomes 'owner'. */
  userId: string;
  /** How this member is shown to others in the household (Spec §5.2). */
  displayName: string;
  /** Free-text household name, e.g. "Familie Schmidt". */
  householdName: string;
  child: {
    firstName: string;
    /** ISO-8601 UTC instant, e.g. from `${'YYYY-MM-DD'}T00:00:00Z`. */
    birthAtUtcIso: string;
    /** IANA zone captured at creation time, e.g. "Europe/Berlin". */
    birthTz: string;
  };
};

export type CreateHouseholdResult = {
  householdId: string;
  childId: string;
};

/**
 * Everything the child-edit screen can change. Birth date/time are always
 * supplied together (the form always shows/edits both) and are combined
 * against the child's EXISTING `birth_tz` — editing the timezone itself is
 * not part of this screen. `null` for the optional measurements/place/avatar
 * clears the field; the form always sends its current value for the ones it
 * doesn't touch, so there is no separate "leave unchanged" sentinel needed.
 */
export type ChildEditInput = {
  firstName: string;
  /** "YYYY-MM-DD", interpreted in the child's existing `birth_tz`. */
  birthDate: string;
  /** "HH:mm", interpreted in the child's existing `birth_tz`. */
  birthTime: string;
  birthWeightG: number | null;
  birthLengthMm: number | null;
  birthHeadMm: number | null;
  birthPlace: string | null;
  avatarPhotoId: string | null;
};
