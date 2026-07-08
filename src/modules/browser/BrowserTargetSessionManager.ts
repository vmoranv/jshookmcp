import type { Browser, CDPSession } from 'rebrowser-puppeteer-core';
import type { CDPSessionLike } from '@modules/browser/CDPSessionLike';
import {
  AUTO_MANAGED_TARGET_TYPES,
  CHILD_SESSION_LOOKUP_DELAY_MS,
  CHILD_SESSION_LOOKUP_RETRIES,
  DEFAULT_MANAGED_SCRIPT_PREFIX,
  DEFAULT_PRELOAD_TARGET_TYPES,
  type BrowserTargetInfo,
  type ManagedTargetSessionEntry,
  matchesManagedTargetTypes,
  matchesPersistentScriptTarget,
  matchesTargetFilters,
  normalizeBrowserTargetInfo,
  type PersistentScriptEntry,
  readAttachedTargetSessionId,
  readDetachedTargetSessionId,
  readTargetInfoPayload,
  type TargetFilters,
} from '@modules/browser/BrowserTargetSessionManager.shared';
import {
  attachToFlatTarget,
  detachFromFlatTarget,
  type FlatSessionParentLike,
} from '@modules/browser/flat-target-session';
import { NetworkMonitor } from '@modules/monitor/NetworkMonitor';
import type {
  NetworkActivity,
  NetworkMonitorLike,
  NetworkRequest,
  NetworkResponse,
  NetworkResponseBody,
  NetworkStats,
  NetworkStatus,
} from '@modules/monitor/NetworkMonitor.types';
import {
  buildFetchInterceptorCode,
  buildXHRInterceptorCode,
} from '@modules/monitor/NetworkMonitor.interceptors';
import { logger } from '@utils/logger';
import { ManagedSessionRegistry } from '@modules/browser/BrowserTargetSessionManager.ManagedSessionRegistry';
import {
  WORKER_SCRIPT_MAX,
  WORKER_SCRIPT_SOURCE_MAX_BYTES,
  WORKER_SCRIPT_COLLECT_WAIT_MS,
} from '@src/constants/browser';

export interface DumpedTargetScript {
  scriptId: string;
  url: string;
  startLine?: number;
  endLine?: number;
  length?: number;
  hash?: string;
  sourceMapURL?: string;
  source?: string;
  sourceBytes?: number;
  sourceTruncated?: boolean;
  sourceUnavailable?: boolean;
}

export interface DumpTargetScriptsResult {
  targetId: string;
  targetType: string;
  borrowedManagedSession: boolean;
  totalScripts: number;
  returnedScripts: number;
  truncated: boolean;
  scripts: DumpedTargetScript[];
}

export class BrowserTargetSessionManager implements NetworkMonitorLike {
  private browserSession: CDPSession | null = null;
  private attachedTargetSession: CDPSessionLike | null = null;
  private attachedTargetInfo: BrowserTargetInfo | null = null;
  private attachedTargetBorrowedFromManaged = false;
  private autoAttachEnabled = false;
  private targetListenersBound = false;
  private aggregatedNetworkEnabled = false;
  private readonly registry = new ManagedSessionRegistry();
  private readonly persistentScripts = new Map<string, PersistentScriptEntry>();
  private persistentScriptCounter = 0;
  private browserSessionListeners: {
    attachedToTarget?: (payload: unknown) => void;
    detachedFromTarget?: (payload: unknown) => void;
    targetInfoChanged?: (payload: unknown) => void;
  } = {};

  constructor(private readonly getBrowser: () => Browser | null) {}

  async listTargets(filters: TargetFilters = {}): Promise<BrowserTargetInfo[]> {
    const session = await this.ensureBrowserSession();
    if (filters.discoverOOPIF !== false) {
      await this.ensureAutoAttachEnabled(session);
    }

    const response = (await session.send('Target.getTargets')) as unknown as {
      targetInfos?: Array<Record<string, unknown>>;
    };

    const managedTargetIds = new Set(
      Array.from(this.registry.all()).map((entry) => entry.targetInfo.targetId),
    );
    if (this.attachedTargetInfo?.targetId) {
      managedTargetIds.add(this.attachedTargetInfo.targetId);
    }

    const targets = Array.isArray(response.targetInfos)
      ? response.targetInfos
          .map((target) => this.normalizeTargetInfo(target))
          .filter((target): target is BrowserTargetInfo => target !== null)
          .map((target) => ({
            ...target,
            attached: target.attached || managedTargetIds.has(target.targetId),
          }))
      : [];

    return targets.filter((target) => this.matchesFilters(target, filters));
  }

  async attach(targetId: string): Promise<BrowserTargetInfo> {
    const current = this.attachedTargetInfo;
    if (current?.targetId === targetId && this.attachedTargetSession) {
      return current;
    }

    const targets = await this.listTargets();
    const target = targets.find((entry) => entry.targetId === targetId);
    if (!target) {
      throw new Error(`CDP target not found: ${targetId}`);
    }

    await this.detach();

    const managedSession = this.registry.getByTargetId(targetId);
    if (managedSession) {
      this.attachedTargetSession = managedSession.session;
      this.attachedTargetInfo = managedSession.targetInfo;
      this.attachedTargetBorrowedFromManaged = true;
      return managedSession.targetInfo;
    }

    const session = await this.ensureBrowserSession();
    this.attachedTargetSession = await attachToFlatTarget(
      session as unknown as FlatSessionParentLike,
      targetId,
    );
    this.attachedTargetInfo = target;
    this.attachedTargetBorrowedFromManaged = false;

    const attachedSessionId = this.attachedTargetSession.id?.();
    if (attachedSessionId) {
      const entry: ManagedTargetSessionEntry = {
        sessionId: attachedSessionId,
        session: this.attachedTargetSession,
        targetInfo: target,
        networkMonitor: null,
        managedByAutoAttach: false,
        appliedPersistentScripts: new Map(),
      };
      this.registry.add(attachedSessionId, entry);
      if (this.aggregatedNetworkEnabled && this.shouldManageTargetType(target.type)) {
        await this.ensureSessionNetworkMonitor(this.registry.get(attachedSessionId)!);
      }
      await this.applyPersistentScriptsToEntry(this.registry.get(attachedSessionId)!);
    }

    return target;
  }

  async detach(): Promise<boolean> {
    if (!this.attachedTargetSession) {
      this.attachedTargetInfo = null;
      this.attachedTargetBorrowedFromManaged = false;
      return false;
    }

    const session = this.attachedTargetSession;
    const attachedInfo = this.attachedTargetInfo;
    const borrowed = this.attachedTargetBorrowedFromManaged;

    if (borrowed) {
      this.attachedTargetSession = null;
      this.attachedTargetInfo = null;
      this.attachedTargetBorrowedFromManaged = false;
      return true;
    }

    if (!this.browserSession) {
      throw new Error('Browser CDP session unavailable for target detach');
    }

    await detachFromFlatTarget(this.browserSession, session);

    this.attachedTargetSession = null;
    this.attachedTargetInfo = null;
    this.attachedTargetBorrowedFromManaged = false;

    const sessionId =
      session.id?.() ??
      (attachedInfo?.targetId ? this.registry.getPriorSessionId(attachedInfo.targetId) : null);
    if (sessionId) {
      const entry = this.registry.get(sessionId);
      if (entry && !entry.managedByAutoAttach) {
        await this.disableEntryNetworkMonitor(entry);
        this.registry.remove(sessionId);
      }
    }
    if (attachedInfo?.targetId) {
      this.registry.unmapTargetId(attachedInfo.targetId);
    }

    return true;
  }

  getAttachedTargetSession(): CDPSessionLike | null {
    return this.attachedTargetSession;
  }

  getAttachedTargetInfo(): BrowserTargetInfo | null {
    return this.attachedTargetInfo;
  }

  async evaluate(
    expression: string,
    options: { returnByValue?: boolean; awaitPromise?: boolean } = {},
  ): Promise<unknown> {
    const session = this.requireAttachedTargetSession();
    const response = (await session.send('Runtime.evaluate', {
      expression,
      returnByValue: options.returnByValue ?? true,
      awaitPromise: options.awaitPromise ?? true,
    })) as {
      result?: { value?: unknown; description?: string };
      exceptionDetails?: { text?: string; exception?: { description?: string } };
    };

    if (response.exceptionDetails) {
      const details = response.exceptionDetails;
      throw new Error(
        details.exception?.description ||
          details.text ||
          'Runtime.evaluate failed in attached target',
      );
    }

    return options.returnByValue === false
      ? (response.result ?? null)
      : (response.result?.value ?? null);
  }

  /**
   * Attach a CDP session to an arbitrary target (typically a Service/Web/Shared
   * worker) and dump its parsed scripts via `Debugger.enable` replay. Reuses an
   * already-managed session when available; otherwise attaches a temporary flat
   * session and detaches it afterwards, leaving the currently-attached target
   * untouched.
   */
  async dumpTargetScripts(
    targetId: string,
    options: { includeSource?: boolean; maxScripts?: number } = {},
  ): Promise<DumpTargetScriptsResult> {
    const includeSource = options.includeSource ?? false;
    const maxScripts = Math.max(
      1,
      Math.min(options.maxScripts ?? WORKER_SCRIPT_MAX, WORKER_SCRIPT_MAX),
    );

    const targets = await this.listTargets();
    const target = targets.find((entry) => entry.targetId === targetId);
    if (!target) {
      throw new Error(`CDP target not found: ${targetId}`);
    }

    const managed = this.registry.getByTargetId(targetId);
    const borrowedManagedSession = Boolean(managed);
    let session: CDPSessionLike;
    let ownsSession = false;

    if (managed) {
      session = managed.session;
    } else {
      const browserSession = await this.ensureBrowserSession();
      session = await attachToFlatTarget(
        browserSession as unknown as FlatSessionParentLike,
        targetId,
      );
      ownsSession = true;
    }

    const collected: DumpedTargetScript[] = [];
    const onScriptParsed = (payload: unknown): void => {
      const script = this.readScriptParsedPayload(payload);
      if (script) {
        collected.push(script);
      }
    };

    session.on('Debugger.scriptParsed', onScriptParsed);
    try {
      await session.send('Debugger.enable', {});
      // Debugger.enable replays scriptParsed for already-loaded scripts.
      await this.delay(WORKER_SCRIPT_COLLECT_WAIT_MS);
    } finally {
      session.off('Debugger.scriptParsed', onScriptParsed);
    }

    // Dedupe by scriptId (replay can re-emit) and drop the debugger's own eval frames.
    const uniqueById = new Map<string, DumpedTargetScript>();
    for (const script of collected) {
      if (!uniqueById.has(script.scriptId)) {
        uniqueById.set(script.scriptId, script);
      }
    }
    const allScripts = Array.from(uniqueById.values());
    const totalScripts = allScripts.length;
    const selected = allScripts.slice(0, maxScripts);

    if (includeSource) {
      for (const script of selected) {
        await this.hydrateScriptSource(session, script);
      }
    }

    try {
      await session.send('Debugger.disable', {});
    } catch {
      // Best-effort; some worker targets tear down before disable lands.
    }

    if (ownsSession) {
      try {
        const browserSession = this.browserSession;
        if (browserSession) {
          await detachFromFlatTarget(browserSession, session);
        }
      } catch (error) {
        logger.debug(
          `[BrowserTargetSessionManager] Failed to detach temporary worker session for ${targetId}: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return {
      targetId,
      targetType: target.type,
      borrowedManagedSession,
      totalScripts,
      returnedScripts: selected.length,
      truncated: totalScripts > selected.length,
      scripts: selected,
    };
  }

  private readScriptParsedPayload(payload: unknown): DumpedTargetScript | null {
    if (!payload || typeof payload !== 'object') {
      return null;
    }
    const record = payload as Record<string, unknown>;
    const scriptId = typeof record.scriptId === 'string' ? record.scriptId : null;
    if (!scriptId) {
      return null;
    }
    const url = typeof record.url === 'string' ? record.url : '';
    const script: DumpedTargetScript = { scriptId, url };
    if (typeof record.startLine === 'number') script.startLine = record.startLine;
    if (typeof record.endLine === 'number') script.endLine = record.endLine;
    if (typeof record.length === 'number') script.length = record.length;
    if (typeof record.hash === 'string') script.hash = record.hash;
    if (typeof record.sourceMapURL === 'string' && record.sourceMapURL.length > 0) {
      script.sourceMapURL = record.sourceMapURL;
    }
    return script;
  }

  private async hydrateScriptSource(
    session: CDPSessionLike,
    script: DumpedTargetScript,
  ): Promise<void> {
    try {
      const response = (await session.send('Debugger.getScriptSource', {
        scriptId: script.scriptId,
      })) as { scriptSource?: unknown };
      const source = typeof response?.scriptSource === 'string' ? response.scriptSource : '';
      const sourceBytes = Buffer.byteLength(source, 'utf8');
      script.sourceBytes = sourceBytes;
      if (sourceBytes > WORKER_SCRIPT_SOURCE_MAX_BYTES) {
        script.source = source.slice(0, WORKER_SCRIPT_SOURCE_MAX_BYTES);
        script.sourceTruncated = true;
      } else {
        script.source = source;
        script.sourceTruncated = false;
      }
    } catch (error) {
      script.sourceUnavailable = true;
      logger.debug(
        `[BrowserTargetSessionManager] Debugger.getScriptSource failed for ${script.scriptId}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async captureScreenshot(options?: {
    format?: 'png' | 'jpeg';
    quality?: number;
    clip?: { x: number; y: number; width: number; height: number };
  }): Promise<Buffer> {
    const session = this.requireAttachedTargetSession();

    try {
      await session.send('Page.enable', {});
    } catch {
      // Ignore enable races.
    }

    const params: Record<string, unknown> = {
      format: options?.format ?? 'png',
    };
    if (options?.quality !== undefined) {
      params.quality = options.quality;
    }
    if (options?.clip) {
      params.clip = {
        x: options.clip.x,
        y: options.clip.y,
        width: options.clip.width,
        height: options.clip.height,
        scale: 1,
      };
    }

    const response = (await Promise.race([
      session.send('Page.captureScreenshot', params),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Page.captureScreenshot timed out after 30s')), 30000),
      ),
    ])) as { data?: string };

    if (!response?.data) {
      throw new Error('Page.captureScreenshot returned no data');
    }

    return Buffer.from(response.data, 'base64');
  }

  async addScriptToEvaluateOnNewDocument(source: string): Promise<{
    identifier: string;
    appliedTargets: number;
  }> {
    return this.registerPersistentScript(source, {
      evaluateNow: true,
      targetTypes: DEFAULT_PRELOAD_TARGET_TYPES,
    });
  }

  async registerPersistentScript(
    source: string,
    options?: { id?: string; evaluateNow?: boolean; targetTypes?: string[] },
  ): Promise<{ identifier: string; appliedTargets: number }> {
    const identifier =
      options?.id ?? `${DEFAULT_MANAGED_SCRIPT_PREFIX}-${++this.persistentScriptCounter}`;
    const scriptEntry: PersistentScriptEntry = {
      id: identifier,
      source,
      targetTypes: options?.targetTypes?.length ? [...options.targetTypes] : undefined,
    };
    this.persistentScripts.set(identifier, scriptEntry);

    const session = await this.ensureBrowserSession();
    await this.ensureAutoAttachEnabled(session);
    await this.bootstrapManagedTargets({
      targetTypes: scriptEntry.targetTypes,
    });

    let appliedTargets = 0;
    for (const entry of this.registry.all()) {
      if (!this.matchesScriptTarget(entry.targetInfo, scriptEntry)) {
        continue;
      }

      await this.applyPersistentScriptToEntry(entry, scriptEntry);
      if (options?.evaluateNow) {
        await this.evaluateExpressionInEntry(entry, source).catch((error) => {
          logger.debug(
            `[BrowserTargetSessionManager] Immediate script evaluate failed for ${entry.targetInfo.targetId}: ` +
              `${error instanceof Error ? error.message : String(error)}`,
          );
        });
      }
      appliedTargets += 1;
    }

    return { identifier, appliedTargets };
  }

  async evaluateInManagedTargets(
    expression: string,
    options?: { targetTypes?: string[] },
  ): Promise<number> {
    const session = await this.ensureBrowserSession();
    await this.ensureAutoAttachEnabled(session);

    let evaluatedTargets = 0;
    for (const entry of this.registry.all()) {
      if (!this.matchesTargetTypes(entry.targetInfo.type, options?.targetTypes)) {
        continue;
      }
      await this.evaluateExpressionInEntry(entry, expression).catch((error) => {
        logger.debug(
          `[BrowserTargetSessionManager] evaluateInManagedTargets failed for ${entry.targetInfo.targetId}: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      });
      evaluatedTargets += 1;
    }

    return evaluatedTargets;
  }

  async enable(): Promise<void> {
    const session = await this.ensureBrowserSession();
    await this.ensureAutoAttachEnabled(session);
    await this.bootstrapManagedTargets();
    this.aggregatedNetworkEnabled = true;

    for (const entry of this.registry.all()) {
      if (!this.shouldManageTargetType(entry.targetInfo.type)) {
        continue;
      }
      await this.ensureSessionNetworkMonitor(entry);
    }
  }

  async disable(): Promise<void> {
    this.aggregatedNetworkEnabled = false;
    for (const entry of this.registry.all()) {
      await this.disableEntryNetworkMonitor(entry);
    }
  }

  isEnabled(): boolean {
    return this.aggregatedNetworkEnabled;
  }

  getStatus(): NetworkStatus {
    let requestCount = 0;
    let responseCount = 0;
    let listenerCount = this.targetListenersBound ? 3 : 0;

    for (const entry of this.registry.all()) {
      if (!entry.networkMonitor) {
        continue;
      }
      const status = entry.networkMonitor.getStatus();
      requestCount += status.requestCount;
      responseCount += status.responseCount;
      listenerCount += status.listenerCount;
    }

    return {
      enabled: this.aggregatedNetworkEnabled,
      requestCount,
      responseCount,
      listenerCount,
      cdpSessionActive: this.browserSession !== null,
    };
  }

  getRequests(filter?: { url?: string; method?: string; limit?: number }): NetworkRequest[] {
    let requests = Array.from(this.registry.all()).flatMap(
      (entry) => entry.networkMonitor?.getRequests() ?? [],
    );
    requests.sort((left, right) => (left.timestamp ?? 0) - (right.timestamp ?? 0));

    const url = filter?.url;
    if (typeof url === 'string' && url.length > 0) {
      requests = requests.filter((req) => req.url.includes(url));
    }
    const method = filter?.method;
    if (typeof method === 'string' && method.length > 0) {
      requests = requests.filter((req) => req.method === method);
    }
    if (typeof filter?.limit === 'number' && Number.isFinite(filter.limit)) {
      requests = requests.slice(-filter.limit);
    }

    return requests;
  }

  getResponses(filter?: { url?: string; status?: number; limit?: number }): NetworkResponse[] {
    let responses = Array.from(this.registry.all()).flatMap(
      (entry) => entry.networkMonitor?.getResponses() ?? [],
    );
    responses.sort((left, right) => (left.timestamp ?? 0) - (right.timestamp ?? 0));

    const url = filter?.url;
    if (typeof url === 'string' && url.length > 0) {
      responses = responses.filter((res) => res.url.includes(url));
    }
    if (typeof filter?.status === 'number') {
      responses = responses.filter((res) => res.status === filter.status);
    }
    if (typeof filter?.limit === 'number' && Number.isFinite(filter.limit)) {
      responses = responses.slice(-filter.limit);
    }

    return responses;
  }

  getActivity(requestId: string): NetworkActivity {
    for (const entry of this.registry.all()) {
      if (!entry.networkMonitor) {
        continue;
      }
      const activity = entry.networkMonitor.getActivity(requestId);
      if (activity.request || activity.response) {
        return activity;
      }
    }
    return {};
  }

  async getResponseBody(requestId: string): Promise<NetworkResponseBody | null> {
    for (const entry of this.registry.all()) {
      if (!entry.networkMonitor) {
        continue;
      }

      const activity = entry.networkMonitor.getActivity(requestId);
      if (!activity.request && !activity.response) {
        continue;
      }

      return entry.networkMonitor.getResponseBody(requestId);
    }
    return null;
  }

  async getAllJavaScriptResponses(): Promise<
    Array<{
      url: string;
      content: string;
      size: number;
      requestId: string;
    }>
  > {
    const results = await Promise.all(
      Array.from(this.registry.all()).map(async (entry) =>
        entry.networkMonitor ? await entry.networkMonitor.getAllJavaScriptResponses() : [],
      ),
    );
    return results.flat();
  }

  clearRecords(): void {
    for (const entry of this.registry.all()) {
      entry.networkMonitor?.clearRecords();
    }
  }

  async clearInjectedBuffers(): Promise<{ xhrCleared: number; fetchCleared: number }> {
    let xhrCleared = 0;
    let fetchCleared = 0;

    for (const entry of this.registry.all()) {
      if (!entry.networkMonitor) {
        continue;
      }
      const result = await entry.networkMonitor.clearInjectedBuffers();
      xhrCleared += result.xhrCleared;
      fetchCleared += result.fetchCleared;
    }

    return { xhrCleared, fetchCleared };
  }

  async resetInjectedInterceptors(): Promise<{ xhrReset: boolean; fetchReset: boolean }> {
    let xhrReset = false;
    let fetchReset = false;

    for (const entry of this.registry.all()) {
      if (!entry.networkMonitor) {
        continue;
      }
      const result = await entry.networkMonitor.resetInjectedInterceptors();
      xhrReset = xhrReset || result.xhrReset;
      fetchReset = fetchReset || result.fetchReset;
    }

    return { xhrReset, fetchReset };
  }

  getStats(): NetworkStats {
    const byMethod: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    const byType: Record<string, number> = {};

    let totalRequests = 0;
    let totalResponses = 0;

    for (const entry of this.registry.all()) {
      const stats = entry.networkMonitor?.getStats();
      if (!stats) {
        continue;
      }

      totalRequests += stats.totalRequests;
      totalResponses += stats.totalResponses;

      for (const [method, count] of Object.entries(stats.byMethod)) {
        byMethod[method] = (byMethod[method] || 0) + count;
      }
      for (const [status, count] of Object.entries(stats.byStatus)) {
        byStatus[status] = (byStatus[status] || 0) + count;
      }
      for (const [type, count] of Object.entries(stats.byType)) {
        byType[type] = (byType[type] || 0) + count;
      }
    }

    return {
      totalRequests,
      totalResponses,
      byMethod,
      byStatus,
      byType,
    };
  }

  async injectXHRInterceptor(options?: { persistent?: boolean }): Promise<void> {
    const interceptorCode = buildXHRInterceptorCode(500);
    if (options?.persistent) {
      await this.registerPersistentScript(interceptorCode, {
        id: 'network-xhr-interceptor',
        evaluateNow: true,
        targetTypes: DEFAULT_PRELOAD_TARGET_TYPES,
      });
      logger.info('XHR interceptor injected (persistent)');
      return;
    }

    await this.evaluateInManagedTargets(interceptorCode, {
      targetTypes: DEFAULT_PRELOAD_TARGET_TYPES,
    });
    logger.info('XHR interceptor injected');
  }

  async injectFetchInterceptor(options?: { persistent?: boolean }): Promise<void> {
    const interceptorCode = buildFetchInterceptorCode(500);
    if (options?.persistent) {
      await this.registerPersistentScript(interceptorCode, {
        id: 'network-fetch-interceptor',
        evaluateNow: true,
        targetTypes: DEFAULT_PRELOAD_TARGET_TYPES,
      });
      logger.info('Fetch interceptor injected (persistent)');
      return;
    }

    await this.evaluateInManagedTargets(interceptorCode, {
      targetTypes: DEFAULT_PRELOAD_TARGET_TYPES,
    });
    logger.info('Fetch interceptor injected');
  }

  async getXHRRequests(): Promise<Record<string, unknown>[]> {
    const results = await Promise.all(
      Array.from(this.registry.all()).map((entry) => this.getEntryInjectedRequests(entry, 'xhr')),
    );
    return results.flat();
  }

  async getFetchRequests(): Promise<Record<string, unknown>[]> {
    const results = await Promise.all(
      Array.from(this.registry.all()).map((entry) => this.getEntryInjectedRequests(entry, 'fetch')),
    );
    return results.flat();
  }

  persistsAcrossContextSwitches(): boolean {
    return this.aggregatedNetworkEnabled;
  }

  async dispose(): Promise<void> {
    try {
      await this.detach();
      await this.disable();
      this.persistentScripts.clear();

      if (this.browserSession) {
        this.unbindBrowserSessionListeners(this.browserSession);
        try {
          await this.browserSession.detach();
        } catch {
          // Ignore shutdown races.
        }
      }
    } finally {
      this.registry.clear();
      this.registry.clear();
      this.browserSession = null;
      this.autoAttachEnabled = false;
      this.targetListenersBound = false;
    }
  }

  private requireAttachedTargetSession(): CDPSessionLike {
    if (!this.attachedTargetSession) {
      throw new Error('No CDP target is currently attached');
    }
    return this.attachedTargetSession;
  }

  private async ensureBrowserSession(): Promise<CDPSession> {
    if (this.browserSession) {
      return this.browserSession;
    }

    const browser = this.getBrowser();
    if (!browser) {
      throw new Error('Browser not connected');
    }

    this.browserSession = await browser.target().createCDPSession();
    return this.browserSession;
  }

  private async ensureAutoAttachEnabled(session: CDPSession): Promise<void> {
    if (!this.targetListenersBound) {
      this.bindBrowserSessionListeners(session);
    }

    if (this.autoAttachEnabled) {
      return;
    }

    try {
      await session.send('Target.setAutoAttach', {
        autoAttach: true,
        waitForDebuggerOnStart: false,
        flatten: true,
      });
      await session.send('Target.setDiscoverTargets', {
        discover: true,
      });
      this.autoAttachEnabled = true;
    } catch {
      // Older Chrome versions may not support these params; continue with basic listing
    }
  }

  private bindBrowserSessionListeners(session: CDPSession): void {
    if (this.targetListenersBound) {
      return;
    }

    this.browserSessionListeners.attachedToTarget = (payload: unknown) => {
      void this.handleAttachedToTarget(payload);
    };
    this.browserSessionListeners.detachedFromTarget = (payload: unknown) => {
      void this.handleDetachedFromTarget(payload);
    };
    this.browserSessionListeners.targetInfoChanged = (payload: unknown) => {
      this.handleTargetInfoChanged(payload);
    };

    session.on('Target.attachedToTarget', this.browserSessionListeners.attachedToTarget);
    session.on('Target.detachedFromTarget', this.browserSessionListeners.detachedFromTarget);
    session.on('Target.targetInfoChanged', this.browserSessionListeners.targetInfoChanged);
    this.targetListenersBound = true;
  }

  private unbindBrowserSessionListeners(session: CDPSession): void {
    if (!this.targetListenersBound) {
      return;
    }

    if (this.browserSessionListeners.attachedToTarget) {
      session.off('Target.attachedToTarget', this.browserSessionListeners.attachedToTarget);
    }
    if (this.browserSessionListeners.detachedFromTarget) {
      session.off('Target.detachedFromTarget', this.browserSessionListeners.detachedFromTarget);
    }
    if (this.browserSessionListeners.targetInfoChanged) {
      session.off('Target.targetInfoChanged', this.browserSessionListeners.targetInfoChanged);
    }
    this.browserSessionListeners = {};
    this.targetListenersBound = false;
  }

  private async handleAttachedToTarget(payload: unknown): Promise<void> {
    const sessionId = this.readAttachedSessionId(payload);
    const rawTargetInfo = this.readTargetInfoRecord(payload);
    const targetInfo = rawTargetInfo ? this.normalizeTargetInfo(rawTargetInfo) : null;

    if (!sessionId || !targetInfo || !this.shouldManageTargetType(targetInfo.type)) {
      return;
    }

    const browserSession = this.browserSession as unknown as FlatSessionParentLike | null;
    const childSession = await this.lookupChildSession(browserSession, sessionId);
    if (!childSession) {
      logger.debug(
        `[BrowserTargetSessionManager] Auto-attached child session ${sessionId} unavailable for ${targetInfo.targetId}`,
      );
      return;
    }

    const existing = this.registry.get(sessionId);
    if (existing) {
      existing.targetInfo = targetInfo;
      this.registry.mapTargetIdToSession(targetInfo.targetId, sessionId);
      if (
        this.attachedTargetInfo?.targetId === targetInfo.targetId &&
        this.attachedTargetBorrowedFromManaged
      ) {
        this.attachedTargetInfo = targetInfo;
      }
      return;
    }

    const priorSessionId = this.registry.getPriorSessionId(targetInfo.targetId);
    if (priorSessionId && priorSessionId !== sessionId) {
      const priorEntry = this.registry.get(priorSessionId);
      if (priorEntry && !priorEntry.managedByAutoAttach) {
        await this.disableEntryNetworkMonitor(priorEntry);
        this.registry.remove(priorSessionId);
      }
    }

    const entry: ManagedTargetSessionEntry = {
      sessionId,
      session: childSession,
      targetInfo,
      networkMonitor: null,
      managedByAutoAttach: true,
      appliedPersistentScripts: new Map(),
    };
    this.registry.add(sessionId, entry);
    this.registry.mapTargetIdToSession(targetInfo.targetId, sessionId);

    if (this.aggregatedNetworkEnabled) {
      await this.ensureSessionNetworkMonitor(entry);
    }
    await this.applyPersistentScriptsToEntry(entry);

    if (!this.attachedTargetSession && this.attachedTargetInfo?.targetId === targetInfo.targetId) {
      this.attachedTargetSession = childSession;
      this.attachedTargetBorrowedFromManaged = true;
    }
  }

  private async bootstrapManagedTargets(options?: { targetTypes?: string[] }): Promise<void> {
    const targets = await this.listTargets({ discoverOOPIF: false });
    for (const target of targets) {
      if (!this.shouldManageTargetType(target.type)) {
        continue;
      }
      if (!this.matchesTargetTypes(target.type, options?.targetTypes)) {
        continue;
      }
      await this.ensureManagedTargetSession(target);
    }
  }

  private async ensureManagedTargetSession(targetInfo: BrowserTargetInfo): Promise<void> {
    if (this.registry.getByTargetId(targetInfo.targetId)) {
      return;
    }

    const session = await this.ensureBrowserSession();
    const attachedSession = await attachToFlatTarget(
      session as unknown as FlatSessionParentLike,
      targetInfo.targetId,
    );
    const sessionId = attachedSession.id?.();
    if (!sessionId) {
      throw new Error(`Managed target session id unavailable for ${targetInfo.targetId}`);
    }

    const existing = this.registry.get(sessionId);
    if (existing) {
      existing.targetInfo = targetInfo;
      this.registry.mapTargetIdToSession(targetInfo.targetId, sessionId);
      return;
    }

    const entry: ManagedTargetSessionEntry = {
      sessionId,
      session: attachedSession,
      targetInfo,
      networkMonitor: null,
      managedByAutoAttach: false,
      appliedPersistentScripts: new Map(),
    };
    this.registry.add(sessionId, entry);
    this.registry.mapTargetIdToSession(targetInfo.targetId, sessionId);

    if (this.aggregatedNetworkEnabled) {
      await this.ensureSessionNetworkMonitor(entry);
    }
  }

  private async handleDetachedFromTarget(payload: unknown): Promise<void> {
    const sessionId =
      this.readDetachedSessionId(payload) ?? this.readAttachedSessionId(payload) ?? null;
    if (!sessionId) {
      return;
    }

    const entry = this.registry.get(sessionId);
    if (!entry) {
      return;
    }

    await this.disableEntryNetworkMonitor(entry);
    this.registry.remove(sessionId);

    const mappedSessionId = this.registry.getPriorSessionId(entry.targetInfo.targetId);
    if (mappedSessionId === sessionId) {
      this.registry.unmapTargetId(entry.targetInfo.targetId);
    }

    if (this.attachedTargetSession === entry.session && this.attachedTargetBorrowedFromManaged) {
      this.attachedTargetSession = null;
      this.attachedTargetInfo = null;
      this.attachedTargetBorrowedFromManaged = false;
    }
  }

  private handleTargetInfoChanged(payload: unknown): void {
    const rawTargetInfo = this.readTargetInfoRecord(payload);
    const targetInfo = rawTargetInfo ? this.normalizeTargetInfo(rawTargetInfo) : null;
    if (!targetInfo) {
      return;
    }

    const sessionId = this.registry.getPriorSessionId(targetInfo.targetId);
    if (sessionId) {
      const entry = this.registry.get(sessionId);
      if (entry) {
        entry.targetInfo = targetInfo;
      }
    }

    if (this.attachedTargetInfo?.targetId === targetInfo.targetId) {
      this.attachedTargetInfo = targetInfo;
    }
  }

  private async ensureSessionNetworkMonitor(entry: ManagedTargetSessionEntry): Promise<void> {
    if (entry.networkMonitor || !this.aggregatedNetworkEnabled) {
      return;
    }

    entry.networkMonitor = new NetworkMonitor(entry.session, {
      sessionId: entry.sessionId,
      targetId: entry.targetInfo.targetId,
      targetType: entry.targetInfo.type,
      requestIdPrefix: entry.targetInfo.targetId,
    });
    await entry.networkMonitor.enable();
  }

  private async disableEntryNetworkMonitor(entry: ManagedTargetSessionEntry): Promise<void> {
    if (!entry.networkMonitor) {
      return;
    }

    try {
      await entry.networkMonitor.disable();
    } catch (error) {
      logger.debug(
        `[BrowserTargetSessionManager] Failed to disable network monitor for ${entry.targetInfo.targetId}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      entry.networkMonitor = null;
    }
  }

  private async applyPersistentScriptsToEntry(entry: ManagedTargetSessionEntry): Promise<void> {
    for (const script of this.persistentScripts.values()) {
      if (!this.matchesScriptTarget(entry.targetInfo, script)) {
        continue;
      }
      await this.applyPersistentScriptToEntry(entry, script);
    }
  }

  private async applyPersistentScriptToEntry(
    entry: ManagedTargetSessionEntry,
    script: PersistentScriptEntry,
  ): Promise<void> {
    const existingSource = entry.appliedPersistentScripts.get(script.id);
    if (existingSource === script.source) {
      return;
    }

    try {
      await entry.session.send('Page.addScriptToEvaluateOnNewDocument', {
        source: script.source,
      });
      entry.appliedPersistentScripts.set(script.id, script.source);
    } catch (error) {
      logger.debug(
        `[BrowserTargetSessionManager] Failed to register preload script ${script.id} on ${entry.targetInfo.targetId}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async evaluateExpressionInEntry(
    entry: ManagedTargetSessionEntry,
    expression: string,
  ): Promise<void> {
    await entry.session.send('Runtime.evaluate', {
      expression,
      returnByValue: false,
      awaitPromise: true,
    });
  }

  private async getEntryInjectedRequests(
    entry: ManagedTargetSessionEntry,
    kind: 'xhr' | 'fetch',
  ): Promise<Record<string, unknown>[]> {
    if (!entry.networkMonitor) {
      return [];
    }

    const rawRequests =
      kind === 'xhr'
        ? await entry.networkMonitor.getXHRRequests()
        : await entry.networkMonitor.getFetchRequests();

    return rawRequests.map((request, index) => ({
      ...request,
      sessionId: entry.sessionId,
      targetId: entry.targetInfo.targetId,
      targetType: entry.targetInfo.type,
      requestId:
        typeof request.requestId === 'string' && request.requestId.length > 0
          ? request.requestId
          : `${entry.targetInfo.targetId}:${kind}-injected-${index}`,
    }));
  }

  private async lookupChildSession(
    browserSession: FlatSessionParentLike | null,
    sessionId: string,
  ): Promise<CDPSessionLike | null> {
    for (let attempt = 0; attempt < CHILD_SESSION_LOOKUP_RETRIES; attempt += 1) {
      const childSession = browserSession?.connection?.()?.session(sessionId) ?? null;
      if (childSession) {
        return childSession;
      }
      if (attempt < CHILD_SESSION_LOOKUP_RETRIES - 1) {
        await this.delay(CHILD_SESSION_LOOKUP_DELAY_MS);
      }
    }
    return null;
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private shouldManageTargetType(type: string): boolean {
    return AUTO_MANAGED_TARGET_TYPES.has(type);
  }

  private matchesScriptTarget(
    targetInfo: BrowserTargetInfo,
    script: PersistentScriptEntry,
  ): boolean {
    return matchesPersistentScriptTarget(targetInfo, script);
  }

  private matchesTargetTypes(type: string, targetTypes?: string[]): boolean {
    return matchesManagedTargetTypes(type, targetTypes);
  }

  private matchesFilters(target: BrowserTargetInfo, filters: TargetFilters): boolean {
    return matchesTargetFilters(target, filters);
  }

  private normalizeTargetInfo(target: Record<string, unknown>): BrowserTargetInfo | null {
    return normalizeBrowserTargetInfo(target);
  }

  private readAttachedSessionId(payload: unknown): string | null {
    return readAttachedTargetSessionId(payload);
  }

  private readDetachedSessionId(payload: unknown): string | null {
    return readDetachedTargetSessionId(payload);
  }

  private readTargetInfoRecord(payload: unknown): Record<string, unknown> | null {
    return readTargetInfoPayload(payload);
  }
}
