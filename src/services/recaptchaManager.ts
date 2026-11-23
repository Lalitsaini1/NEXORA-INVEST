import { Auth, RecaptchaVerifier } from 'firebase/auth';

export interface VerifierHandle {
  render: () => Promise<number>;
  clear: () => void;
}

export type VerifierFactory<TVerifier extends VerifierHandle = VerifierHandle> = (
  hostElement: HTMLElement,
  callbacks: {
    onExpired: () => void;
    onError: () => void;
  }
) => TVerifier;

export function createFirebaseVerifierFactory(auth: Auth): VerifierFactory<RecaptchaVerifier> {
  return (hostElement, callbacks) =>
    new RecaptchaVerifier(auth, hostElement, {
      size: 'invisible',
      'expired-callback': callbacks.onExpired,
      'error-callback': callbacks.onError,
    });
}

/**
 * Manages a single active RecaptchaVerifier instance per UI flow.
 * Ensures:
 * - At most one active verifier exists at any time.
 * - A fresh child DOM host element is created on every initialization/reset
 *   so grecaptcha never encounters a previously rendered element.
 * - Concurrent Send OTP requests are blocked synchronously via an in-flight lock.
 */
export class RecaptchaFlowController<TVerifier extends VerifierHandle = RecaptchaVerifier> {
  private wrapperEl: HTMLElement | null = null;
  private hostEl: HTMLElement | null = null;
  private verifier: TVerifier | null = null;
  private renderPromise: Promise<number> | null = null;
  private needsReset = false;
  private inFlight = false;
  private readonly createVerifier: VerifierFactory<TVerifier>;

  constructor(createVerifier: VerifierFactory<TVerifier>) {
    this.createVerifier = createVerifier;
  }

  attachWrapper(el: HTMLElement | null): void {
    if (this.wrapperEl === el) return;
    if (this.wrapperEl && this.wrapperEl !== el) {
      // Wrapper unmounted or replaced; clear any stale verifier bound to the previous DOM node
      this.clear();
    }
    this.wrapperEl = el;
  }

  isRequestInFlight(): boolean {
    return this.inFlight;
  }

  hasActiveVerifier(): boolean {
    return this.verifier !== null && !this.needsReset;
  }

  markNeedsReset(): void {
    this.needsReset = true;
  }

  async getOrCreateVerifier(forceReset = false): Promise<TVerifier> {
    if (!this.wrapperEl) {
      throw new Error('reCAPTCHA container is not mounted. Please reload and try again.');
    }

    if (forceReset || this.needsReset) {
      this.clear();
    }

    if (this.verifier) {
      if (this.renderPromise) {
        await this.renderPromise;
      }
      return this.verifier;
    }

    // Create an isolated, brand-new child host element inside the wrapper
    this.wrapperEl.innerHTML = '';
    const host = document.createElement('div');
    host.setAttribute('data-nexora-recaptcha-host', 'true');
    this.wrapperEl.appendChild(host);
    this.hostEl = host;

    const instance = this.createVerifier(host, {
      onExpired: () => {
        this.needsReset = true;
      },
      onError: () => {
        this.needsReset = true;
      },
    });

    this.verifier = instance;
    this.needsReset = false;

    try {
      this.renderPromise = instance.render();
      await this.renderPromise;
      return instance;
    } catch (err) {
      if (this.verifier === instance) {
        this.clear();
      }
      throw err;
    }
  }

  async runExclusive<T>(task: () => Promise<T>): Promise<{ skipped: boolean; result?: T }> {
    if (this.inFlight) {
      return { skipped: true };
    }
    this.inFlight = true;
    try {
      const result = await task();
      return { skipped: false, result };
    } finally {
      this.inFlight = false;
    }
  }

  clear(): void {
    if (this.verifier) {
      try {
        this.verifier.clear();
      } catch {
        // Ignore clear errors on destroyed widgets
      }
    }
    this.verifier = null;
    this.renderPromise = null;
    this.needsReset = false;

    if (this.hostEl && this.hostEl.parentNode) {
      this.hostEl.parentNode.removeChild(this.hostEl);
    }
    this.hostEl = null;

    if (this.wrapperEl) {
      this.wrapperEl.innerHTML = '';
    }
  }
}
