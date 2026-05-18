import type { Metadata } from "next";
import { Suspense } from "react";
import Script from "next/script";
import { FlagValues } from "flags/react";
import { heroHeadline, heroCta } from "../flags";
import { Providers } from "./context/Providers";
import { PostHogFlagSync } from "./components/PostHogFlagSync";
import "./globals.css";

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
        <Providers>{children}</Providers>
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
