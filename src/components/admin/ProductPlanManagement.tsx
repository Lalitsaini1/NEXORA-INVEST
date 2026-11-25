import { useEffect, useMemo, useRef, useState } from 'react';
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
  Users,
} from 'lucide-react';
import {
  AdminActorContext,
  deleteProductPlan,
  saveProductPlan,
  subscribeAllInvestmentRequests,
  subscribeAllProductPlans,
  subscribeAllUserPlans,
  toggleProductPlanStatus,
} from '../../services/adminService';
import { InvestmentRequest, ProductPlan, UserPlan } from '../../types/domain';
import { formatDateTimeInr, formatInr } from '../../utils/formatters';
import {
  aggregateAdminPlanAnalytics,
  canDeleteInvestmentPlan,
  computePlanEconomics,
} from '../../utils/planInvestment';

interface ProductPlanManagementProps {
  actor: AdminActorContext;
}

const DURATION_PRESETS = [7, 14, 21, 30, 60, 90];

const DEFAULT_RISK_DISCLOSURE =
  'Indicative returns are projected estimates based on structured asset cycles and are NOT guaranteed. Platform service and payment gateway charges apply per payout schedule. Withdrawals require verified KYC/payout ownership and depend on settled INR eligibility.';

export function ProductPlanManagement({ actor }: ProductPlanManagementProps) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const [plans, setPlans] = useState<ProductPlan[]>([]);
  const [userPlans, setUserPlans] = useState<UserPlan[]>([]);
  const [investmentRequests, setInvestmentRequests] = useState<InvestmentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');

  // Plan Creation / Edit Form State
  const [editingPlanId, setEditingPlanId] = useState<string | undefined>(undefined);
  const [productName, setProductName] = useState('');
  const [category, setCategory] = useState('Structured Hardware');
  const [description, setDescription] = useState('');
  const [minInvestmentInr, setMinInvestmentInr] = useState('1000');
  const [maxInvestmentInr, setMaxInvestmentInr] = useState('25000');
  const [durationDays, setDurationDays] = useState('14');
  const [expectedReturnPercent, setExpectedReturnPercent] = useState('28');
  const [termsAndConditions, setTermsAndConditions] = useState(DEFAULT_RISK_DISCLOSURE);
  const [imageUrl, setImageUrl] = useState('');
  const [isActive, setIsActive] = useState(true);

  const isSuperAdmin = actor.role === 'SUPER_ADMIN';

  useEffect(() => {
    setLoading(true);
    const unsubPlans = subscribeAllProductPlans(
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
    const unsubEnrollments = subscribeAllUserPlans(
      (items) => setUserPlans(items),
      () => undefined
    );
    const unsubRequests = subscribeAllInvestmentRequests(
      (items) => setInvestmentRequests(items),
      () => undefined
    );
    return () => {
      unsubPlans();
      unsubEnrollments();
      unsubRequests();
    };
  }, []);

  const resetForm = () => {
    setEditingPlanId(undefined);
    setProductName('');
    setCategory('Structured Hardware');
    setDescription('');
    setMinInvestmentInr('1000');
    setMaxInvestmentInr('25000');
    setDurationDays('14');
    setExpectedReturnPercent('28');
    setTermsAndConditions(DEFAULT_RISK_DISCLOSURE);
    setImageUrl('');
    setIsActive(true);
  };

  const parsedMinInr = Math.max(1, Number.parseInt(minInvestmentInr, 10) || 1);
  const parsedMaxInr = Math.max(1, Number.parseInt(maxInvestmentInr, 10) || parsedMinInr);
  const parsedDuration = Math.max(1, Math.min(365, Number.parseInt(durationDays, 10) || 14));
  const parsedReturnPct = Math.max(
    0,
    Math.min(1000, Number.parseFloat(expectedReturnPercent) || 0)
  );
  const isRangeValid = parsedMaxInr >= parsedMinInr;

  const previewAtMin = useMemo(
    () =>
      computePlanEconomics({
        plan: {
          planPriceInr: parsedMinInr,
          coinDeductionAmount: parsedMinInr,
          minCoins: parsedMinInr,
          maxCoins: parsedMaxInr,
          durationDays: parsedDuration,
          expectedReturnPercent: parsedReturnPct,
          totalCoinReward: Math.round(parsedMinInr * (1 + parsedReturnPct / 100)),
        },
        investmentAmountInr: parsedMinInr,
      }),
    [parsedMinInr, parsedMaxInr, parsedDuration, parsedReturnPct]
  );

  const previewAtMax = useMemo(
    () =>
      computePlanEconomics({
        plan: {
          planPriceInr: parsedMinInr,
          coinDeductionAmount: parsedMinInr,
          minCoins: parsedMinInr,
          maxCoins: parsedMaxInr,
          durationDays: parsedDuration,
          expectedReturnPercent: parsedReturnPct,
          totalCoinReward: Math.round(parsedMinInr * (1 + parsedReturnPct / 100)),
        },
        investmentAmountInr: parsedMaxInr,
      }),
    [parsedMinInr, parsedMaxInr, parsedDuration, parsedReturnPct]
  );

  const analytics = useMemo(
    () =>
      aggregateAdminPlanAnalytics({
        plans,
        userPlans,
        investmentRequests,
      }),
    [plans, userPlans, investmentRequests]
  );

  const filteredPlans = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return plans.filter((plan) => {
      if (statusFilter === 'ACTIVE' && !plan.isActive) return false;
      if (statusFilter === 'INACTIVE' && plan.isActive) return false;
      if (!q) return true;
      return (
        plan.productName.toLowerCase().includes(q) ||
        plan.description.toLowerCase().includes(q) ||
        plan.category.toLowerCase().includes(q) ||
        plan.planId.toLowerCase().includes(q)
      );
    });
  }, [plans, searchQuery, statusFilter]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setNoticeMsg(null);

    if (!isRangeValid) {
      setErrorMsg('Maximum Investment (INR) must be greater than or equal to Minimum Investment (INR).');
      return;
    }
    if (productName.trim().length < 2) {
      setErrorMsg('Plan Name must be at least 2 characters.');
      return;
    }

    setSaving(true);
    try {
      await saveProductPlan({
        actor,
        planId: editingPlanId,
        productName: productName.trim(),
        category: category.trim() || 'Structured Plan',
        imageUrl: imageUrl.trim(),
        displayedValueInr: parsedMaxInr,
        planPriceInr: parsedMinInr,
        durationDays: parsedDuration,
        totalCoinReward: previewAtMin.estimatedTotalPayoutInr,
        tierName: 'Managed Plan',
        minCoins: parsedMinInr,
        maxCoins: parsedMaxInr,
        expectedReturnPercent: Math.round(parsedReturnPct * 100) / 100,
        dailyRewardPercent: previewAtMin.dailyRewardPercent,
        description:
          description.trim() ||
          `${parsedDuration}-day structured plan (${parsedReturnPct}% indicative return).`,
        termsAndConditions: termsAndConditions.trim() || DEFAULT_RISK_DISCLOSURE,
        isActive,
      });
      setNoticeMsg(
        editingPlanId
          ? `Updated investment plan "${productName.trim()}".`
          : `Created new investment plan "${productName.trim()}".`
      );
      resetForm();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to save investment plan.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (plan: ProductPlan) => {
    setErrorMsg(null);
    setNoticeMsg(null);
    setBusyPlanId(plan.planId);
    try {
      await toggleProductPlanStatus({
        actor,
        planId: plan.planId,
        productName: plan.productName,
        isActive: !plan.isActive,
      });
      setNoticeMsg(
        `${plan.isActive ? 'Deactivated' : 'Activated'} investment plan "${plan.productName}".`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to update plan status.');
    } finally {
      setBusyPlanId(null);
    }
  };

  const handleDelete = async (plan: ProductPlan) => {
    setErrorMsg(null);
    setNoticeMsg(null);
    const deleteCheck = canDeleteInvestmentPlan({
      planId: plan.planId,
      userPlans,
      investmentRequests,
    });
    if (!deleteCheck.canDelete) {
      setErrorMsg(
        deleteCheck.reason ||
          `Cannot delete "${plan.productName}" while active investments exist. Deactivate it instead.`
      );
      return;
    }

    setBusyPlanId(plan.planId);
    try {
      await deleteProductPlan({
        actor,
        planId: plan.planId,
        productName: plan.productName,
      });
      if (editingPlanId === plan.planId) {
        resetForm();
      }
      setNoticeMsg(`Deleted investment plan "${plan.productName}" (0 active investments).`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to delete investment plan.');
    } finally {
      setBusyPlanId(null);
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
              <span>Investment Plan Management System</span>
            </h2>
            <p className="text-xs text-slate-600">
              Create, edit, activate/deactivate, and monitor investor participation &amp; capital
              allocation per plan. Plans with active enrollments cannot be deleted.
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
                <span>Super Admin Plan Governance</span>
              </>
            ) : (
              <>
                <ShieldCheck className="h-3.5 w-3.5 text-[#A37B22]" aria-hidden="true" />
                <span>Verified Admin Plan Control</span>
              </>
            )}
          </span>
        </div>

        {/* Portfolio Plan KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
            <p className="text-[11px] font-semibold text-slate-500">Total Plans</p>
            <p className="font-mono text-xl font-bold text-[#0B1A30] tabular-nums mt-0.5">
              {analytics.summary.totalPlans}
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {analytics.summary.activePlans} Active · {analytics.summary.pausedPlans} Inactive
            </p>
          </div>
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
            <p className="text-[11px] font-semibold text-slate-500">Active Enrollments</p>
            <p className="font-mono text-xl font-bold text-[#0B1A30] tabular-nums mt-0.5">
              {analytics.summary.totalActiveInvestments}
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">Live active user plans</p>
          </div>
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
            <p className="text-[11px] font-semibold text-slate-500">Total Investors</p>
            <p className="font-mono text-xl font-bold text-[#0B1A30] tabular-nums mt-0.5 flex items-center gap-1.5">
              <Users className="h-4 w-4 text-[#A37B22]" aria-hidden="true" />
              <span>{analytics.summary.totalInvestors}</span>
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">Unique enrolled members</p>
          </div>
          <div className="p-3.5 bg-[#0B1A30] text-white rounded-lg">
            <p className="text-[11px] font-semibold text-[#D8B45A]">Total Investment Amount</p>
            <p className="font-mono text-xl font-bold tabular-nums mt-0.5">
              {formatInr(analytics.summary.totalInvestmentAmountInr)}
            </p>
            <p className="text-[11px] text-slate-300 mt-0.5">All verified plan allocations</p>
          </div>
        </div>

        {/* Add / Edit Investment Plan Form */}
        <form
          ref={formRef}
          onSubmit={handleSave}
          className="bg-slate-50 border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#0B1A30]">
              {editingPlanId ? `Edit Investment Plan (${editingPlanId})` : 'Add New Investment Plan'}
            </h3>
            {editingPlanId && (
              <button
                type="button"
                onClick={resetForm}
                className="text-xs font-semibold text-[#8A6518] hover:underline cursor-pointer"
              >
                Switch to Create New Plan
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label
                htmlFor="plan-name-input"
                className="block text-[11px] font-semibold text-slate-600 mb-1"
              >
                Plan Name
              </label>
              <input
                id="plan-name-input"
                type="text"
                required
                minLength={2}
                maxLength={120}
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder="e.g. Infrastructure Node Plan"
                className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label
                htmlFor="plan-category-input"
                className="block text-[11px] font-semibold text-slate-600 mb-1"
              >
                Category
              </label>
              <input
                id="plan-category-input"
                type="text"
                required
                maxLength={64}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Structured Hardware"
                className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label
                htmlFor="plan-min-inr"
                className="block text-[11px] font-semibold text-slate-600 mb-1"
              >
                Minimum Investment (INR)
              </label>
              <input
                id="plan-min-inr"
                type="number"
                min={1}
                max={100000000}
                required
                value={minInvestmentInr}
                onChange={(e) => setMinInvestmentInr(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label
                htmlFor="plan-max-inr"
                className="block text-[11px] font-semibold text-slate-600 mb-1"
              >
                Maximum Investment (INR)
              </label>
              <input
                id="plan-max-inr"
                type="number"
                min={1}
                max={100000000}
                required
                value={maxInvestmentInr}
                onChange={(e) => setMaxInvestmentInr(e.target.value)}
                className={`w-full px-3 py-2 text-xs font-mono bg-white border rounded-lg ${
                  isRangeValid ? 'border-slate-300' : 'border-red-400'
                }`}
              />
            </div>

            <div>
              <label
                htmlFor="plan-duration-input"
                className="block text-[11px] font-semibold text-slate-600 mb-1"
              >
                Investment Duration (Days)
              </label>
              <div className="space-y-1.5">
                <input
                  id="plan-duration-input"
                  type="number"
                  min={1}
                  max={365}
                  required
                  value={durationDays}
                  onChange={(e) => setDurationDays(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg"
                />
                <div className="flex flex-wrap gap-1">
                  {DURATION_PRESETS.map((days) => (
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

            <div>
              <label
                htmlFor="plan-expected-return-pct"
                className="block text-[11px] font-semibold text-slate-600 mb-1"
              >
                Expected Return (% Indicative, Non-Guaranteed)
              </label>
              <div className="relative">
                <input
                  id="plan-expected-return-pct"
                  type="number"
                  min={0}
                  max={1000}
                  step="0.1"
                  required
                  value={expectedReturnPercent}
                  onChange={(e) => setExpectedReturnPercent(e.target.value)}
                  className="w-full pr-8 pl-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg"
                />
                <Percent
                  className="h-3.5 w-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
              </div>
            </div>

            <div className="sm:col-span-2">
              <label
                htmlFor="plan-description-input"
                className="block text-[11px] font-semibold text-slate-600 mb-1"
              >
                Plan Description
              </label>
              <input
                id="plan-description-input"
                type="text"
                required
                minLength={4}
                maxLength={500}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Structured asset participation cycle with daily accrual tracking"
                className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="plan-terms-input"
                className="block text-[11px] font-semibold text-slate-600 mb-1"
              >
                Risk, Fees &amp; Withdrawal Conditions Disclosure
              </label>
              <input
                id="plan-terms-input"
                type="text"
                maxLength={1000}
                value={termsAndConditions}
                onChange={(e) => setTermsAndConditions(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label
                htmlFor="plan-image-url"
                className="block text-[11px] font-semibold text-slate-600 mb-1"
              >
                Plan Image URL (Optional)
              </label>
              <input
                id="plan-image-url"
                type="url"
                maxLength={500}
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://..."
                className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          {/* Server-Aligned Calculated Payout & Daily Earnings Preview */}
          <div className="bg-white border border-slate-200 rounded-lg p-3.5 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div>
              <p className="text-[11px] text-slate-500">Estimated Total Payout (Min → Max)</p>
              <p className="font-mono font-bold text-emerald-700 tabular-nums mt-0.5">
                {formatInr(previewAtMin.estimatedTotalPayoutInr)} →{' '}
                {formatInr(previewAtMax.estimatedTotalPayoutInr)}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-slate-500">Estimated Daily Earnings (Min → Max)</p>
              <p className="font-mono font-bold text-[#0B1A30] tabular-nums mt-0.5">
                {formatInr(previewAtMin.dailyEarningsInr)} →{' '}
                {formatInr(previewAtMax.dailyEarningsInr)} / day ({previewAtMin.dailyRewardPercent}%)
              </p>
            </div>
            <div>
              <p className="text-[11px] text-slate-500">Total Indicative Return</p>
              <p className="font-mono font-semibold text-[#8A6518] tabular-nums mt-0.5">
                +{parsedReturnPct}% over {parsedDuration} days (non-guaranteed)
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
              <span>Plan Status: Active (Visible &amp; Open for Investment)</span>
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
                    ? 'Saving Plan...'
                    : editingPlanId
                    ? 'Save Plan Changes'
                    : 'Add Investment Plan'}
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
              placeholder="Search plan name, description, or ID"
              className="w-full pl-8 pr-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:bg-white focus:border-[#0B1A30]"
            />
          </div>

          <select
            aria-label="Filter product plans by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'ALL' | 'ACTIVE' | 'INACTIVE')}
            className="px-3 py-2 text-xs font-semibold text-[#0B1A30] bg-slate-50 border border-slate-300 rounded-lg cursor-pointer"
          >
            <option value="ALL">All Plans ({plans.length})</option>
            <option value="ACTIVE">Active ({analytics.summary.activePlans})</option>
            <option value="INACTIVE">Inactive ({analytics.summary.pausedPlans})</option>
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
        <div className="p-6 text-xs text-slate-500">Loading investment plans and analytics...</div>
      ) : filteredPlans.length === 0 ? (
        <div className="p-6 text-xs text-slate-500">
          No investment plans match your current filter. Add a plan using the form above.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] border-collapse text-left">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                <th scope="col" className="py-3 px-5">
                  Plan &amp; Created Date
                </th>
                <th scope="col" className="py-3 px-3 whitespace-nowrap">
                  Min–Max (INR)
                </th>
                <th scope="col" className="py-3 px-3 whitespace-nowrap">
                  Duration
                </th>
                <th scope="col" className="py-3 px-3 whitespace-nowrap">
                  Expected Return
                </th>
                <th scope="col" className="py-3 px-3 whitespace-nowrap">
                  Total Payout / Daily
                </th>
                <th scope="col" className="py-3 px-3 whitespace-nowrap">
                  Total Investors
                </th>
                <th scope="col" className="py-3 px-3 whitespace-nowrap">
                  Total Invested
                </th>
                <th scope="col" className="py-3 px-3 whitespace-nowrap">
                  Status
                </th>
                <th scope="col" className="py-3 px-5 text-right whitespace-nowrap">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredPlans.map((plan) => {
                const economics = computePlanEconomics({ plan });
                const planStats = analytics.byPlanId[plan.planId];
                const deleteCheck = canDeleteInvestmentPlan({
                  planId: plan.planId,
                  userPlans,
                  investmentRequests,
                });
                const isBusy = busyPlanId === plan.planId;

                return (
                  <tr key={plan.planId} className="hover:bg-slate-50/70 align-top">
                    <td className="py-3.5 px-5 max-w-[260px]">
                      <div className="flex items-center gap-1.5">
                        <Layers className="h-3.5 w-3.5 text-[#A37B22] shrink-0" aria-hidden="true" />
                        <span className="font-semibold text-[#0B1A30]">{plan.productName}</span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">
                        {plan.description}
                      </p>
                      <p className="text-[10px] font-mono text-slate-400 mt-1">
                        Created: {plan.createdAt ? formatDateTimeInr(plan.createdAt) : 'Published'}
                      </p>
                    </td>
                    <td className="py-3.5 px-3 font-mono font-semibold text-[#0B1A30] whitespace-nowrap tabular-nums">
                      {formatInr(economics.minInvestmentInr)} – {formatInr(economics.maxInvestmentInr)}
                    </td>
                    <td className="py-3.5 px-3 font-mono whitespace-nowrap tabular-nums">
                      {economics.durationDays} days
                    </td>
                    <td className="py-3.5 px-3 font-mono font-bold text-[#8A6518] whitespace-nowrap tabular-nums">
                      {economics.expectedReturnPercent}%
                    </td>
                    <td className="py-3.5 px-3 whitespace-nowrap">
                      <p className="font-mono font-bold text-emerald-700 tabular-nums">
                        {formatInr(economics.estimatedTotalPayoutInr)}
                      </p>
                      <p className="text-[11px] font-mono text-slate-500 tabular-nums">
                        {formatInr(economics.dailyEarningsInr)} / day
                      </p>
                    </td>
                    <td className="py-3.5 px-3 whitespace-nowrap">
                      <p className="font-mono font-bold text-[#0B1A30] tabular-nums">
                        {planStats?.totalInvestors ?? 0} investors
                      </p>
                      <p className="text-[11px] text-slate-500 tabular-nums">
                        {planStats?.activeInvestmentsCount ?? 0} active
                      </p>
                    </td>
                    <td className="py-3.5 px-3 font-mono font-bold text-[#0B1A30] whitespace-nowrap tabular-nums">
                      {formatInr(planStats?.totalInvestmentAmountInr ?? 0)}
                    </td>
                    <td className="py-3.5 px-3 whitespace-nowrap">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded text-[11px] font-semibold ${
                          plan.isActive
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {plan.isActive ? 'ACTIVE' : 'INACTIVE'}
                      </span>
                    </td>
                    <td className="py-3.5 px-5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => {
                            setEditingPlanId(plan.planId);
                            setProductName(plan.productName);
                            setCategory(plan.category || 'Structured Plan');
                            setDescription(plan.description);
                            setMinInvestmentInr(String(economics.minInvestmentInr));
                            setMaxInvestmentInr(String(economics.maxInvestmentInr));
                            setDurationDays(String(economics.durationDays));
                            setExpectedReturnPercent(String(economics.expectedReturnPercent));
                            setTermsAndConditions(plan.termsAndConditions || DEFAULT_RISK_DISCLOSURE);
                            setImageUrl(plan.imageUrl || '');
                            setIsActive(plan.isActive);
                            formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-[#0B1A30] bg-white border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer disabled:opacity-50"
                        >
                          <Edit3 className="h-3 w-3" aria-hidden="true" />
                          <span>Edit</span>
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void handleToggleActive(plan)}
                          className="px-2.5 py-1.5 text-[11px] font-semibold text-[#0B1A30] bg-[#F8F1DE] border border-[#C59B3B]/50 hover:bg-[#EFE2BF] rounded-md cursor-pointer disabled:opacity-50"
                        >
                          {plan.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                        <button
                          type="button"
                          disabled={isBusy || !deleteCheck.canDelete}
                          title={
                            deleteCheck.canDelete
                              ? 'Delete unused investment plan'
                              : deleteCheck.reason
                          }
                          onClick={() => void handleDelete(plan)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 rounded-md cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Trash2 className="h-3 w-3" aria-hidden="true" />
                          <span>Delete</span>
                        </button>
                      </div>
                      {!deleteCheck.canDelete && (
                        <p className="text-[10px] text-amber-700 mt-1">
                          Has active investments — deactivate instead
                        </p>
                      )}
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
