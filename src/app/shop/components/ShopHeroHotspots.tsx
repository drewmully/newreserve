"use client";
import { useEffect, useState, type RefObject } from "react";
import { projectHeroPoint } from "@/lib/shopHeroHotspots";

/** Project the torso point through the responsive crop, never the viewport. */
export function ShopHeroHotspots({ imageRef }: {
  imageRef: RefObject<HTMLImageElement | null>;
}) {
  const [point,setPoint]=useState<{x:number;y:number}|null>(null);
  useEffect(()=>{
    const image=imageRef.current;
    if(!image)return;
    let frame=0;
    function update(){
      if(!image?.complete||!image.naturalWidth){setPoint(null);return}
      const box=image.getBoundingClientRect();
      const mobile=image.currentSrc.includes("-mobile");
      const [x,y]=getComputedStyle(image).objectPosition.split(" ");
      const percent=(value:string)=>value?.endsWith("%")?parseFloat(value)/100:.5;
      setPoint(projectHeroPoint({width:box.width,height:box.height,naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight,
        point:mobile?{x:.659,y:.625}:{x:.695,y:.625},positionX:percent(x),positionY:percent(y)}));
    }
    const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(update)};
    const observer=typeof ResizeObserver!=="undefined"?new ResizeObserver(schedule):null;
    observer?.observe(image);
    image.addEventListener("load",schedule);
    image.addEventListener("error",schedule);
    window.addEventListener("resize",schedule);
    schedule();
    return ()=>{cancelAnimationFrame(frame);observer?.disconnect();image.removeEventListener("load",schedule);
      image.removeEventListener("error",schedule);window.removeEventListener("resize",schedule)};
  },[imageRef]);
  if(!point)return null;
  return <a href="#outfit" className="shop-hero-hotspot" aria-label="Shop the look: build this outfit"
    style={{left:point.x,top:point.y}} onClick={e=>{
      if(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
      const target=document.getElementById("outfit");
      if(!target)return;
      e.preventDefault();
      window.history.replaceState(window.history.state,"","#outfit");
      target.focus({preventScroll:true});
      target.scrollIntoView({block:"start",behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches?"instant":"smooth"});
    }}>
    <span className="shop-hero-hotspot__plus" aria-hidden="true">+</span>
    <span className="shop-hero-hotspot__label" aria-hidden="true">Shop the look</span>
  </a>;
}
