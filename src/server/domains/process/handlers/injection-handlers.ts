/**
 * Injection handlers — DLL/shellcode injection, check_debug_port, enumerate_modules, electron_attach.
 */

import { logger } from '@utils/logger';
import { connectPlaywrightCdpFallback } from '@modules/collector/playwright-cdp-fallback';
import type { ProcessHandlerDeps } from './shared-types';
import type { ProcessManagementHandlers } from './process-management';
import {
  validatePid,
  requireString,
  getOptionalPid,
  getOptionalString,
  getOptionalBinaryEncoding,
  getWriteSize,
  normalizeBinaryEncoding,
  normalizeInjectionValidationMode,
  parseOptionalStringArg,
} from '../handlers.base.types';
import { validateExpression, sanitizeErrorMessage } from './expression-validator';

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'object' && error !== null) {
    try {
      return JSON.stringify(error, null, 2);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

const ELECTRON_ATTACH_CONNECT_TIMEOUT_MS =
  Number(process.env.JSHOOK_ELECTRON_ATTACH_CONNECT_TIMEOUT_MS) || 5000;

async function connectElectronBrowserCompatible(browserWSEndpoint: string) {
  const { default: puppeteer } = await import('rebrowser-puppeteer-core');

  try {
    return await new Promise<Awaited<ReturnType<typeof puppeteer.connect>>>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        settled = true;
        reject(
          new Error(
            `Timed out after ${ELECTRON_ATTACH_CONNECT_TIMEOUT_MS}ms while connecting to Electron browser endpoint ` +
              `${browserWSEndpoint}.`,
          ),
        );
      }, ELECTRON_ATTACH_CONNECT_TIMEOUT_MS);

      void puppeteer
        .connect({
          browserWSEndpoint,
          defaultViewport: null,
        })
        .then(async (browser) => {
          if (settled) {
            try {
              await browser.disconnect();
            } catch {
              // Best-effort cleanup for stale browser connections
            }
            return;
          }

          settled = true;
          clearTimeout(timer);
          resolve(browser);
        })
        .catch((error) => {
          if (settled) {
            return;
          }

          settled = true;
          clearTimeout(timer);
          reject(error);
        });
    });
  } catch (primaryError) {
    try {
      return await connectPlaywrightCdpFallback(
        browserWSEndpoint,
        ELECTRON_ATTACH_CONNECT_TIMEOUT_MS,
      );
    } catch (fallbackError) {
      throw new Error(
        `Failed to connect to Electron browser endpoint ${browserWSEndpoint} via both rebrowser-puppeteer and ` +
          `Playwright compatibility fallback. ` +
          `Primary error: ${formatUnknownError(primaryError)}. Fallback error: ${formatUnknownError(fallbackError)}.`,
        { cause: fallbackError },
      );
    }
  }
}

export class InjectionHandlers {
  private memoryManager;
  private processMgmt: ProcessManagementHandlers;

  constructor(deps: ProcessHandlerDeps, processMgmt: ProcessManagementHandlers) {
    this.memoryManager = deps.memoryManager;
    this.processMgmt = processMgmt;
  }

  async handleInjectDll(args: Record<string, unknown>) {
    const startedAt = Date.now();

    try {
      const pid = validatePid(args.pid);
      const dllPath = requireString(args.dllPath, 'dllPath');
      const confirmed = typeof args.confirmed === 'boolean' ? args.confirmed : undefined;
      const payloadHash = parseOptionalStringArg(args.payloadHash, 'payloadHash');
      const validationMode = normalizeInjectionValidationMode(
        args.validationMode,
        'validationMode',
      );

      const result = await this.memoryManager.injectDll(pid, dllPath, {
        confirmed,
        payloadHash,
        validationMode,
      });

      this.processMgmt.recordMemoryAudit({
        operation: 'inject_dll',
        pid,
        address: dllPath,
        size: null,
        result: result.success ? 'success' : 'failure',
        error: result.error,
        durationMs: Date.now() - startedAt,
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      logger.error('DLL injection failed:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.processMgmt.recordMemoryAudit({
        operation: 'inject_dll',
        pid: getOptionalPid(args.pid) ?? null,
        address: getOptionalString(args.dllPath) ?? null,
        size: null,
        result: 'failure',
        error: errorMessage,
        durationMs: Date.now() - startedAt,
      });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ success: false, error: errorMessage }, null, 2),
          },
        ],
      };
    }
  }

  async handleInjectShellcode(args: Record<string, unknown>) {
    const startedAt = Date.now();

    try {
      const pid = validatePid(args.pid);
      const shellcode = requireString(args.shellcode, 'shellcode');
      const encoding = normalizeBinaryEncoding(args.encoding, 'encoding') ?? 'hex';
      const confirmed = typeof args.confirmed === 'boolean' ? args.confirmed : undefined;
      const validationMode = normalizeInjectionValidationMode(
        args.validationMode,
        'validationMode',
      );
      const size = getWriteSize(shellcode, encoding);

      const result = await this.memoryManager.injectShellcode(pid, shellcode, encoding, {
        confirmed,
        validationMode,
      });

      this.processMgmt.recordMemoryAudit({
        operation: 'inject_shellcode',
        pid,
        address: null,
        size,
        result: result.success ? 'success' : 'failure',
        error: result.error,
        durationMs: Date.now() - startedAt,
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      logger.error('Shellcode injection failed:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      const shellcode = getOptionalString(args.shellcode);
      const encoding = getOptionalBinaryEncoding(args.encoding) ?? 'hex';
      this.processMgmt.recordMemoryAudit({
        operation: 'inject_shellcode',
        pid: getOptionalPid(args.pid) ?? null,
        address: null,
        size: shellcode ? getWriteSize(shellcode, encoding) : null,
        result: 'failure',
        error: errorMessage,
        durationMs: Date.now() - startedAt,
      });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ success: false, error: errorMessage }, null, 2),
          },
        ],
      };
    }
  }

  async handleCheckDebugPort(args: Record<string, unknown>) {
    try {
      const pid = validatePid(args.pid);
      const result = await this.memoryManager.checkDebugPort(pid);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: result.success,
                pid,
                isDebugged: result.isDebugged ?? null,
                error: result.error,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      logger.error('check_debug_port failed:', error);
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

  async handleEnumerateModules(args: Record<string, unknown>) {
    try {
      const pid = validatePid(args.pid);
      const result = await this.memoryManager.enumerateModules(pid);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: result.success,
                pid,
                moduleCount: result.modules?.length ?? 0,
                modules: result.modules ?? [],
                error: result.error,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      logger.error('enumerate_modules failed:', error);
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

  async handleProcessEnumThreads(args: Record<string, unknown>) {
    try {
      const pid = validatePid(args.pid);
      if (this.processMgmt.platformValue !== 'win32') {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: 'process_enum_threads is only available on Windows',
                platform: this.processMgmt.platformValue,
              }),
            },
          ],
        };
      }
      const { EnumerateProcessThreads } = await import('@native/Win32Debug');
      const threadIds = EnumerateProcessThreads(pid);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                pid,
                threadCount: threadIds.length,
                threadIds,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      logger.error('process_enum_threads failed:', error);
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

  async handleElectronAttach(args: Record<string, unknown>) {
    const rawPort = args.port ?? 9229;
    const port = Number(rawPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              success: false,
              error: `Invalid port: ${JSON.stringify(rawPort)}. Must be integer 1-65535.`,
            }),
          },
        ],
      };
    }
    const wsEndpointArg = parseOptionalStringArg(args.wsEndpoint, 'wsEndpoint') ?? '';
    const evaluateExpr = parseOptionalStringArg(args.evaluate, 'evaluate') ?? '';
    const pageUrl = parseOptionalStringArg(args.pageUrl, 'pageUrl') ?? '';

    try {
      const baseUrl = `http://127.0.0.1:${port}`;
      const targets = await this.fetchCdpTargets(baseUrl);

      if (!Array.isArray(targets)) {
        throw new Error('CDP target list is not an array');
      }

      const filtered = pageUrl ? targets.filter((t) => t.url.includes(pageUrl)) : targets;

      if (!evaluateExpr) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  total: targets.length,
                  filtered: filtered.length,
                  pages: filtered.map((t) => ({
                    id: t.id,
                    title: t.title,
                    url: t.url,
                    type: t.type,
                    wsUrl: t.webSocketDebuggerUrl,
                  })),
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // Security validation: block dangerous expressions before execution
      const validation = validateExpression(evaluateExpr);
      if (!validation.valid) {
        logger.warn(`electron_attach: blocked expression - ${validation.error}`);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: false,
                  error: validation.error,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      const target = filtered[0];
      if (!target?.webSocketDebuggerUrl) {
        return {
          content: [
            {
              type: 'text',
              text:
                `No matching page found (pageUrl filter: "${pageUrl}"). Available targets:\n` +
                targets.map((t) => `  [${t.type}] ${t.title} — ${t.url}`).join('\n'),
            },
          ],
        };
      }

      const browserWsEndpoint = await this.resolveBrowserWsEndpoint(baseUrl, wsEndpointArg, target);

      if (!browserWsEndpoint) {
        throw new Error('Could not determine browser WebSocket endpoint');
      }
      const browser = await connectElectronBrowserCompatible(browserWsEndpoint);

      let evalResult: unknown;
      let evalError: string | undefined;
      try {
        const pages = await browser.pages();
        const matchedPage = pages.find((p) => p.url().includes(target.url)) ?? pages[0];
        if (!matchedPage) throw new Error('Could not get page from connected browser');

        // Use page.evaluate directly without Function constructor
        // The validated expression is executed in the page's JavaScript context via CDP
        const evaluated = await matchedPage.evaluate((expression: string) => {
          try {
            // Use indirect eval to execute in global scope
            // This avoids Function constructor but still executes the expression
            const result = (0, eval)(expression);
            return { ok: true as const, result };
          } catch (e: unknown) {
            const errorLike =
              typeof e === 'object' && e !== null
                ? (e as { name?: unknown; message?: unknown; stack?: unknown })
                : {};
            return {
              ok: false as const,
              error: {
                name: errorLike.name || 'Error',
                message: String(errorLike.message || e),
                stack: errorLike.stack ? String(errorLike.stack) : undefined,
              },
            };
          }
        }, evaluateExpr);

        if (!evaluated?.ok) {
          const rawError =
            `Evaluation failed: ${evaluated?.error?.name || 'Error'}: ` +
            `${evaluated?.error?.message || 'Unknown error'}`;
          // Sanitize error message to prevent information disclosure
          evalError = sanitizeErrorMessage(rawError);
        } else {
          evalResult = evaluated.result;
        }
      } finally {
        await browser.disconnect();
      }

      if (evalError) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: false,
                  error: evalError,
                  target: { title: target.title, url: target.url },
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      logger.info(`electron_attach: evaluated in ${target.title}`);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                target: { title: target.title, url: target.url },
                result: evalResult,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      logger.error('electron_attach failed:', error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: formatUnknownError(error),
              },
              null,
              2,
            ),
          },
        ],
      };
    }
  }

  // ── Private helpers ──

  private async fetchCdpTargets(baseUrl: string): Promise<
    Array<{
      id: string;
      title: string;
      url: string;
      webSocketDebuggerUrl?: string;
      type: string;
    }>
  > {
    const listUrl = `${baseUrl}/json/list`;
    try {
      const resp = await fetch(listUrl);
      if (!resp.ok) {
        throw new Error(`CDP list endpoint returned HTTP ${resp.status}`);
      }
      return (await resp.json()) as Array<{
        id: string;
        title: string;
        url: string;
        webSocketDebuggerUrl?: string;
        type: string;
      }>;
    } catch (listError) {
      try {
        const resp = await fetch(`${baseUrl}/json`);
        if (!resp.ok) {
          throw new Error(`CDP fallback endpoint returned HTTP ${resp.status}`, {
            cause: listError,
          });
        }
        return (await resp.json()) as Array<{
          id: string;
          title: string;
          url: string;
          webSocketDebuggerUrl?: string;
          type: string;
        }>;
      } catch (fallbackError) {
        const original = formatUnknownError(fallbackError || listError);
        throw new Error(
          `Cannot connect to Electron CDP at ${baseUrl}. ` +
            `Ensure the target app is running with a remote debugging port (for example: process_launch_debug with ` +
            `debugPort=${baseUrl.split(':').pop()}), ` +
            `then retry electron_attach. Original error: ${original}`,
          { cause: fallbackError },
        );
      }
    }
  }

  private async resolveBrowserWsEndpoint(
    baseUrl: string,
    wsEndpointArg: string,
    target: { webSocketDebuggerUrl?: string },
  ): Promise<string | undefined> {
    if (wsEndpointArg) return wsEndpointArg;

    // Try /json/version first
    try {
      const versionResp = await fetch(`${baseUrl}/json/version`);
      if (versionResp.ok) {
        const versionData = (await versionResp.json()) as { webSocketDebuggerUrl?: string };
        if (versionData.webSocketDebuggerUrl) {
          return versionData.webSocketDebuggerUrl;
        }
      }
    } catch {
      // ignore and fall back to page-url-derived endpoint
    }

    // Derive from page target
    if (target.webSocketDebuggerUrl) {
      return target.webSocketDebuggerUrl
        .replace(/\/devtools\/page\/[^/]+$/, '')
        .replace('/devtools/page', '/devtools/browser');
    }

    return undefined;
  }
}
