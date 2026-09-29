-- OPTIONAL, owner-run only after separate approval. Requires 001.
-- Does not alter legacy facts, functions, hashes, grants, selectors or jobs.
begin;
create table lean_private.order_item_sizes (
  order_item_id text not null,
  publication_id text not null,
  size_value text check (size_value in ('XS','S','M','L','XL','XXL','XXXL')),
  size_status text not null check (size_status in
    ('known','missing','invalid','conflict','unsupported','projection_absent')),
  size_semantics text not null check (size_semantics in
    ('requested_box_top_size','purchased_shirt_variant','unsupported')),
  size_source text not null check (size_source in
    ('custom_attribute_top_size','variant_title_snapshot','none')),
  source_evidence_ref text not null check (btrim(source_evidence_ref)<>''),
  policy_ref text not null check (btrim(policy_ref)<>''),
  mapping_version text not null check (mapping_version='order-size-v1'),
  primary key (order_item_id,publication_id),
  foreign key (order_item_id,publication_id)
    references lean_private.order_items(order_item_id,publication_id) on delete cascade,
  check ((size_status='known')=(size_value is not null)),
  check (
    (size_status='projection_absent' and size_source='none') or
    (size_status='unsupported' and size_semantics='unsupported' and size_source='none') or
    (size_status<>'projection_absent' and
      ((size_semantics='requested_box_top_size' and size_source='custom_attribute_top_size') or
       (size_semantics='purchased_shirt_variant' and size_source='variant_title_snapshot')))
  )
);
alter table lean_private.order_item_sizes enable row level security;
revoke all on lean_private.order_item_sizes from public;

-- Call in the SAME explicit owner transaction as the existing fact writer.
-- No upsert: a conflicting/repeated dimension write must not rewrite evidence.
create function lean_private.write_order_item_sizes(p_publication text,p_rows jsonb)
returns void language plpgsql security invoker set search_path=pg_catalog,lean_private as $$
declare r jsonb; k text;
begin
  if p_publication is null or btrim(p_publication)='' or
     jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'invalid order size batch';
  end if;
  if jsonb_array_length(p_rows) not between 1 and 10000 then
    raise exception 'invalid order size batch';
  end if;
  perform 1 from lean_private.publications
    where publication_id=p_publication and state='candidate' for share;
  if not found then
    raise exception 'order size candidate required';
  end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(r) is distinct from 'object' then
      raise exception 'invalid order size row';
    end if;
    if (select count(*) from jsonb_object_keys(r))<>9 or not r ?& array[
      'order_item_id','publication_id','size_value','size_status','size_semantics',
      'size_source','source_evidence_ref','policy_ref','mapping_version'] or
      r->>'publication_id' is distinct from p_publication then
      raise exception 'invalid order size shape';
    end if;
    for k in select jsonb_object_keys(r) loop
      if jsonb_typeof(r->k) is distinct from 'string' and
        not (k='size_value' and r->k='null'::jsonb) then
        raise exception 'invalid order size field type';
      end if;
    end loop;
  end loop;
  insert into lean_private.order_item_sizes
    select * from jsonb_populate_recordset(null::lean_private.order_item_sizes,p_rows);
end $$;
revoke all on function lean_private.write_order_item_sizes(text,jsonb) from public;
-- Defeat any pre-existing permissive default ACLs without changing those defaults.
do $$
declare role_name text;
begin
  foreach role_name in array array['anon','authenticated','service_role'] loop
    if exists(select 1 from pg_roles where rolname=role_name) then
      execute format('revoke all on lean_private.order_item_sizes from %I',role_name);
      execute format('revoke all on function lean_private.write_order_item_sizes(text,jsonb) from %I',role_name);
    end if;
  end loop;
end $$;
commit;
