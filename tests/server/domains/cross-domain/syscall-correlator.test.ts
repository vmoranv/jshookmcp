import { describe, expect, it, beforeEach } from 'vitest';
import { correlateSyscallToJS } from '@server/domains/cross-domain/handlers/syscall-js-correlator';
import {
  CrossDomainEvidenceBridge,
  resetIdCounter,
} from '@server/domains/cross-domain/handlers/evidence-graph-bridge';
import {
  ReverseEvidenceGraph,
  resetIdCounter as _resetGraphIdCounter,
} from '@server/evidence/ReverseEvidenceGraph';

describe('SYSCALL-02: Syscall-to-JS Correlator', () => {
  let bridge: CrossDomainEvidenceBridge;

  beforeEach(() => {
    resetIdCounter();
    _resetGraphIdCounter();
    bridge = new CrossDomainEvidenceBridge(new ReverseEvidenceGraph());
  });

  it('should create syscall event nodes', async () => {
    const result = correlateSyscallToJS(
      bridge,
      [
        {
          pid: 1234,
          tid: 5678,
          syscallName: 'NtReadFile',
          timestamp: 1000,
        },
      ],
      [],
    );

    expect(result.syscalls).toBe(1);
    expect(result.graphNodeIds.length).toBe(1);
  });

  it('should add syscall to unmatched list when no JS stack available', async () => {
    const result = correlateSyscallToJS(
      bridge,
      [
        {
          pid: 1234,
          tid: 5678,
          syscallName: 'NtWriteFile',
          timestamp: 2000,
        },
      ],
      [],
    );

    expect(result.unmatchedSyscalls.length).toBe(1);
    expect(result.correlations).toHaveLength(0);
    expect(result.correlationConfidence).toBe(0);
  });

  it('should correlate syscall with JS stack by thread ID and timestamp', async () => {
    const syscallEvents = [
      {
        pid: 9999,
        tid: 1234,
        syscallName: 'NtReadFile',
        timestamp: 5000,
      },
    ];
    const jsStacks = [
      {
        threadId: 1234,
        timestamp: 5000,
        frames: [{ functionName: 'fs.readFile' }, { functionName: 'loadConfig' }],
      },
    ];

    const result = correlateSyscallToJS(bridge, syscallEvents, jsStacks);

    expect(result.correlations.length).toBe(1);
    // @ts-expect-error
    expect(result.correlations[0].topJsFunction).toBe('fs.readFile');
    // @ts-expect-error
    expect(result.correlations[0].syscallName).toBe('NtReadFile');
    expect(result.correlationConfidence).toBe(1);
  });

  it('should compute high confidence when syscall matches JS API pattern', async () => {
    const syscallEvents = [
      {
        pid: 9999,
        tid: 2000,
        syscallName: 'NtReadFile',
        timestamp: 3000,
      },
    ];
    const jsStacks = [
      {
        threadId: 2000,
        timestamp: 3000,
        frames: [{ functionName: 'fs_readFile_internal' }],
      },
    ];

    const result = correlateSyscallToJS(bridge, syscallEvents, jsStacks);

    expect(result.correlations[0]?.confidence).toMatch(/high|medium/);
  });

  it('should handle multiple syscalls with mixed match/no-match', async () => {
    const syscallEvents = [
      { pid: 1, tid: 100, syscallName: 'NtOpenFile', timestamp: 1000 },
      { pid: 1, tid: 200, syscallName: 'NtDeviceIoControlFile', timestamp: 2000 },
    ];
    const jsStacks = [{ threadId: 100, timestamp: 1000, frames: [{ functionName: 'fs.open' }] }];

    const result = correlateSyscallToJS(bridge, syscallEvents, jsStacks);

    expect(result.syscalls).toBe(2);
    expect(result.correlations.length).toBe(1);
    expect(result.unmatchedSyscalls.length).toBe(1);
  });

  it('should handle empty inputs gracefully', async () => {
    const result = correlateSyscallToJS(bridge, [], []);

    expect(result.syscalls).toBe(0);
    expect(result.correlationConfidence).toBe(0);
    expect(result.correlations).toHaveLength(0);
  });
});
