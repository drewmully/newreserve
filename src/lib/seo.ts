/**
 * SEO helpers (SEO recovery s08). One canonical host, no query strings.
 */
export const SITE_URL = "https://www.mymully.com";

/** Absolute self-referencing canonical for a path like "/shop". */
export function canonical(path: string): { canonical: string } {
  const clean = (path.split("?")[0] || "/").replace(/\/+$/, "") || "/";
  return { canonical: clean === "/" ? `${SITE_URL}/` : `${SITE_URL}${clean}` };
}
