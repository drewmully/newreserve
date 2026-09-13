"use client";

import { useEffect } from "react";
import { trackEvent } from "@/lib/tracking";

const SOURCES = new Set(["x", "meta", "google", "email"]);
const DEFAULT_SOURCE = "email";

function getSource(): string {
  const source = new URLSearchParams(window.location.search).get("src")?.toLowerCase();
  return source && SOURCES.has(source) ? source : DEFAULT_SOURCE;
}

export default function TextMullyAnalytics() {
  useEffect(() => {
    const source = getSource();
    void trackEvent(
      "lp_text_mully_view",
      { properties: { src: source } },
      { includeAuth: false }
    ).catch(() => undefined);

    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>("[data-sms-link]"));
    const onCompletedActivation = () => {
      void trackEvent(
        "sms_click",
        { properties: { src: source } },
        { includeAuth: false, navigation: true }
      ).catch(() => undefined);
    };

    for (const link of links) link.addEventListener("click", onCompletedActivation);
    return () => {
      for (const link of links) link.removeEventListener("click", onCompletedActivation);
    };
  }, []);

  return null;
}
