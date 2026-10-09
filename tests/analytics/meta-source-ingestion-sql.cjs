// New source-only runtime + new SQL with real released P6 registrar, in PGlite.
// Fake HTTP only. This is not provider access or native PostgreSQL concurrency.
const fs = require("node:fs"), path = require("node:path");
const assert = require("node:assert/strict");
// Separate compilation from the PGlite process to fit the bounded test sandbox.
if(process.argv[2]==="--compile"){
  const ts=require("typescript"),root=path.resolve("src"),out=process.argv[3];
  require.extensions[".ts"]=(mod,file)=>{
    const code=ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{
      target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true,resolveJsonModule:true}}).outputText;
    const target=path.join(out,path.relative(root,file).replace(/\.ts$/,".js"));
    fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,code);mod._compile(code,file);
  };
  require(path.join(root,"lib/analytics/metaSourceIngestion.ts"));
  for(const file of Object.keys(require.cache).filter(f=>f.startsWith(root+"/")&&f.endsWith(".json"))){
    const target=path.join(out,path.relative(root,file));fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(file,target);
  }
  process.exit(0);
}
const scratch=fs.mkdtempSync(path.join(require("node:os").tmpdir(),"meta-source-sql-test-"));
require("node:child_process").execFileSync(process.execPath,[__filename,"--compile",scratch],{
  env:{...process.env,NODE_OPTIONS:"--max-old-space-size=256"},stdio:"inherit"});
const { runMetaSourceIngestion }=require(path.join(scratch,"lib/analytics/metaSourceIngestion.js"));
const { metaHourlyPacketFromCaptures }=require(path.join(scratch,"lib/analytics/metaHourlySpendInput.js"));
const { PGlite } = require("@electric-sql/pglite");
const db = new PGlite(), q = async (s,a=[]) => (await db.query(s,a)).rows;
const raw = fs.readFileSync("sql/analytics/meta_source_ingestion.review.sql","utf8");
const read = file => fs.readFileSync("sql/analytics/"+file,"utf8");
const extract = (s, start, end) => {
  const at=s.indexOf(start), until=s.indexOf(end,at); assert(at>=0&&until>=0);
  return s.slice(at,until+end.length);
};
let checks=0;
const check = async (name,fn) => { await fn(); checks++; console.log("PASS "+name); };
const refuse = async (fn,re) => {
  await db.exec("begin"); try { await assert.rejects(fn,re); } finally { await db.exec("rollback"); }
};
(async()=>{
  await db.exec(`create role service_role; create role anon; create role authenticated; create role unexpected;
    create schema lean_private;
    create table public.job_runs(id bigserial primary key,job_name text,started_at timestamptz default clock_timestamp(),
      finished_at timestamptz,status text default 'running',rows_in int default 0,rows_out int default 0,meta jsonb default '{}',error text);`);
  await db.exec(extract(read("multi_provider_spend_input.review.sql"),
    "create table lean_private.marketing_spend_days",");"));
  await db.exec(extract(read("meta_hourly_spend_registration.review.sql"),
    "create function public.lean_marketing_spend_hourly_register","$body$;"));
  await db.exec("revoke all on function public.lean_marketing_spend_hourly_register(jsonb) from public,service_role;");
  await db.exec(extract(read("036_partitioned_refresh.sql"),
    "create function lean_private.partition_canonical","end $$;"));
  await db.exec(`create function lean_private.partition_digest(v jsonb) returns text language sql immutable strict
    set search_path=pg_catalog as $$ select encode(sha256(convert_to(lean_private.partition_canonical(v),'UTF8')),'hex') $$;
    alter default privileges grant execute on functions to unexpected;`);
  await db.exec(raw);
  await check("only the narrow wrapper is granted to service role, not the owner registrar",async()=>{
    for(const role of ["anon","authenticated","unexpected"])
      assert.equal((await q("select has_function_privilege($1,'public.lean_meta_source_register(bigint,jsonb,jsonb,text)','EXECUTE') v",[role]))[0].v,false);
    assert.equal((await q("select has_function_privilege('service_role','public.lean_meta_source_register(bigint,jsonb,jsonb,text)','EXECUTE') v"))[0].v,true);
    assert.equal((await q("select has_function_privilege('service_role','public.lean_marketing_spend_hourly_register(jsonb)','EXECUTE') v"))[0].v,false);
  });
  const calls=[], captures=[];
  let savedJob, args, lastSqlError;
  const runtime={
    env:{CRON_SECRET:"synthetic-cron",META_MARKETING_API_TOKEN:"synthetic-token",META_AD_ACCOUNT_ID:"2796962933960445",
      VERCEL_ENV:"production",VERCEL_GIT_COMMIT_REF:"main"},
    now:Date.now,
    request:async input=>{
      calls.push(String(input)); const u=new URL(String(input)), level=u.searchParams.get("level");
      if(!level)return Response.json({id:"act_2796962933960445",account_id:"2796962933960445",
        currency:"USD",timezone_name:"America/Los_Angeles",account_status:1});
      // Actual runtime derives today's previous NY date and query bounds.
      const range=JSON.parse(u.searchParams.get("time_range"));
      return Response.json({data:[{account_id:"2796962933960445",account_currency:"USD",
        date_start:range.until,date_stop:range.until,
        hourly_stats_aggregated_by_advertiser_time_zone:"12:00:00 - 12:59:59",spend:"3.04",
        ...(level==="campaign"?{campaign_id:"123"}:{})}]});
    },
    runJob:async(name,fn)=>{
      savedJob=(await q("insert into public.job_runs(job_name,started_at) values($1,clock_timestamp()-interval '1 second') returning *",[name]))[0];
      try{return {ok:true,result:await fn({runId:savedJob.id,setMeta:v=>captures.push(v),bumpRows:()=>{}})}}
      catch(e){return {ok:false,error:e.message};}
    },
    readJob:async()=>({...savedJob,started_at:new Date(savedJob.started_at).toISOString()}),
    register:async value=>{
      args=value;
      try { return (await q("select public.lean_meta_source_register($1,$2,$3,$4) v",
        [value.p_job,JSON.stringify(value.p_packet),JSON.stringify(value.p_receipts),value.p_as_of]))[0].v; }
      catch(e){lastSqlError=e.message;throw e;}
    },
  };
  const request=()=>new Request("https://fixture.invalid/api/admin/cron/meta-ads-spend?source_only=1",
    {headers:{authorization:"Bearer synthetic-cron"}});
  await check("actual source runtime calls new SQL and released P6, storing exact disabled packet and database hash",async()=>{
    const r=await runMetaSourceIngestion(request(),runtime);
    assert.equal(r.status,200); assert.equal(r.body.ok,true,JSON.stringify({result:r.body,sql:lastSqlError,calls:calls.length}));
    assert.equal(calls.length,3);
    const row=(await q("select *,encode(sha256(convert_to(packet::text,'UTF8')),'hex') recomputed from lean_private.marketing_spend_days"))[0];
    assert.deepEqual(row.packet,args.p_packet); assert.equal(row.enabled,false); assert.equal(row.packet_hash,row.recomputed);
    assert.equal(row.packet.source.rows[0].spend,"3.04");
    assert.equal((await q("select meta->'meta_source_registered' v from public.job_runs where id=$1",[savedJob.id]))[0].v,true);
  });
  await check("daily index consumes failed or existing attempts before HTTP but leaves ordinary jobs repeatable",async()=>{
    assert.equal((await runMetaSourceIngestion(request(),runtime)).status,409); assert.equal(calls.length,3);
    await q("insert into public.job_runs(job_name) values('ordinary'),('ordinary')");
    assert.equal((await q("select count(*)::int n from public.job_runs where job_name='ordinary'"))[0].n,2);
  });
  const invoke=async a=>(await q("select public.lean_meta_source_register($1,$2,$3,$4)",
    [a.p_job,JSON.stringify(a.p_packet),JSON.stringify(a.p_receipts),a.p_as_of]));
  await check("complete independently empty native scope is stored as a disabled empty packet",async()=>{
    await db.exec("begin");
    try{
      // Reset only synthetic fixture rows inside this rolled-back test.
      await q("update public.job_runs set meta='{}' where id=$1",[args.p_job]);
      await db.exec("delete from lean_private.marketing_spend_days");
      const a=structuredClone(args);
      for(const k of ["accountHours","campaignHours"]){
        const body=JSON.stringify({data:[]});a.p_receipts[k].response={data:[]};
        a.p_receipts[k].bodyBytes=Buffer.byteLength(body);
        a.p_receipts[k].bodySha256=require("node:crypto").createHash("sha256").update(body).digest("hex");
      }
      const p=a.p_packet;
      a.p_packet=metaHourlyPacketFromCaptures({projectRef:p.projectRef,shop:p.shop,generationId:p.generationId,
        accountId:p.accountId,date:p.date,approvalRef:p.approvalRef,actorRef:p.actorRef,
        controlApprovalRef:p.control.approvalRef,freshnessCutoffAt:new Date(savedJob.started_at).toISOString(),
        asOf:a.p_as_of,...a.p_receipts});
      await invoke(a);
      const row=(await q("select packet,enabled from lean_private.marketing_spend_days"))[0];
      assert.equal(row.enabled,false);assert.equal(row.packet.source.verifiedEmpty,true);
      assert.deepEqual(row.packet.source.rows,[]);assert.deepEqual(row.packet.control.rows,[]);
    }finally{await db.exec("rollback");}
  });
  await check("same running job cannot register twice",async()=>{await refuse(()=>invoke(args),/job or receipt scope/);});
  // Refusal cases reuse one retained fake capture inside rolled-back transactions.
  // Clearing a marker here is fixture setup only, never an operating recovery.
  for(const bad of ["wrong_job","expired","wrong_account","changed_amount","changed_packet","paging","body_bytes_type","row_type"]){
    await check("refuses "+bad,async()=>{
      await refuse(async()=>{
        await q("update public.job_runs set meta='{}' where id=$1",[args.p_job]);
        const a=structuredClone(args);
        if(bad==="wrong_job")await q("update public.job_runs set job_name='other' where id=$1",[a.p_job]);
        if(bad==="expired")await q("update public.job_runs set started_at=clock_timestamp()-interval '2 minutes' where id=$1",[a.p_job]);
        if(bad==="wrong_account")a.p_receipts.metadata.response.account_id="999";
        if(bad==="changed_amount")a.p_receipts.accountHours.response.data[0].spend="3.05";
        if(bad==="changed_packet")a.p_packet.source.rows[0].spend="9.99";
        if(bad==="paging")a.p_receipts.accountHours.response.paging={next:"synthetic"};
        if(bad==="body_bytes_type")a.p_receipts.metadata.bodyBytes=String(a.p_receipts.metadata.bodyBytes);
        if(bad==="row_type")a.p_receipts.accountHours.response.data[0].account_id=2796962933960445;
        await invoke(a);
      },/Meta source/);
    });
  }
  console.log(`${checks} focused SQL/runtime groups PASS; fake HTTP only, no production operations`);
})().finally(async()=>{await db.close();fs.rmSync(scratch,{recursive:true,force:true});})
  .catch(e=>{console.error(e);process.exitCode=1;});
