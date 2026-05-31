import type { Metadata } from "next";
import { Suspense } from "react";
import Script from "next/script";
import { FlagValues } from "flags/react";
import { heroHeadline, heroCta } from "../flags";
import { Providers } from "./context/Providers";
import { PostHogFlagSync } from "./components/PostHogFlagSync";
import { AnalyticsTracker } from "./components/AnalyticsTracker";
import "./globals.css";

/**
 * Renders the Meta Pixel (fbevents.js) only when NEXT_PUBLIC_META_PIXEL_ID
 * is configured. The pixel is what creates the _fbp first-party cookie that
 * Meta CAPI's server-side events (fired from /api/_lib/analytics.ts) use as
 * a high-quality browser-identity match key. Without it, Meta event match
 * quality is ~30% (hashed email/IP only) vs ~80% with fbp+fbc.
 *
 * It also fires a client-side PageView on every page load, which builds
 * the same retargeting audiences that CAPI alone cannot populate.
 */
function MetaPixel() {
  const pixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID;
  if (!pixelId) return null;

  return (
    <Script
      id="meta-pixel"
      strategy="afterInteractive"
      dangerouslySetInnerHTML={{
        __html: `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${pixelId}');fbq('track','PageView');`,
      }}
    />
  );
}

/**
 * Renders the Google tag (gtag.js) only when at least one Google property
 * is configured. The same tag handles GA4 hits and Google Ads remarketing.
 */
function GoogleTag() {
  const ga4Id = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
  const adsId = process.env.NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_ID;
  const primaryId = ga4Id ?? adsId;
  if (!primaryId) return null;

  const configCalls: string[] = [];
  if (ga4Id) configCalls.push(`gtag('config', '${ga4Id}');`);
  if (adsId) configCalls.push(`gtag('config', '${adsId}');`);

  return (
    <>
      <Script
        id="gtag-src"
        strategy="afterInteractive"
        src={`https://www.googletagmanager.com/gtag/js?id=${primaryId}`}
      />
      <Script
        id="gtag-init"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
window.gtag = gtag;
gtag('js', new Date());
${configCalls.join("\n")}`,
        }}
      />
    </>
  );
}

export const metadata: Metadata = {
  title: "Mully Reserve | Progress, Earned.",
  description:
    "Members-only access to curated partner benefits, reserve pricing, and private club eligibility. Built for players who care.",
  icons: {
    icon: "/favicon.svg",
  },
  openGraph: {
    title: "Mully Reserve | Progress, Earned.",
    description:
      "Members-only access to curated partner benefits, reserve pricing, and private club eligibility.",
    siteName: "Mully Reserve",
    type: "website",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=Playfair+Display:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">
        {/* X / Twitter conversion tracking base pixel */}
        <Script
          id="x-pixel"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `!function(e,t,n,s,u,a){e.twq||(s=e.twq=function(){s.exe?s.exe.apply(s,arguments):s.queue.push(arguments);},s.version='1.1',s.queue=[],u=t.createElement(n),u.async=!0,u.src='https://static.ads-twitter.com/uwt.js',a=t.getElementsByTagName(n)[0],a.parentNode.insertBefore(u,a))}(window,document,'script');twq('config','od2vz');`,
          }}
        />
        {/*
          Google tag (gtag.js) — powers GA4 client-side hits and Google Ads
          remarketing audiences. Server-side GA4 / Google Ads pings still
          fire from /api/_lib/analytics.ts; this client tag is what builds
          audiences ("users who viewed /choose-plan but didn't convert") and
          captures gclid into the _gcl_aw cookie.

          Renders ONLY when NEXT_PUBLIC_GA_MEASUREMENT_ID or
          NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_ID is set, so this stays a no-op
          until you flip the env vars on in Vercel.
        */}
        <GoogleTag />
        {/*
          Meta Pixel (fbevents.js) — sets the _fbp first-party cookie that
          server-side Meta CAPI events use as a match key. Also fires a
          client-side PageView that builds retargeting audiences ("users who
          viewed /lp/subscription but didn't convert") which CAPI alone
          cannot populate.

          Renders ONLY when NEXT_PUBLIC_META_PIXEL_ID is set, so this stays
          a no-op until you flip the env var on in Vercel.
        */}
        <MetaPixel />
        {/*
          Junip Reviews — loads on every page. The script is named
          `junip_shopify.js` for legacy reasons but supports custom
          (non-Shopify) storefronts via the store-key element below.
          See: https://help.junip.co/en/articles/4607115-custom-html-installation
        */}
        <Script
          id="junip-widgets"
          strategy="afterInteractive"
          src="https://widgets.juniphq.com/v1/junip_shopify.js"
        />
        <span
          className="junip-store-key"
          data-store-key="e53iArcVeJvmee1SUQTErjCM"
          aria-hidden="true"
          style={{ display: "none" }}
        />
        <Providers>{children}</Providers>
        <AnalyticsTracker />
        <Suspense fallback={null}>
          <FlagValuesWithTracking />
        </Suspense>
      </body>
    </html>
  );
}

async function FlagValuesWithTracking() {
  const [headlineValue, ctaValue] = await Promise.all([
    heroHeadline(),
    heroCta(),
  ]);
  const flagMap = {
    "hero-headline": headlineValue,
    "hero-cta": ctaValue,
  };
  return (
    <>
      <FlagValues values={flagMap} />
      <PostHogFlagSync flags={flagMap} />
    </>
  );
}
