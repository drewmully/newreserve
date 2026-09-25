-- REVIEW ONLY. No feed is configured or enabled. Standing approval is scoped
-- to one shop, scan basis, time interval and daily request/page budget.
begin;
create table lean_private.history_feeds (
  feed_id text primary key check(feed_id ~ '^[a-zA-Z0-9_-]{1,64}$'),
  project_ref text not null check(project_ref ~ '^[a-z]{20}$'),
  shop text not null check(shop ~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$'),
  scan_basis text not null check(scan_basis in ('created_at','updated_at')),
  start_time timestamptz not null,
  stop_time timestamptz,
  watermark timestamptz not null,
  window_seconds integer not null check(window_seconds between 60 and 2678400),
  overlap_seconds integer not null default 0 check(overlap_seconds between 0 and 86400),
  lag_seconds integer not null check(lag_seconds between 60 and 86400),
  page_size integer not null check(page_size between 1 and 5),
  max_pages integer not null check(max_pages between 1 and 2000),
  max_daily_steps integer not null check(max_daily_steps between 1 and 1000),
  approval_ref text not null check(length(trim(approval_ref)) between 1 and 512),
  actor_ref text not null check(length(trim(actor_ref)) between 1 and 512),
  enabled boolean not null default false,
  active_run text references lean_private.history_jobs(run_id),
  sequence_number bigint not null default 0,
  counter_date date,
  used_steps integer not null default 0,
  check(isfinite(start_time) and isfinite(watermark) and watermark>=start_time),
  check(stop_time is null or (isfinite(stop_time) and stop_time>start_time and watermark<=stop_time)),
  check(overlap_seconds<window_seconds and (scan_basis='updated_at' or overlap_seconds=0))
);
create table lean_private.history_feed_completions (
  feed_id text not null references lean_private.history_feeds,
  run_id text not null references lean_private.history_jobs,
  from_watermark timestamptz not null, to_watermark timestamptz not null,
  row_count integer not null, completed_at timestamptz not null default clock_timestamp(),
  primary key(feed_id,run_id)
);
alter table lean_private.history_feeds enable row level security;
alter table lean_private.history_feed_completions enable row level security;
revoke all on lean_private.history_feeds,lean_private.history_feed_completions
  from public,anon,authenticated,service_role,lean_posthog_reader;

create function lean_private.history_feed_immutable() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if (to_jsonb(old)-array['enabled','active_run','watermark','sequence_number','counter_date','used_steps'])
    is distinct from
    (to_jsonb(new)-array['enabled','active_run','watermark','sequence_number','counter_date','used_steps'])
    then raise exception 'feed scope immutable; register a new approved feed'; end if;
  if old.enabled and not new.enabled and old.active_run is not null then
    update lean_private.history_jobs set enabled=false where run_id=old.active_run;
  end if;
  return new;
end $$;
create trigger immutable_history_feed before update on lean_private.history_feeds
  for each row execute function lean_private.history_feed_immutable();

create function public.lean_history_feed_next(p_feed text,p_project_ref text,p_shop text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare f lean_private.history_feeds; h lean_private.history_jobs;
  ceiling_time timestamptz; end_time timestamptz; begin_time timestamptz; id text;
  today date := (statement_timestamp() at time zone 'UTC')::date;
begin
  select * into f from lean_private.history_feeds
    where feed_id=p_feed and project_ref=p_project_ref and shop=p_shop for update;
  if not found then raise exception 'unapproved history feed'; end if;
  if not f.enabled then return jsonb_build_object('state','disabled'); end if;
  if f.active_run is not null then
    select * into strict h from lean_private.history_jobs where run_id=f.active_run for share;
    if h.project_ref<>f.project_ref or h.shop<>f.shop or h.scan_basis<>f.scan_basis or
      h.until_time<=f.watermark or h.from_time>f.watermark then raise exception 'feed dependency mismatch'; end if;
    if not h.enabled then return jsonb_build_object('state','blocked'); end if;
    if h.complete then
      insert into lean_private.history_feed_completions(feed_id,run_id,from_watermark,to_watermark,row_count)
        values(f.feed_id,h.run_id,f.watermark,h.until_time,h.row_count);
      update lean_private.history_feeds set watermark=h.until_time,active_run=null where feed_id=f.feed_id;
      f.watermark := h.until_time; f.active_run := null;
    elsif h.page_count>=h.max_pages then return jsonb_build_object('state','budget_exhausted');
    end if;
  end if;
  if f.stop_time is not null and f.watermark>=f.stop_time then return jsonb_build_object('state','complete'); end if;
  if f.counter_date is distinct from today then
    update lean_private.history_feeds set counter_date=today,used_steps=0 where feed_id=f.feed_id;
    f.used_steps := 0;
  end if;
  if f.used_steps>=f.max_daily_steps then return jsonb_build_object('state','daily_budget_exhausted'); end if;
  if f.active_run is null then
    ceiling_time := date_trunc('minute',statement_timestamp()-make_interval(secs=>f.lag_seconds));
    if f.stop_time is not null then ceiling_time := least(ceiling_time,f.stop_time); end if;
    if ceiling_time<=f.watermark then return jsonb_build_object('state','caught_up'); end if;
    end_time := least(ceiling_time,f.watermark+make_interval(secs=>f.window_seconds));
    begin_time := greatest(f.start_time,f.watermark-make_interval(secs=>f.overlap_seconds));
    id := 'feed:'||f.feed_id||':'||(f.sequence_number+1)::text;
    insert into lean_private.history_jobs(run_id,project_ref,shop,scan_basis,from_time,until_time,
      page_size,max_pages,approval_ref,actor_ref,enabled)
      values(id,f.project_ref,f.shop,f.scan_basis,begin_time,end_time,
        f.page_size,f.max_pages,f.approval_ref,f.actor_ref,true);
    update lean_private.history_feeds set active_run=id,sequence_number=sequence_number+1 where feed_id=f.feed_id;
    f.active_run := id;
  end if;
  update lean_private.history_feeds set used_steps=used_steps+1 where feed_id=f.feed_id;
  return jsonb_build_object('state','ready','runId',f.active_run);
end $$;
revoke all on function public.lean_history_feed_next(text,text,text),lean_private.history_feed_immutable()
  from public,anon,authenticated,service_role,lean_posthog_reader;
grant execute on function public.lean_history_feed_next(text,text,text) to service_role;
commit;
