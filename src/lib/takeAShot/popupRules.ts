/**
 * Take a Shot popup rules: when it may auto-open, who never sees it, and
 * when the launcher pill shows. Pure functions plus small storage helpers,
 * so the rules are unit tested apart from the React component.
 *
 * Numbers from the CRO review (Nov 11, 2026). Change them here only.
 */

export const TRIGGER = {
  /** Auto-open after this long on the page AND this much scroll. */
  dwellMs: 8_000,
  scrollFraction: 0.3,
  /** Product pages wait longer so the visitor has seen the item. */
  productDwellMs: 20_000,
  /** Second storefront page view in a session opens after this long on it. */
  secondPageDwellMs: 2_000,
  /** Desktop exit intent (pointer:fine only) needs at least this long on the page. */
  exitDwellMs: 5_000,
  /** Paid-social landing: nothing auto-opens on the first page before this. */
  paidSocialFirstPageMs: 30_000,
} as const;

export const CAPS = {
  perSession: 1,
  perWindow: 2,
  windowDays: 14,
  /** Closing without playing snoozes auto-open for this long. */
  snoozeDays: 14,
  /** The launcher x hides the pill for this long. */
  launcherDismissDays: 14,
  /** utm_medium email/sms visitors are remembered for this long. */
  emailVisitorDays: 365,
} as const;

export const KEYS = {
  /** Shared with ShopSignupPopup: epoch ms until auto-open may happen again. */
  snooze: "mully_shop_signup_v1",
  /** Set by every signup form on success. */
  signedUp: "mully_signed_up_v1",
  emailVisitor: "mully_tas_email_visitor_v1",
  autoOpens: "mully_tas_auto_v1",
  sessionAutoOpens: "mully_tas_auto_session_v1",
  sessionPageViews: "mully_tas_pv_v1",
  sessionLanding: "mully_tas_landing_v1",
  seen: "mully_tas_seen_v1",
  sessionFirstVisit: "mully_tas_first_visit_v1",
  closedUnplayed: "mully_tas_closed_unplayed_v1",
  launcherDismissed: "mully_tas_launcher_hide_v1",
  /** Written by lib/tracking from ?_kx. */
  klaviyoKx: "mully_kx",
} as const;

export type TriggerType = "timer_scroll" | "second_page" | "exit_intent" | "launcher" | "manual";
export type PageKind = "home" | "product" | "listing" | "other";
export type Device = "mobile" | "desktop";
export type SuppressReason =
  | "reward_saved" | "signed_up" | "known_email" | "member" | "email_sms_visit"
  | "excluded_page" | "bag" | "snoozed" | "session_cap" | "window_cap";

/** Where the visitor is, for page_type on every popup event. */
export type PageType = "home" | "shop_home" | "listing" | "gift_guide" | "product" | "blog" | "editorial";

/** /shop/<slug> pages that are listings, not products. */
const SHOP_LISTING_SLUGS = new Set(["collection", "new-arrivals", "vests", "quarter-zips"]);

/**
 * Never show Take a Shot here, even if an allow rule matches: checkout and
 * cart, subscription and plan picking, the gift-season landing and the
 * /gift-* token flows, member and account pages, login, and /join (which
 * has its own signup).
 */
const DENY: readonly RegExp[] = [
  /(^|\/)(checkout|checkouts|cart)(\/|$)/,
  /(^|\/)(subscription|choose-plan)(\/|$)/,
  /^\/lp\/gift-season(\/|$)/,
  /^\/gift-[^/]+(\/|$)/,
  /^\/(dashboard|account|login|auth|join|admin|ops|onboarding)(\/|$)/,
];

/** Public storefront pages, in match order. Anything else is excluded. */
const ALLOW: ReadonlyArray<[RegExp, PageType | ((m: RegExpExecArray, productPage: boolean) => PageType | null)]> = [
  [/^\/(home)?$/, "home"],
  [/^\/shop$/, "shop_home"],
  [/^\/shop\/gifts(\/[^/]+)?$/, "gift_guide"],
  [/^\/shop\/collection\/[^/]+$/, "listing"],
  // Any other /shop/<slug> counts only when the page rendered a real product.
  [/^\/shop\/([^/]+)$/, (m, productPage) => (SHOP_LISTING_SLUGS.has(m[1]) ? "listing" : productPage ? "product" : null)],
  [/^\/blog(\/.*)?$/, "blog"],
  [/^\/blogs\/news\/[^/]+$/, "blog"],
  [/^\/lp\/(editorial|mully100)(\/.*)?$/, "editorial"],
];

function cleanPath(pathname: string | null): string {
  return (pathname ?? "").split(/[?#]/)[0].replace(/\/+$/, "") || "/";
}

/**
 * The storefront page type, or null when Take a Shot must not run on this
 * route. `productPage`: the page rendered a product (see productPageInDom),
 * so an unknown /shop/<slug>, such as a 404, stays excluded.
 */
export function pageTypeFor(pathname: string | null, productPage = false): PageType | null {
  const p = cleanPath(pathname);
  if (DENY.some((re) => re.test(p))) return null;
  for (const [re, type] of ALLOW) {
    const m = re.exec(p);
    if (m) return typeof type === "function" ? type(m, productPage) : type;
  }
  return null;
}

/** The PDP renders inside ShopPageShell with the shop-pdp class. */
export const PRODUCT_PAGE_SELECTOR = ".shop-pdp, [data-tas-page=product]";
export function productPageInDom(): boolean {
  return typeof document !== "undefined" && Boolean(document.querySelector(PRODUCT_PAGE_SELECTOR));
}

/** Trigger timing only cares whether this is a product page. */
export function pageKindFor(pathname: string | null, productPage = false): PageKind {
  const t = pageTypeFor(pathname, productPage);
  if (!t) return "other";
  if (t === "product") return "product";
  if (t === "home" || t === "shop_home") return "home";
  return "listing";
}

/** Auto-open on every allowed storefront page. */
export function autoOpenPage(kind: PageKind): boolean {
  return kind !== "other";
}

/** Not an allowed storefront page (denied, or an unknown route). */
export function excludedPath(pathname: string | null, productPage = false): boolean {
  return pageTypeFor(pathname, productPage) === null;
}

const PAID_SOCIAL = /^(facebook|instagram|meta|fb|ig)$/i;
export function isPaidSocial(params: URLSearchParams): boolean {
  return PAID_SOCIAL.test(params.get("utm_source") ?? "") || params.has("fbclid");
}
export function isEmailOrSmsVisit(params: URLSearchParams): boolean {
  return /^(email|sms)$/i.test(params.get("utm_medium") ?? "") || /^klaviyo$/i.test(params.get("utm_source") ?? "");
}

/** Klaviyo's onsite cookie (__kla_id) carries $exchange_id or $email once a visitor is known. */
export function klaviyoCookieKnown(cookie: string): boolean {
  const m = /(?:^|;\s*)__kla_id=([^;]+)/.exec(cookie);
  if (!m) return false;
  try {
    const json = JSON.parse(atob(decodeURIComponent(m[1]))) as Record<string, unknown>;
    return Boolean(json.$exchange_id || json.$email);
  } catch { return false; }
}

export interface SuppressInput {
  rewardSaved: boolean;
  signedUp: boolean;
  knownEmail: boolean;
  member: boolean;
  emailSmsVisit: boolean;
  excludedPage: boolean;
  /** The existing bag rule: cart open, items in the bag, or purchase intent this session. */
  bag: boolean;
  snoozedUntil: number;
  sessionAutoOpens: number;
  /** Epoch ms of earlier auto-opens. */
  autoOpens: readonly number[];
  now: number;
}

/** First reason this visitor must not get an auto-open, or null. */
export function suppressReason(s: SuppressInput): SuppressReason | null {
  if (s.rewardSaved) return "reward_saved";
  if (s.member) return "member";
  if (s.signedUp) return "signed_up";
  if (s.knownEmail) return "known_email";
  if (s.emailSmsVisit) return "email_sms_visit";
  if (s.excludedPage) return "excluded_page";
  if (s.snoozedUntil > s.now) return "snoozed";
  if (s.sessionAutoOpens >= CAPS.perSession) return "session_cap";
  const since = s.now - CAPS.windowDays * 86_400_000;
  if (s.autoOpens.filter((t) => t > since).length >= CAPS.perWindow) return "window_cap";
  if (s.bag) return "bag";
  return null;
}

export interface TriggerInput {
  kind: PageKind;
  dwellMs: number;
  scrollFraction: number;
  pageViews: number;
  /** Paid-social landing and this is still the first page of the session. */
  paidSocialFirstPage: boolean;
}

/** Timer and scroll triggers. Exit intent is decided by exitIntentReady. */
export function timedTrigger(t: TriggerInput): TriggerType | null {
  if (!autoOpenPage(t.kind)) return null;
  if (t.paidSocialFirstPage && t.dwellMs < TRIGGER.paidSocialFirstPageMs) return null;
  const minDwell = t.kind === "product" ? TRIGGER.productDwellMs : TRIGGER.dwellMs;
  if (t.pageViews >= 2 && t.dwellMs >= (t.kind === "product" ? TRIGGER.productDwellMs : TRIGGER.secondPageDwellMs)) return "second_page";
  if (t.dwellMs >= minDwell && t.scrollFraction >= TRIGGER.scrollFraction) return "timer_scroll";
  return null;
}

export function exitIntentReady(t: { kind: PageKind; dwellMs: number; finePointer: boolean; paidSocialFirstPage: boolean }): boolean {
  if (!autoOpenPage(t.kind) || !t.finePointer) return false;
  return t.dwellMs >= (t.paidSocialFirstPage ? TRIGGER.paidSocialFirstPageMs : TRIGGER.exitDwellMs);
}

export interface LauncherInput {
  rewardSaved: boolean;
  member: boolean;
  dismissedUntil: number;
  now: number;
  excludedPage: boolean;
  kind: PageKind;
  viewportWidth: number;
  cartOpen: boolean;
  modalOpen: boolean;
  /** An auto-open was closed without playing. */
  closedUnplayed: boolean;
  /** First visit, and nothing has auto-opened yet this session. */
  firstVisitBeforeTrigger: boolean;
}

export function launcherVisible(l: LauncherInput): boolean {
  if (l.rewardSaved || l.member || l.modalOpen || l.cartOpen || l.excludedPage) return false;
  if (l.dismissedUntil > l.now) return false;
  if (l.kind === "other") return false;
  if (l.kind === "product" && l.viewportWidth < 768) return false;
  return l.closedUnplayed || l.firstVisitBeforeTrigger;
}

export function deviceFor(finePointer: boolean, width: number): Device {
  return finePointer && width >= 768 ? "desktop" : "mobile";
}

// ---------------------------------------------------------------------------
// Storage helpers (browser only; every call tolerates blocked storage)
// ---------------------------------------------------------------------------

function ls(): Storage | null { try { return window.localStorage; } catch { return null; } }
function ss(): Storage | null { try { return window.sessionStorage; } catch { return null; } }

export function readNumber(key: string, store: "local" | "session" = "local"): number {
  try { return Number((store === "local" ? ls() : ss())?.getItem(key)) || 0; } catch { return 0; }
}
export function writeValue(key: string, value: string, store: "local" | "session" = "local") {
  try { (store === "local" ? ls() : ss())?.setItem(key, value); } catch { /* storage unavailable */ }
}
export function readAutoOpens(): number[] {
  try {
    const raw = JSON.parse(ls()?.getItem(KEYS.autoOpens) ?? "[]");
    return Array.isArray(raw) ? raw.filter((n): n is number => typeof n === "number") : [];
  } catch { return []; }
}
export function recordAutoOpen(now = Date.now()) {
  const since = now - CAPS.windowDays * 86_400_000;
  writeValue(KEYS.autoOpens, JSON.stringify([...readAutoOpens().filter((t) => t > since), now].slice(-10)));
  writeValue(KEYS.sessionAutoOpens, String(readNumber(KEYS.sessionAutoOpens, "session") + 1), "session");
}

/**
 * Called by every signup form on success, so no popup asks again. Stores the
 * source only, never the email.
 */
export function markSignedUp(source: string, now = Date.now()) {
  writeValue(KEYS.signedUp, JSON.stringify({ at: now, source: source.slice(0, 40) }));
}
export function hasSignedUp(): boolean {
  try { return Boolean(ls()?.getItem(KEYS.signedUp)); } catch { return false; }
}
