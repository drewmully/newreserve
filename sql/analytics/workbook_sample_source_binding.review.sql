-- PRIVATE REVIEW ONLY. The parent must bind this body to a fresh complete
-- catalog and approved provider-owned transaction. Not an executable approval.
-- Two CHECK replacements. Optional exact private-CAS rebind of one disabled,
-- expired row changes only source/audience and revision+1. Never activates.
do $workbook_sample_source$
declare c record; prior jsonb; after_row jsonb; row_count integer;
  expected jsonb:=coalesce(nullif(current_setting('mymully.workbook_source_transition',true),'')::jsonb,'{"count":0}'::jsonb);
begin
  if current_setting('transaction_isolation')<>'read committed' or
    (select relowner from pg_class where oid='lean_private.workbook_runtime_authorization'::regclass)
      is distinct from current_user::regrole::oid then
    raise exception 'workbook source binding owner/isolation';
  end if;
  -- Preserve the existing selection -> authorization lock order.
  lock table lean_private.selected_publications in share row exclusive mode;
  lock table lean_private.workbook_runtime_authorization in access exclusive mode;
  select count(*) into row_count from lean_private.workbook_runtime_authorization;
  if row_count is distinct from (expected->>'count')::integer or row_count not in (0,1) then
    raise exception 'workbook source binding authorization population changed';
  end if;
  if row_count=1 then
    select to_jsonb(a) into strict prior from lean_private.workbook_runtime_authorization a;
    if prior->'enabled' is distinct from 'false'::jsonb or
      (prior->>'expires_at')::timestamptz>=clock_timestamp() or
      (prior->>'revision')::bigint>=9223372036854775807 or
      prior->>'revision' is distinct from expected->>'revision' or
      encode(sha256(convert_to(prior::text,'UTF8')),'hex') is distinct from expected->>'rowSha256' or
      prior->>'source_id' is distinct from '01a0f3c6-8758-0000-378b-d15c40a96f3a' or
      prior->>'audience' is distinct from 'posthog:353503:source:01a0f3c6-8758-0000-378b-d15c40a96f3a'
      then raise exception 'workbook source binding disabled expired row changed'; end if;
  end if;
  for c in select * from (values
    ('workbook_runtime_authorization_source_id_check','source_id',
      'CHECK ((source_id = ''01a0f3c6-8758-0000-378b-d15c40a96f3a''::text))'),
    ('workbook_runtime_authorization_audience_check','audience',
      'CHECK ((audience = ''posthog:353503:source:01a0f3c6-8758-0000-378b-d15c40a96f3a''::text))')
  ) expected(name,column_name,definition)
  loop
    if not exists(select 1 from pg_constraint p join pg_attribute a
      on a.attrelid=p.conrelid and a.attname=c.column_name and not a.attisdropped
      where p.conrelid='lean_private.workbook_runtime_authorization'::regclass and
        p.conname=c.name and p.contype='c' and p.convalidated and not p.connoinherit and
        p.conkey=array[a.attnum]::smallint[] and pg_get_constraintdef(p.oid,false)=c.definition)
      then raise exception 'workbook source binding preimage changed'; end if;
  end loop;
  alter table lean_private.workbook_runtime_authorization
    drop constraint workbook_runtime_authorization_source_id_check,
    drop constraint workbook_runtime_authorization_audience_check;
  if row_count=1 then
    update lean_private.workbook_runtime_authorization
      set source_id='01a0d9ea-e2b9-0000-381e-e68fc47de66a',
        audience='posthog:353503:source:01a0d9ea-e2b9-0000-381e-e68fc47de66a',
        revision=(prior->>'revision')::bigint+1 where singleton;
  end if;
  alter table lean_private.workbook_runtime_authorization
    add constraint workbook_runtime_authorization_source_id_check
      check(source_id='01a0d9ea-e2b9-0000-381e-e68fc47de66a'),
    add constraint workbook_runtime_authorization_audience_check
      check(audience='posthog:353503:source:01a0d9ea-e2b9-0000-381e-e68fc47de66a');
  if row_count=1 then
    select to_jsonb(a) into strict after_row from lean_private.workbook_runtime_authorization a;
    if after_row-array['source_id','audience','revision'] is distinct from prior-array['source_id','audience','revision'] or
      (after_row->>'revision')::bigint is distinct from (prior->>'revision')::bigint+1 or
      after_row->'enabled' is distinct from 'false'::jsonb or
      (after_row->>'expires_at')::timestamptz>=clock_timestamp()
      then raise exception 'workbook source binding preservation failed'; end if;
  elsif exists(select 1 from lean_private.workbook_runtime_authorization) then
    raise exception 'workbook source binding empty authorization changed';
  end if;
end $workbook_sample_source$;
