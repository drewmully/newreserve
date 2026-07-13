/**
 * Reveal Brick — V2 of the reveal page (v3 visual pass).
 *
 * Hypothesis: a literal pick-ticket from a real curator beats a marketing
 * page. We show Martine (Sr. Curation Associate), then the work order in her
 * hand, then four icon chips, then one CTA. Validates preferences without
 * promising SKUs. A small secondary "Text me" pill next to Martine's photo
 * lets shoppers text her directly for style advice.
 *
 * Copy rules (must hold across the file):
 *   - No em or double dashes anywhere. Use commas, periods, parentheses.
 *   - Reserve price is $250, never $249.
 *   - Never use the word "box". Use "edit" / "quarter" / "curation" / "Reserve".
 *   - "Mully", never "Mullybox".
 *   - Validate preferences, do not overpromise curation outcomes.
 */

import Image from "next/image";
import { STYLE_BUCKET_LABELS, type StyleBucket } from "@/lib/styleProfiles/types";
import { ReserveCheckoutCTA, type QuizLineItemPropsInput } from "./ReserveCheckoutCTA";
import { RevealPageView } from "./RevealPageView";

const FIT_DESCRIPTOR: Record<string, string> = {
  Tailored: "Tailored",
  Regular: "Regular",
  Relaxed: "Relaxed",
};

interface RevealBrickProps {
  profileId: string;
  bucket: StyleBucket;
  quizLineItemProps: QuizLineItemPropsInput;
  alreadyConverted: boolean;
  /**
   * Optional first name from the quiz submission. Threaded through so the
   * "Text me for style advice" SMS deep link can prefill the shopper's name
   * in the message body. Falls back gracefully if absent.
   */
  firstName?: string;
  /**
   * Gift mode (Father's Day flow): rewrites the curator caption + chips to
   * reframe the work order as a gift the giftor is sending to Dad. This is
   * the one place in Reserve copy where "box" is allowed — Drew explicitly
   * approved "his box" framing for the Father's Day reveal.
   */
  giftMode?: boolean;
}

// Deterministic short pick-ticket number from profileId so it feels real and
// stays stable per visitor. Not stored, not used for routing.
function pickNumber(profileId: string): string {
  let h = 0;
  for (let i = 0; i < profileId.length; i++) {
    h = (h * 31 + profileId.charCodeAt(i)) >>> 0;
  }
  const n = (h % 9000) + 1000;
  return `MR-${n}`;
}

export function RevealBrick({
  profileId,
  bucket,
  quizLineItemProps,
  alreadyConverted,
  firstName,
  giftMode = false,
}: RevealBrickProps) {
  if (alreadyConverted) {
    return <BrickConvertedState />;
  }

  const bucketLabel = STYLE_BUCKET_LABELS[bucket];
  const fitLabel = quizLineItemProps.fit
    ? FIT_DESCRIPTOR[quizLineItemProps.fit] ?? quizLineItemProps.fit
    : null;

  const sizeParts: string[] = [];
  if (quizLineItemProps.topSize) sizeParts.push(`Top ${quizLineItemProps.topSize}`);
  if (quizLineItemProps.bottomSize) sizeParts.push(`Waist ${quizLineItemProps.bottomSize}`);
  const sizesLabel = sizeParts.length ? sizeParts.join(" / ") : null;

  const wants = quizLineItemProps.categoryPrefs.slice(0, 3).join(", ");
  const brands = quizLineItemProps.favoriteBrands.slice(0, 3).join(", ");

  const ticketNo = pickNumber(profileId);

  // "Text me for style advice" SMS deep link. Prefills a friendly opener
  // addressed to Martine, personalized with the shopper's first name when we
  // have it. Uses ?body= for iOS compatibility (Android also honors it).
  const smsBody = firstName && firstName.trim()
    ? `Hi Martine! My name is ${firstName.trim()}, and I'm looking at joining Mully. How does the curation work?`
    : "Hi Martine! I'm looking at joining Mully. How does the curation work?";
  const smsHref = `sms:+19493299066?&body=${encodeURIComponent(smsBody)}`;

  // Build the rows the ticket actually shows. Skip empties.
  const rows: { icon: React.ReactNode; label: string; value: string }[] = [];
  rows.push({ icon: <IconStyle />, label: "STYLE", value: bucketLabel });
  if (fitLabel) rows.push({ icon: <IconFit />, label: "FIT", value: fitLabel });
  if (sizesLabel) rows.push({ icon: <IconRuler />, label: "SIZES", value: sizesLabel });
  if (wants) rows.push({ icon: <IconShirt />, label: "WANTS", value: wants });
  if (brands) rows.push({ icon: <IconTag />, label: "BRAND CUES", value: brands });

  return (
    <main className="min-h-screen bg-bone text-charcoal">
      <RevealPageView profileId={profileId} bucket={bucket} variant="v2" />

      <section className="mx-auto flex min-h-screen max-w-xl flex-col px-5 py-7 sm:px-6 sm:py-10">
        {/* Martine portrait + caption + "Text me" pill */}
        <div className="flex items-start gap-3.5">
          <div className="relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-full ring-2 ring-forest/15 sm:h-16 sm:w-16">
            <Image
              src="/team/martine-round.webp"
              alt="Martine Jordan, Sr. Curation Associate at Mully"
              fill
              sizes="64px"
              className="object-cover"
              priority
            />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-ember/85">
              {giftMode ? "His Father's Day box" : "Picked by hand"}
            </p>
            <p className="mt-0.5 text-[13px] leading-snug text-charcoal/85 sm:text-sm">
              <span className="font-semibold text-forest">Martine</span>, Sr. Curation Associate.
              {giftMode
                ? " Here's the work order she'll use to curate Dad's box."
                : " Here's the work order she'll use to pack your shipment."}
            </p>
            <a
              href={smsHref}
              className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-forest/25 bg-bone px-3 py-1.5 text-[12px] font-medium text-forest transition hover:border-forest/50 hover:bg-forest/5 sm:text-[13px]"
            >
              <IconChatBubble />
              Text me
            </a>
          </div>
        </div>

        {/* The pick ticket */}
        <div className="relative mt-5">
          {/* Perforation: top edge notches */}
          <PerforatedEdge position="top" />

          <div className="rounded-md border border-forest/20 bg-bone-dark/40 px-5 pb-5 pt-4 shadow-[0_1px_0_rgba(0,0,0,0.02)] sm:px-6 sm:pb-6 sm:pt-5">
            {/* Ticket header row */}
            <div className="flex items-baseline justify-between border-b border-dashed border-forest/25 pb-2.5">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-charcoal/55">
                Pick Order
              </p>
              <p className="font-mono text-[11px] tracking-wider text-forest">
                #{ticketNo}
              </p>
            </div>

            {/* Rows */}
            <ul className="mt-3 divide-y divide-forest/10">
              {rows.map((r, i) => (
                <li
                  key={i}
                  className="flex items-center gap-3 py-2.5 first:pt-1 last:pb-1"
                >
                  <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center text-forest/70">
                    {r.icon}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-charcoal/55 w-[78px] flex-shrink-0">
                    {r.label}
                  </span>
                  <span className="min-w-0 flex-1 text-right text-sm text-forest sm:text-[15px]">
                    {r.value}
                  </span>
                </li>
              ))}
            </ul>

            {/* Footer stamp */}
            <div className="mt-3 flex items-center justify-between border-t border-dashed border-forest/25 pt-2.5">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-charcoal/55">
                {giftMode ? "Ship to" : "Status"}
              </p>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ember">
                {giftMode ? "Dad's door" : "Awaiting checkout"}
              </p>
            </div>
          </div>

          {/* Perforation: bottom edge notches */}
          <PerforatedEdge position="bottom" />
        </div>

        {/* Four chip rows, icon-led, max 6 words each */}
        <ul className="mt-6 grid grid-cols-2 gap-2.5 sm:gap-3">
          <Chip icon={<IconPrice />} text="$250 / quarter" />
          <Chip icon={<IconBox />} text="4 to 6 pieces" />
          <Chip icon={<IconTruck />} text={giftMode ? "Ships to his door" : "Ships in 2 days"} />
          <Chip icon={<IconGift />} text="$300+ in retail" />
        </ul>

        {/* CTA */}
        <div className="mt-7">
          <ReserveCheckoutCTA
            profileId={profileId}
            styleBucket={bucket}
            quizLineItemProps={quizLineItemProps}
          />
          <p className="mt-3 text-center text-xs text-charcoal/60">
            Cancel anytime after the first quarter. Free shipping.
          </p>
        </div>

        {/* Trust line */}
        <p className="mt-7 text-center text-[10px] uppercase tracking-[0.22em] text-charcoal/45">
          96% renewal &middot; built by golfers in Detroit
        </p>
      </section>
    </main>
  );
}

function Chip({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <li className="flex items-center gap-2 rounded-md border border-forest/15 bg-bone-dark/30 px-3 py-2.5 text-[13px] text-forest sm:text-sm">
      <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center text-ember">
        {icon}
      </span>
      <span className="font-medium">{text}</span>
    </li>
  );
}

/**
 * Perforated edge: a row of small bone-colored half-circles tucked into the
 * top/bottom of the ticket so it reads like a tear-off pick slip.
 */
function PerforatedEdge({ position }: { position: "top" | "bottom" }) {
  const dots = Array.from({ length: 14 });
  const placement =
    position === "top"
      ? "-top-[6px]"
      : "-bottom-[6px]";
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute left-2 right-2 ${placement} flex justify-between`}
    >
      {dots.map((_, i) => (
        <span
          key={i}
          className="h-3 w-3 rounded-full bg-bone ring-1 ring-forest/20"
        />
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Inline SVG icons. Tasteful, monoline, currentColor.                       */
/* -------------------------------------------------------------------------- */

function svgProps() {
  return {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    width: "100%",
    height: "100%",
  };
}

function IconChatBubble() {
  // Small speech-bubble glyph for the "Text me" pill next to Martine.
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={13}
      height={13}
      aria-hidden="true"
    >
      <path d="M4 5.5A2.5 2.5 0 016.5 3h11A2.5 2.5 0 0120 5.5v8A2.5 2.5 0 0117.5 16H10l-4 3v-3H6.5A2.5 2.5 0 014 13.5v-8z" />
    </svg>
  );
}

function IconStyle() {
  // Sparkle / star-ish
  return (
    <svg {...svgProps()}>
      <path d="M12 3l1.8 4.6L18.5 9l-4.7 1.4L12 15l-1.8-4.6L5.5 9l4.7-1.4L12 3z" />
    </svg>
  );
}

function IconFit() {
  // Person outline
  return (
    <svg {...svgProps()}>
      <circle cx="12" cy="7" r="3" />
      <path d="M5 21c0-3.9 3.1-7 7-7s7 3.1 7 7" />
    </svg>
  );
}

function IconRuler() {
  return (
    <svg {...svgProps()}>
      <path d="M3 14l7-7 10 10-7 7L3 14z" />
      <path d="M7 12l1.5 1.5M10 9l1.5 1.5M13 6l1.5 1.5" />
    </svg>
  );
}

function IconShirt() {
  return (
    <svg {...svgProps()}>
      <path d="M4 7l4-3 2 2h4l2-2 4 3-2 3-2-1v11H8V9l-2 1-2-3z" />
    </svg>
  );
}

function IconTag() {
  return (
    <svg {...svgProps()}>
      <path d="M3 12l9-9h8v8l-9 9-8-8z" />
      <circle cx="15.5" cy="8.5" r="1.2" />
    </svg>
  );
}

function IconPrice() {
  return (
    <svg {...svgProps()}>
      <path d="M12 3v18M16 7H10a2.5 2.5 0 0 0 0 5h4a2.5 2.5 0 0 1 0 5H8" />
    </svg>
  );
}

function IconBox() {
  // Folded shirts / stack
  return (
    <svg {...svgProps()}>
      <rect x="3" y="5" width="18" height="4" rx="0.5" />
      <rect x="3" y="11" width="18" height="4" rx="0.5" />
      <rect x="3" y="17" width="18" height="3" rx="0.5" />
    </svg>
  );
}

function IconTruck() {
  return (
    <svg {...svgProps()}>
      <rect x="2" y="7" width="11" height="9" rx="1" />
      <path d="M13 10h4l3 3v3h-7z" />
      <circle cx="7" cy="18" r="1.6" />
      <circle cx="17" cy="18" r="1.6" />
    </svg>
  );
}

function IconGift() {
  return (
    <svg {...svgProps()}>
      <rect x="3" y="9" width="18" height="12" rx="1" />
      <path d="M3 13h18M12 9v12" />
      <path d="M12 9c-1.5-3-5-3-5-1s2 2 5 1zM12 9c1.5-3 5-3 5-1s-2 2-5 1z" />
    </svg>
  );
}

function BrickConvertedState() {
  return (
    <main className="min-h-screen bg-bone text-charcoal">
      <section className="mx-auto max-w-xl px-5 py-16 sm:px-6">
        <div className="rounded-lg border border-forest/30 bg-forest/5 p-8 text-center">
          <div className="text-[11px] uppercase tracking-[0.22em] text-forest/80">
            You&apos;re in
          </div>
          <h2 className="mt-2 font-serif text-2xl text-forest">
            Looks like you&apos;ve already joined Reserve.
          </h2>
          <p className="mt-3 text-sm text-charcoal/75">
            Check your inbox for next steps. If nothing landed, reply to drew@mymully.com and I&apos;ll sort it out personally.
          </p>
        </div>
      </section>
    </main>
  );
}
