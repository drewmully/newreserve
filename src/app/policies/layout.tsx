import Link from "next/link";

/* ═══════════════════════════════════════════
   POLICY PAGES — Shared layout
   ═══════════════════════════════════════════ */

export default function PoliciesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bone flex flex-col">
      {/* ─── HEADER ─── */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-bone/90 backdrop-blur-md border-b border-taupe/15">
        <div className="max-w-7xl mx-auto px-5 md:px-12 flex items-center justify-between h-14">
          <Link href="/" className="flex items-center gap-2 text-forest">
            <svg viewBox="0 0 1002 540" fill="currentColor" className="h-4 w-auto" aria-hidden="true"><path d="M0,0 H1002 V540 H0 Z M50,1 L998,269 L50,538 Z" fillRule="evenodd" /></svg>
            <span className="font-serif text-xl font-bold tracking-wide">mully.</span>
          </Link>
          <Link href="/login" className="text-sm tracking-wider uppercase text-forest font-medium hover:text-forest-dark transition-colors duration-300">
            Sign In
          </Link>
        </div>
      </header>

      {/* ─── CONTENT ─── */}
      <main className="flex-1 pt-24 pb-20 px-5 md:px-12">
        <div className="max-w-2xl mx-auto">
          {children}

          {/* Policy nav */}
          <div className="mt-14 pt-8 border-t border-taupe/12">
            <h3 className="text-[11px] tracking-[0.25em] uppercase text-sage font-medium mb-4">Other Policies</h3>
            <div className="flex flex-wrap gap-3">
              <PolicyNavLink href="/policies/refund">Refund</PolicyNavLink>
              <PolicyNavLink href="/policies/privacy">Privacy</PolicyNavLink>
              <PolicyNavLink href="/policies/shipping">Shipping</PolicyNavLink>
              <PolicyNavLink href="/policies/terms">Terms</PolicyNavLink>
            </div>
          </div>
        </div>
      </main>

      {/* ─── FOOTER ─── */}
      <footer className="py-8 px-6 bg-forest">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <span className="flex items-center gap-2 text-bone">
            <svg viewBox="0 0 1002 540" fill="currentColor" className="h-3.5 w-auto" aria-hidden="true"><path d="M0,0 H1002 V540 H0 Z M50,1 L998,269 L50,538 Z" fillRule="evenodd" /></svg>
            <span className="font-serif text-lg font-bold tracking-wide">mully.</span>
          </span>
          <div className="flex items-center gap-6">
            <Link href="/returns" className="text-xs text-bone/40 hover:text-bone transition-colors duration-300">Returns</Link>
            <Link href="/faq" className="text-xs text-bone/40 hover:text-bone transition-colors duration-300">FAQ</Link>
            <Link href="/shop" className="text-xs text-bone/40 hover:text-bone transition-colors duration-300">Shop</Link>
          </div>
          <p className="text-xs text-bone/35">&copy; {new Date().getFullYear()} Mully Group, Inc. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}

function PolicyNavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="text-xs text-charcoal/40 hover:text-forest px-3 py-1.5 rounded-lg border border-taupe/15 hover:border-forest/20 transition-all duration-300"
    >
      {children}
    </Link>
  );
}
