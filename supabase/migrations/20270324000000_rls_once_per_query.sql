-- Row-level security: work out "is this staff / the owner / which user" once per query, not once per row.
--
-- A policy that calls is_staff(), is_owner() or auth.uid() directly runs the call for every row it checks: a staff
-- screen reading 5,000 reservations ran is_staff() 5,000 times, and joins multiplied it. Written as
-- (select public.is_staff()) the call becomes an init plan that runs once per query, as Supabase's performance
-- advisor recommends. On a shop with ~3,900 reservations a staff query joining reservations, items, orders and
-- customers went from 116 ms to 20 ms, and the saving grows with the data.
--
-- Same rules as before, word for word, with only those calls wrapped. On every shop each table showed the same rows
-- before and after to staff, the owner, a signed-in customer and a signed-out visitor.
-- New policies follow the same rule: tools/check-migrations.js refuses a bare call in a later migration.

alter policy "staff read app visits" on public.app_visits
  using ((select public.is_staff()));
alter policy "staff read catalog sync" on public.catalog_sync_state
  using ((select public.is_staff()));
alter policy "staff all categories" on public.categories
  using ((select public.is_staff()))
  with check ((select public.is_staff()));
alter policy "staff manage chats" on public.chat_conversations
  using ((select public.is_staff()))
  with check ((select public.is_staff()));
alter policy "staff read chat messages" on public.chat_messages
  using ((select public.is_staff()));
alter policy "staff send chat messages" on public.chat_messages
  with check (((select public.is_staff()) AND from_staff));
alter policy "staff all creator_aliases" on public.creator_aliases
  using ((select public.is_staff()))
  with check ((select public.is_staff()));
alter policy "staff all creator_catalog" on public.creator_catalog
  using ((select public.is_staff()))
  with check ((select public.is_staff()));
alter policy "staff read customer messages" on public.customer_messages
  using ((select public.is_staff()));
alter policy "staff all customer_notes" on public.customer_notes
  using ((select public.is_staff()))
  with check ((select public.is_staff()));
alter policy "staff read customer_standing" on public.customer_standing
  using ((select public.is_staff()));
alter policy "staff read customer_standing_log" on public.customer_standing_log
  using ((select public.is_staff()));
alter policy "own customer read" on public.customers
  using ((user_id = (select auth.uid())));
alter policy "own customer update" on public.customers
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));
alter policy "staff all customers" on public.customers
  using ((select public.is_staff()))
  with check ((select public.is_staff()));
alter policy "staff read email log" on public.email_log
  using ((select public.is_staff()));
alter policy "staff all event_signups" on public.event_signups
  using ((select public.is_staff()))
  with check ((select public.is_staff()));
alter policy "staff all events" on public.events
  using ((select public.is_staff()))
  with check ((select public.is_staff()));
alter policy "staff all faqs" on public.faqs
  using ((select public.is_staff()))
  with check ((select public.is_staff()));
alter policy "staff read guest_order_approvals" on public.guest_order_approvals
  using ((select public.is_staff()));
alter policy "staff all import_batches" on public.import_batches
  using ((select public.is_staff()))
  with check ((select public.is_staff()));
alter policy "staff all import_customers" on public.import_customers
  using ((select public.is_staff()))
  with check ((select public.is_staff()));
alter policy "staff all import_exclusions" on public.import_exclusions
  using ((select public.is_staff()))
  with check ((select public.is_staff()));
alter policy "staff all import_lines" on public.import_lines
  using ((select public.is_staff()))
  with check ((select public.is_staff()));
alter policy "owner delete items" on public.items
  using ((select public.is_owner()));
alter policy "public read items" on public.items
  using (((NOT hidden) OR (select public.is_staff())));
alter policy "staff insert items" on public.items
  with check ((select public.is_staff()));
alter policy "staff update items" on public.items
  using ((select public.is_staff()))
  with check ((select public.is_staff()));
alter policy "staff insert job_log" on public.job_log
  with check ((select public.is_staff()));
alter policy "staff read job_log" on public.job_log
  using ((select public.is_staff()));
alter policy "staff read line_cap_flags" on public.line_cap_flags
  using ((select public.is_staff()));
alter policy "owner delete locations" on public.locations
  using ((select public.is_owner()));
alter policy "owner insert locations" on public.locations
  with check ((select public.is_owner()));
alter policy "owner update locations" on public.locations
  using ((select public.is_owner()))
  with check ((select public.is_owner()));
alter policy "staff read locations" on public.locations
  using ((select public.is_staff()));
alter policy "owner delete pages" on public.pages
  using ((select public.is_owner()));
alter policy "staff insert pages" on public.pages
  with check ((select public.is_staff()));
alter policy "staff read pages" on public.pages
  using ((select public.is_staff()));
alter policy "staff update pages" on public.pages
  using ((select public.is_staff()))
  with check ((select public.is_staff()));
alter policy "staff read pickup_notices" on public.pickup_notices
  using ((select public.is_staff()));
alter policy "public read posts" on public.posts
  using ((((published_at IS NOT NULL) AND (published_at <= now())) OR (select public.is_staff())));
alter policy "staff all posts" on public.posts
  using ((select public.is_staff()))
  with check ((select public.is_staff()));
alter policy "staff read prh titles" on public.prh_titles
  using ((select public.is_staff()));
alter policy "staff all pull_import_aliases" on public.pull_import_aliases
  using ((select public.is_staff()))
  with check ((select public.is_staff()));
alter policy "staff all pull_list_exclusions" on public.pull_list_exclusions
  using ((select public.is_staff()))
  with check ((select public.is_staff()));
alter policy "staff all pull_list_log" on public.pull_list_log
  using ((select public.is_staff()))
  with check ((select public.is_staff()));
alter policy "own pull_list_seen read" on public.pull_list_seen
  using ((customer_id IN ( SELECT customers.id
   FROM customers
  WHERE (customers.user_id = (select auth.uid())))));
alter policy "staff read pull_list_seen" on public.pull_list_seen
  using ((select public.is_staff()));
alter policy "own push subscriptions read" on public.push_subscriptions
  using ((customer_id IN ( SELECT customers.id
   FROM customers
  WHERE (customers.user_id = (select auth.uid())))));
alter policy "staff read push subscriptions" on public.push_subscriptions
  using ((select public.is_staff()));
alter policy "staff all qr_codes" on public.qr_codes
  using ((select public.is_staff()))
  with check ((select public.is_staff()));
alter policy "own orders read" on public.reservation_orders
  using ((customer_id IN ( SELECT customers.id
   FROM customers
  WHERE (customers.user_id = (select auth.uid())))));
alter policy "staff all reservation_orders" on public.reservation_orders
  using ((select public.is_staff()))
  with check ((select public.is_staff()));
alter policy "own reservations read" on public.reservations
  using ((order_id IN ( SELECT o.id
   FROM (reservation_orders o
     JOIN customers c ON ((c.id = o.customer_id)))
  WHERE (c.user_id = (select auth.uid())))));
alter policy "staff all reservations" on public.reservations
  using ((select public.is_staff()))
  with check ((select public.is_staff()));
alter policy "staff read search_log" on public.search_log
  using ((select public.is_staff()));
alter policy "staff all series_aliases" on public.series_aliases
  using ((select public.is_staff()))
  with check ((select public.is_staff()));
alter policy "staff all series_catalog" on public.series_catalog
  using ((select public.is_staff()))
  with check ((select public.is_staff()));
alter policy "owner delete settings" on public.settings
  using ((select public.is_owner()));
alter policy "owner insert settings" on public.settings
  with check ((select public.is_owner()));
alter policy "staff update settings" on public.settings
  using ((select public.is_staff()))
  with check ((select public.is_staff()));
alter policy "staff read staff" on public.staff
  using ((select public.is_staff()));
alter policy "owner read staff_audit" on public.staff_audit
  using ((select public.is_owner()));
alter policy "owner insert staff_notice" on public.staff_notice
  with check ((select public.is_owner()));
alter policy "owner update staff_notice" on public.staff_notice
  using ((select public.is_owner()))
  with check ((select public.is_owner()));
alter policy "staff read staff_notice" on public.staff_notice
  using ((select public.is_staff()));
alter policy "own staff push subscriptions read" on public.staff_push_subscriptions
  using (((user_id = (select auth.uid())) AND (select public.is_staff())));
alter policy "own stock alerts add" on public.stock_alerts
  with check ((customer_id IN ( SELECT customers.id
   FROM customers
  WHERE (customers.user_id = (select auth.uid())))));
alter policy "own stock alerts read" on public.stock_alerts
  using ((customer_id IN ( SELECT customers.id
   FROM customers
  WHERE (customers.user_id = (select auth.uid())))));
alter policy "own stock alerts remove" on public.stock_alerts
  using ((customer_id IN ( SELECT customers.id
   FROM customers
  WHERE (customers.user_id = (select auth.uid())))));
alter policy "staff read stock alerts" on public.stock_alerts
  using ((select public.is_staff()));
alter policy "staff all stock reorders" on public.stock_reorders
  using ((select public.is_staff()))
  with check ((select public.is_staff()));
alter policy "own subscriptions read" on public.subscriptions
  using ((customer_id IN ( SELECT customers.id
   FROM customers
  WHERE (customers.user_id = (select auth.uid())))));
alter policy "staff all subscriptions" on public.subscriptions
  using ((select public.is_staff()))
  with check ((select public.is_staff()));
alter policy "staff delete entries" on public.survey_entries
  using ((select public.is_staff()));
alter policy "staff read entries" on public.survey_entries
  using ((select public.is_staff()));
alter policy "staff delete responses" on public.survey_responses
  using ((select public.is_staff()));
alter policy "staff read responses" on public.survey_responses
  using ((select public.is_staff()));
alter policy "public read open surveys" on public.surveys
  using ((is_open OR (select public.is_staff())));
alter policy "staff write surveys" on public.surveys
  using ((select public.is_staff()))
  with check ((select public.is_staff()));
alter policy "owner update trust_settings" on public.trust_settings
  using ((select public.is_owner()))
  with check ((select public.is_owner()));
alter policy "staff read trust_settings" on public.trust_settings
  using ((select public.is_staff()));
alter policy "staff read trust_settings_log" on public.trust_settings_log
  using ((select public.is_staff()));
alter policy "owner delete media" on storage.objects
  using (((bucket_id = 'media'::text) AND (select public.is_owner())));
alter policy "staff update media" on storage.objects
  using (((bucket_id = 'media'::text) AND (select public.is_staff())));
alter policy "staff write media" on storage.objects
  with check (((bucket_id = 'media'::text) AND (select public.is_staff())));
