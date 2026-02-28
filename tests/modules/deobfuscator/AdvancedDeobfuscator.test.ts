import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));

const promptState = vi.hoisted(() => ({
  generateCodeCleanupMessages: vi.fn(() => [{ role: 'user', content: 'cleanup' }]),
  generateControlFlowUnflatteningMessages: vi.fn(() => [{ role: 'user', content: 'flatten' }]),
}));

const vmState = vi.hoisted(() => ({
  instances: [] as any[],
}));

vi.mock('../../../src/utils/logger.js', () => ({
  logger: loggerState,
}));

vi.mock('../../../src/services/prompts/deobfuscation.js', () => ({
  generateCodeCleanupMessages: promptState.generateCodeCleanupMessages,
  generateControlFlowUnflatteningMessages: promptState.generateControlFlowUnflatteningMessages,
}));

vi.mock('../../../src/modules/deobfuscator/VMDeobfuscator.js', () => {
  class VMDeobfuscator {
    detectVMProtection = vi.fn(() => ({ detected: false, type: 'none', instructionCount: 0 }));
    deobfuscateVM = vi.fn(async (code: string) => ({ success: true, code: `${code}//vm` }));
    extractCodeFromLLMResponse = vi.fn((content: string) => content);
    isValidJavaScript = vi.fn(() => true);

    constructor() {
      vmState.instances.push(this);
    }
  }

  return { VMDeobfuscator };
});

import { AdvancedDeobfuscator } from '../../../src/modules/deobfuscator/AdvancedDeobfuscator.js';

describe('AdvancedDeobfuscator', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vmState.instances.length = 0;
    Object.values(loggerState).forEach((fn) => (fn as any).mockReset?.());
    Object.values(promptState).forEach((fn) => (fn as any).mockClear?.());
  });

  it('detects techniques and marks AST optimization when output changes', async () => {
    const deobfuscator = new AdvancedDeobfuscator();
    vi.spyOn(deobfuscator as any, 'detectStringEncoding').mockReturnValue(true);
    vi.spyOn(deobfuscator as any, 'decodeStrings').mockReturnValue('const a = "A";');
    vi.spyOn(deobfuscator as any, 'applyASTOptimizations').mockReturnValue('const a = "A";\n');
    vi.spyOn(deobfuscator as any, 'calculateConfidence').mockReturnValue(0.88);

    const result = await deobfuscator.deobfuscate({ code: 'String.fromCharCode(65)' });

    expect(result.detectedTechniques).toContain('string-encoding');
    expect(result.detectedTechniques).toContain('ast-optimized');
    expect(result.astOptimized).toBe(true);
    expect(result.confidence).toBe(0.88);
  });

  it('marks VM as deobfuscated when aggressive VM succeeds', async () => {
    const deobfuscator = new AdvancedDeobfuscator();
    const vm = vmState.instances[0]!;
    vm.detectVMProtection.mockReturnValue({ detected: true, type: 'custom-vm', instructionCount: 7 });
    vm.deobfuscateVM.mockResolvedValue({ success: true, code: 'decoded' });

    const result = await deobfuscator.deobfuscate({ code: 'while(true){switch(x){}}', aggressiveVM: true });

    expect(result.vmDetected).toEqual({ type: 'custom-vm', instructions: 7, deobfuscated: true });
    expect(result.code).toContain('decoded');
  });

  it('adds warning when aggressive VM deobfuscation fails', async () => {
    const deobfuscator = new AdvancedDeobfuscator();
    const vm = vmState.instances[0]!;
    vm.detectVMProtection.mockReturnValue({ detected: true, type: 'custom-vm', instructionCount: 3 });
    vm.deobfuscateVM.mockResolvedValue({ success: false, code: 'raw' });

    const result = await deobfuscator.deobfuscate({ code: 'vm', aggressiveVM: true });

    expect(result.vmDetected?.deobfuscated).toBe(false);
    expect(result.warnings.some((w) => w.includes('VM deobfuscation failed'))).toBe(true);
  });

  it('uses LLM cleanup when techniques are detected', async () => {
    const llm = { chat: vi.fn(async () => ({ content: 'cleaned-by-llm' })) } as any;
    const deobfuscator = new AdvancedDeobfuscator(llm);
    vi.spyOn(deobfuscator as any, 'detectStringEncoding').mockReturnValue(true);
    vi.spyOn(deobfuscator as any, 'decodeStrings').mockReturnValue('before-clean');
    vi.spyOn(deobfuscator as any, 'applyASTOptimizations').mockReturnValue('before-clean');
    vi.spyOn(deobfuscator as any, 'llmCleanup').mockResolvedValue('after-clean');

    const result = await deobfuscator.deobfuscate({ code: 'x' });

    expect((deobfuscator as any).llmCleanup).toHaveBeenCalled();
    expect(result.code).toBe('after-clean');
  });

  it('detects invisible unicode obfuscation marker', async () => {
    const deobfuscator = new AdvancedDeobfuscator();
    vi.spyOn(deobfuscator as any, 'applyASTOptimizations').mockReturnValue('x');

    const result = await deobfuscator.deobfuscate({ code: `a\u200Bb` });

    expect(result.detectedTechniques).toContain('invisible-unicode');
  });

  it('rethrows unexpected errors from deobfuscation pipeline', async () => {
    const deobfuscator = new AdvancedDeobfuscator();
    vi.spyOn(deobfuscator as any, 'normalizeCode').mockImplementation(() => {
      throw new Error('normalize failed');
    });

    await expect(deobfuscator.deobfuscate({ code: 'x' })).rejects.toThrow('normalize failed');
  });
});

