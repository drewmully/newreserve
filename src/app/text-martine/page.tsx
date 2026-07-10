/**
 * GET /text-martine
 *
 * Bridge page for Martine's reactivation email. Some email clients (Gmail
 * webmail in particular) strip or refuse to render `sms:` protocol links on
 * anchors, so the email links here instead. On mobile devices this page
 * immediately fires the SMS composer via `location.href`. On desktop it
 * renders a small landing card with the number, a copy button, and a
 * "Text me" button that still tries the sms: URI (works if the user has
 * iMessage on their Mac).
 *
 * We deliberately keep this a static, edge-cached page. No auth, no DB.
 */

export const dynamic = "force-static";
export const revalidate = 3600;

const NUMBER_DISPLAY = "949-329-9066";
const NUMBER_E164 = "+19493299066";
const BODY = "Hi Martine, I got your email and am interested in learning more!";
const SMS_HREF = `sms:${NUMBER_E164}?&body=${encodeURIComponent(BODY)}`;
// iOS/Android alternate delimiter that a few clients prefer
const SMS_HREF_ANDROID = `sms:${NUMBER_E164}?body=${encodeURIComponent(BODY)}`;

export const metadata = {
  title: "Text Martine — Mully",
  description: "Open a message to Martine with a note already started.",
  robots: { index: false, follow: false },
};

export default function TextMartinePage() {
  // The inline script picks the right sms: variant per platform and
  // immediately redirects on mobile. Desktop users see the card.
  const bootstrap = `
    (function(){
      try {
        var ua = navigator.userAgent || "";
        var isIOS = /iPhone|iPad|iPod/i.test(ua);
        var isAndroid = /Android/i.test(ua);
        var isMobile = isIOS || isAndroid || /Mobile|Silk/i.test(ua);
        var href = isAndroid
          ? ${JSON.stringify(SMS_HREF_ANDROID)}
          : ${JSON.stringify(SMS_HREF)};
        if (isMobile) {
          // Some in-app browsers block auto-redirect; give the anchor a moment
          window.location.href = href;
        }
        // Copy button
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

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#F4F1EC",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 16px",
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
          href={SMS_HREF}
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
      <script dangerouslySetInnerHTML={{ __html: bootstrap }} />
    </main>
  );
}
