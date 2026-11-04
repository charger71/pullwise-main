-- New survey responses: staff see how many responses nobody has read yet (a count on Admin → Surveys in the menu, on
-- each survey in the list and under Dashboard → Needs Attention). Opening a survey's Results marks its responses read.
--
--   * survey_responses.seen: false until staff open that survey's Results. Responses already in are marked read, so
--     the count starts at nothing new instead of every response ever.
--   * staff_mark_survey_seen(survey): marks one survey's responses read. Staff can only read and delete responses
--     directly, so this is the one way to change them.

alter table public.survey_responses add column seen boolean not null default false;
update public.survey_responses set seen = true;
create index survey_responses_unseen_idx on public.survey_responses (survey_id) where not seen;

create or replace function public.staff_mark_survey_seen(p_survey_id bigint)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Staff only.' using errcode = '42501';
  end if;
  update public.survey_responses set seen = true where survey_id = p_survey_id and not seen;
end;
$$;
revoke execute on function public.staff_mark_survey_seen(bigint) from public, anon;
grant execute on function public.staff_mark_survey_seen(bigint) to authenticated;
