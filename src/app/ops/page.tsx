"use client";

/**
 * /ops — weekly KPI dashboard with Mully/MFS toggle, inline goal editing,
 * owner assignment, manual entry. Reads from /api/admin/ops/snapshots
 * and writes via /api/admin/ops/goals + /api/admin/ops/manual.
 */

import { useCallback, useEffect, useState } from "react";
import AdminGate from "@/app/components/AdminGate";
import { useAdminFetch } from "@/app/components/useAdminFetch";

type Brand = "mully" | "mfs";
type Def = { slug: string; title: string; unit: string; sort_order: number; description?: string };
type Cell = { value: number | null; prev: number | null; goal: number | null; meta?: unknown };
type Goal = {
  kpi_slug: string;
  goal_value: number | null;
  goal_label: string | null;
  owner_email: string | null;
  effective_from: string | null;
  effective_to: string | null;
  notes: string | null;
};
type Snap = {
  brand: Brand;
  defs: Def[];
  weeks: string[];
  snapshots: Record<string, Record<string, Cell>>;
  goals: Goal[];
};

const MANUAL_CATEGORIES: Array<{ value: string; label: string; brand: Brand }> = [
  { value: "cs_volume", label: "CS Volume (count)", brand: "mully" },
  { value: "marketing_spend", label: "Marketing Spend (manual add)", brand: "mully" },
  { value: "fulfillment_labor", label: "Fulfillment Labor ($)", brand: "mfs" },
  { value: "pipeline_landed", label: "Pipeline Landed (count)", brand: "mfs" },
  { value: "5s_score", label: "5S Score", brand: "mfs" },
];

function fmtValue(v: number | null | undefined, unit: string): string {
  if (v == null || Number.isNaN(Number(v))) return "—";
  const n = Number(v);
  if (unit === "usd") return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (unit === "pct") return `${n.toFixed(1)}%`;
  if (unit === "hours") return `${n.toFixed(1)}h`;
  if (unit === "score") return n.toFixed(2);
  return n.toLocaleString("en-US");
}
function fmtWeek(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function delta(value: number | null, prev: number | null): { txt: string; cls: string } | null {
  if (value == null || prev == null || prev === 0) return null;
  const pct = ((value - prev) / Math.abs(prev)) * 100;
  const sign = pct > 0 ? "+" : "";
  return {
    txt: `${sign}${pct.toFixed(1)}%`,
    cls: pct > 0 ? "text-green-700" : pct < 0 ? "text-red-700" : "text-charcoal/40",
  };
}

export default function OpsPage() {
  return (
    <AdminGate>
      <OpsInner />
    </AdminGate>
  );
}

function OpsInner() {
  const { adminFetch, tokenReady } = useAdminFetch();
  const [brand, setBrand] = useState<Brand>("mully");
  const [snap, setSnap] = useState<Snap | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<{ slug: string; field: "goal" | "owner" } | null>(null);

  const load = useCallback(async () => {
    if (!tokenReady) return;
    setLoading(true);
    try {
      const r = await adminFetch(`/api/admin/ops/snapshots?brand=${brand}&weeks=8`);
      if (!r.ok) throw new Error(`load ${r.status}`);
      setSnap((await r.json()) as Snap);
    } finally {
      setLoading(false);
    }
  }, [adminFetch, brand, tokenReady]);

  useEffect(() => {
    load();
  }, [load]);

  const saveGoal = useCallback(
    async (slug: string, patch: { goal_value?: number | null; owner_email?: string | null }) => {
      await adminFetch("/api/admin/ops/goals", {
        method: "POST",
        body: JSON.stringify({ brand, kpi_slug: slug, ...patch }),
      });
      load();
    },
    [adminFetch, brand, load],
  );

  const goalFor = useCallback(
    (slug: string): Goal | null => {
      if (!snap) return null;
      // Most recent (effective_from desc) wins
      return snap.goals.find((g) => g.kpi_slug === slug) || null;
    },
    [snap],
  );

  return (
    <div className="min-h-screen bg-cream">
      <Header brand={brand} setBrand={setBrand} reload={load} />
      <div className="max-w-7xl mx-auto px-6 py-6">
        {!snap || loading ? (
          <div className="text-sm text-charcoal/40">Loading…</div>
        ) : (
          <>
            <Grid
              snap={snap}
              goalFor={goalFor}
              editing={editing}
              setEditing={setEditing}
              saveGoal={saveGoal}
            />
            <ManualEntry brand={brand} adminFetch={adminFetch} onSaved={load} />
          </>
        )}
      </div>
    </div>
  );
}

function Header({
  brand,
  setBrand,
  reload,
}: {
  brand: Brand;
  setBrand: (b: Brand) => void;
  reload: () => void;
}) {
  return (
    <nav className="border-b border-taupe/20 bg-white">
      <div className="max-w-7xl mx-auto px-6 h-12 flex items-center gap-6">
        <span className="font-serif text-sm text-obsidian font-medium">Ops</span>
        <a href="/customers" className="text-sm text-charcoal/50 hover:text-charcoal">
          Customers
        </a>
        <a href="/admin" className="text-sm text-charcoal/50 hover:text-charcoal">
          Admin
        </a>
        <div className="ml-auto flex items-center gap-2">
          <BrandToggle brand={brand} setBrand={setBrand} />
          <button
            onClick={reload}
            className="text-xs px-2 py-1 border border-taupe/40 rounded hover:bg-cream"
          >
            Refresh
          </button>
        </div>
      </div>
    </nav>
  );
}

function BrandToggle({ brand, setBrand }: { brand: Brand; setBrand: (b: Brand) => void }) {
  return (
    <div className="inline-flex border border-taupe/40 rounded overflow-hidden text-xs">
      {(["mully", "mfs"] as Brand[]).map((b) => (
        <button
          key={b}
          onClick={() => setBrand(b)}
          className={`px-3 py-1 ${brand === b ? "bg-forest text-white" : "bg-white text-charcoal/70"}`}
        >
          {b === "mully" ? "Mully" : "MFS"}
        </button>
      ))}
    </div>
  );
}

function Grid({
  snap,
  goalFor,
  editing,
  setEditing,
  saveGoal,
}: {
  snap: Snap;
  goalFor: (slug: string) => Goal | null;
  editing: { slug: string; field: "goal" | "owner" } | null;
  setEditing: (e: { slug: string; field: "goal" | "owner" } | null) => void;
  saveGoal: (slug: string, patch: { goal_value?: number | null; owner_email?: string | null }) => Promise<void>;
}) {
  const weeks = snap.weeks;
  return (
    <div className="bg-white border border-taupe/30 rounded overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-cream border-b border-taupe/30">
          <tr>
            <th className="text-left font-medium px-3 py-2 sticky left-0 bg-cream">KPI</th>
            <th className="text-right font-medium px-2 py-2">Goal</th>
            <th className="text-left font-medium px-2 py-2">Owner</th>
            {weeks.map((w) => (
              <th key={w} className="text-right font-medium px-2 py-2 whitespace-nowrap">
                {fmtWeek(w)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {snap.defs.map((def) => {
            const goal = goalFor(def.slug);
            const latest = snap.snapshots[def.slug]?.[weeks[0]];
            const goalHit =
              goal?.goal_value != null && latest?.value != null
                ? Number(latest.value) >= Number(goal.goal_value)
                : null;
            return (
              <tr key={def.slug} className="border-t border-taupe/20 hover:bg-cream/50">
                <td className="px-3 py-2 sticky left-0 bg-white">
                  <div className="font-medium text-obsidian">{def.title}</div>
                  <div className="text-[10px] text-charcoal/40 font-mono">{def.slug}</div>
                </td>
                <td
                  className={`px-2 py-2 text-right cursor-text ${
                    goalHit === true
                      ? "bg-green-50"
                      : goalHit === false
                        ? "bg-red-50"
                        : ""
                  }`}
                  onClick={() => setEditing({ slug: def.slug, field: "goal" })}
                >
                  {editing?.slug === def.slug && editing.field === "goal" ? (
                    <GoalInput
                      initial={goal?.goal_value ?? null}
                      onCancel={() => setEditing(null)}
                      onSave={(v) => {
                        saveGoal(def.slug, { goal_value: v });
                        setEditing(null);
                      }}
                    />
                  ) : (
                    <span>{fmtValue(goal?.goal_value ?? null, def.unit)}</span>
                  )}
                </td>
                <td
                  className="px-2 py-2 text-left cursor-text"
                  onClick={() => setEditing({ slug: def.slug, field: "owner" })}
                >
                  {editing?.slug === def.slug && editing.field === "owner" ? (
                    <OwnerInput
                      initial={goal?.owner_email ?? ""}
                      onCancel={() => setEditing(null)}
                      onSave={(v) => {
                        saveGoal(def.slug, { owner_email: v });
                        setEditing(null);
                      }}
                    />
                  ) : (
                    <span className="text-xs text-charcoal/60">{goal?.owner_email || "—"}</span>
                  )}
                </td>
                {weeks.map((w) => {
                  const cell = snap.snapshots[def.slug]?.[w];
                  const d = cell ? delta(cell.value, cell.prev) : null;
                  return (
                    <td key={w} className="px-2 py-2 text-right whitespace-nowrap">
                      <div className="text-obsidian">{fmtValue(cell?.value ?? null, def.unit)}</div>
                      {d && <div className={`text-[10px] ${d.cls}`}>{d.txt}</div>}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function GoalInput({
  initial,
  onCancel,
  onSave,
}: {
  initial: number | null;
  onCancel: () => void;
  onSave: (v: number | null) => void;
}) {
  const [v, setV] = useState(initial?.toString() ?? "");
  return (
    <div className="inline-flex gap-1">
      <input
        autoFocus
        value={v}
        onChange={(e) => setV(e.target.value)}
        className="w-20 border border-taupe/40 rounded px-1 text-right text-sm"
        onKeyDown={(e) => {
          if (e.key === "Enter") onSave(v.trim() === "" ? null : Number(v));
          if (e.key === "Escape") onCancel();
        }}
      />
      <button
        onClick={() => onSave(v.trim() === "" ? null : Number(v))}
        className="text-xs text-forest"
      >
        save
      </button>
    </div>
  );
}

function OwnerInput({
  initial,
  onCancel,
  onSave,
}: {
  initial: string;
  onCancel: () => void;
  onSave: (v: string | null) => void;
}) {
  const [v, setV] = useState(initial);
  return (
    <div className="inline-flex gap-1">
      <input
        autoFocus
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder="owner@..."
        className="w-32 border border-taupe/40 rounded px-1 text-sm"
        onKeyDown={(e) => {
          if (e.key === "Enter") onSave(v.trim() || null);
          if (e.key === "Escape") onCancel();
        }}
      />
      <button onClick={() => onSave(v.trim() || null)} className="text-xs text-forest">
        save
      </button>
    </div>
  );
}

function ManualEntry({
  brand,
  adminFetch,
  onSaved,
}: {
  brand: Brand;
  adminFetch: (path: string, init?: RequestInit) => Promise<Response>;
  onSaved: () => void;
}) {
  const opts = MANUAL_CATEGORIES.filter((c) => c.brand === brand);
  const [category, setCategory] = useState(opts[0]?.value || "");
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setCategory(opts[0]?.value || "");
  }, [brand, opts]);

  if (opts.length === 0) return null;

  const submit = async () => {
    if (!category || !value.trim()) {
      setMsg("category + value required");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await adminFetch("/api/admin/ops/manual", {
        method: "POST",
        body: JSON.stringify({
          brand,
          category,
          entry_date: entryDate,
          value_numeric: Number(value),
          note: note || null,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `${r.status}`);
      }
      setValue("");
      setNote("");
      setMsg("saved · will appear after next Sunday rollup");
      onSaved();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 bg-white border border-taupe/30 rounded p-4">
      <h2 className="text-xs uppercase tracking-wide text-charcoal/50 mb-3">
        Manual Entry ({brand === "mully" ? "Mully" : "MFS"})
      </h2>
      <div className="flex flex-wrap gap-3 items-end text-sm">
        <label className="flex flex-col">
          <span className="text-xs text-charcoal/50">Category</span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="border border-taupe/40 rounded px-2 py-1"
          >
            {opts.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          <span className="text-xs text-charcoal/50">Date</span>
          <input
            type="date"
            value={entryDate}
            onChange={(e) => setEntryDate(e.target.value)}
            className="border border-taupe/40 rounded px-2 py-1"
          />
        </label>
        <label className="flex flex-col">
          <span className="text-xs text-charcoal/50">Value</span>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            type="number"
            step="0.01"
            className="border border-taupe/40 rounded px-2 py-1 w-28"
          />
        </label>
        <label className="flex flex-col flex-1 min-w-[200px]">
          <span className="text-xs text-charcoal/50">Note (optional)</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="border border-taupe/40 rounded px-2 py-1"
          />
        </label>
        <button
          disabled={busy}
          onClick={submit}
          className="px-3 py-1 bg-forest text-white text-sm rounded disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
      {msg && <div className="mt-2 text-xs text-charcoal/60">{msg}</div>}
    </div>
  );
}
