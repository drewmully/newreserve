import { describe, expect, it } from "vitest";
import contracts from "@/lib/analytics/lean-contracts.json";
import reporting from "@/lib/analytics/reporting-contracts.json";
import {
  getTableContract,
  validateBatchShape,
  validateRowShape,
} from "@/lib/analytics/validate-contract";

const publication = "fixture-publication-1";

// Synthetic shape fixtures, not claims of business-valid/customer-approved data.
function fixture(table: string): Record<string, unknown> {
  return Object.fromEntries(getTableContract(table).fields.map((field) => {
    let value: unknown = null;
    if (!field.nullable) {
      switch (field.logicalType) {
        case "BOOLEAN": value = false; break;
        case "INTEGER": value = 1; break;
        case "TIMESTAMP_UTC": value = "2026-09-01T12:00:00Z"; break;
        case "DATE": value = "2026-09-01"; break;
        case "ISO_4217_CODE": value = "USD"; break;
        case "IANA_TIMEZONE": value = "America/New_York"; break;
        default: value = field.logicalType.startsWith("DECIMAL") ? "1.000000" : "fixture";
      }
    }
    if (field.name === "publication_id") value = publication;
    return [field.name, value];
  }));
}

describe("pinned workbook contracts", () => {
  const counts = {
    customers: 8, identity_map: 12, orders: 25, order_items: 17,
    sales_ledger: 16, payments: 14, sessions: 24,
    marketing_spend_daily: 17, order_attribution: 13, order_item_offers: 6,
  };
  it("contains exactly the ten business tables, not native events/views/optional modules", () => {
    expect(contracts.tables.map((table) => table.name).sort()).toEqual(Object.keys(counts).sort());
    expect(contracts.contractVersion).toBe("lean-v1-draft.1");
  });
  it.each(Object.entries(counts))("%s retains its field count and publication-aware key", (name, count) => {
    const table = getTableContract(name);
    expect(table.fields).toHaveLength(count);
    expect(new Set(table.fields.map((field) => field.name)).size).toBe(count);
    expect(table.primaryKey).toContain("publication_id");
    for (const name of table.primaryKey) {
      expect(table.fields.find((field) => field.name === name)?.nullable).toBe(false);
    }
    expect(table.semanticRules.length).toBeGreaterThan(0);
    expect(table.publicationGates.length).toBeGreaterThan(0);
  });
  it("retains the full namespace/version keys rather than just source IDs", () => {
    expect(getTableContract("identity_map").primaryKey).toEqual([
      "source_namespace", "source_identifier", "valid_from", "mapping_version", "publication_id",
    ]);
    expect(getTableContract("marketing_spend_daily").primaryKey).toEqual([
      "provider", "account_id", "campaign_key", "report_date", "base_report_id", "publication_id",
    ]);
    expect(getTableContract("order_attribution").primaryKey).toEqual([
      "order_id", "model_version", "publication_id",
    ]);
  });
});

describe("finite workbook reporting scope", () => {
  it("pins the five reporting views and separates 18 required metrics from three optional primitives", () => {
    expect(reporting.views.map((view) => view.name)).toEqual([
      "store_daily", "acquisition_daily", "product_daily", "customer_cohorts", "funnel_daily",
    ]);
    const optional = reporting.metrics.filter((metric) =>
      metric.contract["Contract state"].startsWith("Optional metric proposal"));
    expect(optional.map((metric) => metric.id)).toEqual(["ctr", "cpc", "cpm"]);
    expect(reporting.metrics.filter((metric) => !optional.includes(metric)).map((metric) => metric.id)).toEqual([
      "gross_merchandise_sales", "discounts", "refunds", "net_merchandise_sales", "total_sales",
      "spend", "collected_cash", "eligible_orders", "new_customers", "ncac", "mer",
      "first_party_roas", "aov", "units", "measured_sessions", "session_conversion",
      "repeat_purchase", "revenue_ltv",
    ]);
  });
});

describe.each(contracts.tables.map((table) => table.name))("%s shape boundary", (table) => {
  it("accepts a complete synthetic record, including explicit nullable fields", () => {
    expect(validateRowShape(table, fixture(table))).toEqual([]);
  });
  it("rejects a missing or null publication", () => {
    const row = fixture(table);
    delete row.publication_id;
    expect(validateRowShape(table, row)).toContainEqual({ field: "publication_id", code: "missing_field" });
    row.publication_id = null;
    expect(validateRowShape(table, row)).toContainEqual({ field: "publication_id", code: "null_not_allowed" });
  });
  it("rejects duplicate composite keys and mixed publications", () => {
    const row = fixture(table);
    expect(validateBatchShape(table, [row, { ...row }], publication)).toContainEqual({
      row: 1, field: "", code: "duplicate_key",
    });
    expect(validateBatchShape(table, [{ ...row, publication_id: "another" }], publication)).toContainEqual({
      row: 0, field: "publication_id", code: "publication_mismatch",
    });
  });
});

describe("edge cases and conservative wire types", () => {
  it("retains unresolved commerce; missing identity is not fabricated", () => {
    const order = fixture("orders");
    expect(order.customer_id).toBeNull();
    expect(order.checkout_session_key).toBeNull();
    expect(order.purchase_merchandise_net_usd).toBeNull();
    expect(validateRowShape("orders", order)).toEqual([]);
    delete order.customer_id;
    expect(validateRowShape("orders", order)).toContainEqual({ field: "customer_id", code: "missing_field" });
  });
  it.each([12.5, NaN, Infinity, "1e2", "01.2", "100000000000000", "0.0000001"])(
    "rejects unsafe DECIMAL(20,6) input %s",
    (value) => {
      expect(validateRowShape("sales_ledger", { ...fixture("sales_ledger"), source_amount: value }))
        .toContainEqual({ field: "source_amount", code: "invalid_type" });
    },
  );
  it.each(["-12.345678", "0", "99999999999999.999999"])("preserves exact signed decimal %s", (value) => {
    expect(validateRowShape("sales_ledger", { ...fixture("sales_ledger"), source_amount: value })).toEqual([]);
  });
  it("uses each decimal field's own scale and precision", () => {
    const row = fixture("order_attribution");
    expect(validateRowShape("order_attribution", { ...row, credit_weight: "1.000000000" })).toEqual([]);
    expect(validateRowShape("order_attribution", { ...row, credit_weight: "1000" }))
      .toContainEqual({ field: "credit_weight", code: "invalid_type" });
    expect(validateRowShape("order_attribution", { ...row, credit_weight: "1.0000000001" }))
      .toContainEqual({ field: "credit_weight", code: "invalid_type" });
  });
  it.each(["2026-02-30", "2026-2-01", "not-a-date"])("rejects invalid calendar date %s", (value) => {
    expect(validateRowShape("sales_ledger", { ...fixture("sales_ledger"), report_date: value }))
      .toContainEqual({ field: "report_date", code: "invalid_type" });
  });
  it.each(["2026-02-30T00:00:00Z", "2026-01-01", "2026-01-01T24:00:00Z", "2026-01-01T00:00:00-05:00"])(
    "rejects noncanonical or invalid UTC timestamp %s",
    (value) => {
      expect(validateRowShape("orders", { ...fixture("orders"), created_at: value }))
        .toContainEqual({ field: "created_at", code: "invalid_type" });
    },
  );
  it("accepts leap days and UTC microseconds without altering input", () => {
    const row = Object.freeze({ ...fixture("orders"), created_at: "2024-02-29T00:00:00.123456Z" });
    expect(validateBatchShape("orders", [row], publication)).toEqual([]);
    expect(row.created_at).toBe("2024-02-29T00:00:00.123456Z");
  });
  it("does not treat alternate timestamp formatting as a distinct identity key", () => {
    const row = fixture("identity_map");
    expect(validateBatchShape("identity_map", [row, { ...row, valid_from: "2026-09-01T12:00:00.000000Z" }], publication))
      .toContainEqual({ row: 1, field: "", code: "duplicate_key" });
    expect(validateBatchShape("identity_map", [row, { ...row, valid_from: "2026-09-01T12:00:00.000001Z" }], publication))
      .toEqual([]);
  });
  it("does not coerce false, null or an unknown funnel flag", () => {
    const row = { ...fixture("sessions"), funnel_flags: { view: true, checkout: false, purchase: null } };
    expect(validateRowShape("sessions", row)).toEqual([]);
    expect(validateRowShape("sessions", { ...row, funnel_flags: { purchase: "false" } }))
      .toContainEqual({ field: "funnel_flags", code: "invalid_type" });
    expect(validateRowShape("sessions", { ...row, behavior_complete: "false" }))
      .toContainEqual({ field: "behavior_complete", code: "invalid_type" });
  });
  it("checks integer safety, currency syntax and timezone recognition", () => {
    const row = fixture("marketing_spend_daily");
    for (const clicks of [1.2, Number.MAX_SAFE_INTEGER + 1, "12"]) {
      expect(validateRowShape("marketing_spend_daily", { ...row, clicks }))
        .toContainEqual({ field: "clicks", code: "invalid_type" });
    }
    expect(validateRowShape("marketing_spend_daily", { ...row, source_currency: "usd" }))
      .toContainEqual({ field: "source_currency", code: "invalid_type" });
    expect(validateRowShape("marketing_spend_daily", { ...row, source_timezone: "Not/A_Zone" }))
      .toContainEqual({ field: "source_timezone", code: "invalid_type" });
  });
  it("rejects absent records, unknown fields, wrong string/enum types and undefined", () => {
    for (const row of [null, [], new Date(), "record"]) {
      expect(validateRowShape("orders", row)).toEqual([{ field: "", code: "invalid_record" }]);
    }
    const issues = validateRowShape("orders", {
      ...fixture("orders"), "private@example.test": "secret", source_order_id: 123,
      commerce_source: true, shop_id: undefined,
    });
    expect(issues).toEqual(expect.arrayContaining([
      { field: "", code: "unknown_field" },
      { field: "source_order_id", code: "invalid_type" },
      { field: "commerce_source", code: "invalid_type" },
      { field: "shop_id", code: "missing_field" },
    ]));
    expect(JSON.stringify(issues)).not.toMatch(/private@example|secret/);
  });
  it("uses collision-safe composite keys", () => {
    const row = fixture("order_item_offers");
    expect(validateBatchShape("order_item_offers", [
      { ...row, order_item_id: "a|b", offer_id: "c" },
      { ...row, order_item_id: "a", offer_id: "b|c" },
    ], publication)).toEqual([]);
  });
  it("fails closed for unknown tables and requires a publication", () => {
    expect(() => validateRowShape("events", {})).toThrow("Unknown analytics table contract");
    expect(() => validateBatchShape("orders", [], "")).toThrow("expected publication");
  });
  it("an empty batch passes shape only, never proves source coverage", () => {
    expect(validateBatchShape("orders", [], publication)).toEqual([]);
  });
});
