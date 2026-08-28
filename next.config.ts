import type { NextConfig } from "next";

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
    ],
  },
};

export default nextConfig;
