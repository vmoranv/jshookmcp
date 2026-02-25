import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import { existsSync } from 'fs';
import type {
  EnvironmentEmulatorOptions,
  EnvironmentEmulatorResult,
  DetectedEnvironmentVariables,
  MissingAPI,
} from '../../types/index.js';
import { logger } from '../../utils/logger.js';
import { chromeEnvironmentTemplate } from './templates/chrome-env.js';
import type { LLMService } from '../../services/LLMService.js';
import type { Browser } from 'rebrowser-puppeteer-core';
import puppeteer from 'rebrowser-puppeteer-core';
import {
  generateMissingAPIImplementationsMessages,
  generateMissingVariablesMessages,
} from '../../services/prompts/environment.js';
import { generateEmulationCode, generateRecommendations } from './EmulatorCodeGen.js';
import { findBrowserExecutable } from '../../utils/browserExecutable.js';

export class EnvironmentEmulator {
  private browser?: Browser;
  private llm?: LLMService;

  constructor(llm?: LLMService) {
    this.llm = llm;
    if (llm) {
      logger.info('LLM service unavailable, skipping AI environment analysis');
    }
  }

  async analyze(options: EnvironmentEmulatorOptions): Promise<EnvironmentEmulatorResult> {
    const startTime = Date.now();
    logger.info(' ...');

    const {
      code,
      targetRuntime = 'both',
      autoFetch = false,
      browserUrl,
      browserType = 'chrome',
      includeComments = true,
      extractDepth = 3,
    } = options;

    try {
      logger.info(' ...');
      const detectedVariables = this.detectEnvironmentVariables(code);

      let variableManifest: Record<string, any> = {};
      if (autoFetch && browserUrl) {
        logger.info(' ...');
        variableManifest = await this.fetchRealEnvironment(
          browserUrl,
          detectedVariables,
          extractDepth
        );
      } else {
        variableManifest = this.buildManifestFromTemplate(detectedVariables, browserType);
      }

      if (this.llm) {
        logger.info(' AI...');
        const aiInferredVars = await this.inferMissingVariablesWithAI(
          code,
          detectedVariables,
          variableManifest,
          browserType
        );
        Object.assign(variableManifest, { ...aiInferredVars, ...variableManifest });
      }

      const missingAPIs = this.identifyMissingAPIs(detectedVariables, variableManifest);

      if (this.llm && missingAPIs.length > 0) {
        logger.info(` AI ${missingAPIs.length} API...`);
        await this.generateMissingAPIImplementationsWithAI(missingAPIs, code, variableManifest);
      }

      logger.info(' ...');
      const emulationCode = generateEmulationCode(variableManifest, targetRuntime, includeComments);

      const recommendations = generateRecommendations(detectedVariables, missingAPIs);

      const totalVariables = Object.values(detectedVariables).reduce(
        (sum, arr) => sum + arr.length,
        0
      );
      const autoFilledVariables = Object.keys(variableManifest).length;
      const manualRequiredVariables = missingAPIs.length;

      const result: EnvironmentEmulatorResult = {
        detectedVariables,
        emulationCode,
        missingAPIs,
        variableManifest,
        recommendations,
        stats: {
          totalVariables,
          autoFilledVariables,
          manualRequiredVariables,
        },
      };

      const processingTime = Date.now() - startTime;
      logger.info(`Environment emulation complete in ${processingTime}ms`);
      logger.info(`  Detected ${totalVariables} variables, auto-filled ${autoFilledVariables}`);

      return result;
    } catch (error) {
      logger.error('', error);
      throw error;
    }
  }

  private detectEnvironmentVariables(code: string): DetectedEnvironmentVariables {
    const detected: DetectedEnvironmentVariables = {
      window: [],
      document: [],
      navigator: [],
      location: [],
      screen: [],
      other: [],
    };

    const accessedPaths = new Set<string>();

    try {
      const ast = parser.parse(code, {
        sourceType: 'unambiguous',
        plugins: ['jsx', 'typescript'],
      });

      const self = this;
      traverse(ast, {
        MemberExpression(path) {
          const fullPath = self.getMemberExpressionPath(path.node);
          if (fullPath) {
            accessedPaths.add(fullPath);
          }
        },

        Identifier(path) {
          const name = path.node.name;
          if (
            [
              'window',
              'document',
              'navigator',
              'location',
              'screen',
              'console',
              'localStorage',
              'sessionStorage',
            ].includes(name)
          ) {
            if (path.scope.hasBinding(name)) {
              return;
            }
            accessedPaths.add(name);
          }
        },
      });

      for (const path of accessedPaths) {
        if (path.startsWith('window.')) {
          detected.window.push(path);
        } else if (path.startsWith('document.')) {
          detected.document.push(path);
        } else if (path.startsWith('navigator.')) {
          detected.navigator.push(path);
        } else if (path.startsWith('location.')) {
          detected.location.push(path);
        } else if (path.startsWith('screen.')) {
          detected.screen.push(path);
        } else {
          detected.other.push(path);
        }
      }

      for (const key of Object.keys(detected) as Array<keyof DetectedEnvironmentVariables>) {
        detected[key] = Array.from(new Set(detected[key])).sort();
      }
    } catch (error) {
      logger.warn('AST analysis failed', error);
      this.detectWithRegex(code, detected);
    }

    return detected;
  }

  private getMemberExpressionPath(node: any): string | null {
    const parts: string[] = [];

    let current = node;
    while (current) {
      if (current.type === 'MemberExpression') {
        if (current.property.type === 'Identifier') {
          parts.unshift(current.property.name);
        } else if (current.property.type === 'StringLiteral') {
          parts.unshift(current.property.value);
        }
        current = current.object;
      } else if (current.type === 'Identifier') {
        parts.unshift(current.name);
        break;
      } else {
        break;
      }
    }

    if (
      parts.length > 0 &&
      parts[0] &&
      ['window', 'document', 'navigator', 'location', 'screen'].includes(parts[0])
    ) {
      return parts.join('.');
    }

    return null;
  }

  private detectWithRegex(code: string, detected: DetectedEnvironmentVariables): void {
    const patterns = [
      { regex: /window\.[a-zA-Z_$][a-zA-Z0-9_$]*/g, category: 'window' as const },
      { regex: /document\.[a-zA-Z_$][a-zA-Z0-9_$]*/g, category: 'document' as const },
      { regex: /navigator\.[a-zA-Z_$][a-zA-Z0-9_$]*/g, category: 'navigator' as const },
      { regex: /location\.[a-zA-Z_$][a-zA-Z0-9_$]*/g, category: 'location' as const },
      { regex: /screen\.[a-zA-Z_$][a-zA-Z0-9_$]*/g, category: 'screen' as const },
    ];

    for (const { regex, category } of patterns) {
      const matches = code.match(regex) || [];
      detected[category].push(...matches);
    }

    for (const key of Object.keys(detected) as Array<keyof DetectedEnvironmentVariables>) {
      detected[key] = Array.from(new Set(detected[key])).sort();
    }
  }

  private buildManifestFromTemplate(
    detected: DetectedEnvironmentVariables,
    _browserType: string
  ): Record<string, any> {
    const manifest: Record<string, any> = {};
    const template = chromeEnvironmentTemplate;

    const allPaths = [
      ...detected.window,
      ...detected.document,
      ...detected.navigator,
      ...detected.location,
      ...detected.screen,
      ...detected.other,
    ];

    for (const path of allPaths) {
      const value = this.getValueFromTemplate(path, template);
      if (value !== undefined) {
        manifest[path] = value;
      }
    }

    return manifest;
  }

  private getValueFromTemplate(path: string, template: any): any {
    const parts = path.split('.');
    let current = template;

    for (const part of parts) {
      if (part === 'window') {
        current = template.window;
      } else if (part === 'document') {
        current = template.document;
      } else if (part === 'navigator') {
        current = template.navigator;
      } else if (part === 'location') {
        current = template.location;
      } else if (part === 'screen') {
        current = template.screen;
      } else if (current && typeof current === 'object' && part in current) {
        current = current[part];
      } else {
        return undefined;
      }
    }

    return current;
  }

  private async fetchRealEnvironment(
    url: string,
    detected: DetectedEnvironmentVariables,
    depth: number
  ): Promise<Record<string, any>> {
    const manifest: Record<string, any> = {};

    try {
      if (!this.browser) {
        const executablePath = this.resolveExecutablePath();
        const launchOptions: Parameters<typeof puppeteer.launch>[0] = {
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-extensions',
            '--disable-component-extensions-with-background-pages',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
          ],
        };
        if (executablePath) {
          launchOptions.executablePath = executablePath;
        }
        this.browser = await puppeteer.launch(launchOptions);
      }

      const page = await this.browser.newPage();

      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined,
          configurable: true,
        });

        (window as any).chrome = {
          runtime: {
            connect: () => {},
            sendMessage: () => {},
            onMessage: {
              addListener: () => {},
              removeListener: () => {},
            },
          },
          loadTimes: function () {
            return {
              commitLoadTime: Date.now() / 1000 - Math.random() * 10,
              connectionInfo: 'http/1.1',
              finishDocumentLoadTime: Date.now() / 1000 - Math.random() * 5,
              finishLoadTime: Date.now() / 1000 - Math.random() * 3,
              firstPaintAfterLoadTime: 0,
              firstPaintTime: Date.now() / 1000 - Math.random() * 8,
              navigationType: 'Other',
              npnNegotiatedProtocol: 'http/1.1',
              requestTime: Date.now() / 1000 - Math.random() * 15,
              startLoadTime: Date.now() / 1000 - Math.random() * 12,
              wasAlternateProtocolAvailable: false,
              wasFetchedViaSpdy: false,
              wasNpnNegotiated: true,
            };
          },
          csi: function () {
            return {
              onloadT: Date.now(),
              pageT: Math.random() * 1000,
              startE: Date.now() - Math.random() * 5000,
              tran: 15,
            };
          },
          app: {
            isInstalled: false,
            InstallState: {
              DISABLED: 'disabled',
              INSTALLED: 'installed',
              NOT_INSTALLED: 'not_installed',
            },
            RunningState: {
              CANNOT_RUN: 'cannot_run',
              READY_TO_RUN: 'ready_to_run',
              RUNNING: 'running',
            },
          },
        };

        Object.defineProperty(navigator, 'plugins', {
          get: () => {
            const pluginArray = [
              {
                0: {
                  type: 'application/x-google-chrome-pdf',
                  suffixes: 'pdf',
                  description: 'Portable Document Format',
                  enabledPlugin: null,
                },
                description: 'Portable Document Format',
                filename: 'internal-pdf-viewer',
                length: 1,
                name: 'Chrome PDF Plugin',
              },
              {
                0: {
                  type: 'application/pdf',
                  suffixes: 'pdf',
                  description: '',
                  enabledPlugin: null,
                },
                description: '',
                filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai',
                length: 1,
                name: 'Chrome PDF Viewer',
              },
              {
                0: {
                  type: 'application/x-nacl',
                  suffixes: '',
                  description: 'Native Client Executable',
                  enabledPlugin: null,
                },
                1: {
                  type: 'application/x-pnacl',
                  suffixes: '',
                  description: 'Portable Native Client Executable',
                  enabledPlugin: null,
                },
                description: '',
                filename: 'internal-nacl-plugin',
                length: 2,
                name: 'Native Client',
              },
            ];
            return pluginArray;
          },
          configurable: true,
        });

        Object.defineProperty(navigator, 'languages', {
          get: () => ['zh-CN', 'zh', 'en-US', 'en'],
          configurable: true,
        });

        const originalQuery = (window.navigator.permissions as any).query;
        (window.navigator.permissions as any).query = (parameters: any) =>
          parameters.name === 'notifications'
            ? Promise.resolve({ state: Notification.permission } as any)
            : originalQuery(parameters);

        (window as any).requestAnimationFrame =
          (window as any).requestAnimationFrame ||
          function (callback: FrameRequestCallback) {
            return setTimeout(callback, 16);
          };

        (window as any).cancelAnimationFrame =
          (window as any).cancelAnimationFrame ||
          function (id: number) {
            clearTimeout(id);
          };

        (window as any)._sdkGlueVersionMap = (window as any)._sdkGlueVersionMap || {};
      });

      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

      const allPaths = [
        ...detected.window,
        ...detected.document,
        ...detected.navigator,
        ...detected.location,
        ...detected.screen,
        ...detected.other,
      ];

      const extractedValues = await page.evaluate(
        (paths: string[], maxDepth: number) => {
          const result: Record<string, any> = {};
          const seen = new WeakSet();

          function extractValue(path: string): any {
            try {
              const parts = path.split('.');
              let current: any = window;

              for (const part of parts) {
                if (current && typeof current === 'object' && part in current) {
                  current = current[part];
                } else {
                  return undefined;
                }
              }

              return serializeValue(current, maxDepth, seen);
            } catch (error) {
              return `[Error: ${(error as Error).message}]`;
            }
          }

          function serializeValue(value: any, depth: number, seenObjects: WeakSet<any>): any {
            if (depth <= 0) return '[Max Depth]';

            if (value === null) return null;
            if (value === undefined) return undefined;

            const type = typeof value;

            if (type === 'string' || type === 'number' || type === 'boolean') {
              return value;
            }

            if (type === 'function') {
              try {
                return {
                  __type: 'Function',
                  name: value.name || 'anonymous',
                  toString: value.toString().substring(0, 200),
                };
              } catch {
                return '[Function]';
              }
            }

            if (type === 'object' && seenObjects.has(value)) {
              return '[Circular Reference]';
            }

            if (Array.isArray(value)) {
              seenObjects.add(value);
              const arr = value
                .slice(0, 20)
                .map((item) => serializeValue(item, depth - 1, seenObjects));
              if (value.length > 20) {
                arr.push(`[... ${value.length - 20} more items]`);
              }
              return arr;
            }

            if (type === 'object') {
              seenObjects.add(value);
              const serialized: Record<string, any> = {};

              const allKeys = Object.getOwnPropertyNames(value);
              const limitedKeys = allKeys.slice(0, 100);

              for (const key of limitedKeys) {
                try {
                  const descriptor = Object.getOwnPropertyDescriptor(value, key);

                  if (descriptor) {
                    if (descriptor.get) {
                      try {
                        serialized[key] = serializeValue(value[key], depth - 1, seenObjects);
                      } catch {
                        serialized[key] = '[Getter Error]';
                      }
                    } else if (descriptor.value !== undefined) {
                      serialized[key] = serializeValue(descriptor.value, depth - 1, seenObjects);
                    }
                  }
                } catch (e) {
                  serialized[key] = `[Error: ${(e as Error).message}]`;
                }
              }

              if (allKeys.length > 100) {
                serialized['__more'] = `[... ${allKeys.length - 100} more properties]`;
              }

              return serialized;
            }

            try {
              return String(value);
            } catch {
              return '[Unserializable]';
            }
          }

          for (const path of paths) {
            result[path] = extractValue(path);
          }

          const commonAntiCrawlVars = [
            'navigator.userAgent',
            'navigator.platform',
            'navigator.vendor',
            'navigator.hardwareConcurrency',
            'navigator.deviceMemory',
            'navigator.maxTouchPoints',
            'navigator.language',
            'navigator.languages',
            'navigator.onLine',
            'navigator.cookieEnabled',
            'navigator.doNotTrack',
            'screen.width',
            'screen.height',
            'screen.availWidth',
            'screen.availHeight',
            'screen.colorDepth',
            'screen.pixelDepth',
            'screen.orientation.type',
            'window.innerWidth',
            'window.innerHeight',
            'window.outerWidth',
            'window.outerHeight',
            'window.devicePixelRatio',
            'window.screenX',
            'window.screenY',
            'document.referrer',
            'document.cookie',
            'document.title',
            'document.URL',
            'document.documentURI',
            'document.domain',
            'location.href',
            'location.protocol',
            'location.host',
            'location.hostname',
            'location.port',
            'location.pathname',
            'location.search',
            'location.hash',
            'location.origin',
          ];

          for (const varPath of commonAntiCrawlVars) {
            if (!result[varPath]) {
              result[varPath] = extractValue(varPath);
            }
          }

          return result;
        },
        allPaths,
        depth
      );

      Object.assign(manifest, extractedValues);

      await page.close();
      logger.info(`  ${Object.keys(manifest).length} `);
    } catch (error) {
      logger.warn('Variable extraction failed', error);
      return this.buildManifestFromTemplate(detected, 'chrome');
    }

    return manifest;
  }

  private resolveExecutablePath(): string | undefined {
    const configuredPath =
      process.env.PUPPETEER_EXECUTABLE_PATH?.trim() ||
      process.env.CHROME_PATH?.trim() ||
      process.env.BROWSER_EXECUTABLE_PATH?.trim();

    if (configuredPath) {
      if (existsSync(configuredPath)) {
        return configuredPath;
      }
      throw new Error(
        `Configured browser executable was not found: ${configuredPath}. ` +
          'Set a valid executablePath or configure CHROME_PATH / PUPPETEER_EXECUTABLE_PATH / BROWSER_EXECUTABLE_PATH.'
      );
    }

    const detectedPath = findBrowserExecutable();
    if (detectedPath) {
      return detectedPath;
    }

    logger.info(
      'No explicit browser executable configured. Falling back to Puppeteer-managed browser resolution.'
    );
    return undefined;
  }

  private identifyMissingAPIs(
    detected: DetectedEnvironmentVariables,
    manifest: Record<string, any>
  ): MissingAPI[] {
    const missing: MissingAPI[] = [];

    const allPaths = [
      ...detected.window,
      ...detected.document,
      ...detected.navigator,
      ...detected.location,
      ...detected.screen,
      ...detected.other,
    ];

    for (const path of allPaths) {
      if (!(path in manifest) || manifest[path] === undefined) {
        let type: 'function' | 'object' | 'property' = 'property';
        if (path.includes('()')) {
          type = 'function';
        } else if (path.endsWith('Element') || path.endsWith('List')) {
          type = 'object';
        }

        missing.push({
          name: path.split('.').pop() || path,
          type,
          path,
          suggestion: this.getSuggestionForMissingAPI(path, type),
        });
      }
    }

    return missing;
  }

  private getSuggestionForMissingAPI(path: string, type: string): string {
    if (type === 'function') {
      return `: ${path} = function() {}`;
    } else if (type === 'object') {
      return `: ${path} = {}`;
    } else {
      return `null: ${path} = null`;
    }
  }

  private async generateMissingAPIImplementationsWithAI(
    missingAPIs: MissingAPI[],
    code: string,
    manifest: Record<string, any>
  ): Promise<void> {
    if (!this.llm || missingAPIs.length === 0) {
      return;
    }

    try {
      const apisToGenerate = missingAPIs.slice(0, 10);

      const response = await this.llm.chat(
        generateMissingAPIImplementationsMessages(apisToGenerate, code)
      );

      const jsonMatch =
        response.content.match(/```json\s*([\s\S]*?)\s*```/) ||
        response.content.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const jsonStr = jsonMatch[1] || jsonMatch[0];
        const implementations = JSON.parse(jsonStr);

        let addedCount = 0;
        for (const [path, impl] of Object.entries(implementations)) {
          if (typeof impl === 'string' && impl.trim()) {
            manifest[path] = impl;
            addedCount++;
          }
        }

        logger.info(` AI ${addedCount} API`);
      }
    } catch (error) {
      logger.error('AIAPI', error);
    }
  }

  private async inferMissingVariablesWithAI(
    code: string,
    detected: DetectedEnvironmentVariables,
    existingManifest: Record<string, any>,
    browserType: string
  ): Promise<Record<string, any>> {
    if (!this.llm) {
      return {};
    }

    try {
      const allDetectedPaths = [
        ...detected.window,
        ...detected.document,
        ...detected.navigator,
        ...detected.location,
        ...detected.screen,
        ...detected.other,
      ];

      const missingPaths = allDetectedPaths.filter((path) => !(path in existingManifest));

      if (missingPaths.length === 0) {
        logger.info('Environment analysis complete, AI suggestions applied');
        return {};
      }

      logger.info(` AI ${missingPaths.length} ...`);

      const response = await this.llm.chat(
        generateMissingVariablesMessages(browserType, missingPaths, code, existingManifest)
      );

      const jsonMatch =
        response.content.match(/```json\s*([\s\S]*?)\s*```/) ||
        response.content.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const jsonStr = jsonMatch[1] || jsonMatch[0];
        const inferredVars = JSON.parse(jsonStr);
        logger.info(` AI ${Object.keys(inferredVars).length} `);
        return inferredVars;
      }

      logger.warn('AIJSON');
      return {};
    } catch (error) {
      logger.error('AI', error);
      return {};
    }
  }

  async cleanup(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = undefined;
    }
  }
}
