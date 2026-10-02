import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(()=>({
  auth:vi.fn(),contracts:vi.fn(),graphql:vi.fn(),begin:vi.fn(),complete:vi.fn(),enabled:vi.fn(),
}));
vi.mock("@/app/api/_lib/loopUserContext",()=>({verifyFirebaseBearer:mocks.auth}));
vi.mock("@/app/api/_lib/shopifyCustomerAccount",()=>({
  CustomerAccountError:class extends Error { constructor(public status:number,public code:string,message:string){super(message)} },
  getCustomerOutfitContracts:mocks.contracts,customerGraphQL:mocks.graphql,
  beginCustomerConnection:mocks.begin,completeCustomerConnection:mocks.complete,
  nativeEnrollmentEnabled:mocks.enabled,CUSTOMER_STATE_COOKIE:"__Host-mully-shopify-state",
}));
import { CustomerAccountError } from "@/app/api/_lib/shopifyCustomerAccount";
import { POST as action } from "@/app/api/shopify-customer/subscriptions/[action]/route";
import { GET as list } from "@/app/api/shopify-customer/subscriptions/route";
import { POST as connect } from "@/app/api/shopify-customer/connect/route";
import { GET as callback } from "@/app/api/shopify-customer/callback/route";
import { GET as ready } from "@/app/api/shopify-customer/ready/route";

const id="gid://shopify/SubscriptionContract/123";
const contract={id,status:"ACTIVE",nextBillingDate:"2027-01-02T14:00:00Z",billingPolicy:{interval:"MONTH",intervalCount:{count:3}},
  lines:{nodes:[{id:"line-1",title:"Seasonal Edit",sku:"RES-MEM-SEAS",quantity:1,currentPrice:{amount:"299.95",currencyCode:"USD"}}],pageInfo:{hasNextPage:false,endCursor:null}}};
const request=(body:unknown={contractId:id})=>new NextRequest("https://www.mymully.com/api/shopify-customer/subscriptions/pause",{
  method:"POST",headers:{Authorization:"Bearer test","Content-Type":"application/json"},body:JSON.stringify(body),
});
const act=(name:string,body?:unknown)=>action(request(body),{params:Promise.resolve({action:name})});
beforeEach(()=>{
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue("uid-1");
  mocks.contracts.mockResolvedValue({contracts:[contract],session:{accessToken:"server-only-token"}});
  mocks.graphql.mockResolvedValue({subscriptionContractPause:{contract:{id,status:"PAUSED"},userErrors:[]}});
  mocks.begin.mockResolvedValue({state:"random-state",url:"https://shopify.com/authentication/56105304256/oauth/authorize"});
  mocks.complete.mockResolvedValue(undefined);
  mocks.enabled.mockReturnValue(false);
});
describe("native Shopify subscription routes",()=>{
  it("requires Firebase authentication before listing or changing contracts",async()=>{
    mocks.auth.mockRejectedValue(new Error("Unauthorized"));
    expect((await act("pause")).status).toBe(401);
    expect((await list(request())).status).toBe(401);
    expect(mocks.contracts).not.toHaveBeenCalled();
    expect(mocks.graphql).not.toHaveBeenCalled();
  });
  it("only changes an authenticated customer’s matching contract",async()=>{
    expect((await act("pause")).status).toBe(200);
    expect(mocks.contracts).toHaveBeenCalledWith("uid-1");
    expect(mocks.graphql).toHaveBeenCalledWith("server-only-token",expect.stringContaining("subscriptionContractPause"),{id});
  });
  it("rejects another customer’s contract ID without invoking any mutation",async()=>{
    expect((await act("cancel",{contractId:"gid://shopify/SubscriptionContract/999",customerId:"someone-else"})).status).toBe(404);
    expect(mocks.graphql).not.toHaveBeenCalled();
  });
  it("rejects arbitrary IDs and unsupported billing-changing actions",async()=>{
    expect((await act("pause",{contractId:"not-a-contract"})).status).toBe(400);
    expect((await act("change-plan")).status).toBe(400);
    expect((await act("__proto__")).status).toBe(400);
    expect(mocks.graphql).not.toHaveBeenCalled();
  });
  it("does not reactivate a cancelled contract",async()=>{
    mocks.contracts.mockResolvedValue({contracts:[{...contract,status:"CANCELLED"}],session:{accessToken:"token"}});
    expect((await act("resume")).status).toBe(409);
    expect(mocks.graphql).not.toHaveBeenCalled();
  });
  it("surfaces Shopify validation failures without reporting success or retrying writes",async()=>{
    mocks.graphql.mockResolvedValue({subscriptionContractPause:{contract:null,userErrors:[{message:"Cannot pause this subscription."}]}});
    const res=await act("pause");
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("Cannot pause");
    expect(mocks.graphql).toHaveBeenCalledOnce();
  });
  it("returns live display data but never customer tokens",async()=>{
    const res=await list(request());const body=await res.json();
    expect(body.subscriptions[0]).toMatchObject({id,price:299.95,currency:"USD",status:"ACTIVE",intervalCount:3});
    expect(JSON.stringify(body)).not.toContain("server-only-token");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
  it("distinguishes the customer connection step from missing merchant permissions",async()=>{
    mocks.contracts.mockRejectedValue(new CustomerAccountError(401,"connect_required","Please connect."));
    expect((await (await list(request())).json()).needsConnection).toBe(true);
    mocks.contracts.mockRejectedValue(new CustomerAccountError(503,"permissions_required","Permissions not enabled."));
    const res=await list(request());
    expect(res.status).toBe(503);
    expect((await res.json()).needsConnection).toBe(false);
  });
  it("uses a secure HTTP-only same-site state cookie and does not expose PKCE verifiers",async()=>{
    const res=await connect(request());
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");
    expect(res.headers.get("set-cookie")).toContain("Secure");
    expect(res.headers.get("set-cookie")).toContain("SameSite=lax");
    expect(await res.json()).toEqual({url:"https://shopify.com/authentication/56105304256/oauth/authorize"});
  });
  it.each([undefined,"wrong-state"])("rejects OAuth callbacks without the same-browser state (%s)",async(cookie)=>{
    const res=await callback(new NextRequest("https://www.mymully.com/api/shopify-customer/callback?state=state-1&code=code",{headers:cookie?{cookie:`__Host-mully-shopify-state=${cookie}`}:{}}));
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toContain("shopify=connection_failed");
  });
  it("links a validated callback and returns to the in-site manager",async()=>{
    const res=await callback(new NextRequest("https://www.mymully.com/api/shopify-customer/callback?state=state-1&code=code",{headers:{cookie:"__Host-mully-shopify-state=state-1"}}));
    expect(mocks.complete).toHaveBeenCalledWith("state-1","code");
    expect(res.headers.get("location")).toBe("https://www.mymully.com/account?manage=shopify&shopify=connected");
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });
  it("defaults enrollment to disabled without exposing configuration",async()=>{
    expect(await ready().json()).toEqual({enabled:false});
  });
});
