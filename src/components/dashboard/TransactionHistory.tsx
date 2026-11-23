import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Download,
  RefreshCw,
  Search,
  Sparkles,
  Wallet,
  XCircle,
} from 'lucide-react';
import { subscribeUserTransactions } from '../../services/transactionService';
import { CoinTransaction, TransactionStatus, TransactionType } from '../../types/domain';
import {
  filterAndSortTransactions,
  formatCoins,
  formatDateTimeInr,
  formatSignedCoins,
  TransactionFilterCategory,
  transactionsToCsv,
} from '../../utils/formatters';

interface TransactionHistoryProps {
  uid: string;
  highContrast?: boolean;
}

const FILTER_TABS: { id: TransactionFilterCategory; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'DEPOSITS', label: 'Deposits' },
  { id: 'REWARDS', label: 'Rewards' },
  { id: 'WITHDRAWALS', label: 'Withdrawals' },
  { id: 'PLANS', label: 'Plan Uses' },
];

const INITIAL_VISIBLE_ROWS = 10;

function getTypeLabel(type: TransactionType): string {
  switch (type) {
    case 'COIN_PURCHASE':
      return 'Coin Deposit';
    case 'DAILY_REWARD':
      return 'Daily Reward';
    case 'WITHDRAWAL_REQUEST':
      return 'Withdrawal';
    case 'WITHDRAWAL_REFUND':
      return 'Withdrawal Refund';
    case 'PLAN_INVESTMENT':
      return 'Plan Allocation';
    case 'ADMIN_ADJUSTMENT':
      return 'Account Adjustment';
  }
}

function getTypeIcon(type: TransactionType) {
  switch (type) {
    case 'COIN_PURCHASE':
    case 'WITHDRAWAL_REFUND':
      return ArrowDownLeft;
    case 'DAILY_REWARD':
      return Sparkles;
    case 'WITHDRAWAL_REQUEST':
    case 'PLAN_INVESTMENT':
      return ArrowUpRight;
    case 'ADMIN_ADJUSTMENT':
      return Wallet;
  }
}

function getStatusDisplay(status: TransactionStatus): {
  label: string;
  textClass: string;
  Icon: typeof CheckCircle2;
} {
  switch (status) {
    case 'COMPLETED':
      return {
        label: 'Completed',
        textClass: 'text-emerald-700',
        Icon: CheckCircle2,
      };
    case 'PENDING':
      return {
        label: 'Pending',
        textClass: 'text-amber-700',
        Icon: Clock,
      };
    case 'REJECTED':
      return {
        label: 'Rejected',
        textClass: 'text-red-700',
        Icon: XCircle,
      };
    case 'FAILED':
      return {
        label: 'Failed',
        textClass: 'text-red-700',
        Icon: AlertCircle,
      };
  }
}

function getSignedAmountDisplay(tx: CoinTransaction): {
  signedValue: number;
  isCredit: boolean;
} {
  const absAmount = Math.abs(tx.amount);
  const isDebit =
    tx.amount < 0 ||
    tx.type === 'WITHDRAWAL_REQUEST' ||
    tx.type === 'PLAN_INVESTMENT';
  return {
    signedValue: isDebit ? -absAmount : absAmount,
    isCredit: !isDebit,
  };
}

export function TransactionHistory({ uid, highContrast = false }: TransactionHistoryProps) {
  const [transactions, setTransactions] = useState<CoinTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [category, setCategory] = useState<TransactionFilterCategory>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [retryCounter, setRetryCounter] = useState(0);

  useEffect(() => {
    if (!uid) return;
    setLoading(true);
    setLoadError(null);

    const unsubscribe = subscribeUserTransactions(
      uid,
      (items) => {
        setTransactions(items);
        setLoading(false);
        setLoadError(null);
      },
      (message) => {
        setLoadError(message);
        setLoading(false);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [uid, retryCounter]);

  const filteredTransactions = useMemo(
    () => filterAndSortTransactions(transactions, category, searchQuery),
    [transactions, category, searchQuery]
  );

  const visibleTransactions = showAll
    ? filteredTransactions
    : filteredTransactions.slice(0, INITIAL_VISIBLE_ROWS);

  const hasActiveFilter = category !== 'ALL' || searchQuery.trim().length > 0;

  const handleExportCsv = () => {
    if (filteredTransactions.length === 0) return;
    const csvContent = transactionsToCsv(filteredTransactions);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.setAttribute('download', `nexora-transactions-${dateStamp}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <section
      aria-labelledby="tx-history-heading"
      className={`bg-white rounded-xl overflow-hidden ${
        highContrast ? 'border-2 border-slate-900' : 'border border-slate-200'
      }`}
    >
      {/* Header & Controls */}
      <div className="p-5 sm:p-6 border-b border-slate-200 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="space-y-1">
            <h2
              id="tx-history-heading"
              className="font-display text-lg font-bold text-[#0B1A30]"
            >
              Recent Coin Transactions
            </h2>
            <p className="text-xs text-slate-500">
              Verified Firestore ledger
              <span aria-hidden="true"> · </span>
              <span className="font-mono tabular-nums">
                {loading
                  ? 'Syncing...'
                  : `${filteredTransactions.length} ${
                      filteredTransactions.length === 1 ? 'entry' : 'entries'
                    }`}
              </span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <label htmlFor="tx-category-select" className="sr-only">
              Filter transactions by category
            </label>
            <select
              id="tx-category-select"
              aria-label="Transaction category filter"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value as TransactionFilterCategory);
                setShowAll(false);
              }}
              className="px-3 py-2 text-xs font-semibold text-[#0B1A30] bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:bg-white focus:border-[#0B1A30] cursor-pointer"
            >
              {FILTER_TABS.map((tab) => (
                <option key={tab.id} value={tab.id}>
                  {tab.label}
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
                placeholder="Search description or ref ID"
                aria-label="Search transactions by description or reference ID"
                className="w-full pl-8 pr-3 py-2 text-xs text-slate-800 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:bg-white focus:border-[#0B1A30]"
              />
            </div>

            <button
              type="button"
              onClick={handleExportCsv}
              disabled={loading || filteredTransactions.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#0B1A30] bg-white border border-slate-300 hover:border-[#0B1A30] hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg whitespace-nowrap cursor-pointer"
            >
              <Download className="h-3.5 w-3.5 text-[#A37B22]" aria-hidden="true" />
              <span>Export CSV</span>
            </button>
          </div>
        </div>

        {/* Segmented Filter Tabs */}
        <div
          role="tablist"
          aria-label="Filter transactions by category tabs"
          className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto"
        >
          {FILTER_TABS.map((tab) => {
            const active = category === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setCategory(tab.id);
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

      {/* Loading Skeleton State */}
      {loading && (
        <div className="p-5 sm:p-6 space-y-3" aria-busy="true" aria-label="Loading transactions">
          {[0, 1, 2, 3].map((row) => (
            <div
              key={row}
              className="grid grid-cols-12 gap-4 items-center py-2.5 border-b border-slate-100 last:border-b-0 animate-pulse"
            >
              <div className="col-span-3 h-3.5 bg-slate-200 rounded" />
              <div className="col-span-2 h-3.5 bg-slate-200 rounded" />
              <div className="col-span-4 h-3.5 bg-slate-200 rounded" />
              <div className="col-span-3 h-3.5 bg-slate-200 rounded" />
            </div>
          ))}
        </div>
      )}

      {/* Error State */}
      {!loading && loadError && (
        <div role="alert" className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-red-50/70">
          <div className="flex items-start gap-2.5 text-sm text-red-800">
            <AlertCircle className="h-4 w-4 text-red-700 shrink-0 mt-0.5" aria-hidden="true" />
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
      {!loading && !loadError && filteredTransactions.length === 0 && (
        <div className="p-8 sm:p-10 text-center space-y-3">
          <div className="mx-auto w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-[#0B1A30]">
            <Wallet className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="space-y-1 max-w-md mx-auto">
            <p className="text-sm font-semibold text-[#0B1A30]">
              {hasActiveFilter ? 'No matching transactions found' : 'No coin transactions yet'}
            </p>
            <p className="text-xs text-slate-500 leading-relaxed">
              {hasActiveFilter
                ? 'Try clearing your active category filter or searching with another reference ID.'
                : 'Verified coin deposits, daily plan rewards, plan allocations, and withdrawal requests will appear in this ledger automatically once recorded.'}
            </p>
          </div>
          {hasActiveFilter && (
            <button
              type="button"
              onClick={() => {
                setCategory('ALL');
                setSearchQuery('');
              }}
              className="inline-flex items-center justify-center px-4 py-2 text-xs font-semibold text-[#0B1A30] border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer"
            >
              Reset Filters
            </button>
          )}
        </div>
      )}

      {/* Populated Tabular Ledger */}
      {!loading && !loadError && filteredTransactions.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] border-collapse text-left">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th scope="col" className="py-3 px-4 sm:px-5 whitespace-nowrap">
                    Date &amp; Time
                  </th>
                  <th scope="col" className="py-3 px-4 whitespace-nowrap">
                    Category
                  </th>
                  <th scope="col" className="py-3 px-4">
                    Details &amp; Reference
                  </th>
                  <th scope="col" className="py-3 px-4 whitespace-nowrap">
                    Status
                  </th>
                  <th scope="col" className="py-3 px-4 text-right whitespace-nowrap">
                    Amount
                  </th>
                  <th scope="col" className="py-3 px-4 sm:px-5 text-right whitespace-nowrap">
                    Balance After
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {visibleTransactions.map((tx) => {
                  const TypeIcon = getTypeIcon(tx.type);
                  const statusMeta = getStatusDisplay(tx.status);
                  const StatusIcon = statusMeta.Icon;
                  const { signedValue, isCredit } = getSignedAmountDisplay(tx);

                  return (
                    <tr
                      key={tx.transactionId}
                      className="hover:bg-slate-50/80 transition-colors"
                    >
                      <td className="py-3 px-4 sm:px-5 text-xs text-slate-600 font-mono tabular-nums whitespace-nowrap">
                        {formatDateTimeInr(tx.createdAt)}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0B1A30]">
                          <TypeIcon
                            className="h-3.5 w-3.5 text-[#A37B22] shrink-0"
                            aria-hidden="true"
                          />
                          <span>{getTypeLabel(tx.type)}</span>
                        </span>
                      </td>
                      <td className="py-3 px-4 max-w-xs">
                        <p className="text-xs font-medium text-slate-800 truncate">
                          {tx.description || getTypeLabel(tx.type)}
                        </p>
                        <p className="text-[11px] text-slate-500 font-mono tabular-nums truncate">
                          Ref: {tx.referenceId || tx.transactionId}
                        </p>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1.5 text-xs font-semibold ${statusMeta.textClass}`}
                        >
                          <StatusIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          <span>{statusMeta.label}</span>
                        </span>
                      </td>
                      <td
                        className={`py-3 px-4 text-right font-mono text-xs font-bold tabular-nums whitespace-nowrap ${
                          isCredit ? 'text-emerald-700' : 'text-[#0B1A30]'
                        }`}
                      >
                        {formatSignedCoins(signedValue)}
                      </td>
                      <td className="py-3 px-4 sm:px-5 text-right font-mono text-xs text-slate-700 tabular-nums whitespace-nowrap">
                        {formatCoins(tx.newBalance)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {filteredTransactions.length > INITIAL_VISIBLE_ROWS && (
            <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-600">
              <span className="font-mono tabular-nums">
                Showing {visibleTransactions.length} of {filteredTransactions.length} transactions
              </span>
              <button
                type="button"
                onClick={() => setShowAll((prev) => !prev)}
                className="font-semibold text-[#0B1A30] hover:text-[#A37B22] cursor-pointer whitespace-nowrap"
              >
                {showAll ? 'Show recent 10' : `Show all (${filteredTransactions.length})`}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
