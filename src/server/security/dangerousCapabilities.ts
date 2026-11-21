/**
 * Operator gate for capabilities that turn an MCP client into native code
 * execution on the host.
 *
 * Profile tiers (search ⊂ workflow ⊂ full) are a token-budget mechanism, not an
 * authorization boundary: any client can activate a domain at runtime. These
 * three families therefore need an explicit, server-side opt-in that no tool
 * argument and no activation call can flip.
 *
 * Default: disabled. A denied call is a Tool Execution Error (`isError: true`)
 * carrying `code: PERMISSION` and the remediation the operator needs.
 */
import { readEnvBoolean } from '@src/config/environment';

export const ALLOW_DANGEROUS_CAPABILITIES_ENV = 'JSHOOK_ALLOW_DANGEROUS_CAPABILITIES';

export type DangerousCapability = 'arbitrary-js' | 'remote-code' | 'process-injection';

interface CapabilityRule {
  readonly capability: DangerousCapability;
  readonly tool: RegExp;
  readonly why: string;
}

const RULES: readonly CapabilityRule[] = [
  {
    capability: 'arbitrary-js',
    tool: /^nemu_(?:bind_host_fn|bind_all_imports|set_vtable_slot)$/,
    why: 'evaluates caller-supplied JavaScript inside the server process',
  },
  {
    capability: 'remote-code',
    tool: /^extension_(?:install|reload)$/,
    why: 'imports extension code supplied by the caller (URL or path)',
  },
  {
    capability: 'process-injection',
    tool: /^inject_(?:dll|shellcode)$/,
    why: 'writes executable code into another process',
  },
];

/** Classify a tool name, or null when it does not need the opt-in. */
export function classifyDangerousCapability(toolName: string): DangerousCapability | null {
  for (const rule of RULES) {
    if (rule.tool.test(toolName)) return rule.capability;
  }
  return null;
}

/** Whether the operator enabled host-level capabilities for this process. */
export function areDangerousCapabilitiesAllowed(): boolean {
  return readEnvBoolean(ALLOW_DANGEROUS_CAPABILITIES_ENV, false);
}

/** Deny response for a gated tool: a tool execution error, not a protocol fault. */
export function buildDangerousCapabilityDenyResponse(
  toolName: string,
  capability: DangerousCapability,
): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  const rule = RULES.find((candidate) => candidate.capability === capability);
  const payload = {
    success: false,
    code: 'PERMISSION',
    capability,
    error:
      `Tool '${toolName}' is disabled: it ${rule?.why ?? 'has host-level side effects'}, ` +
      'and dangerous capabilities are opt-in.',
    remediation: `Set ${ALLOW_DANGEROUS_CAPABILITIES_ENV}=1 for this server process and restart.`,
  };
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    isError: true,
  };
}
