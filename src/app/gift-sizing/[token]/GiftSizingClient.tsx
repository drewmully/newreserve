"use client";

/**
 * Recipient sizing form for a gift box. Posts to /api/gifts/submit-sizing.
 *
 * Kept intentionally short \u2014 5 quick fields (shirt, pant waist, pant inseam,
 * shoe, glove) plus a free-text "anything else?" so we don't bounce the
 * recipient on a 20-field form. The purchaser already paid; the only
 * goal here is "get us enough sizing to ship the first box".
 */

import { useMemo, useState } from "react";
import { GlassHeader } from "@/app/components/ClientComponents";

const SHIRT = ["S", "M", "L", "XL", "XXL"] as const;
const WAIST = ["28", "30", "32", "34", "36", "38", "40"] as const;
const INSEAM = ['28"', '30"', '32"', '34"'] as const;
const SHOE = [
  "7", "7.5", "8", "8.5", "9", "9.5", "10", "10.5", "11", "11.5", "12", "13",
] as const;
const GLOVE = ["S", "M", "ML", "L", "XL"] as const;
const GLOVE_HAND = ["Left", "Right"] as const;

interface Props {
  orderId: string;
  token: string;
  recipientFirstName: string | null;
  purchaserFirstName: string | null;
  giftMessage: string | null;
  alreadySubmitted: boolean;
  existingSizing: Record<string, string> | null;
}

interface SizingState {
  shirt: string;
  waist: string;
  inseam: string;
  shoe: string;
  glove_size: string;
  glove_hand: string;
  notes: string;
}

const DEFAULT_SIZING: SizingState = {
  shirt: "",
  waist: "",
  inseam: "",
  shoe: "",
  glove_size: "",
  glove_hand: "",
  notes: "",
};

export default function GiftSizingClient({
  orderId,
  token,
  recipientFirstName,
  purchaserFirstName,
  giftMessage,
  alreadySubmitted,
  existingSizing,
}: Props) {
  const initial = useMemo<SizingState>(() => {
    if (!existingSizing) return DEFAULT_SIZING;
    return {
      shirt: existingSizing.shirt ?? "",
      waist: existingSizing.waist ?? "",
      inseam: existingSizing.inseam ?? "",
      shoe: existingSizing.shoe ?? "",
      glove_size: existingSizing.glove_size ?? "",
      glove_hand: existingSizing.glove_hand ?? "",
      notes: existingSizing.notes ?? "",
    };
  }, [existingSizing]);

  const [s, setS] = useState<SizingState>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(alreadySubmitted);
  const [error, setError] = useState<string | null>(null);

  const ready =
    !!s.shirt && !!s.waist && !!s.inseam && !!s.shoe && !!s.glove_size && !!s.glove_hand;

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/gifts/submit-sizing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, sizing: s }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const recipient = recipientFirstName?.trim() ?? "there";
  const fromName = purchaserFirstName?.trim() ?? "a friend";

  return (
    <div className="min-h-screen bg-bone text-charcoal">
      <GlassHeader />
      <main className="pt-24 sm:pt-28 pb-16">
        <div className="max-w-2xl mx-auto px-4 sm:px-6">
          {done ? (
            <div className="text-center py-12">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-forest text-bone mb-5">
                <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M5 12l5 5 9-11" />
                </svg>
              </div>
              <h1 className="font-serif text-3xl text-forest mb-3">
                You&apos;re all set, {recipient}.
              </h1>
              <p className="text-sm text-charcoal/75 leading-relaxed max-w-md mx-auto">
                We&apos;ve got your sizing. Your first Mully Reserve box will be
                hand-curated and ship in 5\u20137 business days. Watch your inbox
                for tracking.
              </p>
              <p className="text-xs text-charcoal/55 mt-6 leading-relaxed max-w-md mx-auto">
                Your subscription auto-cancels after the first box ships, so
                you&apos;re never charged again unless you choose to stay on.
                Manage everything at{" "}
                <a href="https://mymully.com/account" className="text-forest underline">
                  mymully.com/account
                </a>
                .
              </p>
            </div>
          ) : (
            <>
              <div className="text-[11px] tracking-[0.25em] uppercase text-ember/80 mb-2">
                Mully Reserve \u00b7 Gift Box
              </div>
              <h1 className="font-serif text-3xl sm:text-4xl text-forest leading-[1.1]">
                Hey {recipient} \u2014 {fromName} sent you Mully Reserve.
              </h1>
              <p className="text-sm text-charcoal/80 mt-4 leading-relaxed">
                A hand-curated quarterly box of premium golf apparel and
                accessories is on its way. $300+ retail value in every box.
                Confirm your sizing below \u2014 takes about 2 minutes.
              </p>

              {giftMessage ? (
                <div className="mt-5 bg-bone-dark/40 border border-forest/15 rounded-lg p-4">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-charcoal/55 mb-2">
                    A note from {fromName}
                  </div>
                  <p className="text-sm text-charcoal/85 italic leading-relaxed">
                    &ldquo;{giftMessage}&rdquo;
                  </p>
                </div>
              ) : null}

              <div className="mt-8 space-y-6 bg-bone-dark/40 border border-forest/15 rounded-lg p-5 sm:p-6">
                <SizingRow
                  label="Shirt size"
                  options={SHIRT}
                  value={s.shirt}
                  onChange={(v) => setS({ ...s, shirt: v })}
                />
                <SizingRow
                  label="Pant waist"
                  options={WAIST}
                  value={s.waist}
                  onChange={(v) => setS({ ...s, waist: v })}
                />
                <SizingRow
                  label="Pant inseam"
                  options={INSEAM}
                  value={s.inseam}
                  onChange={(v) => setS({ ...s, inseam: v })}
                />
                <SizingRow
                  label="Shoe size (US)"
                  options={SHOE}
                  value={s.shoe}
                  onChange={(v) => setS({ ...s, shoe: v })}
                />
                <SizingRow
                  label="Glove size"
                  options={GLOVE}
                  value={s.glove_size}
                  onChange={(v) => setS({ ...s, glove_size: v })}
                />
                <SizingRow
                  label="Glove hand"
                  options={GLOVE_HAND}
                  value={s.glove_hand}
                  onChange={(v) => setS({ ...s, glove_hand: v })}
                />

                <div>
                  <label className="block text-[11px] uppercase tracking-[0.15em] text-charcoal/65 mb-1.5">
                    Anything we should know? <span className="text-charcoal/45 normal-case tracking-normal">(optional)</span>
                  </label>
                  <textarea
                    value={s.notes}
                    onChange={(e) => setS({ ...s, notes: e.target.value })}
                    placeholder="e.g. between sizes \u2014 size up; runs hot/cold; allergies; style preferences"
                    rows={3}
                    className="w-full bg-bone border border-forest/20 rounded px-3 py-2.5 text-sm text-charcoal focus:outline-none focus:border-forest resize-none"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!ready || submitting}
                  className="w-full bg-ember hover:bg-ember/90 disabled:opacity-50 disabled:cursor-not-allowed text-bone py-3.5 rounded-md text-sm font-medium tracking-wide transition"
                >
                  {submitting ? "Saving\u2026" : "Confirm sizing"}
                </button>

                {error ? (
                  <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
                    {error}
                  </div>
                ) : null}

                <p className="text-[11px] text-charcoal/55 leading-relaxed pt-3 border-t border-forest/10">
                  Wrong fit on anything? We swap it free, no questions, no
                  shipping fee. Your subscription auto-cancels after the
                  first box ships \u2014 you&apos;re only charged once unless you
                  choose to stay on.
                </p>
              </div>

              <p className="mt-6 text-[11px] text-charcoal/45 text-center">
                Reference: gift order #{orderId}
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function SizingRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-[0.15em] text-charcoal/65 mb-2">
        {label}
      </label>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={`px-3 py-1.5 rounded-md text-sm border transition ${
              value === opt
                ? "bg-forest text-bone border-forest"
                : "bg-bone text-charcoal/75 border-forest/20 hover:border-forest/40"
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}
