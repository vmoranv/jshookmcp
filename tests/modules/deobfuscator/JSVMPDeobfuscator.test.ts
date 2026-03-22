import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as parser from '@babel/parser';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));

const promptState = vi.hoisted(() => ({
  generateVMAnalysisMessages: vi.fn(() => [{ role: 'user', content: 'vm' }]),
}));

const sandboxState = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  instances: [] as any[],
}));

vi.mock('@src/utils/logger', () => ({
  logger: loggerState,
}));

vi.mock('@src/services/prompts/deobfuscation', () => ({
  generateVMAnalysisMessages: promptState.generateVMAnalysisMessages,
}));

vi.mock('@src/modules/security/ExecutionSandbox', () => {
  class ExecutionSandbox {
    execute = vi.fn(async () => ({ ok: true, output: 'sandbox-output' }));
    constructor() {
      sandboxState.instances.push(this);
    }
  }
  return { ExecutionSandbox };
});

import { JSVMPDeobfuscator } from '@modules/deobfuscator/JSVMPDeobfuscator';

describe('JSVMPDeobfuscator', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sandboxState.instances.length = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    Object.values(loggerState).forEach((fn) => (fn as any).mockReset?.());
    promptState.generateVMAnalysisMessages.mockClear();
  });

  it('returns non-JSVMP result when VM patterns are not detected', async () => {
    const deobfuscator = new JSVMPDeobfuscator();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    vi.spyOn(deobfuscator as any, 'detectJSVMP').mockReturnValue(null);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const result = await deobfuscator.deobfuscate({ code: 'const x = 1;' } as any);

    expect(result.isJSVMP).toBe(false);
    expect(result.confidence).toBe(0);
    expect(result.warnings[0]).toContain('JSVMP');
  });

  it('returns full deobfuscation payload for detected VM code', async () => {
    const deobfuscator = new JSVMPDeobfuscator();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    vi.spyOn(deobfuscator as any, 'detectJSVMP').mockReturnValue({
      instructionCount: 15,
      interpreterLocation: 'Line 1',
      complexity: 'medium',
      hasSwitch: true,
      hasInstructionArray: true,
      hasProgramCounter: true,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    vi.spyOn(deobfuscator as any, 'identifyVMType').mockReturnValue('custom');
    vi.spyOn(deobfuscator as unknown, 'extractInstructions').mockReturnValue([
      { opcode: 1, name: 'INST_1', type: 'load', description: 'x' },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    vi.spyOn(deobfuscator as any, 'restoreCode').mockResolvedValue({
      code: 'decoded-code',
      confidence: 0.77,
      warnings: ['partial'],
      unresolvedParts: [{ location: 'x', reason: 'y', suggestion: 'z' }],
    });

    const result = await deobfuscator.deobfuscate({
      code: 'vm-code',
      extractInstructions: true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any);

    expect(result.isJSVMP).toBe(true);
    expect(result.vmType).toBe('custom');
    expect(result.instructions).toHaveLength(1);
    expect(result.deobfuscatedCode).toBe('decoded-code');
    expect(result.stats?.originalSize).toBe('vm-code'.length);
  });

  it('handles unexpected errors and returns safe failure payload', async () => {
    const deobfuscator = new JSVMPDeobfuscator();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    vi.spyOn(deobfuscator as any, 'detectJSVMP').mockImplementation(() => {
      throw new Error('boom');
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const result = await deobfuscator.deobfuscate({ code: 'x' } as any);

    expect(result.isJSVMP).toBe(false);
    expect(result.warnings[0]).toContain('boom');
  });

  it('detects VM hints using regex fallback', () => {
    const deobfuscator = new JSVMPDeobfuscator();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const result = (deobfuscator as any).detectJSVMPWithRegex(
      'while(true){switch(i){case 1:break;} a.apply(b,c); parseInt("" + arr[i],16);}'
    );

    expect(result).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(result.hasSwitch).toBe(true);
  });

  it('applies basic custom VM restoration cleanup heuristics', () => {
    const deobfuscator = new JSVMPDeobfuscator();
    const warnings: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const unresolved: any[] = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const output = (deobfuscator as any).restoreCustomVMBasic(
      'debugger; if(a){}; "" + value; cond ? same : same;',
      true,
      warnings,
      unresolved
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(output.code).not.toContain('debugger');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(output.warnings.length).toBeGreaterThan(0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(output.unresolvedParts?.length).toBeGreaterThan(0);
  });

  it('infers arithmetic opcode type from switch case content', () => {
    const deobfuscator = new JSVMPDeobfuscator();
    const ast = parser.parse('switch(x){case 1: a + b; break;}', { sourceType: 'script' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const switchNode = ast.program.body[0] as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const caseNode = switchNode.cases[0];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const type = (deobfuscator as any).inferInstructionType(caseNode);
    expect(type).toBe('arithmetic');
  });
});
