import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));

const promptState = vi.hoisted(() => ({
  generateVMDeobfuscationMessages: vi.fn((prompt: string) => [{ role: 'user', content: prompt }]),
}));

vi.mock('../../../src/utils/logger.js', () => ({
  logger: loggerState,
}));

vi.mock('../../../src/services/prompts/deobfuscation.js', () => ({
  generateVMDeobfuscationMessages: promptState.generateVMDeobfuscationMessages,
}));

import { VMDeobfuscator } from '../../../src/modules/deobfuscator/VMDeobfuscator.js';

describe('VMDeobfuscator', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.values(loggerState).forEach((fn) => (fn as any).mockReset?.());
    promptState.generateVMDeobfuscationMessages.mockClear();
  });

  it('detects VM protection based on structural signatures', () => {
    const code = `
      while (true) { switch(pc) { case 1: stack.push(1); break; case 2: stack.pop(); break; } }
      var arr = [1,2,3,4,5,6,7,8,9,10,11];
    `;
    const result = new VMDeobfuscator().detectVMProtection(code);

    expect(result.detected).toBe(true);
    expect(result.type).toMatch(/vm/);
  });

  it('counts instruction cases accurately', () => {
    const code = 'switch(x){case 1:break;case 2:break;case 3:break;}';
    expect(new VMDeobfuscator().countVMInstructions(code)).toBe(3);
  });

  it('uses LLM output when deobfuscated code is valid JavaScript', async () => {
    const llm = { chat: vi.fn(async () => ({ content: '```js\nconst restored = 1;\n```' })) } as any;
    const deobfuscator = new VMDeobfuscator(llm);

    const result = await deobfuscator.deobfuscateVM(
      'while(true){switch(pc){case 1:break;}}',
      { type: 'custom-vm', instructionCount: 1 }
    );

    expect(result.success).toBe(true);
    expect(result.code).toContain('const restored = 1;');
    expect(llm.chat).toHaveBeenCalledTimes(1);
  });

  it('falls back to simplified code when LLM output is invalid', async () => {
    const llm = { chat: vi.fn(async () => ({ content: '```js\nfunction {' })) } as any;
    const deobfuscator = new VMDeobfuscator(llm);
    vi.spyOn(deobfuscator, 'simplifyVMCode').mockReturnValue('simplified-code');

    const result = await deobfuscator.deobfuscateVM(
      'function interp(){switch(x){case 1:break;}}',
      { type: 'custom-vm', instructionCount: 1 }
    );

    expect(result).toEqual({ success: true, code: 'simplified-code' });
  });

  it('builds VM prompt with profile and component sections', () => {
    const prompt = new VMDeobfuscator().buildVMDeobfuscationPrompt(
      'const code = 1;',
      { type: 'custom-vm', instructionCount: 12 },
      { hasInterpreter: true, hasStack: true, hasRegisters: false, instructionTypes: ['01'] },
      { instructionArray: 'arr', interpreterFunction: 'run' }
    );

    expect(prompt).toContain('Architecture');
    expect(prompt).toContain('Instruction Count');
    expect(prompt).toContain('arr');
    expect(prompt).toContain('run');
  });

  it('strips markdown code fences from LLM response', () => {
    const output = new VMDeobfuscator().extractCodeFromLLMResponse(
      '```javascript\nconst x = 1;\n```'
    );
    expect(output).toBe('const x = 1;');
  });

  it('simplifies interpreter and instruction array declarations', () => {
    const code = `
      var data = [1,2,3];
      var vmIns = [1,2,3,4];
      function runVm(a){ return a; }
      runVm(vmIns);
    `;
    const out = new VMDeobfuscator().simplifyVMCode(code, {
      interpreterFunction: 'runVm',
      instructionArray: 'vmIns',
    });

    expect(out).toContain('vm interpreter removed');
    expect(out).toContain('vm instruction array removed');
  });
});
