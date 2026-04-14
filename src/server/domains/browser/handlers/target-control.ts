import type { CodeCollector, ConsoleMonitor } from '@server/domains/shared/modules';
import type { TabRegistry } from '@modules/browser/TabRegistry';
import { argBool, argString, argStringArray } from '@server/domains/shared/parse-args';
import { logger } from '@utils/logger';

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
        `[${context}] Failed to mark monitoring context as stale: ${error instanceof Error ? error.message : String(error)}`,
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

  async handleBrowserListCdpTargets(args: Record<string, unknown>) {
    try {
      const type = argString(args, 'type');
      const types = argStringArray(args, 'types');
      const targetId = argString(args, 'targetId');
      const urlPattern = argString(args, 'urlPattern');
      const titlePattern = argString(args, 'titlePattern');
      const attachedOnly = argBool(args, 'attachedOnly', false);

      const targets = await this.deps.collector.listCdpTargets({
        type: type ?? undefined,
        types: types ?? undefined,
        targetId: targetId ?? undefined,
        urlPattern: urlPattern ?? undefined,
        titlePattern: titlePattern ?? undefined,
        attachedOnly,
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

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
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
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      logger.error('Failed to list CDP targets:', error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: error instanceof Error ? error.message : String(error),
              },
              null,
              2,
            ),
          },
        ],
      };
    }
  }

  async handleBrowserAttachCdpTarget(args: Record<string, unknown>) {
    try {
      const targetId = argString(args, 'targetId');
      if (!targetId) {
        throw new Error('targetId is required');
      }

      const target = await this.deps.collector.attachCdpTarget(targetId);
      this.markMonitoringContextChanged('browser_attach_cdp_target');

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                attached: true,
                target,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      logger.error('Failed to attach CDP target:', error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: error instanceof Error ? error.message : String(error),
              },
              null,
              2,
            ),
          },
        ],
      };
    }
  }

  async handleBrowserDetachCdpTarget(_args: Record<string, unknown>) {
    try {
      const activeTarget = this.deps.collector.getAttachedTargetInfo();
      const detached = await this.deps.collector.detachCdpTarget();

      if (detached) {
        this.markMonitoringContextChanged('browser_detach_cdp_target');
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                detached,
                targetId: activeTarget?.targetId ?? null,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      logger.error('Failed to detach CDP target:', error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: error instanceof Error ? error.message : String(error),
              },
              null,
              2,
            ),
          },
        ],
      };
    }
  }
}
