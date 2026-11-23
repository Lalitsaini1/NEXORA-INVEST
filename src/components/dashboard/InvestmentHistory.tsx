import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
  Briefcase,
  CheckCircle2,
  Clock,
  Download,
  Layers,
  RefreshCw,
  Search,
  Sparkles,
  Wallet,
  XCircle,
} from 'lucide-react';
import { ROUTES } from '../../config/constants';
import { subscribeUserDeposits } from '../../services/depositService';
import {
  subscribeUserPlans,
  subscribeUserTransactions,
} from '../../services/transactionService';
import { subscribeUserWithdrawals } from '../../services/walletService';
import {
  CoinTransaction,
  DepositRequest,
  UserPlan,
  WithdrawalRequest,
} from '../../types/domain';
import { formatCoins, formatDateTimeInr, formatInr } from '../../utils/formatters';
import {
  buildInvestmentHistoryEntries,
  computeInvestmentHistorySummary,
  filterInvestmentHistoryEntries,
  investmentHistoryToCsv,
  InvestmentEntryCategory,
  InvestmentHistoryCategoryFilter,
  InvestmentHistoryStatusFilter,
  InvestmentStatusBucket,
} from '../../utils/investmentHistory';

interface InvestmentHistoryProps {
  uid: string;
  highContrast?: boolean;
}

const CATEGORY_TABS: { id: InvestmentHistoryCategoryFilter; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'PLAN', label: 'Plans' },
  { id: 'DEPOSIT', label: 'Deposits' },
  { id: 'REWARD', label: 'Rewards' },
  { id: 'WITHDRAWAL', label: 'Withdrawals' },
];

const STATUS_OPTIONS: { value: InvestmentHistoryStatusFilter; label: string }[] = [
  { value: 'ALL', label: 'All Statuses' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'COMPLETED', label: 'Completed / Approved' },
  { value: 'PENDING', label: 'Pending / Review' },
  { value: 'REJECTED', label: 'Rejected / Failed' },
];

const INITIAL_VISIBLE_ROWS = 8;

function getCategoryIcon(category: InvestmentEntryCategory) {
  switch (category) {
    case 'PLAN':
      return Layers;
    case 'DEPOSIT':
      return ArrowDownLeft;
    case 'REWARD':
      return Sparkles;
    case 'WITHDRAWAL':
      return ArrowUpRight;
    case 'ADJUSTMENT':
    default:
      return Wallet;
  }
}

function getStatusVisual(bucket: InvestmentStatusBucket): {
  textClass: string;
  Icon: typeof CheckCircle2;
} {
  switch (bucket) {
    case 'COMPLETED':
      return { textClass: 'text-emerald-700', Icon: CheckCircle2 };
    case 'ACTIVE':
      return { textClass: 'text-[#0B1A30]', Icon: Layers };
    case 'PENDING':
      return { textClass: 'text-amber-700', Icon: Clock };
    case 'REJECTED':
      return { textClass: 'text-red-700', Icon: XCircle };
  }
}

export function InvestmentHistory({
  uid,
  highContrast = false,
}: InvestmentHistoryProps) {
  const [plans, setPlans] = useState<UserPlan[]>([]);
  const [transactions, setTransactions] = useState<CoinTransaction[]>([]);
  const [deposits, setDeposits] = useState<DepositRequest[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);

  const [plansLoaded, setPlansLoaded] = useState(false);
  const [txLoaded, setTxLoaded] = useState(false);
  const [depositsLoaded, setDepositsLoaded] = useState(false);
  const [withdrawalsLoaded, setWithdrawalsLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryCounter, setRetryCounter] = useState(0);

  const [categoryFilter, setCategoryFilter] =
    useState<InvestmentHistoryCategoryFilter>('ALL');
  const [statusFilter, setStatusFilter] =
    useState<InvestmentHistoryStatusFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (!uid) return;
    setPlansLoaded(false);
    setTxLoaded(false);
    setDepositsLoaded(false);
    setWithdrawalsLoaded(false);
    setLoadError(null);

    const unsubPlans = subscribeUserPlans(
      uid,
      (items) => {
        setPlans(items);
        setPlansLoaded(true);
      },
      (msg) => {
        setLoadError((prev) => prev || msg);
        setPlansLoaded(true);
      }
    );

    const unsubTx = subscribeUserTransactions(
      uid,
      (items) => {
        setTransactions(items);
        setTxLoaded(true);
      },
      (msg) => {
        setLoadError((prev) => prev || msg);
        setTxLoaded(true);
      }
    );

    const unsubDeposits = subscribeUserDeposits(
      uid,
      (items) => {
        setDeposits(items);
        setDepositsLoaded(true);
      },
      (msg) => {
        setLoadError((prev) => prev || msg);
        setDepositsLoaded(true);
      }
    );

    const unsubWithdrawals = subscribeUserWithdrawals(
      uid,
      (items) => {
        setWithdrawals(items);
        setWithdrawalsLoaded(true);
      },
      (msg) => {
        setLoadError((prev) => prev || msg);
        setWithdrawalsLoaded(true);
      }
    );

    return () => {
      unsubPlans();
      unsubTx();
      unsubDeposits();
      unsubWithdrawals();
    };
  }, [uid, retryCounter]);

  const loading = !(plansLoaded && txLoaded && depositsLoaded && withdrawalsLoaded);

  const allEntries = useMemo(
    () =>
      buildInvestmentHistoryEntries({
        plans,
        transactions,
        deposits,
        withdrawals,
      }),
    [plans, transactions, deposits, withdrawals]
  );

  const summary = useMemo(
    () => computeInvestmentHistorySummary(allEntries),
    [allEntries]
  );

  const filteredEntries = useMemo(
    () =>
      filterInvestmentHistoryEntries(
        allEntries,
        categoryFilter,
        statusFilter,
        searchQuery
      ),
    [allEntries, categoryFilter, statusFilter, searchQuery]
  );

  const visibleEntries = showAll
    ? filteredEntries
    : filteredEntries.slice(0, INITIAL_VISIBLE_ROWS);

  const hasActiveFilter =
    categoryFilter !== 'ALL' ||
    statusFilter !== 'ALL' ||
    searchQuery.trim().length > 0;

  const handleExportCsv = () => {
    if (filteredEntries.length === 0) return;
    const csvContent = investmentHistoryToCsv(filteredEntries);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.setAttribute('download', `nexora-investment-history-${dateStamp}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <section
      id="investment-history"
      aria-labelledby="investment-history-heading"
      className={`bg-white rounded-xl overflow-hidden ${
        highContrast ? 'border-2 border-slate-900' : 'border border-slate-200'
      }`}
    >
      {/* Header & Controls */}
      <div className="p-5 sm:p-6 border-b border-slate-200 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="space-y-1">
            <h2
              id="investment-history-heading"
              className="font-display text-lg font-bold text-[#0B1A30] flex items-center gap-2"
            >
              <Briefcase className="h-4 w-4 text-[#A37B22]" aria-hidden="true" />
              <span>Investment History</span>
            </h2>
            <p className="text-xs text-slate-500">
              Live Firestore record of past plan investments, deposits, rewards, and payouts
              <span aria-hidden="true"> · </span>
              <span className="font-mono tabular-nums">
                {loading
                  ? 'Loading...'
                  : `${filteredEntries.length} ${
                      filteredEntries.length === 1 ? 'record' : 'records'
                    }`}
              </span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <label htmlFor="inv-status-select" className="sr-only">
              Filter investment history by status
            </label>
            <select
              id="inv-status-select"
              aria-label="Filter investment history by status"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as InvestmentHistoryStatusFilter);
                setShowAll(false);
              }}
              className="px-3 py-2 text-xs font-semibold text-[#0B1A30] bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:bg-white focus:border-[#0B1A30] cursor-pointer"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>

            <div className="relative w-full sm:w-56">
              <Search
                className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setShowAll(false);
                }}
                placeholder="Search plan, UTR, or ref"
                aria-label="Search investment history by plan, UTR, or reference ID"
                className="w-full pl-8 pr-3 py-2 text-xs text-slate-800 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:bg-white focus:border-[#0B1A30]"
              />
            </div>

            <button
              type="button"
              onClick={handleExportCsv}
              disabled={loading || filteredEntries.length === 0}
              aria-label="Export investment history as CSV"
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#0B1A30] bg-white border border-slate-300 hover:border-[#0B1A30] hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg whitespace-nowrap cursor-pointer"
            >
              <Download className="h-3.5 w-3.5 text-[#A37B22]" aria-hidden="true" />
              <span>Export CSV</span>
            </button>
          </div>
        </div>

        {/* Summary KPI Bar */}
        {!loading && !loadError && (
          <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-slate-200 border border-slate-200 rounded-lg bg-slate-50/70">
            <div className="p-3.5 space-y-0.5">
              <p className="text-[11px] font-medium text-slate-500">
                Total Plan Capital
              </p>
              <p className="font-mono text-base font-bold text-[#0B1A30] tabular-nums">
                {formatCoins(summary.totalPlanInvestedCoins)}
              </p>
            </div>
            <div className="p-3.5 space-y-0.5">
              <p className="text-[11px] font-medium text-slate-500">
                Approved Deposits
              </p>
              <p className="font-mono text-base font-bold text-emerald-700 tabular-nums">
                {formatInr(summary.totalDepositedInr)}
              </p>
            </div>
            <div className="p-3.5 space-y-0.5">
              <p className="text-[11px] font-medium text-slate-500">
                Rewards Credited
              </p>
              <p className="font-mono text-base font-bold text-[#A37B22] tabular-nums">
                {formatCoins(summary.totalRewardsCoins)}
              </p>
            </div>
            <div className="p-3.5 space-y-0.5">
              <p className="text-[11px] font-medium text-slate-500">
                Active Plan Cycles
              </p>
              <p className="font-mono text-base font-bold text-[#0B1A30] tabular-nums">
                {summary.activePlansCount}
              </p>
            </div>
          </div>
        )}

        {/* Category Filter Tabs */}
        <div
          role="tablist"
          aria-label="Filter investment history by category"
          className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto"
        >
          {CATEGORY_TABS.map((tab) => {
            const active = categoryFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setCategoryFilter(tab.id);
                  setShowAll(false);
                }}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-white text-[#0B1A30] shadow-xs'
                    : 'text-slate-600 hover:text-[#0B1A30]'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Loading Skeleton */}
      {loading && (
        <div
          className="p-5 sm:p-6 space-y-3"
          aria-busy="true"
          aria-label="Loading investment history from Firestore"
        >
          {[0, 1, 2, 3].map((row) => (
            <div
              key={row}
              className="grid grid-cols-12 gap-4 items-center py-2.5 border-b border-slate-100 last:border-b-0 animate-pulse"
            >
              <div className="col-span-3 h-3.5 bg-slate-200 rounded" />
              <div className="col-span-5 h-3.5 bg-slate-200 rounded" />
              <div className="col-span-2 h-3.5 bg-slate-200 rounded" />
              <div className="col-span-2 h-3.5 bg-slate-200 rounded" />
            </div>
          ))}
        </div>
      )}

      {/* Error State */}
      {!loading && loadError && allEntries.length === 0 && (
        <div
          role="alert"
          className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-red-50/70"
        >
          <div className="flex items-start gap-2.5 text-sm text-red-800">
            <AlertCircle
              className="h-4 w-4 text-red-700 shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <span>{loadError}</span>
          </div>
          <button
            type="button"
            onClick={() => setRetryCounter((c) => c + 1)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#0B1A30] bg-white border border-slate-300 hover:bg-slate-50 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Retry</span>
          </button>
        </div>
      )}

      {/* Empty State */}
      {!loading && !(loadError && allEntries.length === 0) && filteredEntries.length === 0 && (
        <div className="p-8 sm:p-10 text-center space-y-3">
          <div className="mx-auto w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-[#0B1A30]">
            <Briefcase className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="space-y-1 max-w-md mx-auto">
            <p className="text-sm font-semibold text-[#0B1A30]">
              {hasActiveFilter
                ? 'No matching investment records found'
                : 'No investment transactions recorded yet'}
            </p>
            <p className="text-xs text-slate-500 leading-relaxed">
              {hasActiveFilter
                ? 'Adjust your category, status filter, or search term to view other past records.'
                : 'Your past plan enrollments, UPI coin deposits, daily reward credits, and withdrawal requests from Firestore will appear here with date, amount, and status.'}
            </p>
          </div>
          {hasActiveFilter ? (
            <button
              type="button"
              onClick={() => {
                setCategoryFilter('ALL');
                setStatusFilter('ALL');
                setSearchQuery('');
              }}
              className="inline-flex items-center justify-center px-4 py-2 text-xs font-semibold text-[#0B1A30] border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer"
            >
              Reset Filters
            </button>
          ) : (
            <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
              <a
                href="#add-coins-gateway"
                className="inline-flex items-center justify-center px-4 py-2 text-xs font-bold text-[#0B1A30] bg-[#C59B3B] hover:bg-[#D8B45A] rounded-lg transition-colors"
              >
                Add Coins via UPI
              </a>
              <Link
                to={ROUTES.HOME}
                className="inline-flex items-center justify-center px-4 py-2 text-xs font-semibold text-[#0B1A30] border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors"
              >
                Explore Product Plans
              </Link>
            </div>
          )}
        </div>
      )}

      {/* Populated Investment History Table */}
      {!loading && filteredEntries.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th scope="col" className="py-3 px-4 sm:px-5 whitespace-nowrap">
                    Date
                  </th>
                  <th scope="col" className="py-3 px-4">
                    Investment / Transaction
                  </th>
                  <th scope="col" className="py-3 px-4 text-right whitespace-nowrap">
                    Amount
                  </th>
                  <th scope="col" className="py-3 px-4 sm:px-5 whitespace-nowrap">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {visibleEntries.map((entry) => {
                  const CategoryIcon = getCategoryIcon(entry.category);
                  const statusVisual = getStatusVisual(entry.statusBucket);
                  const StatusIcon = statusVisual.Icon;

                  return (
                    <tr
                      key={entry.id}
                      className="hover:bg-slate-50/80 transition-colors"
                    >
                      <td className="py-3 px-4 sm:px-5 text-xs text-slate-600 font-mono tabular-nums whitespace-nowrap align-top">
                        {formatDateTimeInr(entry.dateIso)}
                      </td>
                      <td className="py-3 px-4 max-w-sm align-top">
                        <div className="flex items-start gap-2">
                          <CategoryIcon
                            className="h-3.5 w-3.5 text-[#A37B22] shrink-0 mt-0.5"
                            aria-hidden="true"
                          />
                          <div className="min-w-0 space-y-0.5">
                            <p className="text-xs font-semibold text-[#0B1A30] truncate">
                              {entry.title}
                            </p>
                            <p className="text-xs text-slate-600 truncate">
                              {entry.subtitle}
                            </p>
                            <p className="text-[11px] text-slate-400 font-mono tabular-nums truncate">
                              Ref: {entry.referenceId}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right align-top whitespace-nowrap">
                        <p
                          className={`font-mono text-xs font-bold tabular-nums ${
                            entry.isCredit ? 'text-emerald-700' : 'text-[#0B1A30]'
                          }`}
                        >
                          {entry.amountDisplay}
                        </p>
                        {entry.secondaryAmountDisplay && (
                          <p className="text-[11px] text-slate-500 font-mono tabular-nums">
                            {entry.secondaryAmountDisplay}
                          </p>
                        )}
                      </td>
                      <td className="py-3 px-4 sm:px-5 whitespace-nowrap align-top">
                        <span
                          className={`inline-flex items-center gap-1.5 text-xs font-semibold ${statusVisual.textClass}`}
                        >
                          <StatusIcon
                            className="h-3.5 w-3.5 shrink-0"
                            aria-hidden="true"
                          />
                          <span>{entry.statusLabel}</span>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {filteredEntries.length > INITIAL_VISIBLE_ROWS && (
            <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-600">
              <span className="font-mono tabular-nums">
                Showing {visibleEntries.length} of {filteredEntries.length} records
              </span>
              <button
                type="button"
                onClick={() => setShowAll((prev) => !prev)}
                className="font-semibold text-[#0B1A30] hover:text-[#A37B22] cursor-pointer whitespace-nowrap"
              >
                {showAll
                  ? `Show recent ${INITIAL_VISIBLE_ROWS}`
                  : `Show all (${filteredEntries.length})`}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
