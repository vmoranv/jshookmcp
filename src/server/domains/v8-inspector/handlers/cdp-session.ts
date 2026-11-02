/**
 * Shared CDP session resolution for v8-inspector sub-handlers.
 *
 * The CDP-backed v8 tools (heap snapshot, sampling, allocation tracking,
 * WeakRef scan, WASM inspection, deopt trace, TurboFan inspection) all need a
 * CDP session. Historically each opened one from the page target only. This
 * module adds target-aware resolution: when the browser domain has an attached
 * CDP target (via `browser_attach_cdp_target` — page, worker, service worker,
 * shared worker), v8 tools run against THAT session so heap/allocation state
 * can be captured inside workers, not only the page.
 *
 * Ownership contract — `ResolvedTargetSession.owned`:
 *   - A session resolved from the attached target is managed by the collector
 *     and MUST NOT be detached by the v8 tool (detaching would tear down the
 *     browser domain's attach state).
 *   - A session created from the page fallback is owned by the v8 tool and
 *     must be detached in its finally block.
 */

export interface CDPSessionLike {
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  off?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
  detach(): Promise<void>;
}

/** Provenance of the resolved session — which target it speaks to. */
export interface TargetProvenance {
  /**
   * CDP target type: 'page' | 'worker' | 'service_worker' | 'shared_worker' |
   * … null when unknown.
   */
  type: string | null;
  /** Target URL (page URL or worker script URL). null when unavailable. */
  url: string | null;
  /** CDP target identifier. null for the page fallback. */
  targetId: string | null;
}

/** Subset of the collector's BrowserTargetInfo needed for provenance. */
export interface TargetInfoLike {
  type?: string | null;
  url?: string | null;
  targetId?: string | null;
}

/**
 * How a v8 sub-handler obtains a CDP session. The attached-target accessors
 * come from the browser domain's collector (when present); getPage comes from
 * the pageController. Both are optional so handlers degrade gracefully.
 */
export interface TargetSessionResolver {
  getPage?: () => Promise<unknown>;
  /** Returns the collector's currently-attached CDP target session, or null. */
  getAttachedTargetSession?: () => CDPSessionLike | null;
  /** Returns metadata about the currently-attached target, or null. */
  getAttachedTargetInfo?: () => TargetInfoLike | null;
}

export interface ResolvedTargetSession {
  session: CDPSessionLike | null;
  /**
   * true when THIS resolver created the session (page fallback) and the caller
   * must detach it when done; false when the session is the collector's
   * attached-target session and must be left alone.
   */
  owned: boolean;
  /** Which target the session speaks to (for result provenance). */
  target: TargetProvenance;
}

/**
 * Accept either a legacy getPage function (existing handler call sites and
 * tests pass a bare `async () => page`) or a full TargetSessionResolver (the
 * impl.ts path that wires in the collector's attached target). A bare function
 * is normalized to `{ getPage: fn }` so the handler signatures stay backward
 * compatible.
 */
export type SessionSource = (() => Promise<unknown>) | TargetSessionResolver | undefined;

export function normalizeSessionSource(source: SessionSource): TargetSessionResolver {
  if (typeof source === 'function') {
    return { getPage: source };
  }
  if (source && typeof source === 'object') {
    return source;
  }
  return {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCDPPageLike(value: unknown): value is { createCDPSession: () => Promise<unknown> } {
  return isRecord(value) && typeof value['createCDPSession'] === 'function';
}

function isCDPSessionLike(value: unknown): value is CDPSessionLike {
  return (
    isRecord(value) && typeof value['send'] === 'function' && typeof value['detach'] === 'function'
  );
}

/** Best-effort page URL read — Puppeteer/Playwright expose url() or a .url property. */
function readPageUrl(page: unknown): string | null {
  if (!isRecord(page)) return null;
  const urlProp = page['url'];
  if (typeof urlProp === 'string') return urlProp;
  if (typeof urlProp === 'function') {
    try {
      const result = (urlProp as () => unknown).call(page);
      return typeof result === 'string' ? result : null;
    } catch {
      return null;
    }
  }
  return null;
}

const PAGE_PROVENANCE: TargetProvenance = { type: 'page', url: null, targetId: null };

function emptyResolved(): ResolvedTargetSession {
  return { session: null, owned: false, target: { ...PAGE_PROVENANCE } };
}

/**
 * Resolve a CDP session for a v8 sub-handler.
 *
 * Priority:
 *   (1) The collector's attached-target session — so v8 tools run inside a
 *       worker/service-worker the user attached via `browser_attach_cdp_target`.
 *   (2) A fresh session created from the page fallback.
 * Returns `session: null` when neither is available.
 */
export async function resolveTargetSession(
  resolver: TargetSessionResolver,
): Promise<ResolvedTargetSession> {
  // (1) Attached CDP target — worker/SW/page that browser_attach_cdp_target set.
  const attachedSession = resolver.getAttachedTargetSession?.() ?? null;
  if (attachedSession) {
    const info = resolver.getAttachedTargetInfo?.() ?? null;
    return {
      session: attachedSession,
      owned: false,
      target: {
        type: info?.type ?? null,
        url: info?.url ?? null,
        targetId: info?.targetId ?? null,
      },
    };
  }

  // (2) Page fallback — open a fresh session the caller owns and must detach.
  if (!resolver.getPage) {
    return emptyResolved();
  }
  let page: unknown;
  try {
    page = await resolver.getPage();
  } catch {
    return emptyResolved();
  }
  if (!isCDPPageLike(page)) {
    return emptyResolved();
  }
  try {
    const session = await page.createCDPSession();
    if (!isCDPSessionLike(session)) {
      return emptyResolved();
    }
    return {
      session,
      owned: true,
      target: { type: 'page', url: readPageUrl(page), targetId: null },
    };
  } catch {
    return emptyResolved();
  }
}

/**
 * Wrap a CDP session so page-based modules — which call
 * `page.createCDPSession()` internally and `detach()` the result in their
 * finally block — can safely consume the collector's attached-target session.
 *
 * When `owned` is false (the attached-target case) the wrapper suppresses
 * `detach()` so the browser domain's attach state survives; `send`/`on`/`off`
 * forward to the real session. When `owned` is true the session is returned
 * unchanged (the caller created it and should really detach).
 */
function adoptSession(session: CDPSessionLike, owned: boolean): CDPSessionLike {
  if (owned) {
    return session;
  }
  const adopted: CDPSessionLike = {
    send: ((method: string, params?: Record<string, unknown>) =>
      session.send(method, params)) as CDPSessionLike['send'],
    detach: async () => undefined,
  };
  if (session.on) {
    adopted.on = (event, listener) => session.on?.(event, listener);
  }
  if (session.off) {
    adopted.off = (event, listener) => session.off?.(event, listener);
  }
  if (session.removeListener) {
    adopted.removeListener = (event, listener) => session.removeListener?.(event, listener);
  }
  return adopted;
}

/**
 * Build a page-like adapter whose `createCDPSession()` yields an adopted
 * attached-target session. Lets page-based modules (WasmGcInspector etc.) run
 * against a worker/SW target without any module-layer change.
 */
export function attachSessionAsPage(session: CDPSessionLike): {
  createCDPSession: () => Promise<CDPSessionLike>;
} {
  return {
    createCDPSession: async () => adoptSession(session, false),
  };
}
