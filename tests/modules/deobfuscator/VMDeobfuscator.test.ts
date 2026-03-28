import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock('@src/utils/logger', () => ({
  logger: loggerState,
}));

import { VMDeobfuscator } from '@modules/deobfuscator/VMDeobfuscator';

describe('VMDeobfuscator', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.values(loggerState).forEach((fn) => (fn as any).mockReset?.());
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

  it('deobfuscates using local VM simplification and ignores legacy dependencies', async () => {
    const legacy = { chat: vi.fn() } as any;
    const deobfuscator = new VMDeobfuscator(legacy);

    const result = await deobfuscator.deobfuscateVM(
      `
        var vmIns = [
          1,2,3,4,5,6,7,8,9,10,
          11,12,13,14,15,16,17,18,19,20,
          21,22,23,24,25,26,27,28,29,30,
          31,32,33,34,35,36,37,38,39,40,
          41,42,43,44,45,46,47,48,49,50,
          51
        ];
        function runVm(pc){
          switch(pc){
            case 1: break;
            case 2: break;
            case 3: break;
            case 4: break;
            case 5: break;
            case 6: break;
            case 7: break;
            case 8: break;
            case 9: break;
            case 10: break;
            case 11: break;
          }
          return vmIns[pc];
        }
        runVm(0);
      `,
      { type: 'custom-vm', instructionCount: 1 },
    );

    expect(result.success).toBe(true);
    expect(result.code).toContain('vm interpreter removed');
    expect(result.code).toContain('vm instruction array removed');
    expect(legacy.chat).not.toHaveBeenCalled();
  });

  it('returns the simplifyVMCode result when local simplification is stubbed', async () => {
    const deobfuscator = new VMDeobfuscator();
    vi.spyOn(deobfuscator, 'simplifyVMCode').mockReturnValue('simplified-code');

    const result = await deobfuscator.deobfuscateVM('function interp(){switch(x){case 1:break;}}', {
      type: 'custom-vm',
      instructionCount: 1,
    });

    expect(result).toEqual({ success: true, code: 'simplified-code' });
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
