import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  subscribeUserDailyRewards,
  subscribeUserTransactions,
} from '../services/transactionService';
import { TransactionStatus } from '../types/domain';
import {
  RealtimeToastItem,
  detectCompletedTransactionToasts,
  detectNewDailyRewardToasts,
} from '../utils/realtimeNotifications';
import { useAuth } from './AuthContext';

interface NotificationToastContextValue {
  toasts: RealtimeToastItem[];
  dismissToast: (id: string) => void;
  clearAllToasts: () => void;
}

const NotificationToastContext = createContext<
  NotificationToastContextValue | undefined
>(undefined);

const MAX_VISIBLE_TOASTS = 4;
const AUTO_DISMISS_MS = 7000;
const DEDUPE_WINDOW_MS = 60000;

export function NotificationToastProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { firebaseUser, authReady } = useAuth();
  const [toasts, setToasts] = useState<RealtimeToastItem[]>([]);

  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const recentDedupeKeysRef = useRef<Map<string, number>>(new Map());

  const dismissToast = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const clearAllToasts = useCallback(() => {
    for (const timer of timersRef.current.values()) {
      clearTimeout(timer);
    }
    timersRef.current.clear();
    setToasts([]);
  }, []);

  const enqueueToasts = useCallback(
    (incoming: RealtimeToastItem[]) => {
      if (incoming.length === 0) return;

      const now = Date.now();
      for (const [key, ts] of recentDedupeKeysRef.current.entries()) {
        if (now - ts > DEDUPE_WINDOW_MS) {
          recentDedupeKeysRef.current.delete(key);
        }
      }

      const fresh = incoming.filter((item) => {
        if (recentDedupeKeysRef.current.has(item.dedupeKey)) {
          return false;
        }
        recentDedupeKeysRef.current.set(item.dedupeKey, now);
        return true;
      });

      if (fresh.length === 0) return;

      setToasts((prev) => {
        const merged = [...fresh, ...prev].slice(0, MAX_VISIBLE_TOASTS);
        const keptIds = new Set(merged.map((t) => t.id));
        for (const [id, timer] of timersRef.current.entries()) {
          if (!keptIds.has(id)) {
            clearTimeout(timer);
            timersRef.current.delete(id);
          }
        }
        return merged;
      });

      for (const item of fresh) {
        const timer = setTimeout(() => {
          dismissToast(item.id);
        }, AUTO_DISMISS_MS);
        timersRef.current.set(item.id, timer);
      }
    },
    [dismissToast]
  );

  useEffect(() => {
    if (!authReady || !firebaseUser || firebaseUser.isAnonymous) {
      clearAllToasts();
      recentDedupeKeysRef.current.clear();
      return;
    }

    const uid = firebaseUser.uid;
    const seenRewardIds = new Set<string>();
    const knownTxStatuses = new Map<string, TransactionStatus>();
    let isInitialRewards = true;
    let isInitialTx = true;

    const unsubRewards = subscribeUserDailyRewards(
      uid,
      (records) => {
        const emitted = detectNewDailyRewardToasts(
          records,
          seenRewardIds,
          isInitialRewards
        );
        isInitialRewards = false;
        enqueueToasts(emitted);
      },
      () => {
        // Subscription permission/offline errors are surfaced cleanly by dashboard panels
      }
    );

    const unsubTx = subscribeUserTransactions(
      uid,
      (transactions) => {
        const emitted = detectCompletedTransactionToasts(
          transactions,
          knownTxStatuses,
          isInitialTx
        );
        isInitialTx = false;
        enqueueToasts(emitted);
      },
      () => {
        // Subscription permission/offline errors are surfaced cleanly by dashboard panels
      }
    );

    return () => {
      unsubRewards();
      unsubTx();
    };
  }, [authReady, firebaseUser, enqueueToasts, clearAllToasts]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);

  return (
    <NotificationToastContext.Provider
      value={{
        toasts,
        dismissToast,
        clearAllToasts,
      }}
    >
      {children}
    </NotificationToastContext.Provider>
  );
}

export function useNotificationToasts() {
  const ctx = useContext(NotificationToastContext);
  if (!ctx) {
    throw new Error(
      'useNotificationToasts must be used within a NotificationToastProvider'
    );
  }
  return ctx;
}
