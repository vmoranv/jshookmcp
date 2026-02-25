/**
 * Process Manager Tool Handlers
 * Implements the MCP tool handlers for cross-platform process management
 */

import { UnifiedProcessManager, MemoryManager } from '../../../modules/process/index.js';
import { logger } from '../../../utils/logger.js';

export class ProcessToolHandlers {
  private processManager: UnifiedProcessManager;
  private memoryManager: MemoryManager;
  private platform: string;

  constructor() {
    this.processManager = new UnifiedProcessManager();
    this.memoryManager = new MemoryManager();
    this.platform = this.processManager.getPlatform();
    logger.info(`ProcessToolHandlers initialized for platform: ${this.platform}`);
  }

  async handleProcessFind(args: Record<string, unknown>) {
    try {
      const pattern = args.pattern as string;
      const processes = await this.processManager.findProcesses(pattern);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                pattern,
                count: processes.length,
                processes: processes.map((p: any) => ({
                  pid: p.pid,
                  name: p.name,
                  path: p.executablePath,
                  windowTitle: p.windowTitle,
                  windowHandle: p.windowHandle,
                  memoryMB: p.memoryUsage ? Math.round(p.memoryUsage / 1024 / 1024) : undefined,
                })),
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      logger.error('Process find failed:', error);
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
              2
            ),
          },
        ],
      };
    }
  }

  async handleProcessGet(args: Record<string, unknown>) {
    try {
      const pid = args.pid as number;
      const process = await this.processManager.getProcessByPid(pid);

      if (!process) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: false,
                  message: `Process with PID ${pid} not found`,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      const cmdLine = await this.processManager.getProcessCommandLine(pid);
      const debugPort = await this.processManager.checkDebugPort(pid);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                process: {
                  ...process,
                  commandLine: cmdLine.commandLine,
                  parentPid: cmdLine.parentPid,
                  debugPort,
                },
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      logger.error('Process get failed:', error);
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
              2
            ),
          },
        ],
      };
    }
  }

  async handleProcessWindows(args: Record<string, unknown>) {
    try {
      const pid = args.pid as number;
      const windows = await this.processManager.getProcessWindows(pid);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                pid,
                windowCount: windows.length,
                windows: windows.map((w: any) => ({
                  handle: w.handle,
                  title: w.title,
                  className: w.className,
                  processId: w.processId,
                })),
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      logger.error('Process windows failed:', error);
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
              2
            ),
          },
        ],
      };
    }
  }

  async handleProcessFindChromium(_args: Record<string, unknown>) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: false,
              disabled: true,
              message:
                'process_find_chromium is disabled to avoid scanning user-installed browser processes.',
              guidance: [
                'Use browser_launch(driver="chrome"|"camoufox") to start a managed browser session.',
                'Use browser_attach/browser_launch(mode="connect") with an explicit browserURL/wsEndpoint.',
                'Use process_launch_debug for explicitly targeted Electron/Chromium executables.',
              ],
              platform: this.platform,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handleProcessCheckDebugPort(args: Record<string, unknown>) {
    try {
      const pid = args.pid as number;
      const debugPort = await this.processManager.checkDebugPort(pid);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                pid,
                debugPort,
                canAttach: debugPort !== null,
                attachUrl: debugPort ? `http://localhost:${debugPort}` : null,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      logger.error('Check debug port failed:', error);
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
              2
            ),
          },
        ],
      };
    }
  }

  async handleProcessLaunchDebug(args: Record<string, unknown>) {
    try {
      const executablePath = args.executablePath as string;
      const debugPort = (args.debugPort as number) || 9222;
      const argsList = (args.args as string[]) || [];

      const process = await this.processManager.launchWithDebug(executablePath, debugPort, argsList);

      if (!process) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: false,
                  message: 'Failed to launch process',
                },
                null,
                2
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
                process: {
                  pid: process.pid,
                  name: process.name,
                  path: process.executablePath,
                },
                debugPort,
                attachUrl: `http://localhost:${debugPort}`,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      logger.error('Launch debug failed:', error);
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
              2
            ),
          },
        ],
      };
    }
  }

  async handleProcessKill(args: Record<string, unknown>) {
    try {
      const pid = args.pid as number;
      const killed = await this.processManager.killProcess(pid);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: killed,
                pid,
                message: killed ? `Process ${pid} killed successfully` : `Failed to kill process ${pid}`,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      logger.error('Process kill failed:', error);
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
              2
            ),
          },
        ],
      };
    }
  }

  async handleMemoryRead(args: Record<string, unknown>) {
    try {
      const pid = args.pid as number;
      const address = args.address as string;
      const size = args.size as number;

      // Check availability first
      const availability = await this.memoryManager.checkAvailability();
      if (!availability.available) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: false,
                  message: 'Memory operations not available',
                  reason: availability.reason,
                  platform: this.platform,
                  requestedAddress: address,
                  requestedSize: size,
                  pid,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      const result = await this.memoryManager.readMemory(pid, address, size);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: result.success,
                data: result.data,
                error: result.error,
                pid,
                address,
                size,
                platform: this.platform,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      logger.error('Memory read failed:', error);
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
              2
            ),
          },
        ],
      };
    }
  }

  async handleMemoryWrite(args: Record<string, unknown>) {
    try {
      const pid = args.pid as number;
      const address = args.address as string;
      const data = args.data as string;
      const encoding = (args.encoding as 'hex' | 'base64') || 'hex';

      // Check availability first
      const availability = await this.memoryManager.checkAvailability();
      if (!availability.available) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: false,
                  message: 'Memory operations not available',
                  reason: availability.reason,
                  platform: this.platform,
                  requestedAddress: address,
                  dataLength: data != null ? data.length : 0,
                  encoding,
                  pid,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      const result = await this.memoryManager.writeMemory(pid, address, data, encoding);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: result.success,
                bytesWritten: result.bytesWritten,
                error: result.error,
                pid,
                address,
                dataLength: data.length,
                encoding,
                platform: this.platform,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      logger.error('Memory write failed:', error);
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
              2
            ),
          },
        ],
      };
    }
  }

  async handleMemoryScan(args: Record<string, unknown>) {
    try {
      const pid = args.pid as number;
      const pattern = args.pattern as string;
      const patternType = (args.patternType as string) || 'hex';

      // Check availability first
      const availability = await this.memoryManager.checkAvailability();
      if (!availability.available) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: false,
                  message: 'Memory operations not available',
                  reason: availability.reason,
                  platform: this.platform,
                  requestedPattern: pattern,
                  patternType,
                  pid,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      const result = await this.memoryManager.scanMemory(pid, pattern, patternType as any);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: result.success,
                addresses: result.addresses,
                error: result.error,
                pid,
                pattern,
                patternType,
                platform: this.platform,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      logger.error('Memory scan failed:', error);
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
              2
            ),
          },
        ],
      };
    }
  }

  // Advanced memory operation handlers

  async handleMemoryCheckProtection(args: Record<string, unknown>) {
    try {
      const pid = args.pid as number;
      const address = args.address as string;

      const result = await this.memoryManager.checkMemoryProtection(pid, address);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error('Memory check protection failed:', error);
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

  async handleMemoryScanFiltered(args: Record<string, unknown>) {
    try {
      const pid = args.pid as number;
      const pattern = args.pattern as string;
      const addresses = args.addresses as string[];
      const patternType = (args.patternType as string) || 'hex';

      const availability = await this.memoryManager.checkAvailability();
      if (!availability.available) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: false,
                  message: 'Memory operations not available',
                  reason: availability.reason,
                  platform: this.platform,
                  pid,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      const result = await this.memoryManager.scanMemoryFiltered(pid, pattern, addresses, patternType as any);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error('Memory scan filtered failed:', error);
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

  async handleMemoryBatchWrite(args: Record<string, unknown>) {
    try {
      const pid = args.pid as number;
      const patches = args.patches as { address: string; data: string; encoding?: 'hex' | 'base64' }[];

      const availability = await this.memoryManager.checkAvailability();
      if (!availability.available) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: false,
                  message: 'Memory operations not available',
                  reason: availability.reason,
                  platform: this.platform,
                  pid,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      const result = await this.memoryManager.batchMemoryWrite(pid, patches);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error('Memory batch write failed:', error);
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

  async handleMemoryDumpRegion(args: Record<string, unknown>) {
    try {
      const pid = args.pid as number;
      const address = args.address as string;
      const size = args.size as number;
      const outputPath = args.outputPath as string;

      const result = await this.memoryManager.dumpMemoryRegion(pid, address, size, outputPath);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error('Memory dump region failed:', error);
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

  async handleMemoryListRegions(args: Record<string, unknown>) {
    try {
      const pid = args.pid as number;

      const result = await this.memoryManager.enumerateRegions(pid);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error('Memory list regions failed:', error);
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

  // Injection handlers

  async handleInjectDll(args: Record<string, unknown>) {
    try {
      const pid = args.pid as number;
      const dllPath = args.dllPath as string;

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
      const pid = args.pid as number;
      const shellcode = args.shellcode as string;
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

  // Anti-detection handlers

  async handleCheckDebugPort(args: Record<string, unknown>) {
    try {
      const pid = args.pid as number;

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
      const pid = args.pid as number;

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
    const port = (args.port as number | undefined) ?? 9229;
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

      // Step 1: enumerate pages via CDP HTTP JSON API
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
        // try /json fallback
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

      // Step 2: evaluate JS in the matched page using puppeteer.connect
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

      // Use rebrowser-puppeteer-core to connect via CDP
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
            // Use Function constructor for safer evaluation
            // eslint-disable-next-line no-new-func
            const fn = new Function('return (' + expression + ')');
            return { ok: true as const, result: fn() };
          } catch (e: any) {
            return {
              ok: false as const,
              error: {
                name: e?.name || 'Error',
                message: String(e?.message || e),
                stack: e?.stack ? String(e.stack) : undefined,
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
