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
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:true,json:async()=>({ok:true,receipt:"a".repeat(64)})}));
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
    fireEvent.submit(screen.getByRole("button",{name:/Get my edit/}).closest("form")!);
    await screen.findByText("A little heads-up?");
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toMatchObject({stage:"email",interest:"tops",consent:true});
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    fireEvent.click(screen.getByRole("button",{name:"Email is enough"}));
    expect(screen.getByText("Consider it curated.")).toBeVisible();
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
    fireEvent.submit(screen.getByRole("button",{name:/Get my edit/}).closest("form")!);
    await waitFor(()=>expect(screen.getByRole("alert")).toHaveTextContent("couldn’t save"));
    expect(screen.queryByText("A little heads-up?")).not.toBeInTheDocument();
  });
});
