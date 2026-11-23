export interface PlanActivationEmailParams {
  toEmail: string;
  fullName?: string;
  userId?: string;
  productName: string;
  planId: string;
  referenceId: string;
  coinCost?: number;
  durationDays?: number;
  totalRewardEntitlement?: number;
  startDate?: string;
  endDate?: string;
}

export interface TriggerEmailDocument {
  to: string[];
  message: {
    subject: string;
    text: string;
    html: string;
  };
}

const PENDING_STATUSES = new Set(['PENDING', 'PENDING_VERIFICATION']);
const ACTIVE_STATUSES = new Set(['ACTIVE', 'ACTIVATED']);

/**
 * Detects transitions from a pending state ('pending', 'PENDING', 'PENDING_VERIFICATION')
 * to an active state ('active', 'ACTIVE', 'ACTIVATED').
 */
export function isPendingToActiveTransition(
  beforeStatus: unknown,
  afterStatus: unknown
): boolean {
  const prev = String(beforeStatus ?? '')
    .trim()
    .toUpperCase();
  const next = String(afterStatus ?? '')
    .trim()
    .toUpperCase();
  return PENDING_STATUSES.has(prev) && ACTIVE_STATUSES.has(next);
}

export function isValidEmailAddress(email: unknown): email is string {
  if (typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (!trimmed || trimmed.length > 160) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

export function escapeHtml(raw: unknown): string {
  return String(raw ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Generates a deterministic Firestore document ID in the Firebase Extension mail
 * collection so duplicate Cloud Function retries or dual collection updates cannot
 * dispatch duplicate emails for the same activated plan.
 */
export function buildMailDocumentId(
  afterData: Record<string, unknown>,
  fallbackDocId: string
): string {
  const canonicalRef = String(
    afterData.activatedUserPlanId || afterData.userPlanId || fallbackDocId || ''
  ).trim();
  const safeRef = canonicalRef.replace(/[^a-zA-Z0-9_-]/g, '_') || 'plan';
  return `plan_active_${safeRef}`.slice(0, 128);
}

function formatWholeNumber(value: unknown): string {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return '—';
  return Math.round(num).toLocaleString('en-IN');
}

function formatDisplayDate(isoOrRaw: unknown): string {
  if (typeof isoOrRaw !== 'string' || !isoOrRaw.trim()) return '—';
  const parsed = Date.parse(isoOrRaw);
  if (Number.isNaN(parsed)) return isoOrRaw.trim();
  return new Date(parsed).toUTCString();
}

/**
 * Formats an outbound email document matching the schema required by the official
 * Firebase Extension "Trigger Email from Firestore" (firebase/firestore-send-email).
 */
export function buildPlanActivationEmailPayload(
  params: PlanActivationEmailParams
): TriggerEmailDocument {
  const toEmail = params.toEmail.trim().toLowerCase();
  const recipientName = (params.fullName || '').trim() || 'Valued Investor';
  const productName = (params.productName || 'Structured Investment Plan').trim();
  const planId = (params.planId || '—').trim();
  const userId = (params.userId || '—').trim();
  const referenceId = (params.referenceId || '—').trim();
  const coinCostLabel = formatWholeNumber(params.coinCost);
  const durationLabel =
    typeof params.durationDays === 'number' && params.durationDays > 0
      ? `${Math.round(params.durationDays)} Days`
      : '—';
  const rewardLabel = formatWholeNumber(params.totalRewardEntitlement);
  const startLabel = formatDisplayDate(params.startDate);
  const endLabel = formatDisplayDate(params.endDate);

  const subject = `NEXORA INVEST: Your "${productName}" Plan is Now Active`;

  const textLines = [
    `Hello ${recipientName},`,
    '',
    `Your investment plan on NEXORA INVEST has transitioned from pending to ACTIVE.`,
    '',
    `Plan Summary:`,
    `- Plan Name: ${productName}`,
    `- Plan ID: ${planId}`,
    `- Reference ID: ${referenceId}`,
    `- NEXORA Member ID: ${userId}`,
    `- Coin Allocation: ${coinCostLabel} Coins`,
    `- Duration: ${durationLabel}`,
    `- Total Reward Entitlement: ${rewardLabel} Coins`,
    ...(params.startDate ? [`- Start Time: ${startLabel}`] : []),
    ...(params.endDate ? [`- Maturity Time: ${endLabel}`] : []),
    '',
    `You can track daily reward cycles and verified transaction history anytime from your NEXORA INVEST Member Dashboard.`,
    '',
    `Regards,`,
    `NEXORA INVEST Team`,
  ];

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:0 auto;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
      <tr>
        <td style="background-color:#0B1A30;padding:24px 28px;border-bottom:3px solid #C59B3B;">
          <div style="font-size:12px;letter-spacing:1.4px;text-transform:uppercase;color:#D8B45A;font-weight:700;">NEXORA INVEST</div>
          <h1 style="margin:6px 0 0 0;font-size:20px;line-height:1.3;color:#ffffff;font-weight:700;">Investment Plan Activated</h1>
        </td>
      </tr>
      <tr>
        <td style="padding:28px;">
          <p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;">Hello <strong>${escapeHtml(recipientName)}</strong>,</p>
          <p style="margin:0 0 20px 0;font-size:14px;line-height:1.6;color:#334155;">
            Good news — your investment plan status has been verified and updated from <strong>Pending</strong> to <strong style="color:#047857;">Active</strong>. Your reward cycle is now running.
          </p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:20px;">
            <tr>
              <td style="padding:10px 14px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">Plan Name</td>
              <td style="padding:10px 14px;font-size:13px;font-weight:600;color:#0B1A30;text-align:right;border-bottom:1px solid #e2e8f0;">${escapeHtml(productName)}</td>
            </tr>
            <tr>
              <td style="padding:10px 14px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">Member ID</td>
              <td style="padding:10px 14px;font-size:13px;font-family:monospace;color:#0B1A30;text-align:right;border-bottom:1px solid #e2e8f0;">${escapeHtml(userId)}</td>
            </tr>
            <tr>
              <td style="padding:10px 14px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">Plan Reference</td>
              <td style="padding:10px 14px;font-size:13px;font-family:monospace;color:#0B1A30;text-align:right;border-bottom:1px solid #e2e8f0;">${escapeHtml(referenceId)}</td>
            </tr>
            <tr>
              <td style="padding:10px 14px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">Coin Allocation</td>
              <td style="padding:10px 14px;font-size:13px;font-weight:600;color:#0B1A30;text-align:right;border-bottom:1px solid #e2e8f0;">${escapeHtml(coinCostLabel)} Coins</td>
            </tr>
            <tr>
              <td style="padding:10px 14px;font-size:13px;color:#64748b;border-bottom:1px solid #e2e8f0;">Duration</td>
              <td style="padding:10px 14px;font-size:13px;font-weight:600;color:#0B1A30;text-align:right;border-bottom:1px solid #e2e8f0;">${escapeHtml(durationLabel)}</td>
            </tr>
            <tr>
              <td style="padding:10px 14px;font-size:13px;color:#64748b;">Total Reward Entitlement</td>
              <td style="padding:10px 14px;font-size:13px;font-weight:700;color:#A37B22;text-align:right;">${escapeHtml(rewardLabel)} Coins</td>
            </tr>
          </table>
          <p style="margin:0;font-size:12px;line-height:1.6;color:#64748b;">
            Plan ID: <span style="font-family:monospace;">${escapeHtml(planId)}</span>${
              params.startDate
                ? ` &middot; Start: ${escapeHtml(startLabel)}`
                : ''
            }${
              params.endDate ? ` &middot; Maturity: ${escapeHtml(endLabel)}` : ''
            }
          </p>
        </td>
      </tr>
      <tr>
        <td style="background-color:#f8fafc;padding:16px 28px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;">
          This automated notification was sent by NEXORA INVEST because your investment plan became active.
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return {
    to: [toEmail],
    message: {
      subject,
      text: textLines.join('\n'),
      html,
    },
  };
}
