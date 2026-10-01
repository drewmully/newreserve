import Link from "next/link";
import { ShopPageShell } from "../shop/components/ShopPageShell";

export default function PoliciesLayout({ children }: { children: React.ReactNode }) {
  return <ShopPageShell>
    <main className="shop-policy-main">
      <div className="max-w-2xl mx-auto">
        {children}
        <nav className="shop-support-links" aria-label="Policies">
          {[["Refund","refund"],["Privacy","privacy"],["Shipping","shipping"],["Terms","terms"]].map(([label,path]) =>
            <Link key={path} className="shop-text-link" href={`/policies/${path}`}>{label}</Link>)}
          <Link className="shop-text-link" href="/analytics-preferences">Analytics preferences</Link>
        </nav>
      </div>
    </main>
  </ShopPageShell>;
}
