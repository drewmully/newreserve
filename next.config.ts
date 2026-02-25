import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
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
