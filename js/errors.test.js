// Run: node js/errors.test.js
import assert from 'node:assert/strict';
import { friendlyError, fromError } from './errors.js';

const is = (error, text) => assert.equal(friendlyError(error), text);
const like = (error, re) => assert.match(friendlyError(error), re);

is({ code: '23505', message: 'duplicate key value violates unique constraint "items_upc_idx"' }, 'Another title already has that UPC.');
is({ message: 'duplicate key value violates unique constraint "posts_slug_key"' }, 'Another post already uses that web address. Change it.');
is({ code: '23505', message: 'duplicate key value violates unique constraint "something_new_key"' }, 'That already exists, so it wasn’t saved.');
is({ code: '23503', message: 'update or delete on table "items" violates foreign key constraint "reservations_item_id_fkey" on table "reservations"' }, 'It can’t be deleted because reservations still depend on it.');
is({ code: '23503', message: 'insert or update on table "reservations" violates foreign key constraint "reservations_item_id_fkey"' }, 'That refers to something that no longer exists. Reload the page and try again.');
is({ code: '23502', message: 'null value in column "first_name" of relation "customers" violates not-null constraint' }, '“first name” is required.');
is({ code: '23514', message: 'new row for relation "customers" violates check constraint "customers_phone_check"' }, 'The phone number is too long (40 characters at most).');
like({ code: '23514', message: 'new row for relation "widgets" violates check constraint "widgets_weight_check"' }, /“weight” isn’t allowed/);
is({ code: '22001', message: 'value too long for type character varying(80)' }, 'One of the entries is too long (80 characters at most).');
is({ code: '42501', message: 'new row violates row-level security policy for table "items"' }, 'You don’t have permission to do that. Some actions are for owners only.');
is({ message: 'permission denied for table restore_stage' }, 'You don’t have permission to do that. Some actions are for owners only.');
like({ code: 'PGRST301', message: 'JWT expired' }, /sign-in has expired/);
like({ message: 'Failed to fetch' }, /Couldn’t reach the server/);
like({ code: '57014', message: 'canceling statement due to statement timeout' }, /took too long/);
like({ code: '42P01', message: 'relation "public.nope" does not exist' }, /out of step/);
like({ message: 'Edge Function returned a non-2xx status code' }, /server couldn’t do that/);
like({ message: 'The object exceeded the maximum allowed size' }, /too big/);
// Written-for-people messages pass through untouched, and unknown plain text is kept.
is({ message: 'Only an owner can delete a series.' }, 'Only an owner can delete a series.');
is({ message: 'This series has 4 imported titles, so it can’t be deleted here.' }, 'This series has 4 imported titles, so it can’t be deleted here.');
is(new Error('Another survey already uses that link name.'), 'Another survey already uses that link name.');
is({ code: 'P0001', message: 'Mighty Thor #1 is no longer open for pre-order, does not exist in your list, already exists.' }, 'Mighty Thor #1 is no longer open for pre-order, does not exist in your list, already exists.');
is({ code: '42501', message: 'Only an owner can restore data.' }, 'Only an owner can restore data.');
// Raw database text never leaks through.
like({ message: 'syntax error at or near "from"' }, /Something went wrong/);
like(null, /Something went wrong/);

like({ message: 'Email rate limit exceeded' }, /Too many attempts/);
// Running a friendly message through again leaves it alone.
for (const sample of [
  { code: '23505', message: 'duplicate key value violates unique constraint "items_upc_idx"' },
  { code: '23503', message: 'update or delete on table "items" violates foreign key constraint "x" on table "reservations"' },
  { code: '23502', message: 'null value in column "title" of relation "items" violates not-null constraint' },
  { code: '23514', message: 'violates check constraint "customers_phone_check"' },
  { code: '22001', message: 'value too long for type character varying(80)' },
  { code: '42501', message: 'new row violates row-level security policy' },
  { code: 'PGRST301', message: 'JWT expired' },
  { message: 'Failed to fetch' },
  { code: '57014', message: 'statement timeout' },
  { code: '42P01', message: 'relation "x" does not exist' },
  { message: 'syntax error at or near "from"' },
]) {
  const once = friendlyError(sample);
  assert.equal(friendlyError(new Error(once)), once, `not stable: ${once}`);
}

const e = fromError({ code: '23505', message: 'duplicate key value violates unique constraint "items_upc_idx"' });
assert.ok(e instanceof Error);
assert.equal(e.message, 'Another title already has that UPC.');
assert.match(e.raw, /items_upc_idx/);
assert.equal(e.code, '23505');

console.log('error message tests passed');
