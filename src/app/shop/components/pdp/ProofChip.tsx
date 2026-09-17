"use client";

interface Props {
  rating?: number;
  reviewCount?: number;
  reviewsUrl?: string;
  badge?: string;
}

/**
 * Rating + review count + optional badge chip.
 * Renders nothing if there's no rating AND no badge.
 * When reviewsUrl is set, the rating cluster is a link.
 */
export function ProofChip({ rating, reviewCount, reviewsUrl, badge }: Props) {
  const hasRating = typeof rating === "number" && rating > 0;
  const hasBadge = badge && badge.trim().length > 0;
  if (!hasRating && !hasBadge) return null;

  const stars = hasRating ? renderStars(rating!) : null;
  const countStr =
    typeof reviewCount === "number" && reviewCount > 0
      ? `(${reviewCount.toLocaleString()})`
      : null;

  const ratingCluster = hasRating ? (
    <span className="flex items-center gap-1.5">
      <span className="text-[13px] leading-none" aria-hidden="true">
        {stars}
      </span>
      <span className="text-[13px] font-medium text-charcoal">
        {rating!.toFixed(1)}
      </span>
      {countStr && (
        <span className="text-[13px] text-charcoal/50">{countStr}</span>
      )}
    </span>
  ) : null;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
      {ratingCluster &&
        (reviewsUrl ? (
          <a
            href={reviewsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-charcoal/80"
            aria-label={`${rating!.toFixed(1)} out of 5 stars, ${reviewCount ?? 0} reviews`}
          >
            {ratingCluster}
          </a>
        ) : (
          <span
            aria-label={`${rating!.toFixed(1)} out of 5 stars, ${reviewCount ?? 0} reviews`}
          >
            {ratingCluster}
          </span>
        ))}
      {hasBadge && (
        <span className="text-[11px] font-mono uppercase tracking-[0.2em] text-charcoal/70">
          {badge}
        </span>
      )}
    </div>
  );
}

function renderStars(rating: number): string {
  const full = Math.floor(rating);
  const half = rating - full >= 0.25 && rating - full < 0.75;
  const rounded = rating - full >= 0.75 ? full + 1 : full;
  const filled = half ? full : rounded;
  const stars: string[] = [];
  for (let i = 0; i < 5; i++) {
    if (i < filled) stars.push("★");
    else if (i === filled && half) stars.push("⯪");
    else stars.push("☆");
  }
  return stars.join("");
}
