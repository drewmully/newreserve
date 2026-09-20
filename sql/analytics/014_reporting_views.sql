-- REVIEW ONLY. Requires 013_release.sql. Generated; no credentials or grants to reader roles.
begin;
create trigger candidate_only before insert or update or delete on lean_private."customers" for each row execute function lean_private.guard_candidate();
create trigger candidate_only before insert or update or delete on lean_private."identity_map" for each row execute function lean_private.guard_candidate();
create trigger candidate_only before insert or update or delete on lean_private."orders" for each row execute function lean_private.guard_candidate();
create trigger candidate_only before insert or update or delete on lean_private."order_items" for each row execute function lean_private.guard_candidate();
create trigger candidate_only before insert or update or delete on lean_private."sales_ledger" for each row execute function lean_private.guard_candidate();
create trigger candidate_only before insert or update or delete on lean_private."payments" for each row execute function lean_private.guard_candidate();
create trigger candidate_only before insert or update or delete on lean_private."sessions" for each row execute function lean_private.guard_candidate();
create trigger candidate_only before insert or update or delete on lean_private."marketing_spend_daily" for each row execute function lean_private.guard_candidate();
create trigger candidate_only before insert or update or delete on lean_private."order_attribution" for each row execute function lean_private.guard_candidate();
create trigger candidate_only before insert or update or delete on lean_private."order_item_offers" for each row execute function lean_private.guard_candidate();
create table lean_private."report_store_daily" (
  "shop_id" text not null,
  "publication_id" text not null,
  "definition_version" text not null,
  "readiness" jsonb not null,
  "is_stale" boolean not null,
  "report_date" date not null,
  "gross_merchandise_sales_usd" numeric(20,6),
  "discounts_usd" numeric(20,6),
  "refunds_usd" numeric(20,6),
  "net_merchandise_sales_usd" numeric(20,6),
  "shipping_net_usd" numeric(20,6),
  "tax_net_usd" numeric(20,6),
  "duty_net_usd" numeric(20,6),
  "other_sales_adjustments_usd" numeric(20,6),
  "total_sales_usd" numeric(20,6),
  "collected_cash_usd" numeric(20,6),
  "eligible_orders" bigint,
  "purchase_merchandise_net_usd" numeric(20,6),
  "new_customers" bigint,
  "spend_usd" numeric(20,6),
  "ncac_usd" numeric(20,6),
  "mer" numeric(20,6),
  "aov_usd" numeric(20,6),
  primary key ("shop_id","report_date","definition_version","publication_id"),
  foreign key(publication_id) references lean_private.publications
);
alter table lean_private."report_store_daily" enable row level security;
revoke all on lean_private."report_store_daily" from public;
create trigger candidate_only before insert or update or delete on lean_private."report_store_daily" for each row execute function lean_private.guard_candidate();
create view lean_analytics."store_daily" with (security_barrier=true) as
select r."shop_id",r."publication_id",r."definition_version",r."readiness",(r.is_stale or s.is_stale) as is_stale,r."report_date",r."gross_merchandise_sales_usd",r."discounts_usd",r."refunds_usd",r."net_merchandise_sales_usd",r."shipping_net_usd",r."tax_net_usd",r."duty_net_usd",r."other_sales_adjustments_usd",r."total_sales_usd",r."collected_cash_usd",r."eligible_orders",r."purchase_merchandise_net_usd",r."new_customers",r."spend_usd",r."ncac_usd",r."mer",r."aov_usd"
from lean_private."report_store_daily" r join lean_private.selected_publications s
on s.domain='store_daily' and s.publication_id=r.publication_id;
revoke all on lean_analytics."store_daily" from public;
create table lean_private."report_acquisition_daily" (
  "shop_id" text not null,
  "publication_id" text not null,
  "definition_version" text not null,
  "readiness" jsonb not null,
  "is_stale" boolean not null,
  "report_date" date not null,
  "channel" text not null,
  "campaign_bucket" text not null,
  "model_version" text not null,
  "attributed_purchase_merchandise_net_usd" numeric(20,6),
  "credited_orders" numeric(20,6),
  "weighted_new_customers" numeric(20,6),
  "spend_usd" numeric(20,6),
  "first_party_roas" numeric(20,6),
  "ncac_usd" numeric(20,6),
  primary key ("shop_id","report_date","channel","campaign_bucket","model_version","definition_version","publication_id"),
  foreign key(publication_id) references lean_private.publications
);
alter table lean_private."report_acquisition_daily" enable row level security;
revoke all on lean_private."report_acquisition_daily" from public;
create trigger candidate_only before insert or update or delete on lean_private."report_acquisition_daily" for each row execute function lean_private.guard_candidate();
create view lean_analytics."acquisition_daily" with (security_barrier=true) as
select r."shop_id",r."publication_id",r."definition_version",r."readiness",(r.is_stale or s.is_stale) as is_stale,r."report_date",r."channel",r."campaign_bucket",r."model_version",r."attributed_purchase_merchandise_net_usd",r."credited_orders",r."weighted_new_customers",r."spend_usd",r."first_party_roas",r."ncac_usd"
from lean_private."report_acquisition_daily" r join lean_private.selected_publications s
on s.domain='acquisition_daily' and s.publication_id=r.publication_id;
revoke all on lean_analytics."acquisition_daily" from public;
create table lean_private."report_product_daily" (
  "shop_id" text not null,
  "publication_id" text not null,
  "definition_version" text not null,
  "readiness" jsonb not null,
  "is_stale" boolean not null,
  "report_date" date not null,
  "sku_bucket" text not null,
  "units" numeric(20,6),
  "gross_merchandise_sales_usd" numeric(20,6),
  "discounts_usd" numeric(20,6),
  "refunds_usd" numeric(20,6),
  "net_merchandise_sales_usd" numeric(20,6),
  primary key ("shop_id","report_date","sku_bucket","definition_version","publication_id"),
  foreign key(publication_id) references lean_private.publications
);
alter table lean_private."report_product_daily" enable row level security;
revoke all on lean_private."report_product_daily" from public;
create trigger candidate_only before insert or update or delete on lean_private."report_product_daily" for each row execute function lean_private.guard_candidate();
create view lean_analytics."product_daily" with (security_barrier=true) as
select r."shop_id",r."publication_id",r."definition_version",r."readiness",(r.is_stale or s.is_stale) as is_stale,r."report_date",r."sku_bucket",r."units",r."gross_merchandise_sales_usd",r."discounts_usd",r."refunds_usd",r."net_merchandise_sales_usd"
from lean_private."report_product_daily" r join lean_private.selected_publications s
on s.domain='product_daily' and s.publication_id=r.publication_id;
revoke all on lean_analytics."product_daily" from public;
create table lean_private."report_customer_cohorts" (
  "shop_id" text not null,
  "publication_id" text not null,
  "definition_version" text not null,
  "readiness" jsonb not null,
  "is_stale" boolean not null,
  "cohort_month" date not null,
  "observation_age_days" bigint not null,
  "acquisition_definition_version" text not null,
  "as_of_at" timestamptz not null,
  "mature" boolean not null,
  "cohort_customers" bigint,
  "repeat_customers" bigint,
  "observed_net_merchandise_sales_usd" numeric(20,6),
  "repeat_purchase_rate" numeric(20,6),
  "revenue_ltv_usd" numeric(20,6),
  primary key ("shop_id","cohort_month","observation_age_days","acquisition_definition_version","definition_version","publication_id"),
  foreign key(publication_id) references lean_private.publications
);
alter table lean_private."report_customer_cohorts" enable row level security;
revoke all on lean_private."report_customer_cohorts" from public;
create trigger candidate_only before insert or update or delete on lean_private."report_customer_cohorts" for each row execute function lean_private.guard_candidate();
create view lean_analytics."customer_cohorts" with (security_barrier=true) as
select r."shop_id",r."publication_id",r."definition_version",r."readiness",(r.is_stale or s.is_stale) as is_stale,r."cohort_month",r."observation_age_days",r."acquisition_definition_version",r."as_of_at",r."mature",r."cohort_customers",r."repeat_customers",r."observed_net_merchandise_sales_usd",r."repeat_purchase_rate",r."revenue_ltv_usd"
from lean_private."report_customer_cohorts" r join lean_private.selected_publications s
on s.domain='customer_cohorts' and s.publication_id=r.publication_id;
revoke all on lean_analytics."customer_cohorts" from public;
create table lean_private."report_funnel_daily" (
  "shop_id" text not null,
  "publication_id" text not null,
  "definition_version" text not null,
  "readiness" jsonb not null,
  "is_stale" boolean not null,
  "report_date" date not null,
  "stage_id" text not null,
  "funnel_version" text not null,
  "measured_sessions" bigint,
  "stage_reached_sessions" bigint,
  "mature_sessions" bigint,
  "converted_sessions" bigint,
  "session_conversion_rate" numeric(20,6),
  primary key ("shop_id","report_date","stage_id","funnel_version","definition_version","publication_id"),
  foreign key(publication_id) references lean_private.publications
);
alter table lean_private."report_funnel_daily" enable row level security;
revoke all on lean_private."report_funnel_daily" from public;
create trigger candidate_only before insert or update or delete on lean_private."report_funnel_daily" for each row execute function lean_private.guard_candidate();
create view lean_analytics."funnel_daily" with (security_barrier=true) as
select r."shop_id",r."publication_id",r."definition_version",r."readiness",(r.is_stale or s.is_stale) as is_stale,r."report_date",r."stage_id",r."funnel_version",r."measured_sessions",r."stage_reached_sessions",r."mature_sessions",r."converted_sessions",r."session_conversion_rate"
from lean_private."report_funnel_daily" r join lean_private.selected_publications s
on s.domain='funnel_daily' and s.publication_id=r.publication_id;
revoke all on lean_analytics."funnel_daily" from public;
commit;
