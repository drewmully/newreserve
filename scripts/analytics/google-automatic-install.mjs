import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

// Catalog only. No business rows, token hashes, source inputs or credentials.
export const catalogQuery = `WITH
relations AS (SELECT c.oid,c.relname,c.relowner,c.relkind,c.relrowsecurity,c.relforcerowsecurity,c.relacl,
 (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0) columns,
 (SELECT jsonb_agg(jsonb_build_object('oid',x.oid,'definition',pg_get_constraintdef(x.oid),'validated',x.convalidated) ORDER BY x.oid)
  FROM pg_constraint x WHERE x.conrelid=c.oid) constraints,
 (SELECT jsonb_agg(jsonb_build_object('oid',x.oid,'enabled',x.tgenabled,'function',x.tgfoid,'definition',pg_get_triggerdef(x.oid)) ORDER BY x.oid)
  FROM pg_trigger x WHERE x.tgrelid=c.oid AND NOT x.tgisinternal) triggers,
 (SELECT jsonb_agg(jsonb_build_object('oid',x.indexrelid,'definition',pg_get_indexdef(x.indexrelid)) ORDER BY x.indexrelid)
  FROM pg_index x WHERE x.indrelid=c.oid) indexes,
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.oid) FROM pg_policy x WHERE x.polrelid=c.oid) policies,
 CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid) END view_definition
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='lean_private'),
functions AS (SELECT p.oid,p.pronamespace,p.proname,p.proowner,p.prolang,p.prosecdef,p.provolatile,p.proacl,p.proconfig,
 pg_get_functiondef(p.oid) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE p.prokind IN ('f','p') AND (n.nspname='lean_private' OR n.nspname='public' AND p.proname LIKE 'lean\\_%' ESCAPE '\\')),
metadata AS (SELECT jsonb_build_object(
 'relations',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY oid),'[]') FROM relations r),
 'functions',(SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY oid),'[]') FROM functions f),
 'schemas',(SELECT jsonb_agg(jsonb_build_object('oid',oid,'name',nspname,'owner',nspowner,'acl',nspacl) ORDER BY oid)
   FROM pg_namespace WHERE nspname IN ('public','lean_private')),
 'roles',(SELECT jsonb_agg(jsonb_build_object('oid',oid,'name',rolname,'super',rolsuper,'inherit',rolinherit,
   'bypassRls',rolbypassrls) ORDER BY oid) FROM pg_roles),
 'memberships',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY roleid,member),'[]') FROM pg_auth_members a),
 'defaultAcl',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY oid),'[]') FROM pg_default_acl a)) value)
 SELECT encode(sha256(convert_to(value::text,'UTF8')),'hex') catalog_sha256 FROM metadata`;
export const readSql = `BEGIN READ ONLY;
SET LOCAL statement_timeout='15s';
SELECT current_user owner, session_user session_user, clock_timestamp() captured_at,
 (${catalogQuery}) catalog_sha256,
 to_regclass('lean_private.google_auto_grants') existing_grants,
 to_regclass('lean_private.google_auto_cycles') existing_cycles,
 to_regclass('lean_private.google_auto_setups') existing_setups;
COMMIT;
`;
const hash = text => createHash("sha256").update(text).digest("hex");
function explicitInstant(value) {
  const m = typeof value === "string" && /^([1-9]\d{3})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!m) throw Error("installer_explicit_zone_required");
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  const millis = Number((m[7] ?? "").padEnd(3, "0"));
  const wall = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millis));
  if (wall.getUTCFullYear() !== year || wall.getUTCMonth() !== month - 1 || wall.getUTCDate() !== day ||
    wall.getUTCHours() !== hour || wall.getUTCMinutes() !== minute || wall.getUTCSeconds() !== second)
    throw Error("installer_invalid_calendar");
  const zone = m[8], zh = zone === "Z" ? 0 : Number(zone.slice(1, 3)), zm = zone === "Z" ? 0 : Number(zone.slice(4));
  if (zh > 14 || zm > 59 || zh === 14 && zm !== 0) throw Error("installer_invalid_offset");
  const offset = (zh * 60 + zm) * 60000 * (zone.startsWith("-") ? -1 : 1);
  return new Date(wall.valueOf() - offset).toISOString();
}
export function renderGoogleAutomaticInstaller(binding, raw) {
  if (!binding || Object.keys(binding).sort().join(",") !==
    "actorRef,approvalRef,capturedAt,catalogSha256,deadline,owner,rawSha256,sessionUser" ||
    ![binding.catalogSha256,binding.rawSha256].every(v => typeof v === "string" && /^[a-f0-9]{64}$/.test(v)) ||
    binding.rawSha256 !== hash(raw) ||
    !["approvalRef","actorRef","owner","sessionUser"].every(k => typeof binding[k] === "string" &&
      binding[k].length >= 1 && binding[k].length <= 256) ||
    ![binding.deadline,binding.capturedAt].every(v => typeof v === "string"))
    throw Error("unbound_google_automatic_installer");
  const deadline = explicitInstant(binding.deadline), capturedAt = explicitInstant(binding.capturedAt);
  if (Date.parse(deadline) <= Date.now() || Date.parse(deadline) - Date.now() > 900000 ||
    Date.now() - Date.parse(capturedAt) > 300000 || Date.parse(capturedAt) > Date.now())
    throw Error("unbound_google_automatic_installer");
  if (!raw.includes("\nbegin;\n") || !raw.endsWith("commit;\n")) throw Error("raw_transaction");
  const body = raw.replace("\nbegin;\n", "\n").slice(0, -"commit;\n".length);
  // Every interpolated owner/ref is inside hex JSON, never a SQL/dollar delimiter.
  const hex = Buffer.from(JSON.stringify({ ...binding, deadline, capturedAt,
    originalTiming: { deadline: binding.deadline, capturedAt: binding.capturedAt },
    originalBindingSha256: hash(JSON.stringify(binding)) })).toString("hex");
  const guard = `DO $auto_install$
DECLARE b jsonb:=convert_from(decode('${hex}','hex'),'UTF8')::jsonb;
BEGIN
 IF current_user IS DISTINCT FROM b->>'owner' OR session_user IS DISTINCT FROM b->>'sessionUser' OR
 current_setting('transaction_isolation')<>'read committed' OR
 clock_timestamp()>=(b->>'deadline')::timestamptz OR
 (b->>'deadline')::timestamptz>clock_timestamp()+interval '15 minutes' OR
 clock_timestamp()-(b->>'capturedAt')::timestamptz>interval '5 minutes' OR
 (${catalogQuery}) IS DISTINCT FROM b->>'catalogSha256' OR
 to_regclass('lean_private.google_auto_grants') IS NOT NULL OR to_regclass('lean_private.google_auto_cycles') IS NOT NULL OR
 to_regclass('lean_private.google_auto_setups') IS NOT NULL OR
 (SELECT proowner FROM pg_proc WHERE oid='public.lean_google_standing_enqueue(text,bigint,text,text)'::regprocedure)
   IS DISTINCT FROM current_user::regrole::oid OR
 EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role','lean_posthog_reader')
   AND (rolsuper OR pg_has_role(oid,current_user,'MEMBER')))
 THEN RAISE EXCEPTION 'automatic pre-DDL binding refused'; END IF;
END $auto_install$;`;
  return `BEGIN ISOLATION LEVEL READ COMMITTED;\nSET LOCAL statement_timeout='60s';\nSET LOCAL lock_timeout='5s';\n${guard}\n${body}
DO $auto_finish$
BEGIN
 IF clock_timestamp()>=(convert_from(decode('${hex}','hex'),'UTF8')::jsonb->>'deadline')::timestamptz
 THEN RAISE EXCEPTION 'automatic install expired'; END IF;
 IF EXISTS(SELECT 1 FROM lean_private.google_auto_grants) OR EXISTS(SELECT 1 FROM lean_private.google_auto_cycles) OR
 EXISTS(SELECT 1 FROM lean_private.google_auto_setups)
 THEN RAISE EXCEPTION 'automatic installer must be empty'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,
   LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   WHERE (n.nspname='public' AND p.proname LIKE 'lean_google_auto_%' OR
     n.nspname='lean_private' AND p.proname LIKE 'google_auto_%')
   AND (p.proowner<>current_user::regrole::oid OR a.grantee<>p.proowner AND
     (a.grantee<>'service_role'::regrole::oid OR n.nspname<>'public' OR p.proname='lean_google_auto_cycle_binding')))
 THEN RAISE EXCEPTION 'automatic unexpected function authority'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class c, LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
   WHERE c.oid IN ('lean_private.google_auto_grants'::regclass,'lean_private.google_auto_cycles'::regclass,'lean_private.google_auto_setups'::regclass)
   AND (c.relowner<>current_user::regrole::oid OR a.grantee<>c.relowner))
 THEN RAISE EXCEPTION 'automatic unexpected table authority'; END IF;
END $auto_finish$;
COMMIT;\n`;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv[2] === "read" && process.argv.length === 4)
      writeFileSync(process.argv[3], readSql, { flag: "wx", mode: 0o600 });
    else if (process.argv[2] === "render" && process.argv.length === 5) {
      const raw = readFileSync(fileURLToPath(new URL("../../sql/analytics/google_automatic_operation.review.sql", import.meta.url)), "utf8");
      writeFileSync(process.argv[4], renderGoogleAutomaticInstaller(JSON.parse(readFileSync(process.argv[3],"utf8")), raw),
        { flag: "wx", mode: 0o600 });
    } else throw Error("usage");
  } catch { console.error("google_automatic_installer_unbound"); process.exitCode = 1; }
}
