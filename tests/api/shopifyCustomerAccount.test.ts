import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({collection:vi.fn(),transaction:vi.fn(),getUser:vi.fn(),fetch:vi.fn()}));
vi.mock("@/lib/firebase-admin",()=>({adminAuth:{getUser:mocks.getUser},adminDb:{collection:mocks.collection,runTransaction:mocks.transaction}}));
import { beginCustomerConnection, completeCustomerConnection, customerApiConfigured, customerGraphQL, getCustomerOutfitContracts, getLinkedCustomerSession, nativeEnrollmentEnabled, openCustomerSession, sealCustomerSession } from "@/app/api/_lib/shopifyCustomerAccount";
import { canActOnContract, isOutfitContract, type CustomerContract } from "@/lib/shopifyCustomerContracts";
beforeEach(()=>{
  vi.clearAllMocks();
  vi.stubEnv("SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID","public-client");
  vi.stubEnv("SHOPIFY_CUSTOMER_SESSION_SECRET",Buffer.alloc(32,7).toString("base64"));
  vi.stubEnv("SHOPIFY_NATIVE_SUBSCRIPTIONS_ENABLED","false");
  vi.stubGlobal("fetch",mocks.fetch);
});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe("native customer identity and session security",()=>{
  it("recognizes expired authentication returned in a GraphQL HTTP 200 response",async()=>{
    mocks.fetch.mockResolvedValue({ok:true,status:200,json:async()=>({errors:[{extensions:{code:"UNAUTHENTICATED"}}]})});
    await expect(customerGraphQL("token","query { customer { id } }")).rejects.toMatchObject({code:"connect_required"});
  });
  it("blocks a stored customer session belonging to a different profile",async()=>{
    const encrypted=sealCustomerSession({accessToken:"token",refreshToken:null,expiresAt:Date.now()+3600000,customerId:"gid://shopify/Customer/1"});
    mocks.collection.mockImplementation(name=>({doc:()=>({get:async()=>name==="users"
      ?{data:()=>({shopify_customer_id:"2"})}
      :{exists:true,data:()=>({encrypted})}})}));
    await expect(getCustomerOutfitContracts("uid")).rejects.toMatchObject({code:"account_mismatch"});
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("refreshes expired tokens under a lease and stores only encrypted replacements",async()=>{
    const stored: Record<string,unknown>={encrypted:sealCustomerSession({accessToken:"old",refreshToken:"refresh",expiresAt:0,customerId:"gid://shopify/Customer/1"})};
    const ref={get:async()=>({exists:true,data:()=>({...stored})})};
    mocks.collection.mockReturnValue({doc:()=>ref});
    mocks.transaction.mockImplementation(async fn=>fn({
      get:async()=>({data:()=>({...stored})}),
      update:(_ref:unknown,value:Record<string,unknown>)=>Object.assign(stored,value),
      set:(_ref:unknown,value:Record<string,unknown>)=>{Object.keys(stored).forEach(key=>delete stored[key]);Object.assign(stored,value);},
    }));
    mocks.fetch.mockResolvedValue({ok:true,json:async()=>({access_token:"renewed",refresh_token:"rotated",expires_in:3600})});
    expect(await getLinkedCustomerSession("uid")).toMatchObject({accessToken:"renewed",refreshToken:"rotated"});
    expect(JSON.stringify(stored)).not.toContain("rotated");
    expect(openCustomerSession(String(stored.encrypted))).toMatchObject({accessToken:"renewed"});
    expect(stored.refreshLease).toBeUndefined();
  });
  it("encrypts credentials with authenticated encryption and rejects tampering",()=>{
    const sealed=sealCustomerSession({accessToken:"secret-access",refreshToken:"secret-refresh",customerId:"gid://shopify/Customer/1"});
    expect(sealed).not.toContain("secret-access");
    expect(openCustomerSession(sealed)).toMatchObject({accessToken:"secret-access"});
    const parts=sealed.split(".");parts[1]=Buffer.alloc(16,0).toString("base64url");
    expect(()=>openCustomerSession(parts.join("."))).toThrow();
  });
  it("requires explicit rollout approval as well as configuration",()=>{
    expect(customerApiConfigured()).toBe(true);
    expect(nativeEnrollmentEnabled()).toBe(false);
    vi.stubEnv("SHOPIFY_NATIVE_SUBSCRIPTIONS_ENABLED","true");
    expect(nativeEnrollmentEnabled()).toBe(true);
    vi.stubEnv("SHOPIFY_CUSTOMER_SESSION_SECRET","short");
    expect(nativeEnrollmentEnabled()).toBe(false);
  });
  it("does not start linking for unverified Firebase email addresses",async()=>{
    mocks.getUser.mockResolvedValue({email:"a@example.test",emailVerified:false});
    await expect(beginCustomerConnection("uid")).rejects.toMatchObject({code:"verify_email"});
    expect(mocks.collection).not.toHaveBeenCalled();
  });
  it("creates a high-entropy PKCE challenge, fixed callback and private one-use state",async()=>{
    mocks.getUser.mockResolvedValue({email:"a@example.test",emailVerified:true});
    const set=vi.fn().mockResolvedValue(undefined);
    mocks.collection.mockReturnValue({doc:()=>({set})});
    const result=await beginCustomerConnection("uid");
    const url=new URL(result.url);
    expect(result.state).toHaveLength(43);
    expect(url.searchParams.get("code_challenge")).toHaveLength(43);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe("https://www.mymully.com/api/shopify-customer/callback");
    expect(url.searchParams.has("code_verifier")).toBe(false);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({uid:"uid",verifier:expect.any(String)}));
  });
  it("consumes callback state and rejects a different Shopify customer email",async()=>{
    const del=vi.fn();
    mocks.collection.mockReturnValue({doc:()=>({})});
    mocks.transaction.mockImplementation(async fn=>fn({get:async()=>({data:()=>({uid:"uid",verifier:"private-pkce",expiresAt:Date.now()+60000})}),delete:del}));
    mocks.fetch.mockResolvedValueOnce({ok:true,json:async()=>({access_token:"customer-token",expires_in:3600})})
      .mockResolvedValueOnce({ok:true,status:200,json:async()=>({data:{customer:{id:"gid://shopify/Customer/2",emailAddress:{emailAddress:"other@example.test"}}}})});
    mocks.getUser.mockResolvedValue({email:"a@example.test",emailVerified:true});
    await expect(completeCustomerConnection("a".repeat(43),"code")).rejects.toMatchObject({code:"account_mismatch"});
    expect(del).toHaveBeenCalledOnce();
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });
  it("rejects expired and replayed OAuth state without exchanging a code",async()=>{
    mocks.collection.mockReturnValue({doc:()=>({})});
    mocks.transaction.mockImplementation(async fn=>fn({get:async()=>({data:()=>undefined}),delete:vi.fn()}));
    await expect(completeCustomerConnection("a".repeat(43),"code")).rejects.toMatchObject({code:"expired_callback"});
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("identifies only the intended SKU and never matches a contract by price",()=>{
    const make=(sku:string,truncated=false)=>({lines:{nodes:[{sku}],pageInfo:{hasNextPage:truncated}}}) as CustomerContract;
    expect(isOutfitContract(make("RES-MEM-SEAS"))).toBe(true);
    expect(isOutfitContract(make("ACCESS"))).toBe(false);
    expect(isOutfitContract(make("RES-MEM-SEAS",true))).toBe(false);
    expect(canActOnContract("pause","ACTIVE")).toBe(true);
    expect(canActOnContract("resume","CANCELLED")).toBe(false);
  });
});
