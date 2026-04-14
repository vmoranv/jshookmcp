import type { PageController } from '@server/domains/shared/modules';
import {
  evaluateWithTimeout,
  evaluateOnNewDocumentWithTimeout,
} from '@modules/collector/PageController';
import { logger } from '@utils/logger';
import { argString, argStringRequired, argBool } from '@server/domains/shared/parse-args';

export class AIHookToolHandlers {
  private injectedHooks: Map<string, { code: string; injectionTime: number }> = new Map();

  constructor(private pageController: PageController) {}

  private hasAttachedTargetSession(): boolean {
    return this.pageController.hasAttachedTargetSession();
  }

  private async evaluateInAttachedTarget(expression: string): Promise<unknown> {
    return await this.pageController.evaluateAttachedTarget(expression, {
      returnByValue: true,
      awaitPromise: true,
    });
  }

  private async addScriptToAttachedTarget(source: string): Promise<void> {
    await this.pageController.addScriptToAttachedTarget(source);
  }

  async handleAIHookInject(args: Record<string, unknown>) {
    try {
      const hookId = argStringRequired(args, 'hookId');
      const code = argStringRequired(args, 'code');
      const method = argString(args, 'method', 'evaluate') as 'evaluateOnNewDocument' | 'evaluate';

      if (this.hasAttachedTargetSession()) {
        if (method === 'evaluateOnNewDocument') {
          await this.addScriptToAttachedTarget(code);
          logger.info(`Hook injected into attached target (evaluateOnNewDocument): ${hookId}`);
        } else {
          await this.evaluateInAttachedTarget(code);
          logger.info(`Hook injected into attached target (evaluate): ${hookId}`);
        }
      } else {
        const page = await this.pageController.getPage();

        if (method === 'evaluateOnNewDocument') {
          await evaluateOnNewDocumentWithTimeout(page, code);
          logger.info(`Hook injected (evaluateOnNewDocument): ${hookId}`);
        } else {
          await evaluateWithTimeout(page, code);
          logger.info(`Hook injected (evaluate): ${hookId}`);
        }
      }

      this.injectedHooks.set(hookId, {
        code,
        injectionTime: Date.now(),
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                hookId,
                message: `Hook (: ${method})`,
                injectionTime: new Date().toISOString(),
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      logger.error('Hook injection failed', error);
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

  async handleAIHookGetData(args: Record<string, unknown>) {
    try {
      const hookId = argStringRequired(args, 'hookId');
      const hookData = this.hasAttachedTargetSession()
        ? await this.evaluateInAttachedTarget(`(() => {
            const hookId = ${JSON.stringify(hookId)};
            const hooks = globalThis.__aiHooks;
            if (!hooks?.[hookId]) {
              return null;
            }
            return {
              hookId,
              metadata: globalThis.__aiHookMetadata?.[hookId],
              records: hooks[hookId],
              totalRecords: hooks[hookId].length,
            };
          })()`)
        : await evaluateWithTimeout(
            await this.pageController.getPage(),
            (id) => {
              if (!window.__aiHooks?.[id]) {
                return null;
              }
              return {
                hookId: id,
                metadata: window.__aiHookMetadata?.[id],
                records: window.__aiHooks[id],
                totalRecords: window.__aiHooks[id].length,
              };
            },
            hookId,
          );

      if (!hookData) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: false,
                  message: `Hook: ${hookId}`,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                ...hookData,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      logger.error('Failed to get hook data', error);
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

  async handleAIHookList(_args: Record<string, unknown>) {
    try {
      const allHooks = this.hasAttachedTargetSession()
        ? ((await this.evaluateInAttachedTarget(`(() => {
            const metadata = globalThis.__aiHookMetadata;
            const hooks = globalThis.__aiHooks;
            if (!metadata) {
              return [];
            }
            return Object.keys(metadata).map((hookId) => ({
              hookId,
              metadata: metadata[hookId],
              recordCount: hooks?.[hookId]?.length || 0,
            }));
          })()`)) as Array<Record<string, unknown>>)
        : await evaluateWithTimeout(await this.pageController.getPage(), () => {
            if (!window.__aiHookMetadata) {
              return [];
            }

            return Object.keys(window.__aiHookMetadata).map((hookId) => ({
              hookId,
              metadata: window.__aiHookMetadata![hookId],
              recordCount: window.__aiHooks?.[hookId]?.length || 0,
            }));
          });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                totalHooks: allHooks.length,
                hooks: allHooks,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      logger.error('Failed to list hooks', error);
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

  async handleAIHookClear(args: Record<string, unknown>) {
    try {
      const hookId = argString(args, 'hookId');

      if (hookId) {
        if (this.hasAttachedTargetSession()) {
          await this.evaluateInAttachedTarget(`(() => {
              const hookId = ${JSON.stringify(hookId)};
              if (globalThis.__aiHooks?.[hookId]) {
                globalThis.__aiHooks[hookId] = [];
              }
              return true;
            })()`);
        } else {
          await evaluateWithTimeout(
            await this.pageController.getPage(),
            (id) => {
              if (window.__aiHooks?.[id]) {
                window.__aiHooks[id] = [];
              }
            },
            hookId,
          );
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  message: `Hook: ${hookId}`,
                },
                null,
                2,
              ),
            },
          ],
        };
      } else {
        if (this.hasAttachedTargetSession()) {
          await this.evaluateInAttachedTarget(`(() => {
              if (globalThis.__aiHooks) {
                for (const key in globalThis.__aiHooks) {
                  globalThis.__aiHooks[key] = [];
                }
              }
              return true;
            })()`);
        } else {
          await evaluateWithTimeout(await this.pageController.getPage(), () => {
            if (window.__aiHooks) {
              for (const key in window.__aiHooks) {
                window.__aiHooks[key] = [];
              }
            }
          });
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  message: 'Hook',
                },
                null,
                2,
              ),
            },
          ],
        };
      }
    } catch (error) {
      logger.error('Failed to clear hook data', error);
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

  async handleAIHookToggle(args: Record<string, unknown>) {
    try {
      const hookId = argStringRequired(args, 'hookId');
      const enabled = argBool(args, 'enabled')!;
      if (this.hasAttachedTargetSession()) {
        await this.evaluateInAttachedTarget(`(() => {
            const hookId = ${JSON.stringify(hookId)};
            const enabled = ${JSON.stringify(enabled)};
            if (globalThis.__aiHookMetadata?.[hookId]) {
              globalThis.__aiHookMetadata[hookId].enabled = enabled;
            }
            return true;
          })()`);
      } else {
        await evaluateWithTimeout(
          await this.pageController.getPage(),
          (id, enable) => {
            if (window.__aiHookMetadata?.[id]) {
              window.__aiHookMetadata[id].enabled = enable;
            }
          },
          hookId,
          enabled,
        );
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                hookId,
                enabled,
                message: `Hook${enabled ? '' : ''}`,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      logger.error('Failed to toggle hook', error);
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

  async handleAIHookExport(args: Record<string, unknown>) {
    try {
      const hookId = argString(args, 'hookId');
      const format = argString(args, 'format', 'json') as 'json' | 'csv';
      const exportData = this.hasAttachedTargetSession()
        ? await this.evaluateInAttachedTarget(`(() => {
            const hookId = ${JSON.stringify(hookId)};
            if (hookId) {
              return {
                hookId,
                metadata: globalThis.__aiHookMetadata?.[hookId],
                records: globalThis.__aiHooks?.[hookId] || [],
              };
            }
            return {
              metadata: globalThis.__aiHookMetadata || {},
              records: globalThis.__aiHooks || {},
            };
          })()`)
        : await evaluateWithTimeout(
            await this.pageController.getPage(),
            (id) => {
              if (id) {
                return {
                  hookId: id,
                  metadata: window.__aiHookMetadata?.[id],
                  records: window.__aiHooks?.[id] || [],
                };
              } else {
                return {
                  metadata: window.__aiHookMetadata || {},
                  records: window.__aiHooks || {},
                };
              }
            },
            hookId,
          );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                format,
                data: exportData,
                exportTime: new Date().toISOString(),
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      logger.error('Failed to export hook data', error);
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
