import assert from 'node:assert/strict';
import test from 'node:test';
import { SUPER_ADMIN_UID } from '../../config/constants.ts';
import {
  canAccessAdminModule,
  canEditAdminAccount,
  canEditPlatformSettings,
  canModifyUserAccount,
  canPromoteToAdmin,
  canRevokeAdmin,
  isProtectedSuperAdminEmail,
  isProtectedSuperAdminUid,
  resolveEffectiveUserRole,
} from '../rbac.ts';

test('Super Admin UID wZQCw7fXrWQCn5HqdSjS6RQHVyi1 is always protected from promotion/revocation/modification', () => {
  assert.equal(isProtectedSuperAdminUid(SUPER_ADMIN_UID), true);
  assert.equal(isProtectedSuperAdminUid('random_uid_123'), false);
  assert.equal(isProtectedSuperAdminEmail('saini.lalit278@gmail.com'), true);
  assert.equal(isProtectedSuperAdminEmail('SAINI.LALIT278@GMAIL.COM'), true);
  assert.equal(isProtectedSuperAdminEmail('sainil.lalit278@gmail.com'), false);
  assert.equal(isProtectedSuperAdminEmail('other@example.com'), false);

  assert.equal(canPromoteToAdmin('SUPER_ADMIN', SUPER_ADMIN_UID, 'SUPER_ADMIN'), false);
  assert.equal(canRevokeAdmin('SUPER_ADMIN', 'other_super', SUPER_ADMIN_UID, 'SUPER_ADMIN'), false);
  assert.equal(canEditAdminAccount('SUPER_ADMIN', 'other_super', SUPER_ADMIN_UID, 'SUPER_ADMIN'), false);
  assert.equal(canEditAdminAccount('ADMIN', 'admin_002', SUPER_ADMIN_UID, 'SUPER_ADMIN'), false);
  assert.equal(canModifyUserAccount('SUPER_ADMIN', SUPER_ADMIN_UID, 'SUPER_ADMIN'), false);
  assert.equal(canModifyUserAccount('ADMIN', SUPER_ADMIN_UID, 'SUPER_ADMIN'), false);
});

test('Role-wise RBAC permission matrix enforces strict Super Admin > Admin > Member boundaries', () => {
  const memberUid = 'member_001';
  const adminUid = 'admin_002';

  // Super Admin can promote members, edit/suspend/revoke regular admins, edit settings, and modify non-super users
  assert.equal(canPromoteToAdmin('SUPER_ADMIN', memberUid, 'USER'), true);
  assert.equal(canEditAdminAccount('SUPER_ADMIN', SUPER_ADMIN_UID, adminUid, 'ADMIN'), true);
  assert.equal(canRevokeAdmin('SUPER_ADMIN', SUPER_ADMIN_UID, adminUid, 'ADMIN'), true);
  assert.equal(canModifyUserAccount('SUPER_ADMIN', memberUid, 'USER'), true);
  assert.equal(canModifyUserAccount('SUPER_ADMIN', adminUid, 'ADMIN'), true);
  assert.equal(canEditPlatformSettings('SUPER_ADMIN'), true);
  assert.equal(canAccessAdminModule('SUPER_ADMIN', 'PLATFORM_SETTINGS'), true);

  // Regular Admin can manage members and operational modules, but CANNOT promote/edit/revoke admins, modify admins/super admin, or edit platform settings
  assert.equal(canPromoteToAdmin('ADMIN', memberUid, 'USER'), false);
  assert.equal(canEditAdminAccount('ADMIN', adminUid, 'admin_003', 'ADMIN'), false);
  assert.equal(canRevokeAdmin('ADMIN', adminUid, 'admin_003', 'ADMIN'), false);
  assert.equal(canModifyUserAccount('ADMIN', memberUid, 'USER'), true);
  assert.equal(canModifyUserAccount('ADMIN', 'admin_003', 'ADMIN'), false);
  assert.equal(canEditPlatformSettings('ADMIN'), false);
  assert.equal(canAccessAdminModule('ADMIN', 'DEPOSITS_WITHDRAWALS'), true);
  assert.equal(canAccessAdminModule('ADMIN', 'UPI_ACCOUNTS'), true);
  assert.equal(canAccessAdminModule('ADMIN', 'PRODUCT_PLANS'), true);
  assert.equal(canAccessAdminModule('ADMIN', 'PLATFORM_SETTINGS'), false);

  // Regular Member has zero administrative permissions
  assert.equal(canPromoteToAdmin('USER', memberUid, 'USER'), false);
  assert.equal(canModifyUserAccount('USER', memberUid, 'USER'), false);
  assert.equal(canEditPlatformSettings('USER'), false);
  assert.equal(canAccessAdminModule('USER', 'USERS'), false);
});

test('resolveEffectiveUserRole honors Super Admin UID and active admin directory status', () => {
  assert.equal(
    resolveEffectiveUserRole({
      uid: SUPER_ADMIN_UID,
      email: 'saini.lalit278@gmail.com',
      role: 'USER',
    }),
    'SUPER_ADMIN'
  );

  assert.equal(
    resolveEffectiveUserRole(
      { uid: 'u1', email: 'ops@nexora.in', role: 'USER' },
      { role: 'ADMIN', active: true }
    ),
    'ADMIN'
  );

  assert.equal(
    resolveEffectiveUserRole(
      { uid: 'u2', email: 'member@nexora.in', role: 'USER' },
      { role: 'ADMIN', active: false }
    ),
    'USER'
  );
});
