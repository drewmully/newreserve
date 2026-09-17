"use client";

import {
  getProductOptionGroups,
  hasVariantChoices,
  isVariantValueAvailable,
  type ProductVariantSelection,
} from "@/lib/productVariants";
import type { VariantBearingProduct } from "@/lib/productVariants";

interface Props {
  product: VariantBearingProduct;
  selection: ProductVariantSelection;
  onChange: (optionName: string, optionValue: string) => void;
  /** Always show color swatch section, even if product has only one color. */
  singleColorFallback?: string;
}

/**
 * Huckberry-style variant selection grid.
 *
 *  - Color / Colour → swatch row. Always renders (uses `singleColorFallback` when
 *    the product has no color option). Selected swatch has a forest ring.
 *  - Size / Waist / Inseam → chip grid. Small square tiles, tightly packed.
 *  - Fit / Style → tile grid. Wider tiles with subtitle underneath.
 *  - Anything else → falls back to chip grid.
 *
 * Unavailable variant combinations render as disabled but still visible — the
 * shopper can select any combo, and the buy box turns into a pre-order flow if
 * the combo is sold out.
 */
export function PdpVariantGrid({
  product,
  selection,
  onChange,
  singleColorFallback,
}: Props) {
  const hasChoices = hasVariantChoices(product);
  const groups = hasChoices ? getProductOptionGroups(product) : [];

  // Always guarantee a color group so the swatch UI is visible even with 1 color.
  const colorGroupIdx = groups.findIndex((g) => /^colou?r$/i.test(g.name));
  const showSyntheticColor = colorGroupIdx === -1 && Boolean(singleColorFallback);

  return (
    <div className="space-y-6">
      {showSyntheticColor && (
        <ColorRow
          groupName="Color"
          values={[singleColorFallback!]}
          selected={singleColorFallback!}
          available={() => true}
          onChange={() => {}}
        />
      )}
      {groups.map((group) => {
        const isColor = /^colou?r$/i.test(group.name);
        const isSize = /^size$/i.test(group.name);
        const isWaist = /^waist$/i.test(group.name);
        const isInseam = /^inseam$|^length$/i.test(group.name);
        const isFit = /^fit$|^style$/i.test(group.name);
        const selected = selection[group.name] ?? group.values[0];
        const available = (v: string) =>
          isVariantValueAvailable(product, selection, group.name, v);

        if (isColor) {
          return (
            <ColorRow
              key={group.name}
              groupName={group.name}
              values={group.values}
              selected={selected}
              available={available}
              onChange={(v) => onChange(group.name, v)}
            />
          );
        }

        if (isFit) {
          return (
            <TileGrid
              key={group.name}
              groupName={group.name}
              values={group.values}
              selected={selected}
              available={available}
              onChange={(v) => onChange(group.name, v)}
            />
          );
        }

        // Waist / inseam / size / everything else → compact chip grid.
        return (
          <ChipGrid
            key={group.name}
            groupName={group.name}
            values={group.values}
            selected={selected}
            available={available}
            onChange={(v) => onChange(group.name, v)}
            columns={isSize || isWaist || isInseam ? 6 : 4}
          />
        );
      })}
    </div>
  );
}

function ColorRow({
  groupName,
  values,
  selected,
  available,
  onChange,
}: {
  groupName: string;
  values: string[];
  selected: string;
  available: (v: string) => boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <p className="text-[10px] font-mono uppercase tracking-[0.22em] text-charcoal/50">
          {groupName}
        </p>
        <p className="text-[12px] text-charcoal/70">{selected}</p>
      </div>
      <div className="flex flex-wrap gap-2.5">
        {values.map((v) => {
          const isSelected = selected === v;
          const isAvailable = available(v);
          return (
            <button
              key={v}
              type="button"
              onClick={() => onChange(v)}
              aria-pressed={isSelected}
              aria-label={v}
              title={v}
              className={`relative h-10 w-10 rounded-full border transition ${
                isSelected
                  ? "border-forest ring-1 ring-forest ring-offset-2 ring-offset-white"
                  : isAvailable
                    ? "border-charcoal/15 hover:border-charcoal/40"
                    : "border-charcoal/10 opacity-50"
              }`}
              style={{ backgroundColor: colorNameToCss(v) }}
            >
              {!isAvailable && (
                <span
                  aria-hidden="true"
                  className="absolute inset-0 block rotate-45 border-t border-charcoal/40"
                  style={{ top: "calc(50% - 0.5px)" }}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TileGrid({
  groupName,
  values,
  selected,
  available,
  onChange,
}: {
  groupName: string;
  values: string[];
  selected: string;
  available: (v: string) => boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <p className="text-[10px] font-mono uppercase tracking-[0.22em] text-charcoal/50">
          {groupName}
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
        {values.map((v) => {
          const isSelected = selected === v;
          const isAvailable = available(v);
          return (
            <button
              key={v}
              type="button"
              onClick={() => onChange(v)}
              aria-pressed={isSelected}
              className={`flex min-h-[3.5rem] items-center justify-center rounded-sm border px-3 py-3 text-center text-[13px] leading-snug transition ${
                isSelected
                  ? "border-forest bg-forest/[0.06] font-medium text-forest"
                  : isAvailable
                    ? "border-charcoal/15 bg-white text-charcoal hover:border-charcoal/40"
                    : "border-charcoal/10 bg-cream text-charcoal/40"
              }`}
            >
              {v}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ChipGrid({
  groupName,
  values,
  selected,
  available,
  onChange,
  columns,
}: {
  groupName: string;
  values: string[];
  selected: string;
  available: (v: string) => boolean;
  onChange: (v: string) => void;
  columns: number;
}) {
  const gridCols =
    columns === 6
      ? "grid-cols-4 sm:grid-cols-6"
      : columns === 5
        ? "grid-cols-4 sm:grid-cols-5"
        : "grid-cols-3 sm:grid-cols-4";

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <p className="text-[10px] font-mono uppercase tracking-[0.22em] text-charcoal/50">
          {groupName}
        </p>
        <p className="text-[12px] text-charcoal/70">{selected}</p>
      </div>
      <div className={`grid gap-1.5 ${gridCols}`}>
        {values.map((v) => {
          const isSelected = selected === v;
          const isAvailable = available(v);
          return (
            <button
              key={v}
              type="button"
              onClick={() => onChange(v)}
              aria-pressed={isSelected}
              className={`flex h-11 items-center justify-center rounded-sm border text-[13px] transition ${
                isSelected
                  ? "border-forest bg-forest text-white"
                  : isAvailable
                    ? "border-charcoal/15 bg-white text-charcoal hover:border-charcoal/40"
                    : "border-charcoal/10 bg-cream text-charcoal/40"
              }`}
            >
              {v}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Loose color-name → CSS mapping for the swatch background. Falls back to a
 * neutral tone for unknown values. This is a rendering shortcut only; if the
 * catalog grows beyond covered names, move to a per-product color→hex map in
 * Shopify (e.g. custom.color_hex_map) and read from there.
 */
function colorNameToCss(name: string): string {
  const key = name.toLowerCase().trim();
  const map: Record<string, string> = {
    black: "#1a1a1a",
    white: "#f5f5f5",
    cream: "#f2ede1",
    bone: "#eee7d6",
    ivory: "#f4efe1",
    navy: "#1c2a44",
    "navy blue": "#1c2a44",
    blue: "#2c5fa8",
    "light blue": "#93b4d6",
    forest: "#1f3d2b",
    "forest green": "#1f3d2b",
    green: "#3a5d3a",
    olive: "#6b6a3e",
    khaki: "#a08a5c",
    tan: "#c8a678",
    sand: "#d8c69a",
    beige: "#d3c3a2",
    brown: "#6b4a2a",
    charcoal: "#2a2a2a",
    grey: "#8a8a8a",
    gray: "#8a8a8a",
    "light grey": "#c4c4c4",
    "light gray": "#c4c4c4",
    red: "#a83a3a",
    burgundy: "#6c1e2b",
    ember: "#d4772c",
    orange: "#d4772c",
    pink: "#e8b8b8",
    purple: "#5d4a7a",
    yellow: "#d9c04a",
    stone: "#a89b8a",
    heather: "#a8a8a8",
    "heather grey": "#a8a8a8",
  };
  if (map[key]) return map[key];
  // Try matching first word for compound colors like "Storm Blue".
  const first = key.split(/\s+/)[0];
  if (map[first]) return map[first];
  return "#c4c4c4";
}
