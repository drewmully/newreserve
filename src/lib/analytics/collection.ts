export type Journey = "reserve" | "style_game" | "text_mully";
const steps: Record<Journey, ReadonlySet<string>> = {
  reserve: new Set(["started", "reveal", "checkout"]),
  style_game: new Set(["started", "completed", "checkout"]),
  text_mully: new Set(["started", "activated", "checkout"]),
};
export type CollectionEvent = {
  event: string; properties: {
    $insert_id: string; $session_id: string; journey: Journey; step: string; collection_version: "lean-v1";
  };
};
/** Browser-safe allowlist. Deliberately has no email, phone, messages, URLs or profile fields. */
export function collectionEvent(input: {
  journey: Journey; step: string; eventId: string; sessionId: string; analyticsPermitted: boolean;
}): CollectionEvent | null {
  if (!input.analyticsPermitted) return null;
  if (!steps[input.journey]?.has(input.step) ||
      !/^[a-f0-9-]{32,64}$/i.test(input.eventId) || !/^[a-f0-9-]{32,64}$/i.test(input.sessionId)) throw new Error("invalid_collection_context");
  return {
    event: `lean_${input.journey}_${input.step}`,
    properties: { $insert_id: input.eventId, $session_id: input.sessionId,
      journey: input.journey, step: input.step, collection_version: "lean-v1" },
  };
}
/** Tracking is auxiliary: no exception or timeout is allowed to abort checkout/SMS. */
export async function safeCapture(event: CollectionEvent | null,
  capture: (event: CollectionEvent) => Promise<void>, timeoutMs = 500): Promise<boolean> {
  if (!event) return false;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2000) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => capture(event)).then(() => true).catch(() => false),
      new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}
