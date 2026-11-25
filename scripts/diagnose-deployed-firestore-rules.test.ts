import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  DEFAULT_FIRESTORE_DATABASE_ID,
  extractInvestmentRequestsRulesSnapshot,
  fetchDeployedFirestoreRules,
  formatDiagnosticText,
  parseCliArgs,
  runDiagnostic,
  runInvestmentRequestsMockEvaluation,
  TARGET_PROJECT_ID,
} from './diagnose-deployed-firestore-rules';

describe('diagnose-deployed-firestore-rules script', () => {
  it('defaults to nexora-invest-e4399 and the provisioned Firestore database ID', () => {
    const opts = parseCliArgs([]);
    assert.equal(opts.projectId, TARGET_PROJECT_ID);
    assert.equal(opts.databaseId, DEFAULT_FIRESTORE_DATABASE_ID);
    assert.equal(opts.localOnly, false);
  });

  it('fetches live deployed rules from firebaserules.googleapis.com and verifies parity with local firestore.rules', async () => {
    const localRulesPath = path.resolve(process.cwd(), 'firestore.rules');
    const localRules = fs.readFileSync(localRulesPath, 'utf8');

    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/releases')) {
        return new Response(
          JSON.stringify({
            releases: [
              {
                name: `projects/${TARGET_PROJECT_ID}/releases/cloud.firestore/${DEFAULT_FIRESTORE_DATABASE_ID}`,
                rulesetName: `projects/${TARGET_PROJECT_ID}/rulesets/ruleset_abc123`,
                updateTime: '2026-11-24T08:09:48Z',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.endsWith('/rulesets/ruleset_abc123')) {
        return new Response(
          JSON.stringify({
            name: `projects/${TARGET_PROJECT_ID}/rulesets/ruleset_abc123`,
            createTime: '2026-11-24T08:09:47Z',
            source: {
              files: [{ name: 'firestore.rules', content: localRules }],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not Found', { status: 404 });
    };

    const result = await fetchDeployedFirestoreRules({
      projectId: TARGET_PROJECT_ID,
      databaseId: DEFAULT_FIRESTORE_DATABASE_ID,
      localRulesPath,
      tokenOverride: 'mock-oauth-token',
      fetchImpl: mockFetch,
    });

    assert.equal(result.fetchedLive, true);
    assert.equal(result.rulesSourceLabel, 'LIVE_DEPLOYED');
    assert.equal(result.matchesLocalRules, true);
    assert.equal(result.rulesetName, `projects/${TARGET_PROJECT_ID}/rulesets/ruleset_abc123`);
    assert.ok(result.rulesContent && result.rulesContent.includes('match /investmentRequests/{requestId}'));
  });

  it('reports exact HTTP 403 error and falls back transparently to LOCAL_FALLBACK when rules API denies access', async () => {
    const localRulesPath = path.resolve(process.cwd(), 'firestore.rules');
    const mockFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 403,
            message: 'Caller does not have firebaserules.releases.list permission',
          },
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );

    const result = await fetchDeployedFirestoreRules({
      projectId: TARGET_PROJECT_ID,
      databaseId: DEFAULT_FIRESTORE_DATABASE_ID,
      localRulesPath,
      tokenOverride: 'mock-oauth-token',
      fetchImpl: mockFetch,
    });

    assert.equal(result.fetchedLive, false);
    assert.equal(result.rulesSourceLabel, 'LOCAL_FALLBACK');
    assert.equal(result.errorStatus, 403);
    assert.match(result.errorMessage || '', /firebaserules\.releases\.list/);
    assert.ok(result.rulesContent && result.rulesContent.includes('match /investmentRequests/{requestId}'));
  });

  it('extracts investmentRequests match block and evaluates mock authenticated user request cleanly', () => {
    const localRulesPath = path.resolve(process.cwd(), 'firestore.rules');
    const rules = fs.readFileSync(localRulesPath, 'utf8');
    const extracted = extractInvestmentRequestsRulesSnapshot(rules);

    assert.ok(extracted.investmentRequestsMatchBlock);
    assert.ok(extracted.allowCreateClauses.length >= 15);

    const evaluation = runInvestmentRequestsMockEvaluation({
      databaseId: DEFAULT_FIRESTORE_DATABASE_ID,
      extractedRules: extracted,
    });

    assert.equal(evaluation.primaryEvaluation.allowed, true);
    assert.equal(evaluation.primaryEvaluation.failedConditions.length, 0);
    assert.equal(evaluation.clauseChecklist.length, extracted.allowCreateClauses.length);
    assert.ok(
      evaluation.clauseChecklist.every((item) => item.conditionIds.length > 0 && item.passed),
      'Every extracted allow create clause must map to diagnostic checks and pass for a valid mock user'
    );

    const byScenario = new Map(
      evaluation.negativeDiagnosticScenarios.map((s) => [s.name, s.report])
    );
    assert.equal(byScenario.get('missing_user_profile')?.firstDenyingCondition?.id, 'create_user_profile_exists');
    assert.equal(byScenario.get('user_status_not_active')?.firstDenyingCondition?.id, 'create_user_status_active');
    assert.equal(byScenario.get('anonymous_auth_session')?.firstDenyingCondition?.id, 'isSignedIn');
    assert.equal(byScenario.get('tampered_status_and_cost')?.allowed, false);
  });

  it('renders readable diagnostic report in local-only mode', async () => {
    const output = await runDiagnostic({
      projectId: TARGET_PROJECT_ID,
      databaseId: DEFAULT_FIRESTORE_DATABASE_ID,
      localRulesPath: path.resolve(process.cwd(), 'firestore.rules'),
      json: false,
      summaryOnly: false,
      localOnly: true,
      requireLive: false,
    });
    const text = formatDiagnosticText(output);
    assert.match(text, /nexora-invest-e4399/);
    assert.match(text, /match \/investmentRequests\/\{requestId\}/);
    assert.match(text, /Verdict\s+:\s+ALLOWED/);
  });
});
