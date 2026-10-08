-- REVIEW ONLY. Not applied by this change.
-- Production already has raw_payload plus nullable Shopify identity columns.
-- Make older checkouts of the 20260830 migration compatible without rewriting
-- or dropping historical data. No contract state is inferred or processed.
begin;
do $$
begin
  if not exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='subscription_events' and column_name='raw_payload') then
    if exists (select 1 from information_schema.columns
      where table_schema='public' and table_name='subscription_events' and column_name='payload') then
      alter table public.subscription_events rename column payload to raw_payload;
    else
      alter table public.subscription_events add column raw_payload jsonb;
    end if;
  end if;
end $$;
alter table public.subscription_events add column if not exists shopify_contract_id text;
alter table public.subscription_events add column if not exists shopify_customer_id text;
commit;
