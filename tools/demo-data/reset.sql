-- Clears the demo shop's customer-side data so refresh.sql can build it again from nothing. Spliced into the start of
-- refresh.sql's transaction by tools/demo-data.mjs --reset, so a failure leaves the data as it was.
-- (Their chats, app visits, stock alerts and push sign-ups go with them.)
-- Kept: staff (and the super admin), the catalog, series, events, news, pages, FAQs, surveys, QR codes, settings,
-- and any customer linked to a login (with their own orders, lines, follows and mail).
create temp table keep_customers on commit drop as select id, email from public.customers where user_id is not null;

delete from public.pull_list_log where customer_id is null or customer_id not in (select id from keep_customers);
delete from public.reservations where order_id in (
  select id from public.reservation_orders where customer_id is null or customer_id not in (select id from keep_customers));
delete from public.reservation_orders where customer_id is null or customer_id not in (select id from keep_customers);
delete from public.subscriptions where customer_id not in (select id from keep_customers);
delete from public.pull_list_exclusions where customer_id not in (select id from keep_customers);
delete from public.pull_list_seen where customer_id not in (select id from keep_customers);
delete from public.customer_messages where customer_id is null or customer_id not in (select id from keep_customers);
delete from public.customer_notes where customer_id not in (select id from keep_customers);
delete from public.email_log where customer_id is null or customer_id not in (select id from keep_customers);
delete from public.event_signups where email not in (select email from keep_customers);
delete from public.chat_conversations where customer_id is null or customer_id not in (select id from keep_customers);
delete from public.search_log;
delete from public.stock_reorders;
delete from public.order_submissions;  -- its lines go with it
delete from public.shop_order_lines;
delete from public.series_shop_qty;
delete from public.survey_entries;
delete from public.survey_responses;
delete from public.chat_conversations;  -- its messages go with it
delete from public.form_rate;
delete from public.customers where id not in (select id from keep_customers);
update public.qr_codes set scan_count = 0, last_scan_at = now() - interval '3 days';
