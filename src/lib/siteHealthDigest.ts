/**
 * Site-health weekly digest — pure functions (no I/O) so they're unit-testable.
 *
 * - filterFindingsForDigest: which findings warrant a PDF attachment
 *   (P0/P1 always; P2 only if first_seen_at is inside the window)
 * - renderDigestHtml / renderDigestText: the email body
 * - buildFindingPdf: a single-finding PDF using pdf-lib (no Chromium)
 */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { SiteHealthFinding, Severity } from "@/lib/siteHealth";

export interface DigestWindow {
  startMs: number;
  endMs: number;
  startLabel: string;
  endLabel: string;
}

export function filterFindingsForDigest(
  findings: SiteHealthFinding[],
  window: DigestWindow
): { withPdf: SiteHealthFinding[]; bullets: SiteHealthFinding[] } {
  const withPdf: SiteHealthFinding[] = [];
  const bullets: SiteHealthFinding[] = [];
  for (const f of findings) {
    const newThisWeek = f.first_seen_at >= window.startMs && f.first_seen_at < window.endMs;
    if (f.severity === "P0" || f.severity === "P1" || newThisWeek) {
      withPdf.push(f);
    } else {
      bullets.push(f);
    }
  }
  // Sort: P0 → P1 → P2, then most-recent first.
  const sevWeight: Record<Severity, number> = { P0: 0, P1: 1, P2: 2 };
  withPdf.sort((a, b) => sevWeight[a.severity] - sevWeight[b.severity] || b.last_seen_at - a.last_seen_at);
  bullets.sort((a, b) => sevWeight[a.severity] - sevWeight[b.severity] || b.last_seen_at - a.last_seen_at);
  return { withPdf, bullets };
}

export function summarizeBySeverity(findings: SiteHealthFinding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { P0: 0, P1: 0, P2: 0 };
  for (const f of findings) counts[f.severity] += 1;
  return counts;
}

export function summarizeByJourney(findings: SiteHealthFinding[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of findings) out[f.journey] = (out[f.journey] ?? 0) + 1;
  return out;
}

/* ─── Email body ──────────────────────────────────────────────────────── */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sevBadge(sev: Severity): string {
  const colors: Record<Severity, { bg: string; fg: string }> = {
    P0: { bg: "#7f1d1d", fg: "#fff" },
    P1: { bg: "#b45309", fg: "#fff" },
    P2: { bg: "#374151", fg: "#fff" },
  };
  const c = colors[sev];
  return `<span style="display:inline-block;padding:2px 8px;border-radius:9999px;background:${c.bg};color:${c.fg};font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;">${sev}</span>`;
}

export interface DigestRenderInput {
  window: DigestWindow;
  findings: SiteHealthFinding[];
  withPdf: SiteHealthFinding[];
  bullets: SiteHealthFinding[];
  baseUrl: string;
}

export function renderDigestHtml(input: DigestRenderInput): string {
  const { window, findings, withPdf, bullets, baseUrl } = input;
  const sev = summarizeBySeverity(findings);

  const findingHtml = withPdf
    .map((f) => {
      const link = `${baseUrl}/admin/site-health/finding/${encodeURIComponent(f.id)}`;
      return `
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid #e5e7eb;">
            <div style="margin-bottom:6px;">
              ${sevBadge(f.severity)}
              <span style="color:#6b7280;font-size:12px;margin-left:8px;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(f.journey)} · ${escapeHtml(f.source)}</span>
            </div>
            <div style="font-weight:600;color:#111827;font-size:15px;margin-bottom:4px;">${escapeHtml(f.title)}</div>
            <div style="color:#374151;font-size:13px;line-height:1.5;margin-bottom:6px;">${escapeHtml(f.description)}</div>
            ${f.suggested_fix ? `<div style="color:#065f46;font-size:12px;font-style:italic;margin-bottom:6px;">Suggested fix: ${escapeHtml(f.suggested_fix)}</div>` : ""}
            <div style="font-size:11px;color:#9ca3af;">
              Seen ${f.occurrence_count}× · <a href="${escapeHtml(link)}" style="color:#065f46;">View in admin</a> · PDF attached: ${escapeHtml(pdfFilename(f))}
            </div>
          </td>
        </tr>`;
    })
    .join("");

  const bulletHtml = bullets.length
    ? `<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;">
         <div style="font-size:13px;font-weight:600;color:#374151;margin-bottom:8px;">Recurring cosmetic issues (no PDF)</div>
         <ul style="margin:0;padding-left:18px;color:#6b7280;font-size:12px;line-height:1.7;">
           ${bullets.map((f) => `<li>${sevBadge(f.severity)} ${escapeHtml(f.title)} <span style="color:#9ca3af;">(${escapeHtml(f.journey)}, ${f.occurrence_count}×)</span></li>`).join("")}
         </ul>
       </div>`
    : "";

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Site-health digest</title></head>
<body style="font-family:Georgia,serif;background:#f9fafb;margin:0;padding:32px 16px;color:#111827;">
  <div style="max-width:640px;margin:0 auto;background:#fff;padding:32px;border-radius:12px;">
    <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#065f46;font-weight:600;margin-bottom:4px;">Mully · Site Health</div>
    <h1 style="font-family:Georgia,serif;font-size:24px;margin:0 0 4px 0;color:#111827;">Weekly digest</h1>
    <div style="color:#6b7280;font-size:13px;margin-bottom:24px;">${escapeHtml(window.startLabel)} → ${escapeHtml(window.endLabel)}</div>

    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
      <tr>
        <td style="width:33%;padding:12px;background:#fef2f2;border-radius:8px;text-align:center;"><div style="font-size:28px;font-weight:700;color:#7f1d1d;">${sev.P0}</div><div style="font-size:11px;color:#7f1d1d;letter-spacing:0.08em;text-transform:uppercase;">Blocking</div></td>
        <td style="width:4px;"></td>
        <td style="width:33%;padding:12px;background:#fffbeb;border-radius:8px;text-align:center;"><div style="font-size:28px;font-weight:700;color:#b45309;">${sev.P1}</div><div style="font-size:11px;color:#b45309;letter-spacing:0.08em;text-transform:uppercase;">Confusing</div></td>
        <td style="width:4px;"></td>
        <td style="width:33%;padding:12px;background:#f3f4f6;border-radius:8px;text-align:center;"><div style="font-size:28px;font-weight:700;color:#374151;">${sev.P2}</div><div style="font-size:11px;color:#374151;letter-spacing:0.08em;text-transform:uppercase;">Cosmetic</div></td>
      </tr>
    </table>

    ${withPdf.length === 0 && bullets.length === 0
      ? `<div style="padding:24px;text-align:center;color:#6b7280;font-size:14px;background:#f9fafb;border-radius:8px;">No issues found this week. Quiet week — site looks healthy.</div>`
      : `<table style="width:100%;border-collapse:collapse;">${findingHtml}</table>${bulletHtml}`}

    <div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;text-align:center;color:#9ca3af;font-size:11px;">
      Generated by the site-health bot · <a href="${escapeHtml(baseUrl)}/admin/site-health" style="color:#065f46;">Open dashboard</a>
    </div>
  </div>
</body></html>`;
}

export function renderDigestText(input: DigestRenderInput): string {
  const { window, findings, withPdf, bullets } = input;
  const sev = summarizeBySeverity(findings);
  const lines: string[] = [];
  lines.push(`Mully site-health digest — ${window.startLabel} → ${window.endLabel}`);
  lines.push("");
  lines.push(`P0 blocking: ${sev.P0}  |  P1 confusing: ${sev.P1}  |  P2 cosmetic: ${sev.P2}`);
  lines.push("");
  if (withPdf.length === 0 && bullets.length === 0) {
    lines.push("No issues found this week.");
    return lines.join("\n");
  }
  for (const f of withPdf) {
    lines.push(`[${f.severity}] ${f.title}  (${f.journey} · ${f.source} · seen ${f.occurrence_count}×)`);
    lines.push(`    ${f.description}`);
    if (f.suggested_fix) lines.push(`    Suggested fix: ${f.suggested_fix}`);
    lines.push(`    PDF attached: ${pdfFilename(f)}`);
    lines.push("");
  }
  if (bullets.length) {
    lines.push("Recurring cosmetic issues (no PDF):");
    for (const f of bullets) lines.push(`  - [${f.severity}] ${f.title}  (${f.journey}, ${f.occurrence_count}×)`);
  }
  return lines.join("\n");
}

/* ─── PDF generation ──────────────────────────────────────────────────── */

export function pdfFilename(f: SiteHealthFinding): string {
  const safeTitle = f.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  return `${f.date}_${f.severity}_${f.journey}_${safeTitle || f.id}.pdf`;
}

export async function buildFindingPdf(f: SiteHealthFinding): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]); // US Letter
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const margin = 48;
  let y = 792 - margin;

  const sevColor: Record<Severity, [number, number, number]> = {
    P0: [0.5, 0.05, 0.05],
    P1: [0.7, 0.4, 0.05],
    P2: [0.2, 0.25, 0.3],
  };
  const [sr, sg, sb] = sevColor[f.severity];

  // Header bar
  page.drawRectangle({ x: 0, y: 792 - 8, width: 612, height: 8, color: rgb(sr, sg, sb) });

  // Eyebrow
  page.drawText("MULLY · SITE HEALTH FINDING", {
    x: margin,
    y,
    size: 9,
    font: bold,
    color: rgb(0.4, 0.4, 0.4),
  });
  y -= 24;

  // Severity badge + journey
  page.drawText(`${f.severity} · ${f.journey.toUpperCase()} · ${f.source}`, {
    x: margin,
    y,
    size: 11,
    font: bold,
    color: rgb(sr, sg, sb),
  });
  y -= 22;

  // Title (wrap manually at 80 char)
  for (const line of wrapText(f.title, 70)) {
    page.drawText(line, { x: margin, y, size: 18, font: bold, color: rgb(0.07, 0.09, 0.15) });
    y -= 24;
  }
  y -= 6;

  // Meta line
  const meta = `First seen ${formatDate(f.first_seen_at)} · Last seen ${formatDate(f.last_seen_at)} · Occurrences ${f.occurrence_count} · Status ${f.status}`;
  page.drawText(meta, { x: margin, y, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
  y -= 22;

  // URL
  drawSection(page, font, bold, "URL", f.evidence.url, margin, y);
  y -= measureSectionHeight(f.evidence.url, 90, 4);

  // Description
  drawSection(page, font, bold, "What we saw", f.description, margin, y);
  y -= measureSectionHeight(f.description, 90, 4);

  if (f.suggested_fix) {
    drawSection(page, font, bold, "Suggested fix", f.suggested_fix, margin, y);
    y -= measureSectionHeight(f.suggested_fix, 90, 4);
  }

  if (f.evidence.console_excerpt) {
    drawSection(page, font, bold, "Console errors", f.evidence.console_excerpt, margin, y);
    y -= measureSectionHeight(f.evidence.console_excerpt, 90, 4);
  }

  if (f.evidence.network_excerpt) {
    drawSection(page, font, bold, "Network errors", f.evidence.network_excerpt, margin, y);
    y -= measureSectionHeight(f.evidence.network_excerpt, 90, 4);
  }

  if (f.evidence.stack_excerpt) {
    drawSection(page, font, bold, "Stack trace", f.evidence.stack_excerpt, margin, y);
    y -= measureSectionHeight(f.evidence.stack_excerpt, 90, 4);
  }

  // Footer
  page.drawText(`Finding ${f.id} · generated ${new Date().toISOString()}`, {
    x: margin,
    y: margin / 2,
    size: 8,
    font,
    color: rgb(0.55, 0.55, 0.55),
  });

  return pdf.save();
}

function drawSection(
  page: import("pdf-lib").PDFPage,
  font: import("pdf-lib").PDFFont,
  bold: import("pdf-lib").PDFFont,
  label: string,
  body: string,
  x: number,
  startY: number
): void {
  page.drawText(label.toUpperCase(), {
    x,
    y: startY,
    size: 8,
    font: bold,
    color: rgb(0.4, 0.4, 0.4),
  });
  let y = startY - 13;
  for (const line of wrapText(body, 90)) {
    page.drawText(line, { x, y, size: 10, font, color: rgb(0.13, 0.15, 0.2) });
    y -= 13;
  }
}

function measureSectionHeight(body: string, wrapAt: number, padBelow: number): number {
  return 13 + wrapText(body, wrapAt).length * 13 + padBelow + 8;
}

/** Greedy word-wrap (no kerning awareness — fine for monospaced-ish copy). */
function wrapText(text: string, maxChars: number): string[] {
  const out: string[] = [];
  // Normalize whitespace but preserve intentional newlines.
  const lines = text.split(/\r?\n/);
  for (const para of lines) {
    if (para.length <= maxChars) {
      out.push(para);
      continue;
    }
    const words = para.split(/\s+/);
    let cur = "";
    for (const w of words) {
      if ((cur + " " + w).trim().length > maxChars) {
        if (cur) out.push(cur);
        cur = w.length > maxChars ? w.slice(0, maxChars) : w;
      } else {
        cur = cur ? `${cur} ${w}` : w;
      }
    }
    if (cur) out.push(cur);
  }
  // Cap pages of evidence — no single section should explode the layout.
  return out.slice(0, 60);
}

function formatDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
}
