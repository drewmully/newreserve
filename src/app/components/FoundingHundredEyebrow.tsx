"use client";

/**
 * FoundingHundredEyebrow
 *
 * Homepage hero inclusion banner. Communicates the founding-member gift
 * with a small product thumbnail and a quiet tracker line. Augusta-meets-
 * editorial tone — never says "FREE" or shows a dollar value. Only
 * renders when the offer is actually available.
 *
 * Reads /api/founding_100/status (edge-cached 30s) on mount.
 */
import { useEffect, useState } from "react";
import Image from "next/image";

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
      className={`inline-flex items-center gap-3 bg-forest text-bone rounded-md pl-2 pr-3.5 py-1.5 border border-forest/40 shadow-sm ${className}`}
      aria-label="Founding 100 member benefit"
    >
      {/* Tiny product thumbnail */}
      <span className="relative shrink-0 w-7 h-7 rounded-sm overflow-hidden bg-bone/95 border border-bone/20">
        <Image
          src="/founding-100-rangefinder.webp"
          alt=""
          fill
          sizes="28px"
          className="object-contain p-0.5"
          priority={false}
        />
      </span>

      <span className="flex flex-col leading-tight">
        <span className="text-[9px] tracking-[0.34em] uppercase text-bone/65">
          Founding 100
        </span>
        <span className="text-[12px] tracking-wide text-bone font-medium mt-0.5">
          Rangefinder included &middot; {status.remaining} of {status.cap} remaining
        </span>
      </span>
    </div>
  );
}
