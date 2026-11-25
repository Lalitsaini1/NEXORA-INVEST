import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FirebaseError } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import {
  debugInvestmentRequestsWritePermissions,
  serializeFirebaseError,
} from './debugPermissions';

describe('debugPermissions temporary utility script', () => {
  it('serializes FirebaseError code, message, and customData cleanly', () => {
    const err = new FirebaseError(
      'permission-denied',
      'Missing or insufficient permissions.',
      { path: 'investmentRequests/debug_perm_1' }
    );

    const serialized = serializeFirebaseError(err);
    assert.equal(serialized.isFirebaseError, true);
    assert.equal(serialized.name, 'FirebaseError');
    assert.equal(serialized.code, 'permission-denied');
    assert.equal(serialized.message, 'Missing or insufficient permissions.');
    assert.deepEqual(serialized.customData, {
      path: 'investmentRequests/debug_perm_1',
    });
  });

  it('catches FirebaseError from investmentRequests write, logs detailed error fields, and pinpoints the failing rule condition', async () => {
    const loggedErrors: unknown[][] = [];
    const loggedInfo: unknown[][] = [];

    const mockAuth = {
      currentUser: {
        uid: 'member_debug_uid_1',
        email: 'member@nexora-invest.example',
        emailVerified: true,
        isAnonymous: false,
        providerData: [{ providerId: 'password', email: 'member@nexora-invest.example' }],
        getIdTokenResult: async () => ({ signInProvider: 'password' }),
      },
    } as unknown as Auth;

    const mockDb = {} as Firestore;

    const result = await debugInvestmentRequestsWritePermissions(
      {
        requestId: 'debug_perm_invreq_test_001',
        userId: 'NX100001',
      },
      {
        db: mockDb,
        auth: mockAuth,
        checkConnectionFn: async () => undefined,
        readDocFn: async (collectionName: string) => {
          if (collectionName === 'users') {
            return {
              uid: 'member_debug_uid_1',
              userId: 'NX100001',
              status: 'PENDING_VERIFICATION',
              role: 'USER',
            };
          }
          return null;
        },
        writeFn: async () => {
          throw new FirebaseError(
            'permission-denied',
            '7 PERMISSION_DENIED: Missing or insufficient permissions.'
          );
        },
        logger: {
          log: (...args: unknown[]) => loggedInfo.push(args),
          error: (...args: unknown[]) => loggedErrors.push(args),
          warn: (...args: unknown[]) => loggedInfo.push(args),
        },
      }
    );

    assert.equal(result.writeSucceeded, false);
    assert.equal(result.firebaseError?.code, 'permission-denied');
    assert.match(result.firebaseError?.message || '', /Missing or insufficient permissions/);
    assert.equal(result.ruleEvaluation.allowed, false);
    assert.equal(result.ruleEvaluation.firstDenyingCondition?.id, 'create_user_status_active');
    assert.ok(
      loggedErrors.some(
        (entry) =>
          typeof entry[0] === 'string' &&
          entry[0].includes('Detailed FirebaseError caught')
      )
    );
    assert.ok(
      loggedErrors.some(
        (entry) =>
          typeof entry[0] === 'string' &&
          entry[0].includes('Pinpointed failing Firestore security rule condition')
      )
    );
  });
});
