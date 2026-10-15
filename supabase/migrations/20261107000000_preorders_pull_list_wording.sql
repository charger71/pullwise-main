-- Pre-Orders page text: one vocabulary ("pull list") for guests and signed-in customers,
-- and a shorter intro. Only rows still holding the original wording are changed, so anything
-- staff have rewritten in Page Text is left alone.

update public.pages
set lede_html = $new$<p>Add upcoming books to your pull list by <strong>midnight Saturday</strong> before the <strong>Final Order Cutoff</strong> and we'll order a copy with your name on it. <strong>Pay in-store at pickup.</strong></p>$new$
where slug = 'pre-orders'
  and lede_html = $old$<p>Reserve upcoming books by <strong>midnight Saturday</strong> before the <strong>Final Order Cutoff (FOC)</strong> — usually the following Monday, when we place our order with the distributor. We'll order a copy with your name on it. <strong>No payment online: pay in-store at pickup.</strong></p>$old$;

update public.pages
set body_html = $new$<ol><li>Tap <strong>Add to pull list</strong> on any title.</li><li>Sign in with your email to keep your list and get a weekly reminder, or just leave your name and a phone number or email.</li><li>We hold each title for a month after it arrives.</li></ol><p>Limit {max_copies_per_title} copies per customer per title. To change or cancel, edit your list online or call the shop. See our <a href="terms.html">terms</a>.</p>$new$
where slug = 'pre-orders'
  and body_html = $old$<ol><li>Tap <strong>Add to reservation</strong> on as many titles as you like.</li><li>Open your list, set quantities, and leave your name and a phone number or email.</li><li>We'll hold each title for a month after it arrives. Pay when you pick it up.</li></ol><p>Limit {max_copies_per_title} copies per customer per title. To change or cancel, call the shop. See our <a href="terms.html">terms</a>.</p>$old$;
