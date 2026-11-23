import assert from 'node:assert/strict';
import test from 'node:test';
import { RecaptchaFlowController, VerifierHandle } from '../recaptchaManager.ts';

class FakeElement {
  tagName: string;
  attributes: Record<string, string> = {};
  children: FakeElement[] = [];
  parentNode: FakeElement | null = null;
  private _innerHTML = '';

  constructor(tagName = 'div') {
    this.tagName = tagName;
  }

  get innerHTML(): string {
    return this._innerHTML;
  }

  set innerHTML(val: string) {
    this._innerHTML = val;
    if (val === '') {
      for (const child of this.children) {
        child.parentNode = null;
      }
      this.children = [];
    }
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  appendChild(child: FakeElement): FakeElement {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child: FakeElement): FakeElement {
    this.children = this.children.filter((c) => c !== child);
    child.parentNode = null;
    return child;
  }
}

function withFakeDom(run: (wrapper: HTMLElement) => Promise<void> | void) {
  const previousDocument = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = {
    createElement: (tag: string) => new FakeElement(tag),
  };

  const wrapper = new FakeElement('div') as unknown as HTMLElement;
  return Promise.resolve(run(wrapper)).finally(() => {
    if (previousDocument === undefined) {
      delete (globalThis as { document?: unknown }).document;
    } else {
      (globalThis as { document?: unknown }).document = previousDocument;
    }
  });
}

test('RecaptchaFlowController maintains a single active verifier and prevents duplicate rendering in the same element', async () => {
  await withFakeDom(async (wrapper) => {
    const renderedHosts = new Set<HTMLElement>();
    let createCount = 0;
    let clearCount = 0;

    const controller = new RecaptchaFlowController<VerifierHandle>((host) => {
      createCount += 1;
      if (renderedHosts.has(host)) {
        throw new Error('reCAPTCHA has already been rendered in this element');
      }
      renderedHosts.add(host);
      return {
        render: async () => createCount,
        clear: () => {
          clearCount += 1;
        },
      };
    });

    controller.attachWrapper(wrapper);

    const first = await controller.getOrCreateVerifier();
    const second = await controller.getOrCreateVerifier();

    assert.equal(first, second);
    assert.equal(createCount, 1);
    assert.equal(clearCount, 0);
    assert.equal(controller.hasActiveVerifier(), true);
  });
});

test('RecaptchaFlowController clears previous verifier and provisions a brand-new host element on resend/reset', async () => {
  await withFakeDom(async (wrapper) => {
    const renderedHosts = new Set<HTMLElement>();
    const hostsSeen: HTMLElement[] = [];
    let createCount = 0;
    let clearCount = 0;

    const controller = new RecaptchaFlowController<VerifierHandle>((host) => {
      createCount += 1;
      if (renderedHosts.has(host)) {
        throw new Error('reCAPTCHA has already been rendered in this element');
      }
      renderedHosts.add(host);
      hostsSeen.push(host);
      return {
        render: async () => createCount,
        clear: () => {
          clearCount += 1;
        },
      };
    });

    controller.attachWrapper(wrapper);

    const v1 = await controller.getOrCreateVerifier();
    controller.markNeedsReset();
    const v2 = await controller.getOrCreateVerifier();
    const v3 = await controller.getOrCreateVerifier(true);

    assert.notEqual(v1, v2);
    assert.notEqual(v2, v3);
    assert.equal(createCount, 3);
    assert.equal(clearCount, 2);
    assert.equal(hostsSeen.length, 3);
    assert.notEqual(hostsSeen[0], hostsSeen[1]);
    assert.notEqual(hostsSeen[1], hostsSeen[2]);
  });
});

test('RecaptchaFlowController blocks duplicate concurrent Send OTP requests via runExclusive', async () => {
  await withFakeDom(async (wrapper) => {
    const controller = new RecaptchaFlowController<VerifierHandle>(() => ({
      render: async () => 1,
      clear: () => {},
    }));
    controller.attachWrapper(wrapper);

    let releaseTask!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseTask = resolve;
    });

    let calls = 0;
    const firstPromise = controller.runExclusive(async () => {
      calls += 1;
      await gate;
      return 'sent';
    });

    assert.equal(controller.isRequestInFlight(), true);

    const duplicateResult = await controller.runExclusive(async () => {
      calls += 1;
      return 'duplicate';
    });

    assert.equal(duplicateResult.skipped, true);
    assert.equal(calls, 1);

    releaseTask();
    const firstResult = await firstPromise;
    assert.equal(firstResult.skipped, false);
    assert.equal(firstResult.result, 'sent');
    assert.equal(controller.isRequestInFlight(), false);
  });
});

test('RecaptchaFlowController resets cleanly on render error, expiry/error callback, and unmount', async () => {
  await withFakeDom(async (wrapper) => {
    let savedCallbacks: { onExpired: () => void; onError: () => void } | null = null;
    let shouldFailRender = true;
    let clearCount = 0;

    const controller = new RecaptchaFlowController<VerifierHandle>((_host, callbacks) => {
      savedCallbacks = callbacks;
      return {
        render: async () => {
          if (shouldFailRender) {
            throw new Error('Transient reCAPTCHA load error');
          }
          return 42;
        },
        clear: () => {
          clearCount += 1;
        },
      };
    });

    controller.attachWrapper(wrapper);

    await assert.rejects(() => controller.getOrCreateVerifier(), /Transient reCAPTCHA load error/);
    assert.equal(controller.hasActiveVerifier(), false);
    assert.equal(clearCount, 1);

    // Retry after render failure succeeds on a fresh host
    shouldFailRender = false;
    await controller.getOrCreateVerifier();
    assert.equal(controller.hasActiveVerifier(), true);

    // Trigger expired-callback -> marks reset so next call creates fresh instance
    savedCallbacks!.onExpired();
    assert.equal(controller.hasActiveVerifier(), false);
    await controller.getOrCreateVerifier();
    assert.equal(clearCount, 2);
    assert.equal(controller.hasActiveVerifier(), true);

    // Trigger error-callback -> marks reset
    savedCallbacks!.onError();
    assert.equal(controller.hasActiveVerifier(), false);

    // Unmount detaches wrapper and clears verifier
    controller.attachWrapper(null);
    assert.equal(clearCount, 3);
  });
});
