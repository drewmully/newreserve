import type { Metadata } from "next";
import { Suspense } from "react";
import Script from "next/script";
import { FlagValues } from "flags/react";
import { heroHeadline, heroCta } from "../flags";
import { Providers } from "./context/Providers";
import { PostHogFlagSync } from "./components/PostHogFlagSync";
import "./globals.css";

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
