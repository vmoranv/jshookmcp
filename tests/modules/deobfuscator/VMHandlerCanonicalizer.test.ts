import { describe, it, expect, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@utils/logger', () => ({ logger: loggerState }));

import {
  canonicalizeVMHandlers,
  compareGenomes,
  VMHandler,
  OpcodeGenome,
  CanonicalizeResult,
  HandlerCategory,
} from '@modules/deobfuscator/VMHandlerCanonicalizer';

describe('VMHandlerCanonicalizer', () => {
  it('canonicalizeVMHandlers returns result with handlers array', () => {
    const result = canonicalizeVMHandlers('const x = 1;');
    expect(result).toHaveProperty('ok');
    expect(result).toHaveProperty('genome');
    expect(result.genome).toHaveProperty('handlers');
    expect(Array.isArray(result.genome.handlers)).toBe(true);
  });

  it('canonicalizeVMHandlers detects switch-based VM dispatch', () => {
    const code = `
      while(true) {
        switch(pc++) {
          case 0: stack.push(a + b); break;
          case 1: stack.push(a - b); break;
          case 2: stack.push(a * b); break;
          case 3: stack.push(a / b); break;
          case 4: stack.push(a % b); break;
          case 5: pc = 0; break;
        }
      }`;
    const result = canonicalizeVMHandlers(code);
    expect(result.ok).toBe(true);
    expect(result.genome.handlerCount).toBeGreaterThan(0);
  });

  it('canonicalizeVMHandlers detects array-based VM dispatch', () => {
    const code = `
      var _0x1a2b=["push","add","sub"];
      while(true) {
        switch(_0x1a2b[pc++]) {
          case "push": stack.push(1); break;
          case "add": stack.push(a+b); break;
          case "sub": stack.push(a-b); break;
          case "mul": stack.push(a*b); break;
          case "div": stack.push(a/b); break;
          case "jmp": pc=0; break;
        }
      }`;
    const result = canonicalizeVMHandlers(code);
    expect(result.ok).toBe(true);
    expect(result.genome.stringTablePattern).not.toBeNull();
  });

  it('canonicalizeVMHandlers classifies handlers into categories', () => {
    const code = `
      while(true) {
        switch(pc++) {
          case 0: stack.push(1); break;
          case 1: stack.push(a+b); break;
          case 2: if(a===b) break; break;
          case 3: stack.push(a&&b); break;
          case 4: pc=0; break;
          case 5: var x=arr["key"]; break;
        }
      }`;
    const result = canonicalizeVMHandlers(code);
    const categories = result.genome.categoryHistogram;
    expect(categories).toHaveProperty('stack-op');
    expect(categories).toHaveProperty('arithmetic');
    expect(categories).toHaveProperty('comparison');
  });

  it('canonicalizeVMHandlers returns opcode genome', () => {
    const code = `while(true){switch(pc++){case 0:break;case 1:break;case 2:break;case 3:break;case 4:break;case 5:break;}}`;
    const result = canonicalizeVMHandlers(code);
    expect(result.genome).toHaveProperty('genomeHash');
    expect(result.genome).toHaveProperty('handlerCount');
    expect(result.genome).toHaveProperty('categoryHistogram');
    expect(result.genome).toHaveProperty('complexityScore');
  });

  it('canonicalizeVMHandlers with clean code returns empty handlers', () => {
    const result = canonicalizeVMHandlers('const x = 42;');
    expect(result.ok).toBe(false);
    expect(result.genome.handlers.length).toBe(0);
  });

  it('compareGenomes with identical genomes returns high similarity', () => {
    const genome: OpcodeGenome = {
      genomeHash: 'abc123',
      handlerCount: 5,
      categoryHistogram: { 'stack-op': 2, 'arithmetic': 2, 'comparison': 0, 'logic': 0, 'control-flow': 1, 'memory': 0, 'string-op': 0, 'type-coercion': 0, 'environment': 0, 'crypto': 0, 'unknown': 0 },
      handlers: [],
      stringTablePattern: null,
      dispatchVarName: null,
      hasRotatedOpcodes: false,
      hasIntegrityChecks: false,
      complexityScore: 2,
      toolIdentifier: 'javascript-obfuscator',
    };
    const comparison = compareGenomes(genome, genome);
    expect(comparison.similarity).toBeGreaterThan(0.7);
    expect(comparison.sameVM).toBe(true);
  });

  it('compareGenomes with different genomes returns lower similarity', () => {
    const genomeA: OpcodeGenome = {
      genomeHash: 'aaa',
      handlerCount: 5,
      categoryHistogram: { 'stack-op': 5, 'arithmetic': 0, 'comparison': 0, 'logic': 0, 'control-flow': 0, 'memory': 0, 'string-op': 0, 'type-coercion': 0, 'environment': 0, 'crypto': 0, 'unknown': 0 },
      handlers: [],
      stringTablePattern: null,
      dispatchVarName: null,
      hasRotatedOpcodes: false,
      hasIntegrityChecks: false,
      complexityScore: 1,
      toolIdentifier: 'tool-a',
    };
    const genomeB: OpcodeGenome = {
      genomeHash: 'bbb',
      handlerCount: 5,
      categoryHistogram: { 'stack-op': 0, 'arithmetic': 0, 'comparison': 0, 'logic': 0, 'control-flow': 5, 'memory': 0, 'string-op': 0, 'type-coercion': 0, 'environment': 0, 'crypto': 0, 'unknown': 0 },
      handlers: [],
      stringTablePattern: null,
      dispatchVarName: null,
      hasRotatedOpcodes: false,
      hasIntegrityChecks: false,
      complexityScore: 1,
      toolIdentifier: 'tool-b',
    };
    const comparison = compareGenomes(genomeA, genomeB);
    expect(comparison.similarity).toBeLessThan(0.7);
  });

  it('compareGenomes returns shared and unique opcodes', () => {
    const genomeA: OpcodeGenome = {
      genomeHash: 'a',
      handlerCount: 3,
      categoryHistogram: { 'stack-op': 2, 'arithmetic': 1, 'comparison': 0, 'logic': 0, 'control-flow': 0, 'memory': 0, 'string-op': 0, 'type-coercion': 0, 'environment': 0, 'crypto': 0, 'unknown': 0 },
      handlers: [],
      stringTablePattern: null,
      dispatchVarName: null,
      hasRotatedOpcodes: false,
      hasIntegrityChecks: false,
      complexityScore: 1,
      toolIdentifier: null,
    };
    const genomeB: OpcodeGenome = {
      genomeHash: 'b',
      handlerCount: 3,
      categoryHistogram: { 'stack-op': 1, 'arithmetic': 1, 'comparison': 1, 'logic': 0, 'control-flow': 0, 'memory': 0, 'string-op': 0, 'type-coercion': 0, 'environment': 0, 'crypto': 0, 'unknown': 0 },
      handlers: [],
      stringTablePattern: null,
      dispatchVarName: null,
      hasRotatedOpcodes: false,
      hasIntegrityChecks: false,
      complexityScore: 1,
      toolIdentifier: null,
    };
    const comparison = compareGenomes(genomeA, genomeB);
    expect(Array.isArray(comparison.sharedCategories)).toBe(true);
    expect(comparison.sharedCategories.length).toBeGreaterThan(0);
  });
});
