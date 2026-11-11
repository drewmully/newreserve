"use client";

import { useMemo, useState } from "react";
import { useMembership } from "../../context/MembershipContext";
import { MullyWordmark } from "../components/MullyWordmark";
import { trackEvent } from "@/lib/tracking";
import {
  GIFT_CARD_HANDLE,
  GIFT_CARD_MESSAGE_MAX,
  giftCardAmountLabel,
  giftCardLineAttributes,
  sendOnRange,
  validateGiftCardForm,
  type GiftCardFieldError,
  type GiftCardForm,
} from "@/lib/giftCard";

export interface GiftCardOption {
  id: string;
  title: string;
  price: number;
  available: boolean;
}

export function GiftCardClient({ options, productId }: { options: GiftCardOption[]; productId?: string }) {
  const { addItemsToCart } = useMembership();
  const available = options.filter((o) => o.available);
  // Default to the second amount when there is one: the most common gift.
  const [selectedId, setSelectedId] = useState<string | undefined>((available[1] ?? available[0])?.id);
  const [form, setForm] = useState<GiftCardForm>({ sendTo: "them" });
  const [errors, setErrors] = useState<GiftCardFieldError>({});
  const [status, setStatus] = useState<"idle" | "adding" | "added" | "error">("idle");
  const range = useMemo(() => sendOnRange(), []);
  const selected = options.find((o) => o.id === selectedId);

  const set = (patch: Partial<GiftCardForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setErrors({});
    if (status !== "adding") setStatus("idle");
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected?.available || status === "adding") return;
    const found = validateGiftCardForm(form);
    if (Object.keys(found).length) {
      setErrors(found);
      return;
    }
    setStatus("adding");
    try {
      await addItemsToCart([
        {
          slug: GIFT_CARD_HANDLE,
          name: "Mully Gift Card",
          brand: "Mully",
          price: selected.price,
          retailPrice: selected.price,
          variantId: selected.id,
          variantTitle: selected.title,
          attributes: giftCardLineAttributes(form),
        },
      ]);
      setStatus("added");
      void trackEvent("gift_card_added", {
        properties: {
          product_id: productId,
          variant_id: selected.id,
          value: selected.price,
          send_to: form.sendTo,
          scheduled: form.sendTo === "them" && !!form.sendOn && form.sendOn > range.min,
          has_message: form.sendTo === "them" && !!form.message?.trim(),
        },
      });
    } catch {
      setStatus("error");
    }
  };

  const messageLeft = GIFT_CARD_MESSAGE_MAX - (form.message?.length ?? 0);

  return (
    <div className="gc-layout">
      <div className="gc-visual" aria-hidden="true">
        <div className="gc-card">
          <MullyWordmark accent="#c9d0b0" tone="light" className="gc-card__mark" />
          <p className="gc-card__label">Gift card</p>
          <p className="gc-card__amount">{selected ? giftCardAmountLabel(selected.price) : ""}</p>
        </div>
      </div>

      <form className="gc-form" onSubmit={onSubmit} noValidate>
        <p className="gc-kicker">Delivered by email</p>
        <h1 className="gc-h1">Mully Gift Card</h1>
        <p className="gc-lead">
          Most gift cards arrive by email within minutes. Good for anything in the Mully shop, so he picks the piece and the size.
        </p>

        {options.length === 0 ? (
          <p className="gc-note" role="status">Gift cards are not available right now. Please check back soon.</p>
        ) : (
          <>
            <fieldset className="gc-field">
              <legend className="gc-legend">Amount</legend>
              <div className="gc-amounts">
                {options.map((o) => (
                  <label key={o.id} className={`gc-amount${o.id === selectedId ? " is-selected" : ""}${o.available ? "" : " is-disabled"}`}>
                    <input
                      type="radio"
                      name="amount"
                      value={o.id}
                      checked={o.id === selectedId}
                      disabled={!o.available}
                      onChange={() => { setSelectedId(o.id); if (status !== "adding") setStatus("idle"); }}
                    />
                    <span>{giftCardAmountLabel(o.price)}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="gc-field">
              <legend className="gc-legend">Who gets the email?</legend>
              <div className="gc-sendto">
                <label className={form.sendTo === "them" ? "is-selected" : ""}>
                  <input type="radio" name="sendTo" value="them" checked={form.sendTo === "them"} onChange={() => set({ sendTo: "them" })} />
                  <span><strong>Email it to him</strong><small>With your note, now or on a date you pick</small></span>
                </label>
                <label className={form.sendTo === "me" ? "is-selected" : ""}>
                  <input type="radio" name="sendTo" value="me" checked={form.sendTo === "me"} onChange={() => set({ sendTo: "me" })} />
                  <span><strong>Email it to me</strong><small>To print or forward yourself</small></span>
                </label>
              </div>
            </fieldset>

            {form.sendTo === "them" && (
              <div className="gc-recipient">
                <label className="gc-input">
                  <span>His email</span>
                  <input
                    type="email"
                    autoComplete="off"
                    inputMode="email"
                    value={form.recipientEmail ?? ""}
                    onChange={(e) => set({ recipientEmail: e.target.value })}
                    aria-invalid={!!errors.recipientEmail}
                    aria-describedby={errors.recipientEmail ? "gc-err-email" : undefined}
                    required
                  />
                  {errors.recipientEmail && <em id="gc-err-email" className="gc-error">{errors.recipientEmail}</em>}
                </label>
                <label className="gc-input">
                  <span>His name <small>(optional)</small></span>
                  <input type="text" autoComplete="off" value={form.recipientName ?? ""} onChange={(e) => set({ recipientName: e.target.value })} />
                </label>
                <label className="gc-input">
                  <span>Your note <small>(optional)</small></span>
                  <textarea
                    rows={3}
                    maxLength={GIFT_CARD_MESSAGE_MAX}
                    value={form.message ?? ""}
                    onChange={(e) => set({ message: e.target.value })}
                    aria-invalid={!!errors.message}
                    aria-describedby="gc-msg-count"
                  />
                  <small id="gc-msg-count" className="gc-count">{messageLeft} characters left</small>
                  {errors.message && <em className="gc-error">{errors.message}</em>}
                </label>
                <label className="gc-input">
                  <span>Send date <small>(optional)</small></span>
                  <input
                    type="date"
                    min={range.min}
                    max={range.max}
                    value={form.sendOn ?? ""}
                    onChange={(e) => set({ sendOn: e.target.value })}
                    aria-invalid={!!errors.sendOn}
                    aria-describedby="gc-date-help"
                  />
                  <small id="gc-date-help" className="gc-help">Pick a send date, like Christmas morning. Leave it blank to send it now.</small>
                  {errors.sendOn && <em className="gc-error">{errors.sendOn}</em>}
                </label>
              </div>
            )}

            <button type="submit" className="gc-button" disabled={!selected?.available || status === "adding"}>
              {status === "adding" ? "Adding…" : status === "added" ? "Added to bag" : `Add ${selected ? giftCardAmountLabel(selected.price) + " gift card" : "gift card"} to bag`}
            </button>
            {status === "error" && <p className="gc-error" role="alert">We couldn&apos;t add the gift card. Please try again.</p>}
            <p className="gc-fine">No shipping needed. You&apos;ll see the email details on the checkout page before you pay.</p>
          </>
        )}
      </form>
    </div>
  );
}
