/** Offline standalone Node24 Vercel function. No build-time or source reads. */
import ts from "typescript";
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const out=process.argv[2],root=process.cwd();
if(!out || !isAbsolute(out) || existsSync(out))throw new Error("new_absolute_package_directory_required");
const source=join(root,"src/lib/analytics/observedReportDelivery.ts"),modules=[];
const program=ts.createProgram([source],{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,
  strict:true,skipLibCheck:true,noEmitOnError:true});
const errors=ts.getPreEmitDiagnostics(program).filter(d=>d.category===ts.DiagnosticCategory.Error);
if(errors.length)throw new Error(ts.formatDiagnosticsWithColorAndContext(errors,{
  getCurrentDirectory:()=>root,getCanonicalFileName:f=>f,getNewLine:()=>"\n"}));
program.emit(undefined,(_file,text)=>modules.push(text));
if(modules.length!==1)throw new Error("unexpected_dependency");
mkdirSync(join(out,".vercel/output/functions/api/analytics/reports/observed.func"),{recursive:true});
const fn=join(out,".vercel/output/functions/api/analytics/reports/observed.func");
writeFileSync(join(fn,"core.cjs"),modules[0]);
writeFileSync(join(fn,"index.cjs"),`"use strict";
const {observedReportGet}=require("./core.cjs");
module.exports=async(req,res)=>{
  try {
    const headers=new Headers();
    for(const [key,value] of Object.entries(req.headers))if(value!==undefined)headers.set(key,Array.isArray(value)?value.join(","):value);
    const request=new Request("https://fixed.invalid"+req.url,{method:req.method,headers});
    const result=await observedReportGet(request);
    res.statusCode=result.status;result.headers.forEach((value,key)=>res.setHeader(key,value));
    res.end(Buffer.from(await result.arrayBuffer()));
  } catch {res.statusCode=503;res.setHeader("Cache-Control","no-store");res.end();}
};
`);
writeFileSync(join(fn,".vc-config.json"),JSON.stringify({runtime:"nodejs24.x",handler:"index.cjs",launcherType:"Nodejs",
  shouldAddHelpers:false,maxDuration:30}));
writeFileSync(join(out,".vercel/output/config.json"),JSON.stringify({version:3,routes:[
  {src:"/api/analytics/reports/observed",dest:"/api/analytics/reports/observed"},
  {src:"/.*",status:404}]}));
writeFileSync(join(out,"vercel.json"),JSON.stringify({framework:null,installCommand:"",buildCommand:""}));
copyFileSync(join(root,"sql/analytics/043_observed_report_delivery.sql"),join(out,"043_observed_report_delivery.sql"));
copyFileSync(join(root,"docs/analytics/OBSERVED_REPORT_DELIVERY.md"),join(out,"OPERATOR.md"));
copyFileSync(join(root,"scripts/analytics/observed-reports-scope.json"),join(out,"scope-template.json"));
const digest=x=>createHash("sha256").update(x).digest("hex");
writeFileSync(join(out,"manifest.json"),JSON.stringify({
  sourceCommit:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),runtime:"nodejs24.x",
  path:"/api/analytics/reports/observed",method:"GET",defaultEnabled:false,
  providerCalls:0,dbRequestsPerGet:1,maxResponseBytes:1048576,
  coreSha256:digest(modules[0]),adapterSha256:digest(readFileSync(join(fn,"index.cjs"))),
  sqlSha256:digest(readFileSync(join(out,"043_observed_report_delivery.sql"))),
},null,2)+"\n");
