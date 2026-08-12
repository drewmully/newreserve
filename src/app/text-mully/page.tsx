/**
 * GET /text-mully
 *
 * Paid-media SMS bridge page. Same auto-open-iMessage pattern as
 * /text-martine, but source-aware via ?src=x|meta|google|email so the
 * pre-filled SMS body varies by channel, and with a rolling image
 * carousel of the Discover LP photography below the CTA card.
 *
 * The route stays static (edge-cached). The `src` param is read on the
 * client so the page HTML is one artifact; the pre-filled body and any
 * pixel event are chosen at runtime.
 *
 * Sticky bottom "Text Martine" CTA on mobile keeps the primary action
 * in viewport as the carousel scrolls, in case the auto-redirect is
 * blocked by an in-app browser.
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
  description: "Open a message to Martine with a note already started.",
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

        // Fire X Pixel event for paid-channel visits (pixel is initialized in layout)
        if (typeof window.twq === "function") {
          try {
            window.twq("event", "tw-od2vz-sms_visit", {
              contents: [{ content_id: src }],
              conversion_id: null,
              email_address: null,
            });
          } catch (_e) {}
        }

        // Auto-redirect on mobile
        if (isMobile) {
          setTimeout(function(){ window.location.href = href; }, 60);
        }

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
        padding: "40px 16px 120px", // extra bottom padding so sticky CTA doesn't cover content
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Helvetica, Arial, sans-serif",
        color: "#1A1A1A",
      }}
    >
      <div
        style={{
          maxWidth: 480,
          width: "100%",
          background: "#FFFFFF",
          borderRadius: 12,
          padding: "40px 32px",
          textAlign: "center",
          boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        }}
      >
        <img
          src="/team/martine-square.webp"
          width={96}
          height={96}
          alt="Martine"
          style={{
            width: 96,
            height: 96,
            borderRadius: "50%",
            display: "block",
            margin: "0 auto 20px",
          }}
        />
        <h1
          style={{
            fontFamily: 'Georgia, "Times New Roman", Times, serif',
            fontSize: 26,
            lineHeight: 1.2,
            margin: "0 0 12px 0",
            fontWeight: "normal",
          }}
        >
          Text Martine
        </h1>
        <p style={{ margin: "0 0 24px 0", fontSize: 15, color: "#4A4A4A", lineHeight: 1.55 }}>
          On your phone? Tap the button below and a message will open with a note
          already started.
        </p>

        <a
          data-sms-link
          href={`sms:${NUMBER_E164}?&body=${encodeURIComponent(BODIES[DEFAULT_SRC])}`}
          style={{
            display: "inline-block",
            background: "#1A1A1A",
            color: "#FFFFFF",
            textDecoration: "none",
            padding: "14px 28px",
            borderRadius: 999,
            fontSize: 15,
            fontWeight: 600,
            letterSpacing: "0.2px",
          }}
        >
          Text Martine
        </a>

        <div
          style={{
            marginTop: 28,
            paddingTop: 24,
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
          <p style={{ margin: "18px 0 0 0", fontSize: 12, color: "#8A8A8A" }}>
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
          Text Martine
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
