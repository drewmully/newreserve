const DEFAULT_DROP_DATE_ISO = "2026-05-15T21:00:00-04:00";

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export function getExclusiveDropDate(): Date {
  const configured =
    parseDate(process.env.NEXT_PUBLIC_EXCLUSIVE_DROP_DATE) ??
    parseDate(process.env.NEXT_PUBLIC_HOME_DROP_DATE) ??
    parseDate(DEFAULT_DROP_DATE_ISO);

  if (configured) return configured;
  return new Date(DEFAULT_DROP_DATE_ISO);
}

export function formatExclusiveDropLabel(date: Date): string {
  const formatted = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/New_York",
  }).format(date);

  return `${formatted} ET`;
}
