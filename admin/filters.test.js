// Run: node admin/filters.test.js
import assert from 'node:assert/strict';
import { searchTerm, customerFilter, emailMatch, digitsMatch, anyOf } from './filters.js';

// Search text: characters that could change the filter become spaces.
assert.equal(searchTerm('  Jane,(Smith)  '), 'Jane  Smith');
assert.equal(searchTerm('a%b_c"d\\e'), 'a b c d e');
assert.equal(searchTerm(null), '');

// Customer search: name, email, phone digits, plus each word when asked.
assert.equal(customerFilter(''), '');
assert.equal(customerFilter('Smith'), 'name.ilike.%Smith%,email.ilike.%Smith%');
assert.equal(customerFilter('Smith Jane', { words: true }), 'name.ilike.%Smith Jane%,email.ilike.%Smith Jane%,first_name.ilike.%Smith%,last_name.ilike.%Smith%,first_name.ilike.%Jane%,last_name.ilike.%Jane%');
assert.match(customerFilter('502 555 0100'), /phone_digits\.like\.%5025550100%/);
assert.ok(!customerFilter('x,evil.eq.1').includes(',evil'), 'a comma in the search cannot add a clause');

// Email: exact, case-insensitive, underscores kept (and only match themselves), unsafe addresses left out.
assert.equal(emailMatch('email', 'Jane@Example.com'), 'email.ilike.Jane@Example.com');
assert.equal(emailMatch('to_email', 'john_smith+x@mail.co'), 'to_email.ilike.john\\_smith+x@mail.co');
for (const bad of ['a,b@x.com', 'a(b)@x.com', 'a"b@x.com', 'a b@x.com', 'a%b@x.com', 'a*b@x.com', 'a\\b@x.com', '', '  ', null, undefined]) assert.equal(emailMatch('email', bad), '', `left out: ${bad}`);

// Phone digits: only a run of digits.
assert.equal(digitsMatch('phone_digits', '5025550100'), 'phone_digits.eq.5025550100');
for (const bad of ['', null, '502-555', '1);drop', 'abc']) assert.equal(digitsMatch('phone_digits', bad), '');

// Joining: empty clauses disappear.
assert.equal(anyOf('id.eq.5', '', emailMatch('email', 'a,b'), digitsMatch('phone_digits', '123')), 'id.eq.5,phone_digits.eq.123');
assert.equal(anyOf('', null, undefined), '');
assert.equal(anyOf(['a.eq.1', 'b.eq.2'], 'c.eq.3'), 'a.eq.1,b.eq.2,c.eq.3');

console.log('filter tests passed');
