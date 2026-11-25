/**
 * Shared input guards for the ADB module.
 *
 * Device-side commands are built as shell strings for `adb shell` / adbkit
 * `shell()`, so any caller-controlled value that ends up in such a string must
 * be constrained to an allow-list rather than quoted: adbkit's array joining is
 * documented as convenience escaping, not security escaping.
 */

import { ToolError } from '@errors/ToolError';

/**
 * Android package names are dot-separated Java identifiers. `pm`/`dumpsys`
 * reject anything else, and the allow-list also removes every shell
 * metacharacter (`;`, `$()`, backticks, quotes, spaces, path separators).
 *
 * Implemented as a character walk instead of a repeated-group regex: the
 * pattern is linear, but a regex-shaped allow-list is easy to misread as a
 * ReDoS risk and hard to audit.
 */
function isAsciiLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}
function isPackageChar(code: number): boolean {
  return isAsciiLetter(code) || (code >= 48 && code <= 57) || code === 95;
}
function isValidPackageSegment(segment: string): boolean {
  if (segment.length === 0 || !isAsciiLetter(segment.charCodeAt(0))) return false;
  for (let i = 1; i < segment.length; i++) {
    if (!isPackageChar(segment.charCodeAt(i))) return false;
  }
  return true;
}

/**
 * Device serials: USB serials (`c3c3ff6b`), emulator names
 * (`emulator-5554`) and network targets (`192.168.1.5:5555`). Mirrors the
 * historical `removeForward` guard.
 */
const DEVICE_SERIAL_PATTERN = /^[A-Za-z0-9._:@-]+$/;

export function isValidAndroidPackageName(value: string): boolean {
  if (value.length === 0 || value.length > 255) return false;
  return value.split('.').every(isValidPackageSegment);
}

function isValidDeviceSerial(value: string): boolean {
  return value.length > 0 && DEVICE_SERIAL_PATTERN.test(value);
}

export function assertValidAndroidPackageName(value: string): void {
  if (!isValidAndroidPackageName(value)) {
    throw new ToolError('VALIDATION', `Invalid Android package name: ${value}`, {
      toolName: 'adb',
    });
  }
}

export function assertValidDeviceSerial(value: string): void {
  if (!isValidDeviceSerial(value)) {
    throw new ToolError('VALIDATION', `Invalid device serial format: ${value}`, {
      toolName: 'adb',
    });
  }
}
