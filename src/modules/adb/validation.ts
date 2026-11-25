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
 */
const ANDROID_PACKAGE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*$/;

/**
 * Device serials: USB serials (`c3c3ff6b`), emulator names
 * (`emulator-5554`) and network targets (`192.168.1.5:5555`). Mirrors the
 * historical `removeForward` guard.
 */
const DEVICE_SERIAL_PATTERN = /^[A-Za-z0-9._:@-]+$/;

export function isValidAndroidPackageName(value: string): boolean {
  return ANDROID_PACKAGE_NAME_PATTERN.test(value);
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
