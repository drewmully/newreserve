// Real new migration/RPCs and released P6/report reader. Fake provider HTTP.
// PGlite is not a proof of native concurrent transactions or production wiring.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
if (process.argv[2] === "--compile") {
  const ts = require("typescript"), root = path.resolve("src"), out = process.argv[3];
  require.extensions[".ts"] = (mod, file) => {
    const code = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, resolveJsonModule: true,
    } }).outputText;
    const target = path.join(out, path.relative(root, file).replace(/\.ts$/, ".js"));
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, code); mod._compile(code, file);
  };
  require(path.join(root, "lib/analytics/marketingSourceRefresh.ts"));
  for (const file of Object.keys(require.cache).filter(f => f.startsWith(root + "/") && f.endsWith(".json"))) {
    const target = path.join(out, path.relative(root, file));
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(file, target);
  }
  process.exit(0);
}
const scratch = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "marketing-jobs-sql-"));
require("node:child_process").execFileSync(process.execPath, [__filename, "--compile", scratch], {
  env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=256" }, stdio: "inherit",
});
const { refreshMarketingSource } = require(path.join(scratch, "lib/analytics/marketingSourceRefresh.js"));
const { prepareSavedMarketingReport } = require(path.join(scratch, "lib/analytics/savedMarketingReport.js"));
const { evidenceDigest } = require(path.join(scratch, "lib/analytics/evidenceIntake.js"));
const { captureMarketingSource } = require(path.join(scratch, "lib/analytics/marketingSourceCapture.js"));
const { metaHourlyWindow } = require(path.join(scratch, "lib/analytics/metaHourlySpendInput.js"));
const { nyDate } = require(path.join(scratch, "lib/analytics/primitives.js"));
const { PGlite } = require("@electric-sql/pglite");
const db = new PGlite(), q = async (sql, args = []) => (await db.query(sql, args)).rows;
const read = name => fs.readFileSync(`sql/analytics/${name}`, "utf8");
function extract(sql, from, until) {
  const start = sql.indexOf(from), end = sql.indexOf(until, start); assert(start >= 0 && end >= 0);
  return sql.slice(start, end + until.length);
}
let checks = 0;
async function check(name, fn) { await fn(); checks++; console.log("PASS " + name); }
async function transaction(fn) { await db.exec("begin"); try { await fn(); } finally { await db.exec("rollback"); } }
(async () => {
  const { marketingEnv, nativeMarketing } = await import("../fixtures/marketing-source-native.mjs");
  await db.exec(`create role anon; create role authenticated; create role service_role; create role unexpected;
    create schema lean_private;
    create table public.job_runs(id bigserial primary key,job_name text,started_at timestamptz default clock_timestamp(),
      finished_at timestamptz,status text default 'running',rows_in int default 0,rows_out int default 0,meta jsonb default '{}',error text);
    create table lean_private.google_auto_cycles(cycle_id uuid primary key,report_date date,state text,
      accepted_at timestamptz,committed_at timestamptz,capture_packet jsonb,capture_sha256 text);
    create function public.lean_production_reports_read() returns jsonb language sql as
      $$select '{"store_daily":[],"product_daily":[]}'::jsonb$$;`);
  await db.exec(extract(read("multi_provider_spend_input.review.sql"), "create table lean_private.marketing_spend_days", ");"));
  await db.exec(extract(read("meta_hourly_spend_registration.review.sql"),
    "create function public.lean_marketing_spend_hourly_register", "$body$;"));
  await db.exec("revoke all on function public.lean_marketing_spend_hourly_register(jsonb) from public,service_role;");
  await db.exec(extract(read("036_partitioned_refresh.sql"), "create function lean_private.partition_canonical", "end $$;"));
  await db.exec(`create function lean_private.partition_digest(v jsonb) returns text language sql immutable strict
    set search_path=pg_catalog as $$select encode(sha256(convert_to(lean_private.partition_canonical(v),'UTF8')),'hex')$$;`);
  await db.exec(read("saved_marketing_report.review.sql"));
  await db.exec("alter default privileges grant execute on functions to unexpected");
  await db.exec(read("marketing_source_jobs.review.sql"));
  const rpcOrder = {
    claim: ["p_provider", "p_lane", "p_date", "p_actor", "p_reason"],
    commit: ["p_job", "p_token", "p_packet", "p_receipts", "p_digest"],
    read: ["p_job", "p_token"], fail: ["p_job", "p_token", "p_code", "p_retry_seconds"],
    health: [], pause: ["p_provider", "p_actor", "p_reason"],
  };
  const rpc = async (name, args) => {
    const fields = rpcOrder[name.replace("lean_marketing_source_", "")]; assert(fields);
    const values = fields.map(k => typeof args[k] === "object" && args[k] !== null ? JSON.stringify(args[k]) : args[k]);
    return (await q(`select public.${name}(${fields.map((_, i) => "$" + (i + 1)).join(",")}) v`, values))[0].v;
  };
  const claim = (provider, lane = "primary", repair = null) => rpc("lean_marketing_source_claim", {
    p_provider: provider, p_lane: lane, p_date: repair?.date ?? null, p_actor: repair?.actor ?? null, p_reason: repair?.reason ?? null,
  });
  const savedRead = async () => (await q("select public.lean_saved_marketing_read(repeat('a',64)) v"))[0].v;
  // Positive Meta fixtures must not depend on wall-clock LA midnight or DST.
  // Pick a genuinely closed, supported correction day, never force primary due.
  function safeMetaDay(now) {
    const today = nyDate(new Date(now).toISOString());
    for (let age = 2; age <= 7; age++) {
      const date = new Date(Date.parse(`${today}T00:00:00Z`) - age * 86400000).toISOString().slice(0, 10);
      try {
        const w = metaHourlyWindow(date);
        if (Math.max(...w.providerHours.values()) + 3600000 <= now) return { date, age };
      } catch { /* Unsupported DST day is not a positive fixture. */ }
    }
    throw new Error("no safe Meta fixture day");
  }
  const { date, age } = safeMetaDay(Date.now());
  const repair = { date, actor: "fixture-admin", reason: "supported correction fixture" };
  const total = async () => prepareSavedMarketingReport(await savedRead()).marketing_totals.find(r => r.report_date === date);
  const captures = new Map(), sourceCalls = { google_ads: 0, meta_ads: 0 };
  function runtime(provider, options = {}) {
    const native = nativeMarketing(options);
    return { env: marketingEnv, now: Date.now, request: async (...args) => {
      sourceCalls[provider]++; return native.request(...args);
    }, rpc: async (name, args) => {
      if (name === "lean_marketing_source_commit") captures.set(provider, args);
      return rpc(name, args);
    } };
  }
  await check("migration is default-off with owner-only tables/helpers, service-only frontdoors", async () => {
    assert.equal((await claim("google_ads")).state, "disabled");
    assert.equal((await claim("meta_ads")).state, "disabled"); assert.equal(await savedRead(), null);
    for (const role of ["anon", "authenticated", "unexpected"]) {
      assert.equal((await q("select has_function_privilege($1,'public.lean_marketing_source_claim(text,text,text,text,text)','execute') v", [role]))[0].v, false);
      assert.equal((await q("select has_function_privilege($1,'public.lean_saved_marketing_read(text)','execute') v", [role]))[0].v, false);
    }
    assert.equal((await q("select has_table_privilege('service_role','lean_private.marketing_source_jobs','select') v"))[0].v, false);
    assert.equal((await q("select has_function_privilege('service_role','public.lean_saved_marketing_read_before_app_sources(text)','execute') v"))[0].v, false);
  });
  await db.exec("update lean_private.marketing_source_settings set enabled=true");
  await check("positive fixture chooses closed Pacific windows before LA midnight and around DST", async () => {
    for (const at of ["2026-10-09T04:30:00Z", "2026-11-04T04:30:00Z", "2026-03-10T04:30:00Z"]) {
      const chosen = safeMetaDay(Date.parse(at)), w = metaHourlyWindow(chosen.date);
      assert(chosen.age >= 2 && chosen.age <= 7);
      assert(Math.max(...w.providerHours.values()) + 3600000 <= Date.parse(at));
    }
    const notClosed = metaHourlyWindow("2026-10-08");
    assert(Math.max(...notClosed.providerHours.values()) + 3600000 > Date.parse("2026-10-09T04:30:00Z"));
  });
  for (const provider of ["google_ads", "meta_ads"]) await check(`${provider} native fake capture reaches real claimed commit and immutable storage`, async () => {
    let sqlError;
    const r = runtime(provider), inner = r.rpc;
    r.rpc = async (...args) => { try { return await inner(...args); } catch (e) { sqlError = e.message; throw e; } };
    const result = await refreshMarketingSource(provider, "primary", r, repair);
    assert.equal(result.body.state, "complete", JSON.stringify({ result, sqlError }));
    assert.equal(sourceCalls[provider], provider === "google_ads" ? 7 : 3);
    const a = captures.get(provider), row = (await q("select * from lean_private.marketing_source_jobs where job_id=$1", [a.p_job]))[0];
    assert.deepEqual(row.packet, a.p_packet); assert.deepEqual(row.receipts, a.p_receipts); assert.equal(row.digest, a.p_digest);
    assert.equal((await q("select status from public.job_runs where id=$1", [a.p_job]))[0].status, "ok");
    if (provider === "meta_ads") {
      const p6 = (await q("select * from lean_private.marketing_spend_days where generation_id=$1",
        [a.p_packet.meta.generationId]))[0];
      assert.equal(p6.enabled, false); assert.deepEqual(p6.packet, a.p_packet.meta);
    }
    assert.equal((await refreshMarketingSource(provider, "primary", r, repair)).body.state, "not_due");
    assert.equal(sourceCalls[provider], provider === "google_ads" ? 7 : 3);
  });
  await check("a delayed final public job write crossing deadline rolls back packet, job and settings changes", async () => {
    await transaction(async () => {
      // Fixture-only shortened remaining lease. The actual producer creates its
      // own new packet/receipts, rather than relabeling earlier captured data.
      const id = (await q(`insert into public.job_runs(job_name,started_at,status)
        values('fixture-delayed-commit',date_trunc('milliseconds',clock_timestamp()-interval '83 seconds'),'running')
        returning id`))[0].id;
      const j = (await q(`insert into lean_private.marketing_source_jobs(job_id,provider,report_date,slot,lane,attempt,
        state,lease_token,started_at,deadline) select id,'google_ads',$2,'fixture-delayed-'||id,'primary',1,'running',
        gen_random_uuid(),started_at,started_at+interval '90 seconds' from public.job_runs where id=$1 returning *`,
      [id, date]))[0];
      const native = nativeMarketing();
      const captured = await captureMarketingSource({ state: "claimed", jobId: String(id), token: j.lease_token,
        provider: "google_ads", date, startedAt: new Date(j.started_at).toISOString(),
        deadline: new Date(j.deadline).toISOString(), attempt: 1 },
      { env: marketingEnv, now: Date.now, request: native.request });
      await db.exec(`update lean_private.marketing_source_settings set retry_after=clock_timestamp()+interval '1 hour'
        where provider='google_ads';
        create function public.fixture_marketing_write_delay() returns trigger language plpgsql as $$
        declare until_at timestamptz;
        begin
          if new.job_name='fixture-delayed-commit' and new.status='ok' then
            select deadline into until_at from lean_private.marketing_source_jobs where job_id=new.id;
            perform pg_sleep(greatest(0,extract(epoch from until_at-clock_timestamp()))+0.05);
          end if;
          return new;
        end $$;
        create trigger fixture_marketing_write_delay before update on public.job_runs
          for each row execute function public.fixture_marketing_write_delay();`);
      const setting = (await q("select retry_after from lean_private.marketing_source_settings where provider='google_ads'"))[0];
      await db.exec("savepoint before_late_commit");
      await assert.rejects(() => rpc("lean_marketing_source_commit", { p_job: id, p_token: j.lease_token,
        p_packet: captured.packet, p_receipts: captured.receipts, p_digest: evidenceDigest(captured) }), /commit expiry/);
      await db.exec("rollback to savepoint before_late_commit");
      const remaining = (await q("select state,packet,receipts,finished_at from lean_private.marketing_source_jobs where job_id=$1", [id]))[0];
      assert.deepEqual(remaining, { state: "running", packet: null, receipts: null, finished_at: null });
      assert.equal((await q("select status from public.job_runs where id=$1", [id]))[0].status, "running");
      assert.deepEqual((await q("select retry_after from lean_private.marketing_source_settings where provider='google_ads'"))[0], setting);
      assert.equal(native.calls.length, 7);
    });
  });
  await check("idempotent readback accepts only exact input; committed revisions cannot change or delete", async () => {
    const a = captures.get("google_ads"), complete = await rpc("lean_marketing_source_commit", a);
    assert.equal(complete.state, "complete");
    const changed = structuredClone(a); changed.p_packet.google.costControl.totalCostMicros = "1";
    changed.p_digest = evidenceDigest({ packet: changed.p_packet, receipts: changed.p_receipts });
    await assert.rejects(() => rpc("lean_marketing_source_commit", changed), /different revision/);
    await assert.rejects(() => q("update lean_private.marketing_source_jobs set packet='{}' where job_id=$1", [a.p_job]), /immutable/);
    await assert.rejects(() => q("delete from lean_private.marketing_source_jobs where job_id=$1", [a.p_job]), /immutable/);
  });
  await check("native receipt fences reject account, amount, capture-clock and secret-bearing correspondence changes", async () => {
    for (const provider of ["google_ads", "meta_ads"]) {
      const a = captures.get(provider), field = provider === "google_ads" ? "google" : "meta";
      const invoke = (packet, receipts) => q(`select lean_private.marketing_${field}_validate(j,$2,$3,$4)
        from lean_private.marketing_source_jobs j where job_id=$1`,
      [a.p_job, JSON.stringify(packet), JSON.stringify(receipts), a.p_packet.asOf]);
      const p = structuredClone(a.p_packet[field]), r = structuredClone(a.p_receipts);
      if (provider === "google_ads") {
        r.requests[1].response.results[0].customer.id = "9999999999";
        await assert.rejects(() => invoke(p, r), /Google account/);
        r.requests[1].response.results[0].customer.id = "4335795219";
        p.costControl.totalCostMicros = "1"; await assert.rejects(() => invoke(p, r), /cost packet/);
        p.costControl.totalCostMicros = "2425689";
        r.requests[0].response = { access_token: "fixture-should-not-persist" };
        await assert.rejects(() => invoke(p, r), /credential receipt/);
      } else {
        r.metadata.response.account_id = "999";
        await assert.rejects(() => invoke(p, r), /Meta source account/);
        r.metadata.response.account_id = "2796962933960445";
        p.source.rows[0].spend = "1.00"; await assert.rejects(() => invoke(p, r), /packet correspondence/);
      }
      const badTime = structuredClone(a.p_receipts);
      if (provider === "google_ads") badTime.requests[0].startedAt = "2000-01-01T00:00:00.000Z";
      else badTime.metadata.startedAt = "2000-01-01T00:00:00.000Z";
      await assert.rejects(() => invoke(a.p_packet[field], badTime), /bounds|limits/);
    }
  });
  await check("explicit report admission preserves finite consumer scope and real full report normalization", async () => {
    await q(`update lean_private.saved_marketing_delivery set enabled=true,source_id=$1,token_sha256=repeat('a',64),
      approval_ref='fixture',not_before=clock_timestamp()-interval '1 minute',expires_at=clock_timestamp()+interval '1 day',
      allow_disabled_meta=true,lookback_days=$2`, ["11111111-1111-4111-8111-111111111111", age]);
    const off = await savedRead(); assert.equal(off.days[0].google, null); assert.equal(off.days[0].meta, null);
    await db.exec("update lean_private.marketing_source_settings set report_enabled=true");
    const input = await savedRead(), result = prepareSavedMarketingReport(input);
    assert.equal(result.marketing_daily.length, 2); assert.equal((await total()).spend_usd, "5.465689");
    assert.equal(result.marketing_daily[1].clicks, null);
    assert.equal(input.days.find(d => d.date === date).google.kind, "app_google_v1");
    assert.match(input.days.find(d => d.date === date).google.base.evidenceRef, /^lean_private.marketing_source_jobs\//);
    assert.equal((await q("select public.lean_saved_marketing_read(repeat('b',64)) v"))[0].v, null);
    await transaction(async () => {
      await db.exec(`update lean_private.saved_marketing_delivery set not_before=clock_timestamp()-interval '2 days',
        expires_at=clock_timestamp()-interval '1 day'`);
      assert.equal(await savedRead(), null);
    });
  });
  await check("separate correction lane services all D2-D7 even when primary hour is already consumed", async () => {
    assert.equal((await refreshMarketingSource("google_ads", "primary", runtime("google_ads"))).body.state, "complete");
    const dates = [date]; // One supported correction was already committed above.
    for (let n = 0; n < 5; n++) {
      const r = runtime("google_ads"), inner = r.rpc;
      r.rpc = async (name, args) => {
        const value = await inner(name, args); if (name.endsWith("_claim")) dates.push(value.date); return value;
      };
      const result = await refreshMarketingSource("google_ads", "correction", r);
      assert.equal(result.body.state, "complete", JSON.stringify(result));
    }
    assert.equal(new Set(dates).size, 6);
    assert.equal((await claim("google_ads", "correction")).state, "not_due");
  });
  // Fixture-only expired source job. No existing automatic Google rows touched.
  async function insertAttempt(provider, state = "running") {
    const id = (await q(`insert into public.job_runs(job_name,status,started_at) values('fixture-expired',$1,
      date_trunc('milliseconds',clock_timestamp()-interval '2 minutes')) returning id`, [state]))[0].id;
    return (await q(`insert into lean_private.marketing_source_jobs(job_id,provider,report_date,slot,lane,attempt,state,
      lease_token,started_at,deadline) select id,$2,$3,'fixture-expired-'||id,'primary',1,'running',gen_random_uuid(),
      started_at,started_at+interval '90 seconds' from public.job_runs where id=$1 returning *`, [id, provider, date]))[0];
  }
  await check("expired ambiguous attempt holds until explicit bounded admin reconciliation; no automatic recapture", async () => {
    const j = await insertAttempt("google_ads");
    assert.equal((await claim("google_ads")).state, "held");
    assert.equal((await q("select state from lean_private.marketing_source_jobs where job_id=$1", [j.job_id]))[0].state, "held");
    assert.equal((await claim("google_ads", "primary", { date, actor: "fixture-admin", reason: "confirmed no commit" })).state, "not_due");
    assert.equal((await q("select code from lean_private.marketing_source_jobs where job_id=$1", [j.job_id]))[0].code, "admin_confirmed_no_commit");
    assert.equal((await total()).spend_usd, "5.465689");
  });
  await check("rate limit deferral is retained for scheduled and admin retry; provider failure does not erase last-good", async () => {
    const j = await insertAttempt("google_ads");
    await rpc("lean_marketing_source_fail", { p_job: j.job_id, p_token: j.lease_token, p_code: "rate_limited", p_retry_seconds: 2400 });
    assert.equal((await claim("google_ads")).state, "rate_limited");
    assert.equal((await claim("google_ads", "primary", { date, actor: "fixture-admin", reason: "try again" })).state, "rate_limited");
    assert.equal((await claim("meta_ads", "primary", repair)).state, "not_due");
    const seconds = (await q("select extract(epoch from retry_after-clock_timestamp()) seconds from lean_private.marketing_source_settings where provider='google_ads'"))[0].seconds;
    assert(Number(seconds) > 2390);
    assert.equal((await total()).spend_usd, "5.465689");
  });
  await check("open/future dates, third attempts and manual long rate-limit override are refused", async () => {
    await assert.rejects(() => claim("meta_ads", "primary", { date: "2099-01-01", actor: "fixture-admin", reason: "retry test" }), /repair date/);
    const id = (await q("insert into public.job_runs(job_name) values('fixture-attempt-bound') returning id"))[0].id;
    await assert.rejects(() => q(`insert into lean_private.marketing_source_jobs(job_id,provider,report_date,slot,lane,
      attempt,state,lease_token,started_at,deadline) select $2,'meta_ads',$1,'invalid','primary',3,'running',
      gen_random_uuid(),statement_timestamp(),statement_timestamp()+interval '90 seconds'`, [date, id]), /attempt_check/);
    await transaction(async () => {
      await db.exec("update lean_private.marketing_source_settings set retry_after=null,blocked_code='rate_limit_manual' where provider='google_ads'");
      assert.equal((await claim("google_ads", "primary", { date, actor: "fixture-admin", reason: "retry test" })).state, "held");
    });
  });
  await check("admin health has no packet/receipts/token and downstream import remains unknown", async () => {
    const h = await rpc("lean_marketing_source_health", {});
    assert.equal(h.length, 2); assert(h.every(x => x.downstreamImport === "not_observed"));
    assert(!/lease_token|synthetic-|receipts|private_key|assertion/.test(JSON.stringify(h)));
    await rpc("lean_marketing_source_pause", { p_provider: "meta_ads", p_actor: "fixture-admin", p_reason: "pause source" });
    assert.equal((await claim("meta_ads")).state, "disabled");
    assert.equal(prepareSavedMarketingReport(await savedRead()).marketing_daily.filter(r => r.report_date === date).length, 2);
  });
  console.log(`${checks} application marketing SQL groups passed`);
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => {
  await db.close(); fs.rmSync(scratch, { recursive: true, force: true });
});
