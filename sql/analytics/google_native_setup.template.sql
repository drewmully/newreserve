-- DEFAULT UNBOUND metadata-only authority. No destination or recurring policy.
begin isolation level read committed;
set local lock_timeout='3s';
set local statement_timeout='15s';
do $native_setup$
declare b jsonb:=nullif(current_setting('lean.google_native_setup_contract',true),'')::jsonb;
  s lean_private.google_auto_setups; j jsonb;
begin
  if b is null or current_user is distinct from b->>'owner' or session_user is distinct from b->>'sessionUser' or
    (select relowner from pg_class where oid='lean_private.google_auto_setups'::regclass)<>current_user::regrole::oid or
    coalesce(length(trim(b->>'approvalRef')),0) not between 1 and 256 or
    coalesce(length(trim(b->>'actorRef')),0) not between 1 and 256 or
    coalesce((b->>'deadline')::timestamptz<=clock_timestamp(),true) or
    (b->>'deadline')::timestamptz>clock_timestamp()+interval '15 minutes'
    then raise exception 'unbound native setup control'; end if;
  if b->>'action'='register' then
    j:=b->'setup';
    if jsonb_typeof(j) is distinct from 'object' or
      j-array['setup_id','revision','account_id','login_customer_id','not_before','expires_at','producer_sha256',
        'credential_binding_ref','approval_ref','actor_ref']<>'{}' or
      j->>'approval_ref' is distinct from b->>'approvalRef' or j->>'actor_ref' is distinct from b->>'actorRef' or
      b->'metadataSetupApproved' is distinct from 'true'::jsonb
      then raise exception 'native setup scope'; end if;
    insert into lean_private.google_auto_setups select * from jsonb_populate_record(null::lean_private.google_auto_setups,
      j||jsonb_build_object('enabled',true,'revoked',false,'started_at',null,'receipt',null)) returning * into s;
  elsif b->>'action'='stop' then
    select * into strict s from lean_private.google_auto_setups where setup_id=b->>'setupId' for update;
    if s.revision is distinct from (b->>'revision')::bigint or not s.enabled or
      encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') is distinct from b->>'rowSha256'
      then raise exception 'native setup changed'; end if;
    update lean_private.google_auto_setups set enabled=false where setup_id=s.setup_id returning * into s;
  else raise exception 'native setup action'; end if;
  perform set_config('lean.google_native_setup_receipt',jsonb_build_object('setupId',s.setup_id,'revision',s.revision::text,
    'enabled',s.enabled,'revoked',s.revoked,'metadataOnly',true,
    'rowSha256',encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex'))::text,true);
  if clock_timestamp()>=(b->>'deadline')::timestamptz then raise exception 'native setup expired'; end if;
end $native_setup$;
select current_setting('lean.google_native_setup_receipt')::jsonb receipt;
commit;
