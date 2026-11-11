"use client";

/**
 * Client side of blog commerce v1: resolves the `blog-commerce-v1` PostHog
 * variant, reveals the matching blocks and records exposure, view and click
 * events. Reuses the posthog-js instance initialised in
 * src/instrumentation-client.ts.
 *
 * Server HTML always renders the control state (test blocks carry `hidden`),
 * so no flicker for control and a blank, safe fallback when PostHog is
 * blocked, slow or missing: control stays on screen and nothing is tracked.
 *
 * QA override: ?bc=test or ?bc=control (kept for the browser tab session),
 * ?bc=off clears it. Override events carry bc_override: true.
 */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import posthog from "posthog-js";
import {
  BLOG_COMMERCE_FLAG,
  type BlogCommerceBlock,
  type BlogCommerceTemplate,
  type BlogCommerceVariant,
} from "@/lib/blogCommerce";

const OVERRIDE_KEY = "mully_bc_override";
const FLAG_TIMEOUT_MS = 3000;

interface State {
  slug: string;
  template: BlogCommerceTemplate;
  /** Displayed variant. Control until a decision is made. */
  variant: BlogCommerceVariant;
  /** True once the variant came from the flag or the override. */
  resolved: boolean;
  override: boolean;
}

const Ctx = createContext<State | null>(null);

function readOverride(): BlogCommerceVariant | null {
  try {
    const q = new URLSearchParams(window.location.search).get("bc");
    if (q === "off") sessionStorage.removeItem(OVERRIDE_KEY);
    if (q === "test" || q === "control") {
      sessionStorage.setItem(OVERRIDE_KEY, q);
      return q;
    }
    const s = sessionStorage.getItem(OVERRIDE_KEY);
    return s === "test" || s === "control" ? s : null;
  } catch {
    return null;
  }
}

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
  const [state, setState] = useState<State>({ slug, template, variant: "control", resolved: false, override: false });

  useEffect(() => {
    let settled = false;
    const settle = (variant: BlogCommerceVariant, override: boolean) => {
      if (settled) return;
      settled = true;
      setState({ slug, template, variant, resolved: true, override });
      capture("blog_commerce_exposure", { slug, variant, template, ...(override ? { bc_override: true } : {}) });
    };

    const forced = readOverride();
    if (forced) {
      settle(forced, true);
      return;
    }
    if (!posthog.__loaded) return; // No PostHog: control, untracked.

    const timer = window.setTimeout(() => { settled = true; }, FLAG_TIMEOUT_MS);
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = posthog.onFeatureFlags(() => {
        if (settled) return;
        window.clearTimeout(timer);
        const value = posthog.getFeatureFlag(BLOG_COMMERCE_FLAG);
        if (value === "test" || value === "control") settle(value, false);
        else settled = true; // Flag missing or off: control, untracked.
      });
    } catch {
      settled = true;
    }
    return () => {
      window.clearTimeout(timer);
      unsubscribe?.();
    };
  }, [slug, template]);

  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

function eventBase(slug: string, variant: BlogCommerceVariant, template: BlogCommerceTemplate, block: BlogCommerceBlock, override: boolean) {
  return { slug, variant, template, block, ...(override ? { bc_override: true } : {}) };
}

function shopHandle(path: string): string | undefined {
  const m = path.match(/^\/shop\/([a-z0-9][a-z0-9-]*)$/);
  return m && m[1] !== "collection" ? m[1] : undefined;
}

/**
 * Shows its children only for one variant. Server render matches control.
 * When shown and resolved, records `blog_cta_viewed` once (50% visible) and
 * `blog_cta_clicked` for every link inside.
 */
export function BlogCommerceSlot({
  show,
  block,
  targetPath,
  productHandles,
  className,
  children,
}: {
  show: BlogCommerceVariant;
  block: BlogCommerceBlock;
  targetPath: string;
  productHandles?: string[];
  className?: string;
  children: ReactNode;
}) {
  const ctx = useContext(Ctx);
  const ref = useRef<HTMLDivElement>(null);
  const visible = (ctx?.variant ?? "control") === show;
  const tracked = Boolean(ctx?.resolved && visible);
  const slug = ctx?.slug ?? "";
  const variant = ctx?.variant ?? "control";
  const template = ctx?.template ?? "blog";
  const override = Boolean(ctx?.override);
  const handlesKey = productHandles?.join(",") ?? "";

  useEffect(() => {
    const el = ref.current;
    if (!tracked || !el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some(e => e.isIntersecting)) return;
      io.disconnect();
      capture("blog_cta_viewed", {
        ...eventBase(slug, variant, template, block, override),
        target_path: targetPath,
        ...(handlesKey ? { product_handles: handlesKey.split(",") } : {}),
      });
    }, { threshold: 0.5 });
    io.observe(el);
    return () => io.disconnect();
  }, [tracked, slug, variant, template, block, override, targetPath, handlesKey]);

  const onClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!tracked) return;
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    let path = targetPath;
    try { path = new URL(a.href, window.location.href).pathname; } catch { /* keep default */ }
    const handle = shopHandle(path);
    capture("blog_cta_clicked", {
      ...eventBase(slug, variant, template, block, override),
      target_path: path,
      ...(handle ? { product_handle: handle } : {}),
    });
  };

  return (
    <div ref={ref} hidden={!visible} className={className} data-bc-block={block} data-bc-show={show} onClickCapture={onClickCapture}>
      {children}
    </div>
  );
}
