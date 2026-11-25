import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCoinPackagesFromCsv,
  buildUpiPaymentIntentUrl,
  calculateCoinsForDepositInr,
  COIN_PACKAGES,
  normalizeUtrReference,
  validateDepositAmountInr,
  validateUtrReference,
} from '../upiGateway.ts';

test('COIN_PACKAGES and buildCoinPackagesFromCsv maintain strict 1 INR = 1 Virtual Coin parity', () => {
  assert.ok(COIN_PACKAGES.length >= 4);
  for (const pkg of COIN_PACKAGES) {
    assert.equal(pkg.coins, calculateCoinsForDepositInr(pkg.amountInr));
  }

  const custom = buildCoinPackagesFromCsv('250, 1500, 5000', 200, 10000);
  assert.deepEqual(
    custom.map((p) => p.amountInr),
    [250, 1500, 5000]
  );
  assert.deepEqual(
    custom.map((p) => p.coins),
    [250, 1500, 5000]
  );
});

test('validateDepositAmountInr enforces integer bounds between ₹100 and ₹5,00,000', () => {
  assert.equal(validateDepositAmountInr(100), null);
  assert.equal(validateDepositAmountInr(5000), null);
  assert.notEqual(validateDepositAmountInr(50), null);
  assert.notEqual(validateDepositAmountInr(100.5), null);
  assert.notEqual(validateDepositAmountInr(600000), null);
});

test('validateUtrReference normalizes and enforces alphanumeric 8..36 char UTR refs', () => {
  assert.equal(normalizeUtrReference(' 4123 4567 8901 '), '412345678901');
  assert.equal(validateUtrReference('412345678901'), null);
  assert.notEqual(validateUtrReference('12345'), null);
  assert.notEqual(validateUtrReference('UTR-1234$'), null);
});

test('buildUpiPaymentIntentUrl generates standard UPI and app-specific deep links without credentials', () => {
  const baseParams = {
    upiId: 'nexora@icici',
    displayName: 'NEXORA Collections',
    amountInr: 1000,
    transactionRef: 'NX100001_DEP',
    note: 'Add 1000 Coins',
  };

  const generic = buildUpiPaymentIntentUrl(baseParams, 'GENERIC');
  const gpay = buildUpiPaymentIntentUrl(baseParams, 'GPAY');
  const phonepe = buildUpiPaymentIntentUrl(baseParams, 'PHONEPE');
  const paytm = buildUpiPaymentIntentUrl(baseParams, 'PAYTM');
  const bhim = buildUpiPaymentIntentUrl(baseParams, 'BHIM');

  assert.match(generic, /^upi:\/\/pay\?/);
  assert.match(generic, /pa=nexora%40icici/);
  assert.match(generic, /am=1000\.00/);
  assert.match(generic, /cu=INR/);
  assert.match(gpay, /^tez:\/\/upi\/pay\?/);
  assert.match(phonepe, /^phonepe:\/\/pay\?/);
  assert.match(paytm, /^paytmmp:\/\/pay\?/);
  assert.match(bhim, /^bhim:\/\/upi\/pay\?/);
});

test('computePackageBonusMetrics calculates flat and percentage bonus structures safely within INR bounds', async () => {
  const { computePackageBonusMetrics, coinPackageRecordToOption } = await import('../upiGateway.ts');

  const pctCalc = computePackageBonusMetrics({
    priceInr: 5000,
    bonusType: 'PERCENTAGE',
    bonusValue: 5,
  });
  assert.equal(pctCalc.error, null);
  assert.equal(pctCalc.baseCoins, 5000);
  assert.equal(pctCalc.bonusCoins, 250);
  assert.equal(pctCalc.totalCoins, 5250);

  const flatCalc = computePackageBonusMetrics({
    priceInr: 10000,
    bonusType: 'FLAT_COINS',
    bonusValue: 800,
  });
  assert.equal(flatCalc.error, null);
  assert.equal(flatCalc.bonusCoins, 800);
  assert.equal(flatCalc.totalCoins, 10800);
  assert.equal(flatCalc.effectivePercent, 8);

  const invalidPct = computePackageBonusMetrics({
    priceInr: 1000,
    bonusType: 'PERCENTAGE',
    bonusValue: 150,
  });
  assert.notEqual(invalidPct.error, null);

  const invalidFlat = computePackageBonusMetrics({
    priceInr: 500,
    bonusType: 'FLAT_COINS',
    bonusValue: 600,
  });
  assert.notEqual(invalidFlat.error, null);

  const opt = coinPackageRecordToOption({
    packageId: 'cpkg_gold_5000',
    name: 'Gold Pack',
    priceInr: 5000,
    baseCoins: 5000,
    bonusType: 'PERCENTAGE',
    bonusValue: 5,
    bonusCoins: 250,
    totalCoins: 5250,
    badgeTag: 'Best Value',
    description: 'High-value package',
    sortOrder: 1,
    isActive: true,
    updatedByUid: 'admin1',
    createdAt: '2026-11-23T00:00:00Z',
    updatedAt: '2026-11-23T00:00:00Z',
  });
  assert.equal(opt.packageId, 'cpkg_gold_5000');
  assert.equal(opt.coins, 5250);
  assert.equal(opt.bonusCoins, 250);
  assert.equal(opt.tag, 'Best Value');
});

test('evaluateUpiGatewayAvailability distinguishes read errors, admin pause, missing active UPI endpoints, and ready state', async () => {
  const { evaluateUpiGatewayAvailability } = await import('../upiGateway.ts');

  const paused = evaluateUpiGatewayAvailability({
    loading: false,
    upiDepositsEnabled: false,
    hasActiveEndpoint: true,
  });
  assert.equal(paused.ready, false);
  assert.equal(paused.reason, 'PAUSED_BY_ADMIN');

  const noEndpoint = evaluateUpiGatewayAvailability({
    loading: false,
    upiDepositsEnabled: true,
    hasActiveEndpoint: false,
  });
  assert.equal(noEndpoint.ready, false);
  assert.equal(noEndpoint.reason, 'NO_ACTIVE_ENDPOINT');
  assert.match(noEndpoint.headline, /UPI Payment Processing Currently Inactive/);

  const readError = evaluateUpiGatewayAvailability({
    loading: false,
    upiDepositsEnabled: true,
    hasActiveEndpoint: false,
    readErrorMessage: 'Unable to load authorized UPI payment endpoints.',
  });
  assert.equal(readError.ready, false);
  assert.equal(readError.reason, 'READ_ERROR');

  const ready = evaluateUpiGatewayAvailability({
    loading: false,
    upiDepositsEnabled: true,
    hasActiveEndpoint: true,
  });
  assert.equal(ready.ready, true);
  assert.equal(ready.reason, 'READY');
});

