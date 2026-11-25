import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FirebaseError } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import { checkInvestmentWritePermissions } from '../debugPermissions';

function createMockAuth(overrides: Partial<NonNullable<Auth['currentUser']>> | null): Auth {
  if (!overrides) {
    return { currentUser: null } as unknown as Auth;
  }
  return {
    currentUser: {
      uid: 'uid_member_001',
      email: 'member@nexora-invest.example',
      emailVerified: true,
      isAnonymous: false,
      providerData: [{ providerId: 'password', email: 'member@nexora-invest.example' }],
      getIdTokenResult: async () => ({ signInProvider: 'password' }),
      ...overrides,
    },
  } as unknown as Auth;
}

describe('checkInvestmentWritePermissions', () => {
  it('attempts dry-run write when rule denial is expected, logs FirebaseError code & message, and returns actionable feedback', async () => {
    const errors: unknown[][] = [];
    const mockDb = {} as Firestore;
    const mockAuth = createMockAuth({ uid: 'uid_member_pending' });

    let writeCalled = false;
    const result = await checkInvestmentWritePermissions(
      {
        requestId: 'dryrun_invreq_pending_user',
        logger: {
          log: () => undefined,
          warn: () => undefined,
          error: (...args: unknown[]) => errors.push(args),
        },
      },
      {
        db: mockDb,
        auth: mockAuth,
        readDocFn: async (collectionName: string) => {
          if (collectionName === 'users') {
            return {
              uid: 'uid_member_pending',
              userId: 'NX100042',
              status: 'PENDING_VERIFICATION',
              role: 'USER',
            };
          }
          return null;
        },
        writeDocFn: async () => {
          writeCalled = true;
          throw new FirebaseError(
            'permission-denied',
            '7 PERMISSION_DENIED: Missing or insufficient permissions.'
          );
        },
      }
    );

    assert.equal(writeCalled, true);
    assert.equal(result.liveWriteAttempted, true);
    assert.equal(result.status, 'PERMISSION_DENIED');
    assert.equal(result.firestoreError?.code, 'permission-denied');
    assert.match(result.firestoreError?.message || '', /Missing or insufficient permissions/);
    assert.equal(result.failedRule?.id, 'create_user_status_active');
    assert.ok(
      result.actionableFeedback.some((msg) => msg.includes('create_user_status_active'))
    );
    assert.ok(
      errors.some(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('Firestore write rejected')
      )
    );
  });

  it('detects deployment drift if local rules pass and forceLiveWrite rejects with permission-denied', async () => {
    const mockDb = {} as Firestore;
    const mockAuth = createMockAuth({ uid: 'uid_member_active' });

    const result = await checkInvestmentWritePermissions(
      {
        requestId: 'dryrun_invreq_drift_check',
        forceLiveWrite: true,
        logger: {
          log: () => undefined,
          warn: () => undefined,
          error: () => undefined,
        },
      },
      {
        db: mockDb,
        auth: mockAuth,
        readDocFn: async (collectionName: string) => {
          if (collectionName === 'users') {
            return {
              uid: 'uid_member_active',
              userId: 'NX100099',
              status: 'ACTIVE',
              role: 'USER',
            };
          }
          return null;
        },
        writeDocFn: async () => {
          throw new FirebaseError(
            'permission-denied',
            'Missing or insufficient permissions.'
          );
        },
      }
    );

    assert.equal(result.liveWriteAttempted, true);
    assert.equal(result.status, 'PERMISSION_DENIED');
    assert.equal(result.failedRule, null);
    assert.ok(
      result.actionableFeedback.some((msg) =>
        msg.includes('Deploy updated firestore.rules')
      )
    );
  });

  it('skips persistent write in dry-run mode when all local rules pass unless forceLiveWrite is set', async () => {
    const mockDb = {} as Firestore;
    const mockAuth = createMockAuth({ uid: 'uid_member_active' });
    let writeCalled = false;

    const result = await checkInvestmentWritePermissions(
      {
        requestId: 'dryrun_invreq_valid_user',
        logger: {
          log: () => undefined,
          warn: () => undefined,
          error: () => undefined,
        },
      },
      {
        db: mockDb,
        auth: mockAuth,
        readDocFn: async (collectionName: string) => {
          if (collectionName === 'users') {
            return {
              uid: 'uid_member_active',
              userId: 'NX100099',
              status: 'ACTIVE',
              role: 'USER',
            };
          }
          return null;
        },
        writeDocFn: async () => {
          writeCalled = true;
        },
      }
    );

    assert.equal(writeCalled, false);
    assert.equal(result.liveWriteAttempted, false);
    assert.equal(result.status, 'DRY_RUN_ALLOWED');
    assert.equal(result.failedRule, null);
    assert.equal(result.failedConditions.length, 0);
  });
});
