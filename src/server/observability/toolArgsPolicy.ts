/**
 * Tool-arguments capture policy for `tool.execute` spans.
 *
 * Tool arguments are the MOST sensitive telemetry surface in jshookmcp: a
 * reverse-engineering toolset receives target URLs, auth headers, memory
 * dumps and captured payloads as ordinary arguments. The default (`shape`)
 * captures ONLY the argument key names — which keys users actually pass (vs.
 * leave defaulted) is the product insight that drives schema and default
 * improvements, and key names are already public knowledge in the tool
 * schemas. Argument VALUES require an explicit opt-in and are still scrubbed
 * (credential-ish keys are masked, everything is size-capped) because a
 * telemetry pipeline is never a data-exfiltration channel.
 *
 * Mirrors queryTextPolicy: process-global, installed once at server startup,
 * safe default for any process that never installs it (tuning workers, tests).
 */

export type ToolArgsPolicy = 'off' | 'shape' | 'truncated' | 'full';

const DEFAULT_POLICY: ToolArgsPolicy = 'shape';
const VALUE_TRUNCATION = 32;
const TRUNCATED_TOTAL_LIMIT = 512;
const FULL_TOTAL_LIMIT = 4096;

/** Keys whose VALUES are masked in every value-capturing mode. */
const CREDENTIAL_KEY_PATTERN =
  /(auth|cookie|token|secret|password|passwd|credential|api[_-]?key|private[_-]?key|jwt|session)/i;

let globalPolicy: ToolArgsPolicy = DEFAULT_POLICY;

/** Install the process-wide policy. Invalid values fall back to `shape`. */
export function setGlobalToolArgsPolicy(policy: ToolArgsPolicy | undefined): void {
  globalPolicy =
    policy === 'off' || policy === 'shape' || policy === 'truncated' || policy === 'full'
      ? policy
      : DEFAULT_POLICY;
}

/** Test seam: restore the shipped default. */
export function resetGlobalToolArgsPolicy(): void {
  globalPolicy = DEFAULT_POLICY;
}

export function getGlobalToolArgsPolicy(): ToolArgsPolicy {
  return globalPolicy;
}

/**
 * Render the span attributes for a tool call's arguments under the policy.
 * Returns `{}` for `off` and for non-object args (defensive: callers pass
 * JSON-parsed tool input, but telemetry must never throw on odd shapes).
 */
export function renderToolArgsAttrs(
  args: unknown,
  policy: ToolArgsPolicy = globalPolicy,
): Record<string, unknown> {
  if (policy === 'off') return {};
  if (!args || typeof args !== 'object' || Array.isArray(args)) return {};

  const keys = Object.keys(args).toSorted();
  // Key names are public (they come from the shipped tool schemas), so the
  // shape itself is always safe to report alongside the keys.
  if (policy === 'shape') {
    return keys.length > 0 ? { 'tool.args_keys': JSON.stringify(keys) } : {};
  }

  const limit = policy === 'truncated' ? TRUNCATED_TOTAL_LIMIT : FULL_TOTAL_LIMIT;
  const rendered: Record<string, unknown> = {};
  for (const key of keys) {
    rendered[key] = renderValue(key, (args as Record<string, unknown>)[key], policy);
  }
  let serialized = JSON.stringify(rendered);
  if (serialized.length > limit) {
    serialized = `${serialized.slice(0, limit)}…(+${serialized.length - limit})`;
  }
  return {
    'tool.args_keys': JSON.stringify(keys),
    'tool.args': serialized,
  };
}

function renderValue(key: string, value: unknown, policy: ToolArgsPolicy): unknown {
  if (CREDENTIAL_KEY_PATTERN.test(key)) return '***';
  if (value === null || value === undefined) return value;
  const primitive =
    typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
  if (primitive) {
    const text = String(value);
    if (policy === 'truncated' && text.length > VALUE_TRUNCATION) {
      return `${text.slice(0, VALUE_TRUNCATION)}…(+${text.length - VALUE_TRUNCATION})`;
    }
    return value;
  }
  // Objects/arrays: redact credential-ish keys at every depth (secrets most
  // often live nested — `headers.authorization`, `options.password`, ...),
  // stringify once, then truncate the whole rendering at the caller level.
  try {
    const text = JSON.stringify(redactNestedCredentialKeys(value)) ?? String(value);
    if (policy === 'truncated' && text.length > VALUE_TRUNCATION) {
      return `${text.slice(0, VALUE_TRUNCATION)}…(+${text.length - VALUE_TRUNCATION})`;
    }
    return text;
  } catch {
    return String(value);
  }
}

/**
 * Recursively mask values whose key looks credential-ish. The top-level
 * `renderValue` check cannot see nested keys, so without this a
 * `{ headers: { authorization } }` payload ships its token verbatim.
 * Cycle-safe so a captured object graph cannot blow the stack.
 */
function redactNestedCredentialKeys(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => redactNestedCredentialKeys(item, seen));
  }
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    out[key] = CREDENTIAL_KEY_PATTERN.test(key) ? '***' : redactNestedCredentialKeys(nested, seen);
  }
  return out;
}
