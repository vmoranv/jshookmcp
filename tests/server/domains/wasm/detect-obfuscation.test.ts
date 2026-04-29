import { describe, expect, it, vi } from 'vitest';

import type { WasmSharedState } from '@server/domains/wasm/handlers/shared';
import { ExternalToolHandlers } from '@server/domains/wasm/handlers/external-tool-handlers';
import { parseJson } from '@tests/server/domains/shared/mock-factories';

const MOCK_RUN_RESULT = {
  ok: true as const,
  stdout: '',
  stderr: '',
  exitCode: 0,
  durationMs: 10,
  signal: null,
  truncated: false,
};

function createMockState(wat: string): WasmSharedState {
  return {
    collector: {} as any,
    runner: {
      run: vi.fn(async () => ({ ...MOCK_RUN_RESULT, stdout: wat })),
      probeAll: vi.fn(),
    },
  } as unknown as WasmSharedState;
}

function repeatDeadCodeBranch(nextInstruction: string): string {
  return Array.from(
    { length: 11 },
    () => `    (block $0\n      br $0\n      ${nextInstruction}\n    )`,
  ).join('\n');
}

function repeatDeadCodeBranchNumeric(nextInstruction: string): string {
  return Array.from(
    { length: 11 },
    () => `    (block\n      br 0\n      ${nextInstruction}\n    )`,
  ).join('\n');
}

describe('ExternalToolHandlers — obfuscation detection', () => {
  it('detects dead code after an unconditional branch even when the next instruction starts with "d"', async () => {
    const handlers = new ExternalToolHandlers(
      createMockState(`(module\n  (func\n${repeatDeadCodeBranch('drop')}\n  )\n)`),
    );

    const result = parseJson<any>(
      await handlers.handleWasmDetectObfuscation({
        inputPath: 'sample.wasm',
      }),
    );

    expect(result.success).toBe(true);
    expect(result.detections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'dead-code-injection',
          description: expect.stringContaining('11 code blocks after unconditional branches'),
        }),
      ]),
    );
  });

  it('detects dead code with numeric labels (br 0) from standard wasm2wat output', async () => {
    const handlers = new ExternalToolHandlers(
      createMockState(`(module\n  (func\n${repeatDeadCodeBranchNumeric('drop')}\n  )\n)`),
    );

    const result = parseJson<any>(
      await handlers.handleWasmDetectObfuscation({
        inputPath: 'sample.wasm',
      }),
    );

    expect(result.success).toBe(true);
    expect(result.detections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'dead-code-injection',
          description: expect.stringContaining('11 code blocks after unconditional branches'),
        }),
      ]),
    );
  });

  it('does not treat a branch immediately followed by end as dead-code injection', async () => {
    const handlers = new ExternalToolHandlers(
      createMockState(`(module\n  (func\n${repeatDeadCodeBranch('end')}\n  )\n)`),
    );

    const result = parseJson<any>(
      await handlers.handleWasmDetectObfuscation({
        inputPath: 'sample.wasm',
      }),
    );

    expect(result.success).toBe(true);
    expect(result.detections).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'dead-code-injection' })]),
    );
  });
});
