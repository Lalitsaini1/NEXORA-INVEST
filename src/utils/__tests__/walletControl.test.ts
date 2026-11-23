import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getWithdrawalStatusDisplay,
  maskBankAccountNumber,
  maskUpiId,
  validateBankAccountInput,
  validateUserUpiId,
  validateWithdrawalAmountInr,
} from '../walletControl';

test('validateUserUpiId and maskUpiId validate UPI VPAs and mask local parts cleanly', () => {
  assert.equal(validateUserUpiId('user.name@okicici'), null);
  assert.ok(validateUserUpiId('invalid-upi-without-at'));
  assert.equal(maskUpiId('lalitkumar@okhdfcbank'), 'la•••ar@okhdfcbank');
});

test('validateBankAccountInput and maskBankAccountNumber protect sensitive account numbers', () => {
  assert.equal(
    validateBankAccountInput({
      accountHolderName: 'Lalit Kumar',
      bankName: 'HDFC Bank',
      accountNumber: '123456789012',
      confirmAccountNumber: '123456789012',
      ifscCode: 'hdfc0001234',
    }),
    null
  );
  assert.ok(
    validateBankAccountInput({
      accountHolderName: 'Lalit Kumar',
      bankName: 'HDFC Bank',
      accountNumber: '123456789012',
      confirmAccountNumber: '123456789999',
      ifscCode: 'HDFC0001234',
    })
  );
  assert.ok(
    validateBankAccountInput({
      accountHolderName: 'Lalit Kumar',
      bankName: 'HDFC Bank',
      accountNumber: '123456789012',
      confirmAccountNumber: '123456789012',
      ifscCode: 'BADIFSC',
    })
  );
  assert.equal(maskBankAccountNumber('123456789012'), '•••• •••• 9012');
});

test('validateWithdrawalAmountInr enforces bounds against eligible INR balance without coin auto-conversion', () => {
  assert.equal(validateWithdrawalAmountInr(500, 1200), null);
  assert.ok(validateWithdrawalAmountInr(50, 1200)); // below min ₹100
  assert.ok(validateWithdrawalAmountInr(1500, 1200)); // exceeds eligible INR balance
  assert.ok(validateWithdrawalAmountInr(200, 0)); // zero eligible balance
  assert.ok(validateWithdrawalAmountInr(200.5, 1200)); // non-integer
});

test('getWithdrawalStatusDisplay maps all withdrawal statuses to user-friendly labels', () => {
  assert.equal(getWithdrawalStatusDisplay('PENDING').label, 'Pending');
  assert.equal(getWithdrawalStatusDisplay('PROCESSING').label, 'Processing');
  assert.equal(getWithdrawalStatusDisplay('APPROVED').label, 'Approved');
  assert.equal(getWithdrawalStatusDisplay('REJECTED').label, 'Rejected');
  assert.equal(getWithdrawalStatusDisplay('COMPLETED').label, 'Completed');
  assert.equal(getWithdrawalStatusDisplay('PAID').label, 'Completed');
});
