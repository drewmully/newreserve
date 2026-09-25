/** Provisional calculation choices, not source permission or completeness.
 * Opt into these values when preparing a reviewed policy/evidence bundle.
 * No approval, identity, coverage or activation fields belong in this preset.
 */
export const PROVISIONAL_CALCULATION_DEFAULTS = Object.freeze({
  conversionWindowDays: 7,
  attributionLookbackDays: 30,
  allowObservedDirectFallback: false,
  conversionTimeBasis: "orders.paid_at",
  ingestionGraceSeconds: 48 * 3600,
  cohortHorizonDays: 30,
});

export function sessionConversionWindowDays(value?: number): number {
  const days = value === undefined ? PROVISIONAL_CALCULATION_DEFAULTS.conversionWindowDays : value;
  if (!Number.isSafeInteger(days) || days < 1 || days > 365)
    throw new Error("invalid_session_conversion_window");
  return days;
}
