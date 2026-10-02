-- PRIVATE amendment to exact observed9c5e + annual88047. No activation, row
-- promotion, credential, scope, schedule or renewal. Guarded installer must pin
-- the actual catalog/owner/ACL/hook baseline before its first DDL.
begin;
set local lock_timeout='2s';
set local statement_timeout='15s';
set local idle_in_transaction_session_timeout='20s';
set local search_path=pg_catalog;

-- Exactly three existing functions are replaced below. Transform only pinned
-- prosrc strings so the annual source/lease/exclusion predicate stays identical.
-- Health, claim, throughput and all original review SQL files stay untouched.
do $standing$
declare p regprocedure; expected text; owner_id oid; role_name text;
begin
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'standing amendment requires read committed';
  end if;
  lock table lean_private.observed_delivery_authorization in access exclusive mode;
  lock table lean_private.pipeline_annual_access_rules in access exclusive mode;
  select oid into owner_id from pg_roles where rolname=current_user;
  if exists(select 1 from pg_class where oid in
      ('lean_private.observed_delivery_authorization'::regclass,'lean_private.pipeline_annual_access_rules'::regclass)
      and (relowner<>owner_id or not relrowsecurity)) or
    exists(select 1 from pg_attribute where attrelid in
      ('lean_private.observed_delivery_authorization'::regclass,'lean_private.pipeline_annual_access_rules'::regclass)
      and attname='authorization_mode' and not attisdropped) then
    raise exception 'standing amendment owner, RLS or existing footprint';
  end if;
  perform lean_private.observed_delivery_acl_check();
  for p,expected in select signature::regprocedure,body_hash from (values
    ('lean_private.observed_delivery_snapshot(text)','da6bd44c9caacd48be962895e32f0bcd60acc72ab40d76126e56b22ca46e9536'),
    ('lean_private.observed_delivery_revision_guard()','2fcc603b6a82f327a851cde1c1e7c86df610c685e50290931d7c54fad2f61314'),
    ('public.lean_pipeline_exclude_annual_access(bigint,uuid)','cc5d1cca84407fd0b7e11673d53e00e4f1b8aca51655d5a269ee7f0af6f53228'),
    ('lean_private.pipeline_annual_access_rule_immutable()','07b7ee8248af97177bce99edb6cbc7f23877d952e7705ce6248b0680589e7d89')
  ) pins(signature,body_hash) loop
    if not exists(select 1 from pg_proc where oid=p and proowner=owner_id and
      encode(sha256(convert_to(prosrc,'UTF8')),'hex')=expected) then
      raise exception 'standing amendment function baseline';
    end if;
  end loop;
  foreach role_name in array array['anon','authenticated','service_role','lean_posthog_reader'] loop
    if exists(select 1 from pg_roles where rolname=role_name) and (
      has_table_privilege(role_name,'lean_private.pipeline_annual_access_rules','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or
      has_any_column_privilege(role_name,'lean_private.pipeline_annual_access_rules','SELECT,INSERT,UPDATE,REFERENCES') or
      has_function_privilege(role_name,'public.lean_pipeline_exclude_annual_access(bigint,uuid)','EXECUTE')
        is distinct from (role_name='service_role')) then
      raise exception 'standing amendment annual effective ACL';
    end if;
  end loop;
end $standing$;

-- Locate only the one existing paired lifetime check per table. The installer
-- separately pins its actual definition. Do not assume generated constraint names.
do $standing$
declare rel regclass; names text[]; cname text;
begin
  foreach rel in array array['lean_private.observed_delivery_authorization'::regclass,
    'lean_private.pipeline_annual_access_rules'::regclass] loop
    select array_agg(c.conname::text) into names from pg_constraint c
      where c.conrelid=rel and c.contype='c' and
      (select array_agg(a.attname::text order by a.attname) from pg_attribute a
        where a.attrelid=rel and a.attnum=any(c.conkey))=array['expires_at','not_before']::text[];
    if coalesce(cardinality(names),0)<>1 then raise exception 'standing amendment lifetime check'; end if;
    cname:=names[1];
    execute format('alter table %s add column authorization_mode text not null default ''finite'' check (authorization_mode in (''finite'',''standing''))',rel);
    execute format('alter table %s alter column expires_at drop not null',rel);
    execute format('alter table %s drop constraint %I',rel,cname);
    execute format('alter table %s add constraint standing_authority_lifetime check (
      isfinite(not_before) and (
        (authorization_mode=''finite'' and expires_at is not null and isfinite(expires_at)
          and expires_at>not_before and expires_at-not_before<=interval ''7 days'') or
        (authorization_mode=''standing'' and expires_at is null)))',rel);
  end loop;
end $standing$;

do $standing$
declare fn regprocedure; old_source text; new_source text; definition text; before_part text; after_part text;
begin
  fn:='lean_private.observed_delivery_snapshot(text)'::regprocedure;
  select prosrc into old_source from pg_proc where oid=fn;
  new_source:=replace(old_source,'clock_timestamp()>=a.expires_at',
    '(a.expires_at is not null and clock_timestamp()>=a.expires_at)');
  before_part:='  if octet_length(result::text)>8192';
  after_part:=$body$  if a.authorization_mode='standing' then
    result:=result||jsonb_build_object('authorization_mode','standing');
  end if;
  if octet_length(result::text)>8192$body$;
  new_source:=replace(new_source,before_part,after_part);
  if new_source=old_source or length(old_source)-length(replace(old_source,before_part,''))<>length(before_part) then
    raise exception 'standing snapshot transform';
  end if;
  definition:=pg_get_functiondef(fn);
  execute replace(definition,old_source,new_source);

  -- Existing exact-next-revision and new-token/new-approval rules remain. Only
  -- explicit standing changes add a hash-only audit; legacy finite cleanup is
  -- byte-for-byte the same row mutation and has no added audit side effect.
  fn:='lean_private.observed_delivery_revision_guard()'::regprocedure;
  select prosrc into old_source from pg_proc where oid=fn;
  before_part:=$body$    return new;
  end if;$body$;
  after_part:=$body$    if new.authorization_mode='standing' then
      insert into lean_private.pipeline_operator_audit(event,previous_state,approval_ref,actor_ref)
        values('observed_delivery_standing_change',jsonb_build_object('before',null,'after',to_jsonb(new)),
          new.approval_ref,current_user::text);
    end if;
    return new;
  end if;$body$;
  new_source:=replace(old_source,before_part,after_part);
  before_part:=$body$  return new;
end $body$;
  after_part:=$body$  if old.authorization_mode='standing' or new.authorization_mode='standing' then
    insert into lean_private.pipeline_operator_audit(event,previous_state,approval_ref,actor_ref)
      values('observed_delivery_standing_change',jsonb_build_object('before',to_jsonb(old),'after',to_jsonb(new)),
        new.approval_ref,current_user::text);
  end if;
  return new;
end $body$;
  new_source:=replace(new_source,before_part,after_part);
  if new_source=old_source then raise exception 'standing revision transform'; end if;
  execute replace(pg_get_functiondef(fn),old_source,new_source);

  fn:='public.lean_pipeline_exclude_annual_access(bigint,uuid)'::regprocedure;
  select prosrc into old_source from pg_proc where oid=fn;
  new_source:=replace(old_source,'expires_at>clock_timestamp() for share;',
    '(authorization_mode=''standing'' or expires_at>clock_timestamp()) for share;');
  new_source:=replace(new_source,'clock_timestamp()>=rule.expires_at',
    '(rule.expires_at is not null and clock_timestamp()>=rule.expires_at)');
  if new_source=old_source then raise exception 'standing annual transform'; end if;
  execute replace(pg_get_functiondef(fn),old_source,new_source);
end $standing$;

-- Existing function identities, owners and ACLs are preserved by CREATE OR
-- REPLACE. No runtime role gains table/column access or another RPC.
select lean_private.observed_delivery_acl_check();
commit;
