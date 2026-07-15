import type { PageController } from '@server/domains/shared/modules/collector';
import {
  evaluateWithTimeout,
  evaluateOnNewDocumentWithTimeout,
} from '@modules/collector/PageController';
import { logger } from '@utils/logger';
import {
  argString,
  argStringRequired,
  argBool,
  argNumber,
} from '@server/domains/shared/parse-args';

export interface UnhookGuardOptions {
  /** Auto-unhook after this many intercepted calls. */
  maxMatches?: number;
  /** JS expression source compiled in-page as `new Function('value', src)`; truthy ⇒ unhook. */
  unhookPredicate?: string;
}

/**
 * Build the in-page bootstrap that initialises `__aiHookMetadata[hookId]` with
 * match tracking + installs a global `__aiHookUnhookGuard(hookId, value)`
 * helper. Returns '' when neither option is supplied (byte-identical inject).
 *
 * The user's hook code is expected to call `__aiHookUnhookGuard(hookId, value)`
 * per intercepted call; on the Nth match (or a truthy predicate) the guard
 * flips `metadata.enabled = false`, records `unhookedAt`, and returns true so
 * the hook can restore the original. This is an opt-in convention — `ai_hook`
 * injects arbitrary JS, so auto-wrapping the user code is not possible.
 */
export function buildUnhookGuardBootstrap(hookId: string, opts: UnhookGuardOptions): string {
  if (opts.maxMatches === undefined && !opts.unhookPredicate) {
    return '';
  }
  const maxMatchesLit = typeof opts.maxMatches === 'number' ? String(opts.maxMatches) : 'undefined';
  // CodeQL flags this `new Function('value', src)` as js/bad-code-sanitization, treating
  // `unhookPredicate` as unsanitized user input flowing into an eval sink. That flow is the
  // tool's explicit, intended semantics: `ai_hook` exists to inject *arbitrary* caller-authored
  // JS into the page, and `unhookPredicate` is an opt-in callback expression the caller supplies
  // to decide when to unhook. There is no remote/untrusted input here — the MCP caller is the
  // trusted operator authoring the hook, and the predicate runs inside the same page already
  // running the caller's hook body. Sanitizing the expression would defeat the feature. Safe
  // by design; dismissed as a false positive (not bypassable build-side, so documented here).
  const predicateCompile = opts.unhookPredicate
    ? `__m.unhookPredicate = new Function('value', ${JSON.stringify(opts.unhookPredicate)});`
    : '';
  const id = JSON.stringify(hookId);
  return `(function(){
  globalThis.__aiHookMetadata = globalThis.__aiHookMetadata || {};
  var __m = globalThis.__aiHookMetadata[${id}] = globalThis.__aiHookMetadata[${id}] || {};
  __m.matchCount = 0;
  __m.maxMatches = ${maxMatchesLit};
  ${predicateCompile}
  globalThis.__aiHookUnhookGuard = globalThis.__aiHookUnhookGuard || function(id, value){
    var m = globalThis.__aiHookMetadata && globalThis.__aiHookMetadata[id];
    if (!m) return false;
    m.matchCount = (m.matchCount || 0) + 1;
    if (typeof m.maxMatches === 'number' && m.matchCount >= m.maxMatches) {
      m.enabled = false; m.unhookedAt = (typeof performance!=='undefined'?performance.now():Date.now()); return true;
    }
    if (typeof m.unhookPredicate === 'function') {
      try { if (m.unhookPredicate(value)) { m.enabled = false; m.unhookedAt = (typeof performance!=='undefined'?performance.now():Date.now()); return true; } } catch(e) {}
    }
    return false;
  };
})();`;
}

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

  private async addPersistentScriptToManagedTargets(hookId: string, source: string): Promise<void> {
    await this.pageController.addScriptToPageEvaluateOnNewDocument(source, {
      id: `ai-hook:${hookId}`,
    });
    await this.pageController.addPersistentScriptToManagedTargets(source, {
      id: `ai-hook:${hookId}`,
      evaluateNow: true,
      targetTypes: ['page', 'iframe'],
    });
  }

  async handleAIHookInject(args: Record<string, unknown>) {
    try {
      const hookId = argStringRequired(args, 'hookId');
      const userCode = argStringRequired(args, 'code');
      const method = argString(args, 'method', 'evaluate') as 'evaluateOnNewDocument' | 'evaluate';
      const maxMatches = argNumber(args, 'maxMatches');
      const unhookPredicate = argString(args, 'unhookPredicate');
      const guardBootstrap = buildUnhookGuardBootstrap(hookId, { maxMatches, unhookPredicate });
      const code = guardBootstrap ? `${guardBootstrap}\n${userCode}` : userCode;

      if (this.hasAttachedTargetSession()) {
        if (method === 'evaluateOnNewDocument') {
          await this.addPersistentScriptToManagedTargets(hookId, code);
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
                unhookGuard:
                  guardBootstrap !== '' ? { maxMatches: maxMatches ?? null, enabled: true } : null,
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

  async handleAIHook(args: Record<string, unknown>) {
    const action = String(args['action'] ?? '');
    switch (action) {
      case 'inject':
        return this.handleAIHookInject(args);
      case 'get_data':
        return this.handleAIHookGetData(args);
      case 'list':
        return this.handleAIHookList(args);
      case 'clear':
        return this.handleAIHookClear(args);
      case 'toggle':
        return this.handleAIHookToggle(args);
      case 'export':
        return this.handleAIHookExport(args);
      default:
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: `Unknown action: ${action}. Valid actions: inject, get_data, list, clear, toggle, export`,
              }),
            },
          ],
        };
    }
  }
}
