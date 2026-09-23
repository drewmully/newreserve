-- REVIEW ONLY. Registers no accounts/dates and activates no source or schedule.
begin;
create table lean_private.spend_jobs (
  run_id text primary key check(length(run_id) between 1 and 128),
  project_ref text not null check(project_ref ~ '^[a-z]{20}$'),
  account_id text not null check(account_id ~ '^[0-9]{10}$'),
  login_customer_id text check(login_customer_id ~ '^[0-9]{10}$'),
  report_date date not null check(isfinite(report_date)),
  max_pages integer not null check(max_pages between 1 and 10),
  approval_ref text not null check(length(trim(approval_ref))>0),
  actor_ref text not null check(length(trim(actor_ref))>0),
  enabled boolean not null default false,
  attempts integer not null default 0 check(attempts between 0 and 3),
  lease_token uuid, lease_until timestamptz,
  base jsonb, last_error text
);
alter table lean_private.spend_jobs enable row level security;
revoke all on lean_private.spend_jobs from public,anon,authenticated,service_role;
create function lean_private.spend_scope_immutable() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if (to_jsonb(old)-array['enabled','attempts','lease_token','lease_until','base','last_error']) is distinct from
     (to_jsonb(new)-array['enabled','attempts','lease_token','lease_until','base','last_error']) then
    raise exception 'spend scope immutable; register a new approved run';
  end if;
  if old.base is not null and old.base is distinct from new.base then raise exception 'spend base immutable'; end if;
  return new;
end $$;
create trigger immutable_spend_scope before update on lean_private.spend_jobs
  for each row execute function lean_private.spend_scope_immutable();
create function public.lean_spend_claim(p_run text,p_project_ref text,p_token uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r lean_private.spend_jobs;
begin
  if p_token is null then raise exception 'lease token required'; end if;
  select * into r from lean_private.spend_jobs where run_id=p_run and project_ref=p_project_ref for update;
  if not found then raise exception 'unapproved spend target'; end if;
  if not r.enabled then return jsonb_build_object('state','disabled'); end if;
  if r.base is not null then return jsonb_build_object('state','complete'); end if;
  if r.lease_until>clock_timestamp() then return jsonb_build_object('state','busy'); end if;
  if r.attempts>=3 then return jsonb_build_object('state','attempts_exhausted'); end if;
  update lean_private.spend_jobs set attempts=attempts+1,lease_token=p_token,
    lease_until=clock_timestamp()+interval '120 seconds',last_error=null where run_id=p_run;
  return jsonb_build_object('state','claimed','accountId',r.account_id,'loginCustomerId',r.login_customer_id,
    'date',r.report_date,'maxPages',r.max_pages,'approvalRef',r.approval_ref);
end $$;
create function public.lean_spend_finish(p_run text,p_project_ref text,p_token uuid,p_base jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare r lean_private.spend_jobs;
begin
  select * into r from lean_private.spend_jobs where run_id=p_run and project_ref=p_project_ref for update;
  if not found or not r.enabled or r.base is not null or p_token is null or
     r.lease_token is distinct from p_token or r.lease_until<=clock_timestamp() then return false; end if;
  if p_base is null or jsonb_typeof(p_base)<>'object' or
    p_base->>'provider' is distinct from 'google_ads' or
    p_base->>'accountId' is distinct from r.account_id or
    p_base->>'date' is distinct from r.report_date::text or
    p_base->>'baseReportId' is distinct from p_run or
    p_base->'paginationComplete' is distinct from 'true'::jsonb or
    coalesce(p_base->>'evidenceRef','')='' or
    jsonb_typeof(p_base->'rows') is distinct from 'array'
    then raise exception 'invalid spend base'; end if;
  if jsonb_array_length(p_base->'rows')>r.max_pages*10000 or
    p_base->'verifiedEmpty' is distinct from to_jsonb(jsonb_array_length(p_base->'rows')=0)
    then raise exception 'invalid spend base bounds'; end if;
  update lean_private.spend_jobs set base=p_base,lease_token=null,lease_until=null where run_id=p_run;
  return true;
end $$;
create function public.lean_spend_fail(p_run text,p_project_ref text,p_token uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare changed integer;
begin
  update lean_private.spend_jobs set lease_token=null,lease_until=null,last_error='source_failed'
    where run_id=p_run and project_ref=p_project_ref and lease_token=p_token
      and lease_until>clock_timestamp() and base is null;
  get diagnostics changed = row_count;
  return changed=1;
end $$;
revoke all on function public.lean_spend_claim(text,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.lean_spend_finish(text,text,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.lean_spend_fail(text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.lean_spend_claim(text,text,uuid) to service_role;
grant execute on function public.lean_spend_finish(text,text,uuid,jsonb) to service_role;
grant execute on function public.lean_spend_fail(text,text,uuid) to service_role;
commit;
