import type { CDPSession } from 'rebrowser-puppeteer-core';
import type { CodeCollector } from '../collector/CodeCollector.js';
import { logger } from '../../utils/logger.js';
import type {
  ScopeVariable,
  BreakpointHitCallback,
  DebuggerSession,
  GetScopeVariablesOptions,
  GetScopeVariablesResult,
} from '../../types/index.js';
import { WatchExpressionManager } from './WatchExpressionManager.js';
import { XHRBreakpointManager } from './XHRBreakpointManager.js';
import { EventBreakpointManager } from './EventBreakpointManager.js';
import { BlackboxManager } from './BlackboxManager.js';
import { DebuggerSessionManager } from './DebuggerSessionManager.js';
import {
  clearAllBreakpointsCore,
  getBreakpointCore,
  listBreakpointsCore,
  removeBreakpointCore,
  setBreakpointByUrlCore,
  setBreakpointCore,
} from './DebuggerManager.impl.core.breakpoints.js';
import {
  evaluateOnCallFrameCore,
  type EvaluateOnCallFrameValue,
  getPauseOnExceptionsStateCore,
  getPausedStateCore,
  isPausedCore,
  pauseCore,
  resumeCore,
  setPauseOnExceptionsCore,
  stepIntoCore,
  stepOutCore,
  stepOverCore,
  waitForPausedCore,
} from './DebuggerManager.impl.core.execution.js';
import {
  getObjectPropertiesByIdCore,
  getObjectPropertiesCore,
  getScopeVariablesCore,
} from './DebuggerManager.impl.core.scope.js';
import {
  clearBreakpointHitCallbacksCore,
  getBreakpointHitCallbackCountCore,
  handleBreakpointResolvedCore,
  handlePausedCore,
  handleResumedCore,
  offBreakpointHitCore,
  onBreakpointHitCore,
} from './DebuggerManager.impl.core.events.js';

export interface BreakpointInfo {
  breakpointId: string;
  location: {
    scriptId?: string;
    url?: string;
    lineNumber: number;
    columnNumber?: number;
  };
  condition?: string;
  enabled: boolean;
  hitCount: number;
  createdAt: number;
}

interface PausedEventParams {
  callFrames: CallFrame[];
  reason: string;
  data?: unknown;
  hitBreakpoints?: string[];
}

interface BreakpointResolvedParams {
  breakpointId: string;
  location?: unknown;
}

export interface PausedState {
  callFrames: CallFrame[];
  reason: string;
  data?: unknown;
  hitBreakpoints?: string[];
  timestamp: number;
}

export interface CallFrame {
  callFrameId: string;
  functionName: string;
  location: {
    scriptId: string;
    lineNumber: number;
    columnNumber: number;
  };
  url: string;
  scopeChain: Scope[];
  this: unknown;
}

export interface Scope {
  type: 'global' | 'local' | 'with' | 'closure' | 'catch' | 'block' | 'script' | 'eval' | 'module';
  object: {
    type: string;
    objectId?: string;
    className?: string;
    description?: string;
  };
  name?: string;
  startLocation?: { scriptId: string; lineNumber: number; columnNumber: number };
  endLocation?: { scriptId: string; lineNumber: number; columnNumber: number };
}

export interface ObjectPropertyInfo {
  name: string;
  value: unknown;
  type: string;
  objectId?: string;
  className?: string;
  description?: string;
}

export class DebuggerManager {
  private cdpSession: CDPSession | null = null;
  private enabled = false;
  private initPromise?: Promise<void>;

  private breakpoints: Map<string, BreakpointInfo> = new Map();

  private pausedState: PausedState | null = null;
  private pausedResolvers: Array<(state: PausedState) => void> = [];

  private breakpointHitCallbacks: Set<BreakpointHitCallback> = new Set();

  private pauseOnExceptionsState: 'none' | 'uncaught' | 'all' = 'none';

  private _watchManager: WatchExpressionManager | null = null;
  private _xhrManager: XHRBreakpointManager | null = null;
  private _eventManager: EventBreakpointManager | null = null;
  private _blackboxManager: BlackboxManager | null = null;
  private advancedFeatureSession: CDPSession | null = null;

  private pausedListener: ((params: unknown) => void) | null = null;
  private resumedListener: (() => void) | null = null;
  private breakpointResolvedListener: ((params: unknown) => void) | null = null;

  private sessionManager: DebuggerSessionManager;

  constructor(private collector: CodeCollector) {
    this.sessionManager = new DebuggerSessionManager(this);
    this.touchInternalStateForTypeCheck();
  }

  private touchInternalStateForTypeCheck(): void {
    void this.pausedState;
    void this.pausedResolvers;
    void this.breakpointHitCallbacks;
    void this.pauseOnExceptionsState;
  }

  getBreakpoints(): ReadonlyMap<string, BreakpointInfo> {
    return this.breakpoints;
  }

  getCDPSession(): CDPSession {
    if (!this.cdpSession || !this.enabled) {
      throw new Error('Debugger not enabled. Call init() or enable() first to get CDP session.');
    }
    return this.cdpSession;
  }

  getWatchManager(): WatchExpressionManager {
    if (!this._watchManager) {
      throw new Error('WatchExpressionManager not initialized. Call initAdvancedFeatures() first.');
    }
    return this._watchManager;
  }

  getXHRManager(): XHRBreakpointManager {
    if (!this._xhrManager) {
      throw new Error('XHRBreakpointManager not initialized. Call initAdvancedFeatures() first.');
    }
    return this._xhrManager;
  }

  getEventManager(): EventBreakpointManager {
    if (!this._eventManager) {
      throw new Error('EventBreakpointManager not initialized. Call initAdvancedFeatures() first.');
    }
    return this._eventManager;
  }

  getBlackboxManager(): BlackboxManager {
    if (!this._blackboxManager) {
      throw new Error('BlackboxManager not initialized. Call initAdvancedFeatures() first.');
    }
    return this._blackboxManager;
  }

  async init(): Promise<void> {
    if (this.enabled) {
      return;
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.doInit();
    try {
      return await this.initPromise;
    } finally {
      this.initPromise = undefined;
    }
  }

  private async doInit(): Promise<void> {
    try {
      const page = await this.collector.getActivePage();
      this.cdpSession = await page.createCDPSession();

      // Setup session disconnect handler for auto-reconnect
      this.cdpSession.on('disconnected', () => {
        logger.warn('CDP session disconnected, marking as disabled');
        this.enabled = false;
        this.cdpSession = null;
        this.advancedFeatureSession = null;
        this._xhrManager = null;
        this._eventManager = null;
        this._blackboxManager = null;
      });

      await this.cdpSession.send('Debugger.enable');
      this.enabled = true;

      this.pausedListener = (params: unknown) => this.handlePaused(params);
      this.resumedListener = () => this.handleResumed();
      this.breakpointResolvedListener = (params: unknown) =>
        this.handleBreakpointResolved(params);

      this.cdpSession.on('Debugger.paused', this.pausedListener);

      this.cdpSession.on('Debugger.resumed', this.resumedListener);

      this.cdpSession.on('Debugger.breakpointResolved', this.breakpointResolvedListener);

      logger.info('Debugger enabled successfully');
    } catch (error) {
      logger.error('Failed to enable debugger:', error);
      throw error;
    }
  }

  /**
   * Ensure CDP session is active, reconnect if needed
   */
  async ensureSession(): Promise<void> {
    if (!this.enabled || !this.cdpSession) {
      logger.info('CDP session not active, reinitializing...');
      await this.init();
    }
  }

  /**
   * Check if CDP session is still connected
   */
  isSessionConnected(): boolean {
    return this.enabled && this.cdpSession !== null;
  }

  async enable(): Promise<void> {
    return this.init();
  }

  async initAdvancedFeatures(
    runtimeInspector?: ConstructorParameters<typeof WatchExpressionManager>[0]
  ): Promise<void> {
    if (!this.enabled || !this.cdpSession) {
      throw new Error(
        'Debugger must be enabled before initializing advanced features. Call init() first.'
      );
    }

    try {
      if (runtimeInspector) {
        this._watchManager = new WatchExpressionManager(runtimeInspector);
        logger.info('WatchExpressionManager initialized');
      }

      this._xhrManager = new XHRBreakpointManager(this.cdpSession);
      logger.info('XHRBreakpointManager initialized');

      this._eventManager = new EventBreakpointManager(this.cdpSession);
      logger.info('EventBreakpointManager initialized');

      this._blackboxManager = new BlackboxManager(this.cdpSession);
      logger.info('BlackboxManager initialized');
      this.advancedFeatureSession = this.cdpSession;

      logger.info('All advanced debugging features initialized');
    } catch (error) {
      logger.error('Failed to initialize advanced features:', error);
      throw error;
    }
  }

  async ensureAdvancedFeatures(): Promise<void> {
    await this.ensureSession();
    if (!this.cdpSession) {
      throw new Error('CDP session unavailable after reconnect.');
    }

    const needsReinit =
      this.advancedFeatureSession !== this.cdpSession ||
      !this._xhrManager ||
      !this._eventManager ||
      !this._blackboxManager;

    if (needsReinit) {
      await this.initAdvancedFeatures();
    }
  }

  async disable(): Promise<void> {
    if (!this.enabled || !this.cdpSession) {
      logger.warn('Debugger not enabled');
      return;
    }

    try {
      if (this._xhrManager) {
        await this._xhrManager.close();
        this._xhrManager = null;
      }

      if (this._eventManager) {
        await this._eventManager.close();
        this._eventManager = null;
      }

      if (this._blackboxManager) {
        await this._blackboxManager.close();
        this._blackboxManager = null;
      }

      if (this._watchManager) {
        this._watchManager.clearAll();
        this._watchManager = null;
      }

      if (this.pausedListener) {
        this.cdpSession.off('Debugger.paused', this.pausedListener);
        this.pausedListener = null;
      }
      if (this.resumedListener) {
        this.cdpSession.off('Debugger.resumed', this.resumedListener);
        this.resumedListener = null;
      }
      if (this.breakpointResolvedListener) {
        this.cdpSession.off('Debugger.breakpointResolved', this.breakpointResolvedListener);
        this.breakpointResolvedListener = null;
      }

      await this.cdpSession.send('Debugger.disable');
    } catch (error) {
      logger.error('Failed to disable debugger:', error);
    } finally {
      this.initPromise = undefined;
      this.enabled = false;
      this.breakpoints.clear();
      this.pausedState = null;
      this.pausedResolvers = [];
      this.advancedFeatureSession = null;

      if (this.cdpSession) {
        try {
          await this.cdpSession.detach();
        } catch (e) {
          logger.warn('Failed to detach CDP session:', e);
        }
        this.cdpSession = null;
      }

      logger.info('Debugger disabled and cleaned up');
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async setBreakpointByUrl(params: {
    url: string;
    lineNumber: number;
    columnNumber?: number;
    condition?: string;
  }): Promise<BreakpointInfo> {
    return setBreakpointByUrlCore(this, params);
  }

  async setBreakpoint(params: {
    scriptId: string;
    lineNumber: number;
    columnNumber?: number;
    condition?: string;
  }): Promise<BreakpointInfo> {
    return setBreakpointCore(this, params);
  }

  async removeBreakpoint(breakpointId: string): Promise<void> {
    return removeBreakpointCore(this, breakpointId);
  }

  listBreakpoints(): BreakpointInfo[] {
    return listBreakpointsCore(this);
  }

  getBreakpoint(breakpointId: string): BreakpointInfo | undefined {
    return getBreakpointCore(this, breakpointId);
  }

  async clearAllBreakpoints(): Promise<void> {
    return clearAllBreakpointsCore(this);
  }

  async setPauseOnExceptions(state: 'none' | 'uncaught' | 'all'): Promise<void> {
    return setPauseOnExceptionsCore(this, state);
  }

  getPauseOnExceptionsState(): 'none' | 'uncaught' | 'all' {
    return getPauseOnExceptionsStateCore(this);
  }

  async pause(): Promise<void> {
    return pauseCore(this);
  }

  async resume(): Promise<void> {
    return resumeCore(this);
  }

  async stepInto(): Promise<void> {
    return stepIntoCore(this);
  }

  async stepOver(): Promise<void> {
    return stepOverCore(this);
  }

  async stepOut(): Promise<void> {
    return stepOutCore(this);
  }

  getPausedState(): PausedState | null {
    return getPausedStateCore(this);
  }

  isPaused(): boolean {
    return isPausedCore(this);
  }

  async waitForPaused(timeout = 30000): Promise<PausedState> {
    return waitForPausedCore(this, timeout);
  }

  async evaluateOnCallFrame(params: {
    callFrameId: string;
    expression: string;
    returnByValue?: boolean;
  }): Promise<EvaluateOnCallFrameValue> {
    return evaluateOnCallFrameCore(this, params);
  }

  async getScopeVariables(
    options: GetScopeVariablesOptions = {}
  ): Promise<GetScopeVariablesResult> {
    return getScopeVariablesCore(this, options);
  }

  async getObjectPropertiesById(objectId: string): Promise<ObjectPropertyInfo[]> {
    return getObjectPropertiesByIdCore(this, objectId);
  }

  async getObjectProperties(objectId: string, maxDepth: number): Promise<ScopeVariable[]> {
    return getObjectPropertiesCore(this, objectId, maxDepth);
  }

  onBreakpointHit(callback: BreakpointHitCallback): void {
    onBreakpointHitCore(this, callback);
  }

  offBreakpointHit(callback: BreakpointHitCallback): void {
    offBreakpointHitCore(this, callback);
  }

  clearBreakpointHitCallbacks(): void {
    clearBreakpointHitCallbacksCore(this);
  }

  getBreakpointHitCallbackCount(): number {
    return getBreakpointHitCallbackCountCore(this);
  }

  private async handlePaused(params: unknown): Promise<void> {
    return handlePausedCore(this, this.normalizePausedEventParams(params));
  }

  private handleResumed(): void {
    handleResumedCore(this);
  }

  private handleBreakpointResolved(params: unknown): void {
    handleBreakpointResolvedCore(this, this.normalizeBreakpointResolvedParams(params));
  }

  exportSession(metadata?: DebuggerSession['metadata']): DebuggerSession {
    return this.sessionManager.exportSession(metadata);
  }

  async saveSession(filePath?: string, metadata?: DebuggerSession['metadata']): Promise<string> {
    return this.sessionManager.saveSession(filePath, metadata);
  }

  async loadSessionFromFile(filePath: string): Promise<void> {
    return this.sessionManager.loadSessionFromFile(filePath);
  }

  async importSession(sessionData: DebuggerSession | string): Promise<void> {
    return this.sessionManager.importSession(sessionData);
  }

  async listSavedSessions(): Promise<Array<{ path: string; timestamp: number; metadata?: unknown }>> {
    return this.sessionManager.listSavedSessions();
  }

  async close(): Promise<void> {
    this.initPromise = undefined;
    if (this.enabled) {
      await this.disable();
    }

    if (this.cdpSession) {
      await this.cdpSession.detach();
      this.cdpSession = null;
    }

    logger.info('Debugger manager closed');
  }

  private normalizePausedEventParams(params: unknown): PausedEventParams {
    const event = this.asRecord(params);
    const callFrames = Array.isArray(event.callFrames) ? event.callFrames : [];

    return {
      callFrames: callFrames.map((frame) => this.normalizeCallFrame(frame)),
      reason: typeof event.reason === 'string' ? event.reason : 'unknown',
      data: event.data,
      hitBreakpoints: Array.isArray(event.hitBreakpoints)
        ? event.hitBreakpoints.filter((bp): bp is string => typeof bp === 'string')
        : undefined,
    };
  }

  private normalizeBreakpointResolvedParams(params: unknown): BreakpointResolvedParams {
    const event = this.asRecord(params);
    return {
      breakpointId: typeof event.breakpointId === 'string' ? event.breakpointId : '',
      location: event.location,
    };
  }

  private normalizeCallFrame(frame: unknown): CallFrame {
    const callFrame = this.asRecord(frame);
    const location = this.asRecord(callFrame.location);
    const scopeChain = Array.isArray(callFrame.scopeChain) ? callFrame.scopeChain : [];

    return {
      callFrameId: typeof callFrame.callFrameId === 'string' ? callFrame.callFrameId : '',
      functionName: typeof callFrame.functionName === 'string' ? callFrame.functionName : '',
      location: {
        scriptId: typeof location.scriptId === 'string' ? location.scriptId : '',
        lineNumber: typeof location.lineNumber === 'number' ? location.lineNumber : 0,
        columnNumber: typeof location.columnNumber === 'number' ? location.columnNumber : 0,
      },
      url: typeof callFrame.url === 'string' ? callFrame.url : '',
      scopeChain: scopeChain.map((scope) => this.normalizeScope(scope)),
      this: callFrame.this,
    };
  }

  private normalizeScope(scope: unknown): Scope {
    const scopeObj = this.asRecord(scope);
    const object = this.asRecord(scopeObj.object);
    const startLocation = this.normalizeScriptLocation(scopeObj.startLocation);
    const endLocation = this.normalizeScriptLocation(scopeObj.endLocation);

    return {
      type: this.normalizeScopeType(scopeObj.type),
      object: {
        type: typeof object.type === 'string' ? object.type : 'object',
        objectId: typeof object.objectId === 'string' ? object.objectId : undefined,
        className: typeof object.className === 'string' ? object.className : undefined,
        description: typeof object.description === 'string' ? object.description : undefined,
      },
      name: typeof scopeObj.name === 'string' ? scopeObj.name : undefined,
      startLocation,
      endLocation,
    };
  }

  private normalizeScriptLocation(location: unknown):
    | { scriptId: string; lineNumber: number; columnNumber: number }
    | undefined {
    const locationObj = this.asRecord(location);
    if (Object.keys(locationObj).length === 0) {
      return undefined;
    }
    return {
      scriptId: typeof locationObj.scriptId === 'string' ? locationObj.scriptId : '',
      lineNumber: typeof locationObj.lineNumber === 'number' ? locationObj.lineNumber : 0,
      columnNumber: typeof locationObj.columnNumber === 'number' ? locationObj.columnNumber : 0,
    };
  }

  private normalizeScopeType(value: unknown): Scope['type'] {
    if (
      value === 'global' ||
      value === 'local' ||
      value === 'with' ||
      value === 'closure' ||
      value === 'catch' ||
      value === 'block' ||
      value === 'script' ||
      value === 'eval' ||
      value === 'module'
    ) {
      return value;
    }
    return 'local';
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  }
}
