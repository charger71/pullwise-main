-- More collector badges, which the importer ticks on new titles from their sheet title (js/import/distributors.js
-- autoBadges): one-shots, limited / mini series ("#2 (of 6)"), facsimile reprints and blind bags. The master
-- catalog passes them on to the shops with the titles it adds, so every shop must allow them too.
alter table public.items drop constraint items_badges_chk;
alter table public.items add constraint items_badges_chk check (
  badges <@ array['first_appearance', 'key_issue', 'first_issue', 'final_issue', 'milestone',
                  'one_shot', 'limited_series', 'facsimile', 'blind_bag']
);

-- Tag the titles already here the way an import now tags new ones (same rules as autoBadges). Badges are only
-- added, never removed, so anything staff ticked or unticked by hand on other badges stays as it was.
with src as (
  select id, badges, issue_number,
         concat_ws(' ', title, '#' || issue_number, variant) as t
    from public.items
), wanted as (
  select id, badges, array_remove(array[
           case when issue_number ~ '^0*1([^0-9.]|$)' then 'first_issue' end,
           case when t ~* '\m(one|1)[[:space:]-]*shot\M' then 'one_shot' end,
           case when t ~* '\(\s*of\s+\d+\s*\)' then 'limited_series' end,
           case when t ~* '\mfacsimile\M' then 'facsimile' end,
           case when t ~* '\mblind[[:space:]-]*bag' then 'blind_bag' end
         ], null) as add
    from src
)
update public.items i
   set badges = i.badges || array(select b from unnest(w.add) b where b <> all (i.badges))
  from wanted w
 where w.id = i.id
   and not (w.add <@ i.badges);
