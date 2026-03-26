import { describe, expect, it } from "vitest";
import {
  buildCompleteOnboardingUpdatePayload,
  formatBirthdateIso,
  fromFirestoreOnboardingProfile,
  normalizeOnboardingProfile,
} from "@/lib/onboardingProfile";

const EMPTY_FIT = {
  shirtSize: "",
  gloveHand: "",
  gloveSize: "",
  waistSize: "",
  pantsInseam: "",
  shortsInseam: "",
  shoeSize: "",
};

describe("onboardingProfile helpers", () => {
  it("normalizes selectedTier/privateClub/clubName", () => {
    const normalized = normalizeOnboardingProfile({
      birthMonth: "2",
      birthDay: "20",
      birthYear: "1990",
      handicap: "6 to 10",
      privateClub: false,
      clubName: "Should be dropped",
      vibeCheck: "turn-up",
      selectedTier: "black",
    });

    expect(normalized.selectedTier).toBe("");
    expect(normalized.privateClub).toBe(false);
    expect(normalized.clubName).toBe("");
  });

  it("computes ISO birthdate only for valid date parts", () => {
    expect(formatBirthdateIso("1990", "2", "9")).toBe("1990-02-09");
    expect(formatBirthdateIso("1990", "13", "9")).toBeNull();
    expect(formatBirthdateIso("", "2", "9")).toBeNull();
  });

  it("maps Firestore snake_case profile into UI profile", () => {
    const parsed = fromFirestoreOnboardingProfile({
      birth_month: "2",
      birth_day: "09",
      birth_year: "1990",
      handicap: "1 to 5",
      private_club_member: true,
      club_name: "Mully Club",
      vibe_check: "depends",
      selected_tier: "member",
    });

    expect(parsed).toEqual({
      birthMonth: "2",
      birthDay: "09",
      birthYear: "1990",
      handicap: "1 to 5",
      privateClub: true,
      clubName: "Mully Club",
      vibeCheck: "depends",
      selectedTier: "member",
    });
  });

  it("builds complete onboarding updates with onboarding_profile always present and fit_profile optional", () => {
    const withFit = buildCompleteOnboardingUpdatePayload({
      username: "player_01",
      onboardingProfile: {
        birthMonth: "2",
        birthDay: "9",
        birthYear: "1990",
        handicap: "6 to 10",
        privateClub: true,
        clubName: "Augusta",
        vibeCheck: "turn-up",
        selectedTier: "member",
      },
      fitProfile: {
        shirtSize: "L",
        shoeSize: "10",
      },
      emptyFitProfile: EMPTY_FIT,
      updatedAt: "ts",
    });

    expect(withFit.updates).toMatchObject({
      username: "player_01",
      onboarding_completed: true,
      updated_at: "ts",
      onboarding_profile: {
        birth_month: "2",
        birth_day: "9",
        birth_year: "1990",
        birthdate_iso: "1990-02-09",
        handicap: "6 to 10",
        private_club_member: true,
        club_name: "Augusta",
        vibe_check: "turn-up",
        selected_tier: "member",
      },
    });
    expect(withFit.updates.fit_profile).toMatchObject({
      shirtSize: "L",
      shoeSize: "10",
      gloveHand: "",
    });

    const withoutFit = buildCompleteOnboardingUpdatePayload({
      username: "player_02",
      onboardingProfile: {
        birthMonth: "1",
        birthDay: "1",
        birthYear: "2000",
        handicap: "",
        privateClub: null,
        clubName: "Ignored",
        vibeCheck: "",
        selectedTier: "free",
      },
      emptyFitProfile: EMPTY_FIT,
      updatedAt: "ts2",
    });

    expect(withoutFit.updates).toMatchObject({
      username: "player_02",
      onboarding_completed: true,
      updated_at: "ts2",
    });
    expect(withoutFit.updates.fit_profile).toBeUndefined();
  });
});
