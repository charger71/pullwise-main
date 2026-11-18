-- The "Follow this series?" dialog shows the issue being added: series_follow_preview() now also returns its cover,
-- how many covers it has open (for All covers), and the other open issues that come in with it.
-- Returns { label, issues, next, more }
--   issues: how many issues are open for ordering now (each would be added)
--   next:   { id, title, issue_number, variant, foc_date, release_date, cover_url, cover_thumb_url, covers } for the
--           earliest order cutoff (its main cover), or null when none is open yet
--   more:   the other open issues, earliest cutoff first, up to 6: [{ issue_number, foc_date }]
-- Same titles the sweep would add (no incentives, facsimiles or later printings), before the customer's own
-- removals, mature setting and list limits.

create or replace function public.series_follow_preview(p_key text)
returns jsonb
language sql stable security definer set search_path = public
as $$
  with k as (select public._series_resolve(p_key) as key),
  open_issues as (
    select i.*,
           row_number() over (
             partition by lower(trim(i.title)), i.issue_number, i.publisher
             order by (i.variant is null) desc, (i.variant ~* '^(cvr|cover)\s*a\M') desc, i.id
           ) as rn,
           count(*) over (partition by lower(trim(i.title)), i.issue_number, i.publisher) as covers
    from public.items i, k
    where i.series_key = k.key and i.status = 'pre_order' and not i.hidden
      and not public.is_incentive_variant(i.variant)
      and not public.is_reprint(i.title, i.variant, i.badges)
      and (i.foc_date is null or i.foc_date > public.reservations_close_through())
  ),
  mains as (
    select m.*, row_number() over (order by m.foc_date nulls last, m.release_date nulls last, m.id) as pos
    from open_issues m where m.rn = 1
  )
  select jsonb_build_object(
    'label', coalesce(public._series_label((select key from k)), (select key from k)),
    'issues', (select count(*) from mains),
    'next', (select jsonb_build_object('id', m.id, 'title', m.title, 'issue_number', m.issue_number, 'variant', m.variant,
                                       'foc_date', m.foc_date, 'release_date', m.release_date,
                                       'cover_url', m.cover_url, 'cover_thumb_url', m.cover_thumb_url, 'covers', m.covers)
             from mains m where m.pos = 1),
    'more', coalesce((select jsonb_agg(jsonb_build_object('issue_number', m.issue_number, 'foc_date', m.foc_date) order by m.pos)
                      from mains m where m.pos between 2 and 7), '[]'::jsonb));
$$;

revoke execute on function public.series_follow_preview(text) from public, anon;
grant execute on function public.series_follow_preview(text) to authenticated;
