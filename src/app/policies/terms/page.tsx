/* ═══════════════════════════════════════════
   TERMS OF SERVICE
   ═══════════════════════════════════════════ */

export default function TermsPage() {
  return (
    <article>
      <PolicyHeader title="Terms of Service" updated="February 1, 2026" />

      <div className="policy-prose">
        <p>
          These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use of the services provided by Mully Group, Inc. (&ldquo;Mully,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;), including our website at <a href="https://mymully.com">mymully.com</a>, mobile applications, and all related services (collectively, the &ldquo;Service&rdquo;). By using the Service, you agree to be bound by these Terms.
        </p>

        <h2>1. Eligibility</h2>
        <p>
          You must be at least 18 years old and capable of forming a binding contract to use the Service. By creating an account, you represent that you meet these requirements.
        </p>

        <h2>2. Accounts</h2>
        <p>
          You are responsible for maintaining the confidentiality of your account credentials and for all activity that occurs under your account. You agree to provide accurate, current, and complete information during registration and to update it as necessary. We reserve the right to suspend or terminate accounts that violate these Terms.
        </p>

        <h2>3. Membership Plans</h2>
        <p>
          Mully Reserve offers multiple membership tiers with varying benefits and pricing. By subscribing to a paid plan, you authorize us to charge the applicable fees to your payment method on a recurring basis (annually or quarterly, depending on your plan). You may upgrade, downgrade, or cancel at any time from your Account page.
        </p>
        <ul>
          <li>Cancellation takes effect at the end of the current billing period.</li>
          <li>No prorated refunds are issued for partial billing periods.</li>
          <li>We may modify pricing with 30 days&rsquo; advance notice.</li>
        </ul>

        <h2>4. Orders &amp; Payments</h2>
        <p>
          All prices are listed in US dollars. We reserve the right to refuse or cancel any order for any reason, including pricing errors, suspected fraud, or inventory limitations. Payment is processed at the time of order through Stripe. Sales tax is applied where required by law.
        </p>

        <h2>5. Intellectual Property</h2>
        <p>
          All content on the Service \u2014 including text, graphics, logos, images, and software \u2014 is the property of Mully Group, Inc. or its licensors and is protected by copyright, trademark, and other intellectual property laws. You may not reproduce, distribute, or create derivative works without our prior written consent.
        </p>

        <h2>6. User Content</h2>
        <p>
          By posting content to the Mully community (reviews, comments, photos), you grant us a non-exclusive, royalty-free, worldwide license to use, display, and distribute that content in connection with the Service. You retain ownership of your content and may delete it at any time.
        </p>
        <p>
          You agree not to post content that is unlawful, harmful, threatening, abusive, defamatory, or otherwise objectionable. We reserve the right to remove content that violates these Terms.
        </p>

        <h2>7. Prohibited Conduct</h2>
        <p>You agree not to:</p>
        <ul>
          <li>Use the Service for any unlawful purpose</li>
          <li>Interfere with or disrupt the Service or its servers</li>
          <li>Attempt to gain unauthorized access to any part of the Service</li>
          <li>Use automated tools to scrape, crawl, or extract data from the Service</li>
          <li>Impersonate another person or entity</li>
          <li>Resell or commercially exploit the Service without authorization</li>
        </ul>

        <h2>8. Disclaimer of Warranties</h2>
        <p>
          The Service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo; without warranties of any kind, whether express or implied. We do not warrant that the Service will be uninterrupted, error-free, or free of harmful components.
        </p>

        <h2>9. Limitation of Liability</h2>
        <p>
          To the fullest extent permitted by law, Mully Group, Inc. shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising out of or relating to your use of the Service. Our total liability shall not exceed the amount you paid to us in the 12 months preceding the claim.
        </p>

        <h2>10. Indemnification</h2>
        <p>
          You agree to indemnify, defend, and hold harmless Mully Group, Inc. and its officers, directors, employees, and agents from any claims, damages, losses, or expenses arising out of your use of the Service or violation of these Terms.
        </p>

        <h2>11. Governing Law</h2>
        <p>
          These Terms are governed by and construed in accordance with the laws of the State of Michigan, without regard to conflict of law principles. Any disputes shall be resolved in the state or federal courts located in Oakland County, Michigan.
        </p>

        <h2>12. Changes to These Terms</h2>
        <p>
          We may update these Terms from time to time. We will notify you of material changes by posting the updated Terms on this page and, where appropriate, by email. Continued use of the Service after changes constitutes acceptance of the revised Terms.
        </p>

        <h2>13. Contact</h2>
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
