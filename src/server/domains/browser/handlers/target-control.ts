import type { CodeCollector, ConsoleMonitor } from '@server/domains/shared/modules/collector';
import type { TabRegistry } from '@modules/browser/TabRegistry';
import { argBool, argNumber, argString, argStringArray } from '@server/domains/shared/parse-args';
import { WORKER_TARGET_TYPES } from '@src/constants/browser';
import { logger } from '@utils/logger';
import { R, type ToolResponse } from '@server/domains/shared/ResponseBuilder';

interface TargetControlHandlersDeps {
  collector: CodeCollector;
  consoleMonitor: ConsoleMonitor;
  getTabRegistry: () => TabRegistry;
}

export class TargetControlHandlers {
  constructor(private readonly deps: TargetControlHandlersDeps) {}

  private markMonitoringContextChanged(context: string): void {
    try {
      this.deps.consoleMonitor.markContextChanged();
    } catch (error) {
      logger.warn(
        `[${context}] Failed to mark monitoring context as stale: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private safeOrigin(url: string | null | undefined): string | null {
    if (!url) {
      return null;
    }
    try {
      return new URL(url).origin;
    } catch {
      return null;
    }
  }

  private async syncAttachedPageContext(target: {
    targetId?: string;
    type?: string;
    url?: string;
    title?: string;
  }): Promise<{
    contextSwitched: boolean;
    selectedIndex: number | null;
    selectedPageId: string | null;
    currentUrl: string | null;
    currentTitle: string | null;
  }> {
    if (target.type !== 'page' || !target.targetId) {
      return {
        contextSwitched: false,
        selectedIndex: null,
        selectedPageId: null,
        currentUrl: target.url ?? null,
        currentTitle: target.title ?? null,
      };
    }

    const resolved = await this.deps.collector.selectResolvedPageByTargetId(target.targetId);
    if (!resolved) {
      return {
        contextSwitched: false,
        selectedIndex: null,
        selectedPageId: null,
        currentUrl: target.url ?? null,
        currentTitle: target.title ?? null,
      };
    }

    const registry = this.deps.getTabRegistry();
    const pageId = registry.upsertPage(resolved.page, {
      index: resolved.index,
      url: resolved.url,
      title: resolved.title,
    });
    registry.setCurrentPageId(pageId);

    return {
      contextSwitched: true,
      selectedIndex: resolved.index,
      selectedPageId: pageId,
      currentUrl: resolved.url,
      currentTitle: resolved.title,
    };
  }

  async clearAttachedTargetContext(context: string): Promise<{
    detached: boolean;
    targetId: string | null;
    type: string | null;
  }> {
    const activeTarget = this.deps.collector.getAttachedTargetInfo();
    if (!activeTarget) {
      return { detached: false, targetId: null, type: null };
    }

    const detached = await this.deps.collector.detachCdpTarget();
    if (detached) {
      logger.info(
        `[${context}] Detached active CDP target ${activeTarget.targetId} before switching page context`,
      );
    }

    return {
      detached,
      targetId: activeTarget.targetId,
      type: activeTarget.type ?? null,
    };
  }

  async handleBrowserListCdpTargets(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const type = argString(args, 'type');
      const types = argStringArray(args, 'types');
      const targetId = argString(args, 'targetId');
      const urlPattern = argString(args, 'urlPattern');
      const titlePattern = argString(args, 'titlePattern');
      const attachedOnly = argBool(args, 'attachedOnly', false);
      const discoverOOPIF = argBool(args, 'discoverOOPIF', true);

      const targets = await this.deps.collector.listCdpTargets({
        type: type ?? undefined,
        types: types ?? undefined,
        targetId: targetId ?? undefined,
        urlPattern: urlPattern ?? undefined,
        titlePattern: titlePattern ?? undefined,
        attachedOnly,
        discoverOOPIF,
      });
      const activeTarget = this.deps.collector.getAttachedTargetInfo();
      const contextMeta = this.deps.getTabRegistry().getContextMeta();
      const pages = await this.deps.collector.listPages();
      const currentTab =
        typeof contextMeta.tabIndex === 'number' ? pages[contextMeta.tabIndex] : undefined;
      const currentTabUrl = currentTab?.url ?? null;
      const currentTabOrigin = this.safeOrigin(currentTabUrl);

      const enrichedTargets = targets.map((target) => {
        const targetUrl = target.url;
        const targetOrigin = this.safeOrigin(targetUrl);
        const currentTabMatch = currentTabUrl !== null && targetUrl === currentTabUrl;
        const sameOriginAsCurrentTab =
          currentTabOrigin !== null && targetOrigin !== null && currentTabOrigin === targetOrigin;
        const isActiveTarget = activeTarget?.targetId === target.targetId;

        const relationHints: string[] = [];
        if (isActiveTarget) relationHints.push('active_target');
        if (currentTabMatch) relationHints.push('matches_current_tab_url');
        if (!currentTabMatch && sameOriginAsCurrentTab) {
          relationHints.push('same_origin_as_current_tab');
        }
        if (target.openerId && activeTarget?.targetId === target.openerId) {
          relationHints.push('opened_by_active_target');
        }
        if (target.openerId && !relationHints.includes('opened_by_active_target')) {
          relationHints.push('has_opener_target');
        }
        if (target.openerFrameId) {
          relationHints.push('has_opener_frame');
        }

        return {
          ...target,
          isActiveTarget,
          matchesCurrentTabUrl: currentTabMatch,
          sameOriginAsCurrentTab,
          relationHints,
        };
      });

      return R.ok().build({
        count: enrichedTargets.length,
        activeTarget,
        currentTab: currentTab
          ? {
              index: currentTab.index,
              url: currentTab.url,
              title: currentTab.title,
            }
          : null,
        filters: {
          type: type ?? null,
          types: types ?? null,
          targetId: targetId ?? null,
          urlPattern: urlPattern ?? null,
          titlePattern: titlePattern ?? null,
          attachedOnly,
        },
        targets: enrichedTargets,
      });
    } catch (error) {
      logger.error('Failed to list CDP targets:', error);
      return R.fail(error instanceof Error ? error.message : String(error)).build();
    }
  }

  async handleBrowserAttachCdpTarget(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const targetId = argString(args, 'targetId');
      if (!targetId) {
        throw new Error('targetId is required');
      }

      const target = await this.deps.collector.attachCdpTarget(targetId);
      const pageContext = await this.syncAttachedPageContext(target);
      this.markMonitoringContextChanged('browser_attach_cdp_target');

      return R.ok().build({
        attached: true,
        target,
        ...pageContext,
      });
    } catch (error) {
      logger.error('Failed to attach CDP target:', error);
      return R.fail(error instanceof Error ? error.message : String(error)).build();
    }
  }

  async handleBrowserDetachCdpTarget(_args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const activeTarget = this.deps.collector.getAttachedTargetInfo();
      const detached = await this.deps.collector.detachCdpTarget();

      if (detached) {
        this.markMonitoringContextChanged('browser_detach_cdp_target');
      }

      return R.ok().build({
        detached,
        targetId: activeTarget?.targetId ?? null,
      });
    } catch (error) {
      logger.error('Failed to detach CDP target:', error);
      return R.fail(error instanceof Error ? error.message : String(error)).build();
    }
  }

  private classifyWorker(type: string): string {
    switch (type) {
      case 'service_worker':
        return 'service_worker';
      case 'shared_worker':
        return 'shared_worker';
      case 'worker':
        return 'dedicated_worker';
      default:
        return type;
    }
  }

  async handleBrowserListWorkers(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const urlPattern = argString(args, 'urlPattern');
      const includeServiceWorkers = argBool(args, 'includeServiceWorkers', true);
      const includeDedicatedWorkers = argBool(args, 'includeDedicatedWorkers', true);
      const includeSharedWorkers = argBool(args, 'includeSharedWorkers', true);

      const requestedTypes = WORKER_TARGET_TYPES.filter((type) => {
        if (type === 'service_worker') return includeServiceWorkers;
        if (type === 'shared_worker') return includeSharedWorkers;
        return includeDedicatedWorkers;
      });

      if (requestedTypes.length === 0) {
        return R.fail(
          'No worker types selected. Enable at least one of includeServiceWorkers / ' +
            'includeDedicatedWorkers / includeSharedWorkers.',
        ).build();
      }

      const targets = await this.deps.collector.listCdpTargets({
        types: [...requestedTypes],
        urlPattern: urlPattern ?? undefined,
        discoverOOPIF: true,
      });

      const workers = targets.map((target) => ({
        targetId: target.targetId,
        category: this.classifyWorker(target.type),
        type: target.type,
        title: target.title,
        url: target.url,
        attached: target.attached,
        isServiceWorker: target.type === 'service_worker',
        openerId: target.openerId ?? null,
        browserContextId: target.browserContextId ?? null,
      }));

      return R.ok().build({
        count: workers.length,
        filters: {
          urlPattern: urlPattern ?? null,
          includeServiceWorkers,
          includeDedicatedWorkers,
          includeSharedWorkers,
        },
        workers,
        _nextStepHint:
          workers.length > 0
            ? 'Use browser_worker_scripts(targetId="...") to dump a worker\'s loaded scripts.'
            : 'No worker targets found. Navigate to a PWA / SW-backed page first, then retry.',
      });
    } catch (error) {
      logger.error('Failed to list workers:', error);
      return R.fail(error instanceof Error ? error.message : String(error)).build();
    }
  }

  async handleBrowserWorkerScripts(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const targetId = argString(args, 'targetId');
      if (!targetId) {
        return R.fail(
          'targetId is required. Call browser_list_workers first to obtain a worker targetId.',
        ).build();
      }

      const includeSource = argBool(args, 'includeSource', false);
      const maxScripts = argNumber(args, 'maxScripts');

      const result = await this.deps.collector.dumpTargetScripts(targetId, {
        includeSource,
        maxScripts: maxScripts ?? undefined,
      });

      return R.ok().build({
        ...result,
        _nextStepHint: includeSource
          ? 'Scripts include source (capped per WORKER_SCRIPT_SOURCE_MAX_BYTES). Analyze with the analysis domain.'
          : 'Set includeSource=true to dump each script body (source is byte-capped to protect context).',
      });
    } catch (error) {
      logger.error('Failed to dump worker scripts:', error);
      return R.fail(error instanceof Error ? error.message : String(error)).build();
    }
  }
}
