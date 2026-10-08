/**
 * Offline reconciliation of the supplied Shopify payment and payout CSV shapes.
 * This does not admit cash, create source authority, or send a report.
 */
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_ROWS = 10000;
const paymentHeaders = [
  "Transaction Date", "Type", "Order", "Card Brand", "Card Source",
  "Payout Status", "Payout Date", "Payout ID", "Available On", "Amount",
  "Fee", "Net", "Checkout", "Payment Method Name", "Presentment Amount",
  "Presentment Currency", "Currency", "Business Entity Name", "Business Entity ID",
];
const payoutHeaders = [
  "Payout Date", "Status", "Charges", "Refunds", "Adjustments",
  "Marketplace Sales Tax", "Advances", "Reserved Funds", "Fees",
  "Retried Amount", "Total", "Currency", "Bank Reference",
  "Business Entity Name", "Business Entity ID",
];
const paymentFields = [
  "Transaction Date", "Type", "Payout Status", "Payout Date", "Available On",
  "Amount", "Fee", "Net", "Currency",
];
const payoutAmounts = [
  "Charges", "Refunds", "Adjustments", "Marketplace Sales Tax", "Advances",
  "Reserved Funds", "Fees", "Retried Amount", "Total",
];
const payoutFields = ["Payout Date", "Status", "Currency", ...payoutAmounts];
const types = ["charge", "refund", "chargeback", "refund_failure", "reserved_funds", "adjustment"];
const fail = code => { throw new Error(code); };
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const money = value => {
  if (!/^-?(0|[1-9]\d{0,13})\.\d{2}$/.test(value)) fail("cash_export_decimal");
  return BigInt(value.replace(".", ""));
};
const decimal = value => {
  const magnitude = value < 0n ? -value : value;
  return `${value < 0n ? "-" : ""}${magnitude / 100n}.${String(magnitude % 100n).padStart(2, "0")}`;
};
function date(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ||
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) fail("cash_export_date");
  return value;
}
function transactionDate(value) {
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/.exec(value);
  if (!match || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59 ||
      Number(match[6]) > 14 || Number(match[7]) > 59 ||
      (Number(match[6]) === 14 && match[7] !== "00")) fail("cash_export_transaction_clock");
  date(match[1]);
  const instant = new Date(`${match[1]}T${match[2]}:${match[3]}:${match[4]}${match[5]}${match[6]}:${match[7]}`);
  if (!Number.isFinite(instant.getTime())) fail("cash_export_transaction_clock");
  return {
    utc: instant.toISOString(),
    day: new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(instant),
  };
}

/** Strict CSV framing. Unapproved columns are discarded before returning rows. */
function parse(bytes, headers, allowed) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES)
    fail("cash_export_size");
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, ""); }
  catch { fail("cash_export_utf8"); }
  const rows = [];
  let row = [], field = "", quoted = false, closed = false;
  const addField = () => { row.push(field); field = ""; closed = false; };
  const addRow = () => {
    addField();
    rows.push(row); row = [];
    if (rows.length > MAX_ROWS + 1) fail("cash_export_row_budget");
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else field += char;
    } else if (char === ",") addField();
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      addRow();
    } else if (char === '"' && !field && !closed) quoted = true;
    else {
      if (closed || char === '"' || char === "\0") fail("cash_export_csv");
      field += char;
    }
  }
  if (quoted) fail("cash_export_csv");
  if (field || row.length || closed) addRow();
  const found = rows.shift();
  if (!found || found.length !== headers.length || new Set(found).size !== headers.length ||
      found.some(h => !headers.includes(h))) fail("cash_export_schema");
  if (!rows.length) fail("cash_export_empty_not_verified_zero");
  return rows.map(values => {
    if (values.length !== found.length) fail("cash_export_csv");
    return Object.fromEntries(allowed.map(key => [key, values[found.indexOf(key)]]));
  });
}
function groupBy(rows, key) {
  const result = new Map();
  for (const row of rows) {
    const k = key(row);
    if (!result.has(k)) result.set(k, []);
    result.get(k).push(row);
  }
  return [...result.entries()].sort(([a], [b]) => a.localeCompare(b));
}
const sum = (rows, field) => rows.reduce((total, row) => total + money(row[field]), 0n);
const range = values => ({ first: [...values].sort()[0], last: [...values].sort().at(-1) });
const amounts = rows => ({
  rows: rows.length, amount: decimal(sum(rows, "Amount")),
  fee: decimal(sum(rows, "Fee")), net: decimal(sum(rows, "Net")),
});

export function reconcileCashExports(paymentBytes, payoutBytes) {
  const payments = parse(paymentBytes, paymentHeaders, paymentFields).map(row => {
    if (!types.includes(row.Type)) fail("cash_export_unknown_type");
    if (row["Payout Status"] !== "paid") fail("cash_export_nonpaid_payout_status");
    if (!/^[A-Z]{3}$/.test(row.Currency)) fail("cash_export_currency");
    date(row["Payout Date"]); date(row["Available On"]);
    const clock = transactionDate(row["Transaction Date"]);
    const amount = money(row.Amount), fee = money(row.Fee), net = money(row.Net);
    if (amount - fee !== net) fail("cash_export_row_arithmetic");
    if ((["charge", "refund_failure"].includes(row.Type) && amount < 0n) ||
        (["refund", "chargeback"].includes(row.Type) && amount > 0n)) fail("cash_export_sign");
    return { ...row, day: clock.day, utc: clock.utc };
  });
  const payouts = parse(payoutBytes, payoutHeaders, payoutFields).map(row => {
    date(row["Payout Date"]);
    if (row.Status !== "paid") fail("cash_export_nonpaid_payout_status");
    if (!/^[A-Z]{3}$/.test(row.Currency)) fail("cash_export_currency");
    for (const field of payoutAmounts) money(row[field]);
    return row;
  });
  const dayTypes = groupBy(payments, r => `${r.day}|${r.Currency}`).map(([key, rows]) => {
    const [day, currency] = key.split("|");
    return {
      day, currency, ...amounts(rows),
      types: Object.fromEntries(groupBy(rows, r => r.Type).map(([type, rows]) => [type, amounts(rows)])),
      collectedCash: null,
    };
  });
  const payoutGroups = new Map(groupBy(payouts, r => `${r["Payout Date"]}|${r.Currency}`));
  const paymentGroups = new Map(groupBy(payments, r => `${r["Payout Date"]}|${r.Currency}`));
  const payoutComparisons = [...new Set([...payoutGroups.keys(), ...paymentGroups.keys()])].sort().map(key => {
    const [day, currency] = key.split("|");
    const ledger = paymentGroups.get(key) ?? [], control = payoutGroups.get(key) ?? [];
    const ledgerNet = ledger.length ? sum(ledger, "Net") : null;
    const payoutTotal = control.length ? sum(control, "Total") : null;
    const delta = ledgerNet !== null && payoutTotal !== null ? payoutTotal - ledgerNet : null;
    // A supplied payout header is not assumed to enumerate every deduction.
    const headerArithmetic = control.length ? control.reduce((n, r) =>
      n + payoutAmounts.filter(k => !["Total", "Fees"].includes(k)).reduce((s, k) => s + money(r[k]), 0n)
      - money(r.Fees), 0n) : null;
    return {
      day, currency, transactionRows: ledger.length, payoutRows: control.length,
      ledgerNet: ledgerNet === null ? null : decimal(ledgerNet),
      payoutTotal: payoutTotal === null ? null : decimal(payoutTotal),
      difference: delta === null ? null : decimal(delta),
      state: delta === null ? "unpaired_export_window" : delta === 0n ? "date_aggregate_matches" : "date_aggregate_differs",
      headerComponentResidual: headerArithmetic === null ? null : decimal(payoutTotal - headerArithmetic),
    };
  });
  return {
    state: "offline_export_reconciled_cash_unavailable",
    inputs: {
      payments: { sha256: digest(paymentBytes), rows: payments.length },
      payouts: { sha256: digest(payoutBytes), rows: payouts.length },
    },
    coverage: {
      transactionInstantRange: range(payments.map(r => r.utc)),
      transactionNewYorkDayRange: range(payments.map(r => r.day)),
      transactionPayoutDayRange: range(payments.map(r => r["Payout Date"])),
      payoutExportDayRange: range(payouts.map(r => r["Payout Date"])),
      transactionClock: "export_Transaction_Date_explicit_offset",
      merchantAndGatewayVerifiedByFile: false,
      completeMerchantLifecycleVerified: false,
      paymentTransactionIdsPresent: false,
      paypalCoverageVerified: false,
    },
    byCurrency: Object.fromEntries(groupBy(payments, r => r.Currency).map(([currency, rows]) => [
      currency, { ...amounts(rows), types: Object.fromEntries(groupBy(rows, r => r.Type)
        .map(([type, rs]) => [type, amounts(rs)])) },
    ])),
    days: dayTypes,
    payoutComparisons,
    interpretation: {
      dateAggregateMatchIsBankSettlementProof: false,
      payoutHeaderResidualIsUnclassified: true,
      adjustmentsAndRefundFailureRequireClassification: true,
      reservesFeesAndPayoutsAreNotCustomerPrincipal: true,
      dateRangeDoesNotAssertCompleteExport: true,
    },
    cash: null, cashGate: false, lifecycleComplete: false, registered: false, published: false,
  };
}

function readInput(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) fail("cash_export_input_file");
  return readFileSync(path);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 5) fail("usage: node reconcile-cash-exports.mjs payments.csv payouts.csv NEW-report.json");
    const report = reconcileCashExports(readInput(process.argv[2]), readInput(process.argv[3]));
    writeFileSync(process.argv[4], `${JSON.stringify(report, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ state: report.state, paymentRows: report.inputs.payments.rows, cashGate: false }));
  } catch (error) {
    // Never echo source values, input paths or raw filesystem messages.
    const message = error instanceof Error && /^(cash_export_|usage:)/.test(error.message)
      ? error.message : "cash_export_io_or_execution_refused";
    console.error(message); process.exitCode = 1;
  }
}
