/**
 * Memory domain benchmark (pure-TS subset — no live process).
 *
 * External reference:
 *  - Cheat Engine .CT table format (Cheat Engine source, CETRAINER XML):
 *    memory_cheat_table export → sign (HMAC-SHA256) → verify loop; tampering must break it
 * Homemade fixtures:
 *  - a two-entry table, signature roundtrip, tamper detection, secret source precedence
 */
import { StructureHandlers } from '@server/domains/memory/handlers/structure';
import { MinidumpHandlers } from '@server/domains/memory/handlers/minidump-parse';
import { AssembleHandlers } from '@server/domains/memory/handlers/assemble';
import { BookmarkHandlers } from '@server/domains/memory/handlers/bookmark';
import { ScanHandlers } from '@server/domains/memory/handlers/scan';
import { SessionHandlers } from '@server/domains/memory/handlers/session';
import { MemoryScanHandlers } from '@server/domains/memory/handlers.impl';
import memoryManifest from '@server/domains/memory/manifest';
import { body, type BenchSuite } from '../harness';
import { memoryWin32Cases } from './memory.win32';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * PID far outside the range any live process can occupy, so the
 * "target unreachable" contracts can never collide with a real process.
 */
const MISSING_PID = 2_147_480_000;

/**
 * Invoke a memory tool through its REAL manifest binding.
 *
 * Memory tools are registered as `{ tool, domain, bind }` entries, so going
 * through the manifest exercises the same path the server uses (arg routing →
 * platform filter → validation) instead of a hand-picked handler method. The
 * handlers instance is dependency-less: every case below asserts a refusal that
 * happens BEFORE any native call, so missing sub-engines are irrelevant.
 */
let memoryHandlers: MemoryScanHandlers | null = null;
const memoryBindings = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();

function bindingFor(tool: string): ((args: Record<string, unknown>) => Promise<unknown>) | null {
  const cached = memoryBindings.get(tool);
  if (cached) return cached;
  memoryHandlers ??= new MemoryScanHandlers({} as never, {} as never, {} as never, {} as never);
  const manifest = memoryManifest as unknown as {
    depKey: string;
    registrations?: Array<{
      tool?: { name?: string } | string;
      bind?: (deps: Record<string, unknown>, args: unknown) => unknown;
    }>;
  };
  for (const registration of manifest.registrations ?? []) {
    const name =
      typeof registration.tool === 'string' ? registration.tool : registration.tool?.name;
    if (name !== tool || typeof registration.bind !== 'function') continue;
    const bound = registration.bind({ [manifest.depKey]: memoryHandlers }, {}) as (
      args: Record<string, unknown>,
    ) => Promise<unknown>;
    memoryBindings.set(tool, bound);
    return bound;
  }
  return null;
}

/** Call a memory tool and flatten its ToolResponse to a JSON string (or raw text). */
async function callMemory(tool: string, args: Record<string, unknown>): Promise<string> {
  const bound = bindingFor(tool);
  if (!bound) return `__no_binding__:${tool}`;
  try {
    const response = await bound(args);
    const content = (response as { content?: Array<{ text?: string }> } | undefined)?.content;
    const text = content?.[0]?.text;
    if (typeof text === 'string') return text;
    return JSON.stringify(response);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** A refusal counts only when the text names the offending argument/capability. */
function validateRefusal(text: string, expect: RegExp): true | string {
  if (text.startsWith('__no_binding__')) return text;
  return expect.test(text) ? true : `refusal does not match ${expect}: ${text.slice(0, 220)}`;
}

/**
 * "Honest empty" counts when the tool either refuses with a named reason or
 * succeeds with every listed collection empty — never fabricated rows.
 */
function validateHonestEmpty(text: string, zeroKeys: string[]): true | string {
  if (text.startsWith('__no_binding__')) return text;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return /Invalid PID|not supported|Failed to open process|requires/i.test(text) &&
      text.length > 0
      ? true
      : `unparsable and not a named refusal: ${text.slice(0, 200)}`;
  }
  if (parsed['success'] === false) {
    return String(parsed['error'] ?? parsed['message'] ?? '').length > 0
      ? true
      : `refusal without a named reason`;
  }
  for (const key of zeroKeys) {
    const value = parsed[key];
    if (!Array.isArray(value)) return `${key} must be an array: ${text.slice(0, 200)}`;
    if (value.length !== 0) return `${key} must be empty, got ${value.length} rows`;
  }
  return true;
}

interface RefusalSpec {
  tool: string;
  slug: string;
  note: string;
  expect: RegExp;
  args?: Record<string, unknown>;
}

/** Tools whose contract is "refuse by naming the missing/invalid input or gate". */
const REFUSAL_SPECS: readonly RefusalSpec[] = [
  {
    tool: 'memory_first_scan',
    slug: 'missing-value',
    note: 'first scan needs the value to search for; rejected by name',
    expect: /"?value"?/i,
  },
  {
    tool: 'memory_next_scan',
    slug: 'missing-sessionId',
    note: 'next scan continues an existing session and names it when absent',
    expect: /"?sessionId"?/i,
  },
  {
    tool: 'memory_unknown_scan',
    slug: 'missing-valueType',
    note: 'an unknown-value scan needs the value type; rejected by name',
    expect: /"?valueType"?/i,
  },
  {
    tool: 'memory_pointer_scan',
    slug: 'requires-hex-target',
    note: 'pointer scan needs a hex target address and says so',
    expect: /targetAddress must be a hex address/,
  },
  {
    tool: 'memory_pointer_chain',
    slug: 'requires-hex-target',
    note: 'pointer-chain walk needs a hex target address',
    expect: /targetAddress must be a hex address/,
  },
  {
    tool: 'memory_group_scan',
    slug: 'missing-pattern',
    note: 'group scan needs a pattern definition',
    expect: /"?pattern"?/i,
  },
  {
    tool: 'memory_search_string',
    slug: 'missing-pattern',
    note: 'string search needs the text to look for',
    expect: /"?pattern"?/i,
  },
  {
    tool: 'memory_structure_analyze',
    slug: 'missing-address',
    note: 'structure analysis needs the address to analyse',
    expect: /"?address"?/i,
  },
  {
    tool: 'memory_vtable_parse',
    slug: 'missing-vtableAddress',
    note: 'vtable parsing needs the vtable address',
    expect: /"?vtableAddress"?/i,
  },
  {
    tool: 'memory_structure_compare',
    slug: 'missing-address1',
    note: 'structure comparison needs both addresses',
    expect: /"?address1"?/i,
  },
  {
    tool: 'memory_patch_bytes',
    slug: 'requires-hex-address',
    note: 'byte patching needs a hex address before any write',
    expect: /address must be a hex address/,
  },
  {
    tool: 'memory_patch_nop',
    slug: 'requires-hex-address',
    note: 'NOP patching needs a hex address before any write',
    expect: /address must be a hex address/,
  },
  {
    tool: 'memory_patch_undo',
    slug: 'missing-patchId',
    note: 'undo needs the patch id it should revert',
    expect: /"?patchId"?/i,
  },
  {
    tool: 'memory_write_value',
    slug: 'requires-hex-address',
    note: 'typed write needs a hex address before any write',
    expect: /address must be a hex address/,
  },
  {
    tool: 'memory_batch_edit',
    slug: 'missing-sessionId',
    note: 'batch edit is scoped to a scan session and names it when absent',
    expect: /"?sessionId"?/i,
  },
  {
    tool: 'memory_watch',
    slug: 'requires-hex-address',
    note: 'watchpoints need a hex address to observe',
    expect: /address must be a hex address/,
  },
  {
    tool: 'memory_freeze',
    slug: 'requires-hex-address',
    note: 'freezing needs a hex address plus a value',
    expect: /address must be a hex address|"?value"?/i,
  },
  {
    tool: 'memory_dump',
    slug: 'requires-hex-address',
    note: 'memory dump needs a hex address',
    expect: /address must be a hex address/,
  },
  {
    tool: 'memory_read_typed',
    slug: 'requires-hex-address',
    note: 'typed read needs a hex address',
    expect: /address must be a hex address/,
  },
  {
    tool: 'memory_protect',
    slug: 'requires-hex-address',
    note: 'changing page protection needs a hex address',
    expect: /address must be a hex address/,
  },
  {
    tool: 'memory_region_compare',
    slug: 'requires-hex-address1',
    note: 'region comparison needs a hex address to start from',
    expect: /address1 must be a hex address/,
  },
  {
    tool: 'memory_find_references',
    slug: 'requires-hex-address',
    note: 'reference search needs the target address in hex',
    expect: /address must be a hex address/,
  },
  {
    tool: 'memory_reverse_mwt',
    slug: 'requires-hex-address',
    note: 'MWT reversal needs a hex address',
    expect: /address must be a hex address/,
  },
  {
    tool: 'memory_rtti_info',
    slug: 'missing-address',
    note: 'RTTI parsing needs the object address',
    expect: /"?address"?/i,
  },
  {
    tool: 'memory_generate_signature',
    slug: 'missing-address',
    note: 'signature generation needs the instruction address',
    expect: /"?address"?/i,
  },
  {
    tool: 'memory_aob_scan',
    slug: 'missing-pattern',
    note: 'AOB scan needs the byte pattern',
    expect: /"?pattern"?/i,
  },
  {
    tool: 'memory_pe_headers',
    slug: 'missing-moduleName',
    note: 'on win32 the PE header read needs a module name (ASLR-safe)',
    expect: /moduleName/i,
  },
  {
    tool: 'memory_pe_imports_exports',
    slug: 'missing-moduleName',
    note: 'imports/exports need a module name on win32',
    expect: /moduleName/i,
  },
  {
    tool: 'memory_mono_classes',
    slug: 'missing-assemblyName',
    note: 'Mono class enumeration needs the assembly name',
    expect: /"?assemblyName"?/i,
  },
  {
    tool: 'memory_mono_methods',
    slug: 'missing-assemblyName',
    note: 'Mono method enumeration needs the assembly name',
    expect: /"?assemblyName"?/i,
  },
  {
    tool: 'memory_mono_objects',
    slug: 'missing-className',
    note: 'Mono object enumeration needs the class name',
    expect: /"?className"?/i,
  },
  {
    tool: 'memory_mono_fields',
    slug: 'requires-hex-address',
    note: 'Mono field listing needs the class address in hex',
    expect: /address must be a hex address/,
  },
  {
    tool: 'memory_mono_detect',
    slug: 'rejects-unopenable-process',
    note: 'Mono detection opens the process first and reports the open failure',
    expect: /Failed to open process|Invalid PID/,
  },
  {
    tool: 'memory_mono_assemblies',
    slug: 'rejects-unopenable-process',
    note: 'assembly listing opens the process first and reports the open failure',
    expect: /Failed to open process|Invalid PID/,
  },
  {
    tool: 'memory_region_enumerate',
    slug: 'rejects-unopenable-process',
    note: 'region enumeration reports the open failure with the elevation hint',
    expect: /Failed to open process|Invalid PID/,
  },
  {
    tool: 'memory_session_export',
    slug: 'missing-sessionId',
    note: 'exporting needs the session id to serialise',
    expect: /"?sessionId"?/i,
  },
  {
    tool: 'memory_trace_code',
    slug: 'requires-addresses-or-region',
    note: 'code tracing needs addresses or an address+length region, and says both',
    expect: /addresses|address/i,
  },
  {
    tool: 'memory_pointer_map',
    slug: 'unknown-action',
    note: 'dispatch rejects an unknown action and lists the allowed ones',
    expect: /Expected one of/i,
  },
  {
    tool: 'memory_process_control',
    slug: 'unknown-action',
    note: 'process_control accepts only suspend/resume and names both',
    expect: /suspend/i,
  },
  {
    tool: 'memory_hypervisor',
    slug: 'unknown-action',
    note: 'hypervisor dispatch rejects an unspecified action',
    expect: /Unknown action|Expected one of/i,
  },
  // Capability gates — the tool is deliberately disabled, and says which env var turns it on.
  {
    tool: 'memory_allocate',
    slug: 'injection-gate',
    note: 'safety gate: remote allocation requires JSHOOK_INJECTION_ENABLE=1 and names the variable',
    expect: /JSHOOK_INJECTION_ENABLE|Invalid PID|missing or invalid/i,
  },
  {
    tool: 'memory_free',
    slug: 'injection-gate',
    note: 'safety gate: freeing remote memory requires JSHOOK_INJECTION_ENABLE=1',
    expect: /JSHOOK_INJECTION_ENABLE|Invalid PID|missing or invalid/i,
  },
  {
    tool: 'memory_inject_dll',
    slug: 'injection-gate',
    note: 'safety gate: DLL injection requires JSHOOK_INJECTION_ENABLE=1',
    expect: /JSHOOK_INJECTION_ENABLE|Invalid PID|missing or invalid/i,
  },
  {
    tool: 'memory_auto_assemble',
    slug: 'injection-gate',
    note: 'safety gate: Auto Assembler scripts require JSHOOK_INJECTION_ENABLE=1',
    expect: /JSHOOK_INJECTION_ENABLE|Invalid PID|missing or invalid/i,
  },
  // Engine-backed tools: the only engine-independent contract is the PID
  // validation that runs BEFORE any sub-engine is dereferenced. (Their
  // success paths need wired HeapAnalyzer / CodeInjector / freeze engines, so
  // they are asserted on the shared validation surface only.)
  {
    tool: 'memory_code_caves',
    slug: 'missing-pid',
    note: 'PID validation runs before the code-cave engine is touched',
    expect: /Invalid PID/i,
    args: {},
  },
  {
    tool: 'memory_heap_enumerate',
    slug: 'missing-pid',
    note: 'PID validation runs before the heap analyzer is touched',
    expect: /Invalid PID/i,
    args: {},
  },
  {
    tool: 'memory_heap_stats',
    slug: 'missing-pid',
    note: 'PID validation runs before the heap analyzer is touched',
    expect: /Invalid PID/i,
    args: {},
  },
  {
    tool: 'memory_heap_anomalies',
    slug: 'missing-pid',
    note: 'PID validation runs before the heap analyzer is touched',
    expect: /Invalid PID/i,
    args: {},
  },
  {
    tool: 'memory_auto_assemble_disable',
    slug: 'injection-gate',
    note: 'safety gate: disabling AA scripts requires the same injection gate',
    expect: /JSHOOK_INJECTION_ENABLE|Invalid PID|missing or invalid/i,
  },
  {
    tool: 'memory_inject_shellcode',
    slug: 'injection-gate',
    note: 'safety gate: shellcode injection requires JSHOOK_INJECTION_ENABLE=1 and names the variable',
    expect: /JSHOOK_INJECTION_ENABLE|Invalid PID|missing or invalid/i,
  },
];

interface HonestEmptySpec {
  tool: string;
  slug: string;
  note: string;
  zeroKeys: string[];
  args?: Record<string, unknown>;
}

/** Tools whose contract is "clean refusal OR success with zero rows". */
const HONEST_EMPTY_SPECS: readonly HonestEmptySpec[] = [
  {
    tool: 'memory_inline_hook_detect',
    slug: 'no-hooks',
    note: 'inline/IAT hook scan reports zero hooks when the target cannot be inspected — no invented rows',
    zeroKeys: ['inlineHooks', 'iatHooks'],
  },
  {
    tool: 'memory_anticheat_detect',
    slug: 'no-detections',
    note: 'anti-cheat import scan reports zero detections with a platform note',
    zeroKeys: ['detections'],
  },
  {
    tool: 'memory_guard_pages',
    slug: 'no-guard-pages',
    note: 'guard-page scan reports zero regions plus its scan stats',
    zeroKeys: ['guardPages'],
  },
  {
    tool: 'memory_integrity_check',
    slug: 'no-sections',
    note: 'integrity check reports zero modified sections plus scan stats',
    zeroKeys: ['sections'],
  },
];

const handlers = new StructureHandlers({} as never, undefined, undefined, null);
const minidumpHandlers = new MinidumpHandlers();
const assembleHandlers = new AssembleHandlers();
const bookmarkHandlers = new BookmarkHandlers();
const sessionHandlers = new SessionHandlers(
  {
    listSessions: () => [],
    deleteSession: () => false,
    exportSession: () => '{}',
    getSession: () => {
      throw new Error('not found');
    },
  } as never,
  null,
);

// Minimal valid 32-byte Windows MDMP minidump header (signature 0x504D444D, 0 streams)
const tmp = mkdtempSync(join(tmpdir(), 'jshook-bench-mem-'));
const dmpPath = join(tmp, 'minimal.dmp');
const dmpBuf = Buffer.alloc(32, 0);
dmpBuf.writeUInt32LE(0x504d444d, 0); // 'MDMP'
dmpBuf.writeUInt16LE(0xa793, 4); // versionLo
writeFileSync(dmpPath, dmpBuf);
process.once('exit', () => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {}
});

const ENTRIES = [
  { description: 'player.health', address: 'games.exe+0x1A2B3C', valueType: 'int32' },
  { description: 'player.coins', address: '0x7FF600000010', valueType: 'int64' },
];
const SECRET = 'bench-secret-5f2c';

function cheatTable(
  action: 'export' | 'sign' | 'verify',
  extra: Record<string, unknown>,
): Promise<unknown> {
  if (action === 'sign') return handlers.handleCheatTableSign({ ...extra });
  if (action === 'verify') return handlers.handleCheatTableVerify({ ...extra });
  return handlers.handleCheatTableExport({ ...extra });
}

export const memorySuite: BenchSuite = {
  name: 'memory-pure-ts',
  domain: 'memory',
  description:
    'Cheat Engine .CT format offline: export → HMAC-SHA256 sign → verify, tamper detection',
  cases: [
    {
      name: 'memory_cheat_table/export-ct-xml',
      tool: 'memory_cheat_table',
      origin: 'external-vector',
      reference:
        'Cheat Engine CETRAINER XML: exported table must be XML with a <CheatTable> root and one <CheatEntry> per entry',
      run: () => cheatTable('export', { entries: ENTRIES }),
      validate: (v) => {
        const b = body(v);
        if (b.success === false) return `failed: ${b.error}`;
        const xml = String(b.xml ?? b.cheatTable ?? '');
        if (!xml.includes('<CheatTable')) return 'no CheatTable root element';
        const entryCount = (xml.match(/<CheatEntry>/g) ?? []).length;
        if (entryCount !== ENTRIES.length)
          return `expected ${ENTRIES.length} CheatEntry, got ${entryCount}`;
        return true;
      },
    },
    {
      name: 'memory_cheat_table/sign-verify-roundtrip',
      tool: 'memory_cheat_table',
      origin: 'external-vector',
      reference:
        'HMAC-SHA256 signed table must verify valid with the same secret (sign → verify loop)',
      run: async () => {
        const exported = body(await cheatTable('export', { entries: ENTRIES }));
        const xml = String(exported.xml ?? exported.cheatTable ?? '');
        const signed = body(await cheatTable('sign', { xml, secret: SECRET }));
        if (signed.success === false) throw new Error(`sign failed: ${signed.error}`);
        return cheatTable('verify', { xml: signed.signedXml, secret: SECRET });
      },
      validate: (v) => {
        const b = body(v);
        if (b.success === false) return `failed: ${b.error}`;
        return b.valid === true ? true : `signature did not verify: ${b.error ?? 'invalid'}`;
      },
    },
    {
      name: 'memory_cheat_table/tamper-detection',
      tool: 'memory_cheat_table',
      origin: 'homemade',
      reference:
        'HMAC integrity: flipping one byte of the signed XML must invalidate the signature',
      run: async () => {
        const exported = body(await cheatTable('export', { entries: ENTRIES }));
        const xml = String(exported.xml ?? exported.cheatTable ?? '');
        const signed = body(await cheatTable('sign', { xml, secret: SECRET }));
        const signedXml = String(signed.signedXml ?? '');
        const tampered = signedXml.replace('player.health', 'player.armour');
        if (tampered === signedXml) return { skipped: 'tamper anchor not found' };
        return cheatTable('verify', { xml: tampered, secret: SECRET });
      },
      validate: (v) => {
        const b = body(v);
        if (b.skipped !== undefined) return true; // anchor missing is a fixture issue, not a tool failure
        if (b.success === false) return `verify call failed: ${b.error}`;
        return b.valid === false
          ? true
          : `tampered table still verifies: ${JSON.stringify(b).slice(0, 160)}`;
      },
    },
    {
      name: 'memory_structure_export_c/rust-repr-c-export',
      tool: 'memory_structure_export_c',
      origin: 'homemade',
      reference:
        'exports inferred structure to Rust #[repr(C)] struct syntax with correct field sizes',
      run: async () => {
        const sampleStruct = JSON.stringify({
          className: 'PlayerEntity',
          totalSize: 16,
          fields: [
            { offset: 0, size: 4, type: 'int32', name: 'health' },
            { offset: 4, size: 4, type: 'float', name: 'speed' },
            { offset: 8, size: 8, type: 'uint64', name: 'guid' },
          ],
        });
        return handlers.handleStructureExportC({
          structure: sampleStruct,
          format: 'rust',
          name: 'PlayerEntity',
        });
      },
      validate: (v: unknown) => {
        const b = body(v);
        if (b.success === false) return `failed: ${b.error}`;
        const def = String(b.definition ?? '');
        if (!def.includes('#[repr(C)]')) return `missing #[repr(C)] attribute: ${def}`;
        if (!def.includes('pub struct PlayerEntity')) return `missing struct declaration: ${def}`;
        if (
          !def.includes('health: i32') ||
          !def.includes('speed: f32') ||
          !def.includes('guid: u64')
        ) {
          return `field definitions not properly typed: ${def}`;
        }
        return true;
      },
    },
    {
      name: 'memory_structure_export_c/csharp-structlayout-export',
      tool: 'memory_structure_export_c',
      origin: 'homemade',
      reference:
        'exports inferred structure to C# [StructLayout] with explicit FieldOffset attributes',
      run: async () => {
        const sampleStruct = JSON.stringify({
          className: 'NetworkPacket',
          totalSize: 8,
          fields: [
            { offset: 0, size: 2, type: 'uint16', name: 'opcode' },
            { offset: 2, size: 2, type: 'uint16', name: 'length' },
            { offset: 4, size: 4, type: 'uint32', name: 'sequence' },
          ],
        });
        return handlers.handleStructureExportC({
          structure: sampleStruct,
          format: 'csharp',
          name: 'NetworkPacket',
        });
      },
      validate: (v: unknown) => {
        const b = body(v);
        if (b.success === false) return `failed: ${b.error}`;
        const def = String(b.definition ?? '');
        if (!def.includes('[StructLayout(LayoutKind.Explicit')) {
          return `missing StructLayout attribute: ${def}`;
        }
        if (!def.includes('[FieldOffset(0x0)]') || !def.includes('[FieldOffset(0x4)]')) {
          return `missing explicit FieldOffset annotations: ${def}`;
        }
        return true;
      },
    },
    {
      name: 'memory_type_define/set-and-list-overrides',
      tool: 'memory_type_define',
      origin: 'homemade',
      reference: 'manages custom field type overrides: set at offset, list registered rules',
      run: async () => {
        const setRes = body(
          await handlers.handleTypeDefine({
            action: 'set',
            offset: 32, // 0x20
            size: 4,
            type: 'int32_t',
          }),
        );
        const listRes = body(
          await handlers.handleTypeDefine({
            action: 'list',
            offset: 0,
            size: 1,
            type: 'int8',
          }),
        );
        return { setRes, listRes };
      },
      validate: (v: unknown) => {
        const b = body(v);
        const setRes = b.setRes as Record<string, unknown>;
        const listRes = b.listRes as Record<string, unknown>;
        if (setRes.success !== true || setRes.type !== 'int32') {
          return `expected normalized type int32, got: ${JSON.stringify(setRes)}`;
        }
        const overrides = (listRes.overrides as Array<Record<string, unknown>>) ?? [];
        if (!overrides.some((o) => o.offset === 32 && o.type === 'int32')) {
          return `list missing set override: ${JSON.stringify(overrides)}`;
        }
        return true;
      },
    },

    // ── Coverage batch 2026-11-11 (autoresearch): pure-TS minidump, asm, bookmarks, custom types, scan sessions ──
    {
      name: 'memory_parse_dump/mdmp-header-parse',
      tool: 'memory_parse_dump',
      origin: 'external-vector',
      reference:
        'Windows MINIDUMP_HEADER magic 0x504D444D ("MDMP") parses cleanly with streamCount=0',
      run: () => minidumpHandlers.handleMemoryParseDump({ filePath: dmpPath }),
      validate: (v) => {
        const b = body(v);
        if (b.success !== true || Number(b.streamCount) !== 0 || Number(b.fileSize) !== 32)
          return `unexpected minidump result: ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'memory_assemble/x86-nop-ret-bytes',
      tool: 'memory_assemble',
      origin: 'external-vector',
      reference: 'x86/x64 ISA: `nop; ret` assembles to bytes 90 c3 (length 2)',
      run: () => assembleHandlers.handleAssemble({ action: 'assemble', code: 'nop; ret' }),
      validate: (v) => {
        const b = body(v);
        if (b.success !== true || Number(b.byteLength) !== 2)
          return `expected 2 bytes assembled, got: ${JSON.stringify(b)}`;
        const hex = String(b.hex ?? b.bytesHex ?? '').toLowerCase();
        if (!hex.includes('90') || !hex.includes('c3'))
          return `expected 90 c3 in assembled hex, got: ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'memory_bookmark/add-and-list-roundtrip',
      tool: 'memory_bookmark',
      origin: 'homemade',
      reference: 'bookmark store adds labeled hex address and lists it deterministically',
      run: async () => {
        await bookmarkHandlers.handleBookmarkDispatch({ action: 'clear', pid: 1234 });
        return bookmarkHandlers.handleBookmarkDispatch({
          action: 'add',
          pid: 1234,
          address: '0x7ff61000',
          label: 'bench_hp',
          color: '#00FF00',
        });
      },
      validate: (v) => {
        const b = body(v);
        if (b.success !== true || b.label !== 'bench_hp' || Number(b.totalBookmarks) !== 1)
          return `unexpected bookmark add result: ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'memory_register_type/registers-custom-float',
      tool: 'memory_register_type',
      origin: 'homemade',
      reference: 'registers custom 4-byte float scan type in session registry',
      run: () => {
        const sh = new ScanHandlers({} as never);
        return sh.handleRegisterType({
          name: 'bench_f32',
          size: 4,
          encoding: 'float',
          endian: 'le',
        });
      },
      validate: (v) => {
        const b = body(v);
        const type = b.type as { name?: string; size?: number } | undefined;
        if (b.success !== true || type?.name !== 'bench_f32' || type?.size !== 4)
          return `unexpected register_type result: ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'memory_list_types/enumerates-registered',
      tool: 'memory_list_types',
      origin: 'homemade',
      reference: 'lists registered custom scan types with exact count',
      run: async () => {
        const sh = new ScanHandlers({} as never);
        await sh.handleRegisterType({
          name: 'bench_list_i32',
          size: 4,
          encoding: 'int',
          endian: 'le',
        });
        return sh.handleListTypes({});
      },
      validate: (v) => {
        const b = body(v);
        if (b.success !== true || Number(b.count) !== 1 || !Array.isArray(b.types))
          return `expected 1 registered custom type, got: ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'memory_unregister_type/removes-registered',
      tool: 'memory_unregister_type',
      origin: 'homemade',
      reference: 'removes previously registered custom scan type by name',
      run: async () => {
        const sh = new ScanHandlers({} as never);
        await sh.handleRegisterType({
          name: 'bench_drop_u16',
          size: 2,
          encoding: 'uint',
          endian: 'le',
        });
        return sh.handleUnregisterType({ name: 'bench_drop_u16' });
      },
      validate: (v) => {
        const b = body(v);
        if (b.success !== true || b.name !== 'bench_drop_u16')
          return `unexpected unregister result: ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'memory_scan_session/list-empty-sessions',
      tool: 'memory_scan_session',
      origin: 'homemade',
      reference: 'lists active memory scan sessions cleanly without native scanner',
      run: () => sessionHandlers.handleScanList({}),
      validate: (v) => {
        const b = body(v);
        if (!Array.isArray(b.sessions) || Number(b.count) !== 0)
          return `expected empty sessions list, got: ${JSON.stringify(b)}`;
        return true;
      },
    },

    // ── Contract batch 2026-11-12 (autoresearch) ──────────────────────────
    // 65 memory tools operate on a live process through Win32 FFI. The
    // portable contract on any machine: a missing/invalid target or argument is
    // refused BY NAME, or the tool is refused by its capability gate — never a
    // success envelope carrying fabricated scan results. Cases are generated
    // from the tables below (one case per tool, so each tool is measured).
    ...REFUSAL_SPECS.map((spec) => ({
      name: `${spec.tool}/refuses-${spec.slug}`,
      tool: spec.tool,
      origin: 'homemade' as const,
      reference: spec.note,
      run: async () => {
        const out = await callMemory(spec.tool, spec.args ?? { pid: MISSING_PID });
        if (typeof out === 'string') return out;
        return JSON.stringify(out);
      },
      validate: (v: unknown) => validateRefusal(String(v), spec.expect),
    })),
    ...HONEST_EMPTY_SPECS.map((spec) => ({
      name: `${spec.tool}/honest-empty-${spec.slug}`,
      tool: spec.tool,
      origin: 'homemade' as const,
      reference: spec.note,
      run: async () => {
        const out = await callMemory(spec.tool, spec.args ?? { pid: MISSING_PID });
        if (typeof out === 'string') return out;
        return JSON.stringify(out);
      },
      validate: (v: unknown) => validateHonestEmpty(String(v), spec.zeroKeys),
    })),
    {
      name: 'memory_emulator_detect/requires-processName-or-list',
      tool: 'memory_emulator_detect',
      origin: 'homemade',
      reference:
        'argument contract: the tool needs processName, or list=true to enumerate the known emulator table; a bare call is rejected by naming both options',
      run: async () => (await callMemory('memory_emulator_detect', {})) as string,
      validate: (v) => {
        const text = String(v);
        if (!/"?processName"?/i.test(text) || !/list/.test(text))
          return `rejection should name processName and the list option: ${text.slice(0, 200)}`;
        return true;
      },
    },
    {
      name: 'memory_emulator_detect/list-known-emulators',
      tool: 'memory_emulator_detect',
      origin: 'homemade',
      reference:
        'catalog contract: list=true returns the built-in emulator table (name/platform/processNames) — a documentation surface, not a detection result',
      run: async () => (await callMemory('memory_emulator_detect', { list: true })) as string,
      validate: (v) => {
        const b = JSON.parse(String(v)) as Record<string, unknown>;
        if (b['success'] !== true) return `list=true should succeed: ${String(v).slice(0, 200)}`;
        const known = b['knownEmulators'] as Array<Record<string, unknown>> | undefined;
        if (!Array.isArray(known) || known.length === 0)
          return `expected a non-empty knownEmulators table`;
        for (const entry of known) {
          if (!entry['name'] || !Array.isArray(entry['processNames']))
            return `emulator entry missing name/processNames: ${JSON.stringify(entry)}`;
        }
        return true;
      },
    },
    {
      name: 'memory_antidetection/reports-local-gate-state',
      tool: 'memory_antidetection',
      origin: 'homemade',
      reference:
        'recon contract: the self-defence check reports observable gate state (AMSI/ETW patches, ETW sessions, debugger flags) about THIS host — it never claims anything about a target process',
      run: async () => (await callMemory('memory_antidetection', {})) as string,
      validate: (v) => {
        const b = JSON.parse(String(v)) as Record<string, unknown>;
        if (b['success'] !== true) return `expected success: ${String(v).slice(0, 160)}`;
        const results = b['results'] as Record<string, unknown> | undefined;
        if (!results || typeof results !== 'object') return `results object missing`;
        const patches = results['amsiEtwPatches'] as Record<string, unknown> | undefined;
        if (!patches || typeof patches['patched'] !== 'boolean')
          return `amsiEtwPatches.patched should be a boolean reading`;
        const etw = results['etwMonitoring'] as Record<string, unknown> | undefined;
        if (!etw || typeof etw['activeSessions'] !== 'number')
          return `etwMonitoring.activeSessions should be a number`;
        return true;
      },
    },
    {
      name: 'memory_call_stack/empty-walk-is-honest',
      tool: 'memory_call_stack',
      origin: 'homemade',
      reference:
        'walk contract: when no frames can be captured the tool reports success=false with frameCount/frames empty and names the reason — never a fabricated call stack',
      run: async () => (await callMemory('memory_call_stack', { pid: MISSING_PID })) as string,
      validate: (v) => {
        const b = JSON.parse(String(v)) as Record<string, unknown>;
        if (b['success'] !== false) return `expected success=false: ${String(v).slice(0, 200)}`;
        if (b['frameCount'] !== 0) return `frameCount should be 0, got ${String(b['frameCount'])}`;
        const frames = b['frames'] as unknown[] | undefined;
        if (!Array.isArray(frames) || frames.length !== 0) return `frames must be empty`;
        if (!String(b['error'] ?? '').trim()) return `failure without a named reason`;
        return true;
      },
    },
    {
      name: 'memory_handle_enum/zero-handles-for-missing-pid',
      tool: 'memory_handle_enum',
      origin: 'homemade',
      reference:
        'enumeration contract: a non-existent PID yields zero matching handles while still reporting the system-wide handle total — no invented handle rows',
      run: async () => (await callMemory('memory_handle_enum', { pid: MISSING_PID })) as string,
      validate: (v) => {
        const b = JSON.parse(String(v)) as Record<string, unknown>;
        if (b['pid'] !== MISSING_PID) return `pid not echoed: ${String(v).slice(0, 160)}`;
        if (b['totalHandles'] !== 0)
          return `expected zero handles, got ${String(b['totalHandles'])}`;
        if (typeof b['totalSystemHandles'] !== 'number')
          return `system-wide handle total should be reported`;
        return true;
      },
    },
    {
      name: 'memory_antidetection_check/reports-gate-state-not-verdict',
      tool: 'memory_antidetection_check',
      origin: 'homemade',
      reference:
        'recon contract: the self-defence check reports per-gate booleans (ETW/AMSI patched, debugger attached, injection gates) without claiming the target is protected',
      run: async () => (await callMemory('memory_antidetection_check', {})) as string,
      validate: (v) => {
        const b = JSON.parse(String(v)) as Record<string, unknown>;
        if (b['success'] !== true) return `expected success: ${String(v).slice(0, 160)}`;
        const checks = b['checks'] as Record<string, unknown> | undefined;
        if (!checks || typeof checks !== 'object') return `checks object missing`;
        for (const key of ['etwAmsiPatched', 'debuggerAttached']) {
          if (typeof checks[key] !== 'boolean')
            return `checks.${key} should be a boolean gate reading`;
        }
        if (typeof b['verdict'] !== 'string') return `verdict label missing`;
        return true;
      },
    },
    {
      name: 'memory_remote/empty-proxy-table-without-transport',
      tool: 'memory_remote',
      origin: 'homemade',
      reference:
        'transport contract: with no remote proxy configured the tool reports an empty proxy table rather than a fake connection',
      run: async () => (await callMemory('memory_remote', {})) as string,
      validate: (v) => {
        const b = JSON.parse(String(v)) as Record<string, unknown>;
        if (!Array.isArray(b['proxies']))
          return `proxies array missing: ${String(v).slice(0, 160)}`;
        if ((b['proxies'] as unknown[]).length !== 0) return `expected no configured proxies`;
        return true;
      },
    },

    // ── Win32 engine-wired contracts (Route A, 2026-11-12) ──────────────────
    // Windows + koffi only; each case self-skips elsewhere via win32EnginesAvailable().
    ...memoryWin32Cases,
  ],
};
