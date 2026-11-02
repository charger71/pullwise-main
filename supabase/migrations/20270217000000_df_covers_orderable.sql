-- Dynamic Forces ("DF …") titles are a general release the shop can order, so their exclusives aren't skipped
-- (as in js/import/distributors.js SHOP_EDITION). The ones 20270216000000_skip_exclusive_covers.sql hid are shown again.

create or replace function public.is_skipped_cover(p_text text)
returns boolean
language sql immutable
as $$
  select coalesce(public.is_incentive_variant(p_text)
    or (p_text ~* '\mEXCL(USIVE)?\M(?!\s+GIFTS)'
        and p_text !~* '\m(DIRECT\s+MARKET|DM|LUNAR|PRH|DIAMOND|DF)\s+EXCL'
        and p_text !~* '^DF\M'), false);
$$;

update public.items set hidden = false
where hidden and title ~* '^DF\M' and (title || ' ' || coalesce(variant, '')) ~* '\mEXCL(USIVE)?\M'
  and not public.is_incentive_variant(title || ' ' || coalesce(variant, ''));
