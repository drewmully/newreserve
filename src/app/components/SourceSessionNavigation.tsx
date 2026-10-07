"use client";
import { Suspense, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { recordSourceSessionNavigation } from "@/lib/analytics/journeySourceSessionClient";
function Navigation() {
  const path = usePathname(), search = useSearchParams();
  useEffect(() => { if (path) void recordSourceSessionNavigation(); }, [path, search]);
  return null;
}
export function SourceSessionNavigation() { return <Suspense fallback={null}><Navigation /></Suspense>; }
