/**
 * TLS keylog / tls-inspector configuration.
 * Prefixes: TLS_*
 */

import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { str } from './helpers.js';

/**
 * Best-effort current-user token for the keylog filename. Deliberately avoids
 * environment reads because the constants layer must not read the environment
 * directly; falls back to the OS user record when no numeric uid exists.
 */
function resolveKeylogUser(): string {
  try {
    const uid = process.getuid?.();
    if (uid !== undefined) return String(uid);
  } catch {
    // No numeric uid (Windows) or the call failed — try the OS user record.
  }

  try {
    return userInfo().username || 'user';
  } catch {
    return 'user';
  }
}

/**
 * Per-user, per-process filename so the default keylog path is neither a
 * predictable shared `/tmp` name (symlink/pre-creation) nor a cross-process
 * collision. The TLS stack writes the file; operators who need a specific
 * location (or a locked-down mode) should set JSHOOK_TLS_KEYLOG_PATH.
 */
const KEYLOG_USER = resolveKeylogUser().replace(/[^a-zA-Z0-9._-]/g, '_');

/** Default path for SSLKEYLOGFILE output. Override via JSHOOK_TLS_KEYLOG_PATH. */
export const TLS_KEYLOG_PATH = str(
  'JSHOOK_TLS_KEYLOG_PATH',
  join(tmpdir(), `jshook-sslkeylog-${KEYLOG_USER}-${process.pid}.log`),
);
