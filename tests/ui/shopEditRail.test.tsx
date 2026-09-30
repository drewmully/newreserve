import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ShopEditRail } from "@/app/shop/components/ShopEditRail";

function setup() {
  vi.stubGlobal("matchMedia",()=>({matches:true}));
  render(<ShopEditRail count={6} season="fall">{Array.from({length:6},(_,i)=><article key={i}><a href={`/shop/piece-${i}`}>Piece {i}</a></article>)}</ShopEditRail>);
  const rail=screen.getByRole("region",{name:"The full fall edit"});
  Object.defineProperty(rail,"clientWidth",{value:1000,configurable:true});
  Object.defineProperty(rail,"scrollWidth",{value:1800,configurable:true});
  vi.spyOn(rail.firstElementChild!,"getBoundingClientRect").mockReturnValue({width:250} as DOMRect);
  rail.scrollBy=vi.fn((options?: ScrollToOptions | number)=>{const left=typeof options==="number"?options:options?.left;rail.scrollLeft=Math.max(0,Math.min(800,rail.scrollLeft+Number(left)));fireEvent.scroll(rail);});
  rail.scrollTo=vi.fn((options?: ScrollToOptions | number)=>{const left=typeof options==="number"?options:options?.left;rail.scrollLeft=Math.max(0,Math.min(800,Number(left)));fireEvent.scroll(rail);});
  fireEvent(window,new Event("resize"));
  return rail;
}
describe("full edit native scroll rail",()=>{
  it("moves with arrows, respects reduced motion and disables controls at the ends",()=>{
    const rail=setup();
    expect(screen.getByRole("button",{name:"Previous products"})).toBeDisabled();
    expect(screen.getByRole("button",{name:"Next products"})).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button",{name:"Next products"}));
    expect(rail.scrollBy).toHaveBeenCalledWith({left:1000,behavior:"auto"});
    expect(screen.getByRole("button",{name:"Next products"})).toBeDisabled();
    fireEvent.click(screen.getByRole("button",{name:"Previous products"}));
    expect(rail.scrollLeft).toBe(0);
  });
  it("supports keyboard endpoints without hijacking keys on product links",()=>{
    const rail=setup();
    fireEvent.keyDown(rail,{key:"End"});
    expect(rail.scrollLeft).toBe(800);
    fireEvent.keyDown(rail,{key:"Home"});
    expect(rail.scrollLeft).toBe(0);
    fireEvent.keyDown(screen.getByRole("link",{name:"Piece 0"}),{key:"ArrowRight"});
    expect(rail.scrollBy).not.toHaveBeenCalled();
    fireEvent.keyDown(rail,{key:"ArrowRight"});
    expect(rail.scrollLeft).toBe(800);
  });
});
