import type { CDPSession } from 'rebrowser-puppeteer-core';
import type { CodeCollector } from '../collector/CodeCollector.js';
import { logger } from '../../utils/logger.js';
import type {
  ScopeVariable,
  BreakpointHitCallback,
  BreakpointHitEvent,
  DebuggerSession,
  GetScopeVariablesOptions,
  GetScopeVariablesResult,
} from '../../types/index.js';
import { WatchExpressionManager } from './WatchExpressionManager.js';
import { XHRBreakpointManager } from './XHRBreakpointManager.js';
import { EventBreakpointManager } from './EventBreakpointManager.js';
import { BlackboxManager } from './BlackboxManager.js';
import { DebuggerSessionManager } from './DebuggerSessionManager.js';

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

export interface PausedState {
  callFrames: CallFrame[];
  reason: string;
  data?: any;
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
  this: any;
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

  private pausedListener: ((params: any) => void) | null = null;
  private resumedListener: (() => void) | null = null;
  private breakpointResolvedListener: ((params: any) => void) | null = null;

  private sessionManager: DebuggerSessionManager;

  constructor(private collector: CodeCollector) {
    this.sessionManager = new DebuggerSessionManager(this);
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
      logger.warn('Debugger already enabled');
      return;
    }

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

      this.pausedListener = (params: any) => this.handlePaused(params);
      this.resumedListener = () => this.handleResumed();
      this.breakpointResolvedListener = (params: any) => this.handleBreakpointResolved(params);

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

  async initAdvancedFeatures(runtimeInspector?: any): Promise<void> {
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
    // Auto-reconnect if session is lost
    if (!this.enabled || !this.cdpSession) {
      try {
        await this.ensureSession();
      } catch {
        throw new Error('Debugger is not enabled and auto-reconnect failed. Call init() or enable() first.');
      }
    }

    if (!params.url) {
      throw new Error('url parameter is required');
    }

    if (params.lineNumber < 0) {
      throw new Error('lineNumber must be a non-negative number');
    }

    if (params.columnNumber !== undefined && params.columnNumber < 0) {
      throw new Error('columnNumber must be a non-negative number');
    }

    try {
      const result = await this.cdpSession!.send('Debugger.setBreakpointByUrl', {
        url: params.url,
        lineNumber: params.lineNumber,
        columnNumber: params.columnNumber,
        condition: params.condition,
      });

      const breakpointInfo: BreakpointInfo = {
        breakpointId: result.breakpointId,
        location: {
          url: params.url,
          lineNumber: params.lineNumber,
          columnNumber: params.columnNumber,
        },
        condition: params.condition,
        enabled: true,
        hitCount: 0,
        createdAt: Date.now(),
      };

      this.breakpoints.set(result.breakpointId, breakpointInfo);

      logger.info(`Breakpoint set: ${params.url}:${params.lineNumber}`, {
        breakpointId: result.breakpointId,
        condition: params.condition,
      });

      return breakpointInfo;
    } catch (error) {
      logger.error('Failed to set breakpoint:', error);
      throw error;
    }
  }

  async setBreakpoint(params: {
    scriptId: string;
    lineNumber: number;
    columnNumber?: number;
    condition?: string;
  }): Promise<BreakpointInfo> {
    if (!this.enabled || !this.cdpSession) {
      try {
        await this.ensureSession();
      } catch (e) {
        throw new Error('Debugger is not enabled and auto-reconnect failed. Call init() or enable() first.');
      }
    }

    if (!params.scriptId) {
      throw new Error('scriptId parameter is required');
    }

    if (params.lineNumber < 0) {
      throw new Error('lineNumber must be a non-negative number');
    }

    if (params.columnNumber !== undefined && params.columnNumber < 0) {
      throw new Error('columnNumber must be a non-negative number');
    }

    try {
      const result = await this.cdpSession!.send('Debugger.setBreakpoint', {
        location: {
          scriptId: params.scriptId,
          lineNumber: params.lineNumber,
          columnNumber: params.columnNumber,
        },
        condition: params.condition,
      });

      const breakpointInfo: BreakpointInfo = {
        breakpointId: result.breakpointId,
        location: {
          scriptId: params.scriptId,
          lineNumber: params.lineNumber,
          columnNumber: params.columnNumber,
        },
        condition: params.condition,
        enabled: true,
        hitCount: 0,
        createdAt: Date.now(),
      };

      this.breakpoints.set(result.breakpointId, breakpointInfo);

      logger.info(`Breakpoint set: scriptId=${params.scriptId}:${params.lineNumber}`, {
        breakpointId: result.breakpointId,
      });

      return breakpointInfo;
    } catch (error) {
      logger.error('Failed to set breakpoint:', error);
      throw error;
    }
  }

  async removeBreakpoint(breakpointId: string): Promise<void> {
    if (!this.enabled || !this.cdpSession) {
      throw new Error('Debugger is not enabled. Call init() or enable() first.');
    }

    if (!breakpointId) {
      throw new Error('breakpointId parameter is required');
    }

    if (!this.breakpoints.has(breakpointId)) {
      throw new Error(
        `Breakpoint not found: ${breakpointId}. Use listBreakpoints() to see active breakpoints.`
      );
    }

    try {
      await this.cdpSession.send('Debugger.removeBreakpoint', { breakpointId });
      this.breakpoints.delete(breakpointId);

      logger.info(`Breakpoint removed: ${breakpointId}`);
    } catch (error) {
      logger.error(`Failed to remove breakpoint ${breakpointId}:`, error);
      throw error;
    }
  }

  listBreakpoints(): BreakpointInfo[] {
    return Array.from(this.breakpoints.values());
  }

  getBreakpoint(breakpointId: string): BreakpointInfo | undefined {
    return this.breakpoints.get(breakpointId);
  }

  async clearAllBreakpoints(): Promise<void> {
    const breakpointIds = Array.from(this.breakpoints.keys());

    for (const id of breakpointIds) {
      await this.removeBreakpoint(id);
    }

    logger.info(`Cleared ${breakpointIds.length} breakpoints`);
  }

  async setPauseOnExceptions(state: 'none' | 'uncaught' | 'all'): Promise<void> {
    if (!this.enabled || !this.cdpSession) {
      throw new Error('Debugger not enabled');
    }

    try {
      await this.cdpSession.send('Debugger.setPauseOnExceptions', { state });
      this.pauseOnExceptionsState = state;
      logger.info(`Pause on exceptions set to: ${state}`);
    } catch (error) {
      logger.error('Failed to set pause on exceptions:', error);
      throw error;
    }
  }

  getPauseOnExceptionsState(): 'none' | 'uncaught' | 'all' {
    return this.pauseOnExceptionsState;
  }

  async pause(): Promise<void> {
    if (!this.enabled || !this.cdpSession) {
      throw new Error('Debugger not enabled');
    }

    try {
      await this.cdpSession.send('Debugger.pause');
      logger.info('Execution paused');
    } catch (error) {
      logger.error('Failed to pause execution:', error);
      throw error;
    }
  }

  async resume(): Promise<void> {
    if (!this.enabled || !this.cdpSession) {
      throw new Error('Debugger not enabled');
    }

    try {
      await this.cdpSession.send('Debugger.resume');
      logger.info('Execution resumed');
    } catch (error) {
      logger.error('Failed to resume execution:', error);
      throw error;
    }
  }

  async stepInto(): Promise<void> {
    if (!this.enabled || !this.cdpSession) {
      throw new Error('Debugger not enabled');
    }

    try {
      await this.cdpSession.send('Debugger.stepInto');
      logger.info('Step into');
    } catch (error) {
      logger.error('Failed to step into:', error);
      throw error;
    }
  }

  async stepOver(): Promise<void> {
    if (!this.enabled || !this.cdpSession) {
      throw new Error('Debugger not enabled');
    }

    try {
      await this.cdpSession.send('Debugger.stepOver');
      logger.info('Step over');
    } catch (error) {
      logger.error('Failed to step over:', error);
      throw error;
    }
  }

  async stepOut(): Promise<void> {
    if (!this.enabled || !this.cdpSession) {
      throw new Error('Debugger not enabled');
    }

    try {
      await this.cdpSession.send('Debugger.stepOut');
      logger.info('Step out');
    } catch (error) {
      logger.error('Failed to step out:', error);
      throw error;
    }
  }

  getPausedState(): PausedState | null {
    return this.pausedState;
  }

  isPaused(): boolean {
    return this.pausedState !== null;
  }

  async waitForPaused(timeout = 30000): Promise<PausedState> {
    if (this.pausedState) {
      return this.pausedState;
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.pausedResolvers.indexOf(resolve);
        if (index > -1) {
          this.pausedResolvers.splice(index, 1);
        }
        reject(new Error('Timeout waiting for paused event'));
      }, timeout);

      this.pausedResolvers.push((state) => {
        clearTimeout(timer);
        resolve(state);
      });
    });
  }

  async evaluateOnCallFrame(params: {
    callFrameId: string;
    expression: string;
    returnByValue?: boolean;
  }): Promise<any> {
    if (!this.enabled || !this.cdpSession) {
      throw new Error('Debugger not enabled');
    }

    if (!this.pausedState) {
      throw new Error('Not in paused state');
    }

    try {
      const result = await this.cdpSession.send('Debugger.evaluateOnCallFrame', {
        callFrameId: params.callFrameId,
        expression: params.expression,
        returnByValue: params.returnByValue !== false,
      });

      logger.info(`Evaluated on call frame: ${params.expression}`, {
        result: result.result.value,
      });

      return result.result;
    } catch (error) {
      logger.error('Failed to evaluate on call frame:', error);
      throw error;
    }
  }

  async getScopeVariables(
    options: GetScopeVariablesOptions = {}
  ): Promise<GetScopeVariablesResult> {
    if (!this.enabled || !this.cdpSession) {
      throw new Error('Debugger not enabled');
    }

    if (!this.pausedState) {
      throw new Error('Not in paused state. Use pause() or set a breakpoint first.');
    }

    const {
      callFrameId,
      includeObjectProperties = false,
      maxDepth = 1,
      skipErrors = true,
    } = options;

    try {
      const targetFrame = callFrameId
        ? this.pausedState.callFrames.find((f) => f.callFrameId === callFrameId)
        : this.pausedState.callFrames[0];

      if (!targetFrame) {
        throw new Error(`Call frame not found: ${callFrameId || 'top frame'}`);
      }

      const variables: ScopeVariable[] = [];
      const errors: Array<{ scope: string; error: string }> = [];
      let successfulScopes = 0;

      for (const scope of targetFrame.scopeChain) {
        try {
          if (scope.object.objectId) {
            const properties = await this.cdpSession.send('Runtime.getProperties', {
              objectId: scope.object.objectId,
              ownProperties: true,
            });

            for (const prop of properties.result) {
              if (prop.name === '__proto__') continue;

              const variable: ScopeVariable = {
                name: prop.name,
                value: prop.value?.value,
                type: prop.value?.type || 'unknown',
                scope: scope.type,
                writable: prop.writable,
                configurable: prop.configurable,
                enumerable: prop.enumerable,
                objectId: prop.value?.objectId,
              };

              variables.push(variable);

              if (includeObjectProperties && prop.value?.objectId && maxDepth > 0) {
                try {
                  const nestedProps = await this.getObjectProperties(
                    prop.value.objectId,
                    maxDepth - 1
                  );
                  for (const nested of nestedProps) {
                    variables.push({
                      ...nested,
                      name: `${prop.name}.${nested.name}`,
                      scope: scope.type,
                    });
                  }
                } catch (nestedError) {
                  logger.debug(`Failed to get nested properties for ${prop.name}:`, nestedError);
                }
              }
            }

            successfulScopes++;
          }
        } catch (error: any) {
          const errorMsg = error.message || String(error);

          logger.warn(`Failed to get properties for scope ${scope.type}:`, errorMsg);

          errors.push({
            scope: scope.type,
            error: errorMsg,
          });

          if (!skipErrors) {
            throw error;
          }
        }
      }

      const result: GetScopeVariablesResult = {
        success: true,
        variables,
        callFrameId: targetFrame.callFrameId,
        callFrameInfo: {
          functionName: targetFrame.functionName || '(anonymous)',
          location: `${targetFrame.url}:${targetFrame.location.lineNumber}:${targetFrame.location.columnNumber}`,
        },
        totalScopes: targetFrame.scopeChain.length,
        successfulScopes,
      };

      if (errors.length > 0) {
        result.errors = errors;
      }

      logger.info(
        `Got ${variables.length} variables from ${successfulScopes}/${targetFrame.scopeChain.length} scopes`,
        {
          callFrameId: targetFrame.callFrameId,
          functionName: targetFrame.functionName,
          errors: errors.length,
        }
      );

      return result;
    } catch (error) {
      logger.error('Failed to get scope variables:', error);
      throw error;
    }
  }

  async getObjectPropertiesById(objectId: string): Promise<ObjectPropertyInfo[]> {
    if (!this.enabled || !this.cdpSession) {
      throw new Error('Debugger not enabled');
    }

    if (!objectId || typeof objectId !== 'string') {
      throw new Error('objectId parameter is required');
    }

    try {
      const properties = await this.cdpSession.send('Runtime.getProperties', {
        objectId,
        ownProperties: true,
        accessorPropertiesOnly: false,
        generatePreview: true,
      });

      const result: ObjectPropertyInfo[] = [];
      for (const prop of properties.result) {
        if (!prop.value) {
          continue;
        }

        result.push({
          name: prop.name,
          value: prop.value.value ?? prop.value.description,
          type: prop.value.type || 'unknown',
          objectId: prop.value.objectId,
          className: prop.value.className,
          description: prop.value.description,
        });
      }

      return result;
    } catch (error: any) {
      const message = error?.message || String(error);
      if (
        message.includes('Could not find object with given id') ||
        message.includes('Invalid remote object id')
      ) {
        throw new Error(
          'Object handle is expired or invalid. Pause execution again and reacquire objectId from get_scope_variables_enhanced.'
        );
      }
      throw error;
    }
  }

  private async getObjectProperties(objectId: string, maxDepth: number): Promise<ScopeVariable[]> {
    if (maxDepth <= 0 || !this.cdpSession) {
      return [];
    }

    try {
      const properties = await this.cdpSession.send('Runtime.getProperties', {
        objectId,
        ownProperties: true,
      });

      const variables: ScopeVariable[] = [];

      for (const prop of properties.result) {
        if (prop.name === '__proto__') continue;

        variables.push({
          name: prop.name,
          value: prop.value?.value,
          type: prop.value?.type || 'unknown',
          scope: 'local',
          objectId: prop.value?.objectId,
        });
      }

      return variables;
    } catch (error) {
      logger.debug(`Failed to get object properties for ${objectId}:`, error);
      return [];
    }
  }

  onBreakpointHit(callback: BreakpointHitCallback): void {
    this.breakpointHitCallbacks.add(callback);
    logger.info('Breakpoint hit callback registered', {
      totalCallbacks: this.breakpointHitCallbacks.size,
    });
  }

  offBreakpointHit(callback: BreakpointHitCallback): void {
    this.breakpointHitCallbacks.delete(callback);
    logger.info('Breakpoint hit callback removed', {
      totalCallbacks: this.breakpointHitCallbacks.size,
    });
  }

  clearBreakpointHitCallbacks(): void {
    this.breakpointHitCallbacks.clear();
    logger.info('All breakpoint hit callbacks cleared');
  }

  getBreakpointHitCallbackCount(): number {
    return this.breakpointHitCallbacks.size;
  }

  private async handlePaused(params: any): Promise<void> {
    this.pausedState = {
      callFrames: params.callFrames,
      reason: params.reason,
      data: params.data,
      hitBreakpoints: params.hitBreakpoints,
      timestamp: Date.now(),
    };

    if (params.hitBreakpoints) {
      for (const breakpointId of params.hitBreakpoints) {
        const bp = this.breakpoints.get(breakpointId);
        if (bp) {
          bp.hitCount++;
        }
      }
    }

    logger.info('Execution paused', {
      reason: params.reason,
      location: params.callFrames[0]?.location,
      hitBreakpoints: params.hitBreakpoints,
    });

    if (
      params.hitBreakpoints &&
      params.hitBreakpoints.length > 0 &&
      this.breakpointHitCallbacks.size > 0
    ) {
      const topFrame = params.callFrames[0];

      let variables: ScopeVariable[] | undefined;
      try {
        const result = await this.getScopeVariables({ skipErrors: true });
        variables = result.variables;
      } catch (error) {
        logger.debug('Failed to auto-fetch variables for breakpoint hit callback:', error);
      }

      const event: BreakpointHitEvent = {
        breakpointId: params.hitBreakpoints[0],
        breakpointInfo: this.breakpoints.get(params.hitBreakpoints[0]),
        location: {
          scriptId: topFrame.location.scriptId,
          lineNumber: topFrame.location.lineNumber,
          columnNumber: topFrame.location.columnNumber,
          url: topFrame.url,
        },
        callFrames: params.callFrames,
        timestamp: Date.now(),
        variables,
        reason: params.reason,
      };

      for (const callback of this.breakpointHitCallbacks) {
        try {
          await Promise.resolve(callback(event));
        } catch (error) {
          logger.error('Breakpoint hit callback error:', error);
        }
      }
    }

    for (const resolver of this.pausedResolvers) {
      resolver(this.pausedState);
    }
    this.pausedResolvers = [];
  }

  private handleResumed(): void {
    this.pausedState = null;
    logger.info('Execution resumed');
  }

  private handleBreakpointResolved(params: any): void {
    const bp = this.breakpoints.get(params.breakpointId);
    if (bp) {
      logger.info('Breakpoint resolved', {
        breakpointId: params.breakpointId,
        location: params.location,
      });
    }
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

  async listSavedSessions(): Promise<Array<{ path: string; timestamp: number; metadata?: any }>> {
    return this.sessionManager.listSavedSessions();
  }

  async close(): Promise<void> {
    if (this.enabled) {
      await this.disable();
    }

    if (this.cdpSession) {
      await this.cdpSession.detach();
      this.cdpSession = null;
    }

    logger.info('Debugger manager closed');
  }
}
