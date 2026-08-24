"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import styles from "./swingbox.module.css";

// Shopify subscription cart permalink — drops user into checkout with the
// monthly selling plan already applied so they can't buy without it.
// Product: Swing Box (Founding 100) · Variant 48885734637760 · Plan 3654713536
const CHECKOUT_URL =
  "https://checkout.mymully.com/cart/48885734637760:1?selling_plan=3654713536";

const IG_URL = "https://www.instagram.com/fryarfitnessgolf/";

type CountResp = {
  count: number;
  goal: number;
  remaining: number;
  floor: number;
  live: number | null;
  seeded: boolean;
};

/**
 * Floating counter pill.
 * Polls /api/swingbox/count every 30s. Animates changes.
 * Falls back silently to the floor if the API errors.
 */
function CounterPill() {
  const [count, setCount] = useState<number>(12);
  const [goal] = useState<number>(100);
  const [bump, setBump] = useState<boolean>(false);
  const [hidden, setHidden] = useState<boolean>(false);
  const previous = useRef<number>(12);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const r = await fetch("/api/swingbox/count", { cache: "no-store" });
        if (!r.ok) return;
        const data: CountResp = await r.json();
        if (cancelled) return;
        if (data.count !== previous.current) {
          setBump(true);
          setTimeout(() => setBump(false), 900);
          previous.current = data.count;
        }
        setCount(data.count);
      } catch {
        // silent — floor is already shown
      }
    }
    tick();
    const id = setInterval(tick, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Hide the pill once the primary CTA is visible on screen (the user already
  // saw the counter in the hero; keeping it fixed causes overlap with body
  // copy on scroll). Re-show when scrolling back up.
  useEffect(() => {
    const cta = document.getElementById("claim");
    if (!cta) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          // Hide when the CTA (or anything past it) is in view.
          setHidden(e.isIntersecting || e.boundingClientRect.top < 0);
        }
      },
      { rootMargin: "-40px 0px 0px 0px", threshold: 0 }
    );
    io.observe(cta);
    return () => io.disconnect();
  }, []);

  const pct = Math.max(0, Math.min(100, (count / goal) * 100));

  return (
    <a
      href="#claim"
      className={`${styles.counter} ${hidden ? styles.counterHidden : ""}`}
      aria-label={`${count} of ${goal} founding members claimed`}
      aria-hidden={hidden}
    >
      <span className={styles.counterDot} aria-hidden />
      <span className={styles.counterText}>
        <b className={`${styles.counterNum} ${bump ? styles.counterBump : ""}`}>
          {count}
        </b>
        <span className={styles.counterSlash}>/</span>
        <span className={styles.counterGoal}>{goal}</span>
        <span className={styles.counterLabel}>founding members</span>
      </span>
      <span className={styles.counterBar} aria-hidden>
        <span
          className={styles.counterBarFill}
          style={{ width: `${pct}%` }}
        />
      </span>
    </a>
  );
}

export default function SwingBoxLanding() {
  return (
    <main className={styles.page}>
      <CounterPill />

      {/* HERO */}
      <header className={styles.hero}>
        <div className={styles.wrap}>
          <span className={styles.eyebrow}>
            Pre-sale <span className={styles.dot}>·</span> First 100 members
          </span>

          <h1 className={styles.h1}>
            <span className={styles.h1Line}>Better Movement.</span>
            <span className={styles.h1Line}>Better Golf.</span>
            <span className={styles.h1Underline} aria-hidden />
          </h1>

          <p className={styles.heroLede}>
            An offseason mobility system led by Irving Fryar Jr. Ten minutes a
            day, coached inside a private community, so you show up to spring
            faster, looser, and hitting it further.
          </p>

          <div className={styles.heroArtWrap}>
            <Image
              src="/swingbox/hero-art.jpg"
              alt="Irving Fryar Jr. with the Swing Box: drill deck, Fryar Recovery Balm, resistance ring, and a phone showing the Hip Flexor Mobility Flow."
              width={1400}
              height={1400}
              priority
              sizes="(max-width: 720px) 100vw, 640px"
              className={styles.heroArt}
            />
          </div>

          {/* PRIMARY CTA */}
          <div className={styles.ctaBlock} id="claim">
            <a
              className={styles.ctaBtn}
              href={CHECKOUT_URL}
              rel="noopener"
            >
              Claim your founding box
              <span className={styles.ctaPrice}>$29.99/mo</span>
            </a>
            <p className={styles.ctaMeta}>
              Ships October <span className={styles.pipe}>|</span> Cancel
              anytime <span className={styles.pipe}>|</span> Founding rate
              locked for life
            </p>
          </div>
        </div>
      </header>

      {/* WHAT'S IN THE BOX */}
      <section className={styles.includes} aria-label="Each box includes">
        <div className={styles.wrap}>
          <div className={styles.includesHead}>
            <span className={styles.brush}>Each box includes</span>
          </div>
          <ul className={styles.includesGrid}>
            <li className={styles.includesItem}>
              <span className={styles.includesIcon} aria-hidden>
                <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <ellipse cx="24" cy="14" rx="14" ry="4" />
                  <path d="M10 14v20c0 2.2 6.3 4 14 4s14-1.8 14-4V14" />
                  <path d="M10 24c0 2.2 6.3 4 14 4s14-1.8 14-4" />
                </svg>
              </span>
              <b>Premium Recovery Tools</b>
              <p>Balm, ring, and rotating props each month.</p>
            </li>
            <li className={styles.includesItem}>
              <span className={styles.includesIcon} aria-hidden>
                <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="30" cy="10" r="3" />
                  <path d="M28 15l-6 8-8 2" />
                  <path d="M22 23l4 6 6 2 4 8" />
                  <path d="M14 25l-4 12" />
                  <path d="M32 31l6-3" />
                </svg>
              </span>
              <b>Drills &amp; Mobility Programs</b>
              <p>A new deck of coached drills every 30 days.</p>
            </li>
            <li className={styles.includesItem}>
              <span className={styles.includesIcon} aria-hidden>
                <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <ellipse cx="24" cy="24" rx="16" ry="10" />
                  <ellipse cx="24" cy="24" rx="10" ry="6" />
                </svg>
              </span>
              <b>Exclusive Gear &amp; Accessories</b>
              <p>Member-only kit you won&rsquo;t find on the site.</p>
            </li>
            <li className={styles.includesItem}>
              <span className={styles.includesIcon} aria-hidden>
                <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="14" y="6" width="20" height="36" rx="3" />
                  <line x1="14" y1="12" x2="34" y2="12" />
                  <line x1="14" y1="36" x2="34" y2="36" />
                  <circle cx="24" cy="39" r="1.2" />
                </svg>
              </span>
              <b>Digital Coaching &amp; Community</b>
              <p>Private group with Irving, weekly check-ins.</p>
            </li>
          </ul>
        </div>
      </section>

      {/* COMMUNITY / IRVING */}
      <section className={styles.community}>
        <div className={`${styles.wrap} ${styles.communityGrid}`}>
          <a
            className={styles.portrait}
            href={IG_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Irving Fryar Jr. on Instagram (@fryarfitnessgolf)"
          >
            <Image
              src="/swingbox/irving.jpg"
              alt="Irving Fryar Jr., at the course."
              width={800}
              height={1000}
              sizes="(max-width: 900px) 100vw, 440px"
              className={styles.portraitImg}
            />
            <div className={styles.portraitOverlay}>
              <div className={styles.portraitEyebrow}>Your coach</div>
              <div className={styles.portraitName}>Irving Fryar Jr.</div>
              <div className={styles.portraitTag}>
                @fryarfitnessgolf
                <span className={styles.portraitArrow} aria-hidden>↗</span>
              </div>
            </div>
          </a>
          <div>
            <span className={styles.eyebrow}>The community is the product</span>
            <h2 className={styles.h2}>
              Train with Irving. And 99 golfers doing the same work.
            </h2>
            <p className={styles.body}>
              Every founding member gets pulled into a private Facebook group
              the day you claim. That&rsquo;s where Irving coaches drills,
              answers questions, drops the daily flows, and keeps the group
              honest through the offseason.
            </p>
            <p className={styles.body}>
              Bombing it like Irving isn&rsquo;t about swing tips. It&rsquo;s
              about moving like him. This is the room where that happens.
            </p>
            <ul className={styles.communityList}>
              <li>Weekly live drills and Q&amp;A with Irving</li>
              <li>Daily 10-minute flows for the whole group</li>
              <li>Progress check-ins from October through spring</li>
            </ul>
            <a
              className={styles.ctaBtnSm}
              href={CHECKOUT_URL}
              rel="noopener"
            >
              Claim your spot &middot; $29.99/mo
            </a>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className={styles.faqSection} id="faq">
        <div className={styles.wrap}>
          <span className={styles.eyebrow}>Founding member FAQ</span>
          <h2 className={styles.h2}>Quick answers.</h2>
          <div className={styles.faq}>
            <details>
              <summary>When does my first box ship?</summary>
              <p>
                Founding boxes ship the first week of October, in one batch,
                straight from our Michigan warehouse. Tracking hits your inbox
                the day it leaves.
              </p>
            </details>
            <details>
              <summary>How does the community actually work?</summary>
              <p>
                The day you claim your box, you get an invite to a private
                Facebook group. Irving posts daily flows, hosts weekly live
                sessions, and answers questions. It&rsquo;s the real product.
                The box makes it physical.
              </p>
            </details>
            <details>
              <summary>What&rsquo;s in the first box?</summary>
              <p>
                A drill deck built by Irving, Fryar Recovery Balm, a resistance
                ring, and access to the digital coaching library. Every box
                after brings a new drill deck, new props, new focus.
              </p>
            </details>
            <details>
              <summary>Can I cancel?</summary>
              <p>
                Anytime, in two taps from your account. Your founding rate
                stays locked as long as you stay subscribed.
              </p>
            </details>
          </div>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={styles.wrap}>
          <div className={styles.footInner}>
            <span className={styles.footMark}>Powered by Mully</span>
            <span className={styles.footTag}>
              Sourced, packed, and shipped from Michigan.
            </span>
          </div>
        </div>
      </footer>
    </main>
  );
}
