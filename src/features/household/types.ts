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
