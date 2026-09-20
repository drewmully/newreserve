export type RunOutcome = "complete" | "verified_empty" | "missing_auth" |
  "partial" | "schema_drift" | "failed" | "unverified";
export type CompletionEvidence = {
  paginationComplete: boolean;
  writesComplete: boolean;
  schemaValid: boolean;
  sourceRows: number;
  writtenRows: number;
  evidenceRef: string;
};
export function assessCompletion(e: CompletionEvidence): RunOutcome {
  if (![e.sourceRows, e.writtenRows].every(n => Number.isSafeInteger(n) && n >= 0) ||
      !e.evidenceRef.trim()) throw new Error("Invalid completion evidence");
  if (!e.schemaValid) return "schema_drift";
  if (!e.paginationComplete || !e.writesComplete) return "partial";
  return e.sourceRows === 0 ? (e.writtenRows === 0 ? "verified_empty" : "partial") : "complete";
}
export function canCheckpoint(outcome: RunOutcome): boolean {
  return outcome === "complete" || outcome === "verified_empty";
}
/** Compatibility fallback is never completeness evidence. */
export function legacyOutcome(result: unknown, meta: Record<string, unknown>): RunOutcome {
  const r = result && typeof result === "object" ? result as Record<string, unknown> : {};
  if (meta.skipped || r.skipped) return Array.isArray(meta.missing ?? r.missing) ? "missing_auth" : "unverified";
  if (meta.partial || r.partial || meta.error || r.ok === false) return "partial";
  return "unverified";
}
