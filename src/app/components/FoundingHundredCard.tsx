"use client";

/**
 * FoundingHundredCard
 *
 * Featured under-hero block for /lp/subscription and /lp/gift. Shows
 * the rangefinder image with a quiet progress tracker ("X of 100
 * reserved") and founding-member-benefit copy. Augusta-meets-Soho-House
 * tone: forest + bone palette, serif headline, hairline borders, no
 * urgency language, no FREE, no MSRP / discount framing.
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
    <section
      className={`bg-forest text-bone rounded-lg overflow-hidden border border-forest/20 shadow-sm ${className}`}
      aria-label="Founding 100 member benefit"
    >
      <div className="grid md:grid-cols-2 gap-0">
        {/* Image side */}
        <div className="relative aspect-[4/5] md:aspect-auto md:min-h-[360px] bg-forest-dark">
          <Image
            src="/founding-100-hero.webp"
            alt="Precision Pro Nexus rangefinder resting on a closed Mully Reserve box"
            fill
            sizes="(max-width: 768px) 100vw, 50vw"
            className="object-cover"
            priority={false}
          />
        </div>

        {/* Copy side */}
        <div className="p-7 sm:p-9 flex flex-col justify-center">
          <div className="text-[10px] tracking-[0.38em] uppercase font-medium text-bone/70 mb-4 flex items-center gap-2.5">
            <span className="w-8 h-px bg-bone/25" />
            <span>Founding 100</span>
          </div>

          <h3 className="font-serif text-2xl sm:text-[28px] leading-tight text-bone">
            A rangefinder, hand-delivered with the first box.
          </h3>

          <p className="mt-4 text-[14px] leading-relaxed text-bone/80">
            The first 100 Reserve Members receive a Precision Pro Nexus rangefinder, included with the opening quarterly shipment. A small thank-you for showing up early.
          </p>

          {/* Tracker */}
          <div className="mt-7">
            <div className="flex items-baseline justify-between text-[11px] tracking-[0.25em] uppercase text-bone/65">
              <span>
                {status.claimed} of {status.cap} reserved
              </span>
              <span>{status.remaining} remaining</span>
            </div>
            <div
              className="mt-2.5 h-[3px] w-full bg-bone/15 rounded-full overflow-hidden"
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
          </div>

          <div className="mt-6 text-[10px] tracking-[0.28em] uppercase text-bone/55">
            Reserved for founding members. Attaches automatically at checkout.
          </div>
        </div>
      </div>
    </section>
  );
}
