"use client";
import type { ShopifyProductVariant } from "@/lib/shopify";

/** Use actual variant photography, not guessed hex values for branded colors. */
export function ColorSwatches({ name = "Color", values, selected, variants = [], onChange }: {
  name?: string; values: string[]; selected: string;
  variants?: ShopifyProductVariant[]; onChange: (value: string) => void;
}) {
  return <fieldset className="shop-color-swatches">
    <legend>{name}<span>{selected}</span></legend>
    <div className="shop-color-swatches__row">
      {values.map(value => {
        let image = variants.find(v => v.image && v.selectedOptions.some(o => o.name === name && o.value === value))?.image;
        if (image?.startsWith("https://cdn.shopify.com/")) {
          const url = new URL(image); url.searchParams.set("width", "120"); image = url.toString();
        }
        return <button type="button" key={value} aria-label={value} title={value}
          aria-pressed={value === selected} onClick={() => onChange(value)}>
          {image ? <img src={image} alt="" loading="lazy" /> : <span>{value.slice(0, 2)}</span>}
        </button>;
      })}
    </div>
  </fieldset>;
}
