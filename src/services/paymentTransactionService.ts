import {
  collection,
  doc,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  Unsubscribe,
} from 'firebase/firestore';
import { OperationType, db, handleFirestoreError } from '../firebase/client';
import {
  DepositRequest,
  PaymentGatewayProvider,
  PaymentTransactionRecord,
  PaymentTxStatus,
  PaymentVerificationMethod,
  PaymentWebhookEventOutcome,
  PaymentWebhookEventRecord,
  WebhookVerificationStatus,
} from '../types/domain';
import { convertInrToCoins } from '../utils/formatters';
import {
  buildDepositCreditLockId,
  buildDepositIdempotencyKey,
  buildPaymentTxId,
  buildUtrCreditLockId,
  placeholderWebhookService,
} from '../utils/paymentIdempotency';
import { normalizeUtrReference } from '../utils/upiGateway';
import { AdminActorContext, recordAdminAction } from './adminService';

function toIso(raw: unknown): string {
  if (
    typeof raw === 'object' &&
    raw !== null &&
    'toDate' in raw &&
    typeof (raw as { toDate: unknown }).toDate === 'function'
  ) {
    return (raw as { toDate: () => Date }).toDate().toISOString();
  }
  return typeof raw === 'string' ? raw : '';
}

function createId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 12);
  return `${prefix}_${Date.now()}_${rand}`;
}

export function subscribeAllPaymentTransactions(
  onData: (items: PaymentTransactionRecord[]) => void,
  onError: (msg: string) => void
): Unsubscribe {
  const q = query(collection(db, 'paymentTransactions'), limit(150));
  return onSnapshot(
    q,
    (snap) => {
      const items: PaymentTransactionRecord[] = snap.docs
        .map((docSnap) => {
          const d = docSnap.data();
          return {
            paymentTxId: String(d.paymentTxId || docSnap.id),
            depositId: String(d.depositId || ''),
            uid: String(d.uid || ''),
            userId: String(d.userId || ''),
            provider: (d.provider as PaymentGatewayProvider) || 'UPI_GATEWAY',
            gatewayOrderId: d.gatewayOrderId ? String(d.gatewayOrderId) : undefined,
            gatewayPaymentId: d.gatewayPaymentId ? String(d.gatewayPaymentId) : undefined,
            utrReference: d.utrReference ? String(d.utrReference) : undefined,
            amountInr: Number(d.amountInr || 0),
            coinsToCredit: Number(d.coinsToCredit || 0),
            currency: 'INR' as const,
            idempotencyKey: String(d.idempotencyKey || ''),
            creditLockId: String(d.creditLockId || ''),
            utrLockId: d.utrLockId ? String(d.utrLockId) : undefined,
            verificationMethod:
              (d.verificationMethod as PaymentVerificationMethod) || 'ADMIN_SETTLEMENT',
            webhookVerificationStatus:
              (d.webhookVerificationStatus as WebhookVerificationStatus) || 'NOT_RECEIVED',
            lastWebhookEventId: d.lastWebhookEventId
              ? String(d.lastWebhookEventId)
              : undefined,
            status: (d.status as PaymentTxStatus) || 'PENDING_VERIFICATION',
            coinTransactionId: d.coinTransactionId ? String(d.coinTransactionId) : undefined,
            failureReason: d.failureReason ? String(d.failureReason) : undefined,
            createdAt: toIso(d.createdAt),
            updatedAt: toIso(d.updatedAt),
            creditedAt: d.creditedAt ? toIso(d.creditedAt) : undefined,
          };
        })
        .sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
      onData(items);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, 'paymentTransactions');
      } catch {
        onError('Unable to load payment transaction ledger.');
      }
    }
  );
}

export function subscribePaymentWebhookEvents(
  onData: (items: PaymentWebhookEventRecord[]) => void,
  onError: (msg: string) => void
): Unsubscribe {
  const q = query(collection(db, 'paymentWebhookEvents'), limit(100));
  return onSnapshot(
    q,
    (snap) => {
      const items: PaymentWebhookEventRecord[] = snap.docs
        .map((docSnap) => {
          const d = docSnap.data();
          return {
            eventId: String(d.eventId || docSnap.id),
            gatewayEventId: String(d.gatewayEventId || ''),
            provider: (d.provider as PaymentGatewayProvider) || 'PLACEHOLDER_WEBHOOK',
            paymentTxId: String(d.paymentTxId || ''),
            depositId: String(d.depositId || ''),
            utrReference: d.utrReference ? String(d.utrReference) : undefined,
            amountInr: Number(d.amountInr || 0),
            signaturePresent: Boolean(d.signaturePresent),
            computedDigestPreview: String(d.computedDigestPreview || ''),
            verificationStatus:
              (d.verificationStatus as PaymentWebhookEventOutcome) || 'PLACEHOLDER_HOLD',
            isLiveGatewayActive: Boolean(d.isLiveGatewayActive),
            note: String(d.note || ''),
            actorUid: String(d.actorUid || ''),
            createdAt: toIso(d.createdAt),
          };
        })
        .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
      onData(items);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, 'paymentWebhookEvents');
      } catch {
        onError('Unable to load webhook verification audit log.');
      }
    }
  );
}

/**
 * Integrates deposit orders & PaymentTransaction tracking records with the
 * PlaceholderWebhookVerificationService while enforcing atomic Firestore credit-lock checks.
 * Never mutates coinWallets directly; prevents duplicate crediting across orders & UTRs.
 */
export async function verifyPaymentWithPlaceholderWebhook(params: {
  actor: AdminActorContext;
  deposit: DepositRequest;
  provider?: PaymentGatewayProvider;
  gatewayOrderId?: string;
  gatewayPaymentId?: string;
  simulatedOutcome?: 'VERIFY' | 'HOLD' | 'REJECT_SIGNATURE';
}): Promise<{
  eventId: string;
  paymentTxId: string;
  outcome: PaymentWebhookEventOutcome;
  duplicatePrevented: boolean;
  note: string;
}> {
  const depositId = params.deposit.depositId;
  const paymentTxId = buildPaymentTxId(depositId);
  const creditLockId = buildDepositCreditLockId(depositId);
  const idempotencyKey = buildDepositIdempotencyKey(depositId);
  const provider: PaymentGatewayProvider = params.provider || 'PLACEHOLDER_WEBHOOK';
  const eventId = createId('whevt');
  const gatewayEventId = `gw_evt_${depositId}_${Date.now()}`.slice(0, 128);

  const cleanUtr = params.deposit.utrNumber
    ? normalizeUtrReference(params.deposit.utrNumber)
    : '';
  const utrLockId = cleanUtr ? buildUtrCreditLockId(cleanUtr) : '';

  const verificationResult = await placeholderWebhookService.verifyWebhookPayload({
    gatewayEventId,
    provider,
    depositId,
    uid: params.deposit.uid,
    userId: params.deposit.userId,
    amountInr: params.deposit.amountInr,
    utrReference: cleanUtr || undefined,
    gatewayOrderId: params.gatewayOrderId || `order_${depositId}`.slice(0, 128),
    gatewayPaymentId: params.gatewayPaymentId || `pay_${depositId}`.slice(0, 128),
    signatureHeader: params.simulatedOutcome === 'VERIFY' ? 'placeholder-sig-ok' : undefined,
    simulatedOutcome: params.simulatedOutcome || 'HOLD',
  });

  const depositRef = doc(db, 'depositRequests', depositId);
  const payTxRef = doc(db, 'paymentTransactions', paymentTxId);
  const depLockRef = doc(db, 'paymentCreditLocks', creditLockId);
  const utrLockRef = utrLockId ? doc(db, 'paymentCreditLocks', utrLockId) : null;
  const webhookRef = doc(db, 'paymentWebhookEvents', eventId);

  let finalOutcome: PaymentWebhookEventOutcome = verificationResult.verificationStatus;
  let duplicatePrevented = false;
  let finalNote = verificationResult.note;

  try {
    await runTransaction(db, async (tx) => {
      const [depSnap, payTxSnap, depLockSnap, utrLockSnap, existingEvtSnap] = await Promise.all([
        tx.get(depositRef),
        tx.get(payTxRef),
        tx.get(depLockRef),
        utrLockRef ? tx.get(utrLockRef) : Promise.resolve(null),
        tx.get(webhookRef),
      ]);

      if (!depSnap.exists()) {
        throw new Error('Linked deposit request does not exist.');
      }
      if (existingEvtSnap.exists()) {
        throw new Error('Webhook event ID collision; please retry.');
      }

      const depData = depSnap.data();
      const payTxData = payTxSnap.exists() ? payTxSnap.data() : null;
      const alreadyLocked =
        depLockSnap.exists() ||
        Boolean(utrLockSnap?.exists()) ||
        depData.status === 'APPROVED' ||
        payTxData?.status === 'CREDITED';

      if (alreadyLocked) {
        duplicatePrevented = true;
        finalOutcome = 'DUPLICATE_IGNORED';
        finalNote =
          'Duplicate webhook credit ignored: deterministic paymentCreditLock already exists.';

        tx.set(webhookRef, {
          eventId,
          gatewayEventId,
          provider,
          paymentTxId,
          depositId,
          ...(cleanUtr ? { utrReference: cleanUtr } : {}),
          amountInr: Math.max(1, Math.round(Number(depData.amountInr || 0))),
          signaturePresent: Boolean(params.simulatedOutcome === 'VERIFY'),
          computedDigestPreview: verificationResult.computedDigestPreview.slice(0, 128),
          verificationStatus: 'DUPLICATE_IGNORED',
          isLiveGatewayActive: false,
          note: finalNote.slice(0, 300),
          actorUid: params.actor.uid,
          createdAt: serverTimestamp(),
        });

        if (
          payTxSnap.exists() &&
          payTxData?.status !== 'CREDITED' &&
          payTxData?.status !== 'REJECTED'
        ) {
          tx.update(payTxRef, {
            webhookVerificationStatus: 'DUPLICATE_IGNORED',
            lastWebhookEventId: eventId,
            status: 'DUPLICATE_BLOCKED',
            failureReason: finalNote.slice(0, 300),
            updatedAt: serverTimestamp(),
          });
        }
        return;
      }

      tx.set(webhookRef, {
        eventId,
        gatewayEventId,
        provider,
        paymentTxId,
        depositId,
        ...(cleanUtr ? { utrReference: cleanUtr } : {}),
        amountInr: Math.max(1, Math.round(Number(depData.amountInr || 0))),
        signaturePresent: Boolean(params.simulatedOutcome === 'VERIFY'),
        computedDigestPreview: verificationResult.computedDigestPreview.slice(0, 128),
        verificationStatus: verificationResult.verificationStatus,
        isLiveGatewayActive: false,
        note: verificationResult.note.slice(0, 300),
        actorUid: params.actor.uid,
        createdAt: serverTimestamp(),
      });

      const verifiedAmount = Math.max(100, Math.round(Number(depData.amountInr || 0)));
      const coinsToCredit = convertInrToCoins(verifiedAmount);

      if (payTxSnap.exists()) {
        if (payTxData?.status !== 'CREDITED' && payTxData?.status !== 'REJECTED') {
          tx.update(payTxRef, {
            provider,
            ...(params.gatewayOrderId
              ? { gatewayOrderId: params.gatewayOrderId.slice(0, 128) }
              : {}),
            ...(params.gatewayPaymentId
              ? { gatewayPaymentId: params.gatewayPaymentId.slice(0, 128) }
              : {}),
            verificationMethod: 'WEBHOOK_PLACEHOLDER',
            webhookVerificationStatus: verificationResult.paymentWebhookStatus,
            lastWebhookEventId: eventId,
            status: verificationResult.nextPaymentTxStatus,
            ...(verificationResult.ok ? {} : { failureReason: verificationResult.note.slice(0, 300) }),
            updatedAt: serverTimestamp(),
          });
        }
      } else {
        tx.set(payTxRef, {
          paymentTxId,
          depositId,
          uid: params.deposit.uid,
          userId: params.deposit.userId,
          provider,
          ...(params.gatewayOrderId
            ? { gatewayOrderId: params.gatewayOrderId.slice(0, 128) }
            : {}),
          ...(params.gatewayPaymentId
            ? { gatewayPaymentId: params.gatewayPaymentId.slice(0, 128) }
            : {}),
          ...(cleanUtr ? { utrReference: cleanUtr } : {}),
          amountInr: verifiedAmount,
          coinsToCredit,
          currency: 'INR',
          idempotencyKey,
          creditLockId,
          ...(utrLockId ? { utrLockId } : {}),
          verificationMethod: 'WEBHOOK_PLACEHOLDER',
          webhookVerificationStatus: verificationResult.paymentWebhookStatus,
          lastWebhookEventId: eventId,
          status: verificationResult.nextPaymentTxStatus,
          ...(verificationResult.ok ? {} : { failureReason: verificationResult.note.slice(0, 300) }),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    });
  } catch (err) {
    if (err instanceof Error && !err.message.includes('PERMISSION_DENIED')) {
      throw err;
    }
    handleFirestoreError(err, OperationType.WRITE, `paymentTransactions/${paymentTxId}`);
  }

  await recordAdminAction({
    actor: params.actor,
    actionType: 'PAYMENT_WEBHOOK_VERIFIED',
    targetId: paymentTxId,
    summary: `Placeholder webhook (${provider}) -> ${finalOutcome} on ${depositId} (${params.deposit.userId})`,
  });

  return {
    eventId,
    paymentTxId,
    outcome: finalOutcome,
    duplicatePrevented,
    note: finalNote,
  };
}
