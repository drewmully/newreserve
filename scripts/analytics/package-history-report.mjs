/** Offline bundle of the real consumer. No install, source call, mutation or deployment. */
import ts from "typescript";
import { readFileSync,writeFileSync,mkdirSync,existsSync,copyFileSync } from "node:fs";
import { resolve,relative,join,isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const root=process.cwd(),out=process.argv[2];
if(!out||!isAbsolute(out)||existsSync(out))throw new Error("new_absolute_package_directory_required");
const rootDir=join(root,"src"),virtual=join(root,".history-virtual");
const options={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true,
  resolveJsonModule:true,strict:true,skipLibCheck:true,noEmitOnError:true,rootDir,outDir:virtual};
const program=ts.createProgram([join(rootDir,"lib/analytics/historyReportOperator.ts")],options);
const diagnostics=ts.getPreEmitDiagnostics(program).filter(d=>d.category===ts.DiagnosticCategory.Error);
if(diagnostics.length)throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics,{
  getCurrentDirectory:()=>root,getCanonicalFileName:f=>f,getNewLine:()=>"\n"}));
const modules=new Map();
if(program.emit(undefined,(file,text)=>modules.set(relative(virtual,file),file.endsWith(".json")?
  `module.exports=${text};`:text)).emitSkipped)throw new Error("history_bundle_compile");
const bundle=`"use strict";
const modules={${[...modules].map(([name,text])=>`${JSON.stringify(name)}:(require,module,exports)=>{${text}\n}`).join(",\n")}};
const cache={};
function load(name){
  if(name.startsWith("node:"))return require(name);
  if(cache[name])return cache[name].exports;
  if(!modules[name])throw new Error("history_bundle_module");
  const m={exports:{}};cache[name]=m;
  modules[name](id=>id.startsWith(".")?load(require("node:path").posix.normalize(require("node:path").posix.join(
    require("node:path").posix.dirname(name),id))+(/\\.(js|json)$/.test(id)?"":".js")):load(id),m,m.exports);return m.exports;
}
module.exports=load("lib/analytics/historyReportOperator.js");
if(require.main===module){(async()=>{
  const fs=require("node:fs");let result;
  try{result=await module.exports.runHistoryReportOperator(process.env,JSON.parse(fs.readFileSync("operator-config.json","utf8")));}
  catch{result={status:"failed",certified:false};}
  fs.mkdirSync("public",{recursive:true});fs.writeFileSync("public/history-report.json",JSON.stringify(result));
  console.log(JSON.stringify(result));
})().catch(()=>{process.exitCode=1;});}
`;
mkdirSync(out,{recursive:true});
writeFileSync(join(out,"operator.cjs"),bundle);
writeFileSync(join(out,"operator-config.json"),JSON.stringify({enabled:false,runId:"REPLACE_REVIEWED_RUN",maxSteps:1,maxProviderRequests:8},null,2));
writeFileSync(join(out,"package.json"),JSON.stringify({private:true,engines:{node:"24.x"}}));
writeFileSync(join(out,"vercel.json"),JSON.stringify({framework:null,installCommand:"",buildCommand:"node operator.cjs"}));
copyFileSync(join(root,"sql/analytics/041_history_report_bridge.sql"),join(out,"041_history_report_bridge.sql"));
copyFileSync(join(root,"docs/analytics/HISTORY_REPORT_BRIDGE.md"),join(out,"OPERATOR.md"));
const digest=x=>createHash("sha256").update(x).digest("hex");
const manifest={sourceCommit:execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim(),
  runtime:"build-only-node24",enabled:false,providerCallsPerOrder:{minimum:4,maximum:8},
  whole61821OrderEstimate:{minimum:247284,maximum:494568},rawDataInPublicOutput:false,
  bundleSha256:digest(bundle),sqlSha256:digest(readFileSync(join(out,"041_history_report_bridge.sql")))};
writeFileSync(join(out,"manifest.json"),JSON.stringify(manifest,null,2)+"\n");
console.log(JSON.stringify({package:resolve(out),...manifest}));
