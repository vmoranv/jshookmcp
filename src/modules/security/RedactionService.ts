const REDACTED = '[REDACTED]';

const SENSITIVE_KEYS =
  /^(auth(orization)?|cookie|set[_-]?cookie|x[_-]?api[_-]?key|token|access[_-]?token|refresh[_-]?token|id[_-]?token|secret|client[_-]?secret|password|passwd|api[_-]?key|private[_-]?key|credentials?|session[_-]?id|csrf[_-]?token)$/i;

const SENSITIVE_VALUE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi,
  /\beyJ[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]+){0,2}\b/g,
  /\bsk[_-][A-Za-z0-9]{20,}\b/g,
  /\b[A-Fa-f0-9]{32,}\b/g,
] as const;

function isSensitiveKey(key: string): boolean {
  return key.length > 0 && SENSITIVE_KEYS.test(key);
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
