// node tools/check-migrations.test.js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkMigration, checkNames, checkPolicies, deployTimeSql } from './check-migrations.js';

const ok = (sql) => assert.deepEqual(checkMigration(sql), [], sql);
const bad = (sql, re) => {
  const p = checkMigration(sql);
  assert.ok(p.length, `expected a problem: ${sql}`);
  if (re) assert.match(p.join('\n'), re);
};

// Schema changes are fine
ok('alter table public.settings add column banner text;');
ok('create table public.coupons (id int primary key);');
ok("comment on column public.pages.lede is 'update public.pages';");
ok('update public.items set hidden = true where release_date < now();');
ok('update public.pages_audit set x = 1;');
ok('create policy "staff update pages" on public.pages for update using (public.is_staff());');
ok('create trigger t before update on public.settings for each row execute function f();');
ok('grant update on public.faqs to authenticated;');

// Changing shop content is not
bad("update public.pages set lede = 'x' where slug = 'faq';", /updates shop content/);
bad('UPDATE settings SET colors = null;', /updates shop content/);
bad("delete from public.faqs where question = 'old';", /deletes shop content/);
bad('truncate table public.pages;', /truncates shop content/);
bad("insert into public.pages (slug, lede) values ('a', 'b') on conflict (slug) do update set lede = excluded.lede;", /do update/);
bad("insert into public.faqs (question) values ('q');", /on conflict do nothing/);
ok("insert into public.pages (slug, lede) values ('new-page', '<p>Hi</p>') on conflict (slug) do nothing;");
ok("insert into public.pages (slug, lede)\nvalues ('a; b', 'it''s; fine')\non conflict do nothing;");

// Function bodies run later, when staff act; `do` blocks run now
ok("create or replace function public.save_settings(v jsonb) returns void language sql as $$ update public.settings set colors = v $$;");
ok("create function f() returns void language plpgsql as $fn$ begin delete from public.faqs where id = 1; end $fn$;");
bad("do $$ begin update public.pages set lede = ''; end $$;", /updates shop content/);

// Comments don't count; the escape hatch does
ok('-- update public.pages set lede = 1;\n/* delete from public.faqs; */ select 1;');
ok("-- content-change-ok: every shop's FAQ named the old cutoff day\nupdate public.faqs set answer = replace(answer, 'Sunday', 'Saturday');");
bad("-- content-change-ok:\nupdate public.faqs set answer = '';");

assert.doesNotMatch(deployTimeSql("select 'update public.pages';"), /update/);
ok("select 'a -- b'; select 1;");
bad("select 'a -- b'; update public.pages set lede = '';", /updates shop content/);
bad("select '/* x'; delete from public.faqs;", /deletes shop content/);

// The rule would have caught the content changes made before it existed
for (const f of ['20261107000000_preorders_pull_list_wording.sql', '20261126000000_theme_colors.sql', '20261211000000_page_text_phone_and_email.sql']) {
  assert.ok(checkMigration(fs.readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), 'utf8')).length, f);
}

// File names
assert.deepEqual(checkNames(['20270101000000_a.sql', '20270101000001_b_c.sql']), []);
assert.match(checkNames(['2027_a.sql'])[0], /14-digit/);
assert.match(checkNames(['20270101000000_Add-Thing.sql'])[0], /lower_snake/);
assert.match(checkNames(['20270101000000_a.sql', '20270101000000_b.sql'])[0], /same version/);

console.log('migration check tests passed');

// Policies work out is_staff() / is_owner() / auth.uid() once per query, not once per row
const polOk = (sql) => assert.deepEqual(checkPolicies(sql), [], sql);
const polBad = (sql) => assert.match(checkPolicies(sql).join('\n'), /once per row/, sql);
polOk('create policy "staff all x" on public.x for all using ((select public.is_staff())) with check ((select public.is_staff()));');
polOk('create policy "own x" on public.x for select using (customer_id in (select id from public.customers where user_id = (select auth.uid())));');
polOk('alter policy "owner x" on public.x using ((select is_owner()));');
polOk('create function f() returns bool language sql as $$ select public.is_staff() $$;');
polOk("create policy p on public.x using (note = 'is_staff()');");
polBad('create policy "staff all x" on public.x for all using (public.is_staff());');
polBad('create policy "staff all x" on public.x for all using (is_staff()) with check (is_staff());');
polBad('alter policy "own x" on public.x using (user_id = auth.uid());');
polBad('create policy p on storage.objects for delete using (bucket_id = \'media\' and public.is_owner());');
