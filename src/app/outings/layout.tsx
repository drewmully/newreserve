import type { Metadata } from "next";
import "./outings.css";

export const metadata: Metadata = {
  title: "Mully | Premium Curated Gift Boxes for Golf Outings",
  description:
    "Elevate your golf outing with premium, personalized gift boxes. Curated accessories, gourmet treats, and custom branding for unforgettable events.",
  keywords: [
    "golf outing gifts",
    "corporate golf event",
    "curated gift boxes",
    "golf tournament gifts",
    "premium golf accessories",
  ],
};

export default function OutingsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <div className="outings-page grain-overlay">{children}</div>;
}
