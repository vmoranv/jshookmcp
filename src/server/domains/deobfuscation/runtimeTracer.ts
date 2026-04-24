import type { ToolArgs } from '@server/types';
import { logger } from '@utils/logger';
import puppeteer from 'rebrowser-puppeteer-core';
import { QuickJSContext, getQuickJS } from 'quickjs-emscripten';
import { z } from 'zod';
import { text, object, error } from '@server/response-helpers';

interface RuntimeEvent {
  type: 'functionCall' | 'variableMutation' | 'networkRequest' | 'domManipulation' | 'debuggerStatement' | 'antiDebugging';
  timestamp: string;
  data: Record<string, unknown>;
  context?: {
    file?: string;
    line?: number;
    column?: number;
  };
}

interface RuntimeReport {
  executionTimeline: RuntimeEvent[];
  suspiciousPatterns: {
    type: string;
    description: string;
    events: RuntimeEvent[];
  }[];
  screenshots?: string[];
  error?: string;
}

const SandboxModeSchema = z.enum(['browser', 'quickjs']);
const AntiDebuggingSchema = z.object({
  detectDebugger: z.boolean().default(true),
  detectTimingAttacks: z.boolean().default(true),
  detectEnvironmentChecks: z.boolean().default(true),
});

const RuntimeTracerInputSchema = z.object({
  code: z.string().describe('JavaScript code to trace'),
  sandboxMode: SandboxModeSchema.default('browser').describe('Execution environment'),
  antiDebugging: AntiDebuggingSchema.optional(),
  captureScreenshots: z.boolean().default(false).describe('Capture screenshots during execution'),
  timeout: z.number().default(30000).describe('Execution timeout in milliseconds'),
});

export class RuntimeTracer {
  private quickJS?: QuickJSContext;

  constructor() {
    this.initializeQuickJS();
  }

  private async initializeQuickJS() {
    try {
      const QuickJS = await getQuickJS();
      this.quickJS = QuickJS.newContext();
      logger.info('[RuntimeTracer] QuickJS initialized');
    } catch (err) {
      logger.error(`[RuntimeTracer] Failed to initialize QuickJS: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async trace(args: ToolArgs) {
    const parsed = RuntimeTracerInputSchema.safeParse(args.input);
    if (!parsed.success) {
      return error(`Invalid input: ${parsed.error.message}`);
    }

    const { code, sandboxMode, antiDebugging, captureScreenshots, timeout } = parsed.data;

    try {
      if (sandboxMode === 'browser') {
        return this.traceInBrowser(code, antiDebugging, captureScreenshots, timeout);
      } else {
        return this.traceInQuickJS(code, antiDebugging, timeout);
      }
    } catch (err) {
      logger.error(`[RuntimeTracer] Execution failed: ${err instanceof Error ? err.message : String(err)}`);
      return error(`Execution failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async traceInBrowser(
    code: string,
    antiDebugging?: z.infer<typeof AntiDebuggingSchema>,
    captureScreenshots: boolean = false,
    timeout: number = 30000
  ): Promise<ReturnType<typeof object>> {
    const browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.REBROWSER_EXECUTABLE_PATH,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    const executionTimeline: RuntimeEvent[] = [];
    const suspiciousPatterns: RuntimeReport['suspiciousPatterns'] = [];
    const screenshots: string[] = [];

    // Enable network monitoring
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      executionTimeline.push({
        type: 'networkRequest',
        timestamp: new Date().toISOString(),
        data: {
          url: request.url(),
          method: request.method(),
          headers: request.headers(),
        },
      });
      request.continue();
    });

    // Monitor console logs for variable mutations
    page.on('console', (msg) => {
      if (msg.text().includes('__MUTATION__:')) {
        const [variable, value] = msg.text().split('__MUTATION__:')[1].split('=');
        executionTimeline.push({
          type: 'variableMutation',
          timestamp: new Date().toISOString(),
          data: { variable: variable.trim(), value: value.trim() },
        });
      }
    });

    // Anti-debugging detection
    if (antiDebugging?.detectDebugger) {
      await page.evaluateOnNewDocument(() => {
        const originalDebugger = window.debugger;
        window.debugger = () => {
          window.__ANTI_DEBUG_DETECTED = true;
          originalDebugger?.();
        };
      });
    }

    if (antiDebugging?.detectTimingAttacks) {
      await page.evaluateOnNewDocument(() => {
        const originalDateNow = Date.now;
        Date.now = () => {
          if (window.__TIMING_ATTACK_DETECTED) return originalDateNow();
          const start = performance.now();
          const result = originalDateNow();
          const end = performance.now();
          if (end - start > 10) window.__TIMING_ATTACK_DETECTED = true;
          return result;
        };
      });
    }

    if (antiDebugging?.detectEnvironmentChecks) {
      await page.evaluateOnNewDocument(() => {
        const originalNavigator = window.navigator;
        Object.defineProperty(window, 'navigator', {
          value: new Proxy(originalNavigator, {
            get(target, prop) {
              if (prop === 'userAgent' || prop === 'platform') {
                window.__ENV_CHECK_DETECTED = true;
              }
              return target[prop as keyof Navigator];
            },
          }),
        });
      });
    }

    // Inject tracing code
    await page.evaluateOnNewDocument((tracingCode) => {
      // Override Function.prototype.call to trace function calls
      const originalCall = Function.prototype.call;
      Function.prototype.call = function (thisArg, ...args) {
        const result = originalCall.apply(this, [thisArg, ...args]);
        if (typeof this === 'function' && !this.name.startsWith('bound ')) {
          console.log(`__FUNCTION_CALL__:${this.name}`, args, '=>', result);
        }
        return result;
      };

      // Override DOM manipulation methods
      const originalAppendChild = Node.prototype.appendChild;
      Node.prototype.appendChild = function <T extends Node>(this: Node, node: T): T {
        console.log('__DOM_MANIPULATION__:appendChild', node);
        return originalAppendChild.apply(this, [node]);
      };

      const originalSetAttribute = Element.prototype.setAttribute;
      Element.prototype.setAttribute = function (this: Element, name: string, value: string): void {
        console.log('__DOM_MANIPULATION__:setAttribute', name, value);
        return originalSetAttribute.apply(this, [name, value]);
      };

      // Inject user code
      eval(tracingCode);
    }, code);

    // Listen for tracing events
    page.on('console', (msg) => {
      if (msg.text().includes('__FUNCTION_CALL__:')) {
        const [name, args, result] = msg.text().split('__FUNCTION_CALL__:')[1].split(' ');
        executionTimeline.push({
          type: 'functionCall',
          timestamp: new Date().toISOString(),
          data: { name, args, result },
        });
      } else if (msg.text().includes('__DOM_MANIPULATION__:')) {
        const [method, ...rest] = msg.text().split('__DOM_MANIPULATION__:')[1].split(' ');
        executionTimeline.push({
          type: 'domManipulation',
          timestamp: new Date().toISOString(),
          data: { method, args: rest },
        });
      }
    });

    // Capture screenshots if enabled
    if (captureScreenshots) {
      setInterval(async () => {
        const screenshot = await page.screenshot({ encoding: 'base64' });
        screenshots.push(`data:image/png;base64,${screenshot}`);
      }, 2000);
    }

    // Execute the code
    try {
      await page.evaluate(() => {}); // Trigger evaluation of injected code
      await page.waitForFunction(() => window.__EXECUTION_COMPLETE === true, { timeout });
    } catch (err) {
      logger.warn(`[RuntimeTracer] Execution timed out or failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Check for anti-debugging detections
    const antiDebugDetected = await page.evaluate(() => window.__ANTI_DEBUG_DETECTED);
    const timingAttackDetected = await page.evaluate(() => window.__TIMING_ATTACK_DETECTED);
    const envCheckDetected = await page.evaluate(() => window.__ENV_CHECK_DETECTED);

    if (antiDebugDetected) {
      suspiciousPatterns.push({
        type: 'antiDebugging',
        description: 'Debugger statement detected',
        events: executionTimeline.filter((e) => e.type === 'debuggerStatement'),
      });
    }

    if (timingAttackDetected) {
      suspiciousPatterns.push({
        type: 'antiDebugging',
        description: 'Timing attack detected',
        events: executionTimeline.filter((e) => e.type === 'antiDebugging'),
      });
    }

    if (envCheckDetected) {
      suspiciousPatterns.push({
        type: 'antiDebugging',
        description: 'Environment check detected',
        events: executionTimeline.filter((e) => e.type === 'antiDebugging'),
      });
    }

    await browser.close();

    const report: RuntimeReport = {
      executionTimeline,
      suspiciousPatterns,
      screenshots: captureScreenshots ? screenshots : undefined,
    };

    return object(report);
  }

  private async traceInQuickJS(
    code: string,
    antiDebugging?: z.infer<typeof AntiDebuggingSchema>,
    timeout: number = 30000
  ): Promise<ReturnType<typeof object>> {
    if (!this.quickJS) {
      return error('QuickJS not initialized');
    }

    const executionTimeline: RuntimeEvent[] = [];
    const suspiciousPatterns: RuntimeReport['suspiciousPatterns'] = [];

    // Override built-ins for tracing
    const wrappedCode = `
      (() => {
        const originalFunction = Function;
        Function = class extends originalFunction {
          constructor(...args) {
            super(...args);
            const originalCall = this.call;
            this.call = function(thisArg, ...args) {
              const result = originalCall.apply(this, [thisArg, ...args]);
              if (typeof this.name === 'string' && !this.name.startsWith('bound ')) {
                console.log(JSON.stringify({
                  type: 'functionCall',
                  name: this.name,
                  args,
                  result,
                  timestamp: new Date().toISOString(),
                }));
              }
              return result;
            };
            return this;
          }
        };

        ${antiDebugging?.detectDebugger ? `
          const originalDebugger = debugger;
          debugger = () => {
            console.log(JSON.stringify({
              type: 'debuggerStatement',
              timestamp: new Date().toISOString(),
              data: { detected: true },
            }));
            originalDebugger?.();
          };
        ` : ''}

        ${antiDebugging?.detectTimingAttacks ? `
          const originalDateNow = Date.now;
          Date.now = () => {
            const start = performance.now();
            const result = originalDateNow();
            const end = performance.now();
            if (end - start > 10) {
              console.log(JSON.stringify({
                type: 'antiDebugging',
                timestamp: new Date().toISOString(),
                data: { type: 'timingAttack', detected: true },
              }));
            }
            return result;
          };
        ` : ''}

        try {
          ${code}
        } catch (e) {
          console.log(JSON.stringify({
            type: 'error',
            timestamp: new Date().toISOString(),
            data: { message: e.message },
          }));
        }
      })()
    `;

    const vm = this.quickJS.newContext();
    const consoleHandle = vm.newObject();
    vm.setProp(vm.global, 'console', consoleHandle);

    vm.setProp(consoleHandle, 'log', vm.newFunction('log', (...args) => {
      const str = args.map((arg) => vm.dump(arg)).join(' ');
      try {
        const parsed = JSON.parse(str);
        if (parsed.type === 'functionCall') {
          executionTimeline.push({
            type: 'functionCall',
            timestamp: parsed.timestamp,
            data: { name: parsed.name, args: parsed.args, result: parsed.result },
          });
        } else if (parsed.type === 'debuggerStatement') {
          executionTimeline.push({
            type: 'debuggerStatement',
            timestamp: parsed.timestamp,
            data: parsed.data,
          });
          suspiciousPatterns.push({
            type: 'antiDebugging',
            description: 'Debugger statement detected',
            events: [executionTimeline[executionTimeline.length - 1]],
          });
        } else if (parsed.type === 'antiDebugging') {
          executionTimeline.push({
            type: 'antiDebugging',
            timestamp: parsed.timestamp,
            data: parsed.data,
          });
          suspiciousPatterns.push({
            type: 'antiDebugging',
            description: `Anti-debugging detected: ${parsed.data.type}`,
            events: [executionTimeline[executionTimeline.length - 1]],
          });
        } else if (parsed.type === 'error') {
          throw new Error(parsed.data.message);
        }
      } catch {
        logger.debug(`[RuntimeTracer] Console log: ${str}`);
      }
      return vm.undefined;
    }));

    try {
      const result = vm.evalCode(wrappedCode);
      if (result.error) {
        const error = vm.dump(result.error);
        vm.dispose();
        throw new Error(`QuickJS execution error: ${error}`);
      }
      vm.dispose();
    } catch (err) {
      logger.error(`[RuntimeTracer] QuickJS execution failed: ${err instanceof Error ? err.message : String(err)}`);
      return error(`Execution failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const report: RuntimeReport = {
      executionTimeline,
      suspiciousPatterns,
    };

    return object(report);
  }
}