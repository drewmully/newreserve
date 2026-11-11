import type { Metadata } from "next";

// Keep the login screen out of search results while still letting crawlers
// follow its links.
export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
