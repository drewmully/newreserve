"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { trackEvent } from "@/lib/tracking";

export function PageViewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lastTrackedUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const query = searchParams.toString();
    const path = pathname || "/";
    const url = query ? `${path}?${query}` : path;

    if (lastTrackedUrlRef.current === url) return;
    lastTrackedUrlRef.current = url;

    void trackEvent("page_view", {
      properties: {
        path,
        query: query || undefined,
      },
    });
  }, [pathname, searchParams]);

  return null;
}
