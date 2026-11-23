import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import {
  ArrowLeftRight,
  BarChart3,
  ClipboardList,
  Coins,
  Crown,
  LogOut,
  Package,
  QrCode,
  Settings2,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { AdminDepositsWithdrawals } from '../../components/admin/AdminDepositsWithdrawals';
import { AdminFinancialReports } from '../../components/admin/AdminFinancialReports';
import { AdminPlatformSettings } from '../../components/admin/AdminPlatformSettings';
import {
  AdminUserManagement,
  UserManagementViewMode,
} from '../../components/admin/AdminUserManagement';
import { CoinPackageConfiguration } from '../../components/admin/CoinPackageConfiguration';
import { ProductPlanManagement } from '../../components/admin/ProductPlanManagement';
import { SecurityConfig } from '../../components/admin/SecurityConfig';
import { SystemEventsLog } from '../../components/admin/SystemEventsLog';
import { UpiManagement } from '../../components/admin/UpiManagement';
import { LoadingScreen } from '../../components/common/LoadingScreen';
import { ROUTES, SUPER_ADMIN_UID } from '../../config/constants';
import { useAuth } from '../../context/AuthContext';
import {
  AdminActorContext,
  subscribeAdminDirectory,
  subscribeAllDeposits,
  subscribeAllProductPlans,
  subscribeAllUpiAccounts,
  subscribeAllUsers,
  subscribeAllWithdrawals,
} from '../../services/adminService';

type AdminTab =
  | 'USERS'
  | 'DEPOSITS_WITHDRAWALS'
  | 'REPORTS'
  | 'UPI'
  | 'COIN_PACKAGES'
  | 'PLANS'
  | 'AUDIT_LOGS'
  | 'SETTINGS';

const TABS: {
  id: AdminTab;
  label: string;
  Icon: typeof Users;
  superAdminOnlyBadge?: boolean;
}[] = [
  { id: 'USERS', label: 'Users & Admins', Icon: Users },
  { id: 'DEPOSITS_WITHDRAWALS', label: 'Deposits & Withdrawals', Icon: ArrowLeftRight },
  { id: 'REPORTS', label: 'Financial Reports', Icon: BarChart3 },
  { id: 'UPI', label: 'UPI Accounts', Icon: QrCode },
  { id: 'COIN_PACKAGES', label: 'Coin Packages', Icon: Coins },
  { id: 'PLANS', label: 'Product Plans', Icon: Package },
  { id: 'AUDIT_LOGS', label: 'Audit Logs', Icon: ClipboardList },
  { id: 'SETTINGS', label: 'Security & Config', Icon: Settings2, superAdminOnlyBadge: true },
];

export function AdminPortalPage() {
  const navigate = useNavigate();
  const { firebaseUser, isAdmin, isSuperAdmin, authReady, signOut } = useAuth();
  const [activeTab, setActiveTab] = useState<AdminTab>('USERS');
  const [userViewMode, setUserViewMode] = useState<UserManagementViewMode>('ALL_USERS');

  // Executive Dashboard live KPI counters
  const [totalUsersCount, setTotalUsersCount] = useState<number | null>(null);
  const [activeAdminsCount, setActiveAdminsCount] = useState<number | null>(null);
  const [pendingDepositsCount, setPendingDepositsCount] = useState<number | null>(null);
  const [pendingWithdrawalsCount, setPendingWithdrawalsCount] = useState<number | null>(null);
  const [activeUpiCount, setActiveUpiCount] = useState<number | null>(null);
  const [activePlansCount, setActivePlansCount] = useState<number | null>(null);

  useEffect(() => {
    if (!firebaseUser || !isAdmin) return;

    const unsubUsers = subscribeAllUsers(
      (items) => setTotalUsersCount(items.length),
      () => {}
    );
    const unsubAdmins = subscribeAdminDirectory(
      (items) => {
        const activeNonSuper = items.filter(
          (a) => a.active && a.uid !== SUPER_ADMIN_UID
        ).length;
        setActiveAdminsCount(activeNonSuper + 1); // +1 for protected Super Admin
      },
      () => {}
    );
    const unsubDeposits = subscribeAllDeposits(
      (items) =>
        setPendingDepositsCount(
          items.filter((d) => d.status === 'PENDING' || d.status === 'UNDER_REVIEW').length
        ),
      () => {}
    );
    const unsubWithdrawals = subscribeAllWithdrawals(
      (items) =>
        setPendingWithdrawalsCount(
          items.filter(
            (w) =>
              w.status === 'PENDING' ||
              w.status === 'PROCESSING' ||
              w.status === 'UNDER_REVIEW' ||
              w.status === 'APPROVED'
          ).length
        ),
      () => {}
    );
    const unsubUpi = subscribeAllUpiAccounts(
      (items) => setActiveUpiCount(items.filter((u) => u.isActive).length),
      () => {}
    );
    const unsubPlans = subscribeAllProductPlans(
      (items) => setActivePlansCount(items.filter((p) => p.isActive).length),
      () => {}
    );

    return () => {
      unsubUsers();
      unsubAdmins();
      unsubDeposits();
      unsubWithdrawals();
      unsubUpi();
      unsubPlans();
    };
  }, [firebaseUser, isAdmin]);

  if (!authReady) {
    return <LoadingScreen label="Verifying administrator session..." />;
  }

  if (!firebaseUser || !isAdmin) {
    return <Navigate to={ROUTES.ADMIN_LOGIN} replace />;
  }

  const actor: AdminActorContext = {
    uid: firebaseUser.uid,
    email: firebaseUser.email || 'admin@nexorainvest.example',
    role: isSuperAdmin ? 'SUPER_ADMIN' : 'ADMIN',
  };

  const handleLogout = async () => {
    await signOut();
    navigate(ROUTES.HOME, { replace: true });
  };

  const kpiCards: {
    label: string;
    value: number | null;
    hint: string;
    onClick: () => void;
    highlight?: boolean;
  }[] = [
    {
      label: 'Registered Users',
      value: totalUsersCount,
      hint: 'View all members',
      onClick: () => {
        setUserViewMode('ALL_USERS');
        setActiveTab('USERS');
      },
    },
    {
      label: 'Active Admins',
      value: activeAdminsCount,
      hint: isSuperAdmin ? 'Manage admin roles' : 'View directory',
      onClick: () => {
        setUserViewMode('ADMIN_DIRECTORY');
        setActiveTab('USERS');
      },
    },
    {
      label: 'Pending Deposits',
      value: pendingDepositsCount,
      hint: 'Review UPI UTRs',
      highlight: Boolean(pendingDepositsCount && pendingDepositsCount > 0),
      onClick: () => setActiveTab('DEPOSITS_WITHDRAWALS'),
    },
    {
      label: 'Open Withdrawals',
      value: pendingWithdrawalsCount,
      hint: 'Process payouts',
      highlight: Boolean(pendingWithdrawalsCount && pendingWithdrawalsCount > 0),
      onClick: () => setActiveTab('DEPOSITS_WITHDRAWALS'),
    },
    {
      label: 'Active UPI IDs',
      value: activeUpiCount,
      hint: 'Payment endpoints',
      onClick: () => setActiveTab('UPI'),
    },
    {
      label: 'Live Product Plans',
      value: activePlansCount,
      hint: 'Catalog tiers',
      onClick: () => setActiveTab('PLANS'),
    },
  ];

  return (
    <div className="bg-slate-50 min-h-[calc(100vh-12rem)] py-10 sm:py-12">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 space-y-6">
        {/* Role-Aware Admin Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[#0B1A30] text-white p-6 sm:p-8 rounded-xl border border-[#1D3A68]">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-semibold tracking-wider text-[#D8B45A] uppercase">
                NEXORA INVEST Administration
              </p>
              <span
                className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[11px] font-bold ${
                  isSuperAdmin
                    ? 'bg-[#C59B3B] text-[#0B1A30]'
                    : 'bg-white/10 text-white border border-white/25'
                }`}
              >
                {isSuperAdmin ? (
                  <>
                    <Crown className="h-3 w-3" aria-hidden="true" />
                    <span>Super Admin Master Authority</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="h-3 w-3 text-[#D8B45A]" aria-hidden="true" />
                    <span>Operations Admin</span>
                  </>
                )}
              </span>
            </div>
            <h1 className="font-display text-2xl sm:text-3xl font-bold">
              {isSuperAdmin ? 'Super Admin Control Center' : 'Admin Operational Portal'}
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 font-mono">
              Signed in as {firebaseUser.email} · UID: {firebaseUser.uid}
            </p>
          </div>

          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white border border-white/25 hover:border-[#C59B3B] rounded-lg cursor-pointer self-start sm:self-auto"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            <span>Sign Out</span>
          </button>
        </div>

        {/* Executive KPI Overview Strip */}
        <section
          aria-label="Live Platform KPI Overview"
          className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3"
        >
          {kpiCards.map((card) => (
            <button
              key={card.label}
              type="button"
              onClick={card.onClick}
              className={`text-left p-4 bg-white rounded-xl border transition-colors cursor-pointer hover:border-[#0B1A30] ${
                card.highlight ? 'border-[#C59B3B]' : 'border-slate-200'
              }`}
            >
              <p className="text-[11px] font-medium text-slate-500 truncate">{card.label}</p>
              <p
                className={`font-mono text-2xl font-bold tabular-nums mt-1 ${
                  card.highlight ? 'text-[#8A6518]' : 'text-[#0B1A30]'
                }`}
              >
                {card.value === null ? '—' : card.value}
              </p>
              <p className="text-[11px] text-[#A37B22] font-semibold mt-1">{card.hint}</p>
            </button>
          ))}
        </section>

        {/* RBAC Scope Notice */}
        <div className="bg-white border border-slate-200 rounded-xl px-5 py-3.5 flex items-start gap-3 text-xs text-slate-600">
          {isSuperAdmin ? (
            <Crown className="h-4 w-4 text-[#A37B22] shrink-0 mt-0.5" aria-hidden="true" />
          ) : (
            <ShieldCheck className="h-4 w-4 text-[#A37B22] shrink-0 mt-0.5" aria-hidden="true" />
          )}
          <p>
            {isSuperAdmin
              ? `Unrestricted Master Access active. You can manage all members, create/edit/suspend/remove Admin accounts, control UPI endpoints, plans, deposits, withdrawals, reports, audit logs, and website security settings. Protected Super Admin UID ${SUPER_ADMIN_UID} is permanently locked against demotion.`
              : `Operational Admin Access active. You can manage members, deposits, withdrawals, UPI endpoints, product plans, reports, and view audit logs. Super Admin management and master security configuration are restricted to the Super Admin (${SUPER_ADMIN_UID}).`}
          </p>
        </div>

        {/* Navigation Tabs */}
        <nav
          aria-label="Admin Portal Modules"
          className="flex items-center gap-1.5 p-1.5 bg-white border border-slate-200 rounded-xl overflow-x-auto"
        >
          {TABS.map(({ id, label, Icon, superAdminOnlyBadge }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  active
                    ? 'bg-[#0B1A30] text-white'
                    : 'text-slate-600 hover:text-[#0B1A30] hover:bg-slate-100'
                }`}
              >
                <Icon
                  className={`h-3.5 w-3.5 ${active ? 'text-[#D8B45A]' : 'text-[#A37B22]'}`}
                  aria-hidden="true"
                />
                <span>{label}</span>
                {superAdminOnlyBadge && (
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                      active ? 'bg-[#C59B3B] text-[#0B1A30]' : 'bg-[#F8F1DE] text-[#8A6518]'
                    }`}
                  >
                    Master
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Active Module Workspace */}
        <div>
          {activeTab === 'USERS' && (
            <AdminUserManagement actor={actor} requestedViewMode={userViewMode} />
          )}
          {activeTab === 'DEPOSITS_WITHDRAWALS' && <AdminDepositsWithdrawals actor={actor} />}
          {activeTab === 'REPORTS' && <AdminFinancialReports />}
          {activeTab === 'UPI' && <UpiManagement actor={actor} />}
          {activeTab === 'COIN_PACKAGES' && <CoinPackageConfiguration actor={actor} />}
          {activeTab === 'PLANS' && <ProductPlanManagement actor={actor} />}
          {activeTab === 'AUDIT_LOGS' && <SystemEventsLog />}
          {activeTab === 'SETTINGS' && (
            <div className="space-y-6">
              <SecurityConfig actor={actor} />
              <AdminPlatformSettings actor={actor} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
