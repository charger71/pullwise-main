-- The status flip (Pre-Order → New This Wednesday → Just Arrived → Available) used to be scheduled by hand after
-- install. Schedule it here so every shop gets it. Hourly, so changes land right after midnight shop time.
-- cron.schedule replaces a job with the same name, so this is safe where it was already scheduled by hand.
select cron.schedule('flip-item-statuses', '0 * * * *', 'select public.flip_item_statuses()');
