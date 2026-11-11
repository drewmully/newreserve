/**
 * PostHog events for the Take a Shot popup, with one consistent property set:
 * { variant, trigger_type, page_kind, page_type, path, device, step } plus whatever the
 * caller adds. utm_source / utm_medium / utm_campaign (URL first, then stored
 * attribution) are added to every event by lib/tracking. No PII here.
 */
import { trackEvent } from "@/lib/tracking";
import { deviceFor, pageKindFor, pageTypeFor, productPageInDom, type TriggerType } from "./popupRules";

export const POPUP_VARIANT = "take-a-shot";

export function popupContext(trigger: TriggerType | null = null, step: string | null = null) {
  const fine = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer:fine)").matches;
  const path = typeof window !== "undefined" ? window.location.pathname : "";
  return {
    variant: POPUP_VARIANT,
    trigger_type: trigger,
    page_kind: pageKindFor(path, productPageInDom()),
    page_type: pageTypeFor(path, productPageInDom()),
    path,
    device: deviceFor(fine, typeof window !== "undefined" ? window.innerWidth : 0),
    step,
  };
}

export function trackPopup(name: string, trigger: TriggerType | null, step: string | null, extra: Record<string, unknown> = {}, email?: string) {
  // email goes to the payload (Meta CAPI matching, hashed server side), never into properties.
  void trackEvent(name, { ...(email ? { email } : {}), properties: { source: POPUP_VARIANT, ...popupContext(trigger, step), ...extra } }, { includeAuth: false });
}
