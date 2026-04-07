export interface GolfRound {
  id: string;
  date: string;
  course: string;
  score: number;
  courseRating?: number;
  slopeRating?: number;
}

export const DEFAULT_COURSE_RATING = 72;
export const DEFAULT_SLOPE_RATING = 113;

export type GolfRoundSortKey =
  | "date"
  | "course"
  | "score"
  | "courseMetrics"
  | "differential";

export type GolfRoundSortDirection = "asc" | "desc";

export interface GolfRoundSortState {
  key: GolfRoundSortKey;
  direction: GolfRoundSortDirection;
}

export function calcScoreDifferential(
  score: number,
  courseRating: number,
  slopeRating: number
): number {
  return (113 / slopeRating) * (score - courseRating);
}

export function getWHSParams(
  count: number
): { use: number; adjustment: number } {
  if (count <= 0) return { use: 0, adjustment: 0 };
  if (count <= 3) return { use: 1, adjustment: -2.0 };
  if (count === 4) return { use: 1, adjustment: -1.0 };
  if (count === 5) return { use: 1, adjustment: 0 };
  if (count === 6) return { use: 2, adjustment: -1.0 };
  if (count <= 8) return { use: 2, adjustment: 0 };
  if (count <= 11) return { use: 3, adjustment: 0 };
  if (count <= 14) return { use: 4, adjustment: 0 };
  if (count <= 16) return { use: 5, adjustment: 0 };
  if (count <= 18) return { use: 6, adjustment: 0 };
  if (count === 19) return { use: 7, adjustment: 0 };
  return { use: 8, adjustment: 0 };
}

export function getRoundCourseRating(round: GolfRound): number {
  return round.courseRating ?? DEFAULT_COURSE_RATING;
}

export function getRoundSlopeRating(round: GolfRound): number {
  return round.slopeRating ?? DEFAULT_SLOPE_RATING;
}

export function getRoundDifferential(round: GolfRound): number {
  return calcScoreDifferential(
    round.score,
    getRoundCourseRating(round),
    getRoundSlopeRating(round)
  );
}

export function calculateHandicapIndex(rounds: GolfRound[]): number | null {
  if (rounds.length === 0) return null;

  const differentials = rounds
    .map(getRoundDifferential)
    .sort((a, b) => a - b);

  const { use, adjustment } = getWHSParams(differentials.length);
  if (use === 0) return null;

  const best = differentials.slice(0, use);
  const average = best.reduce((sum, value) => sum + value, 0) / best.length;

  return Math.min(54.0, Math.round((average + adjustment) * 10) / 10);
}

export function sortGolfRounds(
  rounds: GolfRound[],
  sort: GolfRoundSortState
): GolfRound[] {
  const factor = sort.direction === "asc" ? 1 : -1;

  return [...rounds].sort((left, right) => {
    let comparison = 0;

    switch (sort.key) {
      case "date":
        comparison = left.date.localeCompare(right.date);
        break;
      case "course":
        comparison = left.course.localeCompare(right.course, undefined, {
          sensitivity: "base",
        });
        break;
      case "score":
        comparison = left.score - right.score;
        break;
      case "courseMetrics": {
        const leftCr = getRoundCourseRating(left);
        const rightCr = getRoundCourseRating(right);
        comparison = leftCr - rightCr;
        if (comparison === 0) {
          comparison = getRoundSlopeRating(left) - getRoundSlopeRating(right);
        }
        break;
      }
      case "differential":
        comparison = getRoundDifferential(left) - getRoundDifferential(right);
        break;
    }

    if (comparison !== 0) {
      return comparison * factor;
    }

    return left.id.localeCompare(right.id) * factor;
  });
}
