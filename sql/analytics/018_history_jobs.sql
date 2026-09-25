-- REVIEW ONLY. No job is registered/enabled, no schedule or network call is made.
begin;
create table lean_private.history_jobs (
  run_id text primary key check(length(run_id) between 1 and 128),
  project_ref text not null check(project_ref ~ '^[a-z]{20}$'),
  shop text not null check(shop ~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$'),
  from_time timestamptz not null, until_time timestamptz not null,
  page_size integer not null check(page_size between 1 and 5),
  max_pages integer not null check(max_pages between 1 and 2000),
  approval_ref text not null check(length(trim(approval_ref))>0),
  actor_ref text not null check(length(trim(actor_ref))>0),
  enabled boolean not null default false,
  cursor text, page_count integer not null default 0,
  row_count integer not null default 0, complete boolean not null default false,
  check(isfinite(from_time) and isfinite(until_time) and from_time<until_time),
  check(page_count between 0 and max_pages),
  check(row_count between 0 and 10000)
);
create table lean_private.history_pages (
  run_id text not null references lean_private.history_jobs,
  page_number integer not null, expected_cursor text, next_cursor text,
  complete boolean not null, rows jsonb not null check(jsonb_typeof(rows)='array'),
  committed_at timestamptz not null default clock_timestamp(),
  primary key(run_id,page_number),
  unique(run_id,next_cursor)
);
alter table lean_private.history_jobs enable row level security;
alter table lean_private.history_pages enable row level security;
revoke all on lean_private.history_jobs,lean_private.history_pages from public,anon,authenticated,service_role;
create function lean_private.history_scope_immutable() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if (to_jsonb(old)-array['enabled','cursor','page_count','row_count','complete']) is distinct from
     (to_jsonb(new)-array['enabled','cursor','page_count','row_count','complete']) then
    raise exception 'history scope immutable; register a new approved run';
  end if;
  return new;
end $$;
create trigger immutable_history_scope before update on lean_private.history_jobs
  for each row execute function lean_private.history_scope_immutable();
create function public.lean_history_read(p_run text,p_project_ref text,p_shop text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r lean_private.history_jobs;
begin
  select * into r from lean_private.history_jobs
    where run_id=p_run and project_ref=p_project_ref and shop=p_shop;
  if not found then raise exception 'unapproved history target'; end if;
  return jsonb_build_object('state',case when not r.enabled then 'disabled' when r.complete then 'complete'
    when r.page_count>=r.max_pages then 'budget_exhausted' else 'ready' end,
    'shop',r.shop,'fromTime',to_char(r.from_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'untilTime',to_char(r.until_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'approvalRef',r.approval_ref,
    'pageSize',r.page_size,'cursor',r.cursor,'pageCount',r.page_count,'rowCount',r.row_count);
end $$;
create function public.lean_history_commit(p_run text,p_project_ref text,p_shop text,p_expected_page integer,
  p_expected_cursor text,p_next_cursor text,p_complete boolean,p_rows jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare r lean_private.history_jobs; item jsonb; gid text; created timestamptz; revision timestamptz;
  seen text[] := '{}';
begin
  select * into r from lean_private.history_jobs
    where run_id=p_run and project_ref=p_project_ref and shop=p_shop for update;
  if not found then raise exception 'unapproved history target'; end if;
  if not r.enabled or r.complete or r.page_count>=r.max_pages or
     r.page_count is distinct from p_expected_page or r.cursor is distinct from p_expected_cursor then return false; end if;
  if p_rows is null or jsonb_typeof(p_rows)<>'array' or p_complete is null then raise exception 'invalid history page'; end if;
  if jsonb_array_length(p_rows)>r.page_size or r.row_count+jsonb_array_length(p_rows)>10000 or
    p_complete is distinct from (p_next_cursor is null) or
    (not p_complete and (jsonb_array_length(p_rows)=0 or length(p_next_cursor) not between 1 and 4096 or
      p_next_cursor is not distinct from p_expected_cursor or exists(
        select 1 from lean_private.history_pages where run_id=p_run and next_cursor=p_next_cursor)))
    then raise exception 'invalid history page bounds'; end if;
  for item in select value from jsonb_array_elements(p_rows) loop
    gid := item#>>'{source,commerce,order,id}';
    created := (item#>>'{source,commerce,order,createdAt}')::timestamptz;
    revision := (item#>>'{source,commerce,order,updatedAt}')::timestamptz;
    if item#>>'{source,commerce,shop}' is distinct from r.shop or
      item#>>'{source,commerce,apiVersion}' is distinct from '2026-07' or
      gid is null or gid !~ '^gid://shopify/Order/[1-9][0-9]*$' or
      created is null or not isfinite(created) or created<r.from_time or created>=r.until_time or
      revision is null or not isfinite(revision) or revision<created or gid=any(seen) or
      exists(select 1 from lean_private.history_pages h cross join lateral jsonb_array_elements(h.rows) x
        where h.run_id=p_run and x#>>'{source,commerce,order,id}'=gid)
      then raise exception 'history source scope mismatch'; end if;
    seen := array_append(seen,gid);
  end loop;
  insert into lean_private.history_pages(run_id,page_number,expected_cursor,next_cursor,complete,rows)
    values(p_run,r.page_count+1,p_expected_cursor,p_next_cursor,p_complete,p_rows);
  update lean_private.history_jobs set cursor=p_next_cursor,page_count=page_count+1,
    row_count=row_count+jsonb_array_length(p_rows),complete=p_complete where run_id=p_run;
  return true;
end $$;
-- Only complete, retained runs can be read for downstream construction. Each
-- response is bounded to one source page. No public/customer-facing row access.
create function public.lean_history_page(p_run text,p_project_ref text,p_shop text,p_page integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r lean_private.history_jobs; result jsonb;
begin
  select * into r from lean_private.history_jobs
    where run_id=p_run and project_ref=p_project_ref and shop=p_shop;
  if not found or not r.complete or not r.enabled then raise exception 'history unavailable'; end if;
  if p_page is null or p_page<1 or p_page>r.page_count then raise exception 'invalid history page'; end if;
  select rows into strict result from lean_private.history_pages where run_id=p_run and page_number=p_page;
  return result;
end $$;
-- Explicitly undo hosted default grants, not just PUBLIC.
revoke all on function public.lean_history_read(text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.lean_history_commit(text,text,text,integer,text,text,boolean,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.lean_history_page(text,text,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.lean_history_read(text,text,text) to service_role;
grant execute on function public.lean_history_commit(text,text,text,integer,text,text,boolean,jsonb) to service_role;
grant execute on function public.lean_history_page(text,text,text,integer) to service_role;
commit;
