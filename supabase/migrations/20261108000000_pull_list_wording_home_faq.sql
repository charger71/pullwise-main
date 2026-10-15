-- Home page, FAQ: "pull list" instead of "reserve / reservation" (Terms and Privacy keep their policy
-- wording). Each change only applies to text that still has the original wording, so anything staff
-- have since rewritten is left alone.

update public.pages
set lede_html = $new$<p>We place our orders with the distributors on the Final Order Cutoff (FOC) date. Add to your pull list by midnight the Saturday before and we'll order a copy just for you — pay when you pick it up.</p>$new$
where slug = 'home-preorders'
  and lede_html = $old$<p>We place our orders with the distributors on the Final Order Cutoff (FOC) date. Reserve by midnight the Saturday before and we'll order a copy just for you — pay when you pick it up.</p>$old$;

-- "How do pre-orders work?": swap the two sentences about the list, keep the rest of the answer as staff wrote it.
update public.faqs
set answer_html = replace(answer_html,
  'add as many titles as you like to your reservation list, then leave your name and a phone number or email. Reservations close at midnight on the Saturday before',
  'add as many titles as you like to your pull list. Sign in with your email to keep and edit it online, or just leave your name and a phone number or email. You can add titles until midnight on the Saturday before')
where answer_html like '%to your reservation list, then leave your name%';

update public.faqs
set question = 'How do I change or cancel something on my pull list?',
    answer_html = $new$<p>If you have an account, <a href="account.html">sign in</a> and change or remove titles yourself until the order cutoff. Otherwise call the shop at {phone} and give us the phone number you used. We'll look it up and take care of it.</p>$new$
where question = 'How do I change or cancel a reservation?'
  and answer_html = $old$<p>Call the shop at {phone} and give us the phone number you reserved with. We'll look it up and take care of it.</p>$old$;
