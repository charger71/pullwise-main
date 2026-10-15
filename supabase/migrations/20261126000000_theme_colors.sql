-- The public site's colors now come from Shop Settings again (they were pinned in CSS).
-- Move the saved colors to the current "Bronze Age Modern + Dusty Blue" palette so the
-- site looks the same as before and the pickers show what the site is using.
update public.settings
set colors = '{"primary":"#982c21","accent":"#e7b84b","ink":"#f4f0ea","paper":"#121212","footer":"#121212"}'
where id = 1;
