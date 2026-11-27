"use client";
/* eslint-disable @next/next/no-img-element */
/* eslint-disable @next/next/no-html-link-for-pages */
/**
 * Holiday 2026 homepage hero: "Black Friday, not here."
 *
 * Replaces the seasonal photo hero on "/" while HOME_BF_HERO_ACTIVE is true
 * (src/lib/homeHero.ts). Two matching cards: Mullybox 2.0 for deal shoppers,
 * Gift a Season for gift buyers, plus a link to Drew's letter.
 *
 * The savings tag comes from live Gift a Season variant prices; with no
 * price it falls back to copy without a number. Prize tiles are examples
 * from the prize pool, with the disclaimer shown under the cards.
 */
import type { MouseEvent } from "react";
import { trackEvent } from "@/lib/tracking";
import { HOME_BF_LETTER_HREF } from "@/lib/homeHero";
import "./home-bf-hero.css";

const PRIZES = [
  { src: "/home-bf/omega-speedmaster-dark-side-of-the-moon.jpeg", alt: "Omega Speedmaster Dark Side of the Moon" },
  { src: "/home-bf/omega-seamaster-diver-42mm.jpeg", alt: "Omega Seamaster Diver 42mm" },
  { src: "/home-bf/vessel-prime-staff-bag.jpeg", alt: "Vessel Prime Staff Bag" },
] as const;

export function HomeBfHero({ giftSavings, backgroundDesktop, backgroundMobile }: {
  /** Largest live Gift a Season saving, formatted ("$196"), or null. */
  giftSavings: string | null;
  backgroundDesktop: string;
  backgroundMobile: string;
}) {
  const onClick = (e: MouseEvent<HTMLElement>) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-hero-cta]");
    if (!el) return;
    void trackEvent("hero_cta_click", {
      properties: { cta: el.dataset.heroCta, href: el.getAttribute("href"), variant: "bf_2026" },
    });
  };
  return (
    <section className="hbf" id="hero" aria-labelledby="hbfTitle" onClick={onClick} data-home-hero="bf_2026">
      <picture className="hbf__bg" aria-hidden="true">
        <source media="(max-width: 600px) and (orientation: portrait)" srcSet={backgroundMobile} width={600} height={800} />
        <img src={backgroundDesktop} alt="" width={1920} height={800} fetchPriority="high" loading="eager" />
      </picture>
      <div className="hbf__in">
        <div className="hbf__intro">
          <p className="hbf__kick"><s>Black Friday</s><span>Not here</span></p>
          <h1 id="hbfTitle">We&rsquo;re sitting this one out.</h1>
          <p className="hbf__dek">
            No doorbusters. Two better ideas instead.{" "}
            <a href={HOME_BF_LETTER_HREF} data-hero-cta="bf_letter">Read why</a>
          </p>
        </div>
        <div className="hbf__right">
          <div className="hbf__cards">
            <a className="hbf__card hbf__card--mb" href="/mullybox" data-hero-cta="bf_mullybox">
              <div className="hbf__band">
                <img className="hbf__art" src="/home-bf/mullybox-art.webp" alt="" width={960} height={600} />
                <span className="hbf__tag">The mystery is back.</span>
                <div className="hbf__fan">
                  {PRIZES.map(p => <img key={p.src} src={p.src} alt={p.alt} width={400} height={400} loading="eager" />)}
                </div>
              </div>
              <div className="hbf__body">
                <p className="hbf__k">For deal hunters</p>
                <h2>Mullybox 2.0</h2>
                <p className="hbf__s">Every open has a shot at Omega, Breitling or Vessel.</p>
                <span className="hbf__btn">See Mullybox 2.0</span>
              </div>
            </a>
            <a className="hbf__card hbf__card--gs" href="/lp/gift-season" data-hero-cta="bf_gift_season">
              <div className="hbf__band">
                <img className="hbf__art" src="/home-bf/gift-season.webp" alt="Mully Reserve pieces from Greyson, Rhone and Field Day with Mully packaging" width={960} height={600} />
                <span className="hbf__tag">{giftSavings ? `Save up to ${giftSavings}` : "Paid once, never renews"}</span>
              </div>
              <div className="hbf__body">
                <p className="hbf__k">For gift givers</p>
                <h2>Gift a Season</h2>
                <p className="hbf__s">Reserve, picked for them. One season or the full year.</p>
                <span className="hbf__btn">Gift a Season</span>
              </div>
            </a>
          </div>
          <p className="hbf__fine">Prizes shown are examples from the prize pool. What&rsquo;s available can change.</p>
        </div>
      </div>
    </section>
  );
}
