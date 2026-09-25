/** Local synthetic ACL regression; no hosted DB or provider access. */
import { PGlite } from "@electric-sql/pglite";
import { Client } from "pg";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const sql = (name: string) => readFileSync(`sql/analytics/${name}.sql`, "utf8")
  .replace(/^begin;\s*$/gm, "").replace(/^commit;\s*$/gm, "");
const roles = ["anon", "authenticated", "service_role"];
const connectionString = process.env.LEAN_RELEASE_ACL_POSTGRES === "true"
  ? process.env.LOCAL_POSTGRES_TEST_URL : undefined;
const implementations = ["PGlite", ...(connectionString ? ["PostgreSQL"] : [])];

for (const implementation of implementations) {
  describe(`schema-only release ACLs (${implementation})`, () => {
    let embedded: PGlite | undefined, pg: Client | undefined;
    const exec = async (text: string) => {
      if (pg) await pg.query(text); else await embedded!.exec(text);
    };
    const rows = async (text: string): Promise<Record<string, unknown>[]> =>
      pg ? (await pg.query(text)).rows : (await embedded!.query<Record<string, unknown>>(text)).rows;

    beforeEach(async () => {
      if (implementation === "PostgreSQL") {
        const url = new URL(connectionString!);
        if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
            url.pathname !== "/analytics_test_pipeline" || url.username !== "fixture_owner")
          throw new Error("local_disposable_postgres_only");
        pg = new Client({ connectionString }); await pg.connect();
      } else embedded = new PGlite();
      // PostgreSQL fixture changes, including cleanup/defaults, roll back.
      await exec(`begin;
        drop schema if exists lean_export cascade;
        drop schema if exists lean_analytics cascade;
        drop schema if exists lean_private cascade;
        drop function if exists public.lean_select_publication(text,text,text,text);
        drop function if exists public.lean_mark_publication_stale(text);
        do $$ begin
          if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
          if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
          if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
        end $$;
        alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
      for (const file of ["001_staging", "013_release", "014_reporting_views"]) await exec(sql(file));
    }, 30000);
    afterEach(async () => {
      try { await exec("reset role; rollback"); }
      finally { await pg?.end(); await embedded?.close(); pg = undefined; embedded = undefined; }
    });

    const matrix = () => rows(`select r as role,
      has_function_privilege(r,'public.lean_select_publication(text,text,text,text)','execute') as can_select,
      has_function_privilege(r,'public.lean_mark_publication_stale(text)','execute') as can_mark_stale
      from unnest(array['anon','authenticated','service_role']) r`);
    const expected = [
      { role: "anon", can_select: false, can_mark_stale: false },
      { role: "authenticated", can_select: false, can_mark_stale: false },
      { role: "service_role", can_select: false, can_mark_stale: true },
    ];
    const assertAcl = async () => {
      expect(await matrix()).toEqual(expected);
      expect(await rows(`select count(*)::int as grants from pg_proc p,
        lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        where p.oid in ('public.lean_select_publication(text,text,text,text)'::regprocedure,
          'public.lean_mark_publication_stale(text)'::regprocedure)
        and a.grantee=0 and a.privilege_type='EXECUTE'`)).toEqual([{ grants: 0 }]);
    };
    const attemptDenied = async (role: string, statement: string) => {
      await exec("savepoint denied_call");
      try {
        await exec(`set local role ${role}`);
        await expect(exec(statement)).rejects.toThrow(/permission denied/i);
      } finally { await exec("rollback to savepoint denied_call; release savepoint denied_call"); }
    };
    it("fresh minimum install denies application release while preserving service staleness", async () => {
      await assertAcl();
      for (const role of roles)
        await attemptDenied(role, "select public.lean_select_publication('store_daily','one',null,'fixture')");
      for (const role of ["anon", "authenticated"])
        await attemptDenied(role, "select public.lean_mark_publication_stale('store_daily')");
      await exec("set local role service_role; select public.lean_mark_publication_stale('store_daily'); reset role");
      for (const view of ["store_daily", "product_daily", "acquisition_daily", "customer_cohorts", "funnel_daily"])
        expect(await rows(`select * from lean_analytics.${view}`)).toEqual([]);
    });
    it("repairs legacy inherited grants idempotently without changing default or unrelated privileges", async () => {
      await exec(`grant execute on function public.lean_select_publication(text,text,text,text),
        public.lean_mark_publication_stale(text) to public,anon,authenticated,service_role;
        create function public.acl_fixture_unrelated() returns integer language sql as 'select 1';`);
      expect((await matrix()).every(r => r.can_select && r.can_mark_stale)).toBe(true);
      const defaults = await rows("select oid,defaclacl::text from pg_default_acl order by oid");
      const unrelated = await rows("select proacl::text from pg_proc where oid='public.acl_fixture_unrelated()'::regprocedure");
      await exec(sql("045_release_function_acl"));
      await exec(sql("045_release_function_acl"));
      await assertAcl();
      expect(await rows("select oid,defaclacl::text from pg_default_acl order by oid")).toEqual(defaults);
      expect(await rows("select proacl::text from pg_proc where oid='public.acl_fixture_unrelated()'::regprocedure")).toEqual(unrelated);
      expect(await rows("select * from lean_private.selected_publications")).toEqual([]);
      expect(await rows("select * from lean_private.publication_audit")).toEqual([]);
    });
    it("keeps owner publication selection, compare-and-swap and stale marking functional after repair", async () => {
      await exec(sql("045_release_function_acl"));
      await exec(`insert into lean_private.publications(publication_id,contract_version) values('acl-one','fixture');
        insert into lean_private.certifications values('acl-one','store_daily','fixture','fixture','fixture');
        update lean_private.publications set state='certified',evidence_ref='fixture' where publication_id='acl-one';
        select public.lean_select_publication('store_daily','acl-one',null,'fixture:owner');
        set local role service_role; select public.lean_mark_publication_stale('store_daily'); reset role;`);
      expect(await rows("select publication_id,is_stale from lean_private.selected_publications"))
        .toEqual([{ publication_id: "acl-one", is_stale: true }]);
      await exec("savepoint cas");
      await expect(exec("select public.lean_select_publication('store_daily','acl-one',null,'fixture:stale-cas')"))
        .rejects.toThrow(/selection changed/);
      await exec("rollback to savepoint cas; release savepoint cas");
      expect(await rows("select count(*)::int as n from lean_private.publication_audit")).toEqual([{ n: 1 }]);
    });
  });
}
