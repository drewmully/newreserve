"use client";

/**
 * Reserve sizing pickers shared by Gift a Season Step 2 and /gift-address.
 * Same fields and options as /gift-sizing (see src/lib/gifts/giftSizing.ts).
 */

import { useState } from "react";
import {
  OPTIONAL_SIZING_FIELDS,
  REQUIRED_SIZING_FIELDS,
  SIZING_FIELDS,
  SIZING_NOTES_MAX,
  SIZING_OPTIONS,
  type GiftSizing,
  type SizingKey,
} from "@/lib/gifts/giftSizing";

export function GiftSizingFields({
  value,
  onChange,
  notesLabel = "Fit notes",
  notesPlaceholder = "Between sizes, prefers a looser fit, colors they love",
  compact = false,
  collapseOptional = false,
  highlightBlank = false,
}: {
  value: GiftSizing;
  onChange: (next: GiftSizing) => void;
  notesLabel?: string;
  notesPlaceholder?: string;
  compact?: boolean;
  /** Tuck the optional sizes and fit notes under "More sizes (optional)". */
  collapseOptional?: boolean;
  /** Mark blank optional sizes "Not added yet" (the /gift-address prompt). */
  highlightBlank?: boolean;
}) {
  const hasOptional = OPTIONAL_SIZING_FIELDS.some((f) => value[f.key]) || !!value.notes;
  const [open, setOpen] = useState(hasOptional);
  const showOptional = !collapseOptional || open;
  const gap = compact ? "space-y-3.5" : "space-y-5";

  const picker = (f: { key: SizingKey; label: string; required: boolean }) => (
    <div key={f.key} role="radiogroup" aria-label={f.label} aria-required={f.required || undefined}>
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className="block text-[11px] uppercase tracking-[0.15em] text-charcoal/65">{f.label}</span>
        {highlightBlank && !f.required && !value[f.key] ? (
          <span className="text-[11px] text-[#9a5a1e]" data-testid={`size-blank-${f.key}`}>Not added yet</span>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {SIZING_OPTIONS[f.key].map((opt) => {
          const active = value[f.key] === opt;
          return (
            <button
              key={opt}
              type="button"
              role="radio"
              aria-checked={active}
              data-testid={`size-${f.key}-${opt.replace(/"/g, "")}`}
              onClick={() => onChange({ ...value, [f.key]: active && !f.required ? "" : opt })}
              className={`min-w-10 px-2.5 py-1.5 rounded-md text-[13px] border transition ${
                active
                  ? "bg-forest text-bone border-forest"
                  : "bg-bone text-charcoal/80 border-forest/20 hover:border-forest/40"
              }`}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );

  const notes = (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-[0.15em] text-charcoal/65 mb-1.5">
        {notesLabel}
        <span className="text-charcoal/45 ml-1 normal-case tracking-normal">(optional)</span>
      </span>
      <input
        type="text"
        name="sizingNotes"
        value={value.notes}
        maxLength={SIZING_NOTES_MAX}
        onChange={(e) => onChange({ ...value, notes: e.target.value })}
        placeholder={notesPlaceholder}
        className="w-full bg-bone border border-forest/20 rounded px-3 py-2.5 text-sm focus:outline-none focus:border-forest"
      />
    </label>
  );

  if (collapseOptional) {
    return (
      <div className={gap} data-testid="gift-sizing-fields">
        {REQUIRED_SIZING_FIELDS.map(picker)}
        <div className="border-t border-forest/10 pt-3">
          <button
            type="button"
            aria-expanded={open}
            aria-controls="gift-more-sizes"
            data-testid="more-sizes-toggle"
            onClick={() => setOpen(!open)}
            className="flex w-full items-center justify-between text-left text-[13px] text-[#111]"
          >
            <span>More sizes (optional)</span>
            <span aria-hidden="true" className="text-charcoal/50 text-base leading-none">{open ? "\u2212" : "+"}</span>
          </button>
          <p className="mt-1 text-[11px] text-charcoal/60">Skip any you don&apos;t know. They can update these later.</p>
          {showOptional ? (
            <div id="gift-more-sizes" className={`mt-3 ${gap}`} data-testid="more-sizes">
              {OPTIONAL_SIZING_FIELDS.map(picker)}
              {notes}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className={gap} data-testid="gift-sizing-fields">
      {SIZING_FIELDS.map(picker)}
      {notes}
    </div>
  );
}
