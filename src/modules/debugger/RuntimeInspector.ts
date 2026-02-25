import type { CDPSession } from 'rebrowser-puppeteer-core';
import type { CodeCollector } from '../collector/CodeCollector.js';
import type { DebuggerManager, CallFrame, Scope } from './DebuggerManager.js';
import { logger } from '../../utils/logger.js';

export interface VariableInfo {
  name: string;
  value: any;
  type: string;
  objectId?: string;
  className?: string;
  description?: string;
}

export interface ScopeVariables {
  scopeType: string;
  scopeName?: string;
  variables: VariableInfo[];
}

export interface CallStackInfo {
  callFrames: Array<{
    callFrameId: string;
    functionName: string;
    location: {
      scriptId: string;
      url: string;
      lineNumber: number;
      columnNumber: number;
    };
    scopeChain: Array<{
      type: string;
      name?: string;
    }>;
  }>;
  reason: string;
  timestamp: number;
}

export class RuntimeInspector {
  private cdpSession: CDPSession | null = null;
  private enabled = false;

  constructor(
    private collector: CodeCollector,
    private debuggerManager: DebuggerManager
  ) {}

  async init(): Promise<void> {
    if (this.enabled) {
      logger.warn('Runtime inspector already enabled');
      return;
    }

    try {
      const page = await this.collector.getActivePage();
      this.cdpSession = await page.createCDPSession();

      await this.cdpSession.send('Runtime.enable');
      this.enabled = true;

      logger.info('Runtime inspector enabled');
    } catch (error) {
      logger.error('Failed to enable runtime inspector:', error);
      throw error;
    }
  }

  async enable(): Promise<void> {
    return this.init();
  }

  async enableAsyncStackTraces(maxDepth: number = 32): Promise<void> {
    if (!this.enabled || !this.cdpSession) {
      throw new Error('Runtime inspector not enabled. Call init() or enable() first.');
    }

    try {
      await this.cdpSession.send('Debugger.setAsyncCallStackDepth', {
        maxDepth,
      });

      logger.info(`Async stack traces enabled with max depth: ${maxDepth}`);
    } catch (error) {
      logger.error('Failed to enable async stack traces:', error);
      throw error;
    }
  }

  async disableAsyncStackTraces(): Promise<void> {
    if (!this.enabled || !this.cdpSession) {
      throw new Error('Runtime inspector not enabled');
    }

    try {
      await this.cdpSession.send('Debugger.setAsyncCallStackDepth', {
        maxDepth: 0,
      });

      logger.info('Async stack traces disabled');
    } catch (error) {
      logger.error('Failed to disable async stack traces:', error);
      throw error;
    }
  }

  async disable(): Promise<void> {
    if (!this.enabled || !this.cdpSession) {
      logger.warn('Runtime inspector not enabled');
      return;
    }

    try {
      await this.cdpSession.send('Runtime.disable');
      this.enabled = false;

      await this.cdpSession.detach();
      this.cdpSession = null;

      logger.info('Runtime inspector disabled and cleaned up');
    } catch (error) {
      logger.error('Failed to disable runtime inspector:', error);
      throw error;
    }
  }

  async getCallStack(): Promise<CallStackInfo | null> {
    const pausedState = this.debuggerManager.getPausedState();

    if (!pausedState) {
      logger.warn('Not in paused state, cannot get call stack');
      return null;
    }

    try {
      const callStackInfo: CallStackInfo = {
        callFrames: pausedState.callFrames.map((frame: CallFrame) => ({
          callFrameId: frame.callFrameId,
          functionName: frame.functionName || '(anonymous)',
          location: {
            scriptId: frame.location.scriptId,
            url: frame.url,
            lineNumber: frame.location.lineNumber,
            columnNumber: frame.location.columnNumber,
          },
          scopeChain: frame.scopeChain.map((scope: Scope) => ({
            type: scope.type,
            name: scope.name,
          })),
        })),
        reason: pausedState.reason,
        timestamp: pausedState.timestamp,
      };

      logger.info('Call stack retrieved', {
        frameCount: callStackInfo.callFrames.length,
        topFrame: callStackInfo.callFrames[0]?.functionName,
      });

      return callStackInfo;
    } catch (error) {
      logger.error('Failed to get call stack:', error);
      throw error;
    }
  }

  async getScopeVariables(callFrameId: string): Promise<ScopeVariables[]> {
    if (!this.enabled || !this.cdpSession) {
      throw new Error('Runtime inspector is not enabled. Call init() or enable() first.');
    }

    if (!callFrameId) {
      throw new Error('callFrameId parameter is required');
    }

    const pausedState = this.debuggerManager.getPausedState();
    if (!pausedState) {
      throw new Error('Not in paused state. Debugger must be paused to get scope variables.');
    }

    const callFrame = pausedState.callFrames.find(
      (frame: CallFrame) => frame.callFrameId === callFrameId
    );

    if (!callFrame) {
      throw new Error(
        `Call frame not found: ${callFrameId}. Use getCallStack() to see available frames.`
      );
    }

    try {
      const scopeVariablesList: ScopeVariables[] = [];

      for (const scope of callFrame.scopeChain) {
        if (!scope.object.objectId) {
          continue;
        }

        const properties = await this.getObjectProperties(scope.object.objectId);

        scopeVariablesList.push({
          scopeType: scope.type,
          scopeName: scope.name,
          variables: properties,
        });
      }

      logger.info(`Scope variables retrieved for call frame ${callFrameId}`, {
        scopeCount: scopeVariablesList.length,
      });

      return scopeVariablesList;
    } catch (error) {
      logger.error('Failed to get scope variables:', error);
      throw error;
    }
  }

  async getCurrentScopeVariables(): Promise<ScopeVariables[]> {
    const pausedState = this.debuggerManager.getPausedState();

    if (!pausedState || pausedState.callFrames.length === 0) {
      throw new Error('Not in paused state or no call frames');
    }

    const topFrame = pausedState.callFrames[0];
    if (!topFrame) {
      throw new Error('No top frame available');
    }

    return await this.getScopeVariables(topFrame.callFrameId);
  }

  async getObjectProperties(objectId: string): Promise<VariableInfo[]> {
    if (!this.enabled || !this.cdpSession) {
      throw new Error('Runtime inspector is not enabled. Call init() or enable() first.');
    }

    if (!objectId) {
      throw new Error('objectId parameter is required');
    }

    try {
      const result = await this.cdpSession.send('Runtime.getProperties', {
        objectId,
        ownProperties: true,
        accessorPropertiesOnly: false,
        generatePreview: true,
      });

      const variables: VariableInfo[] = [];

      for (const prop of result.result) {
        if (!prop.value) {
          continue;
        }

        variables.push({
          name: prop.name,
          value: this.formatValue(prop.value),
          type: prop.value.type,
          objectId: prop.value.objectId,
          className: prop.value.className,
          description: prop.value.description,
        });
      }

      logger.info(`Object properties retrieved: ${objectId}`, {
        propertyCount: variables.length,
      });

      return variables;
    } catch (error) {
      logger.error('Failed to get object properties:', error);
      throw error;
    }
  }

  async evaluate(expression: string, callFrameId?: string): Promise<any> {
    if (!expression || expression.trim() === '') {
      throw new Error('expression parameter is required and cannot be empty');
    }

    const pausedState = this.debuggerManager.getPausedState();

    if (!pausedState) {
      throw new Error('Not in paused state. Use evaluateGlobal() for global context evaluation.');
    }

    const targetCallFrameId = callFrameId || pausedState.callFrames[0]?.callFrameId;

    if (!targetCallFrameId) {
      throw new Error('No call frame available for evaluation');
    }

    try {
      const result = await this.debuggerManager.evaluateOnCallFrame({
        callFrameId: targetCallFrameId,
        expression,
        returnByValue: true,
      });

      logger.info(`Expression evaluated: ${expression}`, {
        result: result.value,
      });

      return this.formatValue(result);
    } catch (error) {
      logger.error('Failed to evaluate expression:', error);
      throw error;
    }
  }

  async evaluateGlobal(expression: string): Promise<any> {
    if (!this.enabled || !this.cdpSession) {
      throw new Error('Runtime inspector is not enabled. Call init() or enable() first.');
    }

    if (!expression || expression.trim() === '') {
      throw new Error('expression parameter is required and cannot be empty');
    }

    try {
      const result = await this.cdpSession.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
      });

      logger.info(`Global expression evaluated: ${expression}`, {
        result: result.result.value,
      });

      return this.formatValue(result.result);
    } catch (error) {
      logger.error('Failed to evaluate global expression:', error);
      throw error;
    }
  }

  private formatValue(remoteObject: any): any {
    if (remoteObject.type === 'undefined') {
      return undefined;
    }

    if (remoteObject.type === 'object' && remoteObject.subtype === 'null') {
      return null;
    }

    if (remoteObject.value !== undefined) {
      return remoteObject.value;
    }

    if (remoteObject.description) {
      return remoteObject.description;
    }

    return `[${remoteObject.type}]`;
  }

  async close(): Promise<void> {
    if (this.enabled) {
      await this.disable();
    }

    if (this.cdpSession) {
      await this.cdpSession.detach();
      this.cdpSession = null;
    }

    logger.info('Runtime inspector closed');
  }
}
