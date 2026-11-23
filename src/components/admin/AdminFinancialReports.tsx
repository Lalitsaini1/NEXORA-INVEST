import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BarChart3, Download, Search, TrendingUp } from 'lucide-react';
import {
  subscribeAllDeposits,
  subscribeAllTransactions,
  subscribeAllWithdrawals,
} from '../../services/adminService';
import { CoinTransaction, DepositRequest, WithdrawalRequest } from '../../types/domain';
import {
  aggregateDepositWithdrawalTrends30d,
  formatCoins,
  formatDateTimeInr,
  formatSignedCoins,
  transactionsToCsv,
} from '../../utils/formatters';

export function AdminFinancialReports() {
  const [transactions, setTransactions] = useState<CoinTransaction[]>([]);
  const [deposits, setDeposits] = useState<DepositRequest[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [chartMode, setChartMode] = useState<'AREA' | 'BAR'>('AREA');
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');

  useEffect(() => {
    setLoading(true);
    const unsubTx = subscribeAllTransactions(
      (items) => {
        setTransactions(items);
        setLoading(false);
        setErrorMsg(null);
      },
      (msg) => {
        setErrorMsg(msg);
        setLoading(false);
      }
    );
    const unsubDep = subscribeAllDeposits(
      (items) => setDeposits(items),
      () => {}
    );
    const unsubWd = subscribeAllWithdrawals(
      (items) => setWithdrawals(items),
      () => {}
    );
    return () => {
      unsubTx();
      unsubDep();
      unsubWd();
    };
  }, []);

  const trend30d = useMemo(
    () =>
      aggregateDepositWithdrawalTrends30d(
        transactions,
        deposits,
        withdrawals,
        30
      ),
    [transactions, deposits, withdrawals]
  );

  const summary = useMemo(() => {
    let rewardVolume = 0;
    let planVolume = 0;

    for (const tx of transactions) {
      const amt = Math.abs(tx.amount);
      if (tx.status === 'COMPLETED' || tx.status === 'PENDING') {
        if (tx.type === 'DAILY_REWARD') rewardVolume += amt;
        if (tx.type === 'PLAN_INVESTMENT') planVolume += amt;
      }
    }

    return {
      rewardVolume,
      planVolume,
    };
  }, [transactions]);

  const filteredTx = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return transactions.filter((tx) => {
      if (typeFilter !== 'ALL' && tx.type !== typeFilter) return false;
      if (!q) return true;
      return (
        tx.userId.toLowerCase().includes(q) ||
        tx.description.toLowerCase().includes(q) ||
        tx.referenceId.toLowerCase().includes(q) ||
        tx.transactionId.toLowerCase().includes(q)
      );
    });
  }, [transactions, typeFilter, searchQuery]);

  const handleExportCsv = () => {
    if (filteredTx.length === 0) return;
    const csv = transactionsToCsv(filteredTx);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.setAttribute('download', `nexora-admin-ledger-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* 30-Day Aggregated Volume Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
          <p className="text-xs text-slate-500">30-Day Total Deposits</p>
          <p className="font-mono text-2xl font-bold text-emerald-700 tabular-nums">
            {formatCoins(trend30d.totalDeposits30d)}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
          <p className="text-xs text-slate-500">30-Day Total Withdrawals</p>
          <p className="font-mono text-2xl font-bold text-[#0B1A30] tabular-nums">
            {formatCoins(trend30d.totalWithdrawals30d)}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
          <p className="text-xs text-slate-500">30-Day Net Deposit Flow</p>
          <p
            className={`font-mono text-2xl font-bold tabular-nums ${
              trend30d.netFlow30d >= 0 ? 'text-emerald-700' : 'text-red-700'
            }`}
          >
            {formatSignedCoins(trend30d.netFlow30d)}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
          <p className="text-xs text-slate-500">Daily Rewards Credited</p>
          <p className="font-mono text-2xl font-bold text-[#A37B22] tabular-nums">
            {formatCoins(summary.rewardVolume)}
          </p>
        </div>
      </div>

      {/* Recharts 30-Day Deposit vs Withdrawal Trends Chart */}
      <section
        aria-labelledby="financial-reports-chart-heading"
        className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2
              id="financial-reports-chart-heading"
              className="font-display text-lg font-bold text-[#0B1A30] flex items-center gap-2"
            >
              <TrendingUp className="h-4 w-4 text-[#A37B22]" aria-hidden="true" />
              <span>30-Day Deposit vs. Withdrawal Trends</span>
            </h2>
            <p className="text-xs text-slate-500">
              Continuous 30-day volume aggregated from Firestore{' '}
              <span className="font-mono">coinTransactions</span>,{' '}
              <span className="font-mono">depositRequests</span>, and{' '}
              <span className="font-mono">withdrawalRequests</span>.
            </p>
          </div>

          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start">
            <button
              type="button"
              onClick={() => setChartMode('AREA')}
              className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-md cursor-pointer ${
                chartMode === 'AREA'
                  ? 'bg-white text-[#0B1A30] shadow-xs'
                  : 'text-slate-600 hover:text-[#0B1A30]'
              }`}
            >
              <TrendingUp className="h-3.5 w-3.5 text-[#A37B22]" aria-hidden="true" />
              <span>Trend Area</span>
            </button>
            <button
              type="button"
              onClick={() => setChartMode('BAR')}
              className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-md cursor-pointer ${
                chartMode === 'BAR'
                  ? 'bg-white text-[#0B1A30] shadow-xs'
                  : 'text-slate-600 hover:text-[#0B1A30]'
              }`}
            >
              <BarChart3 className="h-3.5 w-3.5 text-[#A37B22]" aria-hidden="true" />
              <span>Daily Bars</span>
            </button>
          </div>
        </div>

        {loading ? (
          <div className="h-72 flex items-center justify-center text-xs text-slate-500">
            Aggregating 30-day Firestore financial data...
          </div>
        ) : (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              {chartMode === 'AREA' ? (
                <AreaChart data={trend30d.points}>
                  <defs>
                    <linearGradient id="nexoraDepGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0B1A30" stopOpacity={0.28} />
                      <stop offset="95%" stopColor="#0B1A30" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="nexoraWdGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#C59B3B" stopOpacity={0.32} />
                      <stop offset="95%" stopColor="#C59B3B" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis
                    dataKey="shortLabel"
                    minTickGap={16}
                    tick={{ fontSize: 11, fill: '#475569' }}
                  />
                  <YAxis tick={{ fontSize: 11, fill: '#475569' }} />
                  <Tooltip
                    labelFormatter={(_, payload) =>
                      payload?.[0]?.payload?.fullLabel || ''
                    }
                  />
                  <Legend />
                  <Area
                    type="monotone"
                    dataKey="deposits"
                    name="Deposits (Coins / INR)"
                    stroke="#0B1A30"
                    strokeWidth={2}
                    fill="url(#nexoraDepGrad)"
                  />
                  <Area
                    type="monotone"
                    dataKey="withdrawals"
                    name="Withdrawals (Coins / INR)"
                    stroke="#C59B3B"
                    strokeWidth={2}
                    fill="url(#nexoraWdGrad)"
                  />
                </AreaChart>
              ) : (
                <BarChart data={trend30d.points}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis
                    dataKey="shortLabel"
                    minTickGap={16}
                    tick={{ fontSize: 11, fill: '#475569' }}
                  />
                  <YAxis tick={{ fontSize: 11, fill: '#475569' }} />
                  <Tooltip
                    labelFormatter={(_, payload) =>
                      payload?.[0]?.payload?.fullLabel || ''
                    }
                  />
                  <Legend />
                  <Bar
                    dataKey="deposits"
                    name="Deposits (Coins / INR)"
                    fill="#0B1A30"
                    radius={[3, 3, 0, 0]}
                  />
                  <Bar
                    dataKey="withdrawals"
                    name="Withdrawals (Coins / INR)"
                    fill="#C59B3B"
                    radius={[3, 3, 0, 0]}
                  />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* Complete Platform Transaction History */}
      <section
        aria-labelledby="admin-tx-ledger-heading"
        className="bg-white border border-slate-200 rounded-xl overflow-hidden"
      >
        <div className="p-5 sm:p-6 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h3
              id="admin-tx-ledger-heading"
              className="font-display text-base font-bold text-[#0B1A30]"
            >
              Complete Platform Transaction History
            </h3>
            <p className="text-xs text-slate-500">
              {filteredTx.length} ledger entries · {formatCoins(summary.planVolume)} allocated to
              plans
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <select
              aria-label="Filter transactions by type"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-3 py-2 text-xs font-semibold text-[#0B1A30] bg-slate-50 border border-slate-300 rounded-lg cursor-pointer"
            >
              <option value="ALL">All Types</option>
              <option value="COIN_PURCHASE">Coin Deposits</option>
              <option value="WITHDRAWAL_REQUEST">Withdrawals</option>
              <option value="WITHDRAWAL_REFUND">Withdrawal Refunds</option>
              <option value="DAILY_REWARD">Daily Rewards</option>
              <option value="PLAN_INVESTMENT">Plan Allocations</option>
              <option value="ADMIN_ADJUSTMENT">Admin Adjustments</option>
            </select>

            <div className="relative w-full sm:w-52">
              <Search
                className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search NX ID or ref"
                className="w-full pl-8 pr-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg"
              />
            </div>

            <button
              type="button"
              onClick={handleExportCsv}
              disabled={filteredTx.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#0B1A30] bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 rounded-lg cursor-pointer"
            >
              <Download className="h-3.5 w-3.5 text-[#A37B22]" aria-hidden="true" />
              <span>Export CSV</span>
            </button>
          </div>
        </div>

        {errorMsg ? (
          <div role="alert" className="p-5 text-xs text-red-700 bg-red-50">
            {errorMsg}
          </div>
        ) : filteredTx.length === 0 ? (
          <div className="p-6 text-xs text-slate-500">No platform transactions recorded yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th scope="col" className="py-3 px-5 whitespace-nowrap">
                    Timestamp
                  </th>
                  <th scope="col" className="py-3 px-4 whitespace-nowrap">
                    NX User ID
                  </th>
                  <th scope="col" className="py-3 px-4 whitespace-nowrap">
                    Type
                  </th>
                  <th scope="col" className="py-3 px-4">
                    Description &amp; Ref
                  </th>
                  <th scope="col" className="py-3 px-4 whitespace-nowrap">
                    Status
                  </th>
                  <th scope="col" className="py-3 px-5 text-right whitespace-nowrap">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredTx.slice(0, 50).map((tx) => (
                  <tr key={tx.transactionId} className="hover:bg-slate-50/70">
                    <td className="py-2.5 px-5 font-mono text-slate-600 whitespace-nowrap">
                      {formatDateTimeInr(tx.createdAt)}
                    </td>
                    <td className="py-2.5 px-4 font-mono font-semibold text-[#0B1A30] whitespace-nowrap">
                      {tx.userId}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-[11px] text-slate-700 whitespace-nowrap">
                      {tx.type}
                    </td>
                    <td className="py-2.5 px-4 max-w-xs truncate text-slate-700">
                      {tx.description} ({tx.referenceId})
                    </td>
                    <td className="py-2.5 px-4 font-semibold text-slate-700 whitespace-nowrap">
                      {tx.status}
                    </td>
                    <td className="py-2.5 px-5 text-right font-mono font-bold text-[#0B1A30] whitespace-nowrap">
                      {formatSignedCoins(tx.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
