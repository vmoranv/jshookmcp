/**
 * Ghidra static analysis handlers.
 */

import { readFile } from 'node:fs/promises';
import { GhidraAnalyzer } from '@modules/binary-instrument';
import type { BinaryInstrumentState } from './shared';
import { readRequiredString, readOptionalNumber } from './shared';

export class GhidraHandlers {
  private state: BinaryInstrumentState;

  constructor(state: BinaryInstrumentState) {
    this.state = state;
  }

  async handleGhidraAnalyze(args: Record<string, unknown>): Promise<unknown> {
    const binaryPath = readRequiredString(args, 'binaryPath');
    const timeout = readOptionalNumber(args, 'timeout');
    const ghidra = this.getGhidraAnalyzer();
    const availability = await ghidra.getAvailability();

    // Check availability BEFORE calling analyze() — avoids PrerequisiteError
    // escaping to the MCP transport layer where it becomes an opaque "no output".
    if (!availability.available) {
      const binaryBuffer = await readFile(binaryPath).catch(() => Buffer.alloc(0));
      const strings = this.extractPrintableStringsStatic(binaryBuffer);
      return {
        available: false,
        capability: 'ghidra_headless',
        fix: 'Install Ghidra and ensure analyzeHeadless is on PATH.',
        binaryPath,
        reason: availability.reason ?? 'Ghidra analyzeHeadless is not available',
        functions: [] as string[],
        imports: [] as string[],
        exports: [] as string[],
        strings,
      };
    }

    const analysis = await ghidra.analyze(
      binaryPath,
      timeout !== undefined ? { timeout } : undefined,
    );
    return { available: true, binaryPath, analysis };
  }

  async handleGhidraDecompile(args: Record<string, unknown>): Promise<unknown> {
    const binaryPath = readRequiredString(args, 'binaryPath');
    const functionName = readRequiredString(args, 'functionName');
    const timeout = readOptionalNumber(args, 'timeout');
    const ghidra = this.getGhidraAnalyzer();
    const availability = await ghidra.getAvailability();

    // Stateless headless path (kimi-cu report P2-6): the previous
    // plugin_ghidra_bridge delegation expected an HTTP bridge server that
    // nothing in the ecosystem ships — this runs analyzeHeadless directly.
    if (!availability.available) {
      return {
        available: false,
        capability: 'ghidra_headless',
        fix: 'Install Ghidra and ensure analyzeHeadless is on PATH.',
        binaryPath,
        functionName,
        reason: availability.reason ?? 'Ghidra analyzeHeadless is not available',
      };
    }

    const result = await ghidra.decompileFunction(
      binaryPath,
      functionName,
      timeout !== undefined ? { timeout } : undefined,
    );

    if (!result.found) {
      return {
        available: true,
        found: false,
        binaryPath,
        functionName,
        reason:
          `No function named "${functionName}" in ${binaryPath} (or decompilation produced no output). ` +
          'Run ghidra_analyze first and pick the name from its function list.',
        ...(result.rawOutput ? { ghidraOutputTail: result.rawOutput } : {}),
      };
    }

    return {
      available: true,
      found: true,
      binaryPath,
      functionName,
      count: result.functions.length,
      functions: result.functions,
    };
  }

  private getGhidraAnalyzer(): GhidraAnalyzer {
    if (!this.state.ghidra) this.state.ghidra = new GhidraAnalyzer();
    return this.state.ghidra;
  }

  /**
   * Lightweight printable-string extraction used when Ghidra is unavailable.
   * Duplicated from GhidraAnalyzer to avoid coupling the handler to the analyzer
   * when we explicitly skip creating one.
   */
  private extractPrintableStringsStatic(buffer: Buffer): string[] {
    const results: string[] = [];
    let current = '';
    for (const byte of buffer.values()) {
      if (byte >= 0x20 && byte <= 0x7e) {
        current += String.fromCharCode(byte);
        continue;
      }
      if (current.length >= 4) results.push(current);
      current = '';
    }
    if (current.length >= 4) results.push(current);
    return Array.from(new Set(results)).slice(0, 500);
  }
}
