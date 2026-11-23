import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ClipboardList, Crown, Search, ShieldCheck } from 'lucide-react';
import { subscribeAdminActivityLogs } from '../../services/adminService';
import { AdminActionType, AdminActivityLogEntry } from '../../types/domain';
import { formatDateTimeInr } from '../../utils/formatters';

const ACTION_FILTERS: { value: 'ALL' | AdminActionType; label: string }[] = [
  { value: 'ALL', label: 'All Admin Actions' },
  { value: 'USER_PROMOTED_TO_ADMIN', label: 'User Promoted to Admin' },
  { value: 'ADMIN_REVOKED', label: 'Admin Revoked' },
  { value: 'ADMIN_CREATED', label: 'Admin Created' },
  { value: 'USER_STATUS_UPDATED', label: 'User Status Updated' },
  { value: 'WALLET_ADJUSTED', label: 'Wallet Adjusted' },
  { value: 'UPI_ACCOUNT_UPDATED', label: 'UPI Account Updated' },
  { value: 'DEPOSIT_REVIEWED', label: 'Deposit Reviewed' },
  { value: 'WITHDRAWAL_REVIEWED', label: 'Withdrawal Reviewed' },
  { value: 'PRODUCT_PLAN_UPDATED', label: 'Product Plan Updated' },
  { value: 'COIN_PACKAGE_UPDATED', label: 'Coin Package Updated' },
  { value: 'PLATFORM_SETTINGS_UPDATED', label: 'Platform Settings Updated' },
  { value: 'PAYMENT_WEBHOOK_VERIFIED', label: 'Payment Webhook Verified' },
];

const PAGE_SIZE = 10;

export function SystemEventsLog() {
  const [logs, setLogs] = useState<AdminActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState<'ALL' | AdminActionType>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    setLoading(true);
    const unsub = subscribeAdminActivityLogs(
      (items) => {
        setLogs(items);
        setLoading(false);
        setErrorMsg(null);
      },
      (msg) => {
        setErrorMsg(msg);
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  const filteredLogs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return logs.filter((entry) => {
      if (actionFilter !== 'ALL' && entry.actionType !== actionFilter) return false;
      if (!q) return true;
      return (
        entry.actorEmail.toLowerCase().includes(q) ||
        entry.targetId.toLowerCase().includes(q) ||
        entry.summary.toLowerCase().includes(q) ||
        entry.actionType.toLowerCase().includes(q)
      );
    });
  }, [logs, actionFilter, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginatedLogs = filteredLogs.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE
  );

  return (
    <section
      aria-labelledby="system-events-log-heading"
      className="bg-white border border-slate-200 rounded-xl overflow-hidden"
    >
      <div className="p-5 sm:p-6 border-b border-slate-200 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="space-y-1">
            <h2
              id="system-events-log-heading"
              className="font-display text-lg font-bold text-[#0B1A30] flex items-center gap-2"
            >
              <ClipboardList className="h-4 w-4 text-[#A37B22]" aria-hidden="true" />
              <span>Admin Activity &amp; System Events Audit Log</span>
            </h2>
            <p className="text-xs text-slate-500">
              Append-only compliance ledger capturing promotions, revocations, plan edits, UPI
              updates, and wallet adjustments.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
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
                  setPage(1);
                }}
                placeholder="Search actor, target, summary"
                className="w-full pl-8 pr-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:bg-white focus:border-[#0B1A30]"
              />
            </div>

            <select
              aria-label="Filter admin logs by action type"
              value={actionFilter}
              onChange={(e) => {
                setActionFilter(e.target.value as 'ALL' | AdminActionType);
                setPage(1);
              }}
              className="px-3 py-2 text-xs font-semibold text-[#0B1A30] bg-slate-50 border border-slate-300 rounded-lg cursor-pointer"
            >
              {ACTION_FILTERS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="p-6 text-xs text-slate-500">Loading audit logs...</div>
      ) : errorMsg ? (
        <div role="alert" className="p-5 text-xs text-red-700 bg-red-50">
          {errorMsg}
        </div>
      ) : filteredLogs.length === 0 ? (
        <div className="p-6 text-xs text-slate-500">
          No administrative audit entries recorded for this filter yet.
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[740px] border-collapse text-left">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th scope="col" className="py-3 px-5 whitespace-nowrap">
                    Timestamp
                  </th>
                  <th scope="col" className="py-3 px-4 whitespace-nowrap">
                    Actor &amp; Tier
                  </th>
                  <th scope="col" className="py-3 px-4 whitespace-nowrap">
                    Action Type
                  </th>
                  <th scope="col" className="py-3 px-4 whitespace-nowrap">
                    Target ID
                  </th>
                  <th scope="col" className="py-3 px-5">
                    Summary
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {paginatedLogs.map((entry) => (
                  <tr key={entry.logId} className="hover:bg-slate-50/70">
                    <td className="py-3 px-5 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                      {formatDateTimeInr(entry.createdAt)}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        {entry.actorRole === 'SUPER_ADMIN' ? (
                          <Crown className="h-3.5 w-3.5 text-[#A37B22]" aria-hidden="true" />
                        ) : (
                          <ShieldCheck className="h-3.5 w-3.5 text-[#0B1A30]" aria-hidden="true" />
                        )}
                        <span className="font-medium text-[#0B1A30]">{entry.actorEmail}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] font-semibold text-slate-700 whitespace-nowrap">
                      {entry.actionType}
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] text-slate-500 whitespace-nowrap max-w-[140px] truncate">
                      {entry.targetId}
                    </td>
                    <td className="py-3 px-5 text-slate-700">{entry.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
            <span className="font-mono tabular-nums">
              Page {safePage} of {totalPages} · {filteredLogs.length} events
            </span>
            <div className="inline-flex items-center gap-2">
              <button
                type="button"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 disabled:opacity-50 rounded-md font-semibold cursor-pointer"
              >
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Prev</span>
              </button>
              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 disabled:opacity-50 rounded-md font-semibold cursor-pointer"
              >
                <span>Next</span>
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

export const AdminActivityLog = SystemEventsLog;
