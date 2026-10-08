// New SQL reader only, against synthetic source tables. No provider calls or
// native-PostgreSQL concurrency claim. Run separately from Vitest to bound RAM.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { PGlite } = require("@electric-sql/pglite");
const db = new PGlite();
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
let checks = 0;
const check = async (name, fn) => { await fn(); checks++; console.log("PASS " + name); };
(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create role lean_posthog_reader; create schema lean_private;
    create table lean_private.google_auto_cycles(cycle_id uuid primary key,report_date date,state text,accepted_at timestamptz,
      committed_at timestamptz,capture_packet jsonb,capture_sha256 text);
    create table lean_private.marketing_spend_days(generation_id text primary key, project_ref text,shop text,account_id text,
      report_date date,packet jsonb,packet_hash text,enabled boolean);
    create function public.lean_production_reports_read() returns jsonb language sql as
      $$select '{"store_daily":[],"product_daily":[]}'::jsonb$$;`);
  await db.exec(fs.readFileSync("sql/analytics/saved_marketing_report.review.sql", "utf8"));
  const read = async (t = "a".repeat(64)) => (await q("select public.lean_saved_marketing_read($1) v", [t]))[0].v;
  await check("default off and no reader/table access for unrelated roles", async () => {
    assert.equal(await read(), null);
    for (const role of ["anon", "authenticated", "lean_posthog_reader"])
      assert.equal((await q("select has_function_privilege($1,'public.lean_saved_marketing_read(text)','EXECUTE') v", [role]))[0].v, false);
    assert.equal((await q("select has_table_privilege('service_role','lean_private.saved_marketing_delivery','SELECT') v"))[0].v, false);
    assert.equal((await q("select has_function_privilege('service_role','public.lean_saved_marketing_read(text)','EXECUTE') v"))[0].v, true);
  });
  const date = (await q("select ((now() at time zone 'America/New_York')::date-1)::text d"))[0].d;
  const sourceId = "11111111-1111-4111-8111-111111111111";
  const google = { manifest: { projectRef: "xnfjdbpjuaezxjgargto" }, base: { accountId: "4335795219" },
    fixture: "latest-only" };
  const meta = { generationId: `meta_ingest_daily_${date}`, projectRef: "xnfjdbpjuaezxjgargto",
    shop: "mullybox-store.myshopify.com", accountId: "act_2796962933960445", date,
    source: { capturedAt: "2026-10-08T17:02:45.087877Z" } };
  await q(`insert into lean_private.google_auto_cycles values($1,$2,'accepted',now(),now(),$3,
    encode(sha256(convert_to($3::jsonb::text,'UTF8')),'hex'))`, [sourceId, date, JSON.stringify(google)]);
  await q(`insert into lean_private.marketing_spend_days values($1,$2,$3,$4,$5,$6,
    encode(sha256(convert_to($6::jsonb::text,'UTF8')),'hex'),false)`,
  [meta.generationId, meta.projectRef, meta.shop, meta.accountId, date, JSON.stringify(meta)]);
  const before = await q("select * from lean_private.marketing_spend_days");
  await q(`update lean_private.saved_marketing_delivery set enabled=true,source_id=$1,token_sha256=$2,
    approval_ref='fixture:read-only',not_before=now()-interval '1 minute',expires_at=now()+interval '1 day',
    allow_disabled_meta=true,include_observed_sales=true`, [sourceId, "a".repeat(64)]);
  await check("dedicated hash authorizes exact immutable packets, never enables sources", async () => {
    assert.equal(await read("c".repeat(64)), null);
    const r = await read();
    assert.equal(r.days.length, 1); assert.equal(r.days[0].date, date);
    assert.deepEqual(r.days[0].google, google); assert.deepEqual(r.days[0].meta, meta);
    assert.deepEqual(r.observed, { store_daily: [], product_daily: [] });
    assert.equal(r.scope.audience, `posthog:353503:source:${sourceId}`);
    assert.deepEqual(await q("select * from lean_private.marketing_spend_days"), before);
  });
  await check("current observed reader is delegated, never a cached Google commerce base", async () => {
    await db.exec(`create or replace function public.lean_production_reports_read() returns jsonb language sql as
      $$select '{"store_daily":[],"product_daily":[],"privacy_fixture":"current"}'::jsonb$$`);
    assert.equal((await read()).observed.privacy_fixture, "current");
    await db.exec("update lean_private.saved_marketing_delivery set include_observed_sales=false");
    assert.equal((await read()).observed, null);
  });
  await check("seven closed days ordered deterministically, missing data remains null", async () => {
    await db.exec("update lean_private.saved_marketing_delivery set lookback_days=7");
    const r = await read();
    assert.equal(r.days.length, 7); assert.equal(r.days[6].date, date);
    assert.deepEqual(r.days.map(d => d.date), r.days.map(d => d.date).sort());
    assert.equal(r.days[0].google, null); assert.equal(r.days[0].meta, null);
    await db.exec("update lean_private.saved_marketing_delivery set lookback_days=1");
  });
  await check("latest malformed saved source blocks rather than falling back", async () => {
    await db.exec("update lean_private.marketing_spend_days set packet_hash=repeat('f',64)");
    await assert.rejects(read(), /meta hash/);
    await db.exec("update lean_private.marketing_spend_days set packet_hash=encode(sha256(convert_to(packet::text,'UTF8')),'hex')");
    await db.exec("update lean_private.google_auto_cycles set capture_sha256=repeat('f',64)");
    await assert.rejects(read(), /google hash/);
    await db.exec("update lean_private.google_auto_cycles set capture_sha256=encode(sha256(convert_to(capture_packet::text,'UTF8')),'hex')");
  });
  await check("unaccepted cycle is not borrowed, while independently stored Meta remains available", async () => {
    await db.exec("update lean_private.google_auto_cycles set state='held'");
    const r = await read(); assert.equal(r.days[0].google, null); assert.deepEqual(r.days[0].meta, meta);
  });
  await check("expiry closes delivery, finite bounds and source-only opt-in are required", async () => {
    await assert.rejects(db.exec("update lean_private.saved_marketing_delivery set allow_disabled_meta=false"), /check constraint/);
    await assert.rejects(db.exec("update lean_private.saved_marketing_delivery set expires_at=now()+interval '30 days'"), /check constraint/);
    await assert.rejects(db.exec("update lean_private.saved_marketing_delivery set lookback_days=8"), /check constraint/);
    await db.exec("update lean_private.saved_marketing_delivery set not_before=now()-interval '2 days',expires_at=now()-interval '1 day'");
    assert.equal(await read(), null);
  });
  console.log(`${checks} SQL checks passed`);
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => db.close());
