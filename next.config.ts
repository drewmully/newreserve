import type { NextConfig } from "next";
// Old Shopify-era URLs (blog, /pages, /collections, /policies) mapped to live
// pages. Source: mully/mully-seo-geo/redirect-map.csv (SEO recovery s01, s02).
import legacyRedirects from "./src/lib/legacyRedirects.json";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
  // Keep OAuth popup flows (Firebase Google sign-in) functional.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "Cross-Origin-Resource-Policy", value: "same-site" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // Phase 1a: serve the authored Style Game HTML as a static asset. This avoids
  // React hydration altering the quiz's self-contained inline scripts.
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/lp/stylegame",
          destination: "/lp/stylegame/index.html",
        },
      ],
    };
  },
  // Shopify-generated links (Google Shopping feed, Shop app, email product
  // blocks) point at /products/<handle> and /collections/<handle>. The old
  // theme forwards those to this domain, so send them to the headless pages.
  async redirects() {
    return [
      // s03: old Shopify Markets locale paths (/en-gb/..., /en-au/...) drop the locale.
      { source: "/:locale(en-[a-z]{2})", destination: "/", permanent: true },
      { source: "/:locale(en-[a-z]{2})/products/:handle", destination: "/shop/:handle", permanent: true },
      { source: "/:locale(en-[a-z]{2})/:path*", destination: "/:path*", permanent: true },
      // s01 + s02: exact legacy URLs, above the generic /collections rule.
      ...legacyRedirects.map((r) => ({ ...r, permanent: true })),
      { source: "/blogs/news", destination: "/blog", permanent: true },
      { source: "/blogs/news/tagged/:tag*", destination: "/blog", permanent: true },
      { source: "/products/:handle", destination: "/shop/:handle", permanent: true },
      { source: "/collections/all", destination: "/shop", permanent: true },
      { source: "/collections/:handle/products/:product", destination: "/shop/:product", permanent: true },
      { source: "/collections/:handle", destination: "/shop/collection/:handle", permanent: true },
    ];
  },
  async headers() {
    return [
      {
        // Keep the document fresh while the static game is iterated in preview.
        source: "/lp/stylegame/index.html",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=60",
          },
        ],
      },
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        // Shopify CDN — product images, collection images, file uploads
        protocol: "https",
        hostname: "cdn.shopify.com",
        pathname: "/**",
      },
      {
        // Store-specific CDN subdomain (e.g. cdn.shopify.com mirrors via store domain)
        protocol: "https",
        hostname: "*.myshopify.com",
        pathname: "/**",
      },
      {
        // Amazon product-image CDN — used by the Mully 100 (affiliate feed).
        protocol: "https",
        hostname: "m.media-amazon.com",
        pathname: "/images/**",
      },
      {
        // Amazon legacy image host, occasionally returned by product APIs.
        protocol: "https",
        hostname: "images-na.ssl-images-amazon.com",
        pathname: "/images/**",
      },
      // ─── Destination hero photography hosts ────────────────────
      {
        protocol: "https",
        hostname: "evanschillerphotography.com",
        pathname: "/cdn/shop/**",
      },
      {
        protocol: "https",
        hostname: "kiawahresort.com",
        pathname: "/wp-content/**",
      },
      {
        protocol: "https",
        hostname: "cdn-ilbbpdb.nitrocdn.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "www.haversham.com",
        pathname: "/wp-content/**",
      },
      {
        // Unsplash — editorial interstitial cards on /shop collection pages.
        protocol: "https",
        hostname: "images.unsplash.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "source.unsplash.com",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
