"use client";

/**
 * FoundingHundredCard
 *
 * Compact inclusion banner placed inside the LP buy-box column. Sized
 * to feel like a product detail (not a competing hero). Augusta-meets-
 * Soho-House tone: forest + bone, hairline borders, no urgency, no FREE,
 * no MSRP / discount framing.
 *
 * Hidden entirely when status.available is false (cap hit or kill
 * switch off), so the LP gracefully falls back to base messaging.
 */
import { useEffect, useState } from "react";
import Image from "next/image";

interface Status {
  claimed: number;
  cap: number;
  available: boolean;
  remaining: number;
}

export default function FoundingHundredCard({
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

  const pct = Math.min(100, Math.round((status.claimed / status.cap) * 100));

  return (
    <aside
      className={`bg-forest text-bone rounded-lg border border-forest/40 px-4 py-3.5 ${className}`}
      aria-label="Founding 100 member benefit"
    >
      <div className="flex items-start gap-3.5">
        {/* Small product thumbnail */}
        <div className="relative shrink-0 w-14 h-14 rounded-md overflow-hidden bg-bone/95 border border-bone/20">
          <Image
            src="/founding-100-rangefinder.webp"
            alt="Precision Pro Nexus rangefinder"
            fill
            sizes="56px"
            className="object-contain p-1"
            priority={false}
          />
        </div>

        {/* Copy + tracker */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[9.5px] tracking-[0.32em] uppercase text-bone/65">
            <span className="w-5 h-px bg-bone/25" />
            <span>Founding 100</span>
          </div>

          <div className="mt-1 font-serif text-[15px] leading-snug text-bone">
            A rangefinder, hand-delivered with the first box.
          </div>

          <div className="mt-2.5 flex items-center gap-3">
            <div
              className="flex-1 h-[3px] bg-bone/15 rounded-full overflow-hidden"
              role="progressbar"
              aria-valuenow={status.claimed}
              aria-valuemin={0}
              aria-valuemax={status.cap}
            >
              <div
                className="h-full bg-bone/85 transition-[width] duration-700"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="shrink-0 text-[10px] tracking-[0.22em] uppercase text-bone/75 whitespace-nowrap">
              {status.claimed} / {status.cap} reserved
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
