"use client";

/**
 * Next step for "nothing found" states on /account. Subscriptions and orders
 * are matched by the email used at checkout, so the most common cause of an
 * empty list is a purchase made with a different address.
 */

export const SUPPORT_EMAIL = "info@mymully.com";

export function supportMailto(input: { email?: string | null; uid?: string | null; topic: string }): string {
  const lines = [
    `Hi Mully team,`,
    ``,
    `I can't find my ${input.topic} in my MyMully account.`,
    ``,
    `Account email: ${input.email || "(not available)"}`,
    ...(input.uid ? [`Account ID: ${input.uid}`] : []),
    `Email I used at checkout (if different): `,
  ];
  const params = new URLSearchParams({
    subject: `Can't find my ${input.topic}`,
    body: lines.join("\n"),
  });
  // URLSearchParams encodes spaces as "+", which some mail clients show
  // literally; mailto bodies expect %20.
  return `mailto:${SUPPORT_EMAIL}?${params.toString().replace(/\+/g, "%20")}`;
}

export function DifferentEmailHelp({
  email,
  uid,
  topic,
  onSignOut,
  className = "",
}: {
  email?: string | null;
  uid?: string | null;
  /** "subscription" or "orders" — used in the support email. */
  topic: string;
  onSignOut?: () => void;
  className?: string;
}) {
  return (
    <div className={`text-xs text-charcoal/55 leading-relaxed ${className}`} data-testid="different-email-help">
      <p className="mb-2">
        Bought with a different email?{" "}
        {email ? (
          <>
            You&rsquo;re signed in as <strong className="text-obsidian font-medium">{email}</strong>.{" "}
          </>
        ) : null}
        Sign out and sign in with that email, or contact us and we&rsquo;ll link it for you.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-4">
        {onSignOut && (
          <button
            type="button"
            onClick={onSignOut}
            className="underline underline-offset-4 hover:text-obsidian transition-colors cursor-pointer"
          >
            Sign out
          </button>
        )}
        <a
          href={supportMailto({ email, uid, topic })}
          className="underline underline-offset-4 hover:text-obsidian transition-colors"
        >
          Contact us
        </a>
      </div>
    </div>
  );
}
