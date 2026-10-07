-- PRIVATE REVIEW ONLY. Additional owner tools for existing installed customer
-- history contracts. Not a reinstall, installer, source binding or activation.
begin;
create function public.lean_history_customer_register(
  p_run text,p_source_run text,p_scope jsonb,p_members jsonb,p_inventory jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare digest text; row jsonb;
begin
  if p_run is null or p_run !~ '^[a-zA-Z0-9_-]{1,100}$' or
    p_source_run is null or p_source_run !~ '^[a-zA-Z0-9_-]{1,100}$' or
    jsonb_typeof(p_scope) is distinct from 'object' or
    jsonb_typeof(p_members) is distinct from 'array' or
    jsonb_typeof(p_inventory) is distinct from 'array'
    then raise exception 'customer registration shape'; end if;
  if jsonb_array_length(p_members) not between 1 and 70000 or
    jsonb_array_length(p_inventory) not between 1 and 70000 or
    octet_length(p_scope::text)+octet_length(p_members::text)+octet_length(p_inventory::text)>268435456
    then raise exception 'customer registration budget'; end if;
  -- No upsert/retry. A duplicate ID or any failed seal rolls back this call.
  insert into lean_private.history_customer_runs(run_id,source_run,scope,enabled)
    values(p_run,p_source_run,p_scope,false);
  for row in select value from jsonb_array_elements(p_members) loop
    if jsonb_typeof(row) is distinct from 'object' or
      not(row ?& array['memberId','customerId','evidence']) or
      row-array['memberId','customerId','evidence']<>'{}'::jsonb or
      jsonb_typeof(row->'memberId') is distinct from 'string' or
      jsonb_typeof(row->'customerId') not in ('string','null') or
      jsonb_typeof(row->'evidence') is distinct from 'object'
      then raise exception 'customer registration member'; end if;
    insert into lean_private.history_customer_members(run_id,member_id,customer_id,evidence)
      values(p_run,row->>'memberId',row->>'customerId',row->'evidence');
  end loop;
  for row in select value from jsonb_array_elements(p_inventory) loop
    if jsonb_typeof(row) is distinct from 'object' or
      not(row ?& array['memberId','orderId','updatedAt','sourceHash','decision']) or
      row-array['memberId','orderId','updatedAt','sourceHash','decision']<>'{}'::jsonb or
      exists(select 1 from jsonb_each(row) x where x.key<>'decision' and jsonb_typeof(x.value)<>'string') or
      jsonb_typeof(row->'decision') is distinct from 'object'
      then raise exception 'customer registration inventory'; end if;
    insert into lean_private.history_customer_inventory(run_id,member_id,order_id,updated_at,source_hash,decision)
      values(p_run,row->>'memberId',row->>'orderId',row->>'updatedAt',row->>'sourceHash',row->'decision');
  end loop;
  -- Existing seal checks the stored CURRENT authority and independent whole
  -- source inventory, including 100 orders/member, 70K generation and hashes.
  digest:=public.lean_history_customer_seal(p_run);
  perform lean_private.history_customer_current_authority(p_run);
  return jsonb_build_object('state','sealed','runId',p_run,'enabled',false,
    'generationHash',digest,'resultHash',null);
end $$;
revoke all on function public.lean_history_customer_register(text,text,jsonb,jsonb,jsonb)
  from public,anon,authenticated,service_role;

create function public.lean_history_customer_completed_binding(p_run text,p_project text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r lean_private.history_customer_runs; a jsonb;
begin
  select * into strict r from lean_private.history_customer_runs where run_id=p_run for share;
  if r.scope->>'projectRef' is distinct from p_project or not r.enabled or r.state<>'complete' or
    r.generation_hash is null or r.result_hash is null
    then raise exception 'customer binding requires completed registered run'; end if;
  a:=lean_private.history_customer_current_authority(p_run);
  if lean_private.history_customer_generation(p_run,false) is distinct from r.generation_hash
    then raise exception 'customer binding source changed'; end if;
  return jsonb_build_object('state','complete','runId',r.run_id,'projectRef',p_project,
    'shop',r.scope->>'shop','sourceRun',r.source_run,
    'sourceCompletionHash',r.scope->>'sourceCompletionHash',
    'generationHash',r.generation_hash,'resultHash',r.result_hash,
    'mappingVersion',r.scope->>'mappingVersion','asOf',r.scope->>'asOf',
    'expiresAt',r.scope->>'expiresAt','reporting',(r.scope->'reporting')-'cohortCoverage',
    'authority',a||jsonb_build_object('projectRef',p_project,'shop',r.scope->>'shop','available',true));
end $$;
revoke all on function public.lean_history_customer_completed_binding(text,text)
  from public,anon,authenticated,service_role;
commit;
