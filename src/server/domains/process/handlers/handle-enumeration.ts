/**
 * Handle Enumeration Handler — process_enum_handles
 *
 * Enumerates open handles for a target process using NtQuerySystemInformation.
 * Resolves handle type names and object names, decodes access masks,
 * and identifies security-risky handles.
 */

import { argNumber, argBool, argString } from '@server/domains/shared/parse-args';
import { enumerateProcessHandles, type ResolvedHandleEntry } from '@native/HandleEnumerator';
import type { ProcessManagementHandlers } from './process-management';
import { logger } from '@utils/logger';

// ── Access Mask Constants ──

const PROCESS_ACCESS_FLAGS: Record<string, number> = {
  PROCESS_TERMINATE: 0x0001,
  PROCESS_CREATE_THREAD: 0x0002,
  PROCESS_SET_SESSIONID: 0x0004,
  PROCESS_VM_OPERATION: 0x0008,
  PROCESS_VM_READ: 0x0010,
  PROCESS_VM_WRITE: 0x0020,
  PROCESS_DUP_HANDLE: 0x0040,
  PROCESS_CREATE_PROCESS: 0x0080,
  PROCESS_SET_QUOTA: 0x0100,
  PROCESS_SET_INFORMATION: 0x0200,
  PROCESS_QUERY_INFORMATION: 0x0400,
  PROCESS_SUSPEND_RESUME: 0x0800,
  PROCESS_QUERY_LIMITED_INFORMATION: 0x1000,
  SYNCHRONIZE: 0x100000,
  PROCESS_ALL_ACCESS: 0x1fffff,
};

const THREAD_ACCESS_FLAGS: Record<string, number> = {
  THREAD_TERMINATE: 0x0001,
  THREAD_SUSPEND_RESUME: 0x0002,
  THREAD_GET_CONTEXT: 0x0008,
  THREAD_SET_CONTEXT: 0x0010,
  THREAD_SET_INFORMATION: 0x0020,
  THREAD_QUERY_INFORMATION: 0x0040,
  THREAD_SET_THREAD_TOKEN: 0x0080,
  THREAD_IMPERSONATE: 0x0100,
  THREAD_DIRECT_IMPERSONATION: 0x0200,
  SYNCHRONIZE: 0x100000,
  THREAD_ALL_ACCESS: 0x1f03ff,
};

const TOKEN_ACCESS_FLAGS: Record<string, number> = {
  TOKEN_ASSIGN_PRIMARY: 0x0001,
  TOKEN_DUPLICATE: 0x0002,
  TOKEN_IMPERSONATE: 0x0004,
  TOKEN_QUERY: 0x0008,
  TOKEN_QUERY_SOURCE: 0x0010,
  TOKEN_ADJUST_PRIVILEGES: 0x0020,
  TOKEN_ADJUST_GROUPS: 0x0040,
  TOKEN_ADJUST_DEFAULT: 0x0080,
  TOKEN_ADJUST_SESSIONID: 0x0100,
  TOKEN_ALL_ACCESS: 0x20ff,
};

const FILE_ACCESS_FLAGS: Record<string, number> = {
  FILE_READ_DATA: 0x0001,
  FILE_WRITE_DATA: 0x0002,
  FILE_APPEND_DATA: 0x0004,
  FILE_READ_EA: 0x0008,
  FILE_WRITE_EA: 0x0010,
  FILE_EXECUTE: 0x0020,
  FILE_READ_ATTRIBUTES: 0x0080,
  FILE_WRITE_ATTRIBUTES: 0x0100,
  DELETE: 0x10000,
  READ_CONTROL: 0x20000,
  WRITE_DAC: 0x40000,
  WRITE_OWNER: 0x80000,
  SYNCHRONIZE: 0x100000,
  FILE_ALL_ACCESS: 0x1f01ff,
};

// ── Security Config: Sensitive Object Names ──

const SENSITIVE_OBJECT_NAMES = [
  '\\SAM',
  '\\SECURITY',
  '\\SYSTEM',
  '\\Device\\Condrv',
  'lsass.exe',
  'winlogon.exe',
  'wininit.exe',
  'csrss.exe',
  'services.exe',
];

// ── Types ──

interface HandleSecurityFinding {
  severity: 'critical' | 'high' | 'medium';
  handleValue: number;
  riskType: string;
  description: string;
}

interface HandleInfo {
  handleValue: number;
  typeName: string;
  objectName: string;
  grantedAccess: string;
  grantedAccessDecoded: string[];
  handleAttributes: number;
  inheritable: boolean;
  securityRisk?: string;
}

export interface EnumHandleResult {
  success: boolean;
  pid: number;
  totalSystemHandles?: number;
  totalHandles: number;
  filteredHandles: number;
  typeSummary: Record<string, number>;
  handles: HandleInfo[];
  securityFindings: HandleSecurityFinding[];
  requiresElevation?: boolean;
  error?: string;
  warning?: string;
}

// ── Access Mask Decoder ──

/**
 * Decode a grantedAccess mask into named flags based on the handle type.
 * Type-specific masks are decoded for Process/Thread/Token/File;
 * others get a generic decode with common bits.
 */
export function decodeAccessMask(grantedAccess: number, typeName: string): string[] {
  const hex = `0x${(grantedAccess >>> 0).toString(16).padStart(8, '0')}`;
  const flags: string[] = [];

  let flagMap: Record<string, number>;
  switch (typeName) {
    case 'Process':
      flagMap = PROCESS_ACCESS_FLAGS;
      break;
    case 'Thread':
      flagMap = THREAD_ACCESS_FLAGS;
      break;
    case 'Token':
      flagMap = TOKEN_ACCESS_FLAGS;
      break;
    case 'File':
      flagMap = FILE_ACCESS_FLAGS;
      break;
    default:
      // Generic: only decode common bits
      flagMap = {
        DELETE: 0x10000,
        READ_CONTROL: 0x20000,
        WRITE_DAC: 0x40000,
        WRITE_OWNER: 0x80000,
        SYNCHRONIZE: 0x100000,
        ACCESS_SYSTEM_SECURITY: 0x1000000,
      };
  }

  // Check ALL_ACCESS first — if it matches, report that instead of individual flags
  const allAccessKey = Object.keys(flagMap).find((k) => k.endsWith('_ALL_ACCESS'));
  if (allAccessKey) {
    const allAccess = flagMap[allAccessKey]!;
    if ((grantedAccess & allAccess) === allAccess) {
      flags.push(allAccessKey);
      return flags;
    }
  }

  // Decode individual flags
  for (const [name, value] of Object.entries(flagMap)) {
    if (name.endsWith('_ALL_ACCESS')) continue; // Already handled
    if ((grantedAccess & value) === value) {
      flags.push(name);
    }
  }

  if (flags.length === 0) {
    flags.push(hex);
  }

  return flags;
}

// ── Security Analysis ──

/**
 * Analyze a resolved handle entry for security risks.
 * Returns a finding object if the handle poses a risk, or undefined.
 */
export function analyzeHandleSecurity(
  entry: ResolvedHandleEntry,
  typeName: string,
  objectName: string,
): HandleSecurityFinding | undefined {
  const access = entry.grantedAccess;
  const inheritable = !!(entry.handleAttributes & 0x02); // OBJ_INHERIT

  // 1. High-privilege handles to sensitive processes
  if (typeName === 'Process') {
    const isSensitiveName = SENSITIVE_OBJECT_NAMES.some((p) =>
      objectName.toLowerCase().includes(p.toLowerCase()),
    );
    const hasHighAccess =
      (access & PROCESS_ACCESS_FLAGS.PROCESS_ALL_ACCESS!) ===
      PROCESS_ACCESS_FLAGS.PROCESS_ALL_ACCESS!;
    const hasDangerousAccess =
      (access &
        (PROCESS_ACCESS_FLAGS.PROCESS_VM_WRITE! | PROCESS_ACCESS_FLAGS.PROCESS_DUP_HANDLE!)) !==
      0;

    if (isSensitiveName && hasHighAccess) {
      return {
        severity: 'critical',
        handleValue: entry.handleValue,
        riskType: 'HIGH_ACCESS_TO_SENSITIVE_PROCESS',
        description: `Full access to sensitive process: ${objectName}`,
      };
    }
    if (isSensitiveName && hasDangerousAccess) {
      return {
        severity: 'high',
        handleValue: entry.handleValue,
        riskType: 'DANGEROUS_ACCESS_TO_SENSITIVE_PROCESS',
        description: `VM_WRITE/DUP_HANDLE access to sensitive process: ${objectName}`,
      };
    }
  }

  // 2. Dangerous Token handles
  if (typeName === 'Token') {
    const canDuplicate = (access & TOKEN_ACCESS_FLAGS.TOKEN_DUPLICATE!) !== 0;
    const canImpersonate = (access & TOKEN_ACCESS_FLAGS.TOKEN_IMPERSONATE!) !== 0;
    const canAdjustPrivs = (access & TOKEN_ACCESS_FLAGS.TOKEN_ADJUST_PRIVILEGES!) !== 0;

    if (canDuplicate && canImpersonate) {
      return {
        severity: 'critical',
        handleValue: entry.handleValue,
        riskType: 'TOKEN_DUPLICATE_IMPERSONATE',
        description:
          'Token with TOKEN_DUPLICATE + TOKEN_IMPERSONATE: potential privilege escalation via token impersonation',
      };
    }
    if (canAdjustPrivs) {
      return {
        severity: 'high',
        handleValue: entry.handleValue,
        riskType: 'TOKEN_ADJUST_PRIVILEGES',
        description:
          'Token with TOKEN_ADJUST_PRIVILEGES: can enable SeDebugPrivilege or equivalent',
      };
    }
  }

  // 3. Inheritable sensitive handles
  if (inheritable && (typeName === 'Process' || typeName === 'Token' || typeName === 'Key')) {
    return {
      severity: 'medium',
      handleValue: entry.handleValue,
      riskType: 'INHERITABLE_SENSITIVE_HANDLE',
      description: `Inheritable ${typeName} handle: will be inherited by child processes. Name: ${objectName || '(unnamed)'}`,
    };
  }

  // 4. Section handles to executables (hollowing indicator)
  if (typeName === 'Section' && objectName) {
    const isExecutableSection =
      objectName.toLowerCase().endsWith('.exe') || objectName.toLowerCase().endsWith('.dll');
    const hasExecAccess =
      (access & 0x0002) !== 0 || // SECTION_MAP_WRITE
      (access & 0x0004) !== 0; // SECTION_MAP_EXECUTE

    if (isExecutableSection && hasExecAccess) {
      return {
        severity: 'high',
        handleValue: entry.handleValue,
        riskType: 'SECTION_TO_EXECUTABLE',
        description: `Section handle to executable file with write/execute access: ${objectName}`,
      };
    }
  }

  return undefined;
}

// ── Handler Class ──

export class HandleEnumerationHandlers {
  private processMgmt: ProcessManagementHandlers;

  constructor(processMgmt: ProcessManagementHandlers) {
    this.processMgmt = processMgmt;
  }

  async handleProcessEnumHandles(args: Record<string, unknown>): Promise<EnumHandleResult> {
    try {
      const pid = argNumber(args, 'pid');
      if (!pid || pid <= 0) {
        return {
          success: false,
          pid: pid ?? 0,
          totalHandles: 0,
          filteredHandles: 0,
          typeSummary: {},
          handles: [],
          securityFindings: [],
          error: 'pid must be a positive integer',
        };
      }

      // Platform guard
      const platform = this.processMgmt.platformValue;
      if (platform !== 'win32') {
        return {
          success: false,
          pid,
          totalHandles: 0,
          filteredHandles: 0,
          typeSummary: {},
          handles: [],
          securityFindings: [],
          error: 'process_enum_handles is only available on Windows',
        };
      }

      const filterType = argString(args, 'filterType', '');
      const includeNames = argBool(args, 'includeNames', true);
      const securityOnly = argBool(args, 'securityOnly', false);

      // 1. Call native enumeration
      const result = enumerateProcessHandles(pid, {
        includeNames,
        filterType: filterType || undefined,
      });

      if (!result.success) {
        return {
          success: false,
          pid,
          totalHandles: 0,
          filteredHandles: 0,
          typeSummary: {},
          handles: [],
          securityFindings: [],
          error: result.error,
          requiresElevation: result.requiresElevation,
        };
      }

      // 2. Build type summary
      const typeSummary: Record<string, number> = {};
      for (const entry of result.entries) {
        const typeName = entry.typeName;
        typeSummary[typeName] = (typeSummary[typeName] ?? 0) + 1;
      }

      // 3. Security analysis + access mask decode
      const securityFindings: HandleSecurityFinding[] = [];
      const handles: HandleInfo[] = [];

      for (const entry of result.entries) {
        const finding = analyzeHandleSecurity(entry, entry.typeName, entry.objectName);

        if (securityOnly && !finding) continue;

        const decodedFlags = decodeAccessMask(entry.grantedAccess, entry.typeName);

        handles.push({
          handleValue: entry.handleValue,
          typeName: entry.typeName,
          objectName: entry.objectName,
          grantedAccess: `0x${(entry.grantedAccess >>> 0).toString(16).padStart(8, '0')}`,
          grantedAccessDecoded: decodedFlags,
          handleAttributes: entry.handleAttributes,
          inheritable: !!(entry.handleAttributes & 0x02),
          securityRisk: finding?.riskType,
        });

        if (finding) {
          securityFindings.push(finding);
        }
      }

      // 4. Build warning
      let warning: string | undefined;
      if (result.entries.length > 500) {
        warning = `Process has ${result.entries.length} handles. Showing first 500. Use filterType or securityOnly to narrow results.`;
      }

      // Apply 500-handle cap (unless securityOnly or filterType is set)
      const shouldCap = !securityOnly && !filterType;
      const cappedHandles = shouldCap ? handles.slice(0, 500) : handles;

      return {
        success: true,
        pid,
        totalSystemHandles: result.totalSystemHandles,
        totalHandles: result.entries.length,
        filteredHandles: cappedHandles.length,
        typeSummary,
        handles: cappedHandles,
        securityFindings,
        warning,
      };
    } catch (error) {
      logger.error('[handleProcessEnumHandles] failed:', error);
      return {
        success: false,
        pid: argNumber(args, 'pid') ?? 0,
        totalHandles: 0,
        filteredHandles: 0,
        typeSummary: {},
        handles: [],
        securityFindings: [],
        error: `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

// ── Export pure functions for testing ──

export { decodeAccessMask as _decodeAccessMask, analyzeHandleSecurity as _analyzeHandleSecurity };
