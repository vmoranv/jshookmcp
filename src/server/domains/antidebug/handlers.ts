import type { Page } from 'rebrowser-puppeteer-core';
import type { CodeCollector } from '../../../modules/collector/CodeCollector.js';
import { ANTI_DEBUG_SCRIPTS } from './scripts.js';

type DebuggerBypassMode = 'remove' | 'noop';

interface ProtectionFinding {
  type: string;
  severity: 'low' | 'medium' | 'high';
  evidence: string;
  recommendedBypass: string;
}

interface DetectProtectionsResult {
  success: boolean;
  detected: boolean;
  count: number;
  protections: ProtectionFinding[];
  recommendations: string[];
  evidence: Record<string, unknown>;
}

export class AntiDebugToolHandlers {
  private static readonly DEFAULT_DEBUGGER_MODE: DebuggerBypassMode = 'remove';
  private static readonly DEFAULT_MAX_DRIFT = 50;
  private static readonly DEFAULT_STACK_FILTER_PATTERNS = [
    'puppeteer',
    'devtools',
    '__puppeteer',
    'CDP',
  ] as const;

  constructor(private collector: CodeCollector) {}

  private toTextResponse(payload: Record<string, unknown>) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(payload, null, 2),
        },
      ],
    };
  }

  private parseBooleanArg(value: unknown, defaultValue: boolean): boolean {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      if (value === 1) return true;
      if (value === 0) return false;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
      if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    }
    return defaultValue;
  }

  private parseNumberArg(
    value: unknown,
    options: { defaultValue: number; min?: number; max?: number }
  ): number {
    let parsed: number | undefined;
    if (typeof value === 'number' && Number.isFinite(value)) {
      parsed = value;
    } else if (typeof value === 'string') {
      const next = Number(value.trim());
      if (Number.isFinite(next)) {
        parsed = next;
      }
    }

    if (parsed === undefined) {
      parsed = options.defaultValue;
    }

    if (typeof options.min === 'number') {
      parsed = Math.max(options.min, parsed);
    }
    if (typeof options.max === 'number') {
      parsed = Math.min(options.max, parsed);
    }

    return parsed;
  }

  private parseDebuggerMode(value: unknown): DebuggerBypassMode {
    if (value === 'remove' || value === 'noop') {
      return value;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'remove' || normalized === 'noop') {
        return normalized;
      }
    }
    return AntiDebugToolHandlers.DEFAULT_DEBUGGER_MODE;
  }

  private parseStringArrayArg(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value
        .map((item) => String(item).trim())
        .filter((item) => item.length > 0);
    }

    if (typeof value === 'string') {
      return value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
    }

    return [];
  }

  private mergeStackFilterPatterns(extraPatterns: string[]): string[] {
    const merged = [
      ...AntiDebugToolHandlers.DEFAULT_STACK_FILTER_PATTERNS,
      ...extraPatterns,
    ].map((item) => item.trim());

    return Array.from(new Set(merged.filter((item) => item.length > 0)));
  }

  private buildScript(template: string, replacements: Record<string, string>): string {
    let output = template;
    for (const [token, value] of Object.entries(replacements)) {
      output = output.split(token).join(value);
    }
    return output;
  }

  private buildDebuggerBypassScript(mode: DebuggerBypassMode): string {
    return this.buildScript(ANTI_DEBUG_SCRIPTS.bypassDebuggerStatement, {
      '__ANTI_DEBUG_MODE__': JSON.stringify(mode),
    });
  }

  private buildTimingBypassScript(maxDrift: number): string {
    return this.buildScript(ANTI_DEBUG_SCRIPTS.bypassTiming, {
      '__ANTI_DEBUG_MAX_DRIFT__': String(maxDrift),
    });
  }

  private buildStackTraceBypassScript(filterPatterns: string[]): string {
    return this.buildScript(ANTI_DEBUG_SCRIPTS.bypassStackTrace, {
      '__ANTI_DEBUG_FILTER_PATTERNS__': JSON.stringify(filterPatterns),
    });
  }

  private async injectScripts(page: Page, scripts: string[], persistent: boolean): Promise<void> {
    if (persistent) {
      for (const script of scripts) {
        await page.evaluateOnNewDocument(script);
      }
    }

    for (const script of scripts) {
      await page.evaluate(script);
    }
  }

  private async getPage(): Promise<Page> {
    return this.collector.getActivePage();
  }

  async handleAntiDebugBypassAll(args: Record<string, unknown>) {
    try {
      const persistent = this.parseBooleanArg(args.persistent, true);
      const page = await this.getPage();

      const scripts = [
        this.buildDebuggerBypassScript(AntiDebugToolHandlers.DEFAULT_DEBUGGER_MODE),
        this.buildTimingBypassScript(AntiDebugToolHandlers.DEFAULT_MAX_DRIFT),
        this.buildStackTraceBypassScript(
          this.mergeStackFilterPatterns([])
        ),
        ANTI_DEBUG_SCRIPTS.bypassConsoleDetect,
      ];

      await this.injectScripts(page, scripts, persistent);

      return this.toTextResponse({
        success: true,
        tool: 'antidebug_bypass_all',
        persistent,
        injectedCount: scripts.length,
        injected: [
          'bypassDebuggerStatement',
          'bypassTiming',
          'bypassStackTrace',
          'bypassConsoleDetect',
        ],
      });
    } catch (error) {
      return this.toTextResponse({
        success: false,
        tool: 'antidebug_bypass_all',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async handleAntiDebugBypassDebuggerStatement(args: Record<string, unknown>) {
    try {
      const mode = this.parseDebuggerMode(args.mode);
      const page = await this.getPage();
      const script = this.buildDebuggerBypassScript(mode);

      await this.injectScripts(page, [script], true);

      return this.toTextResponse({
        success: true,
        tool: 'antidebug_bypass_debugger_statement',
        mode,
        persistent: true,
      });
    } catch (error) {
      return this.toTextResponse({
        success: false,
        tool: 'antidebug_bypass_debugger_statement',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async handleAntiDebugBypassTiming(args: Record<string, unknown>) {
    try {
      const maxDrift = this.parseNumberArg(args.maxDrift, {
        defaultValue: AntiDebugToolHandlers.DEFAULT_MAX_DRIFT,
        min: 0,
        max: 1000,
      });

      const page = await this.getPage();
      const script = this.buildTimingBypassScript(maxDrift);

      await this.injectScripts(page, [script], true);

      return this.toTextResponse({
        success: true,
        tool: 'antidebug_bypass_timing',
        maxDrift,
        persistent: true,
      });
    } catch (error) {
      return this.toTextResponse({
        success: false,
        tool: 'antidebug_bypass_timing',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async handleAntiDebugBypassStackTrace(args: Record<string, unknown>) {
    try {
      const userPatterns = this.parseStringArrayArg(args.filterPatterns);
      const mergedPatterns = this.mergeStackFilterPatterns(userPatterns);

      const page = await this.getPage();
      const script = this.buildStackTraceBypassScript(mergedPatterns);

      await this.injectScripts(page, [script], true);

      return this.toTextResponse({
        success: true,
        tool: 'antidebug_bypass_stack_trace',
        filterPatterns: mergedPatterns,
        persistent: true,
      });
    } catch (error) {
      return this.toTextResponse({
        success: false,
        tool: 'antidebug_bypass_stack_trace',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async handleAntiDebugBypassConsoleDetect(_args: Record<string, unknown>) {
    try {
      const page = await this.getPage();
      await this.injectScripts(page, [ANTI_DEBUG_SCRIPTS.bypassConsoleDetect], true);

      return this.toTextResponse({
        success: true,
        tool: 'antidebug_bypass_console_detect',
        persistent: true,
      });
    } catch (error) {
      return this.toTextResponse({
        success: false,
        tool: 'antidebug_bypass_console_detect',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async handleAntiDebugDetectProtections(_args: Record<string, unknown>) {
    try {
      const page = await this.getPage();
      const result = (await page.evaluate(
        ANTI_DEBUG_SCRIPTS.detectProtections
      )) as DetectProtectionsResult | null;

      return this.toTextResponse({
        success: result?.success ?? true,
        tool: 'antidebug_detect_protections',
        detected: result?.detected ?? false,
        count: result?.count ?? 0,
        protections: result?.protections ?? [],
        recommendations: result?.recommendations ?? [],
        evidence: result?.evidence ?? {},
      });
    } catch (error) {
      return this.toTextResponse({
        success: false,
        tool: 'antidebug_detect_protections',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
