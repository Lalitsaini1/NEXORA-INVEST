import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, LineChart as LineChartIcon, RefreshCw } from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { subscribeUserTransactions } from '../../services/transactionService';
import { CoinTransaction } from '../../types/domain';
import {
  CoinBalancePoint,
  buildCoinBalanceGrowthSeries,
  formatCoins,
  formatSignedCoins,
} from '../../utils/formatters';

interface CoinBalanceGrowthChartProps {
  uid: string;
  currentCoins: number;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: CoinBalancePoint }>;
}

function CustomBalanceTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const point = payload[0].payload;
  const deltaTone =
    point.netDelta > 0
      ? 'text-emerald-700'
      : point.netDelta < 0
      ? 'text-red-700'
      : 'text-slate-500';

  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-md px-3.5 py-2.5 text-xs space-y-1">
      <p className="font-semibold text-[#0B1A30]">{point.fullLabel}</p>
      <p className="font-mono tabular-nums text-[#0B1A30]">
        Balance: <strong>{formatCoins(point.balance)}</strong>
      </p>
      <p className={`font-mono tabular-nums ${deltaTone}`}>
        Day Net: {formatSignedCoins(point.netDelta)}
        {point.txCount > 0 ? ` (${point.txCount} tx)` : ''}
      </p>
    </div>
  );
}

export function CoinBalanceGrowthChart({
  uid,
  currentCoins,
}: CoinBalanceGrowthChartProps) {
  const [transactions, setTransactions] = useState<CoinTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
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
      },
      (msg) => {
        setLoadError(msg);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [uid, retryCounter]);

  const series = useMemo(
    () => buildCoinBalanceGrowthSeries(currentCoins, transactions, 30),
    [currentCoins, transactions]
  );

  const growthSign =
    series.netGrowthCoins > 0 ? 'text-emerald-700' : series.netGrowthCoins < 0 ? 'text-red-700' : 'text-[#0B1A30]';

  return (
    <section
      aria-labelledby="coin-balance-growth-heading"
      className="bg-white border border-slate-200 rounded-xl overflow-hidden"
    >
      <div className="p-5 sm:p-6 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-1">
          <h2
            id="coin-balance-growth-heading"
            className="font-display text-lg font-bold text-[#0B1A30] flex items-center gap-2"
          >
            <LineChartIcon className="h-4 w-4 text-[#A37B22]" aria-hidden="true" />
            <span>30-Day Coin Balance Growth</span>
          </h2>
          <p className="text-xs text-slate-500">
            Daily end-of-day wallet coin trajectory reconstructed from verified Firestore ledger
            activity over the past 30 days.
          </p>
        </div>
        <span className="text-xs font-mono tabular-nums font-semibold text-[#0B1A30] bg-slate-100 px-3 py-1.5 rounded-lg self-start sm:self-auto">
          Last 30 Days (UTC)
        </span>
      </div>

      {loading && (
        <div className="p-5 sm:p-6 space-y-5 animate-pulse" aria-busy="true">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="h-14 bg-slate-100 rounded-lg" />
            <div className="h-14 bg-slate-100 rounded-lg" />
            <div className="h-14 bg-slate-100 rounded-lg" />
          </div>
          <div className="h-[260px] bg-slate-100 rounded-lg" />
        </div>
      )}

      {!loading && loadError && (
        <div
          role="alert"
          className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-red-50/70"
        >
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

      {!loading && !loadError && (
        <div className="p-5 sm:p-6 space-y-5">
          {/* 3-Column Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 border border-slate-200 rounded-lg bg-slate-50/70">
            <div className="p-4 space-y-1">
              <p className="text-xs text-slate-500">Current Balance</p>
              <p className="font-mono text-xl font-bold text-[#0B1A30] tabular-nums">
                {formatCoins(series.currentBalance)}
              </p>
            </div>
            <div className="p-4 space-y-1">
              <p className="text-xs text-slate-500">30-Day Net Change</p>
              <p className={`font-mono text-xl font-bold tabular-nums ${growthSign}`}>
                {formatSignedCoins(series.netGrowthCoins)}
                {series.netGrowthPercent !== null && (
                  <span className="text-xs font-semibold ml-1.5">
                    ({series.netGrowthPercent > 0 ? '+' : ''}
                    {series.netGrowthPercent}%)
                  </span>
                )}
              </p>
            </div>
            <div className="p-4 space-y-1">
              <p className="text-xs text-slate-500">30-Day Peak Balance</p>
              <p className="font-mono text-xl font-bold text-[#A37B22] tabular-nums">
                {formatCoins(series.peakBalance)}
              </p>
            </div>
          </div>

          {/* Recharts Line Chart */}
          <div className="p-4 bg-slate-50/70 border border-slate-200 rounded-lg space-y-3">
            <div className="w-full h-[260px]" role="region" aria-label="30-day coin balance growth line chart">
              <ResponsiveContainer width="100%" height={260}>
                <LineChart
                  data={series.points}
                  margin={{ top: 12, right: 16, left: 4, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis
                    dataKey="shortLabel"
                    tick={{ fontSize: 11, fill: '#64748B' }}
                    tickLine={false}
                    axisLine={{ stroke: '#CBD5E1' }}
                    minTickGap={24}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#64748B' }}
                    tickLine={false}
                    axisLine={false}
                    width={52}
                    allowDecimals={false}
                    domain={[0, (dataMax: number) => (dataMax > 0 ? Math.ceil(dataMax * 1.1) : 100)]}
                    tickFormatter={(val: number) =>
                      new Intl.NumberFormat('en-IN', { notation: 'compact' }).format(val)
                    }
                  />
                  <Tooltip content={<CustomBalanceTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="balance"
                    name="Total Coin Balance"
                    stroke="#0B1A30"
                    strokeWidth={2.5}
                    dot={false}
                    activeDot={{
                      r: 5,
                      fill: '#C59B3B',
                      stroke: '#0B1A30',
                      strokeWidth: 2,
                    }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {series.completedTransactionsInWindow === 0 && (
              <p className="text-xs text-slate-500 text-center">
                No completed coin transactions recorded in the past 30 days — displaying your
                verified wallet baseline ({formatCoins(series.currentBalance)}).
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
