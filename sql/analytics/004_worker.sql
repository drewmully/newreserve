-- REVIEW ONLY; apply after 003. No schedule or replay API is enabled.
begin;
create index lean_work_claim on lean_private.work(state,available_at,lease_until);
create table lean_private.projections (
  receipt_id bigint primary key references lean_private.receipts,
  transform_version text not null,
  facts jsonb not null,
  projected_at timestamptz not null default now()
);
create table lean_private.replay_audit (
  replay_id bigint generated always as identity primary key,
  work_id bigint not null references lean_private.work,
  approval_ref text not null,
  actor_ref text not null,
  requested_at timestamptz not null default now()
);
revoke all on lean_private.projections,lean_private.replay_audit from public;
create function public.lean_claim_work(p_token text, p_limit integer, p_lease_seconds integer)
returns table(work_id bigint,receipt_id bigint,topic text,payload jsonb,attempts integer)
language plpgsql security definer set search_path=pg_catalog as $$
begin
  if length(p_token) < 32 or p_limit not between 1 and 50 or p_lease_seconds not between 30 and 300 then
    raise exception 'invalid lease bounds';
  end if;
  update lean_private.work w set state='dead',lease_token=null,lease_until=null,last_error_code='attempts_exhausted'
    where w.state='leased' and w.lease_until<=now() and w.attempts>=5;
  return query
  with candidates as (
    select w.work_id from lean_private.work w
    where ((w.state='pending' and w.available_at<=now()) or (w.state='leased' and w.lease_until<=now()))
      and w.attempts<5
    order by w.available_at,w.work_id for update skip locked limit p_limit
  ), claimed as (
    update lean_private.work w set state='leased',lease_token=p_token,
      lease_until=now()+make_interval(secs=>p_lease_seconds),attempts=w.attempts+1
    from candidates c where w.work_id=c.work_id returning w.*
  )
  select c.work_id,c.receipt_id,r.topic,r.payload,c.attempts
    from claimed c join lean_private.receipts r on r.receipt_id=c.receipt_id;
end $$;
create function public.lean_finish_work(p_work_id bigint,p_token text,p_version text,p_facts jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare r lean_private.work;
begin
  select * into r from lean_private.work where work_id=p_work_id for update;
  if not found or r.state<>'leased' or r.lease_token<>p_token or r.lease_until<=now() then return false; end if;
  if length(p_version) not between 1 and 100 or jsonb_typeof(p_facts)<>'object' then
    raise exception 'invalid projection';
  end if;
  insert into lean_private.projections(receipt_id,transform_version,facts)
    values(r.receipt_id,p_version,p_facts)
    on conflict(receipt_id) do update set transform_version=excluded.transform_version,
      facts=excluded.facts,projected_at=now();
  update lean_private.work set state='done',completed_at=now(),lease_token=null,lease_until=null,last_error_code=null
    where work_id=r.work_id;
  return true;
end $$;
create function public.lean_fail_work(p_work_id bigint,p_token text,p_code text)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
begin
  if p_code not in ('transform_failed','unsupported_topic','schema_drift','storage_failed') then
    raise exception 'invalid safe error code';
  end if;
  update lean_private.work set state=case when attempts>=5 then 'dead' else 'pending' end,
    available_at=now()+make_interval(secs=>least(3600,30*power(2,attempts-1)::integer)),
    lease_token=null,lease_until=null,last_error_code=p_code
  where work_id=p_work_id and state='leased' and lease_token=p_token and lease_until>now();
  return found;
end $$;
create function public.lean_replay_work(p_work_id bigint,p_approval text,p_actor text)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
begin
  if length(trim(p_approval))=0 or length(trim(p_actor))=0 then raise exception 'approval required'; end if;
  update lean_private.work set state='pending',attempts=0,available_at=now(),completed_at=null,
    lease_token=null,lease_until=null,last_error_code=null
    where work_id=p_work_id and state in ('done','dead');
  if not found then return false; end if;
  insert into lean_private.replay_audit(work_id,approval_ref,actor_ref) values(p_work_id,p_approval,p_actor);
  return true;
end $$;
revoke all on function public.lean_claim_work(text,integer,integer) from public;
revoke all on function public.lean_finish_work(bigint,text,text,jsonb) from public;
revoke all on function public.lean_fail_work(bigint,text,text) from public;
revoke all on function public.lean_replay_work(bigint,text,text) from public;
grant execute on function public.lean_claim_work(text,integer,integer) to service_role;
grant execute on function public.lean_finish_work(bigint,text,text,jsonb) to service_role;
grant execute on function public.lean_fail_work(bigint,text,text) to service_role;
-- Replay intentionally has NO service_role grant. Use an approved operator role
-- with its own audit identity after access review; never a client-facing RPC.
commit;
