"use client";

import Image from "next/image";
import styles from "./swingbox.module.css";

/**
 * Static visual landing page for the Swing Box × Irving Fryar Jr.
 * pitch. Copy is tightened from the original mockup: no em/en dashes,
 * no AI filler, denser detail per line. All CTAs are visual only.
 */
export default function SwingBoxLanding() {
  return (
    <div className={styles.root}>
      {/* NAV */}
      <nav className={styles.nav}>
        <div className={styles.navInner}>
          <a className={styles.wordmark} href="#top">
            The Swing<span>Box</span>
          </a>
          <a className={styles.chip} href="#mully">
            Powered by Mully
          </a>
          <a className={`${styles.btn} ${styles.btnNav}`} href="#pricing">
            Founding price
          </a>
        </div>
      </nav>

      {/* HERO */}
      <header className={styles.hero} id="top">
        <div className={styles.heroBg} aria-hidden />
        <div className={`${styles.wrap} ${styles.heroGrid}`}>
          <div className={styles.heroCopy}>
            <span className={styles.eyebrow}>
              A monthly golf mobility system by Irving Fryar Jr.
            </span>
            <h1 className={styles.h1}>
              Get your <em>10 yards</em> back.
            </h1>
            <p className={styles.lede}>
              Stiff hips and a locked T-spine cost the average golfer 8 to 12
              yards. Ten minutes a day takes them back. A new 4-week mobility
              block ships every month: printed drill deck, Fryar Recovery Balm,
              and the tool that block needs.
            </p>
            <div className={styles.ctaRow}>
              <a className={styles.btn} href="#pricing">
                Become a founding member
              </a>
              <a className={styles.btnGhost} href="#how">
                See how it works
              </a>
            </div>
            <p className={styles.trust}>
              Founding price locked for life · Cancel anytime · Ships from
              Michigan
            </p>
          </div>

          <div className={styles.heroImage}>
            <div className={styles.heroImageInner}>
              <Image
                src="/swingbox/hero.jpg"
                alt="The Swing Box by Irving Fryar Jr. with drill deck, Fryar Recovery Balm, resistance ring, and a golf ball on a tee. A +10 yards badge overlays the balm jar."
                width={1600}
                height={1200}
                priority
                sizes="(max-width: 820px) 100vw, 560px"
                className={styles.heroImg}
              />
            </div>
            <ul className={styles.heroChips} aria-label="At a glance">
              <li className={styles.heroChip}>
                <span className={styles.heroChipLabel}>Time / day</span>
                <span className={styles.heroChipValue}>10 min</span>
              </li>
              <li className={styles.heroChip}>
                <span className={styles.heroChipLabel}>Equipment</span>
                <span className={styles.heroChipValue}>In the box</span>
              </li>
              <li className={styles.heroChip}>
                <span className={styles.heroChipLabel}>Gym</span>
                <span className={styles.heroChipValue}>Never</span>
              </li>
            </ul>
          </div>
        </div>
      </header>

      {/* MARQUEE STRIP */}
      <div className={styles.strip}>
        <div className={`${styles.wrap} ${styles.stripInner}`}>
          <span>No app</span>
          <span>No gym</span>
          <span>No screens on the course</span>
          <span>Ships monthly</span>
        </div>
      </div>

      {/* PAIN */}
      <section className={styles.block}>
        <div className={styles.wrap}>
          <span className={styles.eyebrow}>Sound familiar</span>
          <h2 className={styles.h2}>
            Your swing didn&rsquo;t get worse. Your body got tighter.
          </h2>
          <div className={styles.painGrid}>
            <div className={styles.pain}>
              <div className={styles.painNum}>01</div>
              <h3>The first-tee creak</h3>
              <p>
                Six holes to feel loose. By then the card is half written.
              </p>
            </div>
            <div className={styles.pain}>
              <div className={styles.painNum}>02</div>
              <h3>The vanishing yards</h3>
              <p>
                Same swing, same clubs, shorter ball flight. Lost rotation is
                lost distance, one degree at a time.
              </p>
            </div>
            <div className={styles.pain}>
              <div className={styles.painNum}>03</div>
              <h3>The next-day back</h3>
              <p>
                18 holes shouldn&rsquo;t cost you Monday. Stiff hips send the
                bill to your lower back.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className={`${styles.block} ${styles.alt}`} id="how">
        <div className={styles.wrap}>
          <span className={styles.eyebrow}>How it works</span>
          <h2 className={styles.h2}>
            Open the box. Follow the cards. Play looser.
          </h2>
          <div className={styles.steps}>
            <div className={styles.step}>
              <span className={styles.stepN}>Step 01</span>
              <h3>A training block arrives</h3>
              <p>
                Four weeks of mobility work, sequenced by Irving. Hips,
                T-spine, ground force, speed. Each month builds on the last.
              </p>
            </div>
            <div className={styles.step}>
              <span className={styles.stepN}>Step 02</span>
              <h3>Ten minutes, daily</h3>
              <p>
                Every drill is printed step by step, with Irving in the
                photo. Follow along in the living room, office, or on the
                range. No screen needed.
              </p>
            </div>
            <div className={styles.step}>
              <span className={styles.stepN}>Step 03</span>
              <h3>Recover, then swing</h3>
              <p>
                Work the Fryar Recovery Balm into what you trained. Take the
                new range of motion to the first tee.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* IN EVERY BOX */}
      <section className={styles.block}>
        <div className={styles.wrap}>
          <span className={styles.eyebrow}>In every box</span>
          <h2 className={styles.h2}>The coaching is printed in.</h2>
          <p className={styles.secLede}>
            One complete training system. One month at a time. Never a grab
            bag.
          </p>
          <div className={styles.insideGrid}>
            <div className={styles.item}>
              <span className={styles.tag}>Train</span>
              <h3>The drill deck</h3>
              <p>
                Waterproof cards, step by step, Irving photographed in every
                position. Lives in the golf bag. QR to a demo clip on each
                card if you want it, never required.
              </p>
            </div>
            <div className={styles.item}>
              <span className={styles.tag}>Recover</span>
              <h3>Fryar Recovery Balm</h3>
              <p>
                A fresh jar of magnesium-menthol muscle balm every month,
                made in the USA. Work it in after training and after rounds.
                You finish the jar. That&rsquo;s the point.
              </p>
            </div>
            <div className={styles.item}>
              <span className={styles.tag}>Build</span>
              <h3>The block&rsquo;s tool</h3>
              <p>
                The gear this month&rsquo;s block calls for: resistance
                bands, massage ball, grip trainer, more. By month six
                you&rsquo;ve built Irving&rsquo;s full home kit.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* SEASON */}
      <section className={`${styles.block} ${styles.alt}`}>
        <div className={styles.wrap}>
          <span className={styles.eyebrow}>Season One · Where every member begins</span>
          <h2 className={styles.h2}>
            Sequenced like a season. Never repeated.
          </h2>
          <p className={styles.secLede}>
            The first year is one program. Each block sets up the next,
            tuned to the golf calendar. Whenever you join, you start at
            Month 01.
          </p>
          <div className={styles.season}>
            {SEASON.map((s) => (
              <div className={styles.hole} key={s.n}>
                <span className={styles.mono}>MO {s.n}</span>
                <b>{s.title}</b>
              </div>
            ))}
          </div>
          <p className={styles.seasonCloser}>
            Then Season Two begins. New progressions, new tools, same ten
            minutes. The training doesn&rsquo;t run out. It levels up.
          </p>
        </div>
      </section>

      {/* IRVING */}
      <section className={styles.block}>
        <div className={`${styles.wrap} ${styles.irvingGrid}`}>
          <a
            className={styles.portrait}
            href="https://www.instagram.com/fryarfitnessgolf/"
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
              <div className={styles.portraitEyebrow}>Coach</div>
              <div className={styles.portraitName}>Irving Fryar Jr.</div>
              <div className={styles.portraitTag}>
                @fryarfitnessgolf
                <span className={styles.portraitArrow} aria-hidden>
                  ↗
                </span>
              </div>
            </div>
          </a>
          <div>
            <span className={styles.eyebrow}>Your coach in the box</span>
            <h2 className={styles.h2}>Built by Irving Fryar Jr.</h2>
            <p className={styles.body}>
              Irving has coached hundreds of thousands of golfers through
              Fryar Fitness Golf: strength, mobility, speed, and getting out
              of pain. The Swing Box is his complete system, designed once,
              done right. Every drill photographed. Every block sequenced.
              Every rep explained on the card in your hands.
            </p>
            <p className={styles.quote}>
              &ldquo;You don&rsquo;t need an hour in a gym. You need the
              right ten minutes, every day, in the right order. That&rsquo;s
              what I put in the box.&rdquo;
            </p>
            <p className={styles.trust}>
              @fryarfitnessgolf · 150K+ golfers strong
            </p>
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section className={`${styles.block} ${styles.alt}`} id="pricing">
        <div className={styles.wrap}>
          <span className={styles.eyebrow}>Founding member pricing</span>
          <h2 className={styles.h2}>Pick a plan. Price locked for life.</h2>
          <div className={styles.plans}>
            <div className={styles.plan}>
              <h3>Monthly</h3>
              <div className={styles.price}>
                $29<small>.99/mo</small>
              </div>
              <p className={styles.per}>$34.99 after founders&rsquo; round</p>
              <ul>
                <li>Full monthly box: deck, balm, tool</li>
                <li>Founding price locked for life</li>
                <li>Cancel anytime, two taps</li>
              </ul>
              <a className={styles.btnGhost} href="#pricing">
                Start monthly
              </a>
            </div>
            <div className={`${styles.plan} ${styles.best}`}>
              <span className={styles.flagtag}>Best value · 2 boxes free</span>
              <h3>Annual</h3>
              <div className={styles.price}>
                $299<small>/yr</small>
              </div>
              <p className={styles.per}>$24.92/mo effective</p>
              <ul>
                <li>Everything in monthly</li>
                <li>Two boxes free vs. paying monthly</li>
                <li>Welcome kit ships with priority</li>
                <li>Founders bonus: Range Ready warm-up kit</li>
              </ul>
              <a className={styles.btn} href="#pricing">
                Start annual, save $60
              </a>
            </div>
            <div className={styles.plan}>
              <h3>Quarterly</h3>
              <div className={styles.price}>
                $84<small>/qtr</small>
              </div>
              <p className={styles.per}>$28/mo, billed by block</p>
              <ul>
                <li>Full monthly box: deck, balm, tool</li>
                <li>Billing follows the training blocks</li>
                <li>Cancel anytime, two taps</li>
              </ul>
              <a className={styles.btnGhost} href="#pricing">
                Start quarterly
              </a>
            </div>
          </div>
          <p className={styles.guarantee}>
            The First-Box Promise: if 30 days doesn&rsquo;t leave you looser,
            we refund it. Keep everything.
          </p>
        </div>
      </section>

      {/* FAQ */}
      <section className={styles.block}>
        <div className={styles.wrap}>
          <span className={styles.eyebrow}>Answers</span>
          <h2 className={styles.h2}>Before you tee off</h2>
          <div className={styles.faq}>
            <details open>
              <summary>Do I need an app or videos?</summary>
              <p>
                No. Every drill is printed step by step with Irving
                photographed in each position. A QR on each card links to a
                short demo clip if you want it. You never need a screen to
                train.
              </p>
            </details>
            <details>
              <summary>I&rsquo;m 58 and stiff as a 2-iron. Is this for me?</summary>
              <p>
                Exactly who Irving built it for. Each drill starts at a
                beginner baseline and shows a harder progression on the same
                card. You pick the level. The sequence does the rest.
              </p>
            </details>
            <details>
              <summary>How much time does it actually take?</summary>
              <p>
                Ten minutes a day, five days a week. The blocks are built for
                consistency. The right ten minutes beats the perfect hour
                you skip.
              </p>
            </details>
            <details>
              <summary>What if I miss days?</summary>
              <p>
                Nothing breaks. Each block is four weeks with no expiration.
                Pick up where you left off. The decks are yours to keep and
                repeat.
              </p>
            </details>
            <details>
              <summary>When does my first box ship?</summary>
              <p>
                Founding boxes ship as one batch, three weeks after the
                founders&rsquo; round closes. You&rsquo;ll get tracking the
                day it leaves our Michigan warehouse. Every month after,
                like clockwork.
              </p>
            </details>
            <details>
              <summary>What happens after the first year?</summary>
              <p>
                Season Two begins. Golf runs in seasons and so does your
                body, so the training keeps building instead of ending.
                You keep your founding price, everything already in your
                kit, and your streak. Nobody graduates out of moving well.
              </p>
            </details>
            <details>
              <summary>Can I cancel or pause?</summary>
              <p>
                Anytime, in two taps, from the link in any email. No calls,
                no chats. Pause for the off-season and keep your founding
                price.
              </p>
            </details>
          </div>
        </div>
      </section>

      {/* MULLY */}
      <section className={styles.mully} id="mully">
        <div className={styles.wrap}>
          <span
            className={styles.eyebrow}
            style={{ color: "#9FD6AE" }}
          >
            Powered by Mully
          </span>
          <h2 className={styles.mullyH2}>
            Sourced, packed, and shipped by <span>Mully</span>.
          </h2>
          <p className={styles.mullyP}>
            The Swing Box is a Mully Original: designed with Irving, then
            sourced, quality-checked, packed, and shipped from our
            fulfillment floor in Michigan. When it shows up on time with
            everything in it, that&rsquo;s us. It&rsquo;s the only thing we
            do all day.
          </p>
          <div className={styles.creator}>
            <p>Have an audience? We build, fund, and run creator boxes end to end.</p>
            <a className={`${styles.btn} ${styles.btnLight}`} href="#mully">
              Launch your box with Mully
            </a>
          </div>
        </div>
      </section>

      <footer className={styles.fine}>
        <div className={styles.wrap}>
          <span>© 2026 Mully · The Swing Box by Irving Fryar Jr.</span>
          <span>Terms · Privacy · support@mully.com</span>
        </div>
      </footer>
    </div>
  );
}

const SEASON: { n: string; title: string }[] = [
  { n: "01", title: "Foundation: hips" },
  { n: "02", title: "Thoracic rotation" },
  { n: "03", title: "Ground force & balance" },
  { n: "04", title: "Pre-season speed" },
  { n: "05", title: "The first-tee warm-up" },
  { n: "06", title: "In-season maintenance" },
  { n: "07", title: "Shoulder freedom" },
  { n: "08", title: "Anti-fatigue: back nine" },
  { n: "09", title: "Lower-back armor" },
  { n: "10", title: "Off-season strength" },
  { n: "11", title: "Deep mobility reset" },
  { n: "12", title: "Speed: the new you" },
];
