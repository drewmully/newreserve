import type { Metadata } from "next";
import { Providers } from "./context/Providers";
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

export default function RootLayout({
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
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
