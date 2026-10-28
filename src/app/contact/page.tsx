import type { Metadata } from "next";
import Link from "next/link";
import { ShopPageShell } from "../shop/components/ShopPageShell";
import { ContactForm } from "./ContactForm";

export const metadata: Metadata = {
  title: "Contact | Mully",
  description: "Questions about an order, sizing or Mully Reserve? Send us a note.",
};

export default function ContactPage() {
  return (
    <ShopPageShell>
      <main className="shop-page-main">
        <div className="shop-help">
          <header className="shop-page-heading">
            <div className="shop-page-kicker">Contact</div>
            <h1>Send us a note.</h1>
            <p>Orders, sizing, returns or Reserve. A real person reads every message.</p>
          </header>
          <ContactForm />
          <nav className="shop-support-links" aria-label="Help resources">
            <Link className="shop-text-link" href="/faq">FAQ</Link>
            <Link className="shop-text-link" href="/returns">Start a return →</Link>
            <Link className="shop-text-link" href="/policies/shipping">Shipping</Link>
          </nav>
        </div>
      </main>
    </ShopPageShell>
  );
}
