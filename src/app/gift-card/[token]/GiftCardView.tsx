"use client";

/**
 * Printable Gift a Season card for "I'll give it myself" gifts. The sizing
 * link printed on the card is the recipient's private link (token = auth).
 * Copy rules: no em dashes, "Reserve" never "box".
 */

export interface GiftCardViewProps {
  recipientFirstName: string | null;
  purchaserFirstName: string | null;
  giftMessage: string | null;
  seasonsTotal: number;
  sizingUrl: string;
}

export default function GiftCardView({
  recipientFirstName,
  purchaserFirstName,
  giftMessage,
  seasonsTotal,
  sizingUrl,
}: GiftCardViewProps) {
  const seasonsLabel = seasonsTotal === 1 ? "a season" : `${seasonsTotal} seasons`;
  const recipient = recipientFirstName?.trim();
  const from = purchaserFirstName?.trim();
  const displayUrl = sizingUrl.replace(/^https?:\/\//, "");

  return (
    <div className="min-h-screen bg-bone-dark/40 print:bg-white text-charcoal flex flex-col items-center py-10 px-4">
      <style>{`@media print { @page { size: letter landscape; margin: 0.5in; } }`}</style>
      <div
        className="w-full max-w-[640px] aspect-[7/5] bg-bone border border-forest/25 rounded-lg print:rounded-none shadow-sm print:shadow-none p-8 sm:p-10 flex flex-col"
        data-testid="gift-card"
      >
        <div className="text-[11px] tracking-[0.25em] uppercase text-ember/80">Mully Reserve</div>
        <h1 className="font-serif text-3xl sm:text-4xl text-forest leading-[1.1] mt-3">
          {recipient ? `${recipient}, you've been given` : "You've been given"} {seasonsLabel} of
          Mully Reserve.
        </h1>
        <p className="text-sm text-charcoal/75 mt-3 leading-relaxed">
          Golf apparel and accessories hand-picked by a Mully stylist each season. Prepaid, and it
          never renews.
        </p>
        {giftMessage?.trim() ? (
          <p className="font-serif text-base text-charcoal/85 mt-4 leading-relaxed">
            &ldquo;{giftMessage.trim()}&rdquo;
            {from ? <span className="block text-sm text-charcoal/60 mt-1">{from}</span> : null}
          </p>
        ) : from ? (
          <p className="text-sm text-charcoal/60 mt-4">From {from}</p>
        ) : null}
        <div className="mt-auto pt-5 border-t border-forest/15">
          <div className="text-[11px] uppercase tracking-[0.15em] text-charcoal/60">
            Confirm your sizing to start
          </div>
          <div className="text-sm text-forest mt-1 break-all font-medium">{displayUrl}</div>
        </div>
      </div>
      <button
        type="button"
        onClick={() => window.print()}
        className="mt-6 print:hidden bg-ember hover:bg-ember/90 text-bone px-6 py-3 rounded-md text-sm font-medium tracking-wide"
      >
        Print gift card
      </button>
      <p className="mt-3 print:hidden text-[11px] text-charcoal/55 max-w-md text-center">
        The link on the card is private to this gift. Share it only with the recipient.
      </p>
    </div>
  );
}
