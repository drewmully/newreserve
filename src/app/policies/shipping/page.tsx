/* ═══════════════════════════════════════════
   SHIPPING POLICY
   ═══════════════════════════════════════════ */

export default function ShippingPolicyPage() {
  return (
    <article>
      <PolicyHeader title="Shipping Policy" updated="February 1, 2026" />

      <div className="policy-prose">
        <p>
          At Mully Group, Inc. (&ldquo;Mully,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;), we&rsquo;re committed to getting your gear to you as quickly and reliably as possible. Here&rsquo;s everything you need to know about our shipping.
        </p>

        <h2>Processing Time</h2>
        <p>
          All orders are processed within <strong>1 business day</strong> of being placed. Orders placed after 2:00 PM ET or on weekends/holidays will be processed the next business day.
        </p>

        <h2>Shipping Methods &amp; Rates</h2>

        <h3>Reserve Member &amp; Black Tier</h3>
        <ul>
          <li><strong>Free 2-day shipping</strong> on all orders, no minimum.</li>
          <li>Priority processing \u2014 your order ships first.</li>
        </ul>

        <h3>Reserve Access Tier</h3>
        <ul>
          <li><strong>Free 2-day shipping</strong> on all orders, no minimum.</li>
        </ul>

        <h3>Free Tier</h3>
        <ul>
          <li><strong>Standard shipping (5\u20137 business days):</strong> $5.95 per order.</li>
          <li><strong>Free standard shipping</strong> on orders over $75.</li>
          <li><strong>Expedited 2-day shipping:</strong> $12.95 per order.</li>
        </ul>

        <h2>Shipping Coverage</h2>
        <p>
          We currently ship to all 50 US states and Washington, D.C. We do not yet ship to US territories, APO/FPO addresses, or international destinations. International shipping is on our roadmap.
        </p>

        <h2>Order Tracking</h2>
        <p>
          You&rsquo;ll receive a shipping confirmation email with a tracking number as soon as your order ships. You can also view tracking information in your order history on the Account page.
        </p>

        <h2>Member Boxes</h2>
        <p>
          Quarterly member boxes for Reserve Member and Black tiers ship at the beginning of each quarter (January, April, July, October). You&rsquo;ll receive a tracking notification when your box ships. Member boxes always ship free via 2-day delivery.
        </p>

        <h2>Delivery Issues</h2>
        <p>
          If your package is lost, damaged in transit, or significantly delayed, contact us at <a href="mailto:Info@MyMully.com">Info@MyMully.com</a> with your order number. We&rsquo;ll work with the carrier to resolve the issue or send a replacement at no cost.
        </p>

        <h2>Address Accuracy</h2>
        <p>
          Please double-check your shipping address before placing an order. We are not responsible for orders shipped to incorrect addresses provided by the customer. If you notice an error, contact us immediately \u2014 we may be able to update the address before the order ships.
        </p>

        <h2>Questions?</h2>
        <p>
          Reach us at <a href="mailto:Info@MyMully.com">Info@MyMully.com</a> or visit our <a href="/faq">FAQ page</a>.
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
