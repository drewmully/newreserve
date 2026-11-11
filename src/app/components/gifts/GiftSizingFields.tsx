"use client";

/**
 * Reserve sizing pickers shared by Gift a Season Step 2 and /gift-address.
 * Same fields and options as /gift-sizing (see src/lib/gifts/giftSizing.ts).
 */

import { SIZING_FIELDS, SIZING_NOTES_MAX, SIZING_OPTIONS, type GiftSizing } from "@/lib/gifts/giftSizing";

export function GiftSizingFields({
  value,
  onChange,
  notesLabel = "Fit notes",
  notesPlaceholder = "Between sizes, prefers a looser fit, colors they love",
  compact = false,
}: {
  value: GiftSizing;
  onChange: (next: GiftSizing) => void;
  notesLabel?: string;
  notesPlaceholder?: string;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "space-y-3.5" : "space-y-5"} data-testid="gift-sizing-fields">
      {SIZING_FIELDS.map((f) => (
        <div key={f.key} role="radiogroup" aria-label={f.label}>
          <div className="block text-[11px] uppercase tracking-[0.15em] text-charcoal/65 mb-1.5">{f.label}</div>
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
                  onClick={() => onChange({ ...value, [f.key]: opt })}
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
      ))}
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
    </div>
  );
}
