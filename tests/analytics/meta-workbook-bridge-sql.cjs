// Focused PGlite composition, not native PostgreSQL or operating authority.
// Prior domain guards are doubles. Only the exact two B5 public wrappers and
// the new Meta SQL execute here; this does not prove a joint B5/Meta claim.
const { PGlite } = require("@electric-sql/pglite");
const { readFileSync } = require("node:fs");
const { createHash } = require("node:crypto");
const assert = require("node:assert/strict");
const file = "sql/analytics/meta_workbook_bridge.review.sql";
const raw = readFileSync(file, "utf8");
const b5 = readFileSync(process.argv[2] || "sql/analytics/source_session_report_input.review.sql", "utf8");
assert.equal(createHash("sha256").update(b5).digest("hex"),
  "45194ac97898e5a5673cff1fea97bb6d0017e33f6a63cedf032774ed47935c02");
const extract = (text, start) => {
  const at = text.indexOf(start); assert(at >= 0);
  const end = text.indexOf("end $$;", at); assert(end >= 0);
  return text.slice(at, end + "end $$;".length);
};
const db = new PGlite();
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const digest = async value => (await q("select lean_private.partition_digest($1::jsonb) v", [JSON.stringify(value)]))[0].v;
const check = async (name, fn) => { await fn(); console.log(`PASS ${name}`); };
const refuse = async (fn, pattern) => {
  await db.exec("begin");
  try { await assert.rejects(fn, pattern); } finally { await db.exec("rollback"); }
};
(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role; create role lean_posthog_reader;
    create role unexpected_fixture;
    create schema lean_private;
    create table lean_private.report_builds(run_id text primary key,enabled boolean default false,completed_at timestamptz);
    create table lean_private.full_builds(run_id text primary key,project_ref text,base_run text,enabled boolean default false,
      attempts int default 0,completed_at timestamptz);
    create table lean_private.google_auto_cycles(cycle_id uuid primary key,body jsonb);
    create table lean_private.marketing_spend_days(generation_id text primary key,project_ref text,shop text,
      account_id text,report_date date,packet jsonb,packet_hash text,enabled boolean default false);
    create table lean_private.marketing_spend_bindings(run_id text primary key,enabled boolean default false);
    create table lean_private.sales_event_cycles(cycle_id uuid primary key);
    create table lean_private.sales_event_window_inputs(run_id text primary key,base_run text,payload_hash text,enabled boolean default false);
    create table lean_private.source_session_report_claims(claim_id uuid primary key,run_id text,enabled boolean,mode text,packet jsonb,binding jsonb);
    create table lean_private.test_control(b5_ok boolean,expire_during_finish boolean,expire_during_input boolean);
    insert into lean_private.test_control values(true,false,false);
    create table lean_private.test_audit(name text);
    create function lean_private.source_session_report_bound(p uuid,e boolean)
    returns lean_private.source_session_report_claims language plpgsql set search_path=pg_catalog as $$
    declare r lean_private.source_session_report_claims; begin
      if not(select b5_ok from lean_private.test_control) then raise exception 'synthetic B5 revoked'; end if;
      insert into lean_private.test_audit values('B5 fence');
      select * into strict r from lean_private.source_session_report_claims where claim_id=p; return r;
    end $$;
    create function public.lean_google_auto_cycle_binding(p uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
    declare v jsonb; begin select body into strict v from lean_private.google_auto_cycles where cycle_id=p for share;
      if clock_timestamp()>=(v->>'validUntil')::timestamptz then raise exception 'Google expired'; end if; return v; end $$;
    create function public.lean_full_inputs(p_run text,p_project_ref text) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
    begin
      if (select expire_during_input from lean_private.test_control) then
        update lean_private.google_auto_cycles set body=jsonb_set(body,'{validUntil}',to_jsonb((clock_timestamp()-interval '1 second')::text));
      end if;
      return '{"state":"ready","financialDomain":"unchanged","inputHash":"old"}'::jsonb;
    end $$;
    create function public.lean_full_finish(p_run text,p_project_ref text,p_token uuid,p_input_hash text,p_facts jsonb,p_reports jsonb,p_manifest jsonb)
    returns boolean language plpgsql security definer set search_path=pg_catalog as $$
    begin
      if public.lean_full_inputs(p_run,p_project_ref)->>'inputHash'<>p_input_hash then return false; end if;
      insert into lean_private.test_audit values('core finish');
      if (select expire_during_finish from lean_private.test_control) then
        update lean_private.google_auto_cycles set body=jsonb_set(body,'{validUntil}',to_jsonb((clock_timestamp()-interval '1 second')::text));
      end if;
      return true;
    end $$;
    grant execute on function public.lean_full_inputs(text,text),
      public.lean_full_finish(text,text,uuid,text,jsonb,jsonb,jsonb) to service_role;
    create function public.lean_marketing_spend_hourly_register(p jsonb) returns boolean language plpgsql security definer set search_path=pg_catalog
      as $$ begin raise exception 'must already be registered'; end $$;
    create function public.lean_marketing_spend_bind(p_run text,p_project_ref text,p_generations text[],p_inventory jsonb,p_approval_ref text,p_actor_ref text)
    returns boolean language plpgsql security definer set search_path=pg_catalog as $$
    begin insert into lean_private.marketing_spend_bindings(run_id) values(p_run); return true; end $$;`);
  const partition = readFileSync("sql/analytics/036_partitioned_refresh.sql", "utf8");
  await db.exec(extract(partition, "create function lean_private.partition_canonical"));
  await db.exec(`create function lean_private.partition_digest(v jsonb) returns text language sql immutable strict set search_path=pg_catalog
    as $$ select encode(sha256(convert_to(lean_private.partition_canonical(v),'UTF8')),'hex') $$;
    create function public.lean_sales_event_window_register(p jsonb) returns text language plpgsql security definer set search_path=pg_catalog as $$
    begin
      insert into lean_private.report_builds(run_id) values(p->>'baseRunId');
      insert into lean_private.full_builds(run_id,project_ref,base_run) values(p->>'runId',p->>'projectRef',p->>'baseRunId');
      insert into lean_private.sales_event_window_inputs(run_id,base_run,payload_hash)
        values(p->>'runId',p->>'baseRunId',lean_private.partition_digest(p));
      return p->>'runId';
    end $$;`);
  await db.exec(extract(b5, "alter function public.lean_full_inputs(text,text) rename"));
  await db.exec(extract(b5, "alter function public.lean_full_finish(text,text,uuid,text,jsonb,jsonb,jsonb) rename"));
  await check("unbound new SQL refuses without replacing either prior wrapper", async () => {
    await assert.rejects(() => db.exec(raw), /UNBOUND/); await db.exec("rollback");
  });
  const pins = (await q(`select jsonb_agg(jsonb_build_object(
    'signature',n.nspname||'.'||p.proname||'('||replace(oidvectortypes(p.proargtypes),', ',',')||')',
    'oid',p.oid::text,'ownerOid',p.proowner::text,
    'definitionSha256',encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex'),
    'aclSha256',encode(sha256(convert_to(coalesce(p.proacl::text,'null'),'UTF8')),'hex'))) pins
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and
    (p.proname like 'lean_full_inputs%' or p.proname like 'lean_full_finish%' or p.proname in
    ('lean_google_auto_cycle_binding','lean_sales_event_window_register','lean_marketing_spend_bind','lean_marketing_spend_hourly_register'))`))[0].pins;
  await q("select set_config('lean.meta_workbook_install_contract',$1,false)", [JSON.stringify(pins)]);
  await check("accurately pinned pre-B5 or changed front doors cannot satisfy Meta install order", async () => {
    await db.exec("begin; alter function public.lean_full_inputs_before_source_session_report(text,text) rename to missing_b5_alias;");
    await assert.rejects(() => db.exec(raw), /UNBOUND/); await db.exec("rollback");
    await db.exec(`begin; create or replace function public.lean_full_inputs(p_run text,p_project_ref text) returns jsonb
      language plpgsql security definer set search_path=pg_catalog as $$ begin return '{}'::jsonb; end $$;`);
    await assert.rejects(() => db.exec(raw), /exact B5 first/); await db.exec("rollback");
  });
  await db.exec("alter default privileges grant all on tables to unexpected_fixture; alter default privileges grant execute on functions to unexpected_fixture;");
  await db.exec(raw);
  await check("new table, owner functions and renamed aliases deny unexpected defaults and runtime stage", async () => {
    assert.equal((await q(`select has_table_privilege('unexpected_fixture','lean_private.meta_workbook_bridges','SELECT') v`))[0].v, false);
    for (const signature of ["public.lean_meta_workbook_stage(jsonb,jsonb,jsonb)",
      "public.lean_meta_workbook_enable(text,text,text,text)",
      "public.lean_full_inputs_before_meta_workbook(text,text)"])
      for (const role of ["service_role", "unexpected_fixture"])
        assert.equal((await q("select has_function_privilege($1,$2,'EXECUTE') v", [role, signature]))[0].v, false);
    assert.equal((await q("select has_function_privilege('service_role','public.lean_full_inputs(text,text)','EXECUTE') v"))[0].v, true);
  });
  const id = "11111111-1111-4111-8111-111111111111", now = Date.now();
  const t = s => new Date(now + s * 1000).toISOString(), project = "xnfjdbpjuaezxjgargto", shop = "mullybox-store.myshopify.com";
  const c = { version: 1, contractId: "synthetic", revision: "1", projectRef: project, shop, googleCycleId: id,
    googleCaptureSha256: "a".repeat(64), metaPacketSha256: "b".repeat(64), runId: `meta_workbook_${id}`,
    baseRunId: `meta_workbook_base_${id}`, date: "2026-10-06", notBefore: t(-20), expiresAt: t(90),
    maxAgeSeconds: 3600, approvalRef: "synthetic:owner", actorRef: "synthetic:actor", controlApprovalRef: "synthetic:control" };
  const packet = { version: 2, approvalRef: c.approvalRef, actorRef: c.actorRef,
    source: { capturedAt: t(-10) }, control: { capturedAt: t(-10), approvalRef: c.controlApprovalRef } };
  const g = { projectRef: project, shop, date: c.date, accountId: "4335795219", loginCustomerId: "9552995078",
    captureSha256: c.googleCaptureSha256, startedAt: t(-30), validUntil: t(120),
    packet: { asOf: t(-22), manifest: { fixture: "actual-saved-double" },
      base: { completedAt: t(-22) }, costControl: { capturedAt: t(-23) }, receipt: { accountMetadata: [] } } };
  const scopeDefinition = { declaredAt: t(-1000), approvalRef: "synthetic:standing" };
  const spend = { version: 1, binding: { version: 1, cycleId: id, grantId: c.contractId, grantRevision: "1",
    projectRef: project, shop, runId: c.runId, date: c.date, standingScopeDigest: await digest(scopeDefinition),
    googleCaptureSha256: c.googleCaptureSha256, metaPacketSha256: c.metaPacketSha256 },
    cycleStartedAt: g.startedAt, validUntil: c.expiresAt, scopeDefinition,
    google: { manifest: g.packet.manifest, base: g.packet.base, control: g.packet.costControl, accountMetadata: [] },
    meta: { packet, freshnessCutoffAt: t(-20), receipts: Object.fromEntries(["metadata","accountHours","campaignHours"]
      .map(k => [k, { startedAt: t(-12), finishedAt: t(-10), status: 200, bodySha256: "c".repeat(64) }])) } };
  spend.digest = await digest(spend);
  const scope = { runId: c.runId, baseRunId: c.baseRunId, projectRef: project, shop, fromDate: c.date, throughDate: c.date,
    oldestCaptureAt: t(-5), authority: { approvalRef: c.approvalRef, actorRef: c.actorRef, readyAt: t(-2),
      expiresAt: c.expiresAt, maxAgeSeconds: c.maxAgeSeconds }, evidence: {},
    fullPolicy: { asOf: t(-2), freshGoogleSpend: { manifest: g.packet.manifest, controls: [g.packet.costControl],
      marketingInventory: { complete: false, independentlyExtracted: false, capturedAt: scopeDefinition.declaredAt,
        approvalRef: scopeDefinition.approvalRef } } } };
  await q("insert into lean_private.google_auto_cycles values($1,$2)", [id, JSON.stringify(g)]);
  await q("insert into lean_private.marketing_spend_days values($1,$2,$3,$4,$5,$6,$7,false)",
    [`meta_workbook_${id}`,project,shop,"act_2796962933960445",c.date,JSON.stringify(packet),c.metaPacketSha256]);
  const stage = (contract = c, p = spend) => q("select public.lean_meta_workbook_stage($1,$2,$3)", [JSON.stringify(contract),JSON.stringify(scope),JSON.stringify(p)]);
  await check("owner stage refuses old target, changed Google hash, missing Meta cutoff and expired authority", async () => {
    await refuse(() => stage({ ...c, runId: `auto_${id}` }), /owner contract/);
    await refuse(() => stage({ ...c, googleCaptureSha256: "0".repeat(64) }), /fresh separate/);
    await refuse(() => stage({ ...c, expiresAt: t(-1) }), /fresh separate/);
    const p = structuredClone(spend); delete p.meta.freshnessCutoffAt;
    await refuse(() => stage(c,p), /registered source/);
  });
  await check("stage is create-only and leaves Google unchanged and every new target disabled", async () => {
    await stage();
    assert.deepEqual((await q("select body from lean_private.google_auto_cycles"))[0].body, g);
    for (const table of ["full_builds","report_builds","marketing_spend_days","marketing_spend_bindings","meta_workbook_bridges"])
      assert.equal((await q(`select bool_or(enabled) v from lean_private.${table}`))[0].v, false);
    await refuse(() => stage(), /fresh separate/);
    await refuse(() => q("update lean_private.meta_workbook_bridges set contract='{}'"), /immutable/);
  });
  const cd = await digest(c), sd = await digest(scope);
  await check("owner enable requires exact contract, scope and spend digests", async () => {
    await refuse(() => q("select public.lean_meta_workbook_enable($1,$2,$3,$4)",
      [c.runId,"0".repeat(64),sd,spend.digest]), /enable pins/);
    assert.equal((await q("select enabled from lean_private.meta_workbook_bridges"))[0].enabled,false);
  });
  await q("select public.lean_meta_workbook_enable($1,$2,$3,$4)", [c.runId,cd,sd,spend.digest]);
  await check("enable takes write authority locks before event, base and full and refuses a second enable", async () => {
    // Source-order proof only. PGlite does not prove multi-session deadlock freedom.
    const body = raw.slice(raw.indexOf("create function public.lean_meta_workbook_enable"));
    assert(body.indexOf("false,true)") < body.indexOf("report_builds where run_id=r.base_run for update"));
    assert(body.indexOf("report_builds where run_id=r.base_run for update") < body.indexOf("full_builds where run_id=p_run for update"));
    assert.match(raw, /if p_write then\s+select \* into strict r from lean_private\.meta_workbook_bridges where run_id=p_run for update/);
    assert.match(raw, /perform 1 from lean_private\.sales_event_window_inputs\s+where [^;]+for update;/);
    assert.doesNotMatch(raw, /perform 1 from lean_private\.sales_event_window_inputs\s+where [^;]+for share;/);
    await refuse(() => q("select public.lean_meta_workbook_enable($1,$2,$3,$4)", [c.runId,cd,sd,spend.digest]), /enable pins/);
  });
  const input = async run => (await q("select public.lean_full_inputs($1,$2) v",[run,project]))[0].v;
  const finish = async () => q("select public.lean_full_finish($1,$2,$3,$4,'{}','{}','{}') v",
    [c.runId,project,id,(await input(c.runId)).inputHash]);
  await check("absent domains delegate byte-equivalent input; Meta adds only its named input", async () => {
    assert.deepEqual(await input("absent"), { state: "ready", financialDomain: "unchanged", inputHash: "old" });
    const p = await input(c.runId); assert.deepEqual(p.nativeSpendWindow, spend); assert.equal(p.financialDomain,"unchanged");
    assert.equal((await finish())[0].v,true);
  });
  await check("exact B5-first public wrappers preserve both optional inputs and execute both finish fences", async () => {
    // Synthetic paired-authority double tests wrapper mechanics only. There is
    // no genuine paired B5 claim for this new one-off bridge in this release.
    await q("insert into lean_private.source_session_report_claims values($1,$2,true,'paired_financial',$3,$4)",
      [id,c.runId,JSON.stringify({ fixture: "B5-native" }),JSON.stringify({ fixture: "B5-binding" })]);
    const p = await input(c.runId);
    assert.deepEqual(p.nativeSpendWindow,spend); assert.deepEqual(p.sourceSessionReport,{ fixture: "B5-native" });
    assert.equal((await finish())[0].v,true);
    assert((await q("select count(*)::int n from lean_private.test_audit where name='B5 fence'"))[0].n>=4);
    await refuse(async () => { await db.exec("update lean_private.test_control set b5_ok=false"); await input(c.runId); }, /B5 revoked/);
    await refuse(async () => { await db.exec("update lean_private.meta_workbook_bridges set revoked=true"); await finish(); }, /unavailable/);
  });
  await check("delegated write followed by expired Google authority rolls back through Meta's final fence", async () => {
    const count = (await q("select count(*)::int n from lean_private.test_audit"))[0].n;
    await refuse(async () => { await db.exec("update lean_private.test_control set expire_during_finish=true"); await finish(); }, /Google expired/);
    assert.equal((await q("select count(*)::int n from lean_private.test_audit"))[0].n,count);
    assert.deepEqual((await q("select body from lean_private.google_auto_cycles"))[0].body,g);
  });
  await check("delegated input expiring authority is refused by the final input fence", async () => {
    await refuse(async () => { await db.exec("update lean_private.test_control set expire_during_input=true"); await input(c.runId); }, /Google expired/);
    assert.deepEqual((await q("select body from lean_private.google_auto_cycles"))[0].body,g);
  });
  console.log("11 focused SQL groups PASS; PGlite, no native/provider/source/production calls");
})().finally(() => db.close()).catch(e => { console.error(e); process.exitCode=1; });
