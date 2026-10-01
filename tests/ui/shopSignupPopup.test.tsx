import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("next/navigation",()=>({usePathname:()=>"/shop"}));
const state=vi.hoisted(()=>({cartOpen:false}));
vi.mock("@/app/context/MembershipContext",()=>({useMembership:()=>state}));
import { ShopSignupPopup } from "@/app/shop/components/ShopSignupPopup";
beforeEach(()=>{
  state.cartOpen=false;localStorage.clear();
  HTMLDialogElement.prototype.showModal=function(){this.setAttribute("open","")};
  HTMLDialogElement.prototype.close=function(){this.removeAttribute("open");this.dispatchEvent(new Event("close"))};
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:true,json:async()=>({ok:true,receipt:"a".repeat(64),reward:{code:"MULLY-"+"A".repeat(24),percent:10,redeemed:false}})}));
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
    await screen.findByText("Make it 15%.");
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toMatchObject({stage:"email",interest:"tops",consent:true});
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(localStorage.getItem("mully_shop_reward_v1")).toBe("MULLY-"+"A".repeat(24));
    fireEvent.click(screen.getByRole("button",{name:"Keep my 10%"}));
    expect(screen.getByText("Your 10% is ready.")).toBeVisible();
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
    expect(screen.queryByText("Make it 15%.")).not.toBeInTheDocument();
  });
  it("upgrades the displayed reward to 15% after separate SMS consent",async()=>{
    render(<ShopSignupPopup/>);fireEvent(window,new Event("mully:open-signup"));
    fireEvent.click(screen.getByRole("button",{name:/The full edit/}));
    fireEvent.submit(screen.getByRole("button",{name:/Get 10% off/}).closest("form")!);
    await screen.findByText("Make it 15%.");
    vi.mocked(fetch).mockResolvedValueOnce({ok:true,json:async()=>({ok:true,reward:{code:"MULLY-"+"A".repeat(24),percent:15,redeemed:false}})} as Response);
    fireEvent.change(screen.getByLabelText("Mobile number (optional)"),{target:{value:"2485550123"}});
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.submit(screen.getByRole("button",{name:/Get 15% off/}).closest("form")!);
    await screen.findByText("Your 15% is ready.");
    expect(JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string)).toMatchObject({stage:"sms",consent:true,receipt:"a".repeat(64)});
  });
  it("does not advance or cache a reward when code creation fails",async()=>{
    vi.mocked(fetch).mockResolvedValueOnce({ok:false,json:async()=>({error:"reward_unavailable"})} as Response);
    render(<ShopSignupPopup/>);fireEvent(window,new Event("mully:open-signup"));
    fireEvent.click(screen.getByRole("button",{name:/The full edit/}));
    fireEvent.submit(screen.getByRole("button",{name:/Get 10% off/}).closest("form")!);
    await screen.findByRole("alert");
    expect(localStorage.getItem("mully_shop_reward_v1")).toBeNull();
    expect(screen.queryByText("Make it 15%.")).not.toBeInTheDocument();
  });
});
