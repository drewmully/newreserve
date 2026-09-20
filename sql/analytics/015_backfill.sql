-- REVIEW ONLY. Restricted page staging; no source request or schedule is made.
begin;
create table lean_private.backfill_runs (
  run_id text primary key,
  source text not null,
  approval_ref text not null check(length(trim(approval_ref))>0),
  cursor text,
  page_count integer not null default 0 check(page_count>=0),
  row_count bigint not null default 0 check(row_count>=0),
  complete boolean not null default false
);
create table lean_private.backfill_pages (
  run_id text not null references lean_private.backfill_runs,
  page_number integer not null,
  rows jsonb not null check(jsonb_typeof(rows)='array'),
  primary key(run_id,page_number)
);
alter table lean_private.backfill_runs enable row level security;
alter table lean_private.backfill_pages enable row level security;
revoke all on lean_private.backfill_runs,lean_private.backfill_pages from public;
create function public.lean_commit_backfill_page(p_run text,p_expected_cursor text,p_next_cursor text,p_complete boolean,p_rows jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare r lean_private.backfill_runs;
begin
  if p_complete is null or p_rows is null or jsonb_typeof(p_rows)<>'array' then raise exception 'invalid page'; end if;
  if jsonb_array_length(p_rows)>1000 or p_complete is distinct from (p_next_cursor is null) or
     (p_next_cursor is not null and p_next_cursor is not distinct from p_expected_cursor) then raise exception 'invalid page bounds'; end if;
  select * into r from lean_private.backfill_runs where run_id=p_run for update;
  if not found or r.complete or r.cursor is distinct from p_expected_cursor then return false; end if;
  insert into lean_private.backfill_pages(run_id,page_number,rows) values(p_run,r.page_count+1,p_rows);
  update lean_private.backfill_runs set cursor=p_next_cursor,page_count=page_count+1,
    row_count=row_count+jsonb_array_length(p_rows),complete=p_complete where run_id=p_run;
  return true;
end $$;
revoke all on function public.lean_commit_backfill_page(text,text,text,boolean,jsonb) from public;
grant execute on function public.lean_commit_backfill_page(text,text,text,boolean,jsonb) to service_role;
-- Operator creates each bounded run after independently approving source scope.
-- Committing pages is not reconciliation, certification or publication selection.
commit;
