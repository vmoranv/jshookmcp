import type { Tool } from '@modelcontextprotocol/server';
import { objectTool } from './support';

/**
 * Frida runtime keylog honest boundary.
 *
 * The Frida-based TLS keylog extraction path relies on runtime symbol resolution
 * that is inherently version-specific:
 *
 * - Symbol names (e.g. ssl_log_secret, SSL_CTX_set_keylog_callback) vary across
 *   TLS library versions and build configurations. Detection uses
 *   Module.findExportByName pattern-based probing over all loaded modules; a
 *   symbol present in one build may be absent or renamed in the next.
 *
 * - CI cannot verify Frida-based keylog capture — it requires a live target
 *   process with a real TLS stack and a running frida-server. The CI test suite
 *   exercises the handler logic (parse/mock/export) but not the live Frida
 *   attach + keylog extraction path.
 *
 * - When symbols are not found, the probe reports failure honestly (no hollow
 *   capture; lesson #51). The caller should fall back to SSLKEYLOGFILE
 *   environment variable capture (tls_keylog_enable) for passive keylog
 *   collection.
 *
 * See research/honest-boundaries-boringssl.md for the full bound.
 */
export const fridaTools: Tool[] = [
  objectTool(
    'tls_cert_pin_bypass_frida',
    'Bypass certificate pinning via Frida injection (supports the target TLS library and HTTP client frameworks).',
  ),
];
