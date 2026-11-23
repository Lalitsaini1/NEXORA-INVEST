import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDefaultProfileInputs, deriveDefaultFullName } from '../profileDefaults';

test('deriveDefaultFullName respects 2..80 char bounds and derives clean fallback from email', () => {
  assert.equal(deriveDefaultFullName('Lalit Saini', 'saini.lalit278@gmail.com'), 'Lalit Saini');
  assert.equal(deriveDefaultFullName('', 'saini.lalit278@gmail.com'), 'Saini Lalit278');
  assert.equal(deriveDefaultFullName('A', 'a@example.com'), 'NEXORA Member');
  assert.equal(deriveDefaultFullName(null, null), 'NEXORA Member');
  assert.equal(deriveDefaultFullName('X'.repeat(120), null).length, 80);
});

test('buildDefaultProfileInputs normalizes email, E.164 phone, and authProvider', () => {
  const emailOnly = buildDefaultProfileInputs({
    displayName: null,
    email: ' Saini.Lalit278@GMAIL.COM ',
    phoneNumber: null,
  });
  assert.deepEqual(emailOnly, {
    fullName: 'Saini Lalit278',
    email: 'saini.lalit278@gmail.com',
    mobile: '',
    authProvider: 'password',
  });

  const phoneAndEmail = buildDefaultProfileInputs({
    displayName: 'Verified User',
    email: 'member@nexora.example',
    phoneNumber: '+919876543210',
  });
  assert.deepEqual(phoneAndEmail, {
    fullName: 'Verified User',
    email: 'member@nexora.example',
    mobile: '+919876543210',
    authProvider: 'password+phone',
  });

  const phoneOnly = buildDefaultProfileInputs({
    displayName: '',
    email: '',
    phoneNumber: '+919876543210',
  });
  assert.deepEqual(phoneOnly, {
    fullName: 'NEXORA Member',
    email: '',
    mobile: '+919876543210',
    authProvider: 'phone',
  });
});
