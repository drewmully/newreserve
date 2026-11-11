/**
 * scripts/newsletter-to-post.ts
 *
 * Turns a sent Klaviyo campaign into a draft Journal post for The Mully
 * Letter (/blog/letters). Read-only against Klaviyo. Never writes to
 * Supabase itself: step 3 prints insert-only SQL for review.
 *
 * 1. Draft from a campaign ID (refuses unless Klaviyo shows it sent):
 *      KLAVIYO_PRIVATE_API_KEY=pk_... npx tsx scripts/newsletter-to-post.ts <campaignId>
 *    Writes content/newsletters/<slug>.json and prints the warnings.
 *
 *    Offline (saved HTML, e.g. from Klaviyo "export HTML"):
 *      npx tsx scripts/newsletter-to-post.ts --html=email.html --sent-at=2026-11-08T14:00:00Z \
 *        --subject="..." --preview="..." [--campaign=<id>]
 *
 *    It also adds the slug to src/lib/letterIssues.ts (collection membership).
 *
 * 2. Edit the JSON: title, excerpt (150 to 160 chars), slug, cut time-bound
 *    or offer lines, check every _warnings entry.
 *
 * 3. Validate and print the insert:
 *      npx tsx scripts/newsletter-to-post.ts --sql content/newsletters/<slug>.json
 *    Exits non-zero with a list of problems if the row breaks a rule.
 *    Run the printed SQL in Supabase (insert only, ON CONFLICT DO NOTHING).
 *
 * See docs/newsletter-archive.md.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { emailToDraft, insertSql, toRow, validateLetterRow, type LetterDraft, type LetterSource } from "../src/lib/newsletterToPost";

const KLAVIYO = "https://a.klaviyo.com/api";
const REVISION = "2026-07-15";
const OUT_DIR = "content/newsletters";
const ISSUES_FILE = "src/lib/letterIssues.ts";

const args = process.argv.slice(2);
const flag = (name: string) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const positional = args.filter(a => !a.startsWith("--"));

type JsonApi = { data: { id: string; attributes: Record<string, unknown>; relationships?: Record<string, { data?: { id: string } | { id: string }[] }> }; included?: { id: string; type: string; attributes: Record<string, unknown> }[] };

async function klaviyo(pathname: string): Promise<JsonApi> {
  const key = process.env.KLAVIYO_PRIVATE_API_KEY;
  if (!key) throw new Error("KLAVIYO_PRIVATE_API_KEY is required (read-only use).");
  const res = await fetch(`${KLAVIYO}${pathname}`, { headers: { Authorization: `Klaviyo-API-Key ${key}`, revision: REVISION, accept: "application/vnd.api+json" } });
  if (!res.ok) throw new Error(`Klaviyo ${pathname} -> ${res.status} ${await res.text()}`);
  return res.json() as Promise<JsonApi>;
}

const pick = (o: Record<string, unknown> | undefined, ...keys: string[]): unknown => {
  for (const k of keys) {
    const v = k.split(".").reduce<unknown>((acc, part) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[part] : undefined), o);
    if (v != null && v !== "") return v;
  }
  return undefined;
};

async function fromCampaign(id: string): Promise<{ html: string; source: LetterSource }> {
  const campaign = await klaviyo(`/campaigns/${id}/?include=campaign-messages`);
  const a = campaign.data.attributes;
  const status = String(pick(a, "status", "definition.status") ?? "").toLowerCase();
  const msg = campaign.included?.find(x => x.type === "campaign-message");
  const msgStatus = String(pick(msg?.attributes, "definition.status", "status") ?? "").toLowerCase();
  if (status !== "sent" && msgStatus !== "sent") throw new Error(`Campaign ${id} is not sent yet (status "${status || msgStatus}"). Publish only after it sends.`);
  if (!msg) throw new Error(`Campaign ${id} has no message.`);
  const sentAt = String(pick(a, "send_time") ?? pick(msg.attributes, "definition.send_options.send_time", "send_times.0.datetime") ?? "");
  const template = await klaviyo(`/campaign-messages/${msg.id}/template/`);
  const t = template.data.attributes;
  return {
    html: String(t.html ?? ""),
    source: {
      campaignId: id,
      campaignName: String(pick(a, "name", "definition.name") ?? ""),
      subject: String(pick(msg.attributes, "content.subject", "definition.content.subject") ?? ""),
      previewText: String(pick(msg.attributes, "content.preview_text", "definition.content.preview_text") ?? ""),
      sentAt,
      templateId: template.data.id,
    },
  };
}

function writeDraft(draft: LetterDraft): string {
  mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${draft.slug}.json`);
  writeFileSync(file, JSON.stringify(draft, null, 2) + "\n");
  return file;
}

/** Add the slug to the code-level collection list (src/lib/letterIssues.ts). */
function listIssue(slug: string): boolean {
  const src = readFileSync(ISSUES_FILE, "utf8");
  if (src.includes(`"${slug}"`)) return false;
  const next = src.replace(/(LETTER_ISSUE_SLUGS: readonly string\[\] = \[\n)([\s\S]*?)(\];)/, (_m, open: string, body: string, close: string) => `${open}${body}  "${slug}",\n${close}`);
  if (next === src) throw new Error(`Could not update ${ISSUES_FILE}; add "${slug}" by hand.`);
  writeFileSync(ISSUES_FILE, next);
  return true;
}

async function main() {
  const sqlFile = args.includes("--sql") ? positional[0] : undefined;
  if (sqlFile) {
    const draft = JSON.parse(readFileSync(sqlFile, "utf8")) as LetterDraft;
    const row = toRow(draft);
    const problems = validateLetterRow(row);
    if (problems.length) {
      console.error(`Not ready (${problems.length}):\n- ${problems.join("\n- ")}`);
      process.exit(1);
    }
    console.log(insertSql(row));
    return;
  }

  let html: string;
  let source: LetterSource;
  const htmlFile = flag("html");
  if (htmlFile) {
    const sentAt = flag("sent-at");
    if (!sentAt) throw new Error("--sent-at=<ISO send time> is required with --html");
    html = readFileSync(htmlFile, "utf8");
    source = { campaignId: flag("campaign") ?? "offline", subject: flag("subject"), previewText: flag("preview"), sentAt };
  } else {
    const id = positional[0];
    if (!id) throw new Error("Usage: newsletter-to-post.ts <campaignId> | --html=<file> --sent-at=<iso> | --sql <draft.json>");
    ({ html, source } = await fromCampaign(id));
  }
  const doc = new JSDOM(html).window.document;
  const draft = emailToDraft(doc, source);
  const slug = flag("slug");
  if (slug) draft.slug = slug;
  const file = writeDraft(draft);
  if (listIssue(draft.slug)) console.log(`Listed in ${ISSUES_FILE}. If you change the slug, update it there too.`);
  console.log(`Draft: ${file}`);
  console.log(`Slug: /blog/${draft.slug}  Sent: ${draft.publish_date}  Sections: ${draft.sections.length}  Products: ${draft._products.join(", ") || "none"}`);
  if (draft._warnings.length) console.log(`Review:\n- ${draft._warnings.join("\n- ")}`);
  console.log("Next: write title and excerpt, edit the copy, then run with --sql.");
}

main().catch(err => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
