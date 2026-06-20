/**
 * Shared input-validation helpers for the memory domain handlers.
 *
 * These helpers throw `Error` with tool/field context on invalid input. Because
 * every memory handler is wrapped in `handleSafe`, thrown errors surface as
 * `{ success: false, error: "<message>" }` ToolResponses — no reflexive
 * try/catch needed at call sites.
 *
 * Design notes:
 * - Hex addresses accept both `0x...` and bare hex (native layer prepends `0x`).
 * - Byte arrays accept `number[]` with each element an integer in [0, 255].
 * - "Required" helpers throw a contextual message naming the tool + field.
 */

const HEX_ADDRESS_RE = /^(0x)?[0-9a-fA-F]+$/;

/**
 * Validate that `value` is a hex address string (e.g. "0x7FF612340000", "7FF6", "0x1234AB").
 * Throws `${fieldName} must be a hex address (e.g. "0x7FF612340000"), got: "<value>"` otherwise.
 */
export function validateHexAddress(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.length === 0 || !HEX_ADDRESS_RE.test(value)) {
    throw new Error(
      `${fieldName} must be a hex address (e.g. "0x7FF612340000"), got: ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/**
 * Validate that `value` is a non-empty array of integers in the byte range [0, 255].
 * Throws `${fieldName} must be an array of bytes (0-255), got invalid element at index N` on violation.
 */
export function validateBytesArray(value: unknown, fieldName: string): number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(
      `${fieldName} must be a non-empty array of bytes (0-255), got: ${JSON.stringify(value)}`,
    );
  }
  for (let i = 0; i < value.length; i += 1) {
    const el = value[i];
    if (typeof el !== 'number' || !Number.isInteger(el) || el < 0 || el > 255) {
      throw new Error(
        `${fieldName} must be an array of bytes (0-255), got invalid element at index ${i}: ${JSON.stringify(el)}`,
      );
    }
  }
  return value as number[];
}

/**
 * Require a non-empty string argument. Throws
 * `${toolName}: missing or invalid required argument "${fieldName}" (expected non-empty string)` on violation.
 */
export function requireStringArg(value: unknown, fieldName: string, toolName: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(
      `${toolName}: missing or invalid required argument "${fieldName}" (expected non-empty string), got: ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/**
 * Require a positive finite number argument. Throws
 * `${toolName}: missing or invalid required argument "${fieldName}" (expected positive number)` on violation.
 */
export function requirePositiveNumberArg(
  value: unknown,
  fieldName: string,
  toolName: string,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(
      `${toolName}: missing or invalid required argument "${fieldName}" (expected positive number), got: ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/**
 * Require a positive integer argument (e.g. counts, sizes in bytes). Throws
 * `${toolName}: missing or invalid required argument "${fieldName}" (expected positive integer)` on violation.
 */
export function requirePositiveIntArg(value: unknown, fieldName: string, toolName: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(
      `${toolName}: missing or invalid required argument "${fieldName}" (expected positive integer), got: ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/**
 * Parse a JSON string argument with contextual error wrapping.
 * Throws `${toolName}: argument "${fieldName}" must be valid JSON — <parseError>` on failure.
 */
export function parseJsonArg<T = unknown>(value: unknown, fieldName: string, toolName: string): T {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(
      `${toolName}: missing or invalid required argument "${fieldName}" (expected JSON string), got: ${JSON.stringify(value)}`,
    );
  }
  try {
    return JSON.parse(value) as T;
  } catch (e) {
    throw new Error(
      `${toolName}: argument "${fieldName}" must be valid JSON — ${e instanceof Error ? e.message : String(e)}`,
      { cause: e },
    );
  }
}
