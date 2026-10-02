"use client";
/* eslint-disable @next/next/no-img-element */
import type { ShopifyProduct } from "@/lib/shopify";
import { SHOP_HERO_HOTSPOTS } from "@/lib/shopHeroHotspots";
import { shopProductPhoto } from "@/lib/shopProductPhotos";
import { money } from "@/lib/shopOutfit";

/** Distant editorial photography calls for a quiet product tray, not body markers. */
export function ShopHeroHotspots({ products, onSelect }: {
  products: ShopifyProduct[];
  onSelect: (product: ShopifyProduct) => void;
}) {
  const look=SHOP_HERO_HOTSPOTS.flatMap(item=>{
    const product=products.find(p=>p.slug===item.slug);
    return product?[{...item,product}]:[];
  });
  if(!look.length)return null;
  return <details className="shop-hero-look" onKeyDown={e=>{
    if(e.key==="Escape"){
      e.currentTarget.open=false;
      e.currentTarget.querySelector("summary")?.focus();
    }
  }}>
    <summary><span aria-hidden="true">+</span> Shop the look</summary>
    <div className="shop-hero-look__products" role="group" aria-label="Shop the hero look">
      {look.map(({slug,label,product})=><button key={slug} type="button"
        aria-label={`Shop ${label}`} aria-haspopup="dialog" aria-controls="shop-quick-dialog"
        onClick={()=>onSelect(product)}>
        <img src={shopProductPhoto(product)} alt="" width={52} height={62}/>
        <span>{label}<small>{money(product.price)}</small></span>
        <span aria-hidden="true">↗</span>
      </button>)}
    </div>
  </details>;
}
