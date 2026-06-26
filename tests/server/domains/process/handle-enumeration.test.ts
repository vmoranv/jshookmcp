/**
 * Tests for process_enum_handles — handle enumeration handler
 *
 * Tests are organized into:
 *   1. Pure function tests (buffer parsing, access mask decode, security analysis)
 *   2. Handler integration tests
 *   3. Platform guard tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  _decodeAccessMask,
  _analyzeHandleSecurity,
} from '@server/domains/process/handlers/handle-enumeration';
import {
  parseHandleBufferForTest,
  type ResolvedHandleEntry,
  type EnumerateResult,
} from '@native/HandleEnumerator';

// ── Helper: build a SYSTEM_HANDLE_INFORMATION_EX buffer ──

function buildHandleBufferEx(
  entries: Array<{
    object?: bigint;
    processId: number;
    handleValue: number;
    grantedAccess?: number;
    objectTypeIndex: number;
    handleAttributes?: number;
  }>,
): Buffer {
  const HEADER_SIZE = 16;
  const ENTRY_SIZE = 40;
  const totalSize = HEADER_SIZE + entries.length * ENTRY_SIZE;
  const buf = Buffer.alloc(totalSize);

  buf.writeBigUInt64LE(BigInt(entries.length), 0);
  buf.writeBigUInt64LE(0n, 8);

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    const off = HEADER_SIZE + i * ENTRY_SIZE;
    buf.writeBigUInt64LE(e.object ?? BigInt(i + 1), off + 0);
    buf.writeBigUInt64LE(BigInt(e.processId), off + 8);
    buf.writeBigUInt64LE(BigInt(e.handleValue), off + 16);
    buf.writeUInt32LE(e.grantedAccess ?? 0x1fffff, off + 24);
    buf.writeUInt16LE(0, off + 28);
    buf.writeUInt16LE(e.objectTypeIndex, off + 30);
    buf.writeUInt32LE(e.handleAttributes ?? 0, off + 32);
    buf.writeUInt32LE(0, off + 36);
  }

  return buf;
}

function makeResolvedEntry(overrides: {
  grantedAccess?: number;
  handleAttributes?: number;
  handleValue?: number;
}): ResolvedHandleEntry {
  return {
    object: 1n,
    processId: 1234,
    handleValue: overrides.handleValue ?? 0x100,
    grantedAccess: overrides.grantedAccess ?? 0x1fffff,
    objectTypeIndex: 0,
    handleAttributes: overrides.handleAttributes ?? 0,
    typeName: '',
    objectName: '',
  };
}

function makeMockNativeResult(overrides: Partial<EnumerateResult> = {}): EnumerateResult {
  return {
    success: true,
    entries: [
      {
        object: 1n,
        processId: 1234,
        handleValue: 0x100,
        grantedAccess: 0x1fffff,
        objectTypeIndex: 5,
        handleAttributes: 0,
        typeName: 'Process',
        objectName: '',
      },
      {
        object: 2n,
        processId: 1234,
        handleValue: 0x200,
        grantedAccess: 0x0002 | 0x0004,
        objectTypeIndex: 8,
        handleAttributes: 0x02,
        typeName: 'Token',
        objectName: '',
      },
    ],
    totalSystemHandles: 50000,
    typeIndexCache: new Map([
      [5, 'Process'],
      [8, 'Token'],
    ]),
    ...overrides,
  };
}

// ── 1. Buffer Parsing Tests ──

describe('parseHandleBufferForTest', () => {
  it('parses an empty buffer (0 handles)', () => {
    const buf = Buffer.alloc(16);
    buf.writeBigUInt64LE(0n, 0);
    buf.writeBigUInt64LE(0n, 8);
    const entries = parseHandleBufferForTest(buf, 1234);
    expect(entries).toEqual([]);
  });

  it('parses single entry matching the PID', () => {
    const buf = buildHandleBufferEx([{ processId: 1234, handleValue: 0x100, objectTypeIndex: 5 }]);
    const entries = parseHandleBufferForTest(buf, 1234);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      processId: 1234,
      handleValue: 0x100,
      objectTypeIndex: 5,
    });
  });

  it('filters entries by PID', () => {
    const buf = buildHandleBufferEx([
      { processId: 1234, handleValue: 0x100, objectTypeIndex: 5 },
      { processId: 5678, handleValue: 0x200, objectTypeIndex: 5 },
      { processId: 1234, handleValue: 0x300, objectTypeIndex: 3 },
    ]);
    const entries = parseHandleBufferForTest(buf, 1234);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.handleValue)).toEqual([0x100, 0x300]);
  });

  it('returns all entries when no PID filter', () => {
    const buf = buildHandleBufferEx([
      { processId: 1234, handleValue: 0x100, objectTypeIndex: 5 },
      { processId: 5678, handleValue: 0x200, objectTypeIndex: 5 },
    ]);
    const entries = parseHandleBufferForTest(buf);
    expect(entries).toHaveLength(2);
  });

  it('skips entries with handleValue=0 (unused slots)', () => {
    const buf = buildHandleBufferEx([
      { processId: 1234, handleValue: 0, objectTypeIndex: 5 },
      { processId: 1234, handleValue: 0x100, objectTypeIndex: 5 },
    ]);
    const entries = parseHandleBufferForTest(buf, 1234);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.handleValue).toBe(0x100);
  });

  it('parses grantedAccess and handleAttributes', () => {
    const buf = buildHandleBufferEx([
      {
        processId: 100,
        handleValue: 0x50,
        grantedAccess: 0x1f0fff,
        objectTypeIndex: 7,
        handleAttributes: 0x02,
      },
    ]);
    const entries = parseHandleBufferForTest(buf);
    expect(entries[0]).toMatchObject({
      grantedAccess: 0x1f0fff,
      handleAttributes: 0x02,
    });
  });
});

// ── 2. Access Mask Decoding Tests ──

describe('decodeAccessMask', () => {
  it('decodes PROCESS_ALL_ACCESS', () => {
    const flags = _decodeAccessMask(0x1fffff, 'Process');
    expect(flags).toContain('PROCESS_ALL_ACCESS');
    expect(flags).toHaveLength(1);
  });

  it('decodes individual process flags', () => {
    const flags = _decodeAccessMask(0x0010 | 0x0400, 'Process');
    expect(flags).toContain('PROCESS_VM_READ');
    expect(flags).toContain('PROCESS_QUERY_INFORMATION');
  });

  it('decodes THREAD_ALL_ACCESS', () => {
    const flags = _decodeAccessMask(0x1f03ff, 'Thread');
    expect(flags).toContain('THREAD_ALL_ACCESS');
  });

  it('decodes Token with TOKEN_DUPLICATE + TOKEN_IMPERSONATE', () => {
    const flags = _decodeAccessMask(0x0002 | 0x0004, 'Token');
    expect(flags).toContain('TOKEN_DUPLICATE');
    expect(flags).toContain('TOKEN_IMPERSONATE');
  });

  it('decodes FILE_ALL_ACCESS', () => {
    const flags = _decodeAccessMask(0x1f01ff, 'File');
    expect(flags).toContain('FILE_ALL_ACCESS');
  });

  it('falls back to generic flags for unknown types', () => {
    const flags = _decodeAccessMask(0x10000 | 0x20000, 'Mutant');
    expect(flags).toContain('DELETE');
    expect(flags).toContain('READ_CONTROL');
  });

  it('returns hex string when no known flags match', () => {
    const flags = _decodeAccessMask(0x0001, 'Desktop');
    expect(flags.length).toBeGreaterThan(0);
  });
});

// ── 3. Security Analysis Tests ──

describe('analyzeHandleSecurity', () => {
  it('detects high-privilege handles to sensitive processes', () => {
    const entry = makeResolvedEntry({ grantedAccess: 0x1fffff });
    const finding = _analyzeHandleSecurity(entry, 'Process', '\\Device\\lsass.exe');
    expect(finding).toMatchObject({
      severity: 'critical',
      riskType: 'HIGH_ACCESS_TO_SENSITIVE_PROCESS',
    });
  });

  it('detects dangerous access to sensitive processes', () => {
    const entry = makeResolvedEntry({ grantedAccess: 0x0020 | 0x0040 });
    const finding = _analyzeHandleSecurity(entry, 'Process', '\\Device\\winlogon.exe');
    expect(finding).toMatchObject({
      severity: 'high',
      riskType: 'DANGEROUS_ACCESS_TO_SENSITIVE_PROCESS',
    });
  });

  it('detects TOKEN_DUPLICATE + TOKEN_IMPERSONATE', () => {
    const entry = makeResolvedEntry({ grantedAccess: 0x0002 | 0x0004 });
    const finding = _analyzeHandleSecurity(entry, 'Token', '');
    expect(finding).toMatchObject({
      severity: 'critical',
      riskType: 'TOKEN_DUPLICATE_IMPERSONATE',
    });
  });

  it('detects TOKEN_ADJUST_PRIVILEGES', () => {
    const entry = makeResolvedEntry({ grantedAccess: 0x0020 });
    const finding = _analyzeHandleSecurity(entry, 'Token', '');
    expect(finding).toMatchObject({
      severity: 'high',
      riskType: 'TOKEN_ADJUST_PRIVILEGES',
    });
  });

  it('detects inheritable Process handle', () => {
    const entry = makeResolvedEntry({ grantedAccess: 0x0010, handleAttributes: 0x02 });
    const finding = _analyzeHandleSecurity(entry, 'Process', 'some_process');
    expect(finding).toMatchObject({
      severity: 'medium',
      riskType: 'INHERITABLE_SENSITIVE_HANDLE',
    });
  });

  it('detects inheritable Token handle', () => {
    const entry = makeResolvedEntry({ grantedAccess: 0x0008, handleAttributes: 0x02 });
    const finding = _analyzeHandleSecurity(entry, 'Token', '');
    expect(finding).toMatchObject({
      severity: 'medium',
      riskType: 'INHERITABLE_SENSITIVE_HANDLE',
    });
  });

  it('detects inheritable Key handle', () => {
    const entry = makeResolvedEntry({ handleAttributes: 0x02 });
    const finding = _analyzeHandleSecurity(entry, 'Key', '\\REGISTRY\\MACHINE\\SAM');
    expect(finding).toMatchObject({
      severity: 'medium',
      riskType: 'INHERITABLE_SENSITIVE_HANDLE',
    });
  });

  it('detects Section handle to executable', () => {
    const entry = makeResolvedEntry({ grantedAccess: 0x0004 });
    const finding = _analyzeHandleSecurity(
      entry,
      'Section',
      '\\Device\\HarddiskVolume3\\malware.exe',
    );
    expect(finding).toMatchObject({
      severity: 'high',
      riskType: 'SECTION_TO_EXECUTABLE',
    });
  });

  it('returns undefined for non-risky Token handles', () => {
    const entry = makeResolvedEntry({ grantedAccess: 0x0008 });
    const finding = _analyzeHandleSecurity(entry, 'Token', '');
    expect(finding).toBeUndefined();
  });

  it('returns undefined for regular process handles (not sensitive)', () => {
    const entry = makeResolvedEntry({ grantedAccess: 0x1fffff });
    const finding = _analyzeHandleSecurity(entry, 'Process', '\\Device\\SomeApp\\notepad.exe');
    expect(finding).toBeUndefined();
  });
});

// ── 4. Handler Integration Tests ──
//
// We mock enumerateProcessHandles at the module level using vi.mock().
// The handler imports it, so the mock must be hoisted above the import.

vi.mock('@native/HandleEnumerator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@native/HandleEnumerator')>();
  return {
    ...actual,
    enumerateProcessHandles: vi.fn(),
  };
});

import { HandleEnumerationHandlers } from '@server/domains/process/handlers/handle-enumeration';
import { enumerateProcessHandles } from '@native/HandleEnumerator';

const mockedEnumerate = vi.mocked(enumerateProcessHandles);

describe('HandleEnumerationHandlers — integration', () => {
  beforeEach(() => {
    // Reset to default mock before each test
    mockedEnumerate.mockReturnValue(makeMockNativeResult());
  });

  it('returns error for invalid pid', async () => {
    const mockPm = { platformValue: 'win32' } as any;
    const handler = new HandleEnumerationHandlers(mockPm);

    const result = await handler.handleProcessEnumHandles({ pid: 0 });
    expect(result.success).toBe(false);
    expect(result.error).toContain('positive integer');
  });

  it('returns error on non-Windows platform', async () => {
    const mockPm = { platformValue: 'linux' } as any;
    const handler = new HandleEnumerationHandlers(mockPm);

    const result = await handler.handleProcessEnumHandles({ pid: 1234 });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Windows');
  });

  it('delegates to native enumerateProcessHandles and builds result', async () => {
    const mockPm = { platformValue: 'win32' } as any;
    const handler = new HandleEnumerationHandlers(mockPm);

    const result = await handler.handleProcessEnumHandles({ pid: 1234 });
    expect(result.success).toBe(true);
    expect(result.pid).toBe(1234);
    expect(result.totalHandles).toBe(2);
    expect(result.handles.length).toBeGreaterThan(0);
    expect(result.typeSummary).toHaveProperty('Process');
    expect(result.typeSummary).toHaveProperty('Token');
    expect(result.securityFindings.length).toBeGreaterThan(0);
  });

  it('applies 500-handle cap when no filter', async () => {
    mockedEnumerate.mockReturnValue(
      makeMockNativeResult({
        entries: Array.from({ length: 600 }, (_, i) => ({
          object: BigInt(i + 1),
          processId: 1234,
          handleValue: i + 1,
          grantedAccess: 0x0010,
          objectTypeIndex: 5,
          handleAttributes: 0,
          typeName: 'Process',
          objectName: '',
        })),
        totalSystemHandles: 50000,
        typeIndexCache: new Map([[5, 'Process']]),
      }),
    );

    const mockPm = { platformValue: 'win32' } as any;
    const handler = new HandleEnumerationHandlers(mockPm);

    const result = await handler.handleProcessEnumHandles({ pid: 1234 });
    expect(result.success).toBe(true);
    expect(result.totalHandles).toBe(600);
    expect(result.handles).toHaveLength(500);
    expect(result.warning).toContain('500');
  });

  it('securityOnly filters out non-risky handles', async () => {
    mockedEnumerate.mockReturnValue(
      makeMockNativeResult({
        entries: [
          {
            object: 1n,
            processId: 1234,
            handleValue: 0x100,
            grantedAccess: 0x0010,
            objectTypeIndex: 5,
            handleAttributes: 0,
            typeName: 'Process',
            objectName: '\\Device\\notepad.exe',
          },
          {
            object: 2n,
            processId: 1234,
            handleValue: 0x200,
            grantedAccess: 0x0002 | 0x0004,
            objectTypeIndex: 8,
            handleAttributes: 0,
            typeName: 'Token',
            objectName: '',
          },
        ],
        typeIndexCache: new Map([
          [5, 'Process'],
          [8, 'Token'],
        ]),
      }),
    );

    const mockPm = { platformValue: 'win32' } as any;
    const handler = new HandleEnumerationHandlers(mockPm);

    const result = await handler.handleProcessEnumHandles({ pid: 1234, securityOnly: true });
    expect(result.success).toBe(true);
    expect(result.handles).toHaveLength(1);
    expect(result.handles[0]!.typeName).toBe('Token');
    expect(result.securityFindings).toHaveLength(1);
  });

  it('propagates requiresElevation from native layer', async () => {
    mockedEnumerate.mockReturnValue({
      success: false,
      entries: [],
      totalSystemHandles: 0,
      typeIndexCache: new Map(),
      error: 'Cannot open process 999. Run as Administrator.',
      requiresElevation: true,
    });

    const mockPm = { platformValue: 'win32' } as any;
    const handler = new HandleEnumerationHandlers(mockPm);

    const result = await handler.handleProcessEnumHandles({ pid: 999 });
    expect(result.success).toBe(false);
    expect(result.requiresElevation).toBe(true);
    expect(result.error).toContain('Administrator');
  });
});
