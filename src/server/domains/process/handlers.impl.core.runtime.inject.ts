import { logger } from '@utils/logger';
import { ENABLE_INJECTION_TOOLS } from '@src/constants';
import { connectPlaywrightCdpFallback } from '@modules/collector/playwright-cdp-fallback';
import {
  ProcessHandlersBase,
  requireString,
  validatePid,
} from '@server/domains/process/handlers.base';

const INJECTION_TOOLS_DISABLED_ERROR =
  'Injection tools are disabled by configuration. Set ENABLE_INJECTION_TOOLS=true before starting the server to enable DLL and shellcode injection.';

const INJECTION_TOOLS_ENABLE_GUIDANCE =
  'Set ENABLE_INJECTION_TOOLS=true before starting the server.';

const INJECTION_TOOLS_SECURITY_NOTICE =
  'Injection tools can destabilize target processes; review impact before use.';

function buildInjectionDisabledPayload() {
  return {
    success: false,
    error: INJECTION_TOOLS_DISABLED_ERROR,
    howToEnable: INJECTION_TOOLS_ENABLE_GUIDANCE,
    securityNotice: INJECTION_TOOLS_SECURITY_NOTICE,
  };
}

function getOptionalPid(value: unknown): number | null {
  const pid = Number(value);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

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

function getOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function getShellcodeSize(shellcode: string, encoding: 'hex' | 'base64'): number {
  if (encoding === 'hex') {
    const normalized = shellcode.replace(/\s+/g, '');
    return Math.ceil(normalized.length / 2);
  }

  return Buffer.from(shellcode, 'base64').length;
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
            `Timed out after ${ELECTRON_ATTACH_CONNECT_TIMEOUT_MS}ms while connecting to Electron browser endpoint ${browserWSEndpoint}.`,
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
        `Failed to connect to Electron browser endpoint ${browserWSEndpoint} via both rebrowser-puppeteer and Playwright compatibility fallback. ` +
          `Primary error: ${formatUnknownError(primaryError)}. Fallback error: ${formatUnknownError(fallbackError)}.`,
        { cause: fallbackError },
      );
    }
  }
}

export class ProcessToolHandlersRuntime extends ProcessHandlersBase {
  async handleInjectDll(args: Record<string, unknown>) {
    const startedAt = Date.now();

    if (!ENABLE_INJECTION_TOOLS) {
      this.recordMemoryAudit({
        operation: 'inject_dll',
        pid: getOptionalPid(args.pid),
        address: getOptionalString(args.dllPath),
        size: null,
        result: 'failure',
        error: INJECTION_TOOLS_DISABLED_ERROR,
        durationMs: Date.now() - startedAt,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(buildInjectionDisabledPayload(), null, 2),
          },
        ],
      };
    }

    try {
      const pid = validatePid(args.pid);
      const dllPath = requireString(args.dllPath, 'dllPath');

      const result = await this.memoryManager.injectDll(pid, dllPath);
      this.recordMemoryAudit({
        operation: 'inject_dll',
        pid,
        address: dllPath,
        size: null,
        result: result.success ? 'success' : 'failure',
        error: result.error,
        durationMs: Date.now() - startedAt,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error('DLL injection failed:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.recordMemoryAudit({
        operation: 'inject_dll',
        pid: getOptionalPid(args.pid),
        address: getOptionalString(args.dllPath),
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

    if (!ENABLE_INJECTION_TOOLS) {
      const shellcode = getOptionalString(args.shellcode);
      const encoding = (args.encoding as 'hex' | 'base64') || 'hex';
      this.recordMemoryAudit({
        operation: 'inject_shellcode',
        pid: getOptionalPid(args.pid),
        address: null,
        size: shellcode ? getShellcodeSize(shellcode, encoding) : null,
        result: 'failure',
        error: INJECTION_TOOLS_DISABLED_ERROR,
        durationMs: Date.now() - startedAt,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(buildInjectionDisabledPayload(), null, 2),
          },
        ],
      };
    }

    try {
      const pid = validatePid(args.pid);
      const shellcode = requireString(args.shellcode, 'shellcode');
      const encoding = (args.encoding as 'hex' | 'base64') || 'hex';
      const size = getShellcodeSize(shellcode, encoding);

      const result = await this.memoryManager.injectShellcode(pid, shellcode, encoding);
      this.recordMemoryAudit({
        operation: 'inject_shellcode',
        pid,
        address: null,
        size,
        result: result.success ? 'success' : 'failure',
        error: result.error,
        durationMs: Date.now() - startedAt,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error('Shellcode injection failed:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      const shellcode = getOptionalString(args.shellcode);
      const encoding = (args.encoding as 'hex' | 'base64') || 'hex';
      this.recordMemoryAudit({
        operation: 'inject_shellcode',
        pid: getOptionalPid(args.pid),
        address: null,
        size: shellcode ? getShellcodeSize(shellcode, encoding) : null,
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
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error('Debug port check failed:', error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { success: false, error: error instanceof Error ? error.message : String(error) },
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
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error('Module enumeration failed:', error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { success: false, error: error instanceof Error ? error.message : String(error) },
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
    const wsEndpointArg = (args.wsEndpoint as string | undefined) ?? '';
    const evaluateExpr = (args.evaluate as string | undefined) ?? '';
    const pageUrl = (args.pageUrl as string | undefined) ?? '';

    try {
      type CdpTarget = {
        id: string;
        title: string;
        url: string;
        webSocketDebuggerUrl?: string;
        type: string;
      };

      const baseUrl = `http://127.0.0.1:${port}`;
      const listUrl = `${baseUrl}/json/list`;
      let targets: CdpTarget[];

      try {
        const resp = await fetch(listUrl);
        if (!resp.ok) {
          throw new Error(`CDP list endpoint returned HTTP ${resp.status}`);
        }
        targets = (await resp.json()) as CdpTarget[];
      } catch (listError) {
        try {
          const resp = await fetch(`${baseUrl}/json`);
          if (!resp.ok) {
            throw new Error(`CDP fallback endpoint returned HTTP ${resp.status}`, {
              cause: listError,
            });
          }
          targets = (await resp.json()) as CdpTarget[];
        } catch (fallbackError) {
          const original = formatUnknownError(fallbackError || listError);
          throw new Error(
            `Cannot connect to Electron CDP at ${baseUrl}. ` +
              `Ensure the target app is running with a remote debugging port (for example: process_launch_debug with debugPort=${port}), ` +
              `then retry electron_attach. Original error: ${original}`,
            { cause: fallbackError },
          );
        }
      }

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

      let browserWsEndpoint = wsEndpointArg;

      if (!browserWsEndpoint) {
        try {
          const versionResp = await fetch(`${baseUrl}/json/version`);
          if (versionResp.ok) {
            const versionData = (await versionResp.json()) as { webSocketDebuggerUrl?: string };
            if (versionData.webSocketDebuggerUrl) {
              browserWsEndpoint = versionData.webSocketDebuggerUrl;
            }
          }
        } catch {
          // ignore and fall back to page-url-derived endpoint
        }
      }

      if (!browserWsEndpoint) {
        browserWsEndpoint = target.webSocketDebuggerUrl
          .replace(/\/devtools\/page\/[^/]+$/, '')
          .replace('/devtools/page', '/devtools/browser');
      }

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
        const evaluated = await matchedPage.evaluate((expression: string) => {
          try {
            const fn = new Function('return (' + expression + ')');
            return { ok: true as const, result: fn() };
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
          evalError = `Evaluation failed: ${evaluated?.error?.name || 'Error'}: ${evaluated?.error?.message || 'Unknown error'}`;
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
}
