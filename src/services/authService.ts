import {
  ConfirmationResult,
  RecaptchaVerifier,
  User,
  createUserWithEmailAndPassword,
  deleteUser,
  linkWithPhoneNumber,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPhoneNumber,
  signOut,
  updateProfile,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { SUPER_ADMIN_EMAILS, SUPER_ADMIN_UID } from '../config/constants';
import { OperationType, auth, db, handleFirestoreError } from '../firebase/client';
import { UserProfile } from '../types/domain';
import { buildDefaultProfileInputs } from '../utils/profileDefaults';
import { normalizeIndianMobile } from '../utils/validators';
import {
  attributeReferralSignup,
  ensureReferralCodeRegistered,
  recordUserActivity,
} from './activityLogService';
import { recordAdminLoginAttempt } from './adminService';

export class AuthServiceError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'AuthServiceError';
    this.code = code;
  }
}

async function sha256Hex(raw: string): Promise<string> {
  const normalized = raw.trim().toLowerCase();
  const data = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function mapFirebaseError(error: unknown): string {
  if (error instanceof AuthServiceError) {
    return error.message;
  }

  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';

  switch (code) {
    case 'auth/email-already-in-use':
      return 'An account with this email address is already registered. Please sign in or reset your password.';
    case 'auth/invalid-email':
      return 'The email address format is invalid.';
    case 'auth/weak-password':
      return 'Password is too weak. Use at least 8 characters with uppercase letters and numbers.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Invalid credentials. Please verify your email/mobile and password.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Contact support for assistance.';
    case 'auth/too-many-requests':
      return 'Too many attempts detected. Please wait a few minutes before trying again.';
    case 'auth/operation-not-allowed':
      return 'This sign-in provider is not yet enabled in Firebase Console (Authentication -> Sign-in method).';
    case 'auth/unauthorized-domain':
      return 'This domain is not authorized in Firebase Authentication -> Settings -> Authorized domains.';
    case 'auth/invalid-phone-number':
      return 'Invalid mobile number format. Enter a valid 10-digit Indian mobile number.';
    case 'auth/invalid-verification-code':
      return 'The 6-digit OTP code is incorrect. Please check and try again.';
    case 'auth/code-expired':
      return 'The OTP verification code has expired. Request a new code.';
    case 'auth/credential-already-in-use':
    case 'auth/phone-number-already-exists':
      return 'This mobile number is already linked to another NEXORA INVEST account.';
    case 'auth/quota-exceeded':
      return 'SMS OTP quota exceeded for this Firebase project. Try again later or check Firebase Console billing.';
    case 'auth/captcha-check-failed':
    case 'auth/missing-recaptcha-token':
    case 'auth/invalid-recaptcha-token':
      return 'Security verification failed or expired. Please tap Send OTP again.';
    case 'auth/app-not-authorized':
      return 'This application domain is not authorized for Phone Authentication in Firebase Console.';
    case 'auth/missing-phone-number':
      return 'Please enter your 10-digit mobile number before requesting an OTP.';
    case 'auth/network-request-failed':
      return 'Network error while contacting Firebase. Check your connection and try again.';
    default:
      if (error instanceof Error) {
        if (error.message.includes('already been rendered')) {
          return 'Verification widget reset required. Please tap Send OTP again.';
        }
        if (error.message.includes('DUPLICATE_EMAIL')) {
          return 'This email address is already registered with another account.';
        }
        if (error.message.includes('DUPLICATE_MOBILE')) {
          return 'This mobile number is already registered with another account.';
        }
        if (error.message.includes('PERMISSION_DENIED') || error.message.includes('Missing or insufficient permissions')) {
          return 'Security rules rejected the operation. Verify Firestore rules deployment and account permissions.';
        }
        return error.message;
      }
      return 'Authentication failed. Please try again.';
  }
}

interface ProvisionParams {
  user: User;
  fullName: string;
  email: string;
  mobile: string;
  authProvider: 'password' | 'phone' | 'password+phone';
  referralCode?: string;
}

function mapFirestoreProfileData(
  user: User,
  data: Record<string, unknown>
): UserProfile {
  const createdAtRaw = data.createdAt as { toDate?: () => Date } | string | undefined;
  const updatedAtRaw = data.updatedAt as { toDate?: () => Date } | string | undefined;

  return {
    uid: String(data.uid || user.uid),
    userId: String(data.userId || ''),
    role: (data.role as UserProfile['role']) || 'USER',
    fullName: String(data.fullName || user.displayName || 'NEXORA Member'),
    email: String(data.email || user.email || ''),
    mobile: String(data.mobile || user.phoneNumber || ''),
    emailVerified: Boolean(user.emailVerified || data.emailVerified),
    mobileVerified: Boolean(user.phoneNumber || data.mobileVerified),
    authProvider: (data.authProvider as UserProfile['authProvider']) || 'password',
    status: (data.status as UserProfile['status']) || 'ACTIVE',
    avatarUrl:
      typeof data.avatarUrl === 'string' && data.avatarUrl ? data.avatarUrl : undefined,
    suspensionReason: data.suspensionReason ? String(data.suspensionReason) : undefined,
    createdAt:
      typeof createdAtRaw === 'object' && createdAtRaw?.toDate
        ? createdAtRaw.toDate().toISOString()
        : typeof createdAtRaw === 'string'
        ? createdAtRaw
        : new Date().toISOString(),
    updatedAt:
      typeof updatedAtRaw === 'object' && updatedAtRaw?.toDate
        ? updatedAtRaw.toDate().toISOString()
        : typeof updatedAtRaw === 'string'
        ? updatedAtRaw
        : new Date().toISOString(),
  };
}

/**
 * Atomically reserves unique email/mobile identity locks, advances the
 * monotonic NX User ID counter, creates the UserProfile (without any password),
 * and initializes a zero-balance CoinWallet in Firestore.
 */
async function provisionUserProfileTransaction({
  user,
  fullName,
  email,
  mobile,
  authProvider,
  referralCode,
}: ProvisionParams): Promise<UserProfile> {
  const cleanEmail = email.trim().toLowerCase().slice(0, 160);
  const rawMobile = mobile.trim();
  const cleanMobile = rawMobile
    ? rawMobile.startsWith('+') && /^\+[0-9]{8,15}$/.test(rawMobile)
      ? rawMobile.slice(0, 20)
      : normalizeIndianMobile(rawMobile).slice(0, 20)
    : '';

  const emailLockId = cleanEmail ? `email_${await sha256Hex(cleanEmail)}` : null;
  const mobileLockId = cleanMobile ? `mobile_${await sha256Hex(cleanMobile)}` : null;

  const userRef = doc(db, 'users', user.uid);
  const walletRef = doc(db, 'coinWallets', user.uid);
  const counterRef = doc(db, 'counters', 'userIds');
  const emailLockRef = emailLockId ? doc(db, 'identityLocks', emailLockId) : null;
  const mobileLockRef = mobileLockId ? doc(db, 'identityLocks', mobileLockId) : null;

  try {
    const createdProfile = await runTransaction(db, async (tx) => {
      // Phase 1: All Firestore reads must precede writes
      const existingUserSnap = await tx.get(userRef);
      if (existingUserSnap.exists()) {
        return mapFirestoreProfileData(
          user,
          existingUserSnap.data() as Record<string, unknown>
        );
      }

      const existingWalletSnap = await tx.get(walletRef);
      const counterSnap = await tx.get(counterRef);
      const emailLockSnap = emailLockRef ? await tx.get(emailLockRef) : null;
      const mobileLockSnap = mobileLockRef ? await tx.get(mobileLockRef) : null;

      if (
        emailLockSnap &&
        emailLockSnap.exists() &&
        emailLockSnap.data()?.uid !== user.uid
      ) {
        throw new AuthServiceError(
          'DUPLICATE_EMAIL',
          'This email address is already registered with another account.'
        );
      }

      if (
        mobileLockSnap &&
        mobileLockSnap.exists() &&
        mobileLockSnap.data()?.uid !== user.uid
      ) {
        throw new AuthServiceError(
          'DUPLICATE_MOBILE',
          'This mobile number is already registered with another account.'
        );
      }

      const nextNumber: number = counterSnap.exists()
        ? Number(counterSnap.data().nextNumber)
        : 100001;
      const assignedUserId = `NX${nextNumber}`;

      // Phase 2: Atomic writes
      if (counterSnap.exists()) {
        tx.update(counterRef, {
          nextNumber: nextNumber + 1,
          updatedAt: serverTimestamp(),
        });
      } else {
        tx.set(counterRef, {
          nextNumber: 100002,
          updatedAt: serverTimestamp(),
        });
      }

      const profilePayload = {
        uid: user.uid,
        userId: assignedUserId,
        role: 'USER' as const,
        fullName: fullName.trim().slice(0, 80),
        email: cleanEmail,
        mobile: cleanMobile,
        emailVerified: Boolean(user.emailVerified),
        mobileVerified: Boolean(user.phoneNumber),
        authProvider,
        status: 'ACTIVE' as const,
        ...(referralCode && /^NX[0-9]{6,10}$/.test(referralCode.trim().toUpperCase())
          ? { referredByCode: referralCode.trim().toUpperCase() }
          : {}),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      tx.set(userRef, profilePayload);

      if (!existingWalletSnap.exists()) {
        tx.set(walletRef, {
          uid: user.uid,
          userId: assignedUserId,
          availableCoins: 0,
          purchasedCoins: 0,
          earnedCoins: 0,
          coinsUsedForPlans: 0,
          pendingTransactionCoins: 0,
          withdrawableBalanceInr: 0,
          updatedAt: serverTimestamp(),
        });
      }

      if (emailLockRef && emailLockId && (!emailLockSnap || !emailLockSnap.exists())) {
        tx.set(emailLockRef, {
          type: 'EMAIL',
          valueHash: emailLockId.replace('email_', ''),
          uid: user.uid,
          createdAt: serverTimestamp(),
        });
      }

      if (mobileLockRef && mobileLockId && (!mobileLockSnap || !mobileLockSnap.exists())) {
        tx.set(mobileLockRef, {
          type: 'MOBILE',
          valueHash: mobileLockId.replace('mobile_', ''),
          uid: user.uid,
          createdAt: serverTimestamp(),
        });
      }

      return {
        ...profilePayload,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as UserProfile;
    });

    return createdProfile;
  } catch (err) {
    if (err instanceof AuthServiceError) {
      throw err;
    }
    handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}`);
  }
}

const pendingProfileInitializations = new Map<
  string,
  Promise<{ profile: UserProfile; created: boolean }>
>();

/**
 * Verifies the existence of `users/{uid}` for an authenticated, non-anonymous user.
 * If the Firestore profile document is missing, safely provisions a default 'USER'
 * profile (with uid, email, createdAt, permanent NX ID, and zeroed CoinWallet)
 * in compliance with Firestore security rules without creating duplicate Auth accounts
 * or granting client-side admin privileges.
 */
export async function ensureUserProfileOnLogin(
  user: User
): Promise<{ profile: UserProfile; created: boolean }> {
  if (!auth.currentUser || auth.currentUser.uid !== user.uid || user.isAnonymous) {
    throw new AuthServiceError(
      'UNAUTHENTICATED',
      'An active authenticated session is required to initialize your user profile.'
    );
  }

  const existingTask = pendingProfileInitializations.get(user.uid);
  if (existingTask) {
    return existingTask;
  }

  const task = (async (): Promise<{ profile: UserProfile; created: boolean }> => {
    const path = `users/${user.uid}`;
    let snap;
    try {
      snap = await getDoc(doc(db, 'users', user.uid));
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, path);
    }

    if (snap.exists()) {
      const data = snap.data() as Record<string, unknown>;
      if (data.status === 'SUSPENDED') {
        await signOut(auth);
        throw new AuthServiceError(
          'ACCOUNT_SUSPENDED',
          'Your account is suspended. Please contact NEXORA INVEST support.'
        );
      }

      if (user.emailVerified && !data.emailVerified) {
        await updateDoc(doc(db, 'users', user.uid), {
          emailVerified: true,
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      }

      return {
        profile: mapFirestoreProfileData(user, data),
        created: false,
      };
    }

    const defaults = buildDefaultProfileInputs({
      displayName: user.displayName,
      email: user.email,
      phoneNumber: user.phoneNumber,
    });

    const profile = await provisionUserProfileTransaction({
      user,
      fullName: defaults.fullName,
      email: defaults.email,
      mobile: defaults.mobile,
      authProvider: defaults.authProvider,
    });

    return {
      profile,
      created: true,
    };
  })();

  pendingProfileInitializations.set(user.uid, task);
  try {
    return await task;
  } finally {
    pendingProfileInitializations.delete(user.uid);
  }
}

export async function registerWithEmailPassword(params: {
  fullName: string;
  email: string;
  mobile: string;
  password: string;
  referralCode?: string;
}): Promise<{ profile: UserProfile; user: User }> {
  const credential = await createUserWithEmailAndPassword(
    auth,
    params.email.trim(),
    params.password
  );

  const user = credential.user;

  try {
    await updateProfile(user, { displayName: params.fullName.trim() });
    await sendEmailVerification(user).catch(() => {
      // Non-fatal if email verification rate-limited; profile creation still proceeds
    });

    const profile = await provisionUserProfileTransaction({
      user,
      fullName: params.fullName,
      email: params.email,
      mobile: params.mobile,
      authProvider: 'password',
      referralCode: params.referralCode,
    });

    await ensureReferralCodeRegistered(user.uid, profile.userId);
    if (params.referralCode) {
      await attributeReferralSignup({
        referralCode: params.referralCode,
        referredUid: user.uid,
        referredUserId: profile.userId,
      });
    }
    void recordUserActivity({
      uid: user.uid,
      category: 'SECURITY',
      action: 'Account Registered',
      details: `Member profile ${profile.userId} created via Email & Password`,
    });

    return { profile, user };
  } catch (err) {
    // Roll back orphan Firebase Auth account if Firestore provisioning or duplicate check fails
    try {
      await deleteUser(user);
    } catch {
      await signOut(auth).catch(() => {});
    }
    throw err;
  }
}

export async function sendPhoneOtp(
  mobile: string,
  verifier: RecaptchaVerifier
): Promise<ConfirmationResult> {
  const phoneE164 = normalizeIndianMobile(mobile);
  return signInWithPhoneNumber(auth, phoneE164, verifier);
}

export async function completePhoneOtpRegistration(params: {
  confirmationResult: ConfirmationResult;
  otpCode: string;
  fullName: string;
  email?: string;
  referralCode?: string;
}): Promise<{ profile: UserProfile; user: User; alreadyRegistered: boolean }> {
  const credential = await params.confirmationResult.confirm(params.otpCode.trim());
  const user = credential.user;
  const userDocPath = `users/${user.uid}`;

  try {
    const existingSnap = await getDoc(doc(db, 'users', user.uid));
    if (existingSnap.exists()) {
      const data = existingSnap.data() as Record<string, unknown>;
      return {
        user,
        alreadyRegistered: true,
        profile: mapFirestoreProfileData(user, data),
      };
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, userDocPath);
  }

  try {
    if (params.fullName.trim()) {
      await updateProfile(user, { displayName: params.fullName.trim() }).catch(() => {});
    }

    const profile = await provisionUserProfileTransaction({
      user,
      fullName: params.fullName,
      email: params.email || '',
      mobile: user.phoneNumber || '',
      authProvider: 'phone',
      referralCode: params.referralCode,
    });

    await ensureReferralCodeRegistered(user.uid, profile.userId);
    if (params.referralCode) {
      await attributeReferralSignup({
        referralCode: params.referralCode,
        referredUid: user.uid,
        referredUserId: profile.userId,
      });
    }
    void recordUserActivity({
      uid: user.uid,
      category: 'SECURITY',
      action: 'Account Registered',
      details: `Member profile ${profile.userId} created via Mobile OTP`,
    });

    return { profile, user, alreadyRegistered: false };
  } catch (err) {
    // If duplicate email lock failed on phone signup, delete newly created phone auth user if possible
    try {
      await deleteUser(user);
    } catch {
      await signOut(auth).catch(() => {});
    }
    throw err;
  }
}

export async function sendLinkPhoneOtp(
  user: User,
  mobile: string,
  verifier: RecaptchaVerifier
): Promise<ConfirmationResult> {
  const phoneE164 = normalizeIndianMobile(mobile);
  return linkWithPhoneNumber(user, phoneE164, verifier);
}

export async function confirmLinkPhoneOtp(
  user: User,
  confirmationResult: ConfirmationResult,
  otpCode: string
): Promise<void> {
  await confirmationResult.confirm(otpCode.trim());
  const path = `users/${user.uid}`;
  try {
    await updateDoc(doc(db, 'users', user.uid), {
      mobile: user.phoneNumber || '',
      mobileVerified: true,
      authProvider: 'password+phone',
      updatedAt: serverTimestamp(),
    });
    void recordUserActivity({
      uid: user.uid,
      category: 'PROFILE_UPDATE',
      action: 'Mobile Verified',
      details: `Linked and verified mobile number ${user.phoneNumber || ''}`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function loginWithEmailPassword(
  email: string,
  password: string
): Promise<{ user: User; profile: UserProfile; initialized: boolean }> {
  const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
  const user = credential.user;

  const { profile, created } = await ensureUserProfileOnLogin(user);
  void recordUserActivity({
    uid: user.uid,
    category: 'LOGIN',
    action: 'Email Sign-In',
    details: `Authenticated via Email & Password (${user.email || profile.userId})`,
  });
  return { user, profile, initialized: created };
}

export async function loginWithPhoneOtp(
  confirmationResult: ConfirmationResult,
  otpCode: string
): Promise<{ user: User; profile: UserProfile; initialized: boolean }> {
  const credential = await confirmationResult.confirm(otpCode.trim());
  const user = credential.user;

  const { profile, created } = await ensureUserProfileOnLogin(user);
  void recordUserActivity({
    uid: user.uid,
    category: 'LOGIN',
    action: 'Mobile OTP Sign-In',
    details: `Authenticated via Mobile OTP (${user.phoneNumber || profile.userId})`,
  });
  return { user, profile, initialized: created };
}

export async function loginAdminWithEmail(email: string, password: string): Promise<User> {
  const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
  const user = credential.user;

  try {
    const tokenResult = await user.getIdTokenResult();
    const adminSnap = await getDoc(doc(db, 'adminUsers', user.uid));
    const userSnap = await getDoc(doc(db, 'users', user.uid));

    const isSuperEmail =
      user.emailVerified &&
      Boolean(user.email) &&
      (SUPER_ADMIN_EMAILS as readonly string[]).includes(user.email!.toLowerCase());

    const isSuperClaim =
      tokenResult.claims.super_admin === true ||
      tokenResult.claims.role === 'SUPER_ADMIN';

    const isAdminClaim = tokenResult.claims.role === 'ADMIN' || tokenResult.claims.admin === true;

    const isSuperAdmin =
      user.uid === SUPER_ADMIN_UID ||
      isSuperEmail ||
      isSuperClaim ||
      (adminSnap.exists() && adminSnap.data().active === true && adminSnap.data().role === 'SUPER_ADMIN') ||
      (userSnap.exists() && userSnap.data().role === 'SUPER_ADMIN');

    const isAdminDoc = adminSnap.exists() && adminSnap.data().active === true;
    const isUserAdminRole =
      userSnap.exists() && (userSnap.data().role === 'ADMIN' || userSnap.data().role === 'SUPER_ADMIN');

    if (!isSuperAdmin && !isAdminDoc && !isUserAdminRole && !isAdminClaim) {
      await recordAdminLoginAttempt({
        uid: user.uid,
        email: user.email || email.trim(),
        role: 'USER',
        outcome: 'DENIED_NOT_ADMIN',
      });
      await signOut(auth);
      throw new AuthServiceError(
        'NOT_ADMIN',
        'Access denied. This account does not hold verified Administrator privileges.'
      );
    }

    await recordAdminLoginAttempt({
      uid: user.uid,
      email: user.email || email.trim(),
      role: isSuperAdmin ? 'SUPER_ADMIN' : 'ADMIN',
      outcome: 'SUCCESS',
    });

    void recordUserActivity({
      uid: user.uid,
      category: 'LOGIN',
      action: isSuperAdmin ? 'Super Admin Portal Login' : 'Admin Portal Login',
      details: `Verified admin sign-in (${user.email || user.uid})`,
    });

    return user;
  } catch (err) {
    if (err instanceof AuthServiceError) throw err;
    handleFirestoreError(err, OperationType.GET, `adminUsers/${user.uid}`);
  }
}

export async function sendPasswordReset(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email.trim());
}

export async function resendVerificationEmail(user: User): Promise<void> {
  await sendEmailVerification(user);
}

export async function updateUserAvatar(uid: string, avatarUrl: string): Promise<void> {
  if (avatarUrl !== '' && !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(avatarUrl)) {
    throw new AuthServiceError(
      'INVALID_AVATAR',
      'Avatar must be a valid JPEG, PNG, or WebP image.'
    );
  }
  if (avatarUrl.length > 100000) {
    throw new AuthServiceError(
      'AVATAR_TOO_LARGE',
      'Processed avatar exceeds maximum allowed size. Please pick a simpler image.'
    );
  }
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      avatarUrl,
      updatedAt: serverTimestamp(),
    });
    void recordUserActivity({
      uid,
      category: 'PROFILE_UPDATE',
      action: avatarUrl ? 'Profile Avatar Updated' : 'Profile Avatar Removed',
      details: avatarUrl
        ? 'Updated member dashboard profile avatar image'
        : 'Removed profile avatar image',
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function logoutUser(): Promise<void> {
  await signOut(auth);
}
