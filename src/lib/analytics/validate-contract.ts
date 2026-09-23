import contracts from "./lean-contracts.json";

export type TableContract = (typeof contracts.tables)[number];
export type ShapeIssue = {
  row?: number;
  field: string;
  code:
    | "invalid_record"
    | "unknown_field"
    | "missing_field"
    | "null_not_allowed"
    | "invalid_type"
    | "publication_mismatch"
    | "duplicate_key";
};

/**
 * Pure, opt-in boundary validation. No imports of clients, credentials or routes.
 * Success certifies SHAPE ONLY, not identity, consent, coverage or financial truth.
 * Issues deliberately contain no input values or customer payloads.
 */
export function getTableContract(name: string): TableContract {
  const contract = contracts.tables.find((table) => table.name === name);
  if (!contract) throw new Error("Unknown analytics table contract");
  return contract;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) &&
    new Date(time).toISOString().slice(0, 10) === value;
}

function matchesType(type: string, value: unknown): boolean {
  switch (type) {
    case "STRING":
    case "ENUM":
      // ENUM vocabulary is not inferred from prose or examples.
      // Owning adapters must validate the approved versioned vocabulary.
      return typeof value === "string" && value.trim().length > 0;
    case "BOOLEAN":
      return typeof value === "boolean";
    case "INTEGER":
      return typeof value === "number" && Number.isSafeInteger(value);
    case "DATE":
      return typeof value === "string" && validDate(value);
    case "TIMESTAMP_UTC":
      return typeof value === "string" &&
        /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?Z$/.test(value) &&
        validDate(value.slice(0, 10));
    case "ISO_4217_CODE":
      // Syntax only. This is NOT currency approval or an FX conversion.
      return typeof value === "string" && /^[A-Z]{3}$/.test(value);
    case "IANA_TIMEZONE":
      if (typeof value !== "string" || value.trim() !== value || !value) return false;
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    case "MAP<STRING,BOOLEAN?>":
      return isRecord(value) &&
        Object.values(value).every((entry) => entry === null || typeof entry === "boolean");
    default: {
      const decimal = /^DECIMAL\((\d+),(\d+)\)$/.exec(type);
      if (!decimal || typeof value !== "string") return false;
      // Decimal strings preserve exact source precision; JS floats are rejected.
      const parts = /^-?(0|[1-9]\d*)(?:\.(\d+))?$/.exec(value);
      if (!parts) return false;
      return parts[1].length <= Number(decimal[1]) - Number(decimal[2]) &&
        (parts[2]?.length ?? 0) <= Number(decimal[2]);
    }
  }
}

export function validateRowShape(table: string, value: unknown): ShapeIssue[] {
  const contract = getTableContract(table);
  if (!isRecord(value)) return [{ field: "", code: "invalid_record" }];
  const issues: ShapeIssue[] = [];
  const knownFields = new Set(contract.fields.map((field) => field.name));
  // Do not echo unknown property names: they can themselves contain PII.
  for (const key of Object.keys(value)) {
    if (!knownFields.has(key)) issues.push({ field: "", code: "unknown_field" });
  }
  for (const field of contract.fields) {
    if (!Object.hasOwn(value, field.name) || value[field.name] === undefined) {
      issues.push({ field: field.name, code: "missing_field" });
    } else if (value[field.name] === null) {
      if (!field.nullable) issues.push({ field: field.name, code: "null_not_allowed" });
    } else if (!matchesType(field.logicalType, value[field.name])) {
      issues.push({ field: field.name, code: "invalid_type" });
    }
  }
  return issues;
}

function keyPart(field: TableContract["fields"][number], value: unknown): unknown {
  if (field.logicalType !== "TIMESTAMP_UTC" || typeof value !== "string") return value;
  // UTC timestamp PKs with .000 and without fractions are the same instant.
  // Retain microseconds; Date.parse would collapse distinct valid_from values.
  return value.replace(/\.(\d+)Z$/, (_, fraction: string) => {
    const trimmed = fraction.replace(/0+$/, "");
    return trimmed ? `.${trimmed}Z` : "Z";
  });
}

/** Validate a single-table, single-publication candidate batch. Never mutates it. */
export function validateBatchShape(
  table: string,
  rows: readonly unknown[],
  expectedPublicationId: string,
): ShapeIssue[] {
  if (typeof expectedPublicationId !== "string" || !expectedPublicationId.trim()) {
    throw new Error("A non-empty expected publication ID is required");
  }
  const contract = getTableContract(table);
  const seen = new Set<string>();
  return rows.flatMap((row, index) => {
    const issues = validateRowShape(table, row);
    if (isRecord(row) && row.publication_id !== expectedPublicationId) {
      issues.push({ field: "publication_id", code: "publication_mismatch" });
    }
    if (issues.length === 0 && isRecord(row)) {
      // Tuple encoding avoids collisions when source identifiers contain "|".
      const key = JSON.stringify(contract.primaryKey.map((name) =>
        keyPart(contract.fields.find((field) => field.name === name)!, row[name]),
      ));
      if (seen.has(key)) issues.push({ field: "", code: "duplicate_key" });
      seen.add(key);
    }
    return issues.map((issue) => ({ ...issue, row: index }));
  });
}
