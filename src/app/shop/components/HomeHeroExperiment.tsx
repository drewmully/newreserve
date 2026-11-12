"use client";

/**
 * home_hero_dual: homepage-only hero test. See src/lib/homeHero.ts.
 *
 * Server HTML renders the control hero (children) plus the dual markup with
 * `hidden`, so crawlers and visitors PostHog cannot bucket see control and
 * the only <h1> in the server HTML is the current one. The dual headline is
 * a <p> until the visitor is bucketed into dual, then it renders as <h1>
 * and the control hero is removed.
 *
 * QA override: ?hh=dual or ?hh=control (kept for the tab session), ?hh=off
 * clears it. Override exposures carry hh_override: true.
 */
import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import posthog from "posthog-js";
import { trackEvent } from "@/lib/tracking";
import {
  HOME_HERO_FLAG,
  HOME_HERO_OVERRIDE_PARAM,
  HOME_HERO_RESERVE_IMAGES,
  HOME_HERO_SHOP_IMAGES,
  homeHeroHeadline,
  isHomeHeroVariant,
  storeHomeHeroVariant,
  type HomeHeroVariant,
} from "@/lib/homeHero";

const OVERRIDE_KEY = "mully_hh_override";
const FLAG_TIMEOUT_MS = 3000;
const BOT_UA = /bot|crawl|spider|Googlebot|bingbot|AdsBot|Storebot|DuckDuckBot|Baiduspider|Bytespider|HeadlessChrome|Lighthouse|PhantomJS|Puppeteer|Playwright/i;

function looksLikeBot(): boolean {
  try {
    if ((navigator as Navigator & { webdriver?: boolean }).webdriver === true) return true;
    return BOT_UA.test(navigator.userAgent || "");
  } catch {
    return true;
  }
}

function readOverride(): HomeHeroVariant | null {
  try {
    const q = new URLSearchParams(window.location.search).get(HOME_HERO_OVERRIDE_PARAM);
    if (q === "off") sessionStorage.removeItem(OVERRIDE_KEY);
    if (isHomeHeroVariant(q)) {
      sessionStorage.setItem(OVERRIDE_KEY, q);
      return q;
    }
    const s = sessionStorage.getItem(OVERRIDE_KEY);
    return isHomeHeroVariant(s) ? s : null;
  } catch {
    return null;
  }
}

export function HomeHeroExperiment({
  season,
  reservePrice,
  children,
}: {
  season: string;
  /** Live Reserve quarterly price ("$250"), or null to hide the price. */
  reservePrice: string | null;
  /** The control hero. */
  children: ReactNode;
}) {
  const [variant, setVariant] = useState<HomeHeroVariant>("control");
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    let settled = false;
    const settle = (v: HomeHeroVariant, override: boolean) => {
      if (settled) return;
      settled = true;
      setVariant(v);
      setResolved(true);
      storeHomeHeroVariant(v);
      try {
        if (posthog.__loaded) {
          posthog.register({ home_hero_variant: v });
          posthog.capture("home_hero_exposure", { variant: v, ...(override ? { hh_override: true } : {}) }, { transport: "sendBeacon" });
        }
      } catch {
        // Tracking must never break the page.
      }
    };

    const forced = readOverride();
    if (forced) {
      settle(forced, true);
      return;
    }
    if (looksLikeBot() || !posthog.__loaded) return; // Control, untracked.

    const timer = window.setTimeout(() => { settled = true; }, FLAG_TIMEOUT_MS);
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = posthog.onFeatureFlags(() => {
        if (settled) return;
        window.clearTimeout(timer);
        const value = posthog.getFeatureFlag(HOME_HERO_FLAG);
        if (isHomeHeroVariant(value)) settle(value, false);
        else settled = true; // Flag missing or off: control, untracked.
      });
    } catch {
      settled = true;
    }
    return () => {
      window.clearTimeout(timer);
      unsubscribe?.();
    };
  }, []);

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-hero-cta]");
    if (!el) return;
    void trackEvent("hero_cta_click", {
      properties: {
        cta: el.dataset.heroCta,
        href: el.getAttribute("href"),
        variant,
        resolved,
      },
    });
  };

  const dual = variant === "dual";
  return (
    <div className="hh-root" onClick={onClick} data-home-hero={variant}>
      {!dual && children}
      <DualHero season={season} reservePrice={reservePrice} active={dual} />
    </div>
  );
}

function DualHero({ season, reservePrice, active }: { season: string; reservePrice: string | null; active: boolean }) {
  const headline = homeHeroHeadline(season);
  const seasonTitle = `The ${season.charAt(0).toUpperCase() + season.slice(1)} Edit`;
  // Fewer words, more product: one short headline, two image-led cards, one
  // button each. Trust lines live in the top bar; gifts live in the nav.
  return (
    <div className="hh-dual" hidden={!active}>
      <section className="hh" id={active ? "hero" : undefined} aria-labelledby="hhTitle">
        <div className="hh__in">
          {active ? <h1 id="hhTitle" className="hh__title">{headline}</h1> : <p id="hhTitle" className="hh__title">{headline}</p>}
          <div className="hh__grid">
            <article className="hh__card">
              <Link className="hh__art hh__art--shop" href="/shop" data-hero-cta="shop_image" tabIndex={-1} aria-hidden="true">
                {HOME_HERO_SHOP_IMAGES.map((img) => <img key={img.src} src={img.src} alt="" width={480} height={640} loading="lazy" />)}
              </Link>
              <div className="hh__body">
                <h2 className="hh__cardtitle">{seasonTitle}</h2>
                <div className="hh__row">
                  <Link className="hh__btn" href="/shop" data-hero-cta="shop">Shop the edit</Link>
                  <Link className="hh__link" href="/shop/gifts" data-hero-cta="gifts">Gifts</Link>
                </div>
              </div>
            </article>
            <article className="hh__card">
              <Link className="hh__art hh__art--set" href="/subscription" data-hero-cta="reserve_image" tabIndex={-1} aria-hidden="true">
                {HOME_HERO_RESERVE_IMAGES.map((img, i) => <span key={img.src} className={i > 1 ? "hh__tile hh__tile--x" : "hh__tile"}><img src={img.src} alt="" width={480} height={480} loading="lazy" /></span>)}
              </Link>
              <div className="hh__body">
                <h2 className="hh__cardtitle">Styled for you</h2>
                <div className="hh__row">
                  <Link className="hh__btn" href="/subscription" data-hero-cta="reserve">Build your Reserve</Link>
                  {reservePrice && <span className="hh__price">{`${reservePrice} a quarter`}</span>}
                </div>
              </div>
            </article>
          </div>
        </div>
      </section>
    </div>
  );
}
