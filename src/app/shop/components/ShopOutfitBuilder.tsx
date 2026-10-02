"use client";
/* eslint-disable @next/next/no-img-element */
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { ShopifyProduct } from "@/lib/shopify";
import { useMembership } from "@/app/context/MembershipContext";
import { getSizeGuide } from "@/lib/sizeCharts";
import { shopProductPhoto, shopProductLabel } from "@/lib/shopProductPhotos";
import { OUTFIT_SLOTS, RESERVE_OUTFIT_PRICE, money, outfitEstimate, outfitOptions, variantLabel } from "@/lib/shopOutfit";
import { trackEvent } from "@/lib/tracking";
import { createMembershipCheckout } from "@/lib/shopifyCheckout";
import { CompactVariantPicker } from "./CompactVariantPicker";
import "./guided-outfit.css";

const isFit = (name: string) => /^(size|waist|inseam)$/i.test(name);
function groups(p: ShopifyProduct) {
  return [...new Set(p.variants.flatMap(v=>v.selectedOptions.map(o=>o.name)))].map(name=>({
    name,values:[...new Set(p.variants.flatMap(v=>v.selectedOptions.filter(o=>o.name===name).map(o=>o.value)))],
  }));
}
function initialOptions(p: ShopifyProduct) {
  const base=p.variants[0];
  return Object.fromEntries(groups(p).filter(g=>!isFit(g.name)||g.values.length===1)
    .map(g=>[g.name,base?.selectedOptions.find(o=>o.name===g.name)?.value||g.values[0]]));
}

export function ShopOutfitBuilder({products,byCategory}:{products:ShopifyProduct[];byCategory:Record<string,ShopifyProduct[]>}) {
  const choices=useMemo(()=>OUTFIT_SLOTS.map(s=>outfitOptions(products,byCategory[s.category]||[],s.slugs)),[products,byCategory]);
  const [indices,setIndices]=useState([0,0,0]);
  const [selections,setSelections]=useState<Record<string,Record<string,string>>>({});
  const [step,setStep]=useState<0|1|2>(0);
  const [separate,setSeparate]=useState(false);
  const [mode,setMode]=useState<"once"|"reserve">("once");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [editSlot,setEditSlot]=useState(0);
  const root=useRef<HTMLElement>(null);
  const customize=useRef<HTMLDialogElement>(null);
  const fit=useRef<HTMLDialogElement>(null);
  const {addItemsToCart}=useMembership();
  const selected=choices.map((list,i)=>list[indices[i]]);
  const complete=selected.every(Boolean);
  const config=(p:ShopifyProduct)=>({...initialOptions(p),...selections[p.slug]});
  const variants=selected.map(p=>p?.variants.find(v=>v.selectedOptions.every(o=>config(p)[o.name]===o.value)));
  const ready=complete&&variants.every(Boolean);
  const unavailable=variants.some(v=>v&&!v.availableForSale);
  const estimate=outfitEstimate(selected.filter(Boolean).map((p,i)=>variants[i]?.price??p.price));
  const colors=(p:ShopifyProduct)=>Object.entries(config(p)).filter(([name])=>!isFit(name)).map(([,v])=>v).filter(v=>v!=="Default Title").join(" / ");
  const sizeGroup=(p?:ShopifyProduct)=>p?groups(p).find(g=>/^(size|waist)$/i.test(g.name)):undefined;
  const topSize=sizeGroup(selected[0]),layerSize=sizeGroup(selected[2]);
  const sharedSizes=topSize?.values.filter(size=>layerSize?.values.includes(size))||[];
  const shared=sharedSizes.length>0&&!separate;
  const sharedValue=selected[0]&&selected[2]&&topSize&&layerSize&&config(selected[0])[topSize.name]===config(selected[2])[layerSize.name]
    ?config(selected[0])[topSize.name]:"";
  function go(next:0|1|2) {
    setStep(next);setError("");
    requestAnimationFrame(()=>root.current?.scrollIntoView?.({block:"start",behavior:"instant"}));
  }
  function pick(p:ShopifyProduct,name:string,value:string) {
    setSelections(old=>({...old,[p.slug]:{...config(p),[name]:value}}));setError("");
  }
  function show(dialog:HTMLDialogElement|null){dialog?.showModal();document.body.style.overflow="hidden"}
  function close(dialog:HTMLDialogElement|null){dialog?.close();document.body.style.overflow=""}
  async function add() {
    if(busy||!ready)return;
    if(mode==="once"&&unavailable){setError("One of your sizes is unavailable. Change the size or piece.");return}
    setBusy(true);setError("");
    try{
      if(mode==="reserve"){
        void trackEvent("shop_outfit_reserve_clicked",{properties:{source:"shop_guided_outfit",products:selected.map(p=>p.slug)}});
        await createMembershipCheckout("member",{firstBoxItems:selected.map((p,i)=>({
          variantId:variants[i]!.id,slot:OUTFIT_SLOTS[i].label,name:p.name,size:variantLabel(variants[i]!),
        }))});
      }else{
        await addItemsToCart(selected.map((p,i)=>({
          slug:p.slug,name:p.name,brand:p.brand,price:variants[i]!.price,retailPrice:variants[i]!.price,
          variantId:variants[i]!.id,image:variants[i]!.image||shopProductPhoto(p),variantTitle:variantLabel(variants[i]!),
        })));
      }
    }catch(e){setError(e instanceof Error?e.message:"We couldn’t open your bag. Please try again.")}
    finally{setBusy(false)}
  }
  function fitFields(p:ShopifyProduct,label:string){
    if(label==="Trouser")return <div className="guided-trouser-fit">{groups(p).filter(g=>isFit(g.name)).map(g=>{
      const name=g.name==="Size"&&groups(p).some(x=>/^inseam$/i.test(x.name))?"waist":g.name.toLowerCase();
      return <fieldset className="guided-number-size" key={g.name} aria-label={`Trouser ${name}`}>
        <legend>{name==="inseam"?"Inseam":name==="waist"?"Waist":"Trouser size"} {["waist","inseam"].includes(name)&&<span>inches</span>}</legend>
        <div style={{gridTemplateColumns:`repeat(${Math.min(g.values.length,6)},minmax(0,1fr))`}}>{g.values.map(value=><button
          type="button" key={value} aria-pressed={config(p)[g.name]===value}
          disabled={!p.variants.some(v=>v.selectedOptions.every(o=>o.name===g.name?o.value===value:!config(p)[o.name]||config(p)[o.name]===o.value))}
          onClick={()=>pick(p,g.name,value)}>{value}</button>)}</div>
      </fieldset>;
    })}</div>;
    return <div className="guided-fit-fields" key={p.slug}>{groups(p).filter(g=>isFit(g.name)).map(g=><label key={g.name}>
      <span>{label} {g.name==="Size"&&groups(p).some(x=>/^inseam$/i.test(x.name))?"waist":g.name.toLowerCase()}</span>
      <select aria-label={`${label} ${g.name==="Size"&&groups(p).some(x=>/^inseam$/i.test(x.name))?"waist":g.name.toLowerCase()}`}
        value={config(p)[g.name]||""} onChange={e=>pick(p,g.name,e.target.value)}>
        <option value="" disabled>Choose</option>{g.values.map(value=><option key={value} value={value} disabled={
          !p.variants.some(v=>v.selectedOptions.every(o=>o.name===g.name?o.value===value:!config(p)[o.name]||config(p)[o.name]===o.value))
        }>{value}</option>)}
      </select></label>)}</div>;
  }
  return <section id="outfit" ref={root} tabIndex={-1} className={`sec sec--cream guided-outfit guided-step-${step}`} aria-labelledby="outfitTitle">
    <div className="wrap">
      <header className="guided-heading"><div>
        <h2 className="h2" id="outfitTitle">Your fall outfit, for less.</h2>
        <p className="guided-intro">Three pieces. Already paired. Just choose your sizes.</p></div>
        <ol aria-label="Outfit progress">{["The look","Your sizes","Review"].map((s,i)=><li key={s} aria-current={step===i?"step":undefined}><span>{i<step?"✓":i+1}</span>{s}</li>)}</ol>
      </header>
      {!complete?<p>We’re refreshing this outfit. <Link href="/shop/collection/shop-all">Explore the shop →</Link></p>:<div className="guided-layout">
        <div className="guided-look">
          <div className="guided-board">{selected.map((p,i)=><article key={p.slug}>
            <div className="guided-photo"><img src={variants[i]?.image||p.variants.find(v=>v.image&&v.selectedOptions.every(o=>!config(p)[o.name]||config(p)[o.name]===o.value))?.image||shopProductPhoto(p)} alt={p.name}/></div>
            <div className="guided-piece"><span>{p.brand}</span><h3>{shopProductLabel(p)}</h3><strong className="guided-piece-price">{money(variants[i]?.price??p.price)}</strong><p>{variants[i]?variantLabel(variants[i]!):colors(p)}</p></div>
          </article>)}</div>
          <div className="guided-look-footer"><span>A top. A bottom. A finishing layer.</span>
            <button onClick={()=>show(customize.current)}>Swap a piece or color ↗</button></div>
        </div>
        <div className="guided-panel">
          <div className="guided-content">
            {step===0?<><p className="guided-kicker">Selected by Mully</p><h3>The look is ready.<br/>Make it yours.</h3>
              <p>Choose your sizes. Swap a piece only if you want to.</p>
              <div className="guided-bundle-note"><strong>Buy the outfit. Save together.</strong><span>15% off one piece with BOGO15. Applied in your bag.</span></div>
            </>:step===1?<><div className="guided-panel-title"><h3>Make it your size.</h3><button onClick={()=>show(fit.current)}>Size &amp; fit ↗</button></div>
              {shared?<fieldset className="guided-shared-size"><legend>Top &amp; layer size</legend>
                <div>{sharedSizes.map(value=><button key={value} aria-pressed={sharedValue===value} onClick={()=>{
                  setSelections(old=>({...old,[selected[0].slug]:{...config(selected[0]),[topSize!.name]:value},[selected[2].slug]:{...config(selected[2]),[layerSize!.name]:value}}));
                }}>{value}</button>)}</div></fieldset>:<div className="guided-independent">{fitFields(selected[0],"Top")}{fitFields(selected[2],"Layer")}</div>}
              {fitFields(selected[1],"Trouser")}
              {sharedSizes.length>0&&<label className="guided-separate"><input type="checkbox" checked={separate} onChange={e=>setSeparate(e.target.checked)}/>I wear different top and layer sizes</label>}
              <p className="guided-quiet">Same look. Your fit. Change any piece or color whenever you like.</p>
            </>:<><div className="guided-panel-title"><h3>Your outfit. Your call.</h3><button onClick={()=>go(1)}>Edit sizes</button></div>
              <ul className="guided-review-lines">{selected.map((p,i)=><li key={p.slug}><span>{OUTFIT_SLOTS[i].label}</span><strong>{variants[i]?variantLabel(variants[i]!):"Choose size"}</strong></li>)}</ul>
              <fieldset className="guided-purchase"><legend className="sr-only">How would you like it?</legend>
                <label className={mode==="once"?"is-selected":""}><input type="radio" name="guided-purchase" checked={mode==="once"} onChange={()=>setMode("once")}/>
                  <span><strong>Just this time <b>{money(estimate.total)}</b></strong><small>BOGO15 estimate · {money(estimate.savings)} off one piece</small></span></label>
                <label className={mode==="reserve"?"is-selected":""}><input type="radio" name="guided-purchase" checked={mode==="reserve"} onChange={()=>setMode("reserve")}/>
                  <span><strong>Subscribe &amp; save <b>{money(RESERVE_OUTFIT_PRICE)}<em> / season</em></b></strong><small>Mully Reserve · {estimate.total>250?`Save ${money(estimate.total-250)} on this outfit`:"Your first outfit included"}</small>
                    <p>Your outfit first. Then new styles curated with your $250 seasonal budget. 4 shipments a year.</p></span></label>
              </fieldset>
              <p className="guided-terms">{mode==="reserve"?"Subscription: $250 today and automatically every 3 months, plus tax/shipping. Cancel before your next renewal.":"One-time purchase. Shopify confirms the best eligible offer and final total in your bag."}</p>
            </>}
            {error&&<p className="guided-error" role="alert">{error}</p>}
          </div>
          <div className="guided-actions">
            {step>0&&<button className="guided-back" onClick={()=>go(step===2?1:0)}>← Back</button>}
            <button className="btn btn--accent" disabled={!complete||busy||(step===1&&!ready)||(step===2&&(!ready||(mode==="once"&&unavailable)))}
              onClick={()=>step===0?go(1):step===1?go(2):add()}>
              {busy?mode==="reserve"?"Opening checkout…":"Adding…":step===0?"Choose my sizes →":step===1?"Review my outfit →":mode==="reserve"?"Subscribe for $250 / season →":unavailable?"Selected sizes sold out":"Add outfit to bag"}
            </button>
            {step===2&&<p>{variants.some(v=>v?.currentlyNotInStock)?"Preorder · First shipment ships in about 2 weeks.":"No subscription unless you choose Reserve."}</p>}
          </div>
        </div>
      </div>}
    </div>
    <dialog className="guided-dialog" ref={customize} aria-labelledby="guidedCustomizeTitle" onClose={()=>{document.body.style.overflow=""}}>
      <div className="guided-dialog-head"><h2 id="guidedCustomizeTitle">Make a small change.</h2><button aria-label="Close outfit customization" onClick={()=>close(customize.current)}>×</button></div>
      <div className="guided-dialog-tabs">{OUTFIT_SLOTS.map((s,i)=><button key={s.label} aria-pressed={editSlot===i} onClick={()=>setEditSlot(i)}>{s.label}</button>)}</div>
      <div className="guided-alternatives">{choices[editSlot].map((p,i)=><button key={p.slug} aria-label={`Choose ${p.name}`} aria-pressed={indices[editSlot]===i} onClick={()=>{
        setIndices(old=>old.map((n,j)=>j===editSlot?i:n));setMode("once");setError("");
      }}><img src={shopProductPhoto(p)} alt=""/><span>{shopProductLabel(p)}</span><small>{money(p.price)}</small></button>)}</div>
      {selected[editSlot]&&<CompactVariantPicker key={`${selected[editSlot].slug}-${editSlot}`} product={selected[editSlot]} value={variants[editSlot]?.id||""} allowUnavailable onChange={id=>{
        const p=selected[editSlot];const v=p.variants.find(v=>v.id===id);
        setSelections(old=>({...old,[p.slug]:v?Object.fromEntries(v.selectedOptions.map(o=>[o.name,o.value])):{}}));
      }}/>}
      <button className="btn btn--accent" onClick={()=>{close(customize.current);if(step===2&&!ready)go(1)}}>Keep this look →</button>
    </dialog>
    <dialog className="guided-dialog" ref={fit} aria-labelledby="guidedFitTitle" onClose={()=>{document.body.style.overflow=""}}>
      <div className="guided-dialog-head"><h2 id="guidedFitTitle">Size &amp; fit.</h2><button aria-label="Close outfit size guide" onClick={()=>close(fit.current)}>×</button></div>
      {selected.filter(Boolean).map(p=>{const guide=getSizeGuide(p.slug);return <details key={p.slug} className="guided-fit-guide"><summary>{p.name}</summary>
        <p>{p.fitNotes||guide?.fitNote||p.sizing||"See product details for fit information."}</p>
        {guide&&<div className="fit-table"><table><caption>{guide.chart.measurementType==="garment"?"Garment":"Body"} measurements, inches</caption>
          <thead><tr><th>Size</th>{guide.chart.columns.map(c=><th key={c}>{c}</th>)}</tr></thead>
          <tbody>{guide.chart.rows.map(r=><tr key={r.size}><th>{r.size}</th>{guide.chart.columns.map(c=><td key={c}>{r[c]}</td>)}</tr>)}</tbody></table></div>}
        <Link href={`/shop/${p.slug}`}>Full product details ↗</Link></details>})}
    </dialog>
  </section>;
}
