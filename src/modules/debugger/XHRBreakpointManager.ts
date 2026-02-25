import type { CDPSession } from 'rebrowser-puppeteer-core';
import { logger } from '../../utils/logger.js';

export interface XHRBreakpoint {
  id: string;
  urlPattern: string;
  enabled: boolean;
  hitCount: number;
  createdAt: number;
}

export class XHRBreakpointManager {
  private xhrBreakpoints: Map<string, XHRBreakpoint> = new Map();
  private breakpointCounter = 0;

  constructor(private cdpSession: CDPSession) {
    logger.info('XHRBreakpointManager initialized with shared CDP session');
  }

  async setXHRBreakpoint(urlPattern: string): Promise<string> {
    try {
      await this.cdpSession.send('DOMDebugger.setXHRBreakpoint', {
        url: urlPattern,
      });

      const breakpointId = `xhr_${++this.breakpointCounter}`;
      this.xhrBreakpoints.set(breakpointId, {
        id: breakpointId,
        urlPattern,
        enabled: true,
        hitCount: 0,
        createdAt: Date.now(),
      });

      logger.info(`XHR breakpoint set: ${urlPattern}`, { breakpointId });
      return breakpointId;
    } catch (error) {
      logger.error('Failed to set XHR breakpoint:', error);
      throw error;
    }
  }

  async removeXHRBreakpoint(breakpointId: string): Promise<boolean> {
    const breakpoint = this.xhrBreakpoints.get(breakpointId);
    if (!breakpoint) {
      return false;
    }

    try {
      await this.cdpSession.send('DOMDebugger.removeXHRBreakpoint', {
        url: breakpoint.urlPattern,
      });

      this.xhrBreakpoints.delete(breakpointId);
      logger.info(`XHR breakpoint removed: ${breakpointId}`);
      return true;
    } catch (error) {
      logger.error('Failed to remove XHR breakpoint:', error);
      throw error;
    }
  }

  getAllXHRBreakpoints(): XHRBreakpoint[] {
    return Array.from(this.xhrBreakpoints.values());
  }

  getXHRBreakpoint(breakpointId: string): XHRBreakpoint | undefined {
    return this.xhrBreakpoints.get(breakpointId);
  }

  async clearAllXHRBreakpoints(): Promise<void> {
    const breakpoints = Array.from(this.xhrBreakpoints.values());

    for (const bp of breakpoints) {
      try {
        await this.cdpSession.send('DOMDebugger.removeXHRBreakpoint', {
          url: bp.urlPattern,
        });
      } catch (error) {
        logger.warn(`Failed to remove XHR breakpoint ${bp.id}:`, error);
      }
    }

    this.xhrBreakpoints.clear();
    logger.info('All XHR breakpoints cleared');
  }

  async close(): Promise<void> {
    try {
      await this.clearAllXHRBreakpoints();
      logger.info('XHRBreakpointManager closed');
    } catch (error) {
      logger.error('Failed to close XHRBreakpointManager:', error);
      throw error;
    }
  }
}
