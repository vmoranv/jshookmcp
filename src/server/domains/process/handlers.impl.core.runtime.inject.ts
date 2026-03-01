import { logger } from '../../../utils/logger.js';
import { ProcessToolHandlersMemory } from './handlers.impl.core.runtime.memory.js';
import { requireString, validatePid } from './handlers.impl.core.runtime.base.js';

export class ProcessToolHandlersRuntime extends ProcessToolHandlersMemory {
  async handleInjectDll(args: Record<string, unknown>) {
    try {
      const pid = validatePid(args.pid);
      const dllPath = requireString(args.dllPath, 'dllPath');

      const result = await this.memoryManager.injectDll(pid, dllPath);

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
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { success: false, error: error instanceof Error ? error.message : String(error) },
              null,
              2
            ),
          },
        ],
      };
    }
  }

  async handleInjectShellcode(args: Record<string, unknown>) {
    try {
      const pid = validatePid(args.pid);
      const shellcode = requireString(args.shellcode, 'shellcode');
      const encoding = (args.encoding as 'hex' | 'base64') || 'hex';

      const result = await this.memoryManager.injectShellcode(pid, shellcode, encoding);

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
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { success: false, error: error instanceof Error ? error.message : String(error) },
              null,
              2
            ),
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
              2
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
              2
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
        content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: `Invalid port: ${JSON.stringify(rawPort)}. Must be integer 1-65535.` }) }],
      };
    }
    const wsEndpointArg = (args.wsEndpoint as string | undefined) ?? '';
    const evaluateExpr = (args.evaluate as string | undefined) ?? '';
    const pageUrl = (args.pageUrl as string | undefined) ?? '';
    const formatUnknownError = (error: unknown): string => {
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
    };

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
            throw new Error(`CDP fallback endpoint returned HTTP ${resp.status}`);
          }
          targets = (await resp.json()) as CdpTarget[];
        } catch (fallbackError) {
          const original = formatUnknownError(fallbackError || listError);
          throw new Error(
            `Cannot connect to Electron CDP at ${baseUrl}. ` +
              `Ensure the target app is running with a remote debugging port (for example: process_launch_debug with debugPort=${port}), ` +
              `then retry electron_attach. Original error: ${original}`
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
                2
              ),
            },
          ],
        };
      }

      const target = filtered[0];
      if (!target || !target.webSocketDebuggerUrl) {
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

      const { default: puppeteer } = await import('rebrowser-puppeteer-core');
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
      const browser = await puppeteer.connect({
        browserWSEndpoint: browserWsEndpoint,
        defaultViewport: null,
      });

      let evalResult: unknown;
      let evalError: string | undefined;
      try {
        const pages = await browser.pages();
        const matchedPage = pages.find((p) => p.url().includes(target.url)) ?? pages[0];
        if (!matchedPage) throw new Error('Could not get page from connected browser');
        const evaluated = await matchedPage.evaluate((expression: string) => {
          try {
            // eslint-disable-next-line no-new-func
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
                2
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
              2
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
              2
            ),
          },
        ],
      };
    }
  }
}
