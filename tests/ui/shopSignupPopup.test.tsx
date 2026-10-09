import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("next/navigation",()=>({usePathname:()=>"/shop"}));
const state=vi.hoisted(()=>({cartOpen:false,cartCount:0}));
vi.mock("@/app/context/MembershipContext",()=>({useMembership:()=>state}));
import { ShopSignupPopup } from "@/app/shop/components/ShopSignupPopup";
beforeEach(()=>{
  state.cartOpen=false;state.cartCount=0;localStorage.clear();sessionStorage.clear();
  HTMLDialogElement.prototype.showModal=function(){this.setAttribute("open","")};
  HTMLDialogElement.prototype.close=function(){this.removeAttribute("open");this.dispatchEvent(new Event("close"))};
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:true,json:async()=>({ok:true,receipt:"a".repeat(64),reward:{code:"MULLYEDIT10",percent:10}})}));
});
afterEach(()=>vi.unstubAllGlobals());
describe("preference-first signup",()=>{
  it("saves email first with explicit consent and makes SMS independently optional",async()=>{
    render(<ShopSignupPopup/>);
    fireEvent(window,new Event("mully:open-signup"));
    fireEvent.click(screen.getByRole("button",{name:/Polos & shirts/}));
    const consent=screen.getByRole("checkbox");expect(consent).not.toBeChecked();
    fireEvent.change(screen.getByLabelText("Email address"),{target:{value:"test@example.com"}});
    fireEvent.click(consent);
    fireEvent.submit(screen.getByRole("button",{name:/Get 10% off/}).closest("form")!);
    await screen.findByText("Make it 15%?");
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toMatchObject({stage:"email",interest:"tops",consent:true});
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    fireEvent.click(screen.getByRole("button",{name:"Keep my 10%"}));
    expect(screen.getByText("Good taste. Rewarded.")).toBeVisible();
    expect(screen.getByText("MULLYEDIT10")).toBeVisible();
    expect(localStorage.getItem("mully_shop_reward_v1")).toBe("MULLYEDIT10");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("does not open over a cart or password curtain",()=>{
    state.cartOpen=true;render(<ShopSignupPopup/>);
    fireEvent(window,new Event("mully:open-signup"));expect(document.querySelector("dialog")).not.toHaveAttribute("open");
  });
  it("shows failures rather than advancing to an unsaved step",async()=>{
    vi.mocked(fetch).mockResolvedValueOnce({ok:false,json:async()=>({error:"save_failed"})} as Response);
    render(<ShopSignupPopup/>);fireEvent(window,new Event("mully:open-signup"));
    fireEvent.click(screen.getByRole("button",{name:/The full edit/}));
    fireEvent.submit(screen.getByRole("button",{name:/Get 10% off/}).closest("form")!);
    await waitFor(()=>expect(screen.getByRole("alert")).toHaveTextContent("couldn’t save"));
    expect(screen.queryByText("Make it 15%?")).not.toBeInTheDocument();
  });
  it("holds the automatic popup once the visitor has items in the bag",()=>{
    vi.useFakeTimers();state.cartCount=2;render(<ShopSignupPopup/>);
    fireEvent.pointerDown(document.body);vi.advanceTimersByTime(48_000);
    expect(document.querySelector("dialog")).not.toHaveAttribute("open");
    vi.useRealTimers();
  });
  it("holds the automatic popup for the session after a tap in the outfit builder",()=>{
    vi.useFakeTimers();
    const outfit=document.createElement("section");outfit.id="outfit";
    const sizes=document.createElement("button");sizes.textContent="M";outfit.appendChild(sizes);document.body.appendChild(outfit);
    render(<ShopSignupPopup/>);
    fireEvent.pointerDown(sizes);vi.advanceTimersByTime(48_000);
    expect(document.querySelector("dialog")).not.toHaveAttribute("open");
    expect(sessionStorage.getItem("mully_purchase_intent_v1")).toBe("1");
    outfit.remove();vi.useRealTimers();
  });
  it("still opens automatically for a browsing visitor",()=>{
    vi.useFakeTimers();render(<ShopSignupPopup/>);
    fireEvent.pointerDown(document.body);vi.advanceTimersByTime(48_000);
    expect(document.querySelector("dialog")).toHaveAttribute("open");
    vi.useRealTimers();
  });
  it("still opens on an explicit signup click with items in the bag",()=>{
    state.cartCount=1;render(<ShopSignupPopup/>);
    fireEvent(window,new Event("mully:open-signup"));expect(document.querySelector("dialog")).toHaveAttribute("open");
  });
});
