"use client";

/**
 * FoundingHundredEyebrow
 *
 * Small, quiet line of copy for the homepage hero. Communicates the
 * founding-member gift in Augusta-meets-editorial tone — never says
 * "FREE" or shows a dollar value. Only renders when the offer is
 * actually available, so it disappears the moment the cap is hit.
 *
 * Reads /api/founding_100/status (edge-cached 30s) on mount.
 */
import { useEffect, useState } from "react";

interface Status {
  claimed: number;
  cap: number;
  available: boolean;
  remaining: number;
}

export default function FoundingHundredEyebrow({
  className = "",
}: {
  className?: string;
}) {
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/founding_100/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setStatus(data as Status);
      })
      .catch(() => {
        /* fail-safe: render nothing */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status || !status.available) return null;

  return (
    <div
      className={`inline-flex items-center gap-2.5 text-[10px] tracking-[0.38em] uppercase font-medium text-forest/70 ${className}`}
    >
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-forest/60" />
      <span>
        Founding 100 · Rangefinder included with the first {status.cap} Reserve Members
      </span>
    </div>
  );
}
