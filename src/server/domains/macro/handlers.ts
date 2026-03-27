/**
 * MacroToolHandlers — Handles macro domain MCP tool calls.
 *
 * Built-in macros are simple MacroDefinition data objects (step lists).
 * Complex workflow-based macros (DAG, BranchNode) should be registered
 * as extension workflows via the ExtensionManager.
 */

import { resolve } from 'node:path';
import { MacroRunner } from '@server/macros/MacroRunner';
import { MacroConfigLoader } from '@server/macros/MacroConfigLoader';
import { BUILTIN_MACROS } from '@server/macros/builtins';
import { getProjectRoot } from '@utils/outputPaths';
import type { MCPServerContext } from '@server/MCPServer.context';
import type { MacroDefinition } from '@server/macros/types';

export class MacroToolHandlers {
  private readonly runner: MacroRunner;
  private macros: Map<string, MacroDefinition> | null = null;

  constructor(ctx: MCPServerContext) {
    this.runner = new MacroRunner(ctx);
  }

  /**
   * Lazily load all macros (built-in + user-defined).
   * User-defined macros with the same ID override built-in ones.
   */
  private async ensureMacrosLoaded(): Promise<Map<string, MacroDefinition>> {
    if (this.macros) return this.macros;

    this.macros = new Map<string, MacroDefinition>();

    // Load built-in macros first
    for (const m of BUILTIN_MACROS) {
      this.macros.set(m.id, m);
    }

    // Load user-defined macros (override built-in by id)
    try {
      const userMacros = await MacroConfigLoader.loadFromDirectory(
        resolve(getProjectRoot(), 'macros'),
      );
      for (const m of userMacros) {
        this.macros.set(m.id, m);
      }
    } catch {
      // User macro dir issue — not critical, built-ins still available
    }

    return this.macros;
  }

  async handleRunMacro(args: Record<string, unknown>): Promise<unknown> {
    const macroId = args.macroId as string;
    const inputOverrides = args.inputOverrides as
      | Record<string, Record<string, unknown>>
      | undefined;

    if (!macroId || typeof macroId !== 'string') {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ ok: false, error: 'macroId parameter is required' }),
          },
        ],
      };
    }

    const macros = await this.ensureMacrosLoaded();
    const def = macros.get(macroId);

    if (!def) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              ok: false,
              error: `Macro "${macroId}" not found`,
              available: Array.from(macros.keys()),
            }),
          },
        ],
      };
    }

    const result = await this.runner.execute(def, inputOverrides);
    const report = this.runner.formatProgressReport(result);
    return {
      content: [{ type: 'text', text: report }],
    };
  }

  async handleListMacros(): Promise<unknown> {
    const macros = await this.ensureMacrosLoaded();

    const list = Array.from(macros.values()).map((m) => ({
      id: m.id,
      displayName: m.displayName,
      description: m.description,
      tags: m.tags,
      stepCount: m.steps.length,
    }));

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ macros: list, count: list.length }),
        },
      ],
    };
  }
}
