-- Page and FAQ text that still says "phone number or email" now says both are needed.
-- Only that wording is replaced, so anything else staff have written is left alone.
update public.pages set
  lede_html = replace(replace(lede_html, 'a phone number and/or email address', 'a phone number and email address'), 'a phone number or email', 'a phone number and email'),
  body_html = replace(replace(body_html, 'a phone number and/or email address', 'a phone number and email address'), 'a phone number or email', 'a phone number and email')
where lede_html ~* 'phone number (or|and/or) email' or body_html ~* 'phone number (or|and/or) email';

update public.faqs set
  answer_html = replace(answer_html, 'a phone number or email', 'a phone number and email')
where answer_html like '%a phone number or email%';
