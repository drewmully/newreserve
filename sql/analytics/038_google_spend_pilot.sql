-- REVIEW ONLY: installs no scope, jobs, switches, scheduler or credentials.
-- Depends only on 019. 025-037 are deliberately not prerequisites.
begin;
create table lean_private.spend_pilots (
  pilot_id text primary key check(length(pilot_id) between 1 and 128),
  project_ref text not null check(project_ref ~ '^[a-z]{20}$'),
  account_id text not null check(account_id ~ '^[0-9]{10}$'),
  login_customer_id text check(login_customer_id ~ '^[0-9]{10}$'),
  max_pages integer not null check(max_pages between 1 and 5),
  expires_at timestamptz not null check(isfinite(expires_at)),
  approval_ref text not null check(length(trim(approval_ref))>0),
  actor_ref text not null check(length(trim(actor_ref))>0),
  enabled boolean not null default false
);
create table lean_private.spend_pilot_days (
  pilot_id text not null references lean_private.spend_pilots,
  run_id text primary key references lean_private.spend_jobs,
  report_date date not null,
  due_at timestamptz not null check(isfinite(due_at)),
  unique(pilot_id,report_date)
);
alter table lean_private.spend_pilots enable row level security;
alter table lean_private.spend_pilot_days enable row level security;
revoke all on lean_private.spend_pilots,lean_private.spend_pilot_days from public,anon,authenticated,service_role;
create function lean_private.spend_pilot_immutable() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if tg_op='DELETE' or tg_table_name='spend_pilot_days' or
    (to_jsonb(old)-'enabled') is distinct from (to_jsonb(new)-'enabled')
    then raise exception 'spend pilot scope immutable'; end if;
  return new;
end $$;
create trigger immutable_spend_pilot before update or delete on lean_private.spend_pilots
  for each row execute function lean_private.spend_pilot_immutable();
create trigger immutable_spend_pilot_day before update or delete on lean_private.spend_pilot_days
  for each row execute function lean_private.spend_pilot_immutable();

-- Operator-only, atomic registration. A retry cannot silently replace a manifest.
create function public.lean_spend_pilot_register(p_scope jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare p lean_private.spend_pilots; d jsonb; day date; due timestamptz;
  previous_day date; previous_due timestamptz;
begin
  if jsonb_typeof(p_scope) is distinct from 'object' or
    p_scope-array['pilotId','projectRef','accountId','loginCustomerId','maxPages','expiresAt','approvalRef','actorRef','days']<>'{}'::jsonb or
    jsonb_typeof(p_scope->'days') is distinct from 'array' or
    coalesce(p_scope->>'expiresAt','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$'
    then raise exception 'invalid pilot scope'; end if;
  if jsonb_array_length(p_scope->'days') not between 1 and 7 then raise exception 'invalid pilot days'; end if;
  insert into lean_private.spend_pilots
    (pilot_id,project_ref,account_id,login_customer_id,max_pages,expires_at,approval_ref,actor_ref)
    values(p_scope->>'pilotId',p_scope->>'projectRef',p_scope->>'accountId',p_scope->>'loginCustomerId',
      (p_scope->>'maxPages')::integer,(p_scope->>'expiresAt')::timestamptz,p_scope->>'approvalRef',p_scope->>'actorRef')
    returning * into p;
  if p.expires_at<=clock_timestamp() or p.expires_at>clock_timestamp()+interval '14 days'
    then raise exception 'invalid pilot expiry'; end if;
  for d in select value from jsonb_array_elements(p_scope->'days') loop
    if jsonb_typeof(d) is distinct from 'object' or d-array['runId','date','dueAt']<>'{}'::jsonb or
      coalesce(d->>'date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or
      coalesce(d->>'dueAt','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$'
      then raise exception 'invalid pilot day'; end if;
    day:=(d->>'date')::date; due:=(d->>'dueAt')::timestamptz;
    if not isfinite(day) or not isfinite(due) or due>=p.expires_at or
      due<(day+1)::timestamp at time zone 'UTC' or
      day<=previous_day or due<=previous_due then raise exception 'invalid pilot day order'; end if;
    insert into lean_private.spend_jobs
      (run_id,project_ref,account_id,login_customer_id,report_date,max_pages,approval_ref,actor_ref)
      values(d->>'runId',p.project_ref,p.account_id,p.login_customer_id,day,p.max_pages,p.approval_ref,p.actor_ref);
    insert into lean_private.spend_pilot_days values(p.pilot_id,d->>'runId',day,due);
    previous_day:=day; previous_due:=due;
  end loop;
  return true;
end $$;
revoke all on function public.lean_spend_pilot_register(jsonb) from public,anon,authenticated,service_role;

create function public.lean_spend_pilot_next(p_pilot text,p_project_ref text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare p lean_private.spend_pilots; d record;
begin
  select * into p from lean_private.spend_pilots where pilot_id=p_pilot and project_ref=p_project_ref for update;
  if not found then raise exception 'unapproved spend pilot'; end if;
  if not p.enabled then return jsonb_build_object('state','disabled'); end if;
  if p.expires_at<=clock_timestamp() then return jsonb_build_object('state','expired'); end if;
  select m.*,j.enabled,j.attempts,j.lease_until into d from lean_private.spend_pilot_days m
    join lean_private.spend_jobs j using(run_id) where m.pilot_id=p.pilot_id and j.base is null
    order by m.report_date limit 1 for update of j;
  if not found then return jsonb_build_object('state','complete'); end if;
  if not d.enabled then return jsonb_build_object('state','disabled'); end if;
  if d.due_at>clock_timestamp() then return jsonb_build_object('state','not_due'); end if;
  if d.lease_until>clock_timestamp() then return jsonb_build_object('state','busy'); end if;
  if d.attempts>=1 then return jsonb_build_object('state','blocked'); end if;
  return jsonb_build_object('state','ready','runId',d.run_id,'accountId',p.account_id);
end $$;
revoke all on function public.lean_spend_pilot_next(text,text) from public,anon,authenticated,service_role;
grant execute on function public.lean_spend_pilot_next(text,text) to service_role;

-- Keep ordinary 019 semantics; private renamed entrypoints cannot bypass fences.
alter function public.lean_spend_claim(text,text,uuid) rename to lean_spend_claim_019;
alter function public.lean_spend_finish(text,text,uuid,jsonb) rename to lean_spend_finish_019;
revoke all on function public.lean_spend_claim_019(text,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.lean_spend_finish_019(text,text,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.lean_spend_claim(p_run text,p_project_ref text,p_token uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare p lean_private.spend_pilots; d lean_private.spend_pilot_days; r lean_private.spend_jobs; result jsonb;
begin
  select * into d from lean_private.spend_pilot_days where run_id=p_run;
  if not found then return public.lean_spend_claim_019(p_run,p_project_ref,p_token); end if;
  select * into p from lean_private.spend_pilots where pilot_id=d.pilot_id and project_ref=p_project_ref for update;
  if not found then raise exception 'unapproved spend pilot'; end if;
  if not p.enabled or p.expires_at<=clock_timestamp() or d.due_at>clock_timestamp()
    then return jsonb_build_object('state','disabled'); end if;
  select * into r from lean_private.spend_jobs where run_id=p_run for update;
  if not r.enabled then return jsonb_build_object('state','disabled'); end if;
  if r.base is not null then return jsonb_build_object('state','complete'); end if;
  if exists(select 1 from lean_private.spend_pilot_days m join lean_private.spend_jobs j using(run_id)
    where m.pilot_id=p.pilot_id and m.report_date<d.report_date and j.base is null)
    then return jsonb_build_object('state','disabled'); end if;
  if r.lease_until>clock_timestamp() then return jsonb_build_object('state','busy'); end if;
  if r.attempts>=1 then return jsonb_build_object('state','attempts_exhausted'); end if;
  result:=public.lean_spend_claim_019(p_run,p_project_ref,p_token);
  if p.expires_at<=clock_timestamp() then raise exception 'spend pilot expired during claim'; end if;
  return result;
end $$;
create function public.lean_spend_finish(p_run text,p_project_ref text,p_token uuid,p_base jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare p lean_private.spend_pilots; d lean_private.spend_pilot_days; r lean_private.spend_jobs; finished boolean;
begin
  select * into d from lean_private.spend_pilot_days where run_id=p_run;
  if not found then return public.lean_spend_finish_019(p_run,p_project_ref,p_token,p_base); end if;
  select * into p from lean_private.spend_pilots where pilot_id=d.pilot_id and project_ref=p_project_ref for update;
  if not found or not p.enabled or p.expires_at<=clock_timestamp() or d.due_at>clock_timestamp() then return false; end if;
  select * into r from lean_private.spend_jobs where run_id=p_run for update;
  if r.attempts<>1 then return false; end if;
  finished:=public.lean_spend_finish_019(p_run,p_project_ref,p_token,p_base);
  -- A slow write must not succeed after the original lease or absolute expiry.
  if finished and (p.expires_at<=clock_timestamp() or r.lease_until<=clock_timestamp())
    then raise exception 'spend pilot expired during finish'; end if;
  return finished;
end $$;
revoke all on function public.lean_spend_claim(text,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.lean_spend_finish(text,text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.lean_spend_claim(text,text,uuid) to service_role;
grant execute on function public.lean_spend_finish(text,text,uuid,jsonb) to service_role;
commit;
