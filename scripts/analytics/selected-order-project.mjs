/** Offline owner extraction -> existing workbook formulas -> comparison artifact. */
import ts from "typescript";
import { readFileSync,writeFileSync,mkdtempSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
const [inputFile,outputFile,getFile] = process.argv.slice(2);
if (!inputFile || !outputFile) throw new Error("usage: selected-order-project.mjs owner-input.json aggregate.json [saved-get.json]");
const dir = mkdtempSync(join(tmpdir(),"selected-order-"));
try {
  const program = ts.createProgram(["src/lib/analytics/selectedOrderProjection.ts"],{
    target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,outDir:dir,
    strict:true,skipLibCheck:true,esModuleInterop:true,resolveJsonModule:true,
  });
  const errors = ts.getPreEmitDiagnostics(program).filter(d => d.category === ts.DiagnosticCategory.Error);
  if (errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(errors,{
    getCurrentDirectory:()=>process.cwd(),getCanonicalFileName:f=>f,getNewLine:()=>"\n",
  }));
  program.emit();
  const {projectSelectedOrder} = createRequire(import.meta.url)(join(dir,"selectedOrderProjection.js"));
  const input = JSON.parse(readFileSync(inputFile,"utf8")), payload = projectSelectedOrder(input);
  const canonical = v => Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v !== null && typeof v === "object" ?
    `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}` : JSON.stringify(v);
  if (getFile && canonical(JSON.parse(readFileSync(getFile,"utf8"))) !== canonical(payload))
    throw new Error("saved_GET_differs_from_existing_formulas");
  writeFileSync(outputFile,JSON.stringify(payload,null,2)+"\n",{flag:"wx",mode:0o600});
  console.log(JSON.stringify({inputHash:input.inputHash,storeRows:payload.store_daily.length,
    productRows:payload.product_daily.length,reportDates:payload.store_daily.map(r=>r.report_date),
    scope:"selected_order_sample",certified:false,completeWindow:false,
    savedStoreMatches:true,policyScope:"prior_single_order_test",
    observed:payload.store_daily.map(r=>({date:r.report_date,gross:r.gross_merchandise_sales_usd,
      net:r.net_merchandise_sales_usd,total:r.total_sales_usd,orders:r.eligible_orders,aov:r.aov_usd})),
    getMatches:getFile ? true : "not_checked",posthogReadback:"parent_required"},null,2));
} finally { rmSync(dir,{recursive:true,force:true}); }
