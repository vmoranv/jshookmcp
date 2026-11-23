/**
 * Redaction helpers shared by logging, diagnostics, and tool output.
 *
 * This module lives in `utils` because it is a dependency leaf: both the
 * logger and the module layer need it, and leaving it under `modules/security`
 * made `utils/logger` depend upward on `modules` (a layer inversion that
 * amplified every redaction change across the logger's 244 direct consumers).
 */

const REDACTED = '[REDACTED]';

const SENSITIVE_KEYS =
  /^(auth(orization)?|cookie|set[_-]?cookie|x[_-]?api[_-]?key|token|access[_-]?token|refresh[_-]?token|id[_-]?token|secret|client[_-]?secret|password|passwd|api[_-]?key|private[_-]?key|credentials?|session[_-]?id|csrf[_-]?token)$/i;

/**
 * Sensitive words for compound key names (`userPassword`, `authToken`,
 * `dbSecret`, `x-auth-token`, `passwordHash`). Keys are split on separators
 * and camelCase boundaries before comparing whole words, so benign aggregates
 * such as `maxTokens` (parts: `max`, `tokens`) are not redacted.
 */
const SENSITIVE_KEY_WORDS: ReadonlySet<string> = new Set([
  'auth',
  'authorization',
  'apikey',
  'privatekey',
  'cookie',
  'token',
  'secret',
  'password',
  'passwd',
  'credential',
  'credentials',
  'sessionid',
  'csrftoken',
]);

const SENSITIVE_VALUE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi,
  /\beyJ[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]+){0,2}\b/g,
  // Provider keys with an extra environment segment: sk_live_…, sk_test_…,
  // sk-proj-… (the old pattern stopped at the second separator).
  /\bsk[_-](?:(?:live|test|proj)[_-])?[A-Za-z0-9_-]{20,}\b/g,
  /\b[A-Fa-f0-9]{32,}\b/g,
] as const;

function splitKeyWords(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.toLowerCase());
}

function isSensitiveKey(key: string): boolean {
  if (key.length === 0) return false;
  if (SENSITIVE_KEYS.test(key)) return true;
  return splitKeyWords(key).some((word) => SENSITIVE_KEY_WORDS.has(word));
}

export function redactSensitiveString(value: string): string {
  let redacted = value;
  for (const pattern of SENSITIVE_VALUE_PATTERNS) {
    pattern.lastIndex = 0;
    redacted = redacted.replace(pattern, REDACTED);
  }
  return redacted;
}

export function sensitiveJsonReplacer(key: string, value: unknown): unknown {
  if (isSensitiveKey(key)) return REDACTED;
  if (typeof value === 'string') return redactSensitiveString(value);
  return value;
}

export function redactSensitiveData(value: unknown): unknown {
  return redactRecursive(value, '', new WeakSet<object>());
}

function redactRecursive(value: unknown, key: string, seen: WeakSet<object>): unknown {
  if (isSensitiveKey(key)) return REDACTED;
  if (typeof value === 'string') return redactSensitiveString(value);
  if (value === null || typeof value !== 'object') return value;

  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    const redacted = value.map((item) => redactRecursive(item, '', seen));
    seen.delete(value);
    return redacted;
  }

  const redacted: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    redacted[childKey] = redactRecursive(childValue, childKey, seen);
  }
  seen.delete(value);
  return redacted;
}
