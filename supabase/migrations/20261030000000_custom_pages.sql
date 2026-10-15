-- Staff-created pages (Page Text → New page), shown at page.html?slug=…
-- placement: where the page links from — the main menu, the footer, or nowhere.
alter table public.pages
  add column title     text,
  add column custom    boolean not null default false,
  add column placement text not null default 'footer' check (placement in ('menu', 'footer', 'hidden')),
  add column sort      int not null default 0;

-- The CGC Grading page is gone.
delete from public.pages where slug = 'grading';
