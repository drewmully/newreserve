"use client";

/**
 * Presentational view for /admin/email-funnel. Renders a FunnelReport from
 * /api/admin/email-funnel-live exactly as received; it computes nothing.
 */

import type { FunnelReport } from "@/lib/emailFunnel/build";
import { FUNNEL_WINDOWS, type FunnelWindow } from "@/lib/emailFunnel/config";

const LEAK_RED = "#B42318";

export function fmtCount(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : n.toLocaleString("en-US");
}

export function fmtPct(r: number | null | undefined): string {
  if (r === null || r === undefined) return "—";
  const p = r * 100;
  if (p === 0) return "0%";
  if (p < 1) return `${p.toFixed(2)}%`;
  if (p < 10) return `${p.toFixed(1)}%`;
  return `${Math.round(p)}%`;
}

export function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Log-scaled bar width so 13,000 visitors and 3 buyers both stay readable. */
function barWidth(count: number | null, max: number): number {
  if (!count || count <= 0 || max <= 0) return 0;
  return Math.max(2, (Math.log10(count + 1) / Math.log10(max + 1)) * 100);
}

const PHASE_COLOR: Record<string, string> = {
  Capture: "#6E8B74",
  Nourish: "#2a5239",
  Warm: "#1F3D2B",
  Convert: "#162b1e",
  Lifecycle: "#111111",
};

function SectionTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between mb-3">
      <h2 className="font-serif text-lg text-obsidian">{children}</h2>
      {aside ? <span className="text-xs text-charcoal/50">{aside}</span> : null}
    </div>
  );
}

function Funnel({ report }: { report: FunnelReport }) {
  const max = Math.max(...report.funnel.map((s) => s.count ?? 0));
  return (
    <div className="bg-white border border-taupe/30 rounded-lg p-5" data-testid="funnel">
      {report.funnel.map((s, i) => (
        <div key={s.key}>
          {i > 0 ? (
            <div className="flex items-center gap-2 pl-[7.75rem] sm:pl-[16.5rem] py-1 text-xs tabular-nums" data-testid={`rate-${s.key}`}>
              <span className="text-charcoal/40">↓</span>
              <span className={s.rateFromPrev === null ? "text-charcoal/40" : "text-forest font-medium"}>
                {fmtPct(s.rateFromPrev)}
              </span>
              {s.rateBase ? <span className="text-charcoal/40">of {s.rateBase.toLowerCase()}</span> : null}
            </div>
          ) : null}
          <div className="flex items-center gap-3" title={s.source}>
            <span className="hidden sm:block w-20 shrink-0 text-[10px] uppercase tracking-wider text-charcoal/50">{s.phase}</span>
            <span className="w-28 sm:w-40 shrink-0 text-sm text-obsidian">{s.label}</span>
            <div className="flex-1 h-7 bg-bone rounded relative overflow-hidden">
              <div
                className="h-full rounded"
                style={{ width: `${barWidth(s.count, max)}%`, background: PHASE_COLOR[s.phase] }}
              />
            </div>
            <span className="w-20 sm:w-24 shrink-0 text-right font-serif text-xl text-obsidian tabular-nums lining-nums" data-testid={`count-${s.key}`}>
              {s.count === null ? <span className="text-xs text-charcoal/40 font-sans">{s.note ?? "n/a"}</span> : fmtCount(s.count)}
            </span>
          </div>
        </div>
      ))}
      <p className="mt-4 text-xs text-charcoal/50">
        Each stage is a subset of the one above it. Signups who ordered at all: {fmtCount(report.signupsWithOrder)}; repeat
        or Reserve at all: {fmtCount(report.signupsWithRepeatOrReserve)}. Bar length is log scale.
      </p>
    </div>
  );
}

function Leaks({ report }: { report: FunnelReport }) {
  return (
    <ol className="bg-white border border-taupe/30 rounded-lg divide-y divide-taupe/20" data-testid="leaks">
      {report.leaks.length === 0 ? <li className="p-4 text-sm text-charcoal/50">No leaks in this window.</li> : null}
      {report.leaks.map((l, i) => (
        <li key={l.key} className="flex items-center gap-4 px-4 py-3">
          <span className="font-serif text-2xl tabular-nums lining-nums w-12 text-right" style={{ color: LEAK_RED }}>
            {fmtCount(l.lost)}
          </span>
          <span className="text-sm text-obsidian">
            <span className="text-charcoal/40 mr-2">{i + 1}.</span>
            {l.text}
          </span>
        </li>
      ))}
    </ol>
  );
}

const th = "text-left text-[10px] uppercase tracking-wider text-charcoal/50 font-normal px-3 py-2";
const td = "px-3 py-2 tabular-nums";

function SourcesTable({ report }: { report: FunnelReport }) {
  return (
    <div className="bg-white border border-taupe/30 rounded-lg overflow-x-auto">
      <table className="w-full text-sm" data-testid="sources">
        <thead className="border-b border-taupe/30">
          <tr>
            <th className={th}>Source</th>
            <th className={`${th} text-right`}>Signups</th>
            <th className={`${th} text-right`}>Email consent</th>
            <th className={th}>Routes to</th>
            <th className={`${th} text-right`}>Entered</th>
            <th className={`${th} text-right`}>No flow</th>
          </tr>
        </thead>
        <tbody>
          {report.sources.map((r) => (
            <tr
              key={r.source}
              className="border-b border-taupe/15 last:border-0"
              style={r.unrouted ? { background: "#FEF3F2", color: LEAK_RED } : undefined}
              data-unrouted={r.unrouted ? "true" : undefined}
            >
              <td className="px-3 py-2 font-medium">{r.source}</td>
              <td className={`${td} text-right`}>{fmtCount(r.signups)}</td>
              <td className={`${td} text-right`}>{fmtPct(r.emailConsentRate)}</td>
              <td className="px-3 py-2">{r.unrouted ? "No flow" : r.flows.join(", ")}</td>
              <td className={`${td} text-right`}>{fmtCount(r.entered)}</td>
              <td className={`${td} text-right font-medium`}>{fmtPct(r.noFlowShare)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FlowsTable({ report }: { report: FunnelReport }) {
  return (
    <div className="bg-white border border-taupe/30 rounded-lg overflow-x-auto">
      <table className="w-full text-sm" data-testid="flows">
        <thead className="border-b border-taupe/30">
          <tr>
            <th className={th}>Flow</th>
            <th className={th}>Stage</th>
            <th className={`${th} text-right`}>Recipients</th>
            <th className={`${th} text-right`}>Open</th>
            <th className={`${th} text-right`}>Click</th>
            <th className={`${th} text-right`}>Placed order</th>
            <th className={`${th} text-right`}>Revenue / recipient</th>
          </tr>
        </thead>
        <tbody>
          {report.flows.map((f) => {
            const idle = f.delivered === 0;
            return (
              <tr key={f.flowId} className={`border-b border-taupe/15 last:border-0 ${idle ? "text-charcoal/40" : ""}`} title={f.name}>
                <td className="px-3 py-2">
                  <span className="font-medium text-obsidian">{f.label}</span>
                  <span className="ml-2 text-xs text-charcoal/50">{shortName(f.name)}</span>
                  {f.status !== "live" ? <span className="ml-2 text-[10px] uppercase text-ember">{f.status}</span> : null}
                </td>
                <td className="px-3 py-2 text-xs">{f.stage}</td>
                <td className={`${td} text-right`}>{fmtCount(f.recipients)}</td>
                <td className={`${td} text-right`}>{idle ? "no sends" : fmtPct(f.openRate)}</td>
                <td className={`${td} text-right`}>{idle ? "" : fmtPct(f.clickRate)}</td>
                <td className={`${td} text-right`}>{idle ? "" : fmtPct(f.placedOrderRate)}</td>
                <td className={`${td} text-right`}>{idle ? "" : fmtMoney(f.revenuePerRecipient)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** "Mully | F1b | Website Welcome | POPUP SIGNUPS | 20261012" -> "Website Welcome · Popup Signups". */
export function shortName(name: string): string {
  const parts = name.split("|").map((p) => p.trim()).filter(Boolean);
  const keep = parts.filter((p) => !/^mully$/i.test(p) && !/^F\d+[a-z]?$/i.test(p) && !/^\d{8}$/.test(p) && !/draft|hold|and-fix|^v\d/i.test(p));
  return keep
    .map((p) => (p === p.toUpperCase() ? p.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : p))
    .join(" · ");
}

function PopupFunnel({ report }: { report: FunnelReport }) {
  const max = Math.max(1, ...report.popup.map((s) => s.count ?? 0));
  return (
    <div className="bg-white border border-taupe/30 rounded-lg p-5 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3" data-testid="popup">
      {report.popup.map((s, i) => (
        <div key={s.key} className="flex flex-col items-center text-center" title={s.source}>
          <div className="h-24 w-full flex items-end justify-center">
            <div
              className="w-10 rounded-t"
              style={{
                height: s.count ? `${Math.max(4, (s.count / max) * 100)}%` : "2px",
                background: s.count === null ? "#C8BFAF" : s.optional ? "#6E8B74" : "#1F3D2B",
              }}
            />
          </div>
          <span className="mt-2 font-serif text-lg tabular-nums lining-nums text-obsidian">
            {s.count === null ? <span className="text-xs font-sans text-charcoal/40">not tracked</span> : fmtCount(s.count)}
          </span>
          <span className="text-xs text-charcoal/60">
            {s.label}
            {s.optional ? <span className="block text-[10px] text-charcoal/40">optional</span> : null}
          </span>
          <span className="text-[11px] tabular-nums text-forest">{i === 0 ? " " : fmtPct(s.rateFromPrev)}</span>
        </div>
      ))}
    </div>
  );
}

export default function EmailFunnelView({
  report,
  window,
  onWindow,
  onRefresh,
  loading,
}: {
  report: FunnelReport;
  window: FunnelWindow;
  onWindow?: (w: FunnelWindow) => void;
  onRefresh?: () => void;
  loading?: boolean;
}) {
  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-8 text-charcoal">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl text-obsidian">Email funnel</h1>
          <p className="text-xs text-charcoal/50">
            MyMully · live from Klaviyo, PostHog and Shopify · {new Date(report.generatedAt).toLocaleString("en-US", { timeZone: "America/New_York" })} ET
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border border-taupe/40 bg-white overflow-hidden" role="group" aria-label="Window">
            {FUNNEL_WINDOWS.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => onWindow?.(w)}
                className={`px-3 py-1.5 text-sm ${w === window ? "bg-forest text-white" : "text-charcoal hover:bg-bone"}`}
                aria-pressed={w === window}
              >
                {w}d
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="px-3 py-1.5 text-sm rounded-md border border-taupe/40 bg-white hover:bg-bone disabled:opacity-50"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </header>

      {report.issues.length ? (
        <div className="rounded-md border px-4 py-2 text-xs" style={{ borderColor: LEAK_RED, color: LEAK_RED }} role="alert">
          {report.issues.map((i) => `${i.source}: ${i.what} unavailable (${i.error})`).join(" · ")}
        </div>
      ) : null}

      <section>
        <SectionTitle aside={`last ${window} days`}>Funnel</SectionTitle>
        <Funnel report={report} />
      </section>

      <section>
        <SectionTitle aside="ranked by people lost">Top leaks</SectionTitle>
        <Leaks report={report} />
      </section>

      <section>
        <SectionTitle aside="red = no welcome flow">Signup sources</SectionTitle>
        <SourcesTable report={report} />
      </section>

      <section>
        <SectionTitle aside="recipients summed across messages · rates per delivered email">Flows</SectionTitle>
        <FlowsTable report={report} />
      </section>

      <section>
        <SectionTitle aside="unique people per step">Take a Shot popup</SectionTitle>
        <PopupFunnel report={report} />
      </section>

      <details className="text-xs text-charcoal/60">
        <summary className="cursor-pointer">Coverage and source queries</summary>
        <ul className="mt-2 list-disc pl-5 space-y-1">
          {report.coverage.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <ul className="mt-3 space-y-1 font-mono break-all">
          {Object.entries(report.queries).map(([k, q]) => (
            <li key={k}>
              <span className="text-charcoal/80">{k}:</span> {q}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
