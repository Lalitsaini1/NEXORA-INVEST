import { useEffect, useState } from 'react';
import { CheckCircle2, Edit3, Plus, QrCode, Trash2 } from 'lucide-react';
import {
  AdminActorContext,
  deleteUpiAccount,
  saveUpiAccount,
  subscribeAllUpiAccounts,
} from '../../services/adminService';
import { UpiAccount } from '../../types/domain';
import { formatDateTimeInr } from '../../utils/formatters';

interface UpiManagementProps {
  actor: AdminActorContext;
}

export function UpiManagement({ actor }: UpiManagementProps) {
  const [accounts, setAccounts] = useState<UpiAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [upiId, setUpiId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [qrCodeImageUrl, setQrCodeImageUrl] = useState('');
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    setLoading(true);
    const unsub = subscribeAllUpiAccounts(
      (items) => {
        setAccounts(items);
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

  const resetForm = () => {
    setEditingId(undefined);
    setUpiId('');
    setDisplayName('');
    setQrCodeImageUrl('');
    setIsActive(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setNoticeMsg(null);
    setSaving(true);
    try {
      await saveUpiAccount({
        actor,
        accountId: editingId,
        upiId,
        displayName,
        qrCodeImageUrl,
        isActive,
      });
      setNoticeMsg(
        editingId
          ? `Updated UPI endpoint ${upiId.trim()}.`
          : `Added new UPI endpoint ${upiId.trim()}.`
      );
      resetForm();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to save UPI endpoint.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (acc: UpiAccount) => {
    setErrorMsg(null);
    setNoticeMsg(null);
    try {
      await saveUpiAccount({
        actor,
        accountId: acc.accountId,
        upiId: acc.upiId,
        displayName: acc.displayName,
        qrCodeImageUrl: acc.qrCodeImageUrl,
        isActive: !acc.isActive,
      });
      setNoticeMsg(
        `Set ${acc.upiId} status to ${!acc.isActive ? 'ACTIVE' : 'INACTIVE'}.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to toggle UPI status.');
    }
  };

  const handleDelete = async (acc: UpiAccount) => {
    setErrorMsg(null);
    setNoticeMsg(null);
    try {
      await deleteUpiAccount({
        actor,
        accountId: acc.accountId,
        upiId: acc.upiId,
      });
      setNoticeMsg(`Deleted UPI endpoint ${acc.upiId}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to delete UPI endpoint.');
    }
  };

  return (
    <section
      aria-labelledby="upi-management-heading"
      className="bg-white border border-slate-200 rounded-xl overflow-hidden"
    >
      <div className="p-5 sm:p-6 border-b border-slate-200 space-y-4">
        <div className="space-y-1">
          <h2
            id="upi-management-heading"
            className="font-display text-lg font-bold text-[#0B1A30] flex items-center gap-2"
          >
            <QrCode className="h-4 w-4 text-[#A37B22]" aria-hidden="true" />
            <span>Platform UPI Payment Endpoints</span>
          </h2>
          <p className="text-xs text-slate-500">
            Configure active UPI IDs and QR endpoints used for member deposit collection and
            payout reconciliation.
          </p>
        </div>

        <form
          onSubmit={handleSave}
          className="bg-slate-50 border border-slate-200 rounded-xl p-4 grid grid-cols-1 md:grid-cols-5 gap-3 items-end"
        >
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              UPI ID
            </label>
            <input
              type="text"
              required
              minLength={3}
              value={upiId}
              onChange={(e) => setUpiId(e.target.value)}
              placeholder="nexora@upi"
              className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              Account Display Name
            </label>
            <input
              type="text"
              required
              minLength={2}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="NEXORA Collections"
              className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              QR Image URL (optional)
            </label>
            <input
              type="url"
              value={qrCodeImageUrl}
              onChange={(e) => setQrCodeImageUrl(e.target.value)}
              placeholder="https://..."
              className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
            />
          </div>

          <div className="flex items-center gap-2 pb-2">
            <input
              id="upi-active-checkbox"
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            <label
              htmlFor="upi-active-checkbox"
              className="text-xs font-semibold text-[#0B1A30] cursor-pointer"
            >
              Active for payments
            </label>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1 px-3.5 py-2 text-xs font-semibold text-white bg-[#0B1A30] hover:bg-[#13284A] disabled:opacity-60 rounded-lg cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5 text-[#D8B45A]" aria-hidden="true" />
              <span>{saving ? 'Saving...' : editingId ? 'Update UPI' : 'Add UPI'}</span>
            </button>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
            )}
          </div>
        </form>

        {errorMsg && (
          <div role="alert" className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
            {errorMsg}
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
        <div className="p-6 text-xs text-slate-500">Loading UPI endpoints...</div>
      ) : accounts.length === 0 ? (
        <div className="p-6 text-xs text-slate-500">
          No UPI payment endpoints configured yet. Add one above.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                <th scope="col" className="py-3 px-5">
                  UPI ID
                </th>
                <th scope="col" className="py-3 px-4">
                  Display Name
                </th>
                <th scope="col" className="py-3 px-4 whitespace-nowrap">
                  Status
                </th>
                <th scope="col" className="py-3 px-4 whitespace-nowrap">
                  Last Updated
                </th>
                <th scope="col" className="py-3 px-5 text-right whitespace-nowrap">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {accounts.map((acc) => (
                <tr key={acc.accountId} className="hover:bg-slate-50/70">
                  <td className="py-3 px-5 font-mono font-semibold text-[#0B1A30]">
                    {acc.upiId}
                  </td>
                  <td className="py-3 px-4 text-slate-700">{acc.displayName}</td>
                  <td className="py-3 px-4 whitespace-nowrap">
                    <span
                      className={`inline-flex px-2 py-0.5 rounded text-[11px] font-semibold ${
                        acc.isActive
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {acc.isActive ? 'ACTIVE' : 'INACTIVE'}
                    </span>
                  </td>
                  <td className="py-3 px-4 font-mono text-slate-500 whitespace-nowrap">
                    {formatDateTimeInr(acc.updatedAt)}
                  </td>
                  <td className="py-3 px-5 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(acc.accountId);
                          setUpiId(acc.upiId);
                          setDisplayName(acc.displayName);
                          setQrCodeImageUrl(acc.qrCodeImageUrl);
                          setIsActive(acc.isActive);
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-[#0B1A30] bg-white border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer"
                      >
                        <Edit3 className="h-3 w-3" aria-hidden="true" />
                        <span>Edit</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleToggle(acc)}
                        className="px-2.5 py-1.5 text-[11px] font-semibold text-[#0B1A30] bg-[#F8F1DE] border border-[#C59B3B]/50 hover:bg-[#EFE2BF] rounded-md cursor-pointer"
                      >
                        {acc.isActive ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(acc)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 rounded-md cursor-pointer"
                      >
                        <Trash2 className="h-3 w-3" aria-hidden="true" />
                        <span>Delete</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
