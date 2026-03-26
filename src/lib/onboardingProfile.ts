export type SelectedTier = "free" | "access" | "member" | "";

export interface OnboardingProfileInput {
  birthMonth: string;
  birthDay: string;
  birthYear: string;
  handicap: string;
  privateClub: boolean | null;
  clubName: string;
  vibeCheck: string;
  selectedTier: string;
}

export interface NormalizedOnboardingProfile {
  birthMonth: string;
  birthDay: string;
  birthYear: string;
  handicap: string;
  privateClub: boolean | null;
  clubName: string;
  vibeCheck: string;
  selectedTier: SelectedTier;
}

export interface FirestoreOnboardingProfile {
  birth_month: string;
  birth_day: string;
  birth_year: string;
  birthdate_iso: string | null;
  handicap: string;
  private_club_member: boolean | null;
  club_name: string;
  vibe_check: string;
  selected_tier: SelectedTier;
}

export function normalizeSelectedTier(value: unknown): SelectedTier {
  if (value === "free" || value === "access" || value === "member") {
    return value;
  }
  return "";
}

export function formatBirthdateIso(
  birthYear: string,
  birthMonth: string,
  birthDay: string
): string | null {
  const year = Number(birthYear);
  const month = Number(birthMonth);
  const day = Number(birthDay);
  if (!year || !month || !day) return null;
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${birthYear.padStart(4, "0")}-${birthMonth.padStart(
    2,
    "0"
  )}-${birthDay.padStart(2, "0")}`;
}

export function normalizeOnboardingProfile(
  profile: OnboardingProfileInput
): NormalizedOnboardingProfile {
  const privateClub =
    profile.privateClub === true
      ? true
      : profile.privateClub === false
      ? false
      : null;

  return {
    birthMonth: profile.birthMonth,
    birthDay: profile.birthDay,
    birthYear: profile.birthYear,
    handicap: profile.handicap,
    privateClub,
    clubName: privateClub === true ? profile.clubName : "",
    vibeCheck: profile.vibeCheck,
    selectedTier: normalizeSelectedTier(profile.selectedTier),
  };
}

export function toFirestoreOnboardingProfile(
  profile: OnboardingProfileInput
): FirestoreOnboardingProfile {
  const normalized = normalizeOnboardingProfile(profile);
  return {
    birth_month: normalized.birthMonth,
    birth_day: normalized.birthDay,
    birth_year: normalized.birthYear,
    birthdate_iso: formatBirthdateIso(
      normalized.birthYear,
      normalized.birthMonth,
      normalized.birthDay
    ),
    handicap: normalized.handicap,
    private_club_member: normalized.privateClub,
    club_name: normalized.clubName,
    vibe_check: normalized.vibeCheck,
    selected_tier: normalized.selectedTier,
  };
}

export function fromFirestoreOnboardingProfile(
  value: unknown
): NormalizedOnboardingProfile | null {
  if (!value || typeof value !== "object") return null;
  const map = value as Record<string, unknown>;
  const privateClubRaw = map.private_club_member;

  return {
    birthMonth: typeof map.birth_month === "string" ? map.birth_month : "",
    birthDay: typeof map.birth_day === "string" ? map.birth_day : "",
    birthYear: typeof map.birth_year === "string" ? map.birth_year : "",
    handicap: typeof map.handicap === "string" ? map.handicap : "",
    privateClub:
      privateClubRaw === true ? true : privateClubRaw === false ? false : null,
    clubName: typeof map.club_name === "string" ? map.club_name : "",
    vibeCheck: typeof map.vibe_check === "string" ? map.vibe_check : "",
    selectedTier: normalizeSelectedTier(map.selected_tier),
  };
}

export function normalizeFitProfile<T extends Record<string, string>>(
  fitProfile: Partial<T> | undefined,
  emptyFitProfile: T
): T | undefined {
  if (!fitProfile) return undefined;
  return { ...emptyFitProfile, ...fitProfile };
}

export function buildCompleteOnboardingUpdatePayload<
  TFitProfile extends Record<string, string>
>(input: {
  username: string;
  onboardingProfile: OnboardingProfileInput;
  fitProfile?: Partial<TFitProfile>;
  emptyFitProfile: TFitProfile;
  updatedAt: unknown;
}): {
  normalizedOnboardingProfile: NormalizedOnboardingProfile;
  normalizedFitProfile: TFitProfile | undefined;
  updates: Record<string, unknown>;
} {
  const normalizedOnboardingProfile = normalizeOnboardingProfile(
    input.onboardingProfile
  );
  const normalizedFitProfile = normalizeFitProfile(
    input.fitProfile,
    input.emptyFitProfile
  );

  const updates: Record<string, unknown> = {
    username: input.username,
    onboarding_completed: true,
    onboarding_profile: toFirestoreOnboardingProfile(normalizedOnboardingProfile),
    updated_at: input.updatedAt,
  };

  if (normalizedFitProfile) {
    updates.fit_profile = normalizedFitProfile;
  }

  return {
    normalizedOnboardingProfile,
    normalizedFitProfile,
    updates,
  };
}
