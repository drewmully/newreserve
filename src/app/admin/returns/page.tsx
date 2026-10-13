"use client";

/**
 * /admin/returns
 *
 * Daily returns & customer-request queue. One place to approve, decline,
 * or convert a request into an exchange without opening Shopify Admin.
 * Sorted by chargeback risk, then age.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdminFetch } from "@/app/components/useAdminFetch";

// ─── Types (mirror /api/admin/returns) ────────────────────────────────────────

interface Line {
  returnLineItemId: string;
  fulfillmentLineItemId: string | null;
  productId: string | null;
  title: string;
  variantTitle: string | null;
  sku: string | null;
  quantity: number;
  unitPrice: number;
  reason: string;
  customerNote: string | null;
}

interface QueueItem {
  returnId: string;
  returnName: string;
  status: string;
  orderId: string;
  orderName: string;
  orderUrl: string;
  requestedAt: string;
  approvedAt: string | null;
  ageDays: number;
  customerName: string;
  customerEmail: string | null;
  orderTotal: number;
  isSubscription: boolean;
  lines: Line[];
  exchangeItems: string[];
  risk: { level: "high" | "medium" | "low"; flags: string[] };
}

interface CustomerRequest {
  id: string;
  type: string;
  orderName: string | null;
  customerEmail: string | null;
  message: string;
  createdAt: number | null;
}

interface Dispute {
  id: string;
  status: string;
  initiatedAt: string;
  evidenceDueBy: string | null;
  amount: number;
  reason: string | null;
  orderName: string | null;
  orderUrl: string | null;
  customerName: string | null;
}

interface Decision {
  id: string;
  action: string;
  orderName: string | null;
  returnName: string | null;
  by: string;
  createdAt: number | null;
  exchangeReturnName: string | null;
}

interface QueueResponse {
  generatedAt: string;
  needsDecision: QueueItem[];
  openReturns: QueueItem[];
  customerRequests: CustomerRequest[];
  disputes: { available: boolean; items: Dispute[] };
  today: Decision[];
  truncated: boolean;
}

type Tab = "decide" | "requests" | "open" | "disputes";
type AdminFetch = (path: string, init?: RequestInit) => Promise<Response>;

const STALE_DAYS = 90;

const REASON_LABELS: Record<string, string> = {
  SIZE_TOO_SMALL: "Size too small",
  SIZE_TOO_LARGE: "Size too large",
  UNWANTED: "Unwanted",
  WRONG_ITEM: "Not as described",
  DEFECTIVE: "Damaged / defective",
  STYLE: "Style",
  COLOR: "Color",
  NOT_AS_DESCRIBED: "Not as described",
  OTHER: "Other",
  UNKNOWN: "No reason given",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

function shortDate(v: string | number | null): string {
  if (!v) return "—";
  const d = new Date(v);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-US", sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}

function ageLabel(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

const RISK_STYLES = {
  high: "bg-red-50 text-red-700 border-red-200",
  medium: "bg-amber-50 text-amber-800 border-amber-200",
  low: "bg-white text-charcoal/60 border-taupe/30",
} as const;

const RISK_LABEL = { high: "Chargeback risk", medium: "Needs attention", low: "Routine" } as const;

async function readJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

// ─── Exchange builder ─────────────────────────────────────────────────────────
//
// Two independent lists, matching how Shopify models an exchange:
//   Coming back        — which of the customer's items are returned
//   Sending to customer — the exact products/sizes slotted in to ship out
// Anything in the catalog can be slotted in (same item in a new size, a
// different product, or several items for one returned box).

interface PickLine {
  key: string;
  fulfillmentLineItemId: string;
  productId: string | null;
  title: string;
  variantTitle: string | null;
  quantity: number;
  unitPrice: number;
  reason: string;
  customerNote: string | null;
}

interface CatalogVariant {
  id: string;
  title: string;
  sku: string | null;
  price: number;
  inventoryQuantity: number | null;
  availableForSale: boolean;
  /** CONTINUE = Shopify keeps selling at 0 on hand (most of the catalog). */
  inventoryPolicy?: "DENY" | "CONTINUE";
}

interface CatalogProduct {
  id: string;
  title: string;
  vendor: string | null;
  imageUrl: string | null;
  variants: CatalogVariant[];
}

interface SlotItem {
  variantId: string;
  productTitle: string;
  variantTitle: string;
  imageUrl: string | null;
  price: number;
  stock: number | null;
  oversell: boolean;
  qty: number;
}

interface ExchangeSubmit {
  returning: { line: PickLine; qty: number }[];
  sending: SlotItem[];
  notify: boolean;
  summary: string;
}

function exchangeSummary(returning: ExchangeSubmit["returning"], sending: SlotItem[]): string {
  const back = returning
    .map((r) => `${r.qty}× ${r.line.title}${r.line.variantTitle ? ` (${r.line.variantTitle})` : ""}`)
    .join(", ");
  const out = sending.map((s) => `${s.qty}× ${s.productTitle} (${s.variantTitle})`).join(", ");
  return `Sending back: ${back}\nWe're sending you: ${out}`;
}

const SIZE_RE = /^(XXS|XS|S|M|L|XL|XXL|2XL|XXXL|3XL|4XL|OS|One Size|\d{1,2}(\.\d)?|\d{2}x\d{2})$/i;

/** Split "Pure Black / L" or "S / Charcoal Gray" into { group: "Pure Black", size: "L" }. */
function splitVariantTitle(title: string): { group: string; size: string } {
  if (title === "Default Title") return { group: "", size: "Add" };
  const parts = title.split(" / ").map((p) => p.trim());
  const i = parts.findIndex((p) => SIZE_RE.test(p));
  if (i === -1) return { group: parts.length > 1 ? parts.slice(0, -1).join(" / ") : "", size: parts[parts.length - 1] };
  return { group: parts.filter((_, j) => j !== i).join(" / "), size: parts[i] };
}

function SizeChips({
  product,
  onPick,
  slottedIds,
}: {
  product: CatalogProduct;
  onPick: (p: CatalogProduct, v: CatalogVariant) => void;
  slottedIds: Set<string>;
}) {
  const groups = new Map<string, { v: CatalogVariant; size: string }[]>();
  for (const v of product.variants) {
    const { group, size } = splitVariantTitle(v.title);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push({ v, size });
  }
  return (
    <div className="space-y-1.5">
      {[...groups].map(([group, items]) => (
        <div key={group || "_"} className="flex flex-wrap items-center gap-1.5">
          {group && <span className="text-xs text-charcoal/60 w-full sm:w-auto sm:min-w-[96px]">{group}</span>}
          {items.map(({ v, size }) => {
            const stock = v.inventoryQuantity ?? 0;
            const on = slottedIds.has(v.id);
            const sellable = v.availableForSale;
            return (
              <button
                key={v.id}
                type="button"
                disabled={!sellable}
                onClick={() => onPick(product, v)}
                title={`${v.title} · ${money(v.price)} · ${stock > 0 ? `${stock} on hand` : v.inventoryPolicy === "CONTINUE" ? "0 on hand, still selling" : "sold out"}`}
                className={`text-xs min-w-[36px] px-2.5 py-1 rounded border transition-colors ${
                  on
                    ? "bg-forest text-white border-forest"
                    : !sellable
                      ? "border-taupe/20 text-charcoal/30 line-through cursor-not-allowed"
                      : "border-taupe/40 text-obsidian hover:border-forest hover:text-forest"
                }`}
              >
                {size}
                {stock > 0 && !on && <span className="ml-1 text-charcoal/40">{stock}</span>}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function ProductRow({
  product,
  onPick,
  slottedIds,
  label,
}: {
  product: CatalogProduct;
  onPick: (p: CatalogProduct, v: CatalogVariant) => void;
  slottedIds: Set<string>;
  label?: string;
}) {
  const prices = product.variants.map((v) => v.price);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  return (
    <div className="flex gap-3 py-3 border-t border-taupe/15 first:border-t-0">
      <div className="w-14 h-14 rounded bg-cream overflow-hidden shrink-0">
        {product.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.imageUrl} alt="" className="w-full h-full object-cover" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        {label && <p className="text-[11px] uppercase tracking-wide text-forest mb-0.5">{label}</p>}
        <p className="text-sm text-obsidian truncate">{product.title}</p>
        <p className="text-xs text-charcoal/50 mb-1.5">
          {product.vendor ? `${product.vendor} · ` : ""}
          {prices.length ? (lo === hi ? money(lo) : `${money(lo)}–${money(hi)}`) : ""}
        </p>
        <SizeChips product={product} onPick={onPick} slottedIds={slottedIds} />
      </div>
    </div>
  );
}

function ExchangePanel({
  lines,
  customerAsk,
  adminFetch,
  busy,
  onSubmit,
  onCancel,
}: {
  lines: PickLine[];
  customerAsk?: string | null;
  adminFetch: AdminFetch;
  busy: boolean;
  onSubmit: (x: ExchangeSubmit) => void;
  onCancel: () => void;
}) {
  const [back, setBack] = useState<Record<string, number>>(() =>
    Object.fromEntries(lines.map((l) => [l.key, lines.length === 1 ? l.quantity : 0])),
  );
  const [slot, setSlot] = useState<SlotItem[]>([]);
  const [sameItems, setSameItems] = useState<CatalogProduct[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogProduct[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [notify, setNotify] = useState(true);

  // Pre-load the returned items' own products so a size swap is one click.
  const productKey = [...new Set(lines.map((l) => l.productId).filter((x): x is string => !!x))].join(",");
  useEffect(() => {
    const ids = productKey ? productKey.split(",") : [];
    if (!ids.length) return;
    let cancelled = false;
    Promise.all(
      ids.map((id) =>
        adminFetch(`/api/admin/returns/variants?productId=${encodeURIComponent(id)}`)
          .then((r) => readJson<{ products: CatalogProduct[] }>(r))
          .then((d) => d.products)
          .catch(() => [] as CatalogProduct[]),
      ),
    ).then((all) => {
      // Single-variant products (e.g. a quarterly box) aren't a useful "swap size" option.
      if (!cancelled) setSameItems(all.flat().filter((p) => p.variants.length > 1));
    });
    return () => {
      cancelled = true;
    };
  }, [adminFetch, productKey]);

  async function search() {
    if (query.trim().length < 2) return;
    setSearching(true);
    setSearchError(null);
    try {
      const d = await readJson<{ products: CatalogProduct[] }>(
        await adminFetch(`/api/admin/returns/variants?q=${encodeURIComponent(query.trim())}`),
      );
      setResults(d.products);
    } catch (e) {
      setSearchError((e as Error).message);
    } finally {
      setSearching(false);
    }
  }

  function addToSlot(p: CatalogProduct, v: CatalogVariant) {
    setSlot((s) => {
      const hit = s.find((x) => x.variantId === v.id);
      if (hit) return s.map((x) => (x.variantId === v.id ? { ...x, qty: x.qty + 1 } : x));
      return [
        ...s,
        {
          variantId: v.id,
          productTitle: p.title,
          variantTitle: v.title === "Default Title" ? "One size" : v.title,
          imageUrl: p.imageUrl,
          price: v.price,
          stock: v.inventoryQuantity,
          oversell: v.inventoryPolicy === "CONTINUE",
          qty: 1,
        },
      ];
    });
  }

  const slottedIds = new Set(slot.map((s) => s.variantId));
  const returning = lines.filter((l) => (back[l.key] ?? 0) > 0).map((l) => ({ line: l, qty: back[l.key] }));
  const backValue = returning.reduce((s, r) => s + r.line.unitPrice * r.qty, 0);
  const outValue = slot.reduce((s, x) => s + x.price * x.qty, 0);
  const diff = outValue - backValue;
  const ready = returning.length > 0 && slot.length > 0;
  const lowStock = slot.filter((x) => (x.stock ?? 0) < x.qty);

  return (
    <div className="mt-4 border-t border-taupe/20 pt-4 space-y-5">
      {customerAsk && (
        <div className="text-sm bg-cream rounded px-3 py-2">
          <span className="text-xs uppercase tracking-wide text-charcoal/50">Customer asked for</span>
          <p className="text-obsidian whitespace-pre-wrap">{customerAsk}</p>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-5">
        {/* Coming back */}
        <div>
          <h3 className="text-xs uppercase tracking-wide text-charcoal/60 mb-2">Coming back</h3>
          <div className="space-y-2">
            {lines.map((l) => (
              <label key={l.key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={(back[l.key] ?? 0) > 0}
                  onChange={(e) => setBack((b) => ({ ...b, [l.key]: e.target.checked ? l.quantity : 0 }))}
                />
                <span className="flex-1 min-w-0">
                  <span className="text-obsidian">{l.title}</span>
                  {l.variantTitle && <span className="text-charcoal/60"> — {l.variantTitle}</span>}
                </span>
                {l.quantity > 1 && (back[l.key] ?? 0) > 0 && (
                  <select
                    value={back[l.key]}
                    onChange={(e) => setBack((b) => ({ ...b, [l.key]: Number(e.target.value) }))}
                    className="border border-taupe/40 rounded px-1 py-0.5 text-xs bg-white"
                  >
                    {Array.from({ length: l.quantity }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                )}
                <span className="text-xs text-charcoal/50 w-16 text-right">{money(l.unitPrice * (back[l.key] || l.quantity))}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Sending out — the slot */}
        <div>
          <h3 className="text-xs uppercase tracking-wide text-charcoal/60 mb-2">Sending to customer</h3>
          {slot.length === 0 ? (
            <div className="border border-dashed border-taupe/50 rounded px-3 py-4 text-sm text-charcoal/50 text-center">
              No product slotted in yet. Pick a size or search below.
            </div>
          ) : (
            <ul className="space-y-2">
              {slot.map((x) => (
                <li key={x.variantId} className="flex flex-wrap items-center gap-2 text-sm border border-forest/30 bg-forest/5 rounded px-2 py-1.5">
                  <div className="w-9 h-9 rounded bg-white overflow-hidden shrink-0">
                    {x.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={x.imageUrl} alt="" className="w-full h-full object-cover" />
                    )}
                  </div>
                  <div className="flex-1 min-w-[140px]">
                    <p className="text-obsidian truncate">{x.productTitle}</p>
                    <p className="text-xs text-charcoal/60">
                      {x.variantTitle} · {money(x.price)}
                      {(x.stock ?? 0) < x.qty && (
                        <span className="text-amber-800"> · {Math.max(0, x.stock ?? 0)} on hand</span>
                      )}
                    </p>
                  </div>
                  <div className="ml-auto flex items-center border border-taupe/40 rounded bg-white">
                    <button
                      type="button"
                      aria-label="Decrease quantity"
                      className="px-2 text-charcoal/60"
                      onClick={() =>
                        setSlot((s) => s.flatMap((y) => (y.variantId !== x.variantId ? [y] : y.qty > 1 ? [{ ...y, qty: y.qty - 1 }] : [])))
                      }
                    >
                      −
                    </button>
                    <span className="px-1 text-xs w-5 text-center">{x.qty}</span>
                    <button
                      type="button"
                      aria-label="Increase quantity"
                      className="px-2 text-charcoal/60"
                      onClick={() => setSlot((s) => s.map((y) => (y.variantId === x.variantId ? { ...y, qty: y.qty + 1 } : y)))}
                    >
                      +
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSlot((s) => s.filter((y) => y.variantId !== x.variantId))}
                    className="text-xs text-charcoal/50 hover:text-red-700 px-1"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Catalog */}
      <div className="rounded border border-taupe/25 px-3 py-2">
        {sameItems.map((p) => (
          <ProductRow key={p.id} product={p} onPick={addToSlot} slottedIds={slottedIds} label="Same item, different size" />
        ))}
        <div className={`flex gap-2 ${sameItems.length ? "pt-3 border-t border-taupe/15" : "py-1"}`}>
          <input
            className="flex-1 border border-taupe/40 rounded px-2 py-1.5 text-sm"
            placeholder="Search products to slot in (name, brand, or SKU)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void search();
              }
            }}
          />
          <button type="button" onClick={() => void search()} className="text-sm px-3 border border-taupe/40 rounded hover:bg-cream">
            {searching ? "Searching…" : "Search"}
          </button>
        </div>
        {searchError && <p className="text-xs text-red-700 mt-2">{searchError}</p>}
        {results && results.length === 0 && <p className="text-xs text-charcoal/50 mt-2">No active products match.</p>}
        {results && results.length > 0 && (
          <div className="max-h-80 overflow-y-auto mt-1">
            {results.map((p) => (
              <ProductRow key={p.id} product={p} onPick={addToSlot} slottedIds={slottedIds} />
            ))}
          </div>
        )}
      </div>

      {/* Value + submit */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <span className="text-charcoal/60">
          Coming back <span className="text-obsidian">{money(backValue)}</span>
        </span>
        <span className="text-charcoal/60">
          Sending <span className="text-obsidian">{money(outValue)}</span>
        </span>
        {ready && (
          <span className={Math.abs(diff) < 0.01 ? "text-forest" : diff > 0 ? "text-amber-800" : "text-charcoal/70"}>
            {Math.abs(diff) < 0.01
              ? "Even exchange"
              : diff > 0
                ? `Customer owes ${money(diff)}`
                : `${money(-diff)} left to refund`}
          </span>
        )}
      </div>
      {ready && Math.abs(diff) >= 0.01 && (
        <p className="text-xs text-charcoal/50 -mt-3">
          Shopify settles the difference when the return is processed. You can refund or waive it from the order.
        </p>
      )}
      {lowStock.length > 0 && (
        <p className="text-xs text-amber-800 -mt-3">
          Not enough on hand for {lowStock.map((x) => `${x.productTitle} (${x.variantTitle})`).join(", ")}.
          {lowStock.every((x) => x.oversell)
            ? " Shopify will still allow it (overselling is on), so confirm it can ship."
            : " Confirm with the warehouse before shipping."}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-charcoal/70">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          Email the customer what&rsquo;s coming
        </label>
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={onCancel} className="text-sm px-3 py-1.5 text-charcoal/60 hover:text-charcoal">
            Cancel
          </button>
          <button
            type="button"
            disabled={!ready || busy}
            onClick={() => onSubmit({ returning, sending: slot, notify, summary: exchangeSummary(returning, slot) })}
            className="text-sm px-4 py-1.5 rounded bg-forest text-white disabled:opacity-40"
          >
            {busy ? "Creating…" : "Create exchange"}
          </button>
        </div>
      </div>
    </div>
  );
}

function exchangeBody(x: ExchangeSubmit, fallbackNote?: string | null) {
  return {
    action: "exchange",
    notifyCustomer: x.notify,
    exchangeSummary: x.summary,
    returning: x.returning.map((r) => ({
      fulfillmentLineItemId: r.line.fulfillmentLineItemId,
      quantity: r.qty,
      returnReason: r.line.reason,
      customerNote: r.line.customerNote ?? fallbackNote ?? null,
    })),
    sending: x.sending.map((s) => ({ variantId: s.variantId, quantity: s.qty })),
  };
}

// ─── Return request card ──────────────────────────────────────────────────────

function RequestCard({
  item,
  adminFetch,
  onDone,
  mode,
}: {
  item: QueueItem;
  adminFetch: AdminFetch;
  onDone: (id: string, msg: string) => void;
  mode: "decide" | "open";
}) {
  const [panel, setPanel] = useState<"none" | "decline" | "exchange">("none");
  const [notify, setNotify] = useState(true);
  const [declineReason, setDeclineReason] = useState("OTHER");
  const [declineNote, setDeclineNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = item.lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);

  async function post(body: Record<string, unknown>, msg: string) {
    setBusy(true);
    setError(null);
    try {
      await readJson(
        await adminFetch("/api/admin/returns/decide", {
          method: "POST",
          body: JSON.stringify({
            returnId: item.returnId,
            returnName: item.returnName,
            orderId: item.orderId,
            orderName: item.orderName,
            customerEmail: item.customerEmail,
            ...body,
          }),
        }),
      );
      onDone(item.returnId, msg);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const pickLines: PickLine[] = item.lines
    .filter((l) => l.fulfillmentLineItemId)
    .map((l) => ({
      key: l.returnLineItemId,
      fulfillmentLineItemId: l.fulfillmentLineItemId!,
      productId: l.productId,
      title: l.title,
      variantTitle: l.variantTitle,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      reason: l.reason,
      customerNote: l.customerNote,
    }));

  return (
    <div className={`rounded-lg border p-5 bg-white ${item.risk.level === "high" ? "border-red-200" : "border-taupe/25"}`}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <a href={item.orderUrl} target="_blank" rel="noreferrer" className="font-medium text-obsidian hover:underline">
              {item.orderName}
            </a>
            <span className="text-charcoal/40 text-sm">{item.returnName}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full border ${RISK_STYLES[item.risk.level]}`}>
              {RISK_LABEL[item.risk.level]}
            </span>
            {item.isSubscription && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-cream text-charcoal/70 border border-taupe/30">
                Subscription
              </span>
            )}
          </div>
          <p className="text-sm text-charcoal/70 mt-1">
            {item.customerName}
            {item.customerEmail && (
              <>
                {" · "}
                <a className="hover:underline" href={`mailto:${item.customerEmail}`}>
                  {item.customerEmail}
                </a>
              </>
            )}
          </p>
        </div>
        <div className="text-right text-sm">
          <p className="text-obsidian font-medium">{money(total)}</p>
          <p className="text-charcoal/50 text-xs">
            {mode === "decide" ? "Requested" : "Approved"} {shortDate(mode === "decide" ? item.requestedAt : item.approvedAt)} ·{" "}
            {ageLabel(item.ageDays)}
          </p>
        </div>
      </div>

      <ul className="mt-3 space-y-1.5">
        {item.lines.map((l) => (
          <li key={l.returnLineItemId} className="text-sm">
            <span className="text-obsidian">
              {l.quantity}× {l.title}
            </span>
            {l.variantTitle && <span className="text-charcoal/60"> — {l.variantTitle}</span>}
            <span className="text-charcoal/50"> · {REASON_LABELS[l.reason] ?? l.reason}</span>
            {l.customerNote && !Object.values(REASON_LABELS).includes(l.customerNote) && (
              <p className="text-charcoal/80 mt-0.5 pl-3 border-l-2 border-taupe/40">“{l.customerNote}”</p>
            )}
          </li>
        ))}
      </ul>

      {item.exchangeItems.length > 0 && (
        <p className="mt-2 text-sm text-forest">Exchange for: {item.exchangeItems.join(", ")}</p>
      )}

      {item.risk.flags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {item.risk.flags.map((f) => (
            <span key={f} className="text-xs px-2 py-0.5 rounded bg-cream text-charcoal/70">
              {f}
            </span>
          ))}
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}

      {mode === "decide" && panel === "none" && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void post({ action: "approve", notifyCustomer: notify }, `Approved ${item.orderName}`)}
            className="text-sm px-4 py-1.5 rounded bg-forest text-white disabled:opacity-40"
          >
            {busy ? "Saving…" : "Approve"}
          </button>
          <button
            type="button"
            onClick={() => setPanel("exchange")}
            className="text-sm px-4 py-1.5 rounded border border-forest text-forest hover:bg-forest/5"
          >
            Approve as exchange
          </button>
          <button
            type="button"
            onClick={() => setPanel("decline")}
            className="text-sm px-4 py-1.5 rounded border border-taupe/40 text-charcoal/70 hover:bg-cream"
          >
            Decline
          </button>
          <label className="ml-auto flex items-center gap-2 text-xs text-charcoal/60">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            Notify customer
          </label>
        </div>
      )}

      {mode === "decide" && panel === "decline" && (
        <div className="mt-4 border-t border-taupe/20 pt-4 space-y-3">
          <div className="flex flex-wrap gap-3">
            <select
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              className="border border-taupe/40 rounded px-2 py-1.5 text-sm bg-white"
            >
              <option value="OTHER">Other</option>
              <option value="RETURN_PERIOD_ENDED">Return window ended</option>
              <option value="FINAL_SALE">Final sale</option>
            </select>
            <input
              value={declineNote}
              onChange={(e) => setDeclineNote(e.target.value)}
              placeholder="Note to customer (shown in Shopify's decline email)"
              className="flex-1 min-w-[220px] border border-taupe/40 rounded px-2 py-1.5 text-sm"
            />
          </div>
          {item.risk.level === "high" && (
            <p className="text-xs text-red-700">
              This customer may dispute the charge. Consider replying personally before declining.
            </p>
          )}
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-charcoal/60">
              <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
              Notify customer
            </label>
            <div className="ml-auto flex gap-2">
              <button type="button" onClick={() => setPanel("none")} className="text-sm px-3 py-1.5 text-charcoal/60">
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void post(
                    { action: "decline", declineReason, declineNote, notifyCustomer: notify },
                    `Declined ${item.orderName}`,
                  )
                }
                className="text-sm px-4 py-1.5 rounded bg-obsidian text-white disabled:opacity-40"
              >
                {busy ? "Saving…" : "Confirm decline"}
              </button>
            </div>
          </div>
        </div>
      )}

      {mode === "decide" && panel === "exchange" && (
        <ExchangePanel
          lines={pickLines}
          customerAsk={item.lines.map((l) => l.customerNote).filter((n): n is string => !!n && !Object.values(REASON_LABELS).includes(n)).join("\n") || null}
          adminFetch={adminFetch}
          busy={busy}
          onCancel={() => setPanel("none")}
          onSubmit={(x) => void post(exchangeBody(x), `Exchange created for ${item.orderName}`)}
        />
      )}

      {mode === "open" && (
        <div className="mt-4">
          <a href={item.orderUrl} target="_blank" rel="noreferrer" className="text-sm text-forest hover:underline">
            Refund or close in Shopify →
          </a>
        </div>
      )}
    </div>
  );
}

// ─── Customer request card (exchange form submissions) ───────────────────────

function CustomerRequestCard({
  req,
  adminFetch,
  onDone,
}: {
  req: CustomerRequest;
  adminFetch: AdminFetch;
  onDone: (id: string, msg: string) => void;
}) {
  const [order, setOrder] = useState<{
    id: string;
    name: string;
    customerEmail: string | null;
    lines: { fulfillmentLineItemId: string; quantity: number; title: string; variantTitle: string | null; productId: string | null; unitPrice: number }[];
  } | null>(null);
  const [panel, setPanel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ageDays = req.createdAt ? Math.floor((Date.now() - req.createdAt) / 86_400_000) : 0;

  async function openExchange() {
    setError(null);
    if (!req.orderName) return setError("No order number on this request.");
    try {
      const d = await readJson<{ order: NonNullable<typeof order> }>(
        await adminFetch(`/api/admin/returns/order?name=${encodeURIComponent(req.orderName)}`),
      );
      setOrder(d.order);
      setPanel(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function close(status: "resolved" | "dismissed") {
    setBusy(true);
    try {
      await readJson(
        await adminFetch("/api/admin/returns/requests", { method: "POST", body: JSON.stringify({ id: req.id, status }) }),
      );
      onDone(req.id, status === "resolved" ? "Marked handled" : "Dismissed");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submit(x: ExchangeSubmit) {
    if (!order) return;
    setBusy(true);
    setError(null);
    try {
      await readJson(
        await adminFetch("/api/admin/returns/decide", {
          method: "POST",
          body: JSON.stringify({
            ...exchangeBody(x, req.message),
            orderId: order.id,
            orderName: order.name,
            requestId: req.id,
            customerEmail: req.customerEmail ?? order.customerEmail,
          }),
        }),
      );
      onDone(req.id, `Exchange created for ${order.name}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`rounded-lg border p-5 bg-white ${ageDays > 2 ? "border-amber-200" : "border-taupe/25"}`}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-medium text-obsidian">
            {req.orderName ?? "No order"} <span className="text-charcoal/40 text-sm font-normal">· exchange request</span>
          </p>
          {req.customerEmail && (
            <a className="text-sm text-charcoal/70 hover:underline" href={`mailto:${req.customerEmail}`}>
              {req.customerEmail}
            </a>
          )}
        </div>
        <p className="text-xs text-charcoal/50">
          {shortDate(req.createdAt)} · {ageLabel(ageDays)}
        </p>
      </div>
      <p className="mt-3 text-sm text-charcoal/80 whitespace-pre-wrap pl-3 border-l-2 border-taupe/40">{req.message}</p>
      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      {!panel && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => void openExchange()} className="text-sm px-4 py-1.5 rounded bg-forest text-white">
            Set up exchange
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void close("resolved")}
            className="text-sm px-4 py-1.5 rounded border border-taupe/40 text-charcoal/70 hover:bg-cream"
          >
            Mark handled
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void close("dismissed")}
            className="text-sm px-3 py-1.5 text-charcoal/50 hover:text-charcoal"
          >
            Dismiss
          </button>
        </div>
      )}
      {panel && order && (
        <ExchangePanel
          lines={order.lines.map((l) => ({
            key: l.fulfillmentLineItemId,
            fulfillmentLineItemId: l.fulfillmentLineItemId,
            productId: l.productId,
            title: l.title,
            variantTitle: l.variantTitle,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            reason: "OTHER",
            customerNote: null,
          }))}
          adminFetch={adminFetch}
          busy={busy}
          onCancel={() => setPanel(false)}
          onSubmit={(x) => void submit(x)}
        />
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ReturnsQueuePage() {
  const { adminFetch, tokenReady } = useAdminFetch();
  const [data, setData] = useState<QueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("decide");
  const [showStale, setShowStale] = useState(false);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tokenReady) return;
    setLoading(true);
    setError(null);
    try {
      setData(await readJson<QueueResponse>(await adminFetch("/api/admin/returns")));
      setDone(new Set());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [adminFetch, tokenReady]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDone = useCallback((id: string, msg: string) => {
    setDone((s) => new Set(s).add(id));
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }, []);

  const decide = useMemo(() => (data?.needsDecision ?? []).filter((i) => !done.has(i.returnId)), [data, done]);
  const recent = decide.filter((i) => i.ageDays <= STALE_DAYS);
  const stale = decide.filter((i) => i.ageDays > STALE_DAYS);
  const requests = (data?.customerRequests ?? []).filter((r) => !done.has(r.id));
  const open = data?.openReturns ?? [];
  const openStale = open.filter((i) => i.ageDays > 14);
  const disputes = data?.disputes.items ?? [];
  const highRisk = recent.filter((i) => i.risk.level === "high").length;

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "decide", label: "Needs decision", count: recent.length },
    { id: "requests", label: "Exchange requests", count: requests.length },
    { id: "open", label: "Approved, not closed", count: open.length },
    { id: "disputes", label: "Chargebacks", count: disputes.length },
  ];

  return (
    <div className="min-h-screen bg-cream">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="flex items-end justify-between gap-4 mb-6">
          <div>
            <h1 className="font-serif text-3xl text-obsidian">Returns &amp; requests</h1>
            <p className="text-charcoal/60 mt-1 text-sm">
              Approve, decline, or exchange without opening Shopify. Riskiest and oldest first.
            </p>
          </div>
          <div className="text-right">
            <button onClick={() => void load()} className="text-sm text-forest hover:underline">
              Refresh
            </button>
            {data && (
              <p className="text-xs text-charcoal/40 mt-1">
                Updated {new Date(data.generatedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
              </p>
            )}
          </div>
        </div>

        {/* Summary */}
        {data && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
            {[
              { label: "Awaiting decision", value: recent.length, tone: recent.length ? "text-obsidian" : "text-charcoal/40" },
              { label: "Chargeback risk", value: highRisk, tone: highRisk ? "text-red-700" : "text-charcoal/40" },
              { label: "Exchange requests", value: requests.length, tone: requests.length ? "text-obsidian" : "text-charcoal/40" },
              { label: "Open > 14 days", value: openStale.length, tone: openStale.length ? "text-amber-800" : "text-charcoal/40" },
              { label: "Handled (24h)", value: data.today.length + done.size, tone: "text-forest" },
            ].map((c) => (
              <div key={c.label} className="bg-white rounded-lg border border-taupe/25 px-4 py-3">
                <p className={`text-2xl font-serif ${c.tone}`}>{c.value}</p>
                <p className="text-xs text-charcoal/60 mt-0.5">{c.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 border-b border-taupe/25 mb-6 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm whitespace-nowrap border-b-2 -mb-px ${
                tab === t.id ? "border-forest text-forest font-medium" : "border-transparent text-charcoal/60 hover:text-charcoal"
              }`}
            >
              {t.label} <span className="text-charcoal/40">({t.count})</span>
            </button>
          ))}
        </div>

        {loading && <p className="text-sm text-charcoal/50">Loading the queue from Shopify…</p>}
        {error && <p className="text-sm text-red-700">{error}</p>}
        {data?.truncated && (
          <p className="text-xs text-amber-800 mb-4">Showing the most recent 300 orders per list; older items are not loaded.</p>
        )}

        {!loading && data && tab === "decide" && (
          <div className="space-y-4">
            {recent.length === 0 && <p className="text-sm text-charcoal/50">Nothing waiting on a decision.</p>}
            {recent.map((i) => (
              <RequestCard key={i.returnId} item={i} adminFetch={adminFetch} onDone={handleDone} mode="decide" />
            ))}
            {stale.length > 0 && (
              <div className="pt-4">
                <button onClick={() => setShowStale((v) => !v)} className="text-sm text-charcoal/60 hover:text-charcoal">
                  {showStale ? "Hide" : "Show"} {stale.length} requests older than {STALE_DAYS} days
                </button>
                {showStale && (
                  <div className="space-y-4 mt-4">
                    {stale.map((i) => (
                      <RequestCard key={i.returnId} item={i} adminFetch={adminFetch} onDone={handleDone} mode="decide" />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {!loading && data && tab === "requests" && (
          <div className="space-y-4">
            {requests.length === 0 && (
              <p className="text-sm text-charcoal/50">
                No open exchange requests. New ones from the returns page land here automatically.
              </p>
            )}
            {requests.map((r) => (
              <CustomerRequestCard key={r.id} req={r} adminFetch={adminFetch} onDone={handleDone} />
            ))}
          </div>
        )}

        {!loading && data && tab === "open" && (
          <div className="space-y-4">
            <p className="text-xs text-charcoal/60">
              Approved returns that haven&rsquo;t been refunded or closed. Old ones are where &ldquo;where&rsquo;s my
              refund&rdquo; chargebacks come from.
            </p>
            {open.map((i) => (
              <RequestCard key={i.returnId} item={i} adminFetch={adminFetch} onDone={handleDone} mode="open" />
            ))}
          </div>
        )}

        {!loading && data && tab === "disputes" && (
          <div className="space-y-3">
            {!data.disputes.available && (
              <p className="text-sm text-charcoal/60">
                Chargebacks can&rsquo;t be read yet: the Shopify admin token needs the{" "}
                <code className="text-xs">read_shopify_payments_disputes</code> scope.
              </p>
            )}
            {data.disputes.available && disputes.length === 0 && (
              <p className="text-sm text-charcoal/50">No open chargebacks.</p>
            )}
            {disputes.map((d) => (
              <div key={d.id} className="bg-white rounded-lg border border-red-200 p-4 flex flex-wrap gap-3 items-center">
                <div className="flex-1">
                  <p className="font-medium text-obsidian">
                    {d.orderUrl ? (
                      <a href={d.orderUrl} target="_blank" rel="noreferrer" className="hover:underline">
                        {d.orderName}
                      </a>
                    ) : (
                      d.orderName ?? "Unknown order"
                    )}{" "}
                    <span className="text-sm text-charcoal/50 font-normal">· {d.reason ?? "dispute"}</span>
                  </p>
                  <p className="text-sm text-charcoal/60">{d.customerName}</p>
                </div>
                <div className="text-right text-sm">
                  <p className="font-medium">{money(d.amount)}</p>
                  <p className="text-xs text-red-700">Evidence due {shortDate(d.evidenceDueBy)}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {data && data.today.length > 0 && (
          <div className="mt-10">
            <h2 className="text-sm font-medium text-obsidian mb-2">Handled in the last 24 hours</h2>
            <ul className="text-sm text-charcoal/70 space-y-1">
              {data.today.map((d) => (
                <li key={d.id}>
                  {new Date(d.createdAt ?? 0).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} ·{" "}
                  {d.action.replace(/_/g, " ")} {d.orderName ?? ""} {d.exchangeReturnName ? `→ ${d.exchangeReturnName}` : ""} ·{" "}
                  <span className="text-charcoal/50">{d.by}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-obsidian text-white text-sm px-4 py-2 rounded shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
