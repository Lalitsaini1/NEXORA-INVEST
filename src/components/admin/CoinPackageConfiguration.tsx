import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Coins,
  Edit3,
  Gift,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  AdminActorContext,
  deleteCoinPackage,
  saveCoinPackage,
  seedDefaultCoinPackages,
  subscribeAllCoinPackages,
} from '../../services/adminService';
import { CoinPackageBonusType, CoinPackageRecord } from '../../types/domain';
import { formatCoins, formatDateTimeInr, formatInr } from '../../utils/formatters';
import {
  computePackageBonusMetrics,
  MAX_UPI_DEPOSIT_INR,
  MIN_UPI_DEPOSIT_INR,
} from '../../utils/upiGateway';

interface CoinPackageConfigurationProps {
  actor: AdminActorContext;
}

const BADGE_PRESETS = ['', 'Popular', 'Best Value', 'Bonus Tier', 'VIP Pack'];

export function CoinPackageConfiguration({ actor }: CoinPackageConfigurationProps) {
  const [packages, setPackages] = useState<CoinPackageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'PAUSED'>('ALL');

  // Editor form state
  const [editingPackageId, setEditingPackageId] = useState<string | undefined>(undefined);
  const [name, setName] = useState('');
  const [priceInr, setPriceInr] = useState('1000');
  const [bonusType, setBonusType] = useState<CoinPackageBonusType>('PERCENTAGE');
  const [bonusValue, setBonusValue] = useState('5');
  const [badgeTag, setBadgeTag] = useState('Popular');
  const [description, setDescription] = useState('');
  const [sortOrder, setSortOrder] = useState('1');
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    setLoading(true);
    const unsub = subscribeAllCoinPackages(
      (items) => {
        setPackages(items);
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

  const previewCalc = useMemo(
    () =>
      computePackageBonusMetrics({
        priceInr: Number(priceInr),
        bonusType,
        bonusValue: bonusType === 'NONE' ? 0 : Number(bonusValue),
      }),
    [priceInr, bonusType, bonusValue]
  );

  const filteredPackages = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return packages.filter((pkg) => {
      if (statusFilter === 'ACTIVE' && !pkg.isActive) return false;
      if (statusFilter === 'PAUSED' && pkg.isActive) return false;
      if (!q) return true;
      return (
        pkg.name.toLowerCase().includes(q) ||
        pkg.packageId.toLowerCase().includes(q) ||
        (pkg.badgeTag || '').toLowerCase().includes(q) ||
        String(pkg.priceInr).includes(q)
      );
    });
  }, [packages, searchQuery, statusFilter]);

  const activePackagesCount = useMemo(
    () => packages.filter((p) => p.isActive).length,
    [packages]
  );

  const maxBonusCoinsConfigured = useMemo(
    () => packages.reduce((max, p) => (p.bonusCoins > max ? p.bonusCoins : max), 0),
    [packages]
  );

  const resetForm = () => {
    setEditingPackageId(undefined);
    setName('');
    setPriceInr('1000');
    setBonusType('PERCENTAGE');
    setBonusValue('5');
    setBadgeTag('Popular');
    setDescription('');
    setSortOrder(String(packages.length + 1));
    setIsActive(true);
  };

  const handleEdit = (pkg: CoinPackageRecord) => {
    setEditingPackageId(pkg.packageId);
    setName(pkg.name);
    setPriceInr(String(pkg.priceInr));
    setBonusType(pkg.bonusType);
    setBonusValue(String(pkg.bonusValue));
    setBadgeTag(pkg.badgeTag || '');
    setDescription(pkg.description || '');
    setSortOrder(String(pkg.sortOrder));
    setIsActive(pkg.isActive);
    setErrorMsg(null);
    setNoticeMsg(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setNoticeMsg(null);

    if (previewCalc.error) {
      setErrorMsg(previewCalc.error);
      return;
    }

    setSaving(true);
    try {
      await saveCoinPackage({
        actor,
        packageId: editingPackageId,
        name,
        priceInr: previewCalc.priceInr,
        bonusType,
        bonusValue: bonusType === 'NONE' ? 0 : Number(bonusValue) || 0,
        badgeTag,
        description,
        sortOrder: Number.parseInt(sortOrder, 10) || 0,
        isActive,
      });
      setNoticeMsg(
        editingPackageId
          ? `Updated coin package "${name.trim()}" (${formatInr(previewCalc.priceInr)} -> ${formatCoins(previewCalc.totalCoins)}).`
          : `Created coin package "${name.trim()}" (${formatInr(previewCalc.priceInr)} -> ${formatCoins(previewCalc.totalCoins)}).`
      );
      resetForm();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to save coin package.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (pkg: CoinPackageRecord) => {
    setErrorMsg(null);
    setNoticeMsg(null);
    try {
      await saveCoinPackage({
        actor,
        packageId: pkg.packageId,
        name: pkg.name,
        priceInr: pkg.priceInr,
        bonusType: pkg.bonusType,
        bonusValue: pkg.bonusValue,
        badgeTag: pkg.badgeTag,
        description: pkg.description,
        sortOrder: pkg.sortOrder,
        isActive: !pkg.isActive,
      });
      setNoticeMsg(
        `Set "${pkg.name}" package to ${!pkg.isActive ? 'ACTIVE' : 'PAUSED'}.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to toggle package status.');
    }
  };

  const handleDelete = async (pkg: CoinPackageRecord) => {
    setErrorMsg(null);
    setNoticeMsg(null);
    try {
      await deleteCoinPackage({
        actor,
        packageId: pkg.packageId,
        name: pkg.name,
      });
      if (editingPackageId === pkg.packageId) {
        resetForm();
      }
      setConfirmDeleteId(null);
      setNoticeMsg(`Deleted coin package "${pkg.name}".`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to delete coin package.');
    }
  };

  const handleSeedDefaults = async () => {
    setErrorMsg(null);
    setNoticeMsg(null);
    setSeeding(true);
    try {
      const count = await seedDefaultCoinPackages(actor);
      setNoticeMsg(
        `Configured ${count} standard & bonus coin packages in Firestore. Live UPI Checkout updated.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to initialize default packages.');
    } finally {
      setSeeding(false);
    }
  };

  return (
    <section
      aria-labelledby="coin-package-config-heading"
      className="bg-white border border-slate-200 rounded-xl overflow-hidden"
    >
      {/* Header & Metrics Strip */}
      <div className="p-5 sm:p-6 border-b border-slate-200 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2
              id="coin-package-config-heading"
              className="font-display text-lg font-bold text-[#0B1A30] flex items-center gap-2"
            >
              <Coins className="h-4 w-4 text-[#A37B22]" aria-hidden="true" />
              <span>Virtual Coin Package &amp; Bonus Structure Configuration</span>
            </h2>
            <p className="text-xs text-slate-500">
              Define INR coin recharge tiers, percentage or flat bonus structures, and promotional
              badges synced atomically with the Member UPI Payment Gateway.
            </p>
          </div>

          <button
            type="button"
            disabled={seeding}
            onClick={() => void handleSeedDefaults()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#0B1A30] bg-[#F8F1DE] border border-[#C59B3B] hover:bg-[#EFE2BF] disabled:opacity-60 rounded-lg whitespace-nowrap cursor-pointer self-start lg:self-auto"
          >
            <Sparkles className="h-3.5 w-3.5 text-[#8A6518]" aria-hidden="true" />
            <span>{seeding ? 'Initializing Tiers...' : 'Load Recommended Bonus Tiers'}</span>
          </button>
        </div>

        {/* Summary KPI Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
            <p className="text-[11px] font-medium text-slate-500">Configured Packages</p>
            <p className="font-mono text-lg font-bold text-[#0B1A30] tabular-nums mt-0.5">
              {packages.length}
            </p>
          </div>
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
            <p className="text-[11px] font-medium text-slate-500">Active at Checkout</p>
            <p className="font-mono text-lg font-bold text-emerald-700 tabular-nums mt-0.5">
              {activePackagesCount}
            </p>
          </div>
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
            <p className="text-[11px] font-medium text-slate-500">Base Conversion Parity</p>
            <p className="font-mono text-lg font-bold text-[#0B1A30] tabular-nums mt-0.5">
              ₹1 = 1 Coin
            </p>
          </div>
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
            <p className="text-[11px] font-medium text-slate-500">Highest Bonus Tier</p>
            <p className="font-mono text-lg font-bold text-[#8A6518] tabular-nums mt-0.5">
              +{maxBonusCoinsConfigured.toLocaleString('en-IN')} Coins
            </p>
          </div>
        </div>

        {/* Package Creation / Edit Form */}
        <form
          onSubmit={handleSave}
          className="bg-slate-50 border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-bold uppercase tracking-wider text-[#0B1A30]">
              {editingPackageId
                ? `Editing Package: ${editingPackageId}`
                : 'Create New Virtual Coin Package'}
            </p>
            <span className="text-[11px] font-mono text-slate-500">
              INR Bounds: ₹{MIN_UPI_DEPOSIT_INR.toLocaleString('en-IN')} – ₹
              {MAX_UPI_DEPOSIT_INR.toLocaleString('en-IN')}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            <div>
              <label
                htmlFor="cpkg-name"
                className="block text-[11px] font-semibold text-slate-600 mb-1"
              >
                Package Name
              </label>
              <input
                id="cpkg-name"
                type="text"
                required
                minLength={2}
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Gold Tier Pack"
                className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B1A30]"
              />
            </div>

            <div>
              <label
                htmlFor="cpkg-price"
                className="block text-[11px] font-semibold text-slate-600 mb-1"
              >
                Package Price (INR ₹)
              </label>
              <input
                id="cpkg-price"
                type="number"
                required
                min={MIN_UPI_DEPOSIT_INR}
                max={MAX_UPI_DEPOSIT_INR}
                step={1}
                value={priceInr}
                onChange={(e) => setPriceInr(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono font-semibold bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B1A30]"
              />
            </div>

            <div>
              <label
                htmlFor="cpkg-bonus-type"
                className="block text-[11px] font-semibold text-slate-600 mb-1"
              >
                Bonus Structure
              </label>
              <select
                id="cpkg-bonus-type"
                value={bonusType}
                onChange={(e) => {
                  const next = e.target.value as CoinPackageBonusType;
                  setBonusType(next);
                  if (next === 'NONE') setBonusValue('0');
                  else if (bonusValue === '0') setBonusValue(next === 'PERCENTAGE' ? '5' : '100');
                }}
                className="w-full px-3 py-2 text-xs font-semibold text-[#0B1A30] bg-white border border-slate-300 rounded-lg cursor-pointer"
              >
                <option value="NONE">None (Strict 1:1 Base Parity)</option>
                <option value="PERCENTAGE">Percentage Bonus (%)</option>
                <option value="FLAT_COINS">Flat Bonus Coins</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="cpkg-bonus-value"
                className="block text-[11px] font-semibold text-slate-600 mb-1"
              >
                {bonusType === 'PERCENTAGE'
                  ? 'Bonus Percentage (0 – 100%)'
                  : bonusType === 'FLAT_COINS'
                  ? 'Flat Bonus Coins (Max 100% Base)'
                  : 'Bonus Value (Disabled)'}
              </label>
              <input
                id="cpkg-bonus-value"
                type="number"
                min={0}
                max={bonusType === 'PERCENTAGE' ? 100 : Math.max(100, previewCalc.baseCoins)}
                step={bonusType === 'PERCENTAGE' ? '0.5' : '1'}
                disabled={bonusType === 'NONE'}
                value={bonusType === 'NONE' ? '0' : bonusValue}
                onChange={(e) => setBonusValue(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-white disabled:bg-slate-100 border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B1A30]"
              />
            </div>

            <div>
              <label
                htmlFor="cpkg-badge"
                className="block text-[11px] font-semibold text-slate-600 mb-1"
              >
                Badge Tag (Optional)
              </label>
              <div className="flex gap-1.5">
                <input
                  id="cpkg-badge"
                  type="text"
                  maxLength={24}
                  value={badgeTag}
                  onChange={(e) => setBadgeTag(e.target.value)}
                  placeholder="Best Value"
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
                />
                <select
                  aria-label="Select preset badge tag"
                  value={BADGE_PRESETS.includes(badgeTag) ? badgeTag : ''}
                  onChange={(e) => setBadgeTag(e.target.value)}
                  className="px-2 py-2 text-[11px] bg-white border border-slate-300 rounded-lg cursor-pointer"
                >
                  <option value="">Preset</option>
                  {BADGE_PRESETS.filter(Boolean).map((tag) => (
                    <option key={tag} value={tag}>
                      {tag}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label
                htmlFor="cpkg-sort"
                className="block text-[11px] font-semibold text-slate-600 mb-1"
              >
                Display Order (0 – 1000)
              </label>
              <input
                id="cpkg-sort"
                type="number"
                min={0}
                max={1000}
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg"
              />
            </div>

            <div className="sm:col-span-2">
              <label
                htmlFor="cpkg-desc"
                className="block text-[11px] font-semibold text-slate-600 mb-1"
              >
                Package Description (Optional)
              </label>
              <input
                id="cpkg-desc"
                type="text"
                maxLength={240}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Includes instant bonus allocation upon verified UPI settlement."
                className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          {/* Live Package & Bonus Calculation Strip */}
          <div className="p-3.5 bg-white border border-slate-200 rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-4 text-xs">
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 block">
                  Base Coins (1:1 INR)
                </span>
                <span className="font-mono font-bold text-[#0B1A30] tabular-nums">
                  {previewCalc.baseCoins.toLocaleString('en-IN')} Coins
                </span>
              </div>
              <span className="text-slate-400 font-mono">+</span>
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[#8A6518] block">
                  Bonus Allocation ({previewCalc.effectivePercent}%)
                </span>
                <span className="font-mono font-bold text-[#A37B22] tabular-nums flex items-center gap-1">
                  <Gift className="h-3.5 w-3.5" aria-hidden="true" />
                  +{previewCalc.bonusCoins.toLocaleString('en-IN')} Bonus
                </span>
              </div>
              <span className="text-slate-400 font-mono">=</span>
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700 block">
                  Total Member Credit
                </span>
                <span className="font-mono font-bold text-emerald-800 tabular-nums">
                  {formatCoins(previewCalc.totalCoins)}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-[#0B1A30] cursor-pointer">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                <span>Visible on User Gateway</span>
              </label>

              <button
                type="submit"
                disabled={saving || Boolean(previewCalc.error)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#0B1A30] hover:bg-[#13284A] disabled:opacity-60 rounded-lg cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5 text-[#D8B45A]" aria-hidden="true" />
                <span>
                  {saving
                    ? 'Saving...'
                    : editingPackageId
                    ? 'Update Coin Package'
                    : 'Save Coin Package'}
                </span>
              </button>

              {editingPackageId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>

          {previewCalc.error && (
            <p className="text-xs font-semibold text-red-700">{previewCalc.error}</p>
          )}
        </form>

        {errorMsg && (
          <div
            role="alert"
            className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg"
          >
            {errorMsg}
          </div>
        )}
        {noticeMsg && (
          <div
            role="status"
            className="p-3 text-xs text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2"
          >
            <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0" aria-hidden="true" />
            <span>{noticeMsg}</span>
          </div>
        )}

        {/* Filter & Search Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
          <div className="flex items-center gap-1.5">
            {(['ALL', 'ACTIVE', 'PAUSED'] as const).map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setStatusFilter(status)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg border cursor-pointer transition-colors ${
                  statusFilter === status
                    ? 'bg-[#0B1A30] text-white border-[#0B1A30]'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                }`}
              >
                {status === 'ALL'
                  ? `All (${packages.length})`
                  : status === 'ACTIVE'
                  ? `Active (${activePackagesCount})`
                  : `Paused (${packages.length - activePackagesCount})`}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-64">
            <Search
              className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search package, INR price, tag..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B1A30]"
            />
          </div>
        </div>
      </div>

      {/* Packages Table */}
      {loading ? (
        <div className="p-6 text-xs text-slate-500">Loading virtual coin packages...</div>
      ) : filteredPackages.length === 0 ? (
        <div className="p-6 text-xs text-slate-500">
          {packages.length === 0
            ? 'No custom Firestore coin packages configured yet. Create a package above or click "Load Recommended Bonus Tiers" to populate standard packs. While empty, the checkout gateway displays default 1:1 INR presets.'
            : 'No coin packages match your current search or filter.'}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                <th scope="col" className="py-3 px-5">
                  Package &amp; Order
                </th>
                <th scope="col" className="py-3 px-4 whitespace-nowrap">
                  INR Price
                </th>
                <th scope="col" className="py-3 px-4 whitespace-nowrap">
                  Base Coins
                </th>
                <th scope="col" className="py-3 px-4 whitespace-nowrap">
                  Bonus Structure
                </th>
                <th scope="col" className="py-3 px-4 whitespace-nowrap">
                  Total Credit
                </th>
                <th scope="col" className="py-3 px-4 whitespace-nowrap">
                  Status
                </th>
                <th scope="col" className="py-3 px-5 text-right whitespace-nowrap">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredPackages.map((pkg) => (
                <tr key={pkg.packageId} className="hover:bg-slate-50/70">
                  <td className="py-3 px-5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] text-slate-400">
                        #{pkg.sortOrder}
                      </span>
                      <span className="font-semibold text-[#0B1A30]">{pkg.name}</span>
                      {pkg.badgeTag && (
                        <span className="px-1.5 py-0.5 rounded bg-[#F8F1DE] text-[#8A6518] text-[10px] font-bold">
                          {pkg.badgeTag}
                        </span>
                      )}
                    </div>
                    {pkg.description && (
                      <p className="text-[11px] text-slate-500 mt-0.5 max-w-xs truncate">
                        {pkg.description}
                      </p>
                    )}
                    <p className="text-[10px] font-mono text-slate-400 mt-0.5">
                      {pkg.packageId} · Updated {formatDateTimeInr(pkg.updatedAt)}
                    </p>
                  </td>
                  <td className="py-3 px-4 font-mono font-bold text-[#0B1A30] tabular-nums whitespace-nowrap">
                    {formatInr(pkg.priceInr)}
                  </td>
                  <td className="py-3 px-4 font-mono text-slate-700 tabular-nums whitespace-nowrap">
                    {pkg.baseCoins.toLocaleString('en-IN')} Coins
                  </td>
                  <td className="py-3 px-4 font-mono whitespace-nowrap">
                    {pkg.bonusCoins > 0 ? (
                      <div>
                        <span className="font-semibold text-[#8A6518]">
                          +{pkg.bonusCoins.toLocaleString('en-IN')} Coins
                        </span>
                        <span className="block text-[10px] text-slate-500">
                          {pkg.bonusType === 'PERCENTAGE'
                            ? `${pkg.bonusValue}% Rate`
                            : 'Flat Bonus'}
                        </span>
                      </div>
                    ) : (
                      <span className="text-slate-400">No Bonus (1:1)</span>
                    )}
                  </td>
                  <td className="py-3 px-4 font-mono font-bold text-emerald-700 tabular-nums whitespace-nowrap">
                    {formatCoins(pkg.totalCoins)}
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap">
                    <span
                      className={`inline-flex px-2 py-0.5 rounded text-[11px] font-semibold ${
                        pkg.isActive
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {pkg.isActive ? 'ACTIVE' : 'PAUSED'}
                    </span>
                  </td>
                  <td className="py-3 px-5 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleEdit(pkg)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-[#0B1A30] bg-white border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer"
                      >
                        <Edit3 className="h-3 w-3" aria-hidden="true" />
                        <span>Edit</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleToggleActive(pkg)}
                        className="px-2.5 py-1.5 text-[11px] font-semibold text-[#0B1A30] bg-[#F8F1DE] border border-[#C59B3B]/50 hover:bg-[#EFE2BF] rounded-md cursor-pointer"
                      >
                        {pkg.isActive ? 'Pause' : 'Activate'}
                      </button>
                      {confirmDeleteId === pkg.packageId ? (
                        <>
                          <button
                            type="button"
                            onClick={() => void handleDelete(pkg)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md cursor-pointer"
                          >
                            <Trash2 className="h-3 w-3" aria-hidden="true" />
                            <span>Confirm Delete</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="px-2 py-1.5 text-[11px] font-semibold text-slate-600 bg-white border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(pkg.packageId)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 rounded-md cursor-pointer"
                        >
                          <Trash2 className="h-3 w-3" aria-hidden="true" />
                          <span>Delete</span>
                        </button>
                      )}
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
