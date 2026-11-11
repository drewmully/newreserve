"use client";

/**
 * Client side of blog commerce: records `blog_cta_viewed` (once, at 50%
 * visible) and `blog_cta_clicked` for the server-rendered commerce blocks.
 * Reuses the posthog-js instance initialised in src/instrumentation-client.ts.
 *
 * The blocks are the default for every reader and render on the server, so
 * crawlers and no-JS visitors see them too. Tracking is best effort: if
 * PostHog is missing or blocked, nothing is sent and the page is unchanged.
 */
import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import posthog from "posthog-js";
import {
  BLOG_COMMERCE_VARIANT,
  type BlogCommerceBlock,
  type BlogCommerceTemplate,
} from "@/lib/blogCommerce";

interface State {
  slug: string;
  template: BlogCommerceTemplate;
}

const Ctx = createContext<State | null>(null);

function capture(event: string, props: Record<string, unknown>) {
  try {
    if (posthog.__loaded) posthog.capture(event, props, { transport: "sendBeacon" });
  } catch {
    // Tracking must never break the page.
  }
}

export function BlogCommerceProvider({
  slug,
  template,
  children,
}: {
  slug: string;
  template: BlogCommerceTemplate;
  children: ReactNode;
}) {
  return <Ctx.Provider value={{ slug, template }}>{children}</Ctx.Provider>;
}

function shopHandle(path: string): string | undefined {
  const m = path.match(/^\/shop\/([a-z0-9][a-z0-9-]*)$/);
  return m && m[1] !== "collection" ? m[1] : undefined;
}

/** Wraps one commerce block and tracks its views and clicks. */
export function BlogCommerceSlot({
  block,
  targetPath,
  productHandles,
  className,
  children,
}: {
  block: BlogCommerceBlock;
  targetPath: string;
  productHandles?: string[];
  className?: string;
  children: ReactNode;
}) {
  const ctx = useContext(Ctx);
  const ref = useRef<HTMLDivElement>(null);
  const slug = ctx?.slug ?? "";
  const template = ctx?.template ?? "blog";
  const handlesKey = productHandles?.join(",") ?? "";

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some(e => e.isIntersecting)) return;
      io.disconnect();
      capture("blog_cta_viewed", {
        slug, variant: BLOG_COMMERCE_VARIANT, template, block,
        target_path: targetPath,
        ...(handlesKey ? { product_handles: handlesKey.split(",") } : {}),
      });
    }, { threshold: 0.5 });
    io.observe(el);
    return () => io.disconnect();
  }, [slug, template, block, targetPath, handlesKey]);

  const onClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    let path = targetPath;
    try { path = new URL(a.href, window.location.href).pathname; } catch { /* keep default */ }
    const handle = shopHandle(path);
    capture("blog_cta_clicked", {
      slug, variant: BLOG_COMMERCE_VARIANT, template, block,
      target_path: path,
      ...(handle ? { product_handle: handle } : {}),
    });
  };

  return (
    <div ref={ref} className={className} data-bc-block={block} onClickCapture={onClickCapture}>
      {children}
    </div>
  );
}
