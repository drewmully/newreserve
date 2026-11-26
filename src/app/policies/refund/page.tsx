import { canonical } from "@/lib/seo";

export const metadata = {
  title: "Returns and Refund Policy | Mully",
  description: "How returns, exchanges and refunds work for Mully shop orders and Mully Reserve shipments.",
  alternates: canonical("/policies/refund"),
};

/* ═══════════════════════════════════════════
   REFUND POLICY
   ═══════════════════════════════════════════ */

export default function RefundPolicyPage() {
  return (
    <article>
      <PolicyHeader title="Refund Policy" updated="November 16, 2026" />

      <div className="policy-prose">
        <p>
          At Mully Group, Inc. (&ldquo;Mully,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;), we want you to be completely satisfied with every purchase. If something isn&rsquo;t right, we&rsquo;re here to make it right.
        </p>

        <h2>Returns</h2>
        <p>
          We accept returns within <strong>30 days of delivery</strong> for items that are unworn, unwashed, and in their original packaging with all tags attached. This applies to both Mully Pro Shop orders and subscription box orders. If your order arrived in more than one shipment, the 30 days count from the delivery of each shipment.
        </p>
        <p>
          To start a return, go to our <a href="/returns">Returns page</a> and look up your order with your order number and email. If you can&rsquo;t complete it there, email <a href="mailto:info@mymully.com">info@mymully.com</a> with your order number and reason for return.
        </p>

        <h2>Return Shipping</h2>
        <ul>
          <li><strong>Reserve Member &amp; Black tier:</strong> Free return shipping via prepaid label.</li>
          <li><strong>Reserve Access tier:</strong> Flat-rate $5.95 return shipping, deducted from your refund or store credit.</li>
          <li><strong>Free tier:</strong> Flat-rate $9.95 return shipping, deducted from your refund or store credit.</li>
        </ul>

        <h2>Refunds</h2>
        <p>
          How you&rsquo;re paid back depends on what you ordered and when you start the return:
        </p>
        <ul>
          <li><strong>Mully Pro Shop orders:</strong> Refund to your original payment method for returns started within 30 days of delivery.</li>
          <li><strong>Subscription box orders:</strong> Refund to your original payment method if you start the return within 14 days of delivery. From day 15 through day 30 after delivery, returns are issued as store credit to your Mully Pro Shop account.</li>
        </ul>
        <p>
          Once we receive and inspect your return, we&rsquo;ll process your refund or store credit within <strong>5&ndash;7 business days</strong>. You&rsquo;ll receive an email confirmation when it has been processed.
        </p>

        <h2>Exchanges</h2>
        <p>
          We offer free size exchanges. To start one, go to our <a href="/returns">Returns page</a>, look up your order with your order number and email, choose the item, and tell us the size you need. Our team reviews every request personally and replies by email with a prepaid return label. Once the original arrives back, unworn with tags attached, we ship the new size. Exchanges follow the same 30-day window as returns. Want a different item instead of a different size? Note it in your request or email <a href="mailto:Info@MyMully.com">Info@MyMully.com</a> and we&rsquo;ll help.
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
