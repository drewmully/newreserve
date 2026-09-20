import fs from "node:fs";
const file = process.argv[2];
if (!file) throw new Error("Pass the cached workbook JSON explicitly");
const workbook = JSON.parse(fs.readFileSync(file, "utf8"));
const get = name => workbook.valueRanges.find(v => v.range.split("!")[0].replaceAll("'", "") === name).values;
const views = ["store_daily", "acquisition_daily", "product_daily", "customer_cohorts", "funnel_daily"].map(name => ({
  name, fields: get(name).filter(r => /^(STRING|ENUM|BOOLEAN|INTEGER|DECIMAL|DATE|TIMESTAMP|MAP)/.test(r[1] ?? ""))
    .map(([name, logicalType, nullable, role, definition]) => ({ name, logicalType, nullable: nullable === "TRUE", role, definition })),
}));
const metrics = [];
for (const row of get("Metric Definitions")) {
  const match = /^([a-z][a-z0-9_]+) \| (.+)$/.exec(row[0] ?? "");
  if (match) metrics.push({ id: match[1], title: match[2], contract: {} });
  else if (row.length > 1 && metrics.length) metrics.at(-1).contract[row[0]] = row[1];
}
const joins = get("Join Map").slice(4).filter(r => r.length >= 7).map(([from, fromKey, to, toKey, cardinality, conditions, risk], index) =>
  ({ id: index + 1, from, fromKey, to, toKey, cardinality, conditions, risk }));
if (metrics.length !== 21 || joins.length !== 24) throw new Error("Unexpected workbook control counts");
fs.writeFileSync("src/lib/analytics/reporting-contracts.json", JSON.stringify({
  source: "https://docs.google.com/spreadsheets/d/1irN9OS5z6nJOU46jeAFnwv4h6oFJC5m-gkSGzrxFREA/edit",
  approval: "proposed; explicit release approval required", views, metrics, joins,
}, null, 2) + "\n");
