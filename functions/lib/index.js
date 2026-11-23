"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifyUserOnInvestmentRequestActivated = exports.notifyUserOnUserPlanActivated = exports.adminReviewWithdrawalFn = exports.adminVerifyDepositAndCredit = exports.submitWalletWithdrawalFn = exports.investInPlan = exports.createInvestmentRequest = exports.processInvestmentRequest = exports.setNexoraAdminRole = exports.provisionNexoraProfile = void 0;
const node_crypto_1 = require("node:crypto");
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-admin/firestore");
const v2_1 = require("firebase-functions/v2");
const firestore_2 = require("firebase-functions/v2/firestore");
const https_1 = require("firebase-functions/v2/https");
const planActivationEmail_1 = require("./planActivationEmail");
const investmentRequestValidation_1 = require("./investmentRequestValidation");
const PROJECT_ID = process.env.GCLOUD_PROJECT || 'gen-lang-client-0957030568';
const MAIL_COLLECTION = process.env.NEXORA_MAIL_COLLECTION || 'mail';
const DATABASE_ID = process.env.NEXORA_FIRESTORE_DB_ID ||
    'ai-studio-nexorainvest-5bfd69ce-b6b9-406b-b8b5-777b72b7226f';
if (!admin.apps.length) {
    admin.initializeApp({ projectId: PROJECT_ID });
}
const db = (0, firestore_1.getFirestore)(admin.app(), DATABASE_ID);
const SUPER_ADMIN_UID = 'wZQCw7fXrWQCn5HqdSjS6RQHVyi1';
const SUPER_ADMIN_EMAILS = new Set([
    'saini.lalit278@gmail.com',
    'sainil.lalit278@gmail.com',
]);
// Built-in catalog specs imported from ./investmentRequestValidation
function makeId(prefix) {
    return `${prefix}_${Date.now()}_${(0, node_crypto_1.randomUUID)().replace(/-/g, '').slice(0, 12)}`;
}
function sanitizeId(raw) {
    return (0, investmentRequestValidation_1.sanitizeIdentifier)(raw);
}
function sha256Hex(raw) {
    return (0, node_crypto_1.createHash)('sha256').update(raw.trim().toLowerCase()).digest('hex');
}
function maskUpi(upiId) {
    const clean = upiId.trim();
    const atIdx = clean.indexOf('@');
    if (atIdx <= 1)
        return clean;
    const local = clean.slice(0, atIdx);
    const handle = clean.slice(atIdx);
    const head = local.slice(0, Math.min(2, local.length));
    return `${head}${'•'.repeat(Math.max(2, local.length - head.length))}${handle}`;
}
async function assertSuperAdminCaller(request) {
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Authentication is required.');
    }
    const uid = request.auth.uid;
    const email = String(request.auth.token.email || '').toLowerCase();
    const emailVerified = Boolean(request.auth.token.email_verified);
    const claimsSuper = request.auth.token.super_admin === true ||
        request.auth.token.role === 'SUPER_ADMIN';
    if (uid === SUPER_ADMIN_UID ||
        claimsSuper ||
        (emailVerified && SUPER_ADMIN_EMAILS.has(email))) {
        return uid;
    }
    const adminSnap = await db.collection('adminUsers').doc(uid).get();
    if (adminSnap.exists &&
        adminSnap.data()?.active === true &&
        adminSnap.data()?.role === 'SUPER_ADMIN') {
        return uid;
    }
    throw new https_1.HttpsError('permission-denied', 'Only the verified Super Admin may perform this operation.');
}
async function assertAdminCaller(request) {
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Authentication is required.');
    }
    const uid = request.auth.uid;
    const email = String(request.auth.token.email || '').toLowerCase();
    const emailVerified = Boolean(request.auth.token.email_verified);
    const claimsSuper = request.auth.token.super_admin === true ||
        request.auth.token.role === 'SUPER_ADMIN';
    const claimsAdmin = request.auth.token.admin === true || request.auth.token.role === 'ADMIN';
    if (uid === SUPER_ADMIN_UID ||
        claimsSuper ||
        (emailVerified && SUPER_ADMIN_EMAILS.has(email))) {
        return { uid, email, role: 'SUPER_ADMIN' };
    }
    const adminSnap = await db.collection('adminUsers').doc(uid).get();
    if (adminSnap.exists && adminSnap.data()?.active === true) {
        const docRole = adminSnap.data()?.role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'ADMIN';
        return { uid, email, role: docRole };
    }
    if (claimsAdmin) {
        return { uid, email, role: 'ADMIN' };
    }
    throw new https_1.HttpsError('permission-denied', 'Verified Administrator privileges are required.');
}
/**
 * Production Firebase Cloud Function for backend-governed registration provisioning.
 */
exports.provisionNexoraProfile = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Authentication is required.');
    }
    const uid = request.auth.uid;
    const fullName = String(request.data?.fullName || '').trim();
    const email = String(request.auth.token.email || request.data?.email || '')
        .trim()
        .toLowerCase()
        .slice(0, 160);
    const mobile = String(request.auth.token.phone_number || request.data?.mobile || '')
        .trim()
        .slice(0, 20);
    if (fullName.length < 2 || fullName.length > 80) {
        throw new https_1.HttpsError('invalid-argument', 'Full name must be between 2 and 80 characters.');
    }
    const userRef = db.collection('users').doc(uid);
    const walletRef = db.collection('coinWallets').doc(uid);
    const counterRef = db.collection('counters').doc('userIds');
    const emailLockId = email ? `email_${sha256Hex(email)}` : '';
    const mobileLockId = mobile ? `mobile_${sha256Hex(mobile)}` : '';
    const emailLockRef = emailLockId ? db.collection('identityLocks').doc(emailLockId) : null;
    const mobileLockRef = mobileLockId ? db.collection('identityLocks').doc(mobileLockId) : null;
    const result = await db.runTransaction(async (tx) => {
        const existing = await tx.get(userRef);
        if (existing.exists) {
            return existing.data();
        }
        const [counterSnap, walletSnap, emailLockSnap, mobileLockSnap] = await Promise.all([
            tx.get(counterRef),
            tx.get(walletRef),
            emailLockRef ? tx.get(emailLockRef) : Promise.resolve(null),
            mobileLockRef ? tx.get(mobileLockRef) : Promise.resolve(null),
        ]);
        if (emailLockSnap?.exists && emailLockSnap.data()?.uid !== uid) {
            throw new https_1.HttpsError('already-exists', 'Email is already registered to another account.');
        }
        if (mobileLockSnap?.exists && mobileLockSnap.data()?.uid !== uid) {
            throw new https_1.HttpsError('already-exists', 'Mobile number is already registered to another account.');
        }
        const nextNum = counterSnap.exists ? Number(counterSnap.data()?.nextNumber || 100001) : 100001;
        const assignedUserId = `NX${nextNum}`;
        tx.set(counterRef, {
            nextNumber: nextNum + 1,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        });
        const profile = {
            uid,
            userId: assignedUserId,
            role: 'USER',
            fullName,
            email,
            mobile,
            emailVerified: Boolean(request.auth?.token.email_verified),
            mobileVerified: Boolean(request.auth?.token.phone_number),
            authProvider: request.auth?.token.phone_number ? 'phone' : 'password',
            status: 'ACTIVE',
            createdAt: firestore_1.FieldValue.serverTimestamp(),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        };
        tx.set(userRef, profile);
        if (!walletSnap.exists) {
            tx.set(walletRef, {
                uid,
                userId: assignedUserId,
                availableCoins: 0,
                purchasedCoins: 0,
                earnedCoins: 0,
                coinsUsedForPlans: 0,
                pendingTransactionCoins: 0,
                withdrawableBalanceInr: 0,
                updatedAt: firestore_1.FieldValue.serverTimestamp(),
            });
        }
        if (emailLockRef && emailLockId && !emailLockSnap?.exists) {
            tx.set(emailLockRef, {
                type: 'EMAIL',
                valueHash: emailLockId.replace('email_', ''),
                uid,
                createdAt: firestore_1.FieldValue.serverTimestamp(),
            });
        }
        if (mobileLockRef && mobileLockId && !mobileLockSnap?.exists) {
            tx.set(mobileLockRef, {
                type: 'MOBILE',
                valueHash: mobileLockId.replace('mobile_', ''),
                uid,
                createdAt: firestore_1.FieldValue.serverTimestamp(),
            });
        }
        return profile;
    });
    return result;
});
/**
 * Super Admin callable to assign or revoke ADMIN role with Firebase Custom Claims
 * while preserving existing claims and strictly protecting SUPER_ADMIN_UID.
 */
exports.setNexoraAdminRole = (0, https_1.onCall)(async (request) => {
    const actorUid = await assertSuperAdminCaller(request);
    const targetUid = String(request.data?.targetUid || '').trim();
    const nextRole = String(request.data?.role || '').toUpperCase();
    if (!targetUid) {
        throw new https_1.HttpsError('invalid-argument', 'targetUid is required.');
    }
    if (targetUid === SUPER_ADMIN_UID) {
        throw new https_1.HttpsError('permission-denied', 'Protected Super Admin account cannot be modified or demoted.');
    }
    if (nextRole !== 'ADMIN' && nextRole !== 'USER') {
        throw new https_1.HttpsError('invalid-argument', 'Role must be ADMIN or USER.');
    }
    const targetUser = await admin.auth().getUser(targetUid);
    const preservedClaims = { ...(targetUser.customClaims || {}) };
    if (nextRole === 'ADMIN') {
        preservedClaims.role = 'ADMIN';
        preservedClaims.admin = true;
    }
    else {
        delete preservedClaims.role;
        delete preservedClaims.admin;
    }
    await admin.auth().setCustomUserClaims(targetUid, preservedClaims);
    const batch = db.batch();
    const userRef = db.collection('users').doc(targetUid);
    const adminRef = db.collection('adminUsers').doc(targetUid);
    const logRef = db.collection('adminActivityLogs').doc();
    batch.set(userRef, {
        role: nextRole,
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
    }, { merge: true });
    if (nextRole === 'ADMIN') {
        batch.set(adminRef, {
            uid: targetUid,
            email: (targetUser.email || '').toLowerCase(),
            role: 'ADMIN',
            active: true,
            createdByUid: actorUid,
            createdAt: firestore_1.FieldValue.serverTimestamp(),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        }, { merge: true });
    }
    else {
        batch.set(adminRef, {
            uid: targetUid,
            role: 'ADMIN',
            active: false,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        }, { merge: true });
    }
    batch.set(logRef, {
        logId: logRef.id,
        actorUid,
        actorEmail: String(request.auth?.token.email || ''),
        actorRole: 'SUPER_ADMIN',
        actionType: nextRole === 'ADMIN' ? 'USER_PROMOTED_TO_ADMIN' : 'ADMIN_REVOKED',
        targetId: targetUid,
        summary: `Server role change for ${targetUser.email || targetUid} -> ${nextRole}`,
        createdAt: firestore_1.FieldValue.serverTimestamp(),
    });
    await batch.commit();
    return { ok: true, targetUid, role: nextRole };
});
function assertAuthenticatedMember(request) {
    if (!request.auth || !request.auth.uid) {
        throw new https_1.HttpsError('unauthenticated', 'Authentication is required to submit or process investment requests.');
    }
    const firebaseMeta = request.auth.token?.firebase;
    if (firebaseMeta?.sign_in_provider === 'anonymous') {
        throw new https_1.HttpsError('permission-denied', 'Anonymous sessions cannot submit or activate investments. Please sign in to a verified member account.');
    }
    return request.auth.uid;
}
function assertValidCallableInvestmentInput(data) {
    const tamperCheck = (0, investmentRequestValidation_1.detectTamperedServerFields)(data);
    if (!tamperCheck.ok) {
        throw new https_1.HttpsError('permission-denied', tamperCheck.message);
    }
    const record = (data || {});
    const planId = sanitizeId(record.planId);
    const acceptedTerms = record.acceptedTerms === true;
    const rawIdempotency = sanitizeId(record.idempotencyKey);
    const idempotencyKey = rawIdempotency && rawIdempotency.length >= 4
        ? rawIdempotency.slice(0, 128)
        : makeId('idem').slice(0, 128);
    if (!planId || planId.length > 64) {
        throw new https_1.HttpsError('invalid-argument', 'A valid investment plan ID is required.');
    }
    if (!acceptedTerms) {
        throw new https_1.HttpsError('invalid-argument', 'You must accept the Plan Terms and Conditions before submitting an investment request.');
    }
    return {
        planId,
        idempotencyKey,
        expectedPlanPriceInr: record.expectedPlanPriceInr,
        expectedCoinCost: record.expectedCoinCost,
        paymentTxId: sanitizeId(record.paymentTxId),
        depositId: sanitizeId(record.depositId),
    };
}
async function createOrReusePendingRequestTx(params) {
    const { uid, planId, idempotencyKey, expectedPlanPriceInr, expectedCoinCost } = params;
    const requestId = makeId('invreq');
    const reqLockId = (0, investmentRequestValidation_1.buildDeterministicLockId)('req', uid, idempotencyKey);
    const activityLogId = makeId('ulog');
    const userRef = db.collection('users').doc(uid);
    const planRef = db.collection('productPlans').doc(planId);
    const lockRef = db.collection('investmentRequestLocks').doc(reqLockId);
    const invReqRef = db.collection('investmentRequests').doc(requestId);
    const activityRef = db.collection('userActivityLogs').doc(activityLogId);
    return db.runTransaction(async (tx) => {
        const [userSnap, livePlanSnap, lockSnap] = await Promise.all([
            tx.get(userRef),
            tx.get(planRef),
            tx.get(lockRef),
        ]);
        if (lockSnap.exists) {
            const existingId = String(lockSnap.data()?.requestId || '');
            if (existingId) {
                const lockedReqSnap = await tx.get(db.collection('investmentRequests').doc(existingId));
                if (lockedReqSnap.exists) {
                    const data = lockedReqSnap.data();
                    const createdIso = data.createdAt?.toDate
                        ? data.createdAt.toDate().toISOString()
                        : new Date().toISOString();
                    const updatedIso = data.updatedAt?.toDate
                        ? data.updatedAt.toDate().toISOString()
                        : createdIso;
                    return {
                        requestId: existingId,
                        investmentRequest: {
                            ...data,
                            createdAt: createdIso,
                            updatedAt: updatedIso,
                        },
                        deduplicated: true,
                    };
                }
            }
            throw new https_1.HttpsError('already-exists', 'Duplicate investment request blocked by idempotency lock.');
        }
        if (!userSnap.exists) {
            throw new https_1.HttpsError('failed-precondition', 'Verified member profile not found.');
        }
        const userData = userSnap.data();
        const userId = String(userData.userId || '');
        if (userData.status !== 'ACTIVE' || !/^NX[0-9]{6,10}$/.test(userId)) {
            throw new https_1.HttpsError('permission-denied', 'Only active member accounts with a verified NX User ID can submit investment requests.');
        }
        const planResolution = (0, investmentRequestValidation_1.resolveAuthoritativePlanSpec)(planId, livePlanSnap.exists ? livePlanSnap.data() : null);
        if (!planResolution.ok) {
            throw new https_1.HttpsError(planResolution.code, planResolution.message);
        }
        const authoritativePlan = planResolution.plan;
        const amountCheck = (0, investmentRequestValidation_1.validatePlanAmountsMatch)({
            plan: authoritativePlan,
            expectedPlanPriceInr,
            expectedCoinCost,
        });
        if (!amountCheck.ok) {
            throw new https_1.HttpsError('invalid-argument', amountCheck.message);
        }
        const pendingDoc = (0, investmentRequestValidation_1.buildPendingInvestmentRequestDoc)({
            requestId,
            uid,
            userId,
            plan: authoritativePlan,
            idempotencyKey,
        });
        const nowIso = new Date().toISOString();
        tx.set(invReqRef, {
            ...pendingDoc,
            createdAt: firestore_1.FieldValue.serverTimestamp(),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        });
        tx.set(lockRef, {
            lockId: reqLockId,
            uid,
            userId,
            requestId,
            planId: authoritativePlan.planId,
            idempotencyKey,
            createdAt: firestore_1.FieldValue.serverTimestamp(),
        });
        tx.set(activityRef, {
            logId: activityLogId,
            uid,
            category: 'PLAN_CHANGE',
            action: 'PLAN_INVESTMENT_REQUESTED',
            details: `Created investment request ${requestId} for ${authoritativePlan.productName} (${authoritativePlan.coinCost} Coins) [PENDING_VERIFICATION]`.slice(0, 300),
            createdAt: firestore_1.FieldValue.serverTimestamp(),
        });
        return {
            requestId,
            investmentRequest: {
                ...pendingDoc,
                createdAt: nowIso,
                updatedAt: nowIso,
            },
            deduplicated: false,
        };
    });
}
async function executePlanActivationTransaction(params) {
    const { uid, planId, requestId, idempotencyKey, paymentTxId, depositId, expectedPlanPriceInr, expectedCoinCost, } = params;
    const lockId = (0, investmentRequestValidation_1.buildDeterministicLockId)('inv', uid, idempotencyKey);
    const userPlanId = makeId('uplan');
    const coinTxId = `ptx_${userPlanId}`;
    const activityLogId = makeId('ulog');
    const userRef = db.collection('users').doc(uid);
    const walletRef = db.collection('coinWallets').doc(uid);
    const planRef = db.collection('productPlans').doc(planId);
    const invReqRef = db.collection('investmentRequests').doc(requestId);
    const lockRef = db.collection('investmentLocks').doc(lockId);
    const userPlanRef = db.collection('userPlans').doc(userPlanId);
    const coinTxRef = db.collection('coinTransactions').doc(coinTxId);
    const activityRef = db.collection('userActivityLogs').doc(activityLogId);
    const payTxRef = paymentTxId ? db.collection('paymentTransactions').doc(paymentTxId) : null;
    const depositRef = depositId ? db.collection('depositRequests').doc(depositId) : null;
    let outcomeError = null;
    const txResult = await db.runTransaction(async (tx) => {
        const [userSnap, walletSnap, livePlanSnap, invReqSnap, lockSnap, payTxSnap, depositSnap,] = await Promise.all([
            tx.get(userRef),
            tx.get(walletRef),
            tx.get(planRef),
            tx.get(invReqRef),
            tx.get(lockRef),
            payTxRef ? tx.get(payTxRef) : Promise.resolve(null),
            depositRef ? tx.get(depositRef) : Promise.resolve(null),
        ]);
        if (!userSnap.exists) {
            throw new https_1.HttpsError('failed-precondition', 'Verified member profile not found.');
        }
        const userData = userSnap.data();
        const userId = String(userData.userId || '');
        if (userData.status !== 'ACTIVE' || !/^NX[0-9]{6,10}$/.test(userId)) {
            throw new https_1.HttpsError('permission-denied', 'Only active member accounts with a verified NX User ID can activate plans.');
        }
        // Duplicate protection via deterministic investmentLocks doc
        if (lockSnap.exists) {
            const locked = lockSnap.data();
            const existingPlanSnap = locked.userPlanId
                ? await tx.get(db.collection('userPlans').doc(String(locked.userPlanId)))
                : null;
            if (existingPlanSnap?.exists) {
                const pd = existingPlanSnap.data();
                return {
                    userPlan: {
                        ...pd,
                        createdAt: pd.createdAt?.toDate
                            ? pd.createdAt.toDate().toISOString()
                            : new Date().toISOString(),
                    },
                    coinTransactionId: String(locked.coinTransactionId || ''),
                    newAvailableCoins: Number(walletSnap.data()?.availableCoins || 0),
                    requestId: String(locked.requestId || requestId),
                    status: 'ACTIVATED',
                    deduplicated: true,
                };
            }
            throw new https_1.HttpsError('already-exists', 'Duplicate investment transaction blocked by idempotency lock.');
        }
        if (invReqSnap.exists) {
            const reqData = invReqSnap.data();
            if (reqData.uid !== uid) {
                throw new https_1.HttpsError('permission-denied', 'Investment request ownership mismatch.');
            }
            if (reqData.planId && String(reqData.planId) !== planId) {
                throw new https_1.HttpsError('invalid-argument', 'Investment request plan mismatch.');
            }
            if (reqData.status === 'ACTIVATED') {
                throw new https_1.HttpsError('already-exists', 'This investment request is already activated.');
            }
            if (reqData.status === 'REJECTED' || reqData.status === 'FAILED') {
                throw new https_1.HttpsError('failed-precondition', `Investment request ${requestId} is in terminal status ${String(reqData.status)} and cannot be processed.`);
            }
        }
        // Optional explicit payment proof verification when caller passes a paymentTxId or depositId
        if (payTxSnap) {
            if (!payTxSnap.exists ||
                payTxSnap.data()?.uid !== uid ||
                payTxSnap.data()?.status !== 'CREDITED') {
                throw new https_1.HttpsError('failed-precondition', 'Payment transaction has not been verified and credited on the backend.');
            }
        }
        if (depositSnap) {
            if (!depositSnap.exists ||
                depositSnap.data()?.uid !== uid ||
                depositSnap.data()?.status !== 'APPROVED') {
                throw new https_1.HttpsError('failed-precondition', 'Deposit order has not been approved by payment verification yet.');
            }
        }
        // Resolve authoritative plan terms strictly on the server
        const planResolution = (0, investmentRequestValidation_1.resolveAuthoritativePlanSpec)(planId, livePlanSnap.exists ? livePlanSnap.data() : null);
        if (!planResolution.ok) {
            throw new https_1.HttpsError(planResolution.code, planResolution.message);
        }
        const planSpec = planResolution.plan;
        const amountCheck = (0, investmentRequestValidation_1.validatePlanAmountsMatch)({
            plan: planSpec,
            expectedPlanPriceInr,
            expectedCoinCost,
        });
        if (!amountCheck.ok) {
            throw new https_1.HttpsError('invalid-argument', amountCheck.message);
        }
        if (!walletSnap.exists) {
            throw new https_1.HttpsError('failed-precondition', 'Your wallet record is still initializing.');
        }
        const walletData = walletSnap.data();
        const prevAvailable = Math.max(0, Math.round(Number(walletData.availableCoins || 0)));
        const prevUsed = Math.max(0, Math.round(Number(walletData.coinsUsedForPlans || 0)));
        if (prevAvailable < planSpec.coinCost) {
            const shortfall = planSpec.coinCost - prevAvailable;
            const failReason = `Insufficient verified coin balance. Need ${shortfall} more Coins via verified UPI deposit.`;
            if (invReqSnap.exists) {
                tx.update(invReqRef, {
                    status: 'FAILED',
                    paymentStatus: 'INSUFFICIENT_BALANCE',
                    failureReason: failReason.slice(0, 300),
                    updatedAt: firestore_1.FieldValue.serverTimestamp(),
                });
            }
            else {
                tx.set(invReqRef, {
                    ...(0, investmentRequestValidation_1.buildPendingInvestmentRequestDoc)({
                        requestId,
                        uid,
                        userId,
                        plan: planSpec,
                        idempotencyKey,
                    }),
                    status: 'FAILED',
                    paymentStatus: 'INSUFFICIENT_BALANCE',
                    failureReason: failReason.slice(0, 300),
                    createdAt: firestore_1.FieldValue.serverTimestamp(),
                    updatedAt: firestore_1.FieldValue.serverTimestamp(),
                });
            }
            outcomeError = new https_1.HttpsError('failed-precondition', failReason);
            return null;
        }
        const nextAvailable = prevAvailable - planSpec.coinCost;
        const nextUsed = prevUsed + planSpec.coinCost;
        const nowMs = Date.now();
        const startIso = new Date(nowMs).toISOString();
        const endIso = new Date(nowMs + planSpec.durationDays * 86400000).toISOString();
        const nextRewardIso = new Date(nowMs + 86400000).toISOString();
        tx.update(walletRef, {
            availableCoins: nextAvailable,
            coinsUsedForPlans: nextUsed,
            lastPlanRef: userPlanId,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        });
        const userPlanPayload = {
            userPlanId,
            uid,
            userId,
            planId: planSpec.planId,
            productName: planSpec.productName.slice(0, 120),
            imageUrl: planSpec.imageUrl.slice(0, 500),
            coinCost: planSpec.coinCost,
            durationDays: planSpec.durationDays,
            totalRewardEntitlement: planSpec.totalRewardEntitlement,
            collectedReward: 0,
            remainingReward: planSpec.totalRewardEntitlement,
            daysCompleted: 0,
            remainingDays: planSpec.durationDays,
            startDate: startIso,
            endDate: endIso,
            nextRewardEligibilityTime: nextRewardIso,
            status: 'ACTIVE',
            createdAt: firestore_1.FieldValue.serverTimestamp(),
        };
        tx.set(userPlanRef, userPlanPayload);
        tx.set(coinTxRef, {
            transactionId: coinTxId,
            uid,
            userId,
            type: 'PLAN_INVESTMENT',
            assetType: 'COINS',
            amount: -planSpec.coinCost,
            previousBalance: prevAvailable,
            newBalance: nextAvailable,
            referenceId: userPlanId,
            idempotencyKey,
            status: 'COMPLETED',
            description: `Activated ${planSpec.productName} (${planSpec.durationDays}d · ${planSpec.coinCost} Coins)`.slice(0, 300),
            createdAt: firestore_1.FieldValue.serverTimestamp(),
        });
        tx.set(lockRef, {
            lockId,
            uid,
            userId,
            requestId,
            userPlanId,
            coinTransactionId: coinTxId,
            idempotencyKey,
            createdAt: firestore_1.FieldValue.serverTimestamp(),
        });
        if (invReqSnap.exists) {
            tx.update(invReqRef, {
                status: 'ACTIVATED',
                paymentStatus: 'VERIFIED',
                activatedUserPlanId: userPlanId,
                coinTransactionId: coinTxId,
                verifiedByUid: uid,
                activatedAt: firestore_1.FieldValue.serverTimestamp(),
                updatedAt: firestore_1.FieldValue.serverTimestamp(),
            });
        }
        else {
            tx.set(invReqRef, {
                requestId,
                uid,
                userId,
                planId: planSpec.planId,
                productName: planSpec.productName.slice(0, 120),
                planPriceInr: planSpec.planPriceInr,
                coinCost: planSpec.coinCost,
                durationDays: planSpec.durationDays,
                totalRewardEntitlement: planSpec.totalRewardEntitlement,
                acceptedTerms: true,
                idempotencyKey,
                status: 'ACTIVATED',
                paymentStatus: 'VERIFIED',
                activatedUserPlanId: userPlanId,
                coinTransactionId: coinTxId,
                verifiedByUid: uid,
                createdAt: firestore_1.FieldValue.serverTimestamp(),
                updatedAt: firestore_1.FieldValue.serverTimestamp(),
                activatedAt: firestore_1.FieldValue.serverTimestamp(),
            });
        }
        tx.set(activityRef, {
            logId: activityLogId,
            uid,
            category: 'PLAN_CHANGE',
            action: 'PLAN_ACTIVATED',
            details: `Backend verified & activated ${planSpec.productName} (${planSpec.planId}) for ${planSpec.coinCost} Coins -> ref ${userPlanId}`.slice(0, 300),
            createdAt: firestore_1.FieldValue.serverTimestamp(),
        });
        return {
            userPlan: {
                ...userPlanPayload,
                createdAt: startIso,
            },
            coinTransactionId: coinTxId,
            newAvailableCoins: nextAvailable,
            requestId,
            status: 'ACTIVATED',
            deduplicated: false,
        };
    });
    if (outcomeError) {
        throw outcomeError;
    }
    return txResult;
}
/**
 * Unified server-governed investment request validation & processing endpoint.
 * Rejects any client-supplied financial/status overrides, creates/reuses an idempotent
 * server-controlled PENDING_VERIFICATION request, verifies active NX account & wallet
 * balance, atomically debits coins, activates userPlans, transitions investmentRequests
 * to ACTIVATED (triggering email notification), and returns the authoritative record.
 */
exports.processInvestmentRequest = (0, https_1.onCall)(async (request) => {
    const uid = assertAuthenticatedMember(request);
    const input = assertValidCallableInvestmentInput(request.data);
    const existingRequestId = sanitizeId(request.data?.requestId);
    let requestId = existingRequestId;
    if (requestId) {
        const existingSnap = await db.collection('investmentRequests').doc(requestId).get();
        if (!existingSnap.exists) {
            throw new https_1.HttpsError('not-found', 'Referenced investment request was not found.');
        }
        if (existingSnap.data()?.uid !== uid) {
            throw new https_1.HttpsError('permission-denied', 'Investment request ownership mismatch.');
        }
    }
    else {
        const created = await createOrReusePendingRequestTx({
            uid,
            planId: input.planId,
            idempotencyKey: input.idempotencyKey,
            expectedPlanPriceInr: input.expectedPlanPriceInr,
            expectedCoinCost: input.expectedCoinCost,
        });
        requestId = created.requestId;
    }
    return executePlanActivationTransaction({
        uid,
        planId: input.planId,
        requestId,
        idempotencyKey: input.idempotencyKey,
        paymentTxId: input.paymentTxId,
        depositId: input.depositId,
        expectedPlanPriceInr: input.expectedPlanPriceInr,
        expectedCoinCost: input.expectedCoinCost,
    });
});
/**
 * Server-governed investment request creation.
 * Rejects tampered financial fields, verifies Firebase Auth UID and active NX member profile,
 * resolves authoritative plan specs & pricing, enforces idempotency locks, and creates
 * `investmentRequests/{requestId}` strictly in PENDING_VERIFICATION / PENDING.
 */
exports.createInvestmentRequest = (0, https_1.onCall)(async (request) => {
    const uid = assertAuthenticatedMember(request);
    const input = assertValidCallableInvestmentInput(request.data);
    return createOrReusePendingRequestTx({
        uid,
        planId: input.planId,
        idempotencyKey: input.idempotencyKey,
        expectedPlanPriceInr: input.expectedPlanPriceInr,
        expectedCoinCost: input.expectedCoinCost,
    });
});
/**
 * Backend-verified plan investment activation.
 * Verifies user authentication, active account status, authoritative plan terms,
 * atomic idempotency lock (preventing duplicate investments), and sufficient verified
 * coin balance before debiting coinWallets and activating userPlans.
 */
exports.investInPlan = (0, https_1.onCall)(async (request) => {
    const uid = assertAuthenticatedMember(request);
    const input = assertValidCallableInvestmentInput(request.data);
    const requestId = sanitizeId(request.data?.requestId) || makeId('invreq');
    return executePlanActivationTransaction({
        uid,
        planId: input.planId,
        requestId,
        idempotencyKey: input.idempotencyKey,
        paymentTxId: input.paymentTxId,
        depositId: input.depositId,
        expectedPlanPriceInr: input.expectedPlanPriceInr,
        expectedCoinCost: input.expectedCoinCost,
    });
});
/**
 * Backend-governed member withdrawal request with atomic INR wallet deduction,
 * payoutsEnabled check, verified payout destination ownership check, and idempotency lock.
 */
exports.submitWalletWithdrawalFn = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Authentication is required.');
    }
    const uid = request.auth.uid;
    const amountInr = Math.round(Number(request.data?.amountInr || 0));
    const payoutMethodId = sanitizeId(request.data?.payoutMethodId);
    const idempotencyKey = sanitizeId(request.data?.idempotencyKey) || `${uid}_${Date.now()}`;
    if (!payoutMethodId) {
        throw new https_1.HttpsError('invalid-argument', 'Valid verified payout method ID is required.');
    }
    if (!Number.isFinite(amountInr) || amountInr < 100 || amountInr > 500000) {
        throw new https_1.HttpsError('invalid-argument', 'Withdrawal amount must be a whole INR amount between ₹100 and ₹5,00,000.');
    }
    const withdrawalId = makeId('wd');
    const coinTxId = `wtx_${withdrawalId}`;
    const lockId = sanitizeId(`wd_${uid}_${idempotencyKey}`).slice(0, 128);
    const activityLogId = makeId('ulog');
    const userRef = db.collection('users').doc(uid);
    const walletRef = db.collection('coinWallets').doc(uid);
    const settingsRef = db.collection('platformSettings').doc('global');
    const methodRef = db.collection('userPayoutMethods').doc(payoutMethodId);
    const lockRef = db.collection('withdrawalLocks').doc(lockId);
    const withdrawalRef = db.collection('withdrawalRequests').doc(withdrawalId);
    const txRef = db.collection('coinTransactions').doc(coinTxId);
    const activityRef = db.collection('userActivityLogs').doc(activityLogId);
    return db.runTransaction(async (tx) => {
        const [userSnap, walletSnap, settingsSnap, methodSnap, lockSnap] = await Promise.all([
            tx.get(userRef),
            tx.get(walletRef),
            tx.get(settingsRef),
            tx.get(methodRef),
            tx.get(lockRef),
        ]);
        if (lockSnap.exists) {
            throw new https_1.HttpsError('already-exists', 'Duplicate withdrawal request blocked by idempotency lock.');
        }
        if (!userSnap.exists || userSnap.data()?.status !== 'ACTIVE') {
            throw new https_1.HttpsError('permission-denied', 'Only active member accounts can initiate withdrawals.');
        }
        const userId = String(userSnap.data()?.userId || '');
        if (!/^NX[0-9]{6,10}$/.test(userId)) {
            throw new https_1.HttpsError('failed-precondition', 'Verified NEXORA User ID is required.');
        }
        if (!settingsSnap.exists || settingsSnap.data()?.payoutsEnabled !== true) {
            throw new https_1.HttpsError('failed-precondition', 'Real-money withdrawals are currently disabled pending regulatory and payment channel activation.');
        }
        if (!methodSnap.exists || methodSnap.data()?.uid !== uid) {
            throw new https_1.HttpsError('not-found', 'Selected payout destination was not found.');
        }
        const methodData = methodSnap.data();
        if (methodData.verificationStatus !== 'VERIFIED') {
            throw new https_1.HttpsError('failed-precondition', 'Selected payout method must pass ownership verification before withdrawals are enabled.');
        }
        if (!walletSnap.exists) {
            throw new https_1.HttpsError('failed-precondition', 'Your wallet record is still initializing.');
        }
        const prevEligibleInr = Math.max(0, Math.round(Number(walletSnap.data()?.withdrawableBalanceInr || 0)));
        if (amountInr > prevEligibleInr) {
            throw new https_1.HttpsError('failed-precondition', `Requested ₹${amountInr.toLocaleString('en-IN')} exceeds your eligible INR balance (₹${prevEligibleInr.toLocaleString('en-IN')}).`);
        }
        const methodType = methodData.methodType === 'BANK_ACCOUNT' ? 'BANK_ACCOUNT' : 'UPI';
        const label = String(methodData.label || 'Payout').slice(0, 60);
        const destinationMasked = methodType === 'UPI'
            ? `${String(methodData.upiProvider || 'UPI')} · ${maskUpi(String(methodData.upiId || ''))}`
            : `${String(methodData.bankName || 'Bank')} · ${String(methodData.accountNumberMasked || `•••• ${String(methodData.accountLast4 || '')}`)} (${String(methodData.ifscCode || '')})`;
        const nextEligibleInr = prevEligibleInr - amountInr;
        tx.update(walletRef, {
            withdrawableBalanceInr: nextEligibleInr,
            lastWithdrawalRef: withdrawalId,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        });
        tx.set(withdrawalRef, {
            withdrawalId,
            uid,
            userId,
            amountInr,
            payoutMethodId,
            payoutMethodType: methodType,
            payoutLabel: label,
            payoutDestinationMasked: destinationMasked.slice(0, 120),
            idempotencyKey,
            status: 'PENDING',
            remarks: `Submitted to verified ${methodType === 'UPI' ? 'UPI' : 'Bank Account'} (${label})`.slice(0, 300),
            createdAt: firestore_1.FieldValue.serverTimestamp(),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        });
        tx.set(txRef, {
            transactionId: coinTxId,
            uid,
            userId,
            type: 'WITHDRAWAL_REQUEST',
            assetType: 'INR',
            amount: -amountInr,
            previousBalance: prevEligibleInr,
            newBalance: nextEligibleInr,
            referenceId: withdrawalId,
            idempotencyKey,
            status: 'PENDING',
            description: `INR Withdrawal ₹${amountInr.toLocaleString('en-IN')} to ${destinationMasked}`.slice(0, 300),
            createdAt: firestore_1.FieldValue.serverTimestamp(),
        });
        tx.set(lockRef, {
            lockId,
            uid,
            withdrawalId,
            amountInr,
            createdAt: firestore_1.FieldValue.serverTimestamp(),
        });
        tx.set(activityRef, {
            logId: activityLogId,
            uid,
            category: 'WALLET',
            action: 'INR_WITHDRAWAL_REQUESTED',
            details: `Requested ₹${amountInr.toLocaleString('en-IN')} withdrawal (${withdrawalId}) to ${destinationMasked}`.slice(0, 300),
            createdAt: firestore_1.FieldValue.serverTimestamp(),
        });
        return { withdrawalId, amountInr };
    });
});
/**
 * Admin callable to approve or reject a deposit request with backend atomic
 * paymentCreditLocks enforcement and coinWallets crediting.
 */
exports.adminVerifyDepositAndCredit = (0, https_1.onCall)(async (request) => {
    const actor = await assertAdminCaller(request);
    const depositId = sanitizeId(request.data?.depositId);
    const decision = String(request.data?.decision || '').toUpperCase();
    const rejectionReason = String(request.data?.rejectionReason || '').trim().slice(0, 300);
    if (!depositId || (decision !== 'APPROVED' && decision !== 'REJECTED')) {
        throw new https_1.HttpsError('invalid-argument', 'depositId and decision (APPROVED or REJECTED) are required.');
    }
    const paymentTxId = `ptx_${depositId}`;
    const creditLockId = `lock_dep_${depositId}`;
    const coinTxId = `ctx_dep_${depositId}`;
    const idempotencyKey = `dep_${depositId}`;
    const depositRef = db.collection('depositRequests').doc(depositId);
    const payTxRef = db.collection('paymentTransactions').doc(paymentTxId);
    const depLockRef = db.collection('paymentCreditLocks').doc(creditLockId);
    const summaryInfo = await db.runTransaction(async (tx) => {
        const depSnap = await tx.get(depositRef);
        if (!depSnap.exists) {
            throw new https_1.HttpsError('not-found', 'Deposit request not found.');
        }
        const depData = depSnap.data();
        const currentStatus = String(depData.status || '');
        if (currentStatus === 'APPROVED' || currentStatus === 'REJECTED') {
            throw new https_1.HttpsError('failed-precondition', `Deposit already finalized (${currentStatus}).`);
        }
        const targetUid = String(depData.uid || '');
        const targetUserId = String(depData.userId || '');
        const cleanUtr = String(depData.utrNumber || '')
            .trim()
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, '');
        const utrLockId = cleanUtr ? `lock_utr_${cleanUtr}` : '';
        const utrLockRef = utrLockId ? db.collection('paymentCreditLocks').doc(utrLockId) : null;
        const walletRef = db.collection('coinWallets').doc(targetUid);
        const txRef = db.collection('coinTransactions').doc(coinTxId);
        const [payTxSnap, depLockSnap, utrLockSnap, coinTxSnap, walletSnap] = await Promise.all([
            tx.get(payTxRef),
            tx.get(depLockRef),
            utrLockRef ? tx.get(utrLockRef) : Promise.resolve(null),
            tx.get(txRef),
            decision === 'APPROVED' ? tx.get(walletRef) : Promise.resolve(null),
        ]);
        if (decision === 'APPROVED') {
            if (depLockSnap.exists ||
                utrLockSnap?.exists ||
                coinTxSnap.exists ||
                (payTxSnap.exists && payTxSnap.data()?.status === 'CREDITED')) {
                throw new https_1.HttpsError('already-exists', 'Duplicate coin credit blocked: an immutable credit lock already exists for this deposit or UTR reference.');
            }
            if (!walletSnap?.exists) {
                throw new https_1.HttpsError('failed-precondition', 'Member coin wallet does not exist yet.');
            }
        }
        const verifiedAmountInr = Math.max(0, Math.round(Number(depData.amountInr || 0)));
        const baseCoins = verifiedAmountInr;
        const rawBonus = depData.packageId &&
            typeof depData.bonusCoins === 'number' &&
            Number.isInteger(depData.bonusCoins) &&
            depData.bonusCoins >= 0 &&
            depData.bonusCoins <= verifiedAmountInr
            ? depData.bonusCoins
            : 0;
        const coins = baseCoins + rawBonus;
        tx.update(depositRef, {
            status: decision,
            rejectionReason: decision === 'REJECTED' ? rejectionReason || 'Rejected by administrator' : '',
            verifiedAt: firestore_1.FieldValue.serverTimestamp(),
            verifiedByAdminUid: actor.uid,
        });
        if (decision === 'APPROVED' && walletSnap?.exists) {
            const prev = Number(walletSnap.data()?.availableCoins || 0);
            const purchasedPrev = Number(walletSnap.data()?.purchasedCoins || 0);
            const earnedPrev = Number(walletSnap.data()?.earnedCoins || 0);
            const next = prev + coins;
            tx.update(walletRef, {
                availableCoins: next,
                purchasedCoins: purchasedPrev + baseCoins,
                earnedCoins: earnedPrev + rawBonus,
                updatedAt: firestore_1.FieldValue.serverTimestamp(),
            });
            tx.set(txRef, {
                transactionId: coinTxId,
                uid: targetUid,
                userId: targetUserId,
                type: 'COIN_PURCHASE',
                amount: coins,
                previousBalance: prev,
                newBalance: next,
                referenceId: cleanUtr || depositId,
                idempotencyKey,
                status: 'COMPLETED',
                description: rawBonus > 0
                    ? `Approved INR ₹${verifiedAmountInr} UPI deposit (+${rawBonus} Package Bonus Coins)`
                    : `Approved INR ₹${verifiedAmountInr} UPI deposit`,
                createdAt: firestore_1.FieldValue.serverTimestamp(),
            });
            tx.set(depLockRef, {
                lockId: creditLockId,
                lockScope: 'DEPOSIT_ORDER',
                paymentTxId,
                depositId,
                uid: targetUid,
                userId: targetUserId,
                coinsCredited: coins,
                coinTransactionId: coinTxId,
                createdByUid: actor.uid,
                createdAt: firestore_1.FieldValue.serverTimestamp(),
            });
            if (utrLockRef && utrLockId) {
                tx.set(utrLockRef, {
                    lockId: utrLockId,
                    lockScope: 'UTR_REFERENCE',
                    paymentTxId,
                    depositId,
                    uid: targetUid,
                    userId: targetUserId,
                    coinsCredited: coins,
                    coinTransactionId: coinTxId,
                    createdByUid: actor.uid,
                    createdAt: firestore_1.FieldValue.serverTimestamp(),
                });
            }
            if (payTxSnap.exists) {
                const payStatus = payTxSnap.data()?.status;
                if (payStatus !== 'CREDITED' && payStatus !== 'REJECTED') {
                    tx.update(payTxRef, {
                        ...(utrLockId ? { utrLockId } : {}),
                        status: 'CREDITED',
                        coinTransactionId: coinTxId,
                        updatedAt: firestore_1.FieldValue.serverTimestamp(),
                        creditedAt: firestore_1.FieldValue.serverTimestamp(),
                    });
                }
            }
            else {
                tx.set(payTxRef, {
                    paymentTxId,
                    depositId,
                    uid: targetUid,
                    userId: targetUserId,
                    provider: 'UPI_GATEWAY',
                    ...(cleanUtr ? { utrReference: cleanUtr } : {}),
                    amountInr: verifiedAmountInr,
                    coinsToCredit: coins,
                    currency: 'INR',
                    idempotencyKey,
                    creditLockId,
                    ...(utrLockId ? { utrLockId } : {}),
                    verificationMethod: 'ADMIN_SETTLEMENT',
                    webhookVerificationStatus: 'NOT_RECEIVED',
                    status: 'CREDITED',
                    coinTransactionId: coinTxId,
                    createdAt: firestore_1.FieldValue.serverTimestamp(),
                    updatedAt: firestore_1.FieldValue.serverTimestamp(),
                    creditedAt: firestore_1.FieldValue.serverTimestamp(),
                });
            }
        }
        else if (decision === 'REJECTED') {
            const failReason = rejectionReason || 'Rejected by administrator';
            if (payTxSnap.exists) {
                const payStatus = payTxSnap.data()?.status;
                if (payStatus !== 'CREDITED' && payStatus !== 'REJECTED') {
                    tx.update(payTxRef, {
                        status: 'REJECTED',
                        failureReason: failReason,
                        updatedAt: firestore_1.FieldValue.serverTimestamp(),
                    });
                }
            }
            else {
                tx.set(payTxRef, {
                    paymentTxId,
                    depositId,
                    uid: targetUid,
                    userId: targetUserId,
                    provider: 'UPI_GATEWAY',
                    ...(cleanUtr ? { utrReference: cleanUtr } : {}),
                    amountInr: verifiedAmountInr,
                    coinsToCredit: coins,
                    currency: 'INR',
                    idempotencyKey,
                    creditLockId,
                    ...(utrLockId ? { utrLockId } : {}),
                    verificationMethod: 'ADMIN_SETTLEMENT',
                    webhookVerificationStatus: 'NOT_RECEIVED',
                    status: 'REJECTED',
                    failureReason: failReason,
                    createdAt: firestore_1.FieldValue.serverTimestamp(),
                    updatedAt: firestore_1.FieldValue.serverTimestamp(),
                });
            }
        }
        return { targetUserId, coins };
    });
    const logRef = db.collection('adminActivityLogs').doc();
    await logRef.set({
        logId: logRef.id,
        actorUid: actor.uid,
        actorEmail: actor.email || 'admin@nexorainvest.example',
        actorRole: actor.role,
        actionType: 'DEPOSIT_REVIEWED',
        targetId: depositId,
        summary: `${decision} deposit ${depositId} (${summaryInfo.targetUserId}, ${summaryInfo.coins} Coins)`,
        createdAt: firestore_1.FieldValue.serverTimestamp(),
    });
    return { ok: true, depositId, decision, coinsCredited: decision === 'APPROVED' ? summaryInfo.coins : 0 };
});
/**
 * Admin callable to transition withdrawal statuses and atomically refund
 * Eligible INR balance on REJECTED without modifying Coin balances.
 */
exports.adminReviewWithdrawalFn = (0, https_1.onCall)(async (request) => {
    const actor = await assertAdminCaller(request);
    const withdrawalId = sanitizeId(request.data?.withdrawalId);
    const nextStatus = String(request.data?.nextStatus || '').toUpperCase();
    const remarks = String(request.data?.remarks || '').trim().slice(0, 300);
    if (!withdrawalId ||
        !['PROCESSING', 'APPROVED', 'COMPLETED', 'PAID', 'REJECTED'].includes(nextStatus)) {
        throw new https_1.HttpsError('invalid-argument', 'Valid withdrawalId and nextStatus are required.');
    }
    const wdRef = db.collection('withdrawalRequests').doc(withdrawalId);
    const refundTxId = `wref_${withdrawalId}`;
    const txRef = db.collection('coinTransactions').doc(refundTxId);
    const summary = await db.runTransaction(async (tx) => {
        const wdSnap = await tx.get(wdRef);
        if (!wdSnap.exists) {
            throw new https_1.HttpsError('not-found', 'Withdrawal request not found.');
        }
        const wdData = wdSnap.data();
        const curr = String(wdData.status || '');
        if (curr === 'COMPLETED' || curr === 'PAID' || curr === 'REJECTED') {
            throw new https_1.HttpsError('failed-precondition', `Withdrawal already finalized (${curr}).`);
        }
        const targetUid = String(wdData.uid || '');
        const targetUserId = String(wdData.userId || '');
        const amountInr = Math.max(0, Math.round(Number(wdData.amountInr || 0)));
        const walletRef = db.collection('coinWallets').doc(targetUid);
        const [walletSnap, refundTxSnap] = await Promise.all([
            tx.get(walletRef),
            nextStatus === 'REJECTED' ? tx.get(txRef) : Promise.resolve(null),
        ]);
        const isCompletion = nextStatus === 'COMPLETED' || nextStatus === 'PAID';
        tx.update(wdRef, {
            status: nextStatus,
            remarks: (remarks || `Processed (${nextStatus}) by ${actor.email || actor.uid}`).slice(0, 300),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
            ...(isCompletion ? { paidAt: firestore_1.FieldValue.serverTimestamp() } : {}),
        });
        if (nextStatus === 'REJECTED' && walletSnap.exists && !refundTxSnap?.exists) {
            const prevInr = Number(walletSnap.data()?.withdrawableBalanceInr || 0);
            const nextInr = prevInr + amountInr;
            tx.update(walletRef, {
                withdrawableBalanceInr: nextInr,
                updatedAt: firestore_1.FieldValue.serverTimestamp(),
            });
            tx.set(txRef, {
                transactionId: refundTxId,
                uid: targetUid,
                userId: targetUserId,
                type: 'WITHDRAWAL_REFUND',
                assetType: 'INR',
                amount: amountInr,
                previousBalance: prevInr,
                newBalance: nextInr,
                referenceId: withdrawalId,
                idempotencyKey: `${withdrawalId}_refund`,
                status: 'COMPLETED',
                description: `Refunded rejected withdrawal ₹${amountInr.toLocaleString('en-IN')} to Eligible INR Balance`,
                createdAt: firestore_1.FieldValue.serverTimestamp(),
            });
        }
        return { targetUserId, amountInr };
    });
    const logRef = db.collection('adminActivityLogs').doc();
    await logRef.set({
        logId: logRef.id,
        actorUid: actor.uid,
        actorEmail: actor.email || 'admin@nexorainvest.example',
        actorRole: actor.role,
        actionType: 'WITHDRAWAL_REVIEWED',
        targetId: withdrawalId,
        summary: `Marked withdrawal ${withdrawalId} (${summary.targetUserId}, ₹${summary.amountInr}) as ${nextStatus}`,
        createdAt: firestore_1.FieldValue.serverTimestamp(),
    });
    return { ok: true, withdrawalId, nextStatus };
});
async function enqueueActivationEmailIfTransitioned(params) {
    if (!params.beforeData || !params.afterData) {
        return;
    }
    if (!(0, planActivationEmail_1.isPendingToActiveTransition)(params.beforeData.status, params.afterData.status)) {
        return;
    }
    const uid = String(params.afterData.uid || '').trim();
    if (!uid) {
        v2_1.logger.warn('Skipping activation email: missing uid on investment document.', {
            sourceCollection: params.sourceCollection,
            docId: params.docId,
        });
        return;
    }
    const userSnap = await db.collection('users').doc(uid).get();
    const userData = userSnap.exists ? userSnap.data() : undefined;
    let recipientEmail = (0, planActivationEmail_1.isValidEmailAddress)(userData?.email) ? userData.email.trim() : '';
    let fullName = typeof userData?.fullName === 'string' ? userData.fullName : '';
    const userId = String(userData?.userId || params.afterData.userId || '').trim();
    if (!recipientEmail) {
        try {
            const authRecord = await admin.auth().getUser(uid);
            if ((0, planActivationEmail_1.isValidEmailAddress)(authRecord.email)) {
                recipientEmail = authRecord.email.trim();
            }
            if (!fullName && authRecord.displayName) {
                fullName = authRecord.displayName;
            }
        }
        catch (authErr) {
            v2_1.logger.warn('Unable to look up Firebase Auth user for activation email.', {
                uid,
                error: String(authErr),
            });
        }
    }
    if (!(0, planActivationEmail_1.isValidEmailAddress)(recipientEmail)) {
        v2_1.logger.info('No verified email on profile; skipping Trigger Email notification.', {
            uid,
            sourceCollection: params.sourceCollection,
            docId: params.docId,
        });
        return;
    }
    const referenceId = String(params.afterData.activatedUserPlanId || params.afterData.userPlanId || params.docId).trim();
    const planId = String(params.afterData.planId || '').trim();
    const productName = String(params.afterData.productName || 'Structured Plan').trim();
    const mailDocId = (0, planActivationEmail_1.buildMailDocumentId)(params.afterData, params.docId);
    const emailDoc = (0, planActivationEmail_1.buildPlanActivationEmailPayload)({
        toEmail: recipientEmail,
        fullName,
        userId,
        productName,
        planId,
        referenceId,
        coinCost: Number(params.afterData.coinCost || 0),
        durationDays: Number(params.afterData.durationDays || 0),
        totalRewardEntitlement: Number(params.afterData.totalRewardEntitlement || 0),
        startDate: typeof params.afterData.startDate === 'string' ? params.afterData.startDate : undefined,
        endDate: typeof params.afterData.endDate === 'string' ? params.afterData.endDate : undefined,
    });
    try {
        await db
            .collection(MAIL_COLLECTION)
            .doc(mailDocId)
            .create({
            ...emailDoc,
            uid,
            userId,
            planId,
            referenceId,
            sourceCollection: params.sourceCollection,
            createdAt: firestore_1.FieldValue.serverTimestamp(),
        });
        v2_1.logger.info('Queued plan activation email for Firebase Trigger Email extension.', {
            uid,
            mailDocId,
            mailCollection: MAIL_COLLECTION,
            sourceCollection: params.sourceCollection,
            referenceId,
        });
    }
    catch (err) {
        const code = typeof err === 'object' && err !== null && 'code' in err
            ? err.code
            : undefined;
        // Firestore ALREADY_EXISTS (6): notification was already queued for this plan activation
        if (code === 6 || code === 'already-exists') {
            v2_1.logger.info('Activation email already queued; skipping duplicate delivery.', {
                mailDocId,
                referenceId,
            });
            return;
        }
        throw err;
    }
    const logId = makeId('ulog');
    await db
        .collection('userActivityLogs')
        .doc(logId)
        .set({
        logId,
        uid,
        category: 'PLAN_CHANGE',
        action: 'PLAN_ACTIVATION_EMAIL_QUEUED',
        details: `Queued activation notification email for ${productName} (${referenceId}) -> ${mailDocId}`.slice(0, 300),
        createdAt: firestore_1.FieldValue.serverTimestamp(),
    })
        .catch(() => undefined);
}
/**
 * Automated Firebase Extension ("Trigger Email from Firestore") dispatcher.
 * Fires whenever a `userPlans/{userPlanId}` document transitions from
 * 'pending' / 'PENDING' / 'PENDING_VERIFICATION' to 'active' / 'ACTIVE' / 'ACTIVATED'.
 */
exports.notifyUserOnUserPlanActivated = (0, firestore_2.onDocumentUpdated)({
    document: 'userPlans/{userPlanId}',
    database: DATABASE_ID,
}, async (event) => {
    if (!event.data)
        return;
    await enqueueActivationEmailIfTransitioned({
        sourceCollection: 'userPlans',
        docId: event.params.userPlanId,
        beforeData: event.data.before.data(),
        afterData: event.data.after.data(),
    });
});
/**
 * Automated Firebase Extension ("Trigger Email from Firestore") dispatcher.
 * Fires whenever an `investmentRequests/{requestId}` document transitions from
 * 'PENDING_VERIFICATION' / 'pending' to 'ACTIVATED' / 'active'.
 */
exports.notifyUserOnInvestmentRequestActivated = (0, firestore_2.onDocumentUpdated)({
    document: 'investmentRequests/{requestId}',
    database: DATABASE_ID,
}, async (event) => {
    if (!event.data)
        return;
    await enqueueActivationEmailIfTransitioned({
        sourceCollection: 'investmentRequests',
        docId: event.params.requestId,
        beforeData: event.data.before.data(),
        afterData: event.data.after.data(),
    });
});
//# sourceMappingURL=index.js.map