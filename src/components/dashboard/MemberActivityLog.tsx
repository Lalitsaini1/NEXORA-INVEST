import { useEffect, useMemo, useState } from 'react';
import { History, KeyRound, ShieldCheck, UserCheck } from 'lucide-react';
import { subscribeUserActivityLogs } from '../../services/activityLogService';
import { UserActivityCategory, UserActivityLogEntry } from '../../types/domain';
import { formatDateTimeInr } from '../../utils/formatters';

interface MemberActivityLogProps {
  uid: string;
  highContrast?: boolean;
}

const CATEGORY_OPTIONS: { value: 'ALL' | UserActivityCategory; label: string }[] = [
  { value: 'ALL', label: 'All Security Events' },
  { value: 'LOGIN', label: 'Sign-Ins' },
  { value: 'PROFILE_UPDATE', label: 'Profile Updates' },
  { value: 'PLAN_CHANGE', label: 'Plan Changes' },
  { value: 'SECURITY', label: 'Security & Verification' },
];

function getCategoryMeta(category: UserActivityCategory) {
  switch (category) {
    case 'LOGIN':
      return { label: 'Sign-In', Icon: KeyRound };
    case 'PROFILE_UPDATE':
      return { label: 'Profile', Icon: UserCheck };
    case 'PLAN_CHANGE':
      return { label: 'Plan Change', Icon: History };
    case 'WALLET':
      return { label: 'Wallet', Icon: History };
    case 'SECURITY':
    default:
      return { label: 'Security', Icon: ShieldCheck };
  }
}

export function MemberActivityLog({
  uid,
  highContrast = false,
}: MemberActivityLogProps) {
  const [logs, setLogs] = useState<UserActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | UserActivityCategory>('ALL');

  useEffect(() => {
    if (!uid) return;
    setLoading(true);
    const unsub = subscribeUserActivityLogs(
      uid,
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
  }, [uid]);

  const filteredLogs = useMemo(() => {
    if (categoryFilter === 'ALL') return logs;
    return logs.filter((l) => l.category === categoryFilter);
  }, [logs, categoryFilter]);

  return (
    <section
      aria-labelledby="member-activity-heading"
      className={`bg-white rounded-xl overflow-hidden ${
        highContrast ? 'border-2 border-slate-900' : 'border border-slate-200'
      }`}
    >
      <div className="p-5 sm:p-6 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-1">
          <h2
            id="member-activity-heading"
            className="font-display text-lg font-bold text-[#0B1A30] flex items-center gap-2"
          >
            <History className="h-4 w-4 text-[#A37B22]" aria-hidden="true" />
            <span>Account Activity &amp; Security Log</span>
          </h2>
          <p className="text-xs text-slate-500">
            Immutable audit trail of your logins, verifications, profile changes, and plan actions.
          </p>
        </div>

        <select
          aria-label="Filter account activity by event category"
          value={categoryFilter}
          onChange={(e) =>
            setCategoryFilter(e.target.value as 'ALL' | UserActivityCategory)
          }
          className="px-3 py-2 text-xs font-semibold text-[#0B1A30] bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B1A30] cursor-pointer"
        >
          {CATEGORY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {loading && (
        <div className="p-6 text-xs text-slate-500">Loading security activity log...</div>
      )}

      {!loading && errorMsg && (
        <div role="alert" className="p-5 text-xs text-red-700 bg-red-50">
          {errorMsg}
        </div>
      )}

      {!loading && !errorMsg && filteredLogs.length === 0 && (
        <div className="p-6 text-xs text-slate-500">
          No activity entries recorded for this filter yet.
        </div>
      )}

      {!loading && !errorMsg && filteredLogs.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] border-collapse text-left">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                <th scope="col" className="py-2.5 px-5 whitespace-nowrap">
                  Timestamp
                </th>
                <th scope="col" className="py-2.5 px-4 whitespace-nowrap">
                  Category
                </th>
                <th scope="col" className="py-2.5 px-4 whitespace-nowrap">
                  Event
                </th>
                <th scope="col" className="py-2.5 px-5">
                  Details
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredLogs.slice(0, 12).map((entry) => {
                const meta = getCategoryMeta(entry.category);
                const Icon = meta.Icon;
                return (
                  <tr key={entry.logId} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-5 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                      {formatDateTimeInr(entry.createdAt)}
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5 font-semibold text-[#0B1A30]">
                        <Icon className="h-3.5 w-3.5 text-[#A37B22]" aria-hidden="true" />
                        <span>{meta.label}</span>
                      </span>
                    </td>
                    <td className="py-2.5 px-4 font-semibold text-slate-800 whitespace-nowrap">
                      {entry.action}
                    </td>
                    <td className="py-2.5 px-5 text-slate-600">{entry.details}</td>
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
