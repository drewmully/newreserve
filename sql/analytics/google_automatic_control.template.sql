-- DEFAULT UNBOUND. Parent supplies a separately approved JSON contract through
-- lean.google_auto_control_contract. No provider call and no runtime grant.
-- Register first, metadata test second, dedicated copies third. Enable only
-- after the standing policy/source and application bindings are verified.
begin isolation level read committed;
set local lock_timeout='3s';
set local statement_timeout='15s';
do $auto_control$
declare b jsonb:=nullif(current_setting('lean.google_auto_control_contract',true),'')::jsonb;
  p lean_private.google_standing_policy; g lean_private.google_auto_grants;
  s lean_private.google_auto_setups; j jsonb; result_sha text;
begin
  if b is null or jsonb_typeof(b) is distinct from 'object' or
    not(b ?& array['owner','sessionUser','approvalRef','actorRef','deadline','policyId','policyRevision','policyRowSha256','action']) or
    current_user is distinct from b->>'owner' or session_user is distinct from b->>'sessionUser' or
    (select relowner from pg_class where oid='lean_private.google_auto_grants'::regclass)<>current_user::regrole::oid or
    coalesce(length(trim(b->>'approvalRef')),0) not between 1 and 256 or
    coalesce(length(trim(b->>'actorRef')),0) not between 1 and 256 or
    coalesce((b->>'deadline')::timestamptz<=clock_timestamp(),true) or
    (b->>'deadline')::timestamptz>clock_timestamp()+interval '15 minutes'
    then raise exception 'unbound automatic control'; end if;
  if b->>'action' in ('enable','stop') then
    select * into strict g from lean_private.google_auto_grants where grant_id=b->>'grantId' for update;
  end if;
  select * into strict p from lean_private.google_standing_policy where policy_id=b->>'policyId' for update;
  if p.revision is distinct from (b->>'policyRevision')::bigint or
    encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') is distinct from b->>'policyRowSha256'
    then raise exception 'automatic policy changed'; end if;
  if b->>'action'='register' then
    j:=b->'grant';
    if jsonb_typeof(j) is distinct from 'object' or p.enabled or
      j->>'policy_id' is distinct from p.policy_id or (j->>'policy_revision')::bigint is distinct from p.revision or
      j->>'approval_ref' is distinct from b->>'approvalRef' or j->>'actor_ref' is distinct from b->>'actorRef' or
      j ?| array['enabled','revoked','setup_receipt','cycles','last_claimed_at','slot_log'] or
      exists(select 1 from jsonb_object_keys(j) k where not exists(select 1 from pg_attribute a
        where a.attrelid='lean_private.google_auto_grants'::regclass and a.attname=k and a.attnum>0 and not a.attisdropped))
      then raise exception 'automatic registration scope'; end if;
    j:=j||jsonb_build_object('enabled',false,'revoked',false,'cycles',0,'setup_receipt',null,'last_claimed_at',null,'slot_log','[]'::jsonb);
    insert into lean_private.google_auto_grants
      select * from jsonb_populate_record(null::lean_private.google_auto_grants,j)
      returning * into g;
    perform lean_private.google_auto_slot(g.grant_id);
    select a.* into strict g from lean_private.google_auto_grants a where a.grant_id=g.grant_id;
  elsif b->>'action' in ('enable','stop') then
    if g.policy_id<>p.policy_id or g.revision is distinct from (b->>'grantRevision')::bigint or
      encode(sha256(convert_to(to_jsonb(g)::text,'UTF8')),'hex') is distinct from b->>'grantRowSha256'
      then raise exception 'automatic grant changed'; end if;
    if b->>'action'='enable' then
      select * into strict s from lean_private.google_auto_setups where setup_id=g.setup_id for share;
      if s.receipt is null or s.revoked or s.account_id<>p.account_id or s.login_customer_id<>p.login_customer_id or
        s.credential_binding_ref<>g.credential_binding_ref or
        encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') is distinct from b->>'setupRowSha256'
        then raise exception 'automatic tested setup changed'; end if;
    end if;
    if b->>'action'='enable' and (g.enabled or g.revoked or g.cycles<>0 or
      not p.enabled or clock_timestamp()<g.not_before or clock_timestamp()>=g.expires_at)
      then raise exception 'automatic enable refused'; end if;
    if b->>'action'='stop' and not g.enabled then raise exception 'automatic stop state'; end if;
    update lean_private.google_auto_grants set enabled=(b->>'action'='enable'),
      setup_receipt=case when b->>'action'='enable' then s.receipt else setup_receipt end where grant_id=g.grant_id
      returning * into g;
  else raise exception 'automatic control action'; end if;
  result_sha:=encode(sha256(convert_to(to_jsonb(g)::text,'UTF8')),'hex');
  perform set_config('lean.google_auto_control_receipt',jsonb_build_object('action',b->>'action',
    'grantId',g.grant_id,'revision',g.revision::text,'enabled',g.enabled,'revoked',g.revoked,
    'rowSha256',result_sha,'approvalRef',b->>'approvalRef','actorRef',b->>'actorRef')::text,true);
  if clock_timestamp()>=(b->>'deadline')::timestamptz then raise exception 'automatic control expired'; end if;
end $auto_control$;
select current_setting('lean.google_auto_control_receipt')::jsonb receipt;
commit;
