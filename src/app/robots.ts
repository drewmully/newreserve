/** /robots.txt (SEO recovery s05). */
import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/api/", "/account", "/ops", "/dashboard", "/lp/stylegame", "/home-lab", "/maintenance", "/handoff"],
    },
    sitemap: "https://www.mymully.com/sitemap.xml",
    host: "https://www.mymully.com",
  };
}
