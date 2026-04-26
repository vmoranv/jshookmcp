import type { Browser, CDPSession } from 'rebrowser-puppeteer-core';
import type { CDPSessionLike } from '@modules/browser/CDPSessionLike';
import {
  attachToFlatTarget,
  detachFromFlatTarget,
  type FlatSessionParentLike,
} from '@modules/browser/flat-target-session';

export interface BrowserTargetInfo {
  targetId: string;
  type: string;
  title: string;
  url: string;
  attached: boolean;
  openerId?: string;
  canAccessOpener?: boolean;
  openerFrameId?: string;
  browserContextId?: string;
  subtype?: string;
}

interface TargetFilters {
  type?: string;
  types?: string[];
  targetId?: string;
  urlPattern?: string;
  titlePattern?: string;
  attachedOnly?: boolean;
  /** Enable OOPIF (cross-origin iframe) auto-discovery. Default: true. */
  discoverOOPIF?: boolean;
}

export class BrowserTargetSessionManager {
  private browserSession: CDPSession | null = null;
  private attachedTargetSession: CDPSessionLike | null = null;
  private attachedTargetInfo: BrowserTargetInfo | null = null;
  private autoAttachEnabled = false;

  constructor(private readonly getBrowser: () => Browser | null) {}

  async listTargets(filters: TargetFilters = {}): Promise<BrowserTargetInfo[]> {
    const session = await this.ensureBrowserSession();

    // Enable OOPIF auto-discovery when requested (default: true)
    const discoverOOPIF = filters.discoverOOPIF !== false;
    if (discoverOOPIF && !this.autoAttachEnabled) {
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

    const response = (await session.send('Target.getTargets')) as unknown as {
      targetInfos?: Array<Record<string, unknown>>;
    };

    const targets = Array.isArray(response.targetInfos)
      ? response.targetInfos
          .map((target) => this.normalizeTargetInfo(target))
          .filter((target): target is BrowserTargetInfo => target !== null)
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

    const session = await this.ensureBrowserSession();
    this.attachedTargetSession = await attachToFlatTarget(
      session as unknown as FlatSessionParentLike,
      targetId,
    );
    this.attachedTargetInfo = target;
    return target;
  }

  async detach(): Promise<boolean> {
    if (!this.attachedTargetSession) {
      this.attachedTargetInfo = null;
      return false;
    }

    if (!this.browserSession) {
      throw new Error('Browser CDP session unavailable for target detach');
    }

    const session = this.attachedTargetSession;
    await detachFromFlatTarget(this.browserSession, session);
    this.attachedTargetSession = null;
    this.attachedTargetInfo = null;
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

  async addScriptToEvaluateOnNewDocument(source: string): Promise<unknown> {
    const session = this.requireAttachedTargetSession();
    return await session.send('Page.addScriptToEvaluateOnNewDocument', { source });
  }

  async dispose(): Promise<void> {
    await this.detach();
    this.autoAttachEnabled = false;
    if (this.browserSession) {
      try {
        await this.browserSession.detach();
      } catch {
        // Ignore cleanup failures on browser shutdown.
      } finally {
        this.browserSession = null;
      }
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

  private matchesFilters(target: BrowserTargetInfo, filters: TargetFilters): boolean {
    if (filters.type && target.type !== filters.type) {
      return false;
    }
    if (filters.types && filters.types.length > 0 && !filters.types.includes(target.type)) {
      return false;
    }
    if (filters.targetId && target.targetId !== filters.targetId) {
      return false;
    }
    if (filters.urlPattern && !target.url.includes(filters.urlPattern)) {
      return false;
    }
    if (filters.titlePattern && !target.title.includes(filters.titlePattern)) {
      return false;
    }
    if (filters.attachedOnly && !target.attached) {
      return false;
    }
    return true;
  }

  private normalizeTargetInfo(target: Record<string, unknown>): BrowserTargetInfo | null {
    const targetId = typeof target.targetId === 'string' ? target.targetId : null;
    const type = typeof target.type === 'string' ? target.type : null;
    const title = typeof target.title === 'string' ? target.title : '';
    const url = typeof target.url === 'string' ? target.url : '';
    const attached = typeof target.attached === 'boolean' ? target.attached : false;

    if (!targetId || !type) {
      return null;
    }

    return {
      targetId,
      type,
      title,
      url,
      attached,
      openerId: typeof target.openerId === 'string' ? target.openerId : undefined,
      canAccessOpener:
        typeof target.canAccessOpener === 'boolean' ? target.canAccessOpener : undefined,
      openerFrameId: typeof target.openerFrameId === 'string' ? target.openerFrameId : undefined,
      browserContextId:
        typeof target.browserContextId === 'string' ? target.browserContextId : undefined,
      subtype: typeof target.subtype === 'string' ? target.subtype : undefined,
    };
  }
}
