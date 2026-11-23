import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { User, onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { SUPER_ADMIN_EMAILS, SUPER_ADMIN_UID } from '../config/constants';
import { OperationType, auth, db, handleFirestoreError } from '../firebase/client';
import { CoinWallet, UserProfile } from '../types/domain';
import {
  ensureUserProfileOnLogin,
  isAuthRegistrationInFlight,
  logoutUser,
  mapFirebaseError,
} from '../services/authService';

interface AuthContextValue {
  firebaseUser: User | null;
  profile: UserProfile | null;
  wallet: CoinWallet | null;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  adminRole: 'SUPER_ADMIN' | 'ADMIN' | null;
  authReady: boolean;
  profileInitializing: boolean;
  profileInitError: string | null;
  retryProfileInit: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [wallet, setWallet] = useState<CoinWallet | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [profileInitializing, setProfileInitializing] = useState(false);
  const [profileInitError, setProfileInitError] = useState<string | null>(null);
  const attemptedInitUidsRef = useRef<Set<string>>(new Set());

  const runProfileInit = useCallback(async (user: User) => {
    setProfileInitializing(true);
    setProfileInitError(null);
    try {
      const { profile: ensured } = await ensureUserProfileOnLogin(user);
      setProfile(ensured);
    } catch (err) {
      setProfileInitError(mapFirebaseError(err));
    } finally {
      setProfileInitializing(false);
      setAuthReady(true);
    }
  }, []);

  useEffect(() => {
    let unsubscribeProfile: (() => void) | undefined;
    let unsubscribeWallet: (() => void) | undefined;
    let unsubscribeAdmin: (() => void) | undefined;
    let cancelled = false;

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      unsubscribeProfile?.();
      unsubscribeWallet?.();
      unsubscribeAdmin?.();

      setFirebaseUser(user);
      setProfileInitError(null);

      if (!user) {
        attemptedInitUidsRef.current.clear();
        setProfile(null);
        setWallet(null);
        setIsAdmin(false);
        setIsSuperAdmin(false);
        setProfileInitializing(false);
        setAuthReady(true);
        return;
      }

      const isUidSuper = user.uid === SUPER_ADMIN_UID;
      const isVerifiedSuperEmail =
        user.emailVerified &&
        Boolean(user.email) &&
        (SUPER_ADMIN_EMAILS as readonly string[]).includes(user.email!.toLowerCase());

      let claimsSuper = false;
      let claimsAdmin = false;
      let docAdminActive = false;
      let docSuperAdmin = false;
      let profileRole: UserProfile['role'] = 'USER';

      const recomputeRoles = () => {
        const nextSuper =
          isUidSuper ||
          isVerifiedSuperEmail ||
          claimsSuper ||
          docSuperAdmin ||
          profileRole === 'SUPER_ADMIN';
        const nextAdmin =
          nextSuper || docAdminActive || claimsAdmin || profileRole === 'ADMIN';
        setIsSuperAdmin(nextSuper);
        setIsAdmin(nextAdmin);
      };

      recomputeRoles();

      void user
        .getIdTokenResult()
        .then((tokenResult) => {
          if (cancelled) return;
          claimsSuper =
            tokenResult.claims.super_admin === true ||
            tokenResult.claims.role === 'SUPER_ADMIN';
          claimsAdmin =
            tokenResult.claims.role === 'ADMIN' || tokenResult.claims.admin === true;
          recomputeRoles();
        })
        .catch(() => {});

      const userPath = `users/${user.uid}`;
      unsubscribeProfile = onSnapshot(
        doc(db, 'users', user.uid),
        (snap) => {
          if (snap.exists()) {
            const data = snap.data();
            setProfileInitError(null);
            setProfileInitializing(false);
            profileRole = (data.role as UserProfile['role']) || 'USER';
            setProfile({
              uid: String(data.uid),
              userId: String(data.userId),
              role: profileRole,
              fullName: String(data.fullName),
              email: String(data.email || ''),
              mobile: String(data.mobile || ''),
              emailVerified: Boolean(user.emailVerified || data.emailVerified),
              mobileVerified: Boolean(user.phoneNumber || data.mobileVerified),
              authProvider: data.authProvider,
              status: data.status,
              avatarUrl:
                typeof data.avatarUrl === 'string' && data.avatarUrl ? data.avatarUrl : undefined,
              referredByCode: data.referredByCode ? String(data.referredByCode) : undefined,
              suspensionReason: data.suspensionReason
                ? String(data.suspensionReason)
                : undefined,
              createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : '',
              updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate().toISOString() : '',
            });
            recomputeRoles();
            setAuthReady(true);
          } else {
            profileRole = 'USER';
            setProfile(null);
            if (
              !user.isAnonymous &&
              !isAuthRegistrationInFlight() &&
              !attemptedInitUidsRef.current.has(user.uid)
            ) {
              attemptedInitUidsRef.current.add(user.uid);
              void runProfileInit(user);
            } else if (!isAuthRegistrationInFlight()) {
              setAuthReady(true);
            }
          }
        },
        (error) => {
          setProfileInitializing(false);
          setAuthReady(true);
          try {
            handleFirestoreError(error, OperationType.GET, userPath);
          } catch (err) {
            setProfileInitError(mapFirebaseError(err));
          }
        }
      );

      const walletPath = `coinWallets/${user.uid}`;
      unsubscribeWallet = onSnapshot(
        doc(db, 'coinWallets', user.uid),
        (snap) => {
          if (snap.exists()) {
            const data = snap.data();
            setWallet({
              uid: String(data.uid),
              userId: String(data.userId),
              availableCoins: Number(data.availableCoins || 0),
              purchasedCoins: Number(data.purchasedCoins || 0),
              earnedCoins: Number(data.earnedCoins || 0),
              coinsUsedForPlans: Number(data.coinsUsedForPlans || 0),
              pendingTransactionCoins: Number(data.pendingTransactionCoins || 0),
              withdrawableBalanceInr: Number(data.withdrawableBalanceInr || 0),
              lastWithdrawalRef: data.lastWithdrawalRef
                ? String(data.lastWithdrawalRef)
                : undefined,
              lastPlanRef: data.lastPlanRef ? String(data.lastPlanRef) : undefined,
              updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate().toISOString() : '',
            });
          } else {
            setWallet(null);
          }
        },
        (error) => {
          try {
            handleFirestoreError(error, OperationType.GET, walletPath);
          } catch {
            // Non-blocking: logged cleanly inside handleFirestoreError without crashing listener
          }
        }
      );

      const adminPath = `adminUsers/${user.uid}`;
      unsubscribeAdmin = onSnapshot(
        doc(db, 'adminUsers', user.uid),
        (snap) => {
          docAdminActive = Boolean(snap.exists() && snap.data().active === true);
          docSuperAdmin = Boolean(
            snap.exists() && snap.data().active === true && snap.data().role === 'SUPER_ADMIN'
          );
          recomputeRoles();
        },
        (error) => {
          try {
            handleFirestoreError(error, OperationType.GET, adminPath);
          } catch {
            // Non-blocking: normal users have read access to own adminUsers doc if exists, otherwise ignored
          }
        }
      );
    });

    return () => {
      cancelled = true;
      unsubscribeAuth();
      unsubscribeProfile?.();
      unsubscribeWallet?.();
      unsubscribeAdmin?.();
    };
  }, [runProfileInit]);

  const retryProfileInit = useCallback(async () => {
    if (!firebaseUser) return;
    await runProfileInit(firebaseUser);
  }, [firebaseUser, runProfileInit]);

  const signOut = async () => {
    await logoutUser();
  };

  const adminRole: 'SUPER_ADMIN' | 'ADMIN' | null = isSuperAdmin
    ? 'SUPER_ADMIN'
    : isAdmin
    ? 'ADMIN'
    : null;

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        profile,
        wallet,
        isAdmin,
        isSuperAdmin,
        adminRole,
        authReady,
        profileInitializing,
        profileInitError,
        retryProfileInit,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
