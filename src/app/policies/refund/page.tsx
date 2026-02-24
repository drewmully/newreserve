/* ═══════════════════════════════════════════
   REFUND POLICY
   ═══════════════════════════════════════════ */

export default function RefundPolicyPage() {
  return (
    <article>
      <PolicyHeader title="Refund Policy" updated="February 1, 2026" />

      <div className="policy-prose">
        <p>
          At Mully Group, Inc. (&ldquo;Mully,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;), we want you to be completely satisfied with every purchase. If something isn&rsquo;t right, we&rsquo;re here to make it right.
        </p>

        <h2>Returns</h2>
        <p>
          We accept returns within <strong>30 days of delivery</strong> for items that are unworn, unwashed, and in their original packaging with all tags attached. To initiate a return, contact us at <a href="mailto:Info@MyMully.com">Info@MyMully.com</a> with your order number and reason for return.
        </p>

        <h2>Return Shipping</h2>
        <ul>
          <li><strong>Reserve Member &amp; Black tier:</strong> Free return shipping via prepaid label.</li>
          <li><strong>Reserve Access tier:</strong> Flat-rate $5.95 return shipping (deducted from refund).</li>
          <li><strong>Free tier:</strong> Customer is responsible for return shipping costs.</li>
        </ul>

        <h2>Refunds</h2>
        <p>
          Once we receive and inspect your return, we&rsquo;ll process your refund within <strong>5&ndash;7 business days</strong>. Refunds are issued to the original payment method. You&rsquo;ll receive an email confirmation when your refund has been processed.
        </p>

        <h2>Exchanges</h2>
        <p>
          We currently do not offer direct exchanges. If you need a different size or item, please return the original and place a new order. Reserve Members with a fit profile on file can request a one-time courtesy exchange by contacting our concierge team.
        </p>

        <h2>Non-Returnable Items</h2>
        <ul>
          <li>Personalized or monogrammed items</li>
          <li>Consumable goods (golf balls sold individually from opened packs)</li>
          <li>Items marked as final sale at the time of purchase</li>
          <li>Gift cards</li>
        </ul>

        <h2>Damaged or Defective Items</h2>
        <p>
          If your item arrives damaged or defective, contact us within <strong>7 days of delivery</strong> with photos and your order number. We&rsquo;ll send a replacement or issue a full refund at no additional cost to you.
        </p>

        <h2>Membership Cancellations</h2>
        <p>
          Membership fees are non-refundable once your billing period has begun. When you cancel, your benefits remain active through the end of the current period. See your Account page for exact dates.
        </p>

        <h2>Questions?</h2>
        <p>
          Reach us at <a href="mailto:Info@MyMully.com">Info@MyMully.com</a> or visit our <a href="/faq">FAQ page</a>. We typically respond within 24 hours.
        </p>
      </div>
    </article>
  );
}

function PolicyHeader({ title, updated }: { title: string; updated: string }) {
  return (
    <div className="mb-10">
      <span className="inline-flex items-center gap-2.5 text-[11px] tracking-[0.35em] uppercase text-sage font-medium mb-4">
        <span className="w-6 h-px bg-sage/40" />
        Policies
        <span className="w-6 h-px bg-sage/40" />
      </span>
      <h1 className="font-serif text-2xl md:text-3xl text-obsidian mb-2">{title}</h1>
      <p className="text-xs text-charcoal/35">Last updated {updated}</p>
    </div>
  );
}
