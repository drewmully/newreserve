import type { ShopifyOutfitMembership } from "@/lib/shopifyOutfitMembership";
import Link from "next/link";
import type { ShopifySubscriptionState } from "../context/useShopifySubscriptions";

export function ShopifyOutfitMembershipCard({ membership, onManage, live, onRefresh }: {
  membership: ShopifyOutfitMembership;
  onManage: () => void;
  live?: ShopifySubscriptionState;
  onRefresh?: () => void;
}) {
  const contracts = live?.contracts ?? [];
  // Offer re-enrollment only when every known contract is cancelled, never while
  // an active/paused second subscription might still renew.
  const cancelled = live?.state === "ready" && contracts.length > 0 && contracts.every(c => c.status === "CANCELLED");
  return (
    <section className="mb-8 rounded-xl border border-forest bg-forest p-5 text-bone">
      <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-bone/60">Shopify subscription</p>
      <h3 className="font-serif text-lg">Mully Reserve · The Seasonal Edit</h3>
      <p className="mt-1 text-sm text-bone/70">
        Item price before discounts: {new Intl.NumberFormat("en-US", { style: "currency", currency: membership.currency }).format(Number(membership.amount))}
      </p>
      <div className="mt-4 space-y-3 text-sm" aria-live="polite">
        {contracts.map((contract, index) => <div key={contract.id}>
          <p className="font-medium">
            {contracts.length > 1 ? `Subscription ${index + 1}: ` : "Status: "}
            {({ ACTIVE: "Active", PAUSED: "Paused", CANCELLED: "Cancelled", FAILED: "Needs attention", EXPIRED: "Expired" } as Record<string, string>)[contract.status] ?? contract.status}
            {live?.stale ? " (last confirmed)" : ""}
          </p>
          <p className="mt-1 text-bone/75">
            {contract.status === "CANCELLED" ? "No further automatic renewals. Already-paid orders are unaffected."
              : contract.status === "PAUSED" ? "Automatic renewals are paused."
              : contract.status === "ACTIVE" && contract.nextBillingDateEpoch
                ? `Next renewal: ${new Date(contract.nextBillingDateEpoch * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
                : "View your subscription for details."}
          </p>
        </div>)}
        {(!live || live.state === "loading") && <p className="text-bone/75">Checking subscription status…</p>}
        {live?.state === "ready" && !contracts.length && <p className="text-bone/75">No matching subscription found. Contact Mully if you recently enrolled.</p>}
        {live?.state === "error" && <p className="text-bone/75">We couldn’t refresh your subscription status. <button type="button" onClick={onRefresh} className="underline underline-offset-4">Try again</button></p>}
        {live?.state === "connection_required" && <p className="text-bone/75">Verify the same Shopify email you used at checkout to see your current status.</p>}
      </div>
      {cancelled && <div className="mt-4">
        <Link href="/shop#outfit" className="inline-flex min-h-11 items-center rounded-lg bg-bone px-5 py-2 text-sm font-medium text-forest transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-bone">Start a new subscription</Link>
        <p className="mt-2 max-w-xl text-xs leading-relaxed text-bone/75">Choose your outfit and review current pricing at checkout. This starts a new paid subscription, not a restart of the cancelled one.</p>
      </div>}
      <button type="button" onClick={onManage}
        className="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg border border-bone/25 px-5 py-2 text-xs font-medium uppercase tracking-wider transition-colors hover:bg-bone/10 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-bone">
        {cancelled ? "View subscription" : live?.state === "connection_required" ? "Connect Shopify account" : "Manage subscription"}
      </button>
    </section>
  );
}
