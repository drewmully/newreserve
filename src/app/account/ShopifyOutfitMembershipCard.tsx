import type { ShopifyOutfitMembership } from "@/lib/shopifyOutfitMembership";

export function ShopifyOutfitMembershipCard({ membership, onManage }: { membership: ShopifyOutfitMembership; onManage: () => void }) {
  return (
    <section className="mb-8 rounded-xl border border-forest bg-forest p-5 text-bone">
      <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-bone/60">Shopify subscription</p>
      <h3 className="font-serif text-lg">Mully Reserve · The Seasonal Edit</h3>
      <p className="mt-1 text-sm text-bone/70">
        Last payment: {new Intl.NumberFormat("en-US", { style: "currency", currency: membership.currency }).format(Number(membership.amount))}
      </p>
      <p className="mt-3 max-w-xl text-sm leading-relaxed text-bone/70">
        View your renewal date, pause, resume or cancel right here.
        You may need to verify the same Shopify email you used at checkout once to connect your subscription.
      </p>
      <button type="button" onClick={onManage}
        className="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg border border-bone/25 px-5 py-2 text-xs font-medium uppercase tracking-wider transition-colors hover:bg-bone/10 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-bone">
        Manage subscription
      </button>
    </section>
  );
}
