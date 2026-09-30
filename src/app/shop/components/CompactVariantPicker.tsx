"use client";
import { useState } from "react";
import type { ShopifyProduct } from "@/lib/shopify";

/** Compact, exact variant selection. Never silently substitutes another size. */
export function CompactVariantPicker({ product, value, onChange, allowUnavailable = false }: {
  product: ShopifyProduct;
  value: string;
  onChange: (id: string) => void;
  allowUnavailable?: boolean;
}) {
  const groups = Array.from(new Set(product.variants.flatMap(v => v.selectedOptions.map(o => o.name))))
    .map(name => ({ name, values: Array.from(new Set(product.variants.flatMap(v => v.selectedOptions.filter(o => o.name === name).map(o => o.value)))) }));
  const initial = product.variants.find(v => v.id === value);
  const [selection, setSelection] = useState<Record<string, string>>(() =>
    initial ? Object.fromEntries(initial.selectedOptions.map(o => [o.name, o.value])) :
      Object.fromEntries(groups.filter(g => g.values.length === 1 || /^colou?r$/i.test(g.name)).map(g => [g.name, g.values[0]])));
  function pick(name: string, next: string) {
    const updated = { ...selection, [name]: next };
    // A color can have a different size run. Keep compatible selections, but
    // clear incompatible dimensions rather than trapping the shopper.
    if (/^colou?r$/i.test(name)) {
      for (const group of groups.filter(g => g.name !== name)) {
        if (!product.variants.some(v => v.selectedOptions.every(o =>
          !updated[o.name] || o.value === updated[o.name]))) delete updated[group.name];
      }
    }
    setSelection(updated);
    const exact = product.variants.find(v => v.selectedOptions.every(o => updated[o.name] === o.value));
    onChange(exact && (allowUnavailable || exact.availableForSale) ? exact.id : "");
  }
  const hasInseam = groups.some(g => g.name === "Inseam");
  const possibleValue = (name: string, value: string) => product.variants.some(variant =>
    (allowUnavailable || variant.availableForSale) && variant.selectedOptions.every(o =>
      o.name === name ? o.value === value : !selection[o.name] || o.value === selection[o.name]));
  return <div className={`shop-variant-picker${hasInseam ? " shop-variant-picker--inseam" : ""}`}>
    {groups.map(group => {
      if (group.values.length === 1) return <p className="shop-variant-single" key={group.name}>{group.name}: {group.values[0]}</p>;
      const isColor = /^colou?r$/i.test(group.name);
      if (isColor) return <label className="shop-variant-color" key={group.name}>
        <span>Color</span><select aria-label="Color" value={selection[group.name] || ""} onChange={e => pick(group.name, e.target.value)}>
          {group.values.map(v => <option key={v}>{v}</option>)}
        </select>
      </label>;
      return <fieldset key={group.name} className="shop-variant-dimension">
        <legend>{group.name === "Size" && groups.some(g => g.name === "Inseam") ? "Waist" : group.name}</legend>
        {hasInseam && <select className="shop-variant-mobile-select"
          aria-label={group.name === "Size" ? "Waist size" : "Inseam length"}
          value={selection[group.name] || ""} onChange={e => pick(group.name, e.target.value)}>
          <option value="" disabled>Choose</option>
          {group.values.map(v => <option key={v} value={v} disabled={!possibleValue(group.name,v)}>{v}</option>)}
        </select>}
        <div className="outfit__sizes">
          {group.values.map(v => {
            const matching = product.variants.filter(variant => variant.selectedOptions.every(o => o.name === group.name ? o.value === v : !selection[o.name] || o.value === selection[o.name]));
            const possible = matching.length > 0 && (allowUnavailable || matching.some(x => x.availableForSale));
            return <button type="button" key={v} data-size={v} aria-pressed={selection[group.name] === v}
              disabled={!possible} onClick={() => pick(group.name, v)}>{v}</button>;
          })}
        </div>
      </fieldset>;
    })}
    {Object.keys(selection).length === groups.length && !product.variants.some(v => v.selectedOptions.every(o => selection[o.name] === o.value)) &&
      <p className="shop-variant-unavailable" role="status">This combination is not offered. Choose another size or inseam.</p>}
  </div>;
}
