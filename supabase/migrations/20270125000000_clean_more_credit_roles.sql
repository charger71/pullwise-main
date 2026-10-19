-- Same cleanup as 20270121, for the other role words credits are written with: "Art by", "Letters by", "Lettering by",
-- "Written by", "Story by", "Original story by", "Illustrations by", "Script by", "Translation by", "Manga by", "Foreword
-- by" and so on. The role words come off as credits are read, and entries already on the Creatives list are merged into
-- the clean name (titles and follows move over; an alias stops the old wording coming back).

create or replace function public._clean_creator_name(p_name text)
returns text
language sql immutable
as $$
  with w(re) as (values (
    'written|story|stories|art|artwork|illustrations?|illustrated|manga|script|letters?|lettering|lettered|translation|translated|'
    'storyboards?|photography|introduction|foreword|afterword|colou?rs?|colou?red|inks?|inked|pencils?|penciled|edited|created|adapted|'
    'organized|designed?|cover|cover art|cover designed'))
  select nullif(trim(regexp_replace(
           regexp_replace(
             regexp_replace(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'),
               '^(?:[\w.]+\s+){0,3}?\m(?:' || w.re || ')(?:\s+\w+){0,2}?\s+by\s+', '', 'i'),
             '[.,]?\s+(?:with\s+)?(?:' || w.re || ')(?:\s+\w+){0,2}?\s+by\s.*$', '', 'i'),
           '[.,\s]+$', '')), '')
  from w;
$$;

do $$
declare
  r record;
begin
  for r in
    select key, public._clean_creator_name(name) as clean
    from public.creator_catalog
    where key ~ '(^| )by ' and public._clean_creator_name(name) is not null
  loop
    if public.person_key(r.clean) is not null and public.person_key(r.clean) <> r.key then
      perform public._merge_artist(r.key, public.person_key(r.clean), r.clean);
    end if;
  end loop;
end $$;
