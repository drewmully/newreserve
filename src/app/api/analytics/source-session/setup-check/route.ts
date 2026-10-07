import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { getClientIp } from "@/app/api/_lib/clientIp";
import { runSourceSessionSetup } from "@/lib/analytics/journeySourceSessionSetup";
export const runtime="nodejs";
export const maxDuration=10;
const empty=(status:number)=>new NextResponse(null,{status,headers:{"Cache-Control":"no-store"}});
export async function POST(req:NextRequest) {
  if(process.env.LEAN_SOURCE_SESSION_SETUP_ENABLED!=="true")return empty(404);
  if(req.nextUrl.search)return empty(400);
  if(!checkRateLimit("lean_source_setup",getClientIp(req.headers)??"unknown",{maxHits:3,windowMs:60000}).allowed)return empty(429);
  try {
    const reader=req.body?.getReader();if(!reader)return empty(400);
    const chunks:Uint8Array[]=[];let bytes=0;
    try {for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.length;
      if(bytes>64){await reader.cancel();return empty(413);}chunks.push(part.value);}}
    finally{reader.releaseLock();}
    const body=JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if(!body || typeof body!=="object" || Array.isArray(body) || Object.keys(body).join(",")!=="phase" ||
      !["source","copy"].includes(body.phase))return empty(400);
    const result=await runSourceSessionSetup(req,body.phase);
    return NextResponse.json(result,{status:result.state==="verified"?200:202,headers:{"Cache-Control":"no-store"}});
  }catch{return empty(400);}
}
