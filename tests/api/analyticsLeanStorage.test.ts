import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import contracts from "@/lib/analytics/lean-contracts.json";

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync("sql/analytics/001_staging.sql", "utf8"));
}, 30000);
afterAll(async () => { await db.close(); });
describe("lean review-only staging DDL in real PostgreSQL (PGlite)", () => {
  it("creates exactly the manifest columns in an isolated schema", async () => {
    for (const table of contracts.tables) {
      const { rows } = await db.query<{ column_name: string }>(
        "select column_name from information_schema.columns where table_schema='lean_private' and table_name=$1 order by ordinal_position",
        [table.name],
      );
      expect(rows.map(r => r.column_name)).toEqual(table.fields.map(f => f.name));
    }
  });
  it("does not create operational public tables or grant public access", async () => {
    expect((await db.query("select * from pg_tables where schemaname='public'")).rows).toHaveLength(0);
    await db.exec("create role analytics_test_reader");
    const { rows } = await db.query<{ permitted: boolean }>(
      "select has_schema_privilege('analytics_test_reader','lean_private','USAGE') as permitted",
    );
    expect(rows[0].permitted).toBe(false);
  });
  it("requires evidence before certifying a publication", async () => {
    await expect(db.exec("insert into lean_private.publications(publication_id,contract_version,state) values('bad','v1','certified')")).rejects.toThrow();
  });
  it("requires a publication and enforces a publication-aware primary key", async () => {
    const row = "('c','p','resolved',true,true,null,null,null)";
    await expect(db.exec(`insert into lean_private.customers values ${row}`)).rejects.toThrow();
    await db.exec("insert into lean_private.publications(publication_id,contract_version) values('p','v1')");
    await db.exec(`insert into lean_private.customers values ${row}`);
    await expect(db.exec(`insert into lean_private.customers values ${row}`)).rejects.toThrow();
  });
  it("does not accept coverage for an unregistered independent scope", async () => {
    await expect(db.exec("insert into lean_private.coverage values ('p','unknown','2026-01-01','verified_empty',0,0,'e')")).rejects.toThrow();
  });
});
