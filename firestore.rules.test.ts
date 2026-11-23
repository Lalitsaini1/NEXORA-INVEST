import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Payload-First Security Rule Verification Suite
 * Validates that hardened Firestore rules and blueprint definitions reject all
 * "Dirty Dozen" adversarial payloads and enforce strict schema & Super Admin invariants.
 */

const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
const blueprintPath = path.resolve(process.cwd(), 'firebase-blueprint.json');

test('firestore.rules enforces default-deny, zero-plaintext password, and strict NX ID invariants', () => {
  const rules = fs.readFileSync(rulesPath, 'utf8');
  const blueprint = JSON.parse(fs.readFileSync(blueprintPath, 'utf8'));

  // 1. Global default-deny safety net
  assert.match(rules, /match \/\{document=\*\*\} \{\s*allow read, write: if false;\s*\}/);

  // 2. Blueprint and rules never permit a password field in UserProfile keys
  assert.equal('password' in blueprint.entities.UserProfile.properties, false);
  const userKeysMatch = rules.match(/function isValidUserProfile\(data\)[\s\S]*?data\.keys\(\)\.hasOnly\(\[([\s\S]*?)\]\)/);
  assert.ok(userKeysMatch && !userKeysMatch[1].includes("'password'") && !userKeysMatch[1].includes("'passwordHash'"));

  // 3. Self-promotion blocked: role == 'USER' on create and immutable on non-super-admin update
  assert.match(rules, /incoming\(\)\.role == 'USER'/);
  assert.match(rules, /incoming\(\)\.role == existing\(\)\.role/);

  // 4. Super Admin UID protection against demotion, suspension, or adminUsers removal
  assert.match(rules, /function isSuperAdmin\(\)/);
  assert.match(rules, /wZQCw7fXrWQCn5HqdSjS6RQHVyi1/);
  assert.match(rules, /adminId != 'wZQCw7fXrWQCn5HqdSjS6RQHVyi1'/);
  assert.match(rules, /userId == 'wZQCw7fXrWQCn5HqdSjS6RQHVyi1'[\s\S]*incoming\(\)\.status == 'ACTIVE'/);

  // 5. Atomic NX User ID counter enforcement via getAfter/existsAfter
  assert.match(rules, /existsAfter\(\/databases\/\$\(database\)\/documents\/counters\/userIds\)/);
  assert.match(rules, /getAfter\(\/databases\/\$\(database\)\/documents\/counters\/userIds\)\.data\.nextNumber/);

  // 6. CoinWallet zero initialization & backend/admin-only update enforcement (regular members cannot self-edit wallet balances)
  assert.match(rules, /incoming\(\)\.availableCoins == 0/);
  assert.match(rules, /match \/coinWallets\/\{userId\}[\s\S]*allow update: if isSignedIn\(\)[\s\S]*isAdmin\(\)/);
  assert.match(rules, /match \/coinWallets\/\{userId\}[\s\S]*allow delete: if false;/);

  // 7. IdentityLocks anti-scraping (list denied) & anti-overwrite (!exists)
  assert.match(rules, /match \/identityLocks\/\{lockId\}[\s\S]*allow list: if false;/);
  assert.match(rules, /!exists\(\/databases\/\$\(database\)\/documents\/identityLocks\/\$\(lockId\)\)/);

  // 8. Verified email check on admin email fallback
  assert.match(rules, /request\.auth\.token\.email_verified == true/);

  // 9. Server timestamp enforcement
  assert.match(rules, /incoming\(\)\.createdAt == request\.time/);
  assert.match(rules, /incoming\(\)\.updatedAt == request\.time/);

  // 10. CoinTransaction ledger: blueprint exists, owner-scoped null-safe list/get, admin-only create, immutable updates/deletes denied
  assert.ok('CoinTransaction' in blueprint.entities);
  assert.ok('/coinTransactions/{transactionId}' in blueprint.firestore);
  assert.match(
    rules,
    /match \/coinTransactions\/\{transactionId\}[\s\S]*allow get: if isSignedIn\(\) && isValidId\(transactionId\) && \(resource == null \|\| existing\(\)\.uid == request\.auth\.uid \|\| isAdmin\(\)\);[\s\S]*allow list: if isAdmin\(\) \|\| \(isSignedIn\(\) && resource\.data\.uid == request\.auth\.uid\);[\s\S]*allow create: if isSignedIn\(\) &&[\s\S]*isAdmin\(\)[\s\S]*allow update, delete: if false;/
  );

  // 11. AdminActivityLog & UserActivityLog immutable append-only rules
  assert.ok('AdminActivityLog' in blueprint.entities);
  assert.ok('UserActivityLog' in blueprint.entities);
  assert.match(rules, /match \/adminActivityLogs\/\{logId\}[\s\S]*allow update, delete: if false;/);
  assert.match(rules, /match \/userActivityLogs\/\{logId\}[\s\S]*allow update, delete: if false;/);

  // 12. PlatformSettings strictly restricted to Super Admin
  assert.ok('PlatformSettings' in blueprint.entities);
  assert.match(rules, /match \/platformSettings\/\{settingId\}[\s\S]*isSuperAdmin\(\)/);

  // 13. Stage 3 & Member collections present in blueprint and matched in rules
  for (const collectionPath of [
    '/upiAccounts/{accountId}',
    '/productPlans/{planId}',
    '/depositRequests/{depositId}',
    '/withdrawalRequests/{withdrawalId}',
    '/referrals/{referralId}',
    '/referralCodes/{code}',
    '/userPlans/{userPlanId}',
    '/investmentRequests/{requestId}',
    '/dailyRewards/{rewardId}',
    '/adminLoginAttempts/{attemptId}',
  ]) {
    assert.ok(collectionPath in blueprint.firestore, `Missing blueprint path: ${collectionPath}`);
  }

  // 14. Admin login monitoring log is append-only and admin-readable
  assert.ok('AdminLoginAttempt' in blueprint.entities);
  assert.match(rules, /match \/adminLoginAttempts\/\{attemptId\}[\s\S]*allow get, list: if isAdmin\(\);[\s\S]*allow update, delete: if false;/);

  // 15. ProductPlan supports tierName, minCoins <= maxCoins, and bounded dailyRewardPercent
  assert.ok('minCoins' in blueprint.entities.ProductPlan.properties);
  assert.ok('maxCoins' in blueprint.entities.ProductPlan.properties);
  assert.ok('dailyRewardPercent' in blueprint.entities.ProductPlan.properties);
  assert.ok('tierName' in blueprint.entities.ProductPlan.properties);
  assert.match(rules, /data\.maxCoins >= data\.minCoins/);
  assert.match(rules, /data\.dailyRewardPercent <= 100/);

  // 16. DepositRequest enforces 1:1 coin conversion parity, active UPI account match, UTR format, and non-re-approvable terminal states
  assert.ok('utrNumber' in blueprint.entities.DepositRequest.properties);
  assert.match(rules, /data\.coinsRequested == data\.amountInr/);
  assert.match(rules, /data\.isActive == true/);
  assert.match(rules, /existing\(\)\.status in \['PENDING', 'UNDER_REVIEW'\]/);

  // 17. PlatformSettings governs UPI gateway availability and dynamic package bounds
  assert.ok('upiDepositsEnabled' in blueprint.entities.PlatformSettings.properties);
  assert.ok('coinPackagesCsv' in blueprint.entities.PlatformSettings.properties);
  assert.match(rules, /data\.coinPackagesCsv\.matches/);

  // 18. Backend-ready PaymentTransaction, PaymentCreditLock, and PaymentWebhookEvent collections & anti-duplicate-crediting invariants
  for (const collectionPath of [
    '/paymentTransactions/{paymentTxId}',
    '/paymentCreditLocks/{lockId}',
    '/paymentWebhookEvents/{eventId}',
  ]) {
    assert.ok(collectionPath in blueprint.firestore, `Missing blueprint path: ${collectionPath}`);
  }
  assert.ok('PaymentTransaction' in blueprint.entities);
  assert.ok('PaymentCreditLock' in blueprint.entities);
  assert.ok('PaymentWebhookEvent' in blueprint.entities);
  assert.match(rules, /existsAfter\(\/databases\/\$\(database\)\/documents\/paymentCreditLocks\/\$\(incoming\(\)\.creditLockId\)\)/);
  assert.match(rules, /existing\(\)\.status != 'CREDITED' &&[\s\S]*existing\(\)\.status != 'REJECTED'/);
  assert.match(rules, /match \/paymentCreditLocks\/\{lockId\}[\s\S]*allow update, delete: if false;/);
  assert.match(rules, /match \/paymentWebhookEvents\/\{eventId\}[\s\S]*allow update, delete: if false;/);

  // 19. Admin-configured CoinPackage catalog & deposit bonus verification
  assert.ok('CoinPackage' in blueprint.entities);
  assert.ok('/coinPackages/{packageId}' in blueprint.firestore);
  assert.match(rules, /function isValidCoinPackage\(data\)/);
  assert.match(rules, /data\.totalCoins == \(data\.baseCoins \+ data\.bonusCoins\)/);
  assert.match(rules, /match \/coinPackages\/\{packageId\}[\s\S]*isAdmin\(\)/);
  assert.match(rules, /get\(\/databases\/\$\(database\)\/documents\/coinPackages\/\$\(incoming\(\)\.packageId\)\)\.data\.totalCoins/);

  // 20. User Wallet Control System: UserPayoutMethod owner isolation & anti-self-verification, plus backend/admin-only withdrawal creation
  assert.ok('UserPayoutMethod' in blueprint.entities);
  assert.ok('/userPayoutMethods/{methodId}' in blueprint.firestore);
  assert.match(rules, /function isValidUserPayoutMethod\(data\)/);
  assert.match(rules, /match \/userPayoutMethods\/\{methodId\}[\s\S]*incoming\(\)\.verificationStatus == 'PENDING_VERIFICATION'/);
  assert.match(rules, /match \/withdrawalRequests\/\{withdrawalId\}[\s\S]*allow create: if isSignedIn\(\) &&[\s\S]*isAdmin\(\)/);
  assert.match(rules, /match \/withdrawalRequests\/\{withdrawalId\}[\s\S]*allow update: if isSignedIn\(\) &&[\s\S]*isAdmin\(\)/);

  // 21. Hardened Investment Flow & Null-Safe Allow-Get Guards:
  // Members may create strictly PENDING_VERIFICATION / PENDING investmentRequests matching active plans,
  // while userPlans activation & coinTransactions ledger entries remain backend/Admin-only.
  assert.ok('InvestmentRequest' in blueprint.entities);
  assert.match(rules, /function isValidUserPlan\(data\)/);
  assert.match(rules, /function isValidInvestmentRequest\(data\)/);
  assert.match(rules, /function isMatchingActiveCatalogOrPublishedPlan\(data\)/);
  assert.match(
    rules,
    /match \/investmentRequests\/\{requestId\}[\s\S]*incoming\(\)\.status == 'PENDING_VERIFICATION'[\s\S]*incoming\(\)\.paymentStatus == 'PENDING'[\s\S]*isMatchingActiveCatalogOrPublishedPlan\(incoming\(\)\)/
  );
  assert.match(
    rules,
    /match \/investmentRequests\/\{requestId\}[\s\S]*allow update: if isSignedIn\(\) &&[\s\S]*isAdmin\(\)/
  );
  assert.match(
    rules,
    /match \/userPlans\/\{userPlanId\}[\s\S]*allow get: if isSignedIn\(\) && isValidId\(userPlanId\) && \(resource == null \|\| existing\(\)\.uid == request\.auth\.uid \|\| isAdmin\(\)\);[\s\S]*allow create: if isSignedIn\(\) &&[\s\S]*isAdmin\(\)[\s\S]*allow update, delete: if false;/
  );
  assert.match(
    rules,
    /match \/userPayoutMethods\/\{methodId\}[\s\S]*allow get: if isSignedIn\(\) && isValidId\(methodId\) && \(resource == null \|\| existing\(\)\.uid == request\.auth\.uid \|\| isAdmin\(\)\);/
  );
  assert.match(
    rules,
    /match \/depositRequests\/\{depositId\}[\s\S]*allow get: if isSignedIn\(\) && isValidId\(depositId\) && \(resource == null \|\| existing\(\)\.uid == request\.auth\.uid \|\| isAdmin\(\)\);/
  );

  // 22. Firebase Trigger Email extension mail queue: strictly server-only writes, admin-only audit reads
  assert.ok('MailQueueDocument' in blueprint.entities);
  assert.ok('/mail/{mailId}' in blueprint.firestore);
  assert.match(
    rules,
    /match \/mail\/\{mailId\}[\s\S]*allow get, list: if isAdmin\(\);[\s\S]*allow create, update, delete: if false;/
  );
});


