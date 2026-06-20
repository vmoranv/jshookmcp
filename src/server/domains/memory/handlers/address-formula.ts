/**
 * Address formula parser (ReClass.NET AddressParser pattern).
 *
 * Supports human-friendly address expressions so users don't need to
 * manually compute `base + offset` in their heads:
 *   - Pure hex:  `0x7FF612340000`, `7FF612340000`
 *   - Arithmetic: `0x7FF612340000 + 0x20`, `0x... + 256`, `0x... - 0x10 + 0x4`
 *   - Module reference: `<Module.exe> + 0x10` — reports a readable error
 *     (module base lookup requires the process domain; replace `<Module.exe>`
 *     with the actual base from `memory_pe_headers` or a memory dump).
 *
 * Values are always returned as `0x...` hex strings. Offsets may be hex
 * (`0x20`) or decimal (`256`). Expression order is strictly left-to-right
 * (no operator precedence — both `+` and `-` have equal precedence for
 * address arithmetic, which is what users intuitively expect).
 */

const HEX_RE = /^(0x)?[0-9a-fA-F]+$/;
const HEX_VALUE_RE = /^0x[0-9a-fA-F]+$/;
const DEC_VALUE_RE = /^[0-9]+$/;
const MODULE_REF_RE = /^<([^>]+)>$/;

/**
 * Parse result returned by `parseAddressFormula`.
 *
 * On success, `address` is a `0x...` hex string. On unsupported input
 * (module references, syntax errors) `error` is a human-readable message
 * and `address` is `null`.
 */
export interface AddressFormulaResult {
  address: string | null;
  error: string | null;
}

/**
 * Parse an address formula into an absolute hex address.
 *
 * Pure hex is returned as-is (or with `0x` prepended). Arithmetic
 * expressions are evaluated left-to-right. Module references are not
 * resolved (they need a live process) and produce an error.
 */
export function parseAddressFormula(input: string): AddressFormulaResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { address: null, error: 'address formula is empty' };
  }

  // Pure hex — pass through.
  if (HEX_RE.test(trimmed)) {
    return { address: trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`, error: null };
  }

  // Tokenise: [base] [[+-] amount] [[+-] amount] ...
  // Base can be hex, decimal, or a module reference.
  let cursor = 0;
  const tokens: Array<
    { kind: 'base'; value: string } | { kind: 'op'; op: '+' | '-'; value: string }
  > = [];

  // Consume base token (hex, decimal, or <Module>)
  const baseRaw = consumeToken(trimmed, cursor);
  if (!baseRaw) {
    return { address: null, error: `cannot parse address base from: "${trimmed}"` };
  }
  tokens.push({ kind: 'base', value: baseRaw.token });
  cursor = baseRaw.end;

  // Consume [+-] offset pairs
  while (cursor < trimmed.length) {
    const ws = skipWhitespace(trimmed, cursor);
    cursor = ws;
    if (cursor >= trimmed.length) break;

    const sign = trimmed[cursor];
    if (sign !== '+' && sign !== '-') {
      return { address: null, error: `expected '+' or '-' at position ${cursor}, got "${sign}"` };
    }
    cursor = skipWhitespace(trimmed, cursor + 1);

    const tok = consumeToken(trimmed, cursor);
    if (!tok) {
      return { address: null, error: `expected number at position ${cursor}` };
    }
    tokens.push({ kind: 'op', op: sign as '+' | '-', value: tok.token });
    cursor = tok.end;
  }

  // Evaluate
  // Step 1: resolve base
  const base = tokens[0]!;
  let current = resolveBigInt(base.value);
  if (typeof current === 'string') {
    return { address: null, error: current };
  }

  // Step 2: apply operations left-to-right
  for (let i = 1; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (tok.kind !== 'op') continue;
    const num = resolveBigInt(tok.value);
    if (typeof num === 'string') {
      return { address: null, error: num };
    }
    if (tok.op === '+') {
      current = current + num;
    } else {
      current = current - num;
    }
  }

  // Safety: don't let the address go negative or beyond 64-bit.
  if (current < 0n) {
    return {
      address: null,
      error: `address formula resolves to negative value: ${trimmed}`,
    };
  }

  return { address: `0x${current.toString(16)}`, error: null };
}

// ── Internal helpers ───────────────────────────────

function skipWhitespace(s: string, start: number): number {
  let i = start;
  while (i < s.length && (s[i] === ' ' || s[i] === '\t')) i++;
  return i;
}

function consumeToken(s: string, start: number): { token: string; end: number } | null {
  const i = skipWhitespace(s, start);
  if (i >= s.length) return null;

  // Module reference: <ModuleName>
  if (s[i] === '<') {
    let j = i + 1;
    while (j < s.length && s[j] !== '>') j++;
    if (j < s.length) j++; // consume '>'
    return { token: s.slice(i, j), end: j };
  }

  // Hex or decimal number
  let j = i;
  if (s[j] === '0' && (s[j + 1] === 'x' || s[j + 1] === 'X')) {
    j += 2;
    while (j < s.length && isHexChar(s[j]!)) j++;
  } else {
    while (j < s.length && isDigit(s[j]!)) j++;
  }
  if (j === i) {
    // Maybe a bare hex without prefix (e.g. "7FF612340000")
    // Only accept bare hex if it follows + or -, or is the first token
    while (j < s.length && isHexChar(s[j]!)) j++;
  }
  if (j === i) return null;
  return { token: s.slice(i, j), end: j };
}

function isHexChar(ch: string): boolean {
  return (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F');
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

/**
 * Resolve a token value to a BigInt.
 *
 * Returns an error string on module references or parse failures.
 */
function resolveBigInt(token: string): bigint | string {
  // Module reference — we can't resolve without a live process.
  if (MODULE_REF_RE.test(token)) {
    const moduleName = token.slice(1, -1);
    return `module reference "${moduleName}" cannot be resolved without a live process. Replace "<${moduleName}>" with the actual base address (e.g. from memory_pe_headers or memory_dump).`;
  }

  // Hex
  if (HEX_VALUE_RE.test(token)) {
    return BigInt(token);
  }
  // Bare hex without 0x: only accept when it contains hex digits a-f
  // (otherwise ambiguous with decimal). "7FF612340000" has 'f' → hex.
  if (/^[0-9a-fA-F]+$/.test(token) && /[a-fA-F]/.test(token)) {
    return BigInt(`0x${token}`);
  }

  // Decimal
  if (DEC_VALUE_RE.test(token)) {
    return BigInt(token);
  }

  return `cannot parse numeric value: "${token}"`;
}
