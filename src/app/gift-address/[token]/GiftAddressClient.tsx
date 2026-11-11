"use client";

/**
 * /gift-address/[token]: where the next seasons of a Gift a Season ship,
 * plus a sizes check. One link for both modes:
 *   - Ship to me: the recipient (or the purchaser as fallback) gives the
 *     address for seasons 2..N after opening season 1.
 *   - Any mode: update sizes or address before each season.
 * Posts to /api/gifts/submit-address. Copy rules: no em dashes, "Reserve"
 * never "box".
 */

import { useState } from "react";
import { ShopSeasonalHeader } from "@/app/shop/components/ShopSeasonalHeader";
import { GiftSizingFields } from "@/app/components/gifts/GiftSizingFields";
import {
  US_STATES,
  formatGiftAddress,
  validateGiftAddress,
  type GiftShipAddress,
} from "@/lib/gifts/giftSeason";
import { missingSizing, sanitizeSizing, type GiftSizing } from "@/lib/gifts/giftSizing";

export interface GiftAddressClientProps {
  token: string;
  recipientFirstName: string | null;
  purchaserFirstName: string | null;
  seasonsTotal: number;
  /** Next season still to ship (2..N), or null when every season is out. */
  nextSeason: number | null;
  /** "March 4" or null if season 1 hasn't shipped yet. */
  nextDueLabel: string | null;
  existingAddress: Partial<GiftShipAddress> | null;
  existingSizing: Record<string, string> | null;
  askEmail: boolean;
  /** "p" when the link came from a purchaser email. */
  by: "recipient" | "purchaser";
  /** Preview fixtures: never call the API. */
  fixture?: boolean;
}

const EMPTY_ADDRESS: GiftShipAddress = {
  first_name: "",
  last_name: "",
  address1: "",
  address2: "",
  city: "",
  province_code: "",
  zip: "",
  country_code: "US",
  phone: "",
};

const inputCls =
  "w-full bg-bone border border-forest/20 rounded px-3 py-2.5 text-sm focus:outline-none focus:border-forest";

export default function GiftAddressClient(props: GiftAddressClientProps) {
  const { recipientFirstName, purchaserFirstName, seasonsTotal, nextSeason, nextDueLabel } = props;
  const [address, setAddress] = useState<GiftShipAddress>({
    ...EMPTY_ADDRESS,
    first_name: props.existingAddress?.first_name ?? recipientFirstName ?? "",
    ...Object.fromEntries(
      Object.entries(props.existingAddress ?? {}).filter(([, v]) => typeof v === "string" && v)
    ),
  });
  const [sizing, setSizing] = useState<GiftSizing>(sanitizeSizing(props.existingSizing ?? {}));
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const hadAddress = !!props.existingAddress?.address1;
  const set = (k: keyof GiftShipAddress) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setAddress({ ...address, [k]: e.target.value });

  async function save() {
    setError(null);
    const v = validateGiftAddress(address);
    if (!v.ok) return setError(v.error);
    const missing = missingSizing(sizing);
    if (missing.length) return setError(`Pick a ${missing[0].toLowerCase()}.`);
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return setError("Check the email, or leave it blank.");
    }
    setSaving(true);
    try {
      if (!props.fixture) {
        const res = await fetch("/api/gifts/submit-address", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: props.token, address: v.address, sizing, email: email.trim(), by: props.by }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? "Could not save. Please try again.");
        }
      }
      setSaved(formatGiftAddress(v.address));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const name = recipientFirstName?.trim();
  const from = purchaserFirstName?.trim();
  const isPurchaser = props.by === "purchaser";

  return (
    <div className="min-h-screen bg-bone text-charcoal">
      <ShopSeasonalHeader accent="#4A3528" returnsLabel="Easy Returns" />
      <main className="pt-32 lg:pt-28 pb-16">
        <div className="max-w-xl mx-auto px-5">
          {nextSeason === null ? (
            <div className="py-10" data-testid="gift-address-complete">
              <h1 className="font-serif text-[28px] leading-[1.15] text-[#111]">Every season has shipped.</h1>
              <p className="text-sm text-charcoal/75 mt-3 leading-relaxed">
                All {seasonsTotal} Reserves from this gift are on their way or delivered. Questions? Reply to any Mully email.
              </p>
            </div>
          ) : saved ? (
            <div className="py-10" data-testid="gift-address-saved">
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-forest text-bone">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                  <path d="M5 12l5 5 9-11" />
                </svg>
              </div>
              <h1 className="font-serif text-[28px] leading-[1.15] text-[#111] mt-4">You&apos;re all set.</h1>
              <p className="text-sm text-charcoal/75 mt-3 leading-relaxed">
                Season {nextSeason}
                {nextDueLabel ? ` ships around ${nextDueLabel}` : " ships on schedule"} to {saved}.
              </p>
              <p className="text-[12px] text-charcoal/60 mt-3">You can use this same link to make changes before each season.</p>
            </div>
          ) : (
            <>
              <div className="text-[11px] uppercase tracking-[0.12em] text-[#5b613f]">
                Mully Reserve gift · Season {nextSeason} of {seasonsTotal}
              </div>
              <h1 className="font-serif font-normal text-[28px] sm:text-[34px] leading-[1.12] tracking-[-0.02em] text-[#111] mt-2">
                {hadAddress
                  ? "Check your sizes and address."
                  : isPurchaser
                    ? `Where should ${name ? `${name}'s` : "their"} next Reserve ship?`
                    : "Where should your next Reserve ship?"}
              </h1>
              <p className="text-sm text-charcoal/75 mt-3 leading-relaxed">
                {isPurchaser
                  ? `Add ${name ? `${name}'s` : "their"} address for the next seasons, or forward this link to them.`
                  : from
                    ? `${from} gave you ${seasonsTotal} seasons of Mully Reserve.`
                    : `You have ${seasonsTotal} seasons of Mully Reserve.`}{" "}
                {nextDueLabel ? `Season ${nextSeason} ships around ${nextDueLabel}.` : null}
              </p>

              <section className="mt-7 bg-bone-dark/40 rounded-lg border border-forest/15 p-5" aria-label="Shipping address" data-testid="gift-address-form">
                <div className="text-sm text-[#111] mb-3">Ship to</div>
                <div className="grid grid-cols-2 gap-3">
                  <L label="First name"><input className={inputCls} value={address.first_name} onChange={set("first_name")} autoComplete="given-name" /></L>
                  <L label="Last name"><input className={inputCls} value={address.last_name} onChange={set("last_name")} autoComplete="family-name" /></L>
                  <div className="col-span-2"><L label="Street address"><input className={inputCls} value={address.address1} onChange={set("address1")} autoComplete="address-line1" /></L></div>
                  <div className="col-span-2"><L label="Apt, suite" optional><input className={inputCls} value={address.address2} onChange={set("address2")} autoComplete="address-line2" /></L></div>
                  <div className="col-span-2"><L label="City"><input className={inputCls} value={address.city} onChange={set("city")} autoComplete="address-level2" /></L></div>
                  <L label="State">
                    <select className={inputCls} value={address.province_code} onChange={set("province_code")} autoComplete="address-level1">
                      <option value="">Select</option>
                      {US_STATES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
                    </select>
                  </L>
                  <L label="ZIP"><input className={inputCls} value={address.zip} onChange={set("zip")} inputMode="numeric" autoComplete="postal-code" /></L>
                  <div className="col-span-2"><L label="Phone" optional hint="Only for delivery issues."><input className={inputCls} value={address.phone} onChange={set("phone")} type="tel" autoComplete="tel" /></L></div>
                </div>
              </section>

              <section className="mt-4 bg-bone-dark/40 rounded-lg border border-forest/15 p-5" aria-label="Sizes">
                <div className="flex items-baseline justify-between gap-3 mb-3">
                  <div className="text-sm text-[#111]">{isPurchaser ? "Their sizes" : "Your sizes"}</div>
                  <div className="text-[11px] text-charcoal/60">Confirm or update.</div>
                </div>
                <GiftSizingFields value={sizing} onChange={setSizing} compact />
              </section>

              {props.askEmail ? (
                <section className="mt-4 bg-bone-dark/40 rounded-lg border border-forest/15 p-5">
                  <L label={isPurchaser ? "Their email" : "Your email"} optional hint="We'll send a reminder with this link before each season.">
                    <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@email.com" />
                  </L>
                </section>
              ) : null}

              <button
                type="button"
                onClick={save}
                disabled={saving}
                data-testid="gift-address-save"
                className="w-full mt-5 bg-ember hover:bg-ember/90 disabled:opacity-60 text-bone py-3.5 rounded-md text-sm font-medium tracking-wide transition"
              >
                {saving ? "Saving..." : "Save"}
              </button>
              {error ? (
                <div role="alert" className="mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">{error}</div>
              ) : null}
              <p className="mt-3 text-center text-[11px] text-charcoal/60">
                Changes apply to every Reserve still to come. US addresses only.
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function L({ label, optional, hint, children }: { label: string; optional?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-[0.15em] text-charcoal/65 mb-1.5">
        {label}
        {optional ? <span className="text-charcoal/45 ml-1 normal-case tracking-normal">(optional)</span> : null}
      </span>
      {children}
      {hint ? <span className="block text-[10px] text-charcoal/55 mt-1">{hint}</span> : null}
    </label>
  );
}
