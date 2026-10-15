-- Penguin Random House books that come as both a hardcover and a paperback were listed under the same
-- name, differing only in price (and ISBN). The sheet's Format column says which is which, but it wasn't
-- kept, so for the 16 pairs already imported the dearer copy is the hardcover and the cheaper the paperback.
-- New imports add the label from the Format column. A re-import of the original sheet puts any title right.
with pairs as (
  select lower(title) t, coalesce(issue_number, '') i, coalesce(variant, '') v
  from public.items
  where distributor = 'prh'
  group by 1, 2, 3
  having count(*) = 2 and count(distinct price) = 2
),
ranked as (
  select i.id, rank() over (partition by lower(i.title), coalesce(i.issue_number, ''), coalesce(i.variant, '') order by i.price desc) r
  from public.items i
  join pairs p on p.t = lower(i.title) and p.i = coalesce(i.issue_number, '') and p.v = coalesce(i.variant, '')
  where i.distributor = 'prh' and i.title !~* '\m(hardcover|paperback)\M'
)
update public.items i
set title = i.title || case when ranked.r = 1 then ' (Hardcover)' else ' (Paperback)' end
from ranked
where ranked.id = i.id;
