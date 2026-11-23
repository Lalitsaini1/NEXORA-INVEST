import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Crown,
  Edit3,
  Layers,
  Package,
  Percent,
  Plus,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import {
  AdminActorContext,
  deleteProductPlan,
  saveProductPlan,
  subscribeAllProductPlans,
} from '../../services/adminService';
import { ProductPlan } from '../../types/domain';
import { calculateDailyDistribution, formatCoins, formatInr } from '../../utils/formatters';

interface ProductPlanManagementProps {
  actor: AdminActorContext;
}

const TIER_PRESETS = [
  'Starter Tier',
  'Silver Tier',
  'Gold Tier',
  'Platinum Tier',
  'Institutional Tier',
];

const CYCLE_DAY_PRESETS = [7, 14, 30, 60, 90];

export function ProductPlanManagement({ actor }: ProductPlanManagementProps) {
  const [plans, setPlans] = useState<ProductPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'PAUSED'>('ALL');

  // Cycle & Tier Form State
  const [editingPlanId, setEditingPlanId] = useState<string | undefined>(undefined);
  const [tierName, setTierName] = useState('Gold Tier');
  const [productName, setProductName] = useState('');
  const [category, setCategory] = useState('Electronics');
  const [imageUrl, setImageUrl] = useState('');
  const [displayedValueInr, setDisplayedValueInr] = useState('45000');
  const [minCoins, setMinCoins] = useState('1000');
  const [maxCoins, setMaxCoins] = useState('25000');
  const [durationDays, setDurationDays] = useState('14');
  const [dailyRewardPercent, setDailyRewardPercent] = useState('2.5');
  const [description, setDescription] = useState('');
  const [termsAndConditions, setTermsAndConditions] = useState(
    'Fixed virtual coin participation cycle; daily reward percentages accrue atomically every 24 hours.'
  );
  const [isActive, setIsActive] = useState(true);

  const isSuperAdmin = actor.role === 'SUPER_ADMIN';

  useEffect(() => {
    setLoading(true);
    const unsub = subscribeAllProductPlans(
      (items) => {
        setPlans(items);
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
    setEditingPlanId(undefined);
    setTierName('Gold Tier');
    setProductName('');
    setCategory('Electronics');
    setImageUrl('');
    setDisplayedValueInr('45000');
    setMinCoins('1000');
    setMaxCoins('25000');
    setDurationDays('14');
    setDailyRewardPercent('2.5');
    setDescription('');
    setIsActive(true);
  };

  const parsedMinCoins = Math.max(1, Number.parseInt(minCoins, 10) || 1);
  const parsedMaxCoins = Math.max(1, Number.parseInt(maxCoins, 10) || parsedMinCoins);
  const parsedDuration = Math.max(1, Math.min(365, Number.parseInt(durationDays, 10) || 14));
  const parsedDailyPct = Math.max(
    0,
    Math.min(100, Number.parseFloat(dailyRewardPercent) || 0)
  );
  const isRangeValid = parsedMaxCoins >= parsedMinCoins;

  // Base cycle metrics derived from minimum coin entry, daily reward %, and cycle duration
  const dailyCoinsAtMin = Math.round(parsedMinCoins * (parsedDailyPct / 100));
  const dailyCoinsAtMax = Math.round(parsedMaxCoins * (parsedDailyPct / 100));
  const totalRewardAtMin = Math.round(
    parsedMinCoins + parsedMinCoins * (parsedDailyPct / 100) * parsedDuration
  );
  const previewSchedule = calculateDailyDistribution(totalRewardAtMin, parsedDuration);

  const filteredPlans = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return plans.filter((plan) => {
      if (statusFilter === 'ACTIVE' && !plan.isActive) return false;
      if (statusFilter === 'PAUSED' && plan.isActive) return false;
      if (!q) return true;
      return (
        plan.productName.toLowerCase().includes(q) ||
        (plan.tierName || '').toLowerCase().includes(q) ||
        plan.category.toLowerCase().includes(q) ||
        plan.planId.toLowerCase().includes(q)
      );
    });
  }, [plans, searchQuery, statusFilter]);

  const activeTierCount = useMemo(
    () => plans.filter((p) => p.isActive).length,
    [plans]
  );

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setNoticeMsg(null);

    if (!isRangeValid) {
      setErrorMsg('Maximum coin requirement must be greater than or equal to minimum coins.');
      return;
    }

    setSaving(true);
    try {
      await saveProductPlan({
        actor,
        planId: editingPlanId,
        productName,
        category,
        imageUrl,
        displayedValueInr: Number(displayedValueInr) || 0,
        planPriceInr: parsedMinCoins,
        durationDays: parsedDuration,
        totalCoinReward: totalRewardAtMin,
        tierName,
        minCoins: parsedMinCoins,
        maxCoins: parsedMaxCoins,
        dailyRewardPercent: parsedDailyPct,
        description:
          description.trim() ||
          `${tierName}: ${parsedDuration}-day virtual coin cycle (${parsedDailyPct}% daily reward rate).`,
        termsAndConditions,
        isActive,
      });
      setNoticeMsg(
        editingPlanId
          ? `Updated ${tierName} cycle "${productName.trim()}".`
          : `Created new ${tierName} cycle "${productName.trim()}".`
      );
      resetForm();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to save investment cycle.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (plan: ProductPlan) => {
    setErrorMsg(null);
    setNoticeMsg(null);
    try {
      await saveProductPlan({
        actor,
        planId: plan.planId,
        productName: plan.productName,
        category: plan.category,
        imageUrl: plan.imageUrl,
        displayedValueInr: plan.displayedValueInr,
        planPriceInr: plan.planPriceInr,
        durationDays: plan.durationDays,
        totalCoinReward: plan.totalCoinReward,
        tierName: plan.tierName,
        minCoins: plan.minCoins,
        maxCoins: plan.maxCoins,
        dailyRewardPercent: plan.dailyRewardPercent,
        description: plan.description,
        termsAndConditions: plan.termsAndConditions,
        isActive: !plan.isActive,
      });
      setNoticeMsg(
        `${plan.isActive ? 'Paused' : 'Activated'} "${plan.productName}" (${plan.tierName || 'Standard Tier'}).`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to toggle cycle status.');
    }
  };

  const handleDelete = async (plan: ProductPlan) => {
    setErrorMsg(null);
    setNoticeMsg(null);
    try {
      await deleteProductPlan({
        actor,
        planId: plan.planId,
        productName: plan.productName,
      });
      if (editingPlanId === plan.planId) {
        resetForm();
      }
      setNoticeMsg(`Deleted investment cycle "${plan.productName}".`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to delete investment cycle.');
    }
  };

  return (
    <section
      aria-labelledby="product-plan-management-heading"
      className="bg-white border border-slate-200 rounded-xl overflow-hidden"
    >
      <div className="p-5 sm:p-6 border-b border-slate-200 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <h2
              id="product-plan-management-heading"
              className="font-display text-lg font-bold text-[#0B1A30] flex items-center gap-2"
            >
              <Package className="h-4 w-4 text-[#A37B22]" aria-hidden="true" />
              <span>Product Plan &amp; Investment Cycle Management</span>
            </h2>
            <p className="text-xs text-slate-600">
              Define investment cycles, enforce minimum/maximum coin limits, and configure daily
              reward percentages across member tiers ({activeTierCount} active / {plans.length} total).
            </p>
          </div>

          <span
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold self-start ${
              isSuperAdmin
                ? 'bg-[#F8F1DE] text-[#8A6518] border border-[#C59B3B]'
                : 'bg-slate-100 text-slate-700 border border-slate-300'
            }`}
          >
            {isSuperAdmin ? (
              <>
                <Crown className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Super Admin Cycle Governance</span>
              </>
            ) : (
              <>
                <ShieldCheck className="h-3.5 w-3.5 text-[#A37B22]" aria-hidden="true" />
                <span>Operational Plan Access</span>
              </>
            )}
          </span>
        </div>

        {/* Define / Edit Investment Cycle Form */}
        <form
          onSubmit={handleSave}
          className="bg-slate-50 border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label
                htmlFor="plan-tier-select"
                className="block text-[11px] font-semibold text-slate-600 mb-1"
              >
                Tier Classification
              </label>
              <select
                id="plan-tier-select"
                value={tierName}
                onChange={(e) => setTierName(e.target.value)}
                className="w-full px-3 py-2 text-xs font-semibold text-[#0B1A30] bg-white border border-slate-300 rounded-lg cursor-pointer"
              >
                {TIER_PRESETS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="plan-cycle-name"
                className="block text-[11px] font-semibold text-slate-600 mb-1"
              >
                Investment Cycle / Product Name
              </label>
              <input
                id="plan-cycle-name"
                type="text"
                required
                minLength={2}
                maxLength={120}
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder="Commercial Solar Node Cycle"
                className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label
                htmlFor="plan-category"
                className="block text-[11px] font-semibold text-slate-600 mb-1"
              >
                Asset Category
              </label>
              <input
                id="plan-category"
                type="text"
                required
                maxLength={64}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Electronics"
                className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label
                htmlFor="plan-ref-value"
                className="block text-[11px] font-semibold text-slate-600 mb-1"
              >
                Referenced Asset Value (INR)
              </label>
              <input
                id="plan-ref-value"
                type="number"
                min={0}
                value={displayedValueInr}
                onChange={(e) => setDisplayedValueInr(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label
                htmlFor="plan-min-coins"
                className="block text-[11px] font-semibold text-slate-600 mb-1"
              >
                Minimum Coin Requirement
              </label>
              <input
                id="plan-min-coins"
                type="number"
                min={1}
                max={100000000}
                required
                value={minCoins}
                onChange={(e) => setMinCoins(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label
                htmlFor="plan-max-coins"
                className="block text-[11px] font-semibold text-slate-600 mb-1"
              >
                Maximum Coin Requirement
              </label>
              <input
                id="plan-max-coins"
                type="number"
                min={1}
                max={100000000}
                required
                value={maxCoins}
                onChange={(e) => setMaxCoins(e.target.value)}
                className={`w-full px-3 py-2 text-xs font-mono bg-white border rounded-lg ${
                  isRangeValid ? 'border-slate-300' : 'border-red-400'
                }`}
              />
            </div>

            <div>
              <label
                htmlFor="plan-daily-pct"
                className="block text-[11px] font-semibold text-slate-600 mb-1"
              >
                Daily Reward Rate (% per Day)
              </label>
              <div className="relative">
                <input
                  id="plan-daily-pct"
                  type="number"
                  min={0}
                  max={100}
                  step="0.1"
                  required
                  value={dailyRewardPercent}
                  onChange={(e) => setDailyRewardPercent(e.target.value)}
                  className="w-full pr-8 pl-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg"
                />
                <Percent
                  className="h-3.5 w-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="plan-duration-days"
                className="block text-[11px] font-semibold text-slate-600 mb-1"
              >
                Cycle Duration (Days)
              </label>
              <div className="space-y-1.5">
                <input
                  id="plan-duration-days"
                  type="number"
                  min={1}
                  max={365}
                  required
                  value={durationDays}
                  onChange={(e) => setDurationDays(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg"
                />
                <div className="flex flex-wrap gap-1">
                  {CYCLE_DAY_PRESETS.map((days) => (
                    <button
                      key={days}
                      type="button"
                      onClick={() => setDurationDays(String(days))}
                      className={`px-2 py-0.5 text-[10px] font-mono font-semibold rounded border cursor-pointer ${
                        parsedDuration === days
                          ? 'bg-[#0B1A30] text-white border-[#0B1A30]'
                          : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      {days}d
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="plan-description"
                className="block text-[11px] font-semibold text-slate-600 mb-1"
              >
                Cycle Description
              </label>
              <input
                id="plan-description"
                type="text"
                maxLength={500}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Structured tier yield cycle with automated 24h coin settlements"
                className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label
                htmlFor="plan-terms"
                className="block text-[11px] font-semibold text-slate-600 mb-1"
              >
                Terms &amp; Compliance Disclosure
              </label>
              <input
                id="plan-terms"
                type="text"
                maxLength={1000}
                value={termsAndConditions}
                onChange={(e) => setTermsAndConditions(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          {/* Live Calculated Tier Economics Preview */}
          <div className="bg-white border border-slate-200 rounded-lg p-3.5 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div>
              <p className="text-[11px] text-slate-500">Daily Coin Yield Range (Min → Max)</p>
              <p className="font-mono font-bold text-[#0B1A30] tabular-nums mt-0.5">
                {dailyCoinsAtMin.toLocaleString('en-IN')} → {dailyCoinsAtMax.toLocaleString('en-IN')}{' '}
                Coins/day ({parsedDailyPct}%)
              </p>
            </div>
            <div>
              <p className="text-[11px] text-slate-500">
                Total Cycle Return @ Min Entry ({parsedMinCoins.toLocaleString('en-IN')} Coins)
              </p>
              <p className="font-mono font-bold text-emerald-700 tabular-nums mt-0.5">
                {formatCoins(totalRewardAtMin)}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-slate-500">Daily Schedule Preview (Day 1)</p>
              <p className="font-mono font-semibold text-[#8A6518] tabular-nums mt-0.5">
                {previewSchedule[0] ?? 0} Coins/day · {parsedDuration} days
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <label className="inline-flex items-center gap-2 text-xs font-semibold text-[#0B1A30] cursor-pointer">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              <span>Publish as Active Investment Cycle</span>
            </label>

            <div className="flex items-center gap-2">
              {editingPlanId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg cursor-pointer"
                >
                  Cancel Edit
                </button>
              )}
              <button
                type="submit"
                disabled={saving || !isRangeValid}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#0B1A30] hover:bg-[#13284A] disabled:opacity-60 rounded-lg cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5 text-[#D8B45A]" aria-hidden="true" />
                <span>
                  {saving
                    ? 'Saving Cycle...'
                    : editingPlanId
                    ? 'Update Tier Cycle'
                    : 'Create Investment Cycle'}
                </span>
              </button>
            </div>
          </div>
        </form>

        {/* Search & Status Filter */}
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
              placeholder="Search tier, cycle name, or category"
              className="w-full pl-8 pr-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:bg-white focus:border-[#0B1A30]"
            />
          </div>

          <select
            aria-label="Filter product plans by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'ALL' | 'ACTIVE' | 'PAUSED')}
            className="px-3 py-2 text-xs font-semibold text-[#0B1A30] bg-slate-50 border border-slate-300 rounded-lg cursor-pointer"
          >
            <option value="ALL">All Cycles ({plans.length})</option>
            <option value="ACTIVE">Active Only ({activeTierCount})</option>
            <option value="PAUSED">Paused Only ({plans.length - activeTierCount})</option>
          </select>
        </div>

        {errorMsg && (
          <div
            role="alert"
            className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2"
          >
            <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{errorMsg}</span>
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
      </div>

      {loading ? (
        <div className="p-6 text-xs text-slate-500">Loading product tiers and cycles...</div>
      ) : filteredPlans.length === 0 ? (
        <div className="p-6 text-xs text-slate-500">
          No investment cycles match your current filter. Create one using the form above.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-left">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                <th scope="col" className="py-3 px-5">
                  Tier &amp; Cycle Name
                </th>
                <th scope="col" className="py-3 px-4 whitespace-nowrap">
                  Min–Max Coins
                </th>
                <th scope="col" className="py-3 px-4 whitespace-nowrap">
                  Daily Reward %
                </th>
                <th scope="col" className="py-3 px-4 whitespace-nowrap">
                  Duration
                </th>
                <th scope="col" className="py-3 px-4 whitespace-nowrap">
                  Base Return
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
              {filteredPlans.map((plan) => {
                const planMin = plan.minCoins ?? plan.coinDeductionAmount;
                const planMax = plan.maxCoins ?? plan.coinDeductionAmount * 10;
                const planPct =
                  plan.dailyRewardPercent ??
                  (plan.coinDeductionAmount > 0 && plan.durationDays > 0
                    ? Math.round(
                        (plan.totalCoinReward / plan.durationDays / plan.coinDeductionAmount) *
                          10000
                      ) / 100
                    : 0);

                return (
                  <tr key={plan.planId} className="hover:bg-slate-50/70">
                    <td className="py-3 px-5">
                      <div className="flex items-center gap-1.5">
                        <Layers className="h-3.5 w-3.5 text-[#A37B22] shrink-0" aria-hidden="true" />
                        <span className="font-semibold text-[#0B1A30]">{plan.productName}</span>
                      </div>
                      <p className="text-[11px] text-slate-500">
                        {plan.tierName || 'Standard Tier'} · {plan.category} · Ref{' '}
                        {formatInr(plan.displayedValueInr)}
                      </p>
                    </td>
                    <td className="py-3 px-4 font-mono font-semibold text-[#0B1A30] whitespace-nowrap tabular-nums">
                      {planMin.toLocaleString('en-IN')} – {planMax.toLocaleString('en-IN')} Coins
                    </td>
                    <td className="py-3 px-4 font-mono font-bold text-[#8A6518] whitespace-nowrap tabular-nums">
                      {planPct}% / day
                    </td>
                    <td className="py-3 px-4 font-mono whitespace-nowrap tabular-nums">
                      {plan.durationDays} days
                    </td>
                    <td className="py-3 px-4 font-mono font-bold text-emerald-700 whitespace-nowrap tabular-nums">
                      {formatCoins(plan.totalCoinReward)}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded text-[11px] font-semibold ${
                          plan.isActive
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {plan.isActive ? 'ACTIVE' : 'PAUSED'}
                      </span>
                    </td>
                    <td className="py-3 px-5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingPlanId(plan.planId);
                            setTierName(plan.tierName || 'Standard Tier');
                            setProductName(plan.productName);
                            setCategory(plan.category);
                            setImageUrl(plan.imageUrl);
                            setDisplayedValueInr(String(plan.displayedValueInr));
                            setMinCoins(String(planMin));
                            setMaxCoins(String(planMax));
                            setDurationDays(String(plan.durationDays));
                            setDailyRewardPercent(String(planPct));
                            setDescription(plan.description);
                            setTermsAndConditions(plan.termsAndConditions);
                            setIsActive(plan.isActive);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-[#0B1A30] bg-white border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer"
                        >
                          <Edit3 className="h-3 w-3" aria-hidden="true" />
                          <span>Edit</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleToggleActive(plan)}
                          className="px-2.5 py-1.5 text-[11px] font-semibold text-[#0B1A30] bg-[#F8F1DE] border border-[#C59B3B]/50 hover:bg-[#EFE2BF] rounded-md cursor-pointer"
                        >
                          {plan.isActive ? 'Pause' : 'Activate'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(plan)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 rounded-md cursor-pointer"
                        >
                          <Trash2 className="h-3 w-3" aria-hidden="true" />
                          <span>Delete</span>
                        </button>
                      </div>
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
