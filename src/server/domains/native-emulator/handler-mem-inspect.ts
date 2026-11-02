/**
 * nemu_mem_inspect — single-tool convergence pilot for the guest-memory
 * inspection family (CyberStrike linuxhook-style "one tool, subcommand routing").
 *
 * Wraps five read-only memory tools behind one `action`-discriminated union:
 *   read  → nemu_read_memory     (raw bytes, base64 preview/data)
 *   dump  → nemu_data_dump       (u32/u64 table with auto-classification)
 *   chain → nemu_pointer_chain   (follow pointer indirection hops)
 *   frame → nemu_dump_frame      (decode a CreateLitevm frame structure)
 *   scan  → nemu_scan_memory     (byte-pattern search over an address range)
 *
 * Each variant declares exactly the wrapped tool's parameters — same names,
 * same types, same optionality — and the handler delegates to the existing
 * handler method unchanged. The wrapped tools remain registered and are the
 * source of truth for defaults and behavior; nothing is re-implemented here.
 *
 * The flat MCP inputSchema (see definitions.ts) merges all subcommand params,
 * so per-subcommand requiredness is enforced HERE by the discriminated union —
 * that is the schema-cost win this pilot measures.
 */
import { z } from 'zod';

/** Subcommand discriminants, in union order. Mirrored by the tool's `action` enum. */
export const MEM_INSPECT_ACTIONS = ['read', 'dump', 'chain', 'frame', 'scan'] as const;

export type MemInspectAction = (typeof MEM_INSPECT_ACTIONS)[number];

/** action='read' → nemu_read_memory */
const MemInspectReadSchema = z.object({
  action: z.literal('read'),
  sessionId: z.string(),
  address: z.number(),
  length: z.number(),
  previewBytes: z.number().optional(),
  maxBytes: z.number().optional(),
  includeDataBase64: z.boolean().optional(),
});

/** action='dump' → nemu_data_dump */
const MemInspectDumpSchema = z.object({
  action: z.literal('dump'),
  sessionId: z.string(),
  address: z.number(),
  count: z.number().optional(),
  wordSize: z.enum(['u32', 'u64']).optional(),
  columns: z.number().optional(),
});

/** action='chain' → nemu_pointer_chain */
const MemInspectChainSchema = z.object({
  action: z.literal('chain'),
  sessionId: z.string(),
  base: z.number(),
  maxDepth: z.number().optional(),
  offset: z.number().optional(),
  dataLen: z.number().optional(),
});

/** action='frame' → nemu_dump_frame */
const MemInspectFrameSchema = z.object({
  action: z.literal('frame'),
  sessionId: z.string(),
  address: z.number(),
});

/** action='scan' → nemu_scan_memory */
const MemInspectScanSchema = z.object({
  action: z.literal('scan'),
  sessionId: z.string(),
  pattern: z.string(),
  startAddr: z.number(),
  endAddr: z.number(),
  maxResults: z.number().optional(),
});

/** Discriminated union on `action` — the routing/validation authority for nemu_mem_inspect. */
export const memInspectSchema = z.discriminatedUnion('action', [
  MemInspectReadSchema,
  MemInspectDumpSchema,
  MemInspectChainSchema,
  MemInspectFrameSchema,
  MemInspectScanSchema,
]);

export type MemInspectArgs = z.output<typeof memInspectSchema>;

/** Flatten a ZodError into a single-line `path: message; …` string. */
export function formatMemInspectIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}
