/* ═══════════════════════════════════════════
   PRIVACY POLICY
   ═══════════════════════════════════════════ */

export default function PrivacyPolicyPage() {
  return (
    <article>
      <PolicyHeader title="Privacy Policy" updated="February 1, 2026" />

      <div className="policy-prose">
        <p>
          Mully Group, Inc. (&ldquo;Mully,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;) is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you visit <a href="https://mymully.com">mymully.com</a> or use our services.
        </p>

        <h2>Information We Collect</h2>

        <h3>Information You Provide</h3>
        <ul>
          <li><strong>Account information:</strong> Name, email address, username, and password when you create an account.</li>
          <li><strong>Fit profile:</strong> Sizing preferences (shirt, glove, waist, inseam, shoe) you enter voluntarily.</li>
          <li><strong>Payment information:</strong> Billing address and payment method details, processed securely by Stripe. We never store your full card number.</li>
          <li><strong>Order information:</strong> Shipping address, order history, and product preferences.</li>
          <li><strong>Communications:</strong> Messages you send through our concierge service, community posts, or customer support.</li>
        </ul>

        <h3>Information Collected Automatically</h3>
        <ul>
          <li><strong>Device data:</strong> Browser type, operating system, device identifiers, and IP address.</li>
          <li><strong>Usage data:</strong> Pages visited, time spent, click patterns, and referring URLs.</li>
          <li><strong>Cookies:</strong> We use essential cookies for authentication and preferences, and analytics cookies to improve our service. You can manage cookie preferences in your browser settings.</li>
        </ul>

        <h2>How We Use Your Information</h2>
        <ul>
          <li>Process orders and manage your membership</li>
          <li>Personalize product recommendations using your fit profile</li>
          <li>Curate and fulfill member boxes</li>
          <li>Send transactional emails (order confirmations, shipping updates)</li>
          <li>Send marketing communications (if you opt in)</li>
          <li>Improve our website, products, and services</li>
          <li>Prevent fraud and maintain security</li>
          <li>Comply with legal obligations</li>
        </ul>

        <h2>How We Share Your Information</h2>
        <p>We do not sell your personal information. We share data only with:</p>
        <ul>
          <li><strong>Service providers:</strong> Payment processing (Stripe), shipping carriers, email delivery, analytics, and hosting services that help us operate.</li>
          <li><strong>Legal compliance:</strong> When required by law, subpoena, or to protect our rights and safety.</li>
          <li><strong>Business transfers:</strong> In connection with a merger, acquisition, or sale of assets.</li>
        </ul>

        <h2>Data Retention</h2>
        <p>
          We retain your account data for as long as your account is active. After account deletion, personal data is removed within 30 days, except where retention is required by law (e.g., financial records retained for 7 years).
        </p>

        <h2>Your Rights</h2>
        <p>Depending on your jurisdiction, you may have the right to:</p>
        <ul>
          <li>Access the personal data we hold about you</li>
          <li>Request correction of inaccurate data</li>
          <li>Request deletion of your data</li>
          <li>Opt out of marketing communications</li>
          <li>Data portability</li>
        </ul>
        <p>
          To exercise these rights, contact us at <a href="mailto:Info@MyMully.com">Info@MyMully.com</a>.
        </p>

        <h2>Security</h2>
        <p>
          We implement industry-standard security measures including 256-bit SSL encryption, PCI DSS Level 1 compliance for payments, and regular security audits. However, no method of transmission over the Internet is 100% secure.
        </p>

        <h2>Children&rsquo;s Privacy</h2>
        <p>
          Our services are not directed to individuals under 18. We do not knowingly collect personal information from children. If we become aware that we have collected data from a child, we will delete it promptly.
        </p>

        <h2>Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. We will notify you of material changes by posting the updated policy on this page and updating the &ldquo;Last updated&rdquo; date.
        </p>

        <h2>Contact</h2>
        <p>
          Mully Group, Inc.<br />
          555 Friendly St., Pontiac, MI 48341<br />
          <a href="mailto:Info@MyMully.com">Info@MyMully.com</a>
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
