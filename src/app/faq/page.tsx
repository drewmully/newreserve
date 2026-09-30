import Link from "next/link";
import { ShopPageShell } from "../shop/components/ShopPageShell";

const sections = [
  { heading: "Shopping", items: [
    ["Do I need a membership to shop?", "No. Shop individual pieces or build an outfit without joining Mully Reserve."],
    ["How does Build an outfit work?", "Choose a top, bottom, and layer, then select your sizes. At the final step, buy available pieces once or choose Mully Reserve. Reserve purchases the subscription box and saves your selections as first-box instructions."],
    ["How does BOGO15 work?", "Buy two or more eligible pieces and get 15% off one lowest-priced eligible item. It is not 15% off the whole outfit. Shopify confirms the discount and final total at checkout."],
    ["Where can I find sizing information?", "Look for the size guide in the outfit builder or on the product page. Check the selected brand and item, since sizing can vary."],
  ]},
  { heading: "Mully Reserve", items: [
    ["What is Mully Reserve?", "Our quarterly styling service. Your outfit sets the direction, and our team curates new styles for future shipments. It is optional, not a requirement to shop."],
    ["What happens after my first shipment?", "Reserve renews at $250 every three months. Future shipments are curated by our team, rather than repeating your initial outfit. Review the subscription terms at checkout before enrolling."],
    ["How do I manage my subscription?", "Sign in to your account to view your subscription and manage upcoming shipments. Cancel before your next renewal to avoid the next charge."],
  ]},
  { heading: "Orders & account", items: [
    ["When will my order arrive?", "Delivery options and any shipping charges are shown at checkout. Check our shipping policy for current details, and use the tracking information sent after your order ships."],
    ["How do I start a return or exchange?", "Visit Returns with your order information. Eligibility and available options depend on the items in your order. Read the refund policy before submitting a request."],
    ["How do I sign in?", "Enter your email on the login page and we will send you a sign-in link, or continue with Google. There is no password to reset. If the link expires, request a new one."],
    ["How can I get help?", "Email info@mymully.com with your question and, if relevant, your order number. Our team will help you find the next step."],
  ]},
];
export default function FAQPage() {
  return <ShopPageShell>
    <main className="shop-page-main">
      <div className="shop-help">
        <header className="shop-page-heading"><div className="shop-page-kicker">A little help</div><h1>Good questions.</h1><p>Shopping, sizing, and everything after checkout.</p></header>
        {sections.map(section => <section className="shop-help-group" key={section.heading}>
          <h2>{section.heading}</h2><div>{section.items.map(([q,a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}</div>
        </section>)}
        <nav className="shop-support-links" aria-label="Help resources">
          <Link className="shop-text-link" href="/returns">Start a return →</Link>
          <Link className="shop-text-link" href="/policies/shipping">Shipping</Link>
          <Link className="shop-text-link" href="/policies/refund">Refund policy</Link>
          <a className="shop-text-link" href="mailto:info@mymully.com">Contact Mully →</a>
        </nav>
      </div>
    </main>
  </ShopPageShell>;
}
