/**
 * Browser-side Google Ads purchase conversion, same action and value logic
 * as /auth/callback: send_to NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_ID /
 * NEXT_PUBLIC_GOOGLE_ADS_LABEL_PURCHASE, value 1.0 USD, transaction_id =
 * the mully_txn_id the checkout stored (mully_pending_txn_id). orders-paid
 * sends the same id as transaction_id server-side, so Google Ads dedupes
 * the browser and server conversions per order.
 *
 * Local dedupe: never fires twice for the same transaction id in this
 * browser (localStorage), and shares /auth/callback's per-session flag.
 */

type Gtag = (command: "event", name: string, params?: Record<string, unknown>) => void;

export const GA_CONV_SESSION_KEY = "mully_ga_conv_fired";
export const GA_CONV_TXN_PREFIX = "mully_ga_conv_fired:";
export const PENDING_TXN_KEY = "mully_pending_txn_id";

function gtag(): Gtag | null {
  const g = (window as unknown as { gtag?: unknown }).gtag;
  return typeof g === "function" ? (g as Gtag) : null;
}

async function waitForGtag(maxAttempts = 30, intervalMs = 100): Promise<Gtag | null> {
  for (let i = 0; i < maxAttempts; i++) {
    const g = gtag();
    if (g) return g;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}

export type PurchaseConversionResult =
  | "fired"
  | "already_fired"
  | "no_transaction"
  | "not_configured"
  | "gtag_unavailable"
  | "error";

/**
 * Pure decision used by firePurchaseConversion (exported for tests).
 * fallbackTxnId is used only when no pending checkout id is stored.
 */
export function resolvePurchaseTxn(input: {
  pendingTxnId: string | null;
  fallbackTxnId: string | null;
  firedTxnIds: (id: string) => boolean;
  sessionFired: boolean;
}): { txnId: string | null; skip: PurchaseConversionResult | null } {
  const pending = input.pendingTxnId?.trim() || null;
  const fallback = input.fallbackTxnId?.trim() || null;
  const txnId = pending || fallback;
  if (!txnId) return { txnId: null, skip: "no_transaction" };
  // Either id already fired for this order: done.
  if (input.firedTxnIds(txnId) || (fallback && input.firedTxnIds(fallback))) return { txnId, skip: "already_fired" };
  // A session flag without a pending id means /auth/callback (or a reload)
  // already consumed this checkout.
  if (input.sessionFired && !input.pendingTxnId) return { txnId, skip: "already_fired" };
  return { txnId, skip: null };
}

export async function firePurchaseConversion(opts: { fallbackTxnId?: string | null } = {}): Promise<PurchaseConversionResult> {
  try {
    const conversionId = process.env.NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_ID || "";
    const purchaseLabel = process.env.NEXT_PUBLIC_GOOGLE_ADS_LABEL_PURCHASE || "";
    if (!conversionId || !purchaseLabel) return "not_configured";

    const { txnId, skip } = resolvePurchaseTxn({
      pendingTxnId: localStorage.getItem(PENDING_TXN_KEY),
      fallbackTxnId: opts.fallbackTxnId ?? null,
      firedTxnIds: (id) => !!localStorage.getItem(GA_CONV_TXN_PREFIX + id),
      sessionFired: !!sessionStorage.getItem(GA_CONV_SESSION_KEY),
    });
    if (skip || !txnId) return skip ?? "no_transaction";

    // Claim before the async wait so a double mount cannot fire twice. The
    // fallback id is claimed too, so a later visit without the pending id
    // never fires a second conversion for the same order.
    const claimed = [txnId, opts.fallbackTxnId?.trim()].filter((x): x is string => !!x);
    for (const id of claimed) localStorage.setItem(GA_CONV_TXN_PREFIX + id, String(Date.now()));

    const g = await waitForGtag();
    if (!g) {
      for (const id of claimed) localStorage.removeItem(GA_CONV_TXN_PREFIX + id);
      return "gtag_unavailable";
    }

    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      g("event", "conversion", {
        send_to: `${conversionId}/${purchaseLabel}`,
        value: 1.0,
        currency: "USD",
        transaction_id: txnId,
        event_callback: finish,
        event_timeout: 1500,
      });
      setTimeout(finish, 2000);
    });
    try {
      sessionStorage.setItem(GA_CONV_SESSION_KEY, "1");
      if (localStorage.getItem(PENDING_TXN_KEY) === txnId) localStorage.removeItem(PENDING_TXN_KEY);
    } catch {
      /* ignore */
    }
    return "fired";
  } catch (err) {
    console.warn("[gtag] gift conversion fire failed:", err);
    return "error";
  }
}
