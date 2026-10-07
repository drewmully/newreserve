-- PRIVATE OWNER CONTROL TEMPLATE. Unbound until an explicit approved contract.
begin isolation level read committed;
set local lock_timeout='3s';
set local statement_timeout='15s';
do $commission_control$
declare b jsonb:=nullif(current_setting('lean.google_commission_control',true),'')::jsonb;
  g lean_private.google_commissions; j jsonb;
begin
  if b is null or current_user is distinct from b->>'owner' or session_user is distinct from b->>'sessionUser' or
    (select relowner from pg_class where oid='lean_private.google_commissions'::regclass)<>current_user::regrole::oid or
    coalesce(length(trim(b->>'approvalRef')),0) not between 1 and 256 or
    coalesce(length(trim(b->>'actorRef')),0) not between 1 and 256 or
    coalesce((b->>'deadline')::timestamptz<=clock_timestamp(),true) or
    (b->>'deadline')::timestamptz>clock_timestamp()+interval '15 minutes'
    then raise exception 'unbound commission owner control'; end if;
  if b->>'action'='register' then
    j:=b->'grant';
    if jsonb_typeof(j) is distinct from 'object' or
      j-array['grant_id','revision','setup_id','setup_revision','setup_receipt_sha256','credential_sha256',
        'credential_binding_ref','producer_sha256','cycle_id','account_id','login_customer_id','report_date',
        'not_before','expires_at','capture_seconds','source_deadline_seconds','max_pages','max_requests','max_bytes',
        'approval_ref','actor_ref']<>'{}' or
      j->>'approval_ref' is distinct from b->>'approvalRef' or j->>'actor_ref' is distinct from b->>'actorRef' or
      b->'nativeCaptureApproved' is distinct from 'true'::jsonb
      then raise exception 'commission scope'; end if;
    insert into lean_private.google_commissions select * from jsonb_populate_record(null::lean_private.google_commissions,
      j||jsonb_build_object('enabled',false,'revoked',false)) returning * into g;
  elsif b->>'action' in ('enable','stop') then
    select * into strict g from lean_private.google_commissions where grant_id=b->>'grantId' for update;
    if g.revision is distinct from (b->>'revision')::bigint or
      encode(sha256(convert_to(to_jsonb(g)::text,'UTF8')),'hex') is distinct from b->>'rowSha256' or
      b->>'action'='enable' and (g.enabled or g.revoked or g.started_at is not null or
        clock_timestamp()<g.not_before or clock_timestamp()>=g.expires_at or
        b->'nativeCaptureApproved' is distinct from 'true'::jsonb)
      then raise exception 'commission changed'; end if;
    update lean_private.google_commissions set enabled=(b->>'action'='enable'),
      revoked=revoked or b->>'action'='stop' where grant_id=g.grant_id returning * into g;
  else raise exception 'commission owner action'; end if;
  perform set_config('lean.google_commission_receipt',jsonb_build_object('grantId',g.grant_id,'revision',g.revision::text,
    'enabled',g.enabled,'revoked',g.revoked,'attempted',g.started_at is not null,
    'captured',g.capture_packet is not null,'rowSha256',encode(sha256(convert_to(to_jsonb(g)::text,'UTF8')),'hex'))::text,true);
  if clock_timestamp()>=(b->>'deadline')::timestamptz then raise exception 'commission owner deadline'; end if;
end $commission_control$;
select current_setting('lean.google_commission_receipt')::jsonb receipt;
commit;
