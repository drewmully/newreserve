/**
 * Event-backbone alerting.
 *
 * The durable record is the `public.backbone_alert` row, and it is always
 * written first. Slack delivery is best-effort on top of it: if there is no
 * channel configured, or Slack is down, the alert still exists and still shows
 * up in /api/admin/events/alerts.
 *
 * raiseAlert never throws. An alert failing must not fail the event that
 * raised it.
 */

import { getSupabaseService } from "@/app/api/_lib/supabaseService";

export type AlertKind =
  | "customer_created"
  | "identity_linked"
  | "unresolvable_event"
  | "unknown_topic"
  | "verification_failed"
  | "reconciler_gap";

export type AlertSeverity = "info" | "warning" | "critical";

export interface RaiseAlertInput {
  kind: AlertKind;
  severity: AlertSeverity;
  summary: string;
  customerId?: number | string | null;
  inboundEventId?: number | null;
  detail?: Record<string, unknown> | null;
}

const NO_CHANNEL = "no channel configured";

/**
 * Posts to Slack. The repo's only existing Slack call (outings/submit) uses a
 * bot token against chat.postMessage; an incoming-webhook URL is the simpler
 * option for alerting, so both are supported and the webhook wins if set.
 *
 * Returns null on success, or the reason delivery did not happen.
 */
async function deliverToSlack(text: string): Promise<string | null> {
  const webhook = process.env.SLACK_ALERT_WEBHOOK_URL;
  const botToken = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_ALERT_CHANNEL;

  try {
    if (webhook) {
      const res = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      return res.ok ? null : `slack webhook ${res.status}`;
    }

    if (botToken && channel) {
      const res = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${botToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ channel, text }),
      });
      return res.ok ? null : `slack api ${res.status}`;
    }
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }

  return NO_CHANNEL;
}

export async function raiseAlert(input: RaiseAlertInput): Promise<void> {
  const customerId =
    input.customerId === null || input.customerId === undefined
      ? null
      : String(input.customerId);

  let alertId: number | null = null;

  try {
    const sb = getSupabaseService();
    const { data, error } = await sb
      .from("backbone_alert")
      .insert({
        kind: input.kind,
        severity: input.severity,
        customer_id: customerId,
        inbound_event_id: input.inboundEventId ?? null,
        summary: input.summary,
        detail: input.detail ?? null,
      })
      .select("id")
      .single();

    if (error) {
      console.error("[events/alert] failed to persist alert:", error.message);
    } else {
      alertId = (data as { id: number } | null)?.id ?? null;
    }
  } catch (err) {
    console.error("[events/alert] failed to persist alert:", err);
  }

  const deliveryError = await deliverToSlack(
    `[event-backbone] ${input.severity.toUpperCase()} ${input.kind}: ${input.summary}`,
  );

  if (alertId === null) return;

  try {
    const sb = getSupabaseService();
    await sb
      .from("backbone_alert")
      .update(
        deliveryError === null
          ? { delivered_at: new Date().toISOString(), delivery_error: null }
          : { delivery_error: deliveryError },
      )
      .eq("id", alertId);
  } catch (err) {
    console.error("[events/alert] failed to record alert delivery:", err);
  }
}
