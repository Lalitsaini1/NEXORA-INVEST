import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Coins,
  Crown,
  Edit3,
  Lock,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
} from 'lucide-react';
import { SUPER_ADMIN_EMAILS, SUPER_ADMIN_UID } from '../../config/constants';
import {
  AdminActorContext,
  adjustUserWalletCoins,
  authorizeAdminByUid,
  promoteUserToAdmin,
  revokeAdminAccess,
  subscribeAdminDirectory,
  subscribeAllUsers,
  updateAdminAccount,
  updateUserAccountStatus,
} from '../../services/adminService';
import { AdminUserRecord, UserProfile, UserRole } from '../../types/domain';
import { formatDateTimeInr } from '../../utils/formatters';
import {
  canEditAdminAccount,
  canModifyUserAccount,
  canPromoteToAdmin,
  canRevokeAdmin,
  isProtectedSuperAdminUid,
  resolveEffectiveUserRole,
} from '../../utils/rbac';

export type UserManagementViewMode = 'ALL_USERS' | 'ADMIN_DIRECTORY';

interface AdminUserManagementProps {
  actor: AdminActorContext;
  requestedViewMode?: UserManagementViewMode;
}

function RoleBadge({ role }: { role: UserRole }) {
  if (role === 'SUPER_ADMIN') {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold bg-[#F8F1DE] text-[#8A6518] border border-[#C59B3B]">
        <Crown className="h-3 w-3" aria-hidden="true" />
        <span>Super Admin</span>
      </span>
    );
  }
  if (role === 'ADMIN') {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-[#0B1A30] text-white">
        <ShieldCheck className="h-3 w-3 text-[#D8B45A]" aria-hidden="true" />
        <span>Admin</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
      <span>Member</span>
    </span>
  );
}

const HARDCODED_PROTECTED_SUPER_ADMIN_UID = 'wZQCw7fXrWQCn5HqdSjS6RQHVyi1';

function isHardcodedSuperAdmin(uid: string | null | undefined): boolean {
  const normalized = (uid ?? '').trim();
  return (
    normalized === HARDCODED_PROTECTED_SUPER_ADMIN_UID ||
    normalized === SUPER_ADMIN_UID ||
    isProtectedSuperAdminUid(normalized)
  );
}

export function AdminUserManagement({
  actor,
  requestedViewMode,
}: AdminUserManagementProps) {
  const [viewMode, setViewMode] = useState<UserManagementViewMode>(
    requestedViewMode ?? 'ALL_USERS'
  );
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [adminDirectory, setAdminDirectory] = useState<AdminUserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);
  const [busyUid, setBusyUid] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'ALL' | UserRole>('ALL');

  // Direct Admin authorization by Firebase UID (Super Admin only)
  const [showAddAdminForm, setShowAddAdminForm] = useState(false);
  const [newAdminUid, setNewAdminUid] = useState('');
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [newAdminName, setNewAdminName] = useState('');

  // Inline Edit Admin form state (Super Admin only)
  const [editingAdmin, setEditingAdmin] = useState<AdminUserRecord | null>(null);
  const [editAdminName, setEditAdminName] = useState('');
  const [editAdminActive, setEditAdminActive] = useState(true);

  // Inline Coin Wallet adjustment dialog state
  const [adjustingUser, setAdjustingUser] = useState<UserProfile | null>(null);
  const [adjustDelta, setAdjustDelta] = useState('');
  const [adjustReason, setAdjustReason] = useState('');

  const isSuperAdmin = actor.role === 'SUPER_ADMIN';

  useEffect(() => {
    if (requestedViewMode) {
      setViewMode(requestedViewMode);
    }
  }, [requestedViewMode]);

  useEffect(() => {
    setLoading(true);
    const unsubUsers = subscribeAllUsers(
      (items) => {
        setUsers(items);
        setLoading(false);
        setErrorMsg(null);
      },
      (msg) => {
        setErrorMsg(msg);
        setLoading(false);
      }
    );
    const unsubAdmins = subscribeAdminDirectory(
      (admins) => setAdminDirectory(admins),
      () => {}
    );

    return () => {
      unsubUsers();
      unsubAdmins();
    };
  }, []);

  const adminByUid = useMemo(() => {
    const map = new Map<string, AdminUserRecord>();
    for (const entry of adminDirectory) {
      map.set(entry.uid, entry);
    }
    return map;
  }, [adminDirectory]);

  const userByUid = useMemo(() => {
    const map = new Map<string, UserProfile>();
    for (const u of users) {
      map.set(u.uid, u);
    }
    return map;
  }, [users]);

  const enrichedUsers = useMemo(() => {
    return users.map((u) => {
      const adminRec = adminByUid.get(u.uid);
      const effectiveRole = resolveEffectiveUserRole(u, adminRec);
      return {
        user: u,
        effectiveRole,
        isProtectedMaster: isProtectedSuperAdminUid(u.uid),
      };
    });
  }, [users, adminByUid]);

  const adminAccountsList = useMemo(() => {
    const entries = new Map<
      string,
      {
        record: AdminUserRecord;
        effectiveRole: 'SUPER_ADMIN' | 'ADMIN';
        isProtectedMaster: boolean;
      }
    >();

    const superProfile = userByUid.get(SUPER_ADMIN_UID);
    const superDir = adminByUid.get(SUPER_ADMIN_UID);
    entries.set(SUPER_ADMIN_UID, {
      record: {
        uid: SUPER_ADMIN_UID,
        email: superProfile?.email || superDir?.email || SUPER_ADMIN_EMAILS[0],
        displayName:
          superProfile?.fullName || superDir?.displayName || 'Master Super Admin',
        role: 'SUPER_ADMIN',
        active: true,
        createdAt: superDir?.createdAt || superProfile?.createdAt || '',
        updatedAt: superDir?.updatedAt || superProfile?.updatedAt || '',
      },
      effectiveRole: 'SUPER_ADMIN',
      isProtectedMaster: true,
    });

    for (const rec of adminDirectory) {
      if (rec.uid === SUPER_ADMIN_UID) continue;
      const profile = userByUid.get(rec.uid);
      const effectiveRole: 'SUPER_ADMIN' | 'ADMIN' =
        rec.role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'ADMIN';
      entries.set(rec.uid, {
        record: {
          ...rec,
          displayName: rec.displayName || profile?.fullName || rec.email,
        },
        effectiveRole,
        isProtectedMaster: isProtectedSuperAdminUid(rec.uid),
      });
    }

    const q = searchQuery.trim().toLowerCase();
    return Array.from(entries.values()).filter(({ record }) => {
      if (!q) return true;
      return (
        record.email.toLowerCase().includes(q) ||
        (record.displayName || '').toLowerCase().includes(q) ||
        record.uid.toLowerCase().includes(q)
      );
    });
  }, [adminDirectory, adminByUid, userByUid, searchQuery]);

  const filteredUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return enrichedUsers.filter(({ user, effectiveRole }) => {
      if (roleFilter !== 'ALL' && effectiveRole !== roleFilter) return false;
      if (!q) return true;
      return (
        user.email.toLowerCase().includes(q) ||
        user.fullName.toLowerCase().includes(q) ||
        user.userId.toLowerCase().includes(q) ||
        user.uid.toLowerCase().includes(q)
      );
    });
  }, [enrichedUsers, roleFilter, searchQuery]);

  // Explicit client-side exclusion list of modifiable target UIDs (excludes protected Super Admin UID)
  const modifiableUsersCount = useMemo(
    () =>
      enrichedUsers.filter(
        ({ user, effectiveRole }) =>
          user.uid !== SUPER_ADMIN_UID &&
          canModifyUserAccount(actor.role, user.uid, effectiveRole)
      ).length,
    [enrichedUsers, actor.role]
  );

  const handlePromote = async (targetUser: UserProfile) => {
    if (isHardcodedSuperAdmin(targetUser.uid)) return;
    setErrorMsg(null);
    setNoticeMsg(null);
    setBusyUid(targetUser.uid);
    try {
      await promoteUserToAdmin({ actor, targetUser });
      setNoticeMsg(`Promoted ${targetUser.email || targetUser.userId} to Admin.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to promote user.');
    } finally {
      setBusyUid(null);
    }
  };

  const handleRevoke = async (targetUid: string, targetLabel: string) => {
    if (isHardcodedSuperAdmin(targetUid)) return;
    setErrorMsg(null);
    setNoticeMsg(null);
    setBusyUid(targetUid);
    try {
      await revokeAdminAccess({
        actor,
        targetUid,
        targetEmail: targetLabel,
      });
      if (editingAdmin?.uid === targetUid) {
        setEditingAdmin(null);
      }
      setNoticeMsg(`Removed Admin access for ${targetLabel}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to revoke admin role.');
    } finally {
      setBusyUid(null);
    }
  };

  const handleToggleAdminActive = async (rec: AdminUserRecord) => {
    if (isHardcodedSuperAdmin(rec.uid)) return;
    setErrorMsg(null);
    setNoticeMsg(null);
    setBusyUid(rec.uid);
    try {
      await updateAdminAccount({
        actor,
        targetUid: rec.uid,
        displayName: rec.displayName || rec.email.split('@')[0] || 'Admin',
        active: !rec.active,
      });
      setNoticeMsg(
        `${rec.active ? 'Suspended' : 'Reactivated'} Admin account ${rec.email || rec.uid}.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to update admin status.');
    } finally {
      setBusyUid(null);
    }
  };

  const handleSaveAdminEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAdmin || isHardcodedSuperAdmin(editingAdmin.uid)) return;
    setErrorMsg(null);
    setNoticeMsg(null);
    setBusyUid(editingAdmin.uid);
    try {
      await updateAdminAccount({
        actor,
        targetUid: editingAdmin.uid,
        displayName: editAdminName,
        active: editAdminActive,
      });
      setNoticeMsg(`Updated Admin account ${editingAdmin.email || editingAdmin.uid}.`);
      setEditingAdmin(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to save admin details.');
    } finally {
      setBusyUid(null);
    }
  };

  const handleToggleStatus = async (targetUser: UserProfile) => {
    if (isHardcodedSuperAdmin(targetUser.uid)) return;
    const nextStatus = targetUser.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    setErrorMsg(null);
    setNoticeMsg(null);
    setBusyUid(targetUser.uid);
    try {
      await updateUserAccountStatus({ actor, targetUser, nextStatus });
      setNoticeMsg(
        `Updated ${targetUser.email || targetUser.userId} account status to ${nextStatus}.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to update user status.');
    } finally {
      setBusyUid(null);
    }
  };

  const handleCreateAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSuperAdmin) return;
    setErrorMsg(null);
    setNoticeMsg(null);
    setBusyUid('create_admin');
    try {
      await authorizeAdminByUid({
        actor,
        uid: newAdminUid,
        email: newAdminEmail,
        displayName: newAdminName,
      });
      setNoticeMsg(`Authorized ${newAdminEmail.trim()} as an Admin.`);
      setNewAdminUid('');
      setNewAdminEmail('');
      setNewAdminName('');
      setShowAddAdminForm(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to add admin account.');
    } finally {
      setBusyUid(null);
    }
  };

  const handleAdjustCoins = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustingUser) return;
    const numericDelta = Number.parseInt(adjustDelta, 10);
    setErrorMsg(null);
    setNoticeMsg(null);
    setBusyUid(adjustingUser.uid);
    try {
      await adjustUserWalletCoins({
        actor,
        targetUser: adjustingUser,
        deltaCoins: numericDelta,
        reason: adjustReason,
      });
      setNoticeMsg(
        `Wallet updated for ${adjustingUser.userId} (${numericDelta > 0 ? `+${numericDelta}` : numericDelta} Coins).`
      );
      setAdjustingUser(null);
      setAdjustDelta('');
      setAdjustReason('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to adjust coin wallet.');
    } finally {
      setBusyUid(null);
    }
  };

  return (
    <section
      aria-labelledby="admin-users-heading"
      className="bg-white border border-slate-200 rounded-xl overflow-hidden"
    >
      <div className="p-5 sm:p-6 border-b border-slate-200 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2
              id="admin-users-heading"
              className="font-display text-lg font-bold text-[#0B1A30] flex items-center gap-2"
            >
              <Users className="h-4 w-4 text-[#A37B22]" aria-hidden="true" />
              <span>
                {viewMode === 'ADMIN_DIRECTORY'
                  ? 'Admin Account Management'
                  : 'User & Role Management'}
              </span>
            </h2>
            <p className="text-xs text-slate-600">
              {users.length} registered accounts · {adminAccountsList.length} directory admins ·{' '}
              {modifiableUsersCount} modifiable under your tier. Super Admin UID{' '}
              <span className="font-mono font-semibold">{SUPER_ADMIN_UID}</span> is permanently
              shielded from role changes or suspension.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-start lg:self-auto">
            <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => setViewMode('ALL_USERS')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md cursor-pointer ${
                  viewMode === 'ALL_USERS'
                    ? 'bg-white text-[#0B1A30] shadow-xs'
                    : 'text-slate-600 hover:text-[#0B1A30]'
                }`}
              >
                All Users ({users.length})
              </button>
              <button
                type="button"
                onClick={() => setViewMode('ADMIN_DIRECTORY')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md cursor-pointer ${
                  viewMode === 'ADMIN_DIRECTORY'
                    ? 'bg-white text-[#0B1A30] shadow-xs'
                    : 'text-slate-600 hover:text-[#0B1A30]'
                }`}
              >
                Admin Accounts ({adminAccountsList.length})
              </button>
            </div>

            {isSuperAdmin && (
              <button
                type="button"
                onClick={() => setShowAddAdminForm((prev) => !prev)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#0B1A30] hover:bg-[#13284A] rounded-lg cursor-pointer"
              >
                <UserPlus className="h-3.5 w-3.5 text-[#D8B45A]" aria-hidden="true" />
                <span>{showAddAdminForm ? 'Close Add Admin' : 'Create / Authorize Admin'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Direct Add Admin Form (Super Admin only) */}
        {isSuperAdmin && showAddAdminForm && (
          <form
            onSubmit={handleCreateAdmin}
            className="bg-slate-50 border border-slate-200 rounded-lg p-4 grid grid-cols-1 md:grid-cols-4 gap-3 items-end"
          >
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Firebase UID
              </label>
              <input
                type="text"
                required
                value={newAdminUid}
                onChange={(e) => setNewAdminUid(e.target.value)}
                placeholder="Target Firebase UID"
                className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Admin Email
              </label>
              <input
                type="email"
                required
                value={newAdminEmail}
                onChange={(e) => setNewAdminEmail(e.target.value)}
                placeholder="admin@nexorainvest.example"
                className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Display Name
              </label>
              <input
                type="text"
                value={newAdminName}
                onChange={(e) => setNewAdminName(e.target.value)}
                placeholder="Operations Lead"
                className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
              />
            </div>
            <button
              type="submit"
              disabled={busyUid === 'create_admin'}
              className="px-4 py-2 text-xs font-semibold text-[#0B1A30] bg-[#C59B3B] hover:bg-[#D8B45A] disabled:opacity-60 rounded-lg cursor-pointer"
            >
              {busyUid === 'create_admin' ? 'Authorizing...' : 'Grant Admin Role'}
            </button>
          </form>
        )}

        {/* Inline Edit Admin Form (Super Admin only) */}
        {isSuperAdmin && editingAdmin && (
          <form
            onSubmit={handleSaveAdminEdit}
            className="bg-[#F8F1DE] border border-[#C59B3B]/60 rounded-lg p-4 grid grid-cols-1 md:grid-cols-4 gap-3 items-end"
          >
            <div>
              <p className="text-[11px] font-bold uppercase text-[#8A6518]">Edit Admin Account</p>
              <p className="text-xs font-semibold text-[#0B1A30] truncate">
                {editingAdmin.email || editingAdmin.uid}
              </p>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                Admin Display Name
              </label>
              <input
                type="text"
                required
                minLength={2}
                maxLength={80}
                value={editAdminName}
                onChange={(e) => setEditAdminName(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
              />
            </div>
            <label className="flex items-center gap-2 pb-2 text-xs font-semibold text-[#0B1A30] cursor-pointer">
              <input
                type="checkbox"
                checked={editAdminActive}
                onChange={(e) => setEditAdminActive(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              <span>Account Active (Uncheck to Suspend)</span>
            </label>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={busyUid === editingAdmin.uid}
                className="px-3.5 py-2 text-xs font-semibold text-white bg-[#0B1A30] hover:bg-[#13284A] disabled:opacity-60 rounded-lg cursor-pointer"
              >
                {busyUid === editingAdmin.uid ? 'Saving...' : 'Save Admin'}
              </button>
              <button
                type="button"
                onClick={() => setEditingAdmin(null)}
                className="px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Inline Wallet Coin Adjustment Form */}
        {adjustingUser && (
          <form
            onSubmit={handleAdjustCoins}
            className="bg-[#F8F1DE] border border-[#C59B3B]/60 rounded-lg p-4 grid grid-cols-1 md:grid-cols-4 gap-3 items-end"
          >
            <div className="md:col-span-1">
              <p className="text-[11px] font-bold uppercase text-[#8A6518]">Wallet Adjustment</p>
              <p className="text-xs font-semibold text-[#0B1A30] truncate">
                {adjustingUser.email || adjustingUser.userId}
              </p>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                Coin Delta (+credit / -debit)
              </label>
              <input
                type="number"
                required
                value={adjustDelta}
                onChange={(e) => setAdjustDelta(e.target.value)}
                placeholder="e.g. 500 or -100"
                className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                Audit Reason
              </label>
              <input
                type="text"
                required
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
                placeholder="Reason for ledger entry"
                className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={busyUid === adjustingUser.uid}
                className="px-3.5 py-2 text-xs font-semibold text-white bg-[#0B1A30] hover:bg-[#13284A] rounded-lg cursor-pointer"
              >
                Apply
              </button>
              <button
                type="button"
                onClick={() => setAdjustingUser(null)}
                className="px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Filter & Search Toolbar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search
              className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                viewMode === 'ADMIN_DIRECTORY'
                  ? 'Search admin by email, name, or UID'
                  : 'Search by email, NX ID, name, or UID'
              }
              className="w-full pl-8 pr-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:bg-white focus:border-[#0B1A30]"
            />
          </div>

          {viewMode === 'ALL_USERS' ? (
            <select
              aria-label="Filter users by role"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value as 'ALL' | UserRole)}
              className="px-3 py-2 text-xs font-semibold text-[#0B1A30] bg-slate-50 border border-slate-300 rounded-lg cursor-pointer"
            >
              <option value="ALL">All Roles</option>
              <option value="SUPER_ADMIN">Super Admin</option>
              <option value="ADMIN">Admin</option>
              <option value="USER">Member</option>
            </select>
          ) : (
            !isSuperAdmin && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-slate-600 bg-slate-100 rounded-lg">
                <Lock className="h-3 w-3" aria-hidden="true" />
                <span>Admin creation, edits &amp; removal restricted to Super Admin</span>
              </span>
            )
          )}
        </div>

        {errorMsg && (
          <div role="alert" className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{errorMsg}</span>
          </div>
        )}
        {noticeMsg && (
          <div role="status" className="p-3 text-xs text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0" aria-hidden="true" />
            <span>{noticeMsg}</span>
          </div>
        )}
      </div>

      {loading ? (
        <div className="p-6 text-xs text-slate-500">Loading directory from Firestore...</div>
      ) : viewMode === 'ADMIN_DIRECTORY' ? (
        adminAccountsList.length === 0 ? (
          <div className="p-6 text-xs text-slate-500">
            No Admin accounts match your current search.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th scope="col" className="py-3 px-5">
                    Administrator &amp; Email
                  </th>
                  <th scope="col" className="py-3 px-4 whitespace-nowrap">
                    Role Tier
                  </th>
                  <th scope="col" className="py-3 px-4 whitespace-nowrap">
                    Status
                  </th>
                  <th scope="col" className="py-3 px-4 whitespace-nowrap">
                    Added / Updated
                  </th>
                  <th scope="col" className="py-3 px-5 text-right whitespace-nowrap">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {adminAccountsList.map(({ record, effectiveRole, isProtectedMaster }) => {
                  const isExcluded = isProtectedMaster || record.uid === SUPER_ADMIN_UID;
                  const allowEdit =
                    !isExcluded &&
                    canEditAdminAccount(actor.role, actor.uid, record.uid, effectiveRole);
                  const allowRemove =
                    !isExcluded &&
                    canRevokeAdmin(actor.role, actor.uid, record.uid, effectiveRole);
                  const isBusy = busyUid === record.uid;

                  return (
                    <tr key={record.uid} className="hover:bg-slate-50/70">
                      <td className="py-3 px-5">
                        <p className="font-semibold text-[#0B1A30]">
                          {record.displayName || record.email}
                        </p>
                        <p className="text-[11px] text-slate-500 font-mono truncate max-w-[260px]">
                          {record.email} · UID: {record.uid}
                        </p>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <RoleBadge role={effectiveRole} />
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold ${
                            record.active
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-red-50 text-red-700'
                          }`}
                        >
                          {record.active ? 'ACTIVE' : 'SUSPENDED'}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-500 whitespace-nowrap">
                        {formatDateTimeInr(record.updatedAt || record.createdAt)}
                      </td>
                      <td className="py-3 px-5 text-right whitespace-nowrap">
                        {isExcluded ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold text-[#8A6518] bg-[#F8F1DE] border border-[#C59B3B]/40">
                            <Lock className="h-3 w-3" aria-hidden="true" />
                            <span>Protected Master Account</span>
                          </span>
                        ) : !allowEdit && !allowRemove ? (
                          <span className="text-[11px] text-slate-400">Super Admin Managed</span>
                        ) : (
                          <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                            {allowEdit && (
                              <>
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => {
                                    setEditingAdmin(record);
                                    setEditAdminName(
                                      record.displayName ||
                                        record.email.split('@')[0] ||
                                        'Admin'
                                    );
                                    setEditAdminActive(record.active);
                                  }}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-[#0B1A30] bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 rounded-md cursor-pointer"
                                >
                                  <Edit3 className="h-3 w-3" aria-hidden="true" />
                                  <span>Edit</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => void handleToggleAdminActive(record)}
                                  className="px-2.5 py-1.5 text-[11px] font-semibold text-[#0B1A30] bg-[#F8F1DE] border border-[#C59B3B]/50 hover:bg-[#EFE2BF] disabled:opacity-50 rounded-md cursor-pointer"
                                >
                                  {record.active ? 'Suspend' : 'Reactivate'}
                                </button>
                              </>
                            )}
                            {allowRemove && (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() =>
                                  void handleRevoke(record.uid, record.email || record.uid)
                                }
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 disabled:opacity-50 rounded-md cursor-pointer"
                              >
                                <UserMinus className="h-3 w-3" aria-hidden="true" />
                                <span>Remove Admin</span>
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : filteredUsers.length === 0 ? (
        <div className="p-6 text-xs text-slate-500">No user profiles match your current filter.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[840px] border-collapse text-left">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                <th scope="col" className="py-3 px-5">
                  User &amp; Email
                </th>
                <th scope="col" className="py-3 px-4 whitespace-nowrap">
                  NX User ID
                </th>
                <th scope="col" className="py-3 px-4 whitespace-nowrap">
                  Role
                </th>
                <th scope="col" className="py-3 px-4 whitespace-nowrap">
                  Status
                </th>
                <th scope="col" className="py-3 px-4 whitespace-nowrap">
                  Joined
                </th>
                <th scope="col" className="py-3 px-5 text-right whitespace-nowrap">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredUsers.map(({ user, effectiveRole, isProtectedMaster }) => {
                // Hardcoded & RBAC guard: exclude Super Admin UID from any role/status modification
                const isExcludedFromModification =
                  isProtectedMaster || isHardcodedSuperAdmin(user.uid);
                const allowPromote =
                  !isExcludedFromModification &&
                  canPromoteToAdmin(actor.role, user.uid, effectiveRole);
                const allowRevoke =
                  !isExcludedFromModification &&
                  canRevokeAdmin(actor.role, actor.uid, user.uid, effectiveRole);
                const allowStatusChange =
                  !isExcludedFromModification &&
                  canModifyUserAccount(actor.role, user.uid, effectiveRole);
                const isBusy = busyUid === user.uid;

                return (
                  <tr key={user.uid} className="hover:bg-slate-50/70">
                    <td className="py-3 px-5">
                      <p className="font-semibold text-[#0B1A30]">{user.email || 'Phone Auth Account'}</p>
                      <p className="text-[11px] text-slate-500 font-mono truncate max-w-[240px]">
                        {user.fullName} · UID: {user.uid}
                      </p>
                    </td>
                    <td className="py-3 px-4 font-mono font-semibold text-[#0B1A30] whitespace-nowrap">
                      {user.userId}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <RoleBadge role={effectiveRole} />
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold ${
                          user.status === 'ACTIVE'
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-red-50 text-red-700'
                        }`}
                      >
                        {user.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-500 whitespace-nowrap">
                      {user.createdAt ? formatDateTimeInr(user.createdAt) : '—'}
                    </td>
                    <td className="py-3 px-5 text-right whitespace-nowrap">
                      {isExcludedFromModification ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold text-[#8A6518] bg-[#F8F1DE] border border-[#C59B3B]/40">
                          <Lock className="h-3 w-3" aria-hidden="true" />
                          <span>Protected Master Account</span>
                        </span>
                      ) : (
                        <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                          {allowPromote && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handlePromote(user)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-white bg-[#0B1A30] hover:bg-[#13284A] disabled:opacity-50 rounded-md cursor-pointer"
                            >
                              <UserCheck className="h-3 w-3 text-[#D8B45A]" aria-hidden="true" />
                              <span>Promote to Admin</span>
                            </button>
                          )}

                          {allowRevoke && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() =>
                                void handleRevoke(user.uid, user.email || user.userId)
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 disabled:opacity-50 rounded-md cursor-pointer"
                            >
                              <UserMinus className="h-3 w-3" aria-hidden="true" />
                              <span>Revoke Admin</span>
                            </button>
                          )}

                          {allowStatusChange && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleToggleStatus(user)}
                              className="px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 rounded-md cursor-pointer"
                            >
                              {user.status === 'ACTIVE' ? 'Suspend' : 'Activate'}
                            </button>
                          )}

                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => {
                              setAdjustingUser(user);
                              setAdjustDelta('');
                              setAdjustReason('');
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-[#0B1A30] bg-[#F8F1DE] border border-[#C59B3B]/50 hover:bg-[#EFE2BF] rounded-md cursor-pointer"
                          >
                            <Coins className="h-3 w-3 text-[#8A6518]" aria-hidden="true" />
                            <span>Adjust Coins</span>
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
