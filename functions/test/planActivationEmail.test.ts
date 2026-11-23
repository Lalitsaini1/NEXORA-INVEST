import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMailDocumentId,
  buildPlanActivationEmailPayload,
  escapeHtml,
  isPendingToActiveTransition,
  isValidEmailAddress,
} from '../src/planActivationEmail';

test('isPendingToActiveTransition detects pending -> active and PENDING_VERIFICATION -> ACTIVATED transitions', () => {
  assert.equal(isPendingToActiveTransition('pending', 'active'), true);
  assert.equal(isPendingToActiveTransition('PENDING', 'ACTIVE'), true);
  assert.equal(isPendingToActiveTransition('PENDING_VERIFICATION', 'ACTIVATED'), true);
  assert.equal(isPendingToActiveTransition('pending_verification', 'active'), true);

  // Rejects non-pending origins or non-active destinations
  assert.equal(isPendingToActiveTransition('ACTIVE', 'ACTIVE'), false);
  assert.equal(isPendingToActiveTransition('ACTIVE', 'COMPLETED'), false);
  assert.equal(isPendingToActiveTransition('FAILED', 'ACTIVE'), false);
  assert.equal(isPendingToActiveTransition('PENDING', 'REJECTED'), false);
  assert.equal(isPendingToActiveTransition(undefined, 'ACTIVE'), false);
});

test('buildPlanActivationEmailPayload creates Trigger Email extension schema and escapes HTML safely', () => {
  const payload = buildPlanActivationEmailPayload({
    toEmail: 'Investor@Example.com ',
    fullName: 'Alice <script>alert(1)</script>',
    userId: 'NX100042',
    productName: 'Compute Node & Storage <Plan>',
    planId: 'PLAN_SERVER_1000',
    referenceId: 'uplan_12345',
    coinCost: 1000,
    durationDays: 21,
    totalRewardEntitlement: 1320,
    startDate: '2026-11-23T10:00:00.000Z',
    endDate: '2026-12-14T10:00:00.000Z',
  });

  assert.deepEqual(payload.to, ['investor@example.com']);
  assert.match(payload.message.subject, /Compute Node & Storage <Plan>/);
  assert.match(payload.message.text, /1,000 Coins/);
  assert.match(payload.message.text, /21 Days/);
  assert.match(payload.message.text, /1,320 Coins/);

  // Verifies raw HTML injection tags are escaped in message.html
  assert.equal(payload.message.html.includes('<script>'), false);
  assert.match(payload.message.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(payload.message.html, /Compute Node &amp; Storage &lt;Plan&gt;/);
});

test('buildMailDocumentId creates deterministic deduplication IDs from activated plan reference', () => {
  assert.equal(
    buildMailDocumentId({ activatedUserPlanId: 'uplan_99' }, 'invreq_1'),
    'plan_active_uplan_99'
  );
  assert.equal(
    buildMailDocumentId({ userPlanId: 'uplan_77' }, 'fallback'),
    'plan_active_uplan_77'
  );
  assert.equal(buildMailDocumentId({}, 'invreq_55'), 'plan_active_invreq_55');
  assert.equal(escapeHtml(`"a' & <b/>`), '&quot;a&#39; &amp; &lt;b/&gt;');
  assert.equal(isValidEmailAddress('lalit@example.com'), true);
  assert.equal(isValidEmailAddress('not-an-email'), false);
});
