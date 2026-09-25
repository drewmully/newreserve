/** Offline standalone selected-order GET; does not change the 043 deployment. */
import ts from "typescript";
import { readFileSync,writeFileSync,mkdirSync,existsSync,copyFileSync } from "node:fs";
import { join,isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const out=process.argv[2],root=process.cwd();
if(!out || !isAbsolute(out) || existsSync(out))throw new Error("new_absolute_package_directory_required");
const program=ts.createProgram([join(root,"src/lib/analytics/selectedOrderDelivery.ts")],{
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,strict:true,skipLibCheck:true,noEmitOnError:true});
const errors=ts.getPreEmitDiagnostics(program).filter(d=>d.category===ts.DiagnosticCategory.Error);
if(errors.length)throw new Error(ts.formatDiagnosticsWithColorAndContext(errors,{
  getCurrentDirectory:()=>root,getCanonicalFileName:f=>f,getNewLine:()=>"\n"}));
const modules=[];program.emit(undefined,(_file,text)=>modules.push(text));
if(modules.length!==1)throw new Error("unexpected_dependency");
const fn=join(out,".vercel/output/functions/api/analytics/reports/selected-order.func");
mkdirSync(fn,{recursive:true});writeFileSync(join(fn,"core.cjs"),modules[0]);
writeFileSync(join(fn,"index.cjs"),`"use strict";
const {selectedOrderGet}=require("./core.cjs");
module.exports=async(req,res)=>{
  try {
    const headers=new Headers();
    for(const [key,value] of Object.entries(req.headers))if(value!==undefined)headers.set(key,Array.isArray(value)?value.join(","):value);
    const result=await selectedOrderGet(new Request("https://fixed.invalid"+req.url,{method:req.method,headers}));
    res.statusCode=result.status;result.headers.forEach((value,key)=>res.setHeader(key,value));
    res.end(Buffer.from(await result.arrayBuffer()));
  } catch {res.statusCode=503;res.setHeader("Cache-Control","no-store");res.end();}
};
`);
writeFileSync(join(fn,".vc-config.json"),JSON.stringify({runtime:"nodejs24.x",handler:"index.cjs",launcherType:"Nodejs",
  shouldAddHelpers:false,maxDuration:30}));
writeFileSync(join(out,".vercel/output/config.json"),JSON.stringify({version:3,routes:[
  {src:"/api/analytics/reports/selected-order",dest:"/api/analytics/reports/selected-order"},{src:"/.*",status:404}]}));
writeFileSync(join(out,"vercel.json"),JSON.stringify({framework:null,installCommand:"",buildCommand:""}));
copyFileSync(join(root,"sql/analytics/044_selected_order_delivery.sql"),join(out,"044_selected_order_delivery.sql"));
copyFileSync(join(root,"docs/analytics/SELECTED_ORDER_DELIVERY.md"),join(out,"OPERATOR.md"));
const digest=x=>createHash("sha256").update(x).digest("hex");
writeFileSync(join(out,"manifest.json"),JSON.stringify({
  sourceCommit:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),
  path:"/api/analytics/reports/selected-order",method:"GET",defaultEnabled:false,providerCalls:0,dbRequestsPerGet:1,
  coreSha256:digest(modules[0]),adapterSha256:digest(readFileSync(join(fn,"index.cjs"))),
  sqlSha256:digest(readFileSync(join(out,"044_selected_order_delivery.sql"))),
},null,2)+"\n");
