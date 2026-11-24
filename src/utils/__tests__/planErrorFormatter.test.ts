import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatMemberPlanFunctionError,
  formatPlanInvestmentError,
  InvestmentStageError,
} from '../planErrorFormatter';

test('formatPlanInvestmentError turns handleFirestoreError JSON into clean UI copy without raw JSON', () => {
  const jsonError = new Error(
    JSON.stringify({
      error: 'Missing or insufficient permissions.',
      operationType: 'write',
      path: 'investmentRequests/invreq_123',
      authInfo: {
        userId: 'SVpakaILY7UVHnQIyMFcXDTfkL93',
        emailVerified: true,
      },
    })
  );

  const formatted = formatPlanInvestmentError(jsonError);
  assert.equal(formatted.savedAsPending, false);
  assert.match(formatted.message, /Firestore permission denied/i);
  assert.match(formatted.message, /investmentRequests\/invreq_123/);
  assert.equal(formatted.message.startsWith('{'), false);
});

test('formatPlanInvestmentError preserves savedAsPending and requestId for InvestmentStageError', () => {
  const stageErr = new InvestmentStageError('Insufficient verified coin balance.', {
    requestId: 'invreq_saved_999',
    savedAsPending: true,
    code: 'functions/failed-precondition',
  });

  const formatted = formatPlanInvestmentError(stageErr);
  assert.equal(formatted.savedAsPending, true);
  assert.equal(formatted.requestId, 'invreq_saved_999');
  assert.equal(formatted.message, 'Insufficient verified coin balance.');
});

test('formatMemberPlanFunctionError preserves member backend validation reasons and hides internal [0]', () => {
  const suspendedErr = {
    code: 'functions/permission-denied',
    message: 'Only active member accounts with a verified NX User ID can submit investment requests.',
  };
  const msg = formatMemberPlanFunctionError(suspendedErr, 'Fallback message');
  assert.equal(msg, suspendedErr.message);
  assert.equal(/administrator/i.test(msg), false);

  const internalZeroErr = {
    code: 'functions/internal',
    message: 'internal [0]',
  };
  const unreachableMsg = formatMemberPlanFunctionError(internalZeroErr, 'Fallback message');
  assert.match(unreachableMsg, /Cloud Functions are deployed/i);
  assert.equal(/internal/i.test(unreachableMsg), false);
});
