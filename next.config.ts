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

const SHOPIFY_STORE = "https://mullybox-store.myshopify.com";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  async redirects() {
    return [
      // Shopify storefront routes that don't exist in this Next.js app
      { source: "/cart",              destination: `${SHOPIFY_STORE}/cart`,              permanent: false },
      { source: "/cart/:path*",       destination: `${SHOPIFY_STORE}/cart/:path*`,       permanent: false },
      { source: "/checkout",          destination: `${SHOPIFY_STORE}/checkout`,          permanent: false },
      { source: "/collections/:path*",destination: `${SHOPIFY_STORE}/collections/:path*`,permanent: false },
      { source: "/products/:path*",   destination: `${SHOPIFY_STORE}/products/:path*`,   permanent: false },
    ];
  },
  async headers() {
    return [
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
    ],
  },
};

export default nextConfig;
