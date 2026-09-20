import fs from "node:fs";
const reports = JSON.parse(fs.readFileSync("src/lib/analytics/reporting-contracts.json", "utf8"));
const core = JSON.parse(fs.readFileSync("src/lib/analytics/lean-contracts.json", "utf8"));
const q = s => { if (!/^[a-z_]+$/.test(s)) throw new Error("unsafe identifier"); return `"${s}"`; };
const type = t => {
  if (/^DECIMAL\(\d+,\d+\)$/.test(t)) return t.replace("DECIMAL", "numeric");
  const types = { STRING: "text", ENUM: "text", INTEGER: "bigint", BOOLEAN: "boolean", DATE: "date", TIMESTAMP_UTC: "timestamptz", "MAP<STRING,ENUM>": "jsonb" };
  if (!types[t]) throw new Error(`unmapped ${t}`);
  return types[t];
};
const keys = {
  store_daily: ["shop_id","report_date","definition_version","publication_id"],
  acquisition_daily: ["shop_id","report_date","channel","campaign_bucket","model_version","definition_version","publication_id"],
  product_daily: ["shop_id","report_date","sku_bucket","definition_version","publication_id"],
  customer_cohorts: ["shop_id","cohort_month","observation_age_days","acquisition_definition_version","definition_version","publication_id"],
  funnel_daily: ["shop_id","report_date","stage_id","funnel_version","definition_version","publication_id"],
};
const output = ["-- REVIEW ONLY. Requires 013_release.sql. Generated; no credentials or grants to reader roles.", "begin;"];
for (const table of core.tables) output.push(`create trigger candidate_only before insert or update or delete on lean_private.${q(table.name)} for each row execute function lean_private.guard_candidate();`);
for (const view of reports.views) {
  const physical = q("report_" + view.name);
  output.push(`create table lean_private.${physical} (\n${view.fields.map(f => `  ${q(f.name)} ${type(f.logicalType)}${f.nullable ? "" : " not null"}`).join(",\n")},
  primary key (${keys[view.name].map(q).join(",")}),
  foreign key(publication_id) references lean_private.publications
);`);
  output.push(`alter table lean_private.${physical} enable row level security;
revoke all on lean_private.${physical} from public;
create trigger candidate_only before insert or update or delete on lean_private.${physical} for each row execute function lean_private.guard_candidate();
create view lean_analytics.${q(view.name)} with (security_barrier=true) as
select ${view.fields.map(f => f.name === "is_stale" ? "(r.is_stale or s.is_stale) as is_stale" : `r.${q(f.name)}`).join(",")}
from lean_private.${physical} r join lean_private.selected_publications s
on s.domain='${view.name}' and s.publication_id=r.publication_id;
revoke all on lean_analytics.${q(view.name)} from public;`);
}
output.push("commit;");
fs.writeFileSync("sql/analytics/014_reporting_views.sql", output.join("\n") + "\n");
