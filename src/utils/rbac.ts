import { SUPER_ADMIN_EMAILS, SUPER_ADMIN_UID } from '../config/constants';
import { AdminUserRecord, UserProfile, UserRole } from '../types/domain';

export type AdminModuleKey =
  | 'USERS'
  | 'DEPOSITS_WITHDRAWALS'
  | 'UPI_ACCOUNTS'
  | 'PRODUCT_PLANS'
  | 'ACTIVITY_LOGS'
  | 'PLATFORM_SETTINGS';

export function isProtectedSuperAdminUid(uid: string | null | undefined): boolean {
  return Boolean(uid && uid.trim() === SUPER_ADMIN_UID);
}

export function isProtectedSuperAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return (SUPER_ADMIN_EMAILS as readonly string[]).includes(email.trim().toLowerCase());
}

export function resolveEffectiveUserRole(
  user: Pick<UserProfile, 'uid' | 'email' | 'role'>,
  adminRecord?: Pick<AdminUserRecord, 'role' | 'active'> | null
): UserRole {
  if (isProtectedSuperAdminUid(user.uid) || user.role === 'SUPER_ADMIN') {
    return 'SUPER_ADMIN';
  }
  if (adminRecord?.active) {
    return adminRecord.role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'ADMIN';
  }
  if (user.role === 'ADMIN') {
    return 'ADMIN';
  }
  return 'USER';
}

export function canPromoteToAdmin(
  actorRole: UserRole | null | undefined,
  targetUid: string,
  targetEffectiveRole: UserRole
): boolean {
  if (actorRole !== 'SUPER_ADMIN') return false;
  if (isProtectedSuperAdminUid(targetUid)) return false;
  return targetEffectiveRole === 'USER';
}

export function canRevokeAdmin(
  actorRole: UserRole | null | undefined,
  actorUid: string | null | undefined,
  targetUid: string,
  targetEffectiveRole: UserRole
): boolean {
  if (actorRole !== 'SUPER_ADMIN') return false;
  if (isProtectedSuperAdminUid(targetUid)) return false;
  if (actorUid && actorUid === targetUid) return false;
  return targetEffectiveRole === 'ADMIN';
}

export function canEditAdminAccount(
  actorRole: UserRole | null | undefined,
  actorUid: string | null | undefined,
  targetUid: string,
  targetEffectiveRole: UserRole
): boolean {
  if (actorRole !== 'SUPER_ADMIN') return false;
  if (isProtectedSuperAdminUid(targetUid) || targetEffectiveRole === 'SUPER_ADMIN') {
    return false;
  }
  if (actorUid && actorUid === targetUid) return false;
  return targetEffectiveRole === 'ADMIN';
}

export function canModifyUserAccount(
  actorRole: UserRole | null | undefined,
  targetUid: string,
  targetEffectiveRole: UserRole
): boolean {
  if (isProtectedSuperAdminUid(targetUid) || targetEffectiveRole === 'SUPER_ADMIN') {
    return false;
  }
  if (actorRole === 'SUPER_ADMIN') return true;
  if (actorRole === 'ADMIN') {
    return targetEffectiveRole === 'USER';
  }
  return false;
}

export function canEditPlatformSettings(actorRole: UserRole | null | undefined): boolean {
  return actorRole === 'SUPER_ADMIN';
}

export function canAccessAdminModule(
  actorRole: UserRole | null | undefined,
  moduleKey: AdminModuleKey
): boolean {
  if (actorRole === 'SUPER_ADMIN') return true;
  if (actorRole === 'ADMIN') {
    // Lower-tier Admins have full operational module access; Platform Settings is read-only / Super Admin controlled
    return moduleKey !== 'PLATFORM_SETTINGS';
  }
  return false;
}
