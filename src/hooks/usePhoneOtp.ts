import { useCallback, useEffect, useRef, useState } from 'react';
import { ConfirmationResult, RecaptchaVerifier } from 'firebase/auth';
import { auth } from '../firebase/client';
import {
  createFirebaseVerifierFactory,
  RecaptchaFlowController,
} from '../services/recaptchaManager';
import { mapFirebaseError } from '../services/authService';

interface UsePhoneOtpOptions {
  cooldownSeconds?: number;
}

export function usePhoneOtp(options: UsePhoneOtpOptions = {}) {
  const cooldownDuration = options.cooldownSeconds ?? 30;

  const controllerRef = useRef<RecaptchaFlowController<RecaptchaVerifier> | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new RecaptchaFlowController<RecaptchaVerifier>(
      createFirebaseVerifierFactory(auth)
    );
  }

  const [sendingOtp, setSendingOtp] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [cooldownSec, setCooldownSec] = useState(0);
  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null);

  const attachRecaptchaContainer = useCallback((el: HTMLDivElement | null) => {
    controllerRef.current?.attachWrapper(el);
  }, []);

  useEffect(() => {
    if (cooldownSec <= 0) return;
    const timer = window.setInterval(() => {
      setCooldownSec((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldownSec]);

  useEffect(() => {
    const controller = controllerRef.current;
    return () => {
      controller?.clear();
    };
  }, []);

  const sendOtpWithVerifier = useCallback(
    async (
      dispatchFn: (verifier: RecaptchaVerifier) => Promise<ConfirmationResult>,
      options?: { isResend?: boolean }
    ): Promise<{ dispatched: boolean; error?: string }> => {
      const controller = controllerRef.current;
      if (!controller) {
        return { dispatched: false, error: 'Verification service unavailable. Please reload.' };
      }

      if (controller.isRequestInFlight()) {
        return { dispatched: false };
      }

      setSendingOtp(true);
      try {
        const exec = await controller.runExclusive(async () => {
          // Force fresh host & verifier on resend so the previous solved token isn't stale
          const verifier = await controller.getOrCreateVerifier(Boolean(options?.isResend));
          return dispatchFn(verifier);
        });

        if (exec.skipped || !exec.result) {
          return { dispatched: false };
        }

        setConfirmationResult(exec.result);
        setOtpSent(true);
        setCooldownSec(cooldownDuration);
        // After a successful send, mark for clean reset if the user later clicks Resend
        controller.markNeedsReset();
        return { dispatched: true };
      } catch (err) {
        // Always reset & clear failed verifier so the next retry uses a clean DOM element
        controller.clear();
        return { dispatched: false, error: mapFirebaseError(err) };
      } finally {
        setSendingOtp(false);
      }
    },
    [cooldownDuration]
  );

  const resetOtpFlow = useCallback(() => {
    controllerRef.current?.clear();
    setOtpSent(false);
    setCooldownSec(0);
    setConfirmationResult(null);
  }, []);

  return {
    attachRecaptchaContainer,
    sendingOtp,
    otpSent,
    cooldownSec,
    confirmationResult,
    sendOtpWithVerifier,
    resetOtpFlow,
  };
}
