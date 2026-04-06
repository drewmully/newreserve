import { describe, expect, it } from "vitest";
import {
  calculateHandicapIndex,
  getRoundDifferential,
  getWHSParams,
  sortGolfRounds,
  type GolfRound,
} from "@/lib/golfStats";

describe("golfStats", () => {
  it("calculates an approximate WHS handicap from the first logged round", () => {
    const rounds: GolfRound[] = [
      {
        id: "round-1",
        date: "2026-04-02",
        course: "Oakland Hills",
        score: 82,
      },
    ];

    expect(getRoundDifferential(rounds[0])).toBe(10);
    expect(calculateHandicapIndex(rounds)).toBe(8);
  });

  it("caps the handicap index at 54.0 per WHS rules", () => {
    const rounds: GolfRound[] = Array.from({ length: 20 }, (_, index) => ({
      id: `round-${index + 1}`,
      date: `2026-03-${String(index + 1).padStart(2, "0")}`,
      course: "Hard Track",
      score: 140,
      courseRating: 76,
      slopeRating: 155,
    }));

    expect(getWHSParams(rounds.length)).toEqual({ use: 8, adjustment: 0 });
    expect(calculateHandicapIndex(rounds)).toBe(54);
  });

  it("sorts round history by differential using stored course and slope ratings", () => {
    const rounds: GolfRound[] = [
      {
        id: "round-a",
        date: "2026-04-01",
        course: "Club A",
        score: 78,
        courseRating: 73.4,
        slopeRating: 132,
      },
      {
        id: "round-b",
        date: "2026-04-03",
        course: "Club B",
        score: 81,
        courseRating: 70.2,
        slopeRating: 121,
      },
      {
        id: "round-c",
        date: "2026-04-02",
        course: "Club C",
        score: 76,
        courseRating: 72,
        slopeRating: 113,
      },
    ];

    const sorted = sortGolfRounds(rounds, {
      key: "differential",
      direction: "asc",
    });

    expect(sorted.map((round) => round.id)).toEqual([
      "round-a",
      "round-c",
      "round-b",
    ]);
  });
});
