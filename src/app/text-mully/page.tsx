/**
 * GET /text-mully
 *
 * Paid-media SMS bridge. Warms the visitor with Martine's value prop
 * (free $25 credit + style consult + real curator, not a bot), then opens
 * a pre-filled SMS. Source-aware via ?src=x|meta|google|email so the
 * pre-filled body varies by channel and downstream Supabase attribution
 * tags the inbound correctly.
 *
 * The route stays static (edge-cached). The `src` param is read on the
 * client so the page HTML is one artifact; the pre-filled body, any
 * pixel event, and the auto-redirect are all resolved at runtime.
 *
 * Analytics fired on this page:
 *   - lp_text_mully_view (once on mount) — PostHog only
 *   - sms_click (on tap of the primary CTA)
 *       * PostHog beacon carrying { src, event_id }
 *       * Meta fbq('track', 'Lead', {content_name: 'sms_click', src},
 *                  {eventID: event_id}) client-side; matching CAPI fire
 *                  from /api/analytics/track dedupes on event_id.
 *       * X Pixel twq('event', 'tw-od2vz-sms_click') client-side
 *       * GA4 gtag('event', 'sms_click', {src}) client-side (imported to
 *                  Google Ads as a Contact-category conversion)
 *
 * Sticky bottom "Text Martine" CTA on mobile keeps the primary action
 * in viewport as the value prop and carousel scroll past it.
 */

export const dynamic = "force-static";
export const revalidate = 3600;

const NUMBER_DISPLAY = "949-329-9066";
const NUMBER_E164 = "+19493299066";

// Source-aware pre-filled bodies. No em/en dashes anywhere.
const BODIES: Record<string, string> = {
  x: "Hey Martine, saw your post on X and I'm curious about Mully",
  meta: "Hey Martine, saw your post and I'm curious about Mully",
  google: "Hey Martine, I found Mully on Google and want to learn more",
  email: "Hi Martine, I got your email and am interested in learning more",
};
const DEFAULT_SRC = "email";

const CAROUSEL_IMAGES = [
  "/lp/discover/Hero-8.jpg",
  "/lp/discover/Discovery.jpg",
  "/lp/discover/Signature-2.jpg",
  "/lp/discover/Reserve-3.jpg",
  "/lp/discover/Box-Preview-Discovery-5.jpg",
  "/lp/discover/Box-Preview-Signature-4.jpg",
  "/lp/discover/Box-Preview-Reserve-6.jpg",
  "/lp/discover/Unboxing-7.jpg",
];

export const metadata = {
  title: "Text Martine — Mully",
  description:
    "Text with Martine, our in-house golf stylist. Two-minute style consult, plus $25 off your first box.",
  robots: { index: false, follow: false },
};

export default function TextMullyPage() {
  const bodiesJson = JSON.stringify(BODIES);
  const numberE164Json = JSON.stringify(NUMBER_E164);
  const defaultSrcJson = JSON.stringify(DEFAULT_SRC);

  const bootstrap = `
    (function(){
      try {
        var params = new URLSearchParams(window.location.search);
        var src = (params.get("src") || ${defaultSrcJson}).toLowerCase();
        var bodies = ${bodiesJson};
        if (!bodies[src]) src = ${defaultSrcJson};
        var body = bodies[src];
        var num = ${numberE164Json};
        var ua = navigator.userAgent || "";
        var isIOS = /iPhone|iPad|iPod/i.test(ua);
        var isAndroid = /Android/i.test(ua);
        var isMobile = isIOS || isAndroid || /Mobile|Silk/i.test(ua);
        var hrefIOS = "sms:" + num + "?&body=" + encodeURIComponent(body);
        var hrefAndroid = "sms:" + num + "?body=" + encodeURIComponent(body);
        var href = isAndroid ? hrefAndroid : hrefIOS;

        // Point every [data-sms-link] anchor at the right body/platform variant
        var links = document.querySelectorAll("[data-sms-link]");
        for (var i = 0; i < links.length; i++) links[i].setAttribute("href", href);

        // Fire X Pixel VIEW event for paid-channel visits (pixel initialized in layout)
        if (typeof window.twq === "function") {
          try {
            window.twq("event", "tw-od2vz-sms_visit", {
              contents: [{ content_id: src }],
              conversion_id: null,
              email_address: null,
            });
          } catch (_e) {}
        }

        // Fire PostHog lp_text_mully_view (page-load event) via server-side track endpoint
        try {
          var viewPayload = JSON.stringify({
            event_name: "lp_text_mully_view",
            properties: { src: src },
            page_url: window.location.href,
          });
          if (navigator.sendBeacon) {
            navigator.sendBeacon(
              "/api/analytics/track",
              new Blob([viewPayload], { type: "application/json" })
            );
          } else {
            fetch("/api/analytics/track", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: viewPayload,
              keepalive: true,
            }).catch(function(){});
          }
        } catch (_e) {}

        // Auto-redirect on mobile
        if (isMobile) {
          setTimeout(function(){ window.location.href = href; }, 60);
        }

        // ─── SMS CLICK HANDLER ────────────────────────────────────────
        // Fires when the user actually taps any [data-sms-link] CTA.
        // Emits ONE dedupable event across PostHog, Meta CAPI + Pixel,
        // X Pixel, and GA4. The same event_id is used everywhere so
        // Meta collapses the Pixel + CAPI mirror to a single Lead.
        function uuid() {
          if (window.crypto && window.crypto.randomUUID) {
            try { return window.crypto.randomUUID(); } catch (_e) {}
          }
          return (
            Date.now().toString(36) +
            "-" +
            Math.random().toString(36).slice(2, 10) +
            "-" +
            Math.random().toString(36).slice(2, 10)
          );
        }

        function fireSmsClick() {
          var eventId = uuid();

          // 1) PostHog + Meta CAPI (server-side) via track endpoint.
          //    Server-side CAPI reads properties.event_id and echoes it to
          //    Meta so the client fbq('track', 'Lead', ..., {eventID}) below
          //    dedupes cleanly.
          try {
            var payload = JSON.stringify({
              event_name: "sms_click",
              properties: { src: src, event_id: eventId },
              page_url: window.location.href,
            });
            if (navigator.sendBeacon) {
              navigator.sendBeacon(
                "/api/analytics/track",
                new Blob([payload], { type: "application/json" })
              );
            } else {
              fetch("/api/analytics/track", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: payload,
                keepalive: true,
              }).catch(function(){});
            }
          } catch (_e) {}

          // 2) Meta Pixel client-side mirror. Same eventID as the CAPI fire
          //    → Meta dedupes to a single Lead. Without this fbq call the
          //    server-side event still counts, but browser-signal quality is
          //    lower and match rate drops.
          if (typeof window.fbq === "function") {
            try {
              window.fbq(
                "track",
                "Lead",
                { content_name: "sms_click", src: src },
                { eventID: eventId }
              );
            } catch (_e) {}
          }

          // 3) X Pixel click event
          if (typeof window.twq === "function") {
            try {
              window.twq("event", "tw-od2vz-sms_click", {
                contents: [{ content_id: src }],
                conversion_id: eventId,
                email_address: null,
              });
            } catch (_e) {}
          }

          // 4) GA4 client-side. Imported into Google Ads as a Contact
          //    conversion so Search delivery optimizes toward this event.
          if (typeof window.gtag === "function") {
            try {
              window.gtag("event", "sms_click", {
                src: src,
                event_id: eventId,
                transport_type: "beacon",
              });
            } catch (_e) {}
          }
        }

        // Attach to every SMS anchor. Use mousedown/touchstart AND click
        // so the event fires before the sms: navigation begins tearing
        // down the page — critical because Safari kills pending network
        // requests on sms: navigation.
        function attachTracker(el) {
          if (!el || el.__smsClickBound) return;
          el.__smsClickBound = true;
          el.addEventListener("pointerdown", fireSmsClick, { once: false, passive: true });
          el.addEventListener("click", fireSmsClick, { once: false, passive: true });
        }
        var smsAnchors = document.querySelectorAll("[data-sms-link]");
        for (var j = 0; j < smsAnchors.length; j++) attachTracker(smsAnchors[j]);

        // Copy-to-clipboard for the desktop number
        document.addEventListener("click", function(e){
          var el = e.target;
          if (!(el instanceof Element)) return;
          var btn = el.closest("[data-copy]");
          if (!btn) return;
          var value = btn.getAttribute("data-copy") || "";
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(value).then(function(){
              btn.setAttribute("data-copied", "1");
              var lbl = btn.querySelector("[data-copy-label]");
              if (lbl) {
                var prev = lbl.textContent;
                lbl.textContent = "Copied";
                setTimeout(function(){ lbl.textContent = prev; btn.removeAttribute("data-copied"); }, 1600);
              }
            }).catch(function(){});
          }
        });
      } catch (_e) { /* noop */ }
    })();
  `;

  // Duplicate the image list for a seamless infinite marquee
  const marqueeImages = [...CAROUSEL_IMAGES, ...CAROUSEL_IMAGES];

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#F4F1EC",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "40px 16px 120px",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Helvetica, Arial, sans-serif",
        color: "#1A1A1A",
      }}
    >
      <div
        style={{
          maxWidth: 520,
          width: "100%",
          background: "#FFFFFF",
          borderRadius: 12,
          padding: "40px 32px 32px",
          textAlign: "center",
          boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        }}
      >
        <img
          src="/team/martine-square.webp"
          width={96}
          height={96}
          alt="Martine, Mully's in-house golf stylist"
          style={{
            width: 96,
            height: 96,
            borderRadius: "50%",
            display: "block",
            margin: "0 auto 12px",
          }}
        />
        <p
          style={{
            margin: "0 0 4px 0",
            fontSize: 11,
            letterSpacing: "1.4px",
            textTransform: "uppercase",
            color: "#8A7A5C",
            fontWeight: 600,
          }}
        >
          Meet Martine
        </p>
        <h1
          style={{
            fontFamily: 'Georgia, "Times New Roman", Times, serif',
            fontSize: 28,
            lineHeight: 1.2,
            margin: "0 0 10px 0",
            fontWeight: "normal",
          }}
        >
          Text with your golf stylist.
        </h1>
        <p
          style={{
            margin: "0 0 24px 0",
            fontSize: 15,
            color: "#4A4A4A",
            lineHeight: 1.55,
          }}
        >
          Martine curates every Mully Reserve box. Send her a text and she&apos;ll
          walk you through what fits your game, in about two minutes.
        </p>

        {/* What you get */}
        <div
          style={{
            background: "#F9F6F0",
            border: "1px solid #EDE7DE",
            borderRadius: 10,
            padding: "20px 22px",
            textAlign: "left",
            margin: "0 0 24px 0",
          }}
        >
          <p
            style={{
              margin: "0 0 12px 0",
              fontSize: 11,
              letterSpacing: "1.4px",
              textTransform: "uppercase",
              color: "#8A7A5C",
              fontWeight: 600,
              textAlign: "center",
            }}
          >
            What you get
          </p>
          <ul
            style={{
              margin: 0,
              padding: 0,
              listStyle: "none",
              fontSize: 14.5,
              color: "#1A1A1A",
              lineHeight: 1.5,
            }}
          >
            <li style={{ padding: "8px 0", display: "flex", gap: 12 }}>
              <span
                aria-hidden="true"
                style={{
                  flex: "0 0 22px",
                  fontWeight: 700,
                  color: "#8A7A5C",
                  fontFamily: 'Georgia, "Times New Roman", Times, serif',
                }}
              >
                01
              </span>
              <span>
                <strong style={{ fontWeight: 600 }}>$25 off your first box.</strong>{" "}
                Martine sends you a code after your consult.
              </span>
            </li>
            <li
              style={{
                padding: "8px 0",
                display: "flex",
                gap: 12,
                borderTop: "1px solid #EDE7DE",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  flex: "0 0 22px",
                  fontWeight: 700,
                  color: "#8A7A5C",
                  fontFamily: 'Georgia, "Times New Roman", Times, serif',
                }}
              >
                02
              </span>
              <span>
                A <strong style={{ fontWeight: 600 }}>two-minute style consult</strong>{" "}
                so your first box actually fits how and where you play.
              </span>
            </li>
            <li
              style={{
                padding: "8px 0",
                display: "flex",
                gap: 12,
                borderTop: "1px solid #EDE7DE",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  flex: "0 0 22px",
                  fontWeight: 700,
                  color: "#8A7A5C",
                  fontFamily: 'Georgia, "Times New Roman", Times, serif',
                }}
              >
                03
              </span>
              <span>
                A real curator, not a bot.{" "}
                <strong style={{ fontWeight: 600 }}>No pressure, no auto-replies.</strong>{" "}
                Martine reads every message.
              </span>
            </li>
          </ul>
        </div>

        <a
          data-sms-link
          href={`sms:${NUMBER_E164}?&body=${encodeURIComponent(BODIES[DEFAULT_SRC])}`}
          style={{
            display: "inline-block",
            background: "#1A1A1A",
            color: "#FFFFFF",
            textDecoration: "none",
            padding: "16px 32px",
            borderRadius: 999,
            fontSize: 15,
            fontWeight: 600,
            letterSpacing: "0.2px",
            width: "100%",
            maxWidth: 340,
            boxSizing: "border-box",
          }}
        >
          Text Martine &middot; Claim $25
        </a>
        <p style={{ margin: "12px 0 0 0", fontSize: 12, color: "#8A8A8A" }}>
          Opens your Messages app with the first line already written.
        </p>

        {/* What Martine will ask */}
        <div
          style={{
            marginTop: 24,
            paddingTop: 22,
            borderTop: "1px solid #EDE7DE",
            textAlign: "left",
          }}
        >
          <p
            style={{
              margin: "0 0 10px 0",
              fontSize: 11,
              letterSpacing: "1.4px",
              textTransform: "uppercase",
              color: "#8A7A5C",
              fontWeight: 600,
              textAlign: "center",
            }}
          >
            What Martine will ask
          </p>
          <p
            style={{
              margin: 0,
              fontSize: 13.5,
              color: "#4A4A4A",
              lineHeight: 1.6,
              textAlign: "center",
            }}
          >
            Where you play. Your usual size. What you keep reaching for.
            That&apos;s it. She takes it from there.
          </p>
        </div>

        {/* Desktop fallback */}
        <div
          style={{
            marginTop: 24,
            paddingTop: 20,
            borderTop: "1px solid #EDE7DE",
          }}
        >
          <p style={{ margin: "0 0 10px 0", fontSize: 13, color: "#6B6B6B" }}>
            On desktop? Text this number from your phone:
          </p>
          <button
            type="button"
            data-copy={NUMBER_DISPLAY}
            style={{
              background: "#F4F1EC",
              border: "1px solid #E5DFD3",
              borderRadius: 8,
              padding: "12px 20px",
              cursor: "pointer",
              fontSize: 16,
              fontWeight: 600,
              color: "#1A1A1A",
              fontFamily: "inherit",
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span>{NUMBER_DISPLAY}</span>
            <span
              data-copy-label
              style={{ fontSize: 12, color: "#6B6B6B", fontWeight: 500 }}
            >
              Tap to copy
            </span>
          </button>
          <p style={{ margin: "14px 0 0 0", fontSize: 12, color: "#8A8A8A" }}>
            Or call the same number if you prefer:{" "}
            <a
              href={`tel:${NUMBER_E164}`}
              style={{ color: "#8A8A8A", textDecoration: "underline" }}
            >
              {NUMBER_DISPLAY}
            </a>
          </p>
        </div>
      </div>

      {/* Rolling image marquee under the card */}
      <div
        aria-hidden="true"
        style={{
          marginTop: 32,
          width: "100%",
          maxWidth: 1200,
          overflow: "hidden",
          maskImage:
            "linear-gradient(to right, transparent, black 6%, black 94%, transparent)",
          WebkitMaskImage:
            "linear-gradient(to right, transparent, black 6%, black 94%, transparent)",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 12,
            width: "max-content",
            animation: "textMullyMarquee 60s linear infinite",
          }}
        >
          {marqueeImages.map((src, i) => (
            <img
              key={`${src}-${i}`}
              src={src}
              alt=""
              loading={i < CAROUSEL_IMAGES.length ? "eager" : "lazy"}
              style={{
                height: 180,
                width: "auto",
                borderRadius: 10,
                objectFit: "cover",
                display: "block",
                flex: "0 0 auto",
              }}
            />
          ))}
        </div>
      </div>

      {/* Sticky bottom CTA keeps action in viewport on mobile */}
      <div
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          padding: "12px 16px calc(12px + env(safe-area-inset-bottom))",
          background:
            "linear-gradient(to top, rgba(244,241,236,1) 60%, rgba(244,241,236,0))",
          display: "flex",
          justifyContent: "center",
          zIndex: 10,
          pointerEvents: "none",
        }}
      >
        <a
          data-sms-link
          href={`sms:${NUMBER_E164}?&body=${encodeURIComponent(BODIES[DEFAULT_SRC])}`}
          style={{
            pointerEvents: "auto",
            display: "inline-block",
            background: "#1A1A1A",
            color: "#FFFFFF",
            textDecoration: "none",
            padding: "14px 32px",
            borderRadius: 999,
            fontSize: 15,
            fontWeight: 600,
            letterSpacing: "0.2px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          }}
        >
          Text Martine &middot; Claim $25
        </a>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
            @keyframes textMullyMarquee {
              from { transform: translate3d(0, 0, 0); }
              to   { transform: translate3d(-50%, 0, 0); }
            }
            @media (prefers-reduced-motion: reduce) {
              [style*="textMullyMarquee"] { animation: none !important; }
            }
          `,
        }}
      />
      <script dangerouslySetInnerHTML={{ __html: bootstrap }} />
    </main>
  );
}
