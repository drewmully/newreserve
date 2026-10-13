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

interface Variant {
  id: string;
  title: string;
  sku: string | null;
  price: string;
  inventoryQuantity: number | null;
  availableForSale: boolean;
  productTitle: string;
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
  return new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
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

// ─── Exchange picker ──────────────────────────────────────────────────────────

interface PickLine {
  key: string;
  fulfillmentLineItemId: string;
  productId: string | null;
  title: string;
  variantTitle: string | null;
  quantity: number;
  reason: string;
  customerNote: string | null;
}

function ReplacementPicker({
  line,
  adminFetch,
  value,
  onChange,
}: {
  line: PickLine;
  adminFetch: AdminFetch;
  value: Variant | null;
  onChange: (v: Variant | null) => void;
}) {
  const [sameProduct, setSameProduct] = useState<Variant[]>([]);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Variant[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!line.productId) return;
    let cancelled = false;
    adminFetch(`/api/admin/returns/variants?productId=${encodeURIComponent(line.productId)}`)
      .then((r) => readJson<{ variants: Variant[] }>(r))
      .then((d) => !cancelled && setSameProduct(d.variants))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [adminFetch, line.productId]);

  async function runSearch() {
    if (search.trim().length < 2) return;
    setSearching(true);
    try {
      const d = await readJson<{ variants: Variant[] }>(
        await adminFetch(`/api/admin/returns/variants?q=${encodeURIComponent(search.trim())}`),
      );
      setResults(d.variants);
    } finally {
      setSearching(false);
    }
  }

  const options = [...sameProduct, ...results.filter((r) => !sameProduct.some((s) => s.id === r.id))];

  return (
    <div className="space-y-2">
      <select
        className="w-full border border-taupe/40 rounded px-2 py-1.5 text-sm bg-white"
        value={value?.id ?? ""}
        onChange={(e) => onChange(options.find((o) => o.id === e.target.value) ?? null)}
      >
        <option value="">Choose replacement…</option>
        {sameProduct.length > 0 && (
          <optgroup label={`Same product — ${sameProduct[0].productTitle}`}>
            {sameProduct.map((v) => (
              <option key={v.id} value={v.id} disabled={!v.availableForSale && (v.inventoryQuantity ?? 0) <= 0}>
                {v.title} · {v.inventoryQuantity ?? "?"} in stock
              </option>
            ))}
          </optgroup>
        )}
        {results.length > 0 && (
          <optgroup label="Search results">
            {results
              .filter((r) => !sameProduct.some((s) => s.id === r.id))
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {v.productTitle} — {v.title} · {v.inventoryQuantity ?? "?"} in stock
                </option>
              ))}
          </optgroup>
        )}
      </select>
      <div className="flex gap-2">
        <input
          className="flex-1 border border-taupe/40 rounded px-2 py-1 text-sm"
          placeholder="Search a different product or SKU"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void runSearch()}
        />
        <button
          type="button"
          onClick={() => void runSearch()}
          className="text-sm px-3 border border-taupe/40 rounded hover:bg-cream"
        >
          {searching ? "…" : "Search"}
        </button>
      </div>
    </div>
  );
}

function ExchangePanel({
  lines,
  adminFetch,
  busy,
  onSubmit,
  onCancel,
}: {
  lines: PickLine[];
  adminFetch: AdminFetch;
  busy: boolean;
  onSubmit: (picks: { line: PickLine; variant: Variant; qty: number }[], notify: boolean) => void;
  onCancel: () => void;
}) {
  const [picks, setPicks] = useState<Record<string, { on: boolean; variant: Variant | null; qty: number }>>(() =>
    Object.fromEntries(lines.map((l) => [l.key, { on: lines.length === 1, variant: null, qty: l.quantity }])),
  );
  const [notify, setNotify] = useState(true);

  const chosen = lines
    .filter((l) => picks[l.key]?.on)
    .map((l) => ({ line: l, variant: picks[l.key].variant, qty: picks[l.key].qty }));
  const ready = chosen.length > 0 && chosen.every((c) => c.variant);

  return (
    <div className="mt-4 border-t border-taupe/20 pt-4 space-y-4">
      <p className="text-xs text-charcoal/60">
        Pick what the customer sends back and what ships to them. This opens an exchange return in Shopify.
      </p>
      {lines.map((l) => {
        const p = picks[l.key];
        return (
          <div key={l.key} className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-3 items-start">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={p.on}
                onChange={(e) => setPicks((s) => ({ ...s, [l.key]: { ...p, on: e.target.checked } }))}
              />
              <span>
                <span className="text-obsidian">{l.title}</span>
                {l.variantTitle && <span className="text-charcoal/60"> — {l.variantTitle}</span>}
                <span className="block text-xs text-charcoal/50">Returning {l.quantity}</span>
              </span>
            </label>
            {p.on && (
              <ReplacementPicker
                line={l}
                adminFetch={adminFetch}
                value={p.variant}
                onChange={(v) => setPicks((s) => ({ ...s, [l.key]: { ...p, variant: v } }))}
              />
            )}
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-charcoal/70">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          Email the customer that the exchange is approved
        </label>
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={onCancel} className="text-sm px-3 py-1.5 text-charcoal/60 hover:text-charcoal">
            Cancel
          </button>
          <button
            type="button"
            disabled={!ready || busy}
            onClick={() => onSubmit(chosen as { line: PickLine; variant: Variant; qty: number }[], notify)}
            className="text-sm px-4 py-1.5 rounded bg-forest text-white disabled:opacity-40"
          >
            {busy ? "Creating…" : "Create exchange"}
          </button>
        </div>
      </div>
    </div>
  );
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
          adminFetch={adminFetch}
          busy={busy}
          onCancel={() => setPanel("none")}
          onSubmit={(picks, n) =>
            void post(
              {
                action: "exchange",
                notifyCustomer: n,
                exchangeSummary: picks
                  .map((p) => `${p.line.title}${p.line.variantTitle ? ` (${p.line.variantTitle})` : ""} → ${p.variant.productTitle} (${p.variant.title})`)
                  .join("\n"),
                selections: picks.map((p) => ({
                  fulfillmentLineItemId: p.line.fulfillmentLineItemId,
                  quantity: p.line.quantity,
                  returnReason: p.line.reason === "UNKNOWN" ? "OTHER" : p.line.reason,
                  customerNote: p.line.customerNote,
                  replacementVariantId: p.variant.id,
                  replacementQuantity: p.qty,
                })),
              },
              `Exchange created for ${item.orderName}`,
            )
          }
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
    lines: { fulfillmentLineItemId: string; quantity: number; title: string; variantTitle: string | null; productId: string | null }[];
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

  async function submit(picks: { line: PickLine; variant: Variant; qty: number }[], notify: boolean) {
    if (!order) return;
    setBusy(true);
    setError(null);
    try {
      await readJson(
        await adminFetch("/api/admin/returns/decide", {
          method: "POST",
          body: JSON.stringify({
            action: "exchange",
            orderId: order.id,
            orderName: order.name,
            requestId: req.id,
            customerEmail: req.customerEmail ?? order.customerEmail,
            notifyCustomer: notify,
            exchangeSummary: picks
              .map((p) => `${p.line.title}${p.line.variantTitle ? ` (${p.line.variantTitle})` : ""} → ${p.variant.productTitle} (${p.variant.title})`)
              .join("\n"),
            selections: picks.map((p) => ({
              fulfillmentLineItemId: p.line.fulfillmentLineItemId,
              quantity: p.line.quantity,
              returnReason: "OTHER",
              customerNote: req.message.slice(0, 250),
              replacementVariantId: p.variant.id,
              replacementQuantity: p.qty,
            })),
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
            reason: "OTHER",
            customerNote: null,
          }))}
          adminFetch={adminFetch}
          busy={busy}
          onCancel={() => setPanel(false)}
          onSubmit={(picks, n) => void submit(picks, n)}
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
