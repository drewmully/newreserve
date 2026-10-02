import { beforeEach, describe, expect, it, vi } from "vitest";
const store = vi.hoisted(() => ({
  docs: new Map<string, Record<string, unknown>>(),
  writes: [] as Array<{path:string;data:Record<string, unknown>}>,
  fail: false,
}));
vi.mock("@/lib/firebase-admin", () => {
  type Ref = {path:string;collection:(name:string)=>{doc:(id?:string)=>Ref}};
  const ref = (path:string): Ref => ({
    path, collection:(name:string)=>({doc:(id="event")=>ref(`${path}/${name}/${id}`)}),
  });
  return {adminDb:{
    collection:(name:string)=>({doc:(id:string)=>ref(`${name}/${id}`)}),
    runTransaction:async (fn:(tx:unknown)=>Promise<void>)=>{
      if(store.fail)throw new Error("storage unavailable");
      const writes: typeof store.writes = [];
      const put = (r:{path:string},data:Record<string,unknown>)=>writes.push({path:r.path,data});
      await fn({
        get:async(r:{path:string})=>({exists:store.docs.has(r.path),data:()=>store.docs.get(r.path)}),
        set:put,update:put,
      });
      for(const w of writes)store.docs.set(w.path,{...store.docs.get(w.path),...w.data});
      store.writes.push(...writes);
    },
  }};
});
vi.mock("firebase-admin/firestore",()=>({FieldValue:{serverTimestamp:()=>"server-time"}}));
import { POST } from "@/app/api/shop/signup/route";
import { EMAIL_CONSENT, SMS_CONSENT, normalizeSignupPhone } from "@/lib/shopSignup";
const req=(body:unknown,origin="https://mymully.com")=>new Request("https://mymully.com/api/shop/signup",{
  method:"POST",headers:{"Content-Type":"application/json",Origin:origin,"x-forwarded-for":"192.0.2.1"},body:JSON.stringify(body),
});
const email={stage:"email",email:" Test@Example.com ",interest:"tops",consent:true};
beforeEach(()=>{store.docs.clear();store.writes.length=0;store.fail=false});
describe("shop consent capture",()=>{
  it("rejects missing consent, invalid inputs and cross-origin requests without writes",async()=>{
    for(const body of [null,[],{...email,consent:false},{...email,email:"bad"},{...email,interest:"invented"},{stage:"sms",phone:"555",consent:true}]){
      expect((await POST(req(body))).status).toBe(400);
    }
    expect((await POST(req(email,"https://elsewhere.test"))).status).toBe(403);
    expect(store.writes).toHaveLength(0);
  });
  it("saves email before SMS, binds the follow-up receipt and records separate exact consent",async()=>{
    const r=await POST(req(email));expect(r.status).toBe(200);
    const {receipt,reward}=await r.json();
    expect(reward).toEqual({code:"MULLYEDIT10",percent:10});
    const lead=store.writes.find(w=>/^shop_marketing_leads\/[^/]+$/.test(w.path))!;
    expect(lead.data).toMatchObject({email:"test@example.com",interest:"tops",sendingStatus:"not_synced",emailConsent:{text:EMAIL_CONSENT,channel:"email",granted:true}});
    expect(lead.data).not.toHaveProperty("phone");
    expect((await POST(req({stage:"sms",phone:"(248) 555-0123",receipt,consent:false}))).status).toBe(400);
    const sms=await POST(req({stage:"sms",phone:"(248) 555-0123",receipt,consent:true}));
    expect(sms.status).toBe(200);
    expect((await sms.json()).reward).toEqual({code:"MULLYTEXT15",percent:15});
    expect(store.docs.get(lead.path)).toMatchObject({phone:"+12485550123",smsConsent:{text:SMS_CONSENT,channel:"sms"},email:"test@example.com"});
    expect((await POST(req({stage:"sms",phone:"+12485550124",receipt,consent:true}))).status).toBe(403);
  });
  it("will not attach SMS with an invented receipt or claim storage success on failure",async()=>{
    expect((await POST(req({stage:"sms",phone:"+12485550123",receipt:"a".repeat(64),consent:true}))).status).toBe(403);
    store.fail=true;
    const spy=vi.spyOn(console,"error").mockImplementation(()=>{});
    expect((await POST(req(email))).status).toBe(503);spy.mockRestore();
    expect(store.writes).toHaveLength(0);
  });
  it("honors honeypots and shared persistent rate limits",async()=>{
    await POST(req({...email,company:"bot"}));expect(store.writes).toHaveLength(0);
    for(let i=0;i<12;i++)expect((await POST(req(email))).status).toBe(200);
    expect((await POST(req(email))).status).toBe(429);
  });
  it("normalizes US and international numbers without guessing malformed input",()=>{
    expect(normalizeSignupPhone("248-555-0123")).toBe("+12485550123");
    expect(normalizeSignupPhone("+44 7700 900123")).toBe("+447700900123");
    expect(normalizeSignupPhone("call me")).toBeNull();
  });
});
