/**
 * Chromium Mojo IPC symbol database.
 *
 * Curated map of known MojoWriteMessage / MojoWriteMessageNew / mojo
 * core exports across Chromium versions and platforms.
 *
 * Each entry records the symbol name, the module it was observed in,
 * and the Chromium version range where it is expected.
 *
 * This is best-effort — Chromium builds vary by compiler flags, channel,
 * and platform. Always verify against the live binary with mojo_verify_live.
 *
 * HONEST BOUNDARY (B-class): this DB is manually curated from open-source
 * Chromium sources and community reports. It is NOT auto-synced with
 * Chromium releases. New major versions may introduce or rename symbols.
 * Set verified: false until confirmed on the target binary.
 */

export interface ChromiumSymbolEntry {
  /** Export name (e.g. "MojoWriteMessage", "MojoWriteMessageNew"). */
  symbol: string;
  /** Module name where the export was observed. */
  module: string;
  /** Platform: win32, linux, darwin. */
  platform: 'win32' | 'linux' | 'darwin';
  /** Chromium version range where this symbol was confirmed. */
  versionMin?: number;
  /** Maximum version (inclusive) where confirmed, or undefined = current. */
  versionMax?: number;
  /** Channel where observed: stable, beta, dev, canary. */
  channel?: string;
  /** Notes about the symbol (e.g. "x64-only", "debug builds only"). */
  notes?: string;
}

export interface VerifyLiveInput {
  /** Platform of the target. */
  platform: 'win32' | 'linux' | 'darwin';
  /** Chromium major version (e.g. 120). */
  chromiumVersion?: number;
  /** Channel of the target browser. */
  channel?: string;
  /** Specific browser process name to target (e.g. "chrome.exe", "chrome"). */
  targetProcess?: string;
}

export interface VerifyLiveResult {
  /** Generated Frida script that probes the target for known Mojo symbols. */
  fridaScript: string;
  /** Command to run the script. */
  runCommand: string;
  /** Symbols the script will probe for (with metadata). */
  probedSymbols: ChromiumSymbolEntry[];
  /** Number of unique modules to probe. */
  moduleCount: number;
  /** Verification state. */
  verified: false;
  /** Honest capability note. */
  note: string;
}

// ── Curated symbol database ──

const SYMBOL_DB: ChromiumSymbolEntry[] = [
  // Chrome / Chromium on Windows
  {
    symbol: 'MojoWriteMessage',
    module: 'chrome.dll',
    platform: 'win32',
    versionMin: 96,
    versionMax: 120,
    channel: 'stable',
    notes: 'Primary Mojo C API export in chrome.dll. Renamed to MojoWriteMessageNew in ≥ M121.',
  },
  {
    symbol: 'MojoWriteMessageNew',
    module: 'chrome.dll',
    platform: 'win32',
    versionMin: 121,
    channel: 'stable',
    notes: 'Replacement for MojoWriteMessage in Chromium ≥ M121.',
  },
  {
    symbol: 'MojoGetTimeTicksNow',
    module: 'chrome.dll',
    platform: 'win32',
    versionMin: 96,
    channel: 'stable',
    notes: 'Mojo core API — present alongside the write function.',
  },
  // Chrome / Chromium on Linux
  {
    symbol: 'MojoWriteMessage',
    module: 'chrome',
    platform: 'linux',
    versionMin: 96,
    versionMax: 120,
    channel: 'stable',
    notes: 'Exported from the main chrome ELF binary.',
  },
  {
    symbol: 'MojoWriteMessageNew',
    module: 'chrome',
    platform: 'linux',
    versionMin: 121,
    channel: 'stable',
    notes: 'Replacement in ≥ M121.',
  },
  {
    symbol: 'MojoWriteMessage',
    module: 'libcontent.so',
    platform: 'linux',
    versionMin: 96,
    channel: 'stable',
    notes: 'Alternative location in content shared library (component builds).',
  },
  // Chrome / Chromium on macOS
  {
    symbol: '_MojoWriteMessage',
    module: 'Chromium Framework',
    platform: 'darwin',
    versionMin: 96,
    versionMax: 120,
    channel: 'stable',
    notes: 'macOS Mach-O uses underscore-prefixed C symbols.',
  },
  {
    symbol: '_MojoWriteMessageNew',
    module: 'Chromium Framework',
    platform: 'darwin',
    versionMin: 121,
    channel: 'stable',
    notes: 'Replacement in ≥ M121 with underscore prefix.',
  },
  // Electron on Windows (bundles content and chrome into electron.exe / electron.dll)
  {
    symbol: 'MojoWriteMessage',
    module: 'electron.exe',
    platform: 'win32',
    versionMin: 22,
    versionMax: 28,
    notes: 'Electron 22-28 bundles MojoWriteMessage in electron.exe static build.',
  },
  {
    symbol: 'MojoWriteMessageNew',
    module: 'electron.exe',
    platform: 'win32',
    versionMin: 29,
    notes: 'Electron ≥ 29 uses the newer symbol.',
  },
  // Edge (Chromium-based) on Windows
  {
    symbol: 'MojoWriteMessage',
    module: 'msedge.dll',
    platform: 'win32',
    versionMin: 96,
    versionMax: 120,
    notes: 'Edge browser uses msedge.dll.',
  },
  {
    symbol: 'MojoWriteMessageNew',
    module: 'msedge.dll',
    platform: 'win32',
    versionMin: 121,
    notes: 'Edge ≥ M121.',
  },
  // Brave Browser
  {
    symbol: 'MojoWriteMessage',
    module: 'brave.exe',
    platform: 'win32',
    versionMin: 1,
    notes: 'Brave (Chromium-based) main process.',
  },
  // Opera
  {
    symbol: 'MojoWriteMessage',
    module: 'opera.exe',
    platform: 'win32',
    versionMin: 80,
    notes: 'Opera (Chromium-based).',
  },
  // Generic fallback — probe all modules
  {
    symbol: 'MojoWriteMessage',
    module: '*',
    platform: 'win32',
    notes: 'Fallback: probe every loaded module for MojoWriteMessage.',
  },
  {
    symbol: 'MojoWriteMessageNew',
    module: '*',
    platform: 'win32',
    notes: 'Fallback: probe every loaded module for MojoWriteMessageNew.',
  },
];

// ── Frida script builder ──

/**
 * Serialize a symbol entry into a JS object literal embedded in the generated
 * Frida script. String fields go through `JSON.stringify`, which emits a
 * double-quoted JS string literal that fully escapes backslashes, quotes,
 * newlines and control characters — keeping the generated script parseable no
 * matter what `notes`/`symbol`/`module` contain. A previous `'`-only escape left
 * the string-literal open to injection via a stray backslash
 * (CodeQL js/incomplete-sanitization).
 */
export function formatProbeEntry(
  e: Pick<ChromiumSymbolEntry, 'symbol' | 'module' | 'versionMin' | 'notes'>,
): string {
  return `{ symbol: ${JSON.stringify(e.symbol)}, module: ${JSON.stringify(e.module)}, versionMin: ${e.versionMin ?? 0}, notes: ${JSON.stringify(e.notes ?? '')} }`;
}

/**
 * Generate a Frida verification script that probes the target process
 * for all known Mojo symbols matching the given platform/version criteria.
 */
export function buildVerifyLiveScript(input: VerifyLiveInput): VerifyLiveResult {
  const platform = input.platform;
  const version = input.chromiumVersion ?? 0;
  const channel = input.channel ?? 'stable';

  // Filter symbols matching this platform and optional version
  const candidates = SYMBOL_DB.filter((e) => {
    if (e.platform !== platform) return false;
    if (e.versionMin && version > 0 && version < e.versionMin) return false;
    if (e.versionMax && version > 0 && version > e.versionMax) return false;
    if (e.channel && e.channel !== channel && channel !== 'stable') return false;
    return true;
  });

  // Deduplicate by symbol name for specific-module entries only
  const seen = new Set<string>();
  const deduped: ChromiumSymbolEntry[] = [];
  for (const e of candidates) {
    if (e.module !== '*' && !seen.has(e.symbol)) {
      seen.add(e.symbol);
      deduped.push(e);
    }
  }

  // Always add the "*" wildcard fallback entries (needed for script coverage)
  for (const e of SYMBOL_DB) {
    if (e.module === '*' && e.platform === platform) {
      deduped.push(e);
    }
  }

  // Build the probe list as a JS array literal. formatProbeEntry fully escapes
  // every string field, so entries with backslashes/quotes/newlines cannot
  // break out of the generated string literals.
  const probeEntries = deduped.map((e) => `  ${formatProbeEntry(e)}`);

  // Build the Frida script
  const fridaScript = `'use strict';
// Mojo IPC Symbol Verification Script — generated by jshookmcp
// Platform: ${platform}, Chromium ${version || 'unknown'}, Channel: ${channel}
// Target: ${input.targetProcess ?? 'any Chromium process'}
// Generated: ${new Date().toISOString()}
//
// Probes all loaded modules for known Mojo C-API exports.
// Reports found symbols, their addresses, and the module they were found in.

var PROBE_SYMBOLS = [
${probeEntries.join(',\n')}
];

var results = [];

function probeSymbols() {
  var modules = Process.enumerateModules();
  for (var i = 0; i < PROBE_SYMBOLS.length; i++) {
    var entry = PROBE_SYMBOLS[i];
    var found = false;
    for (var j = 0; j < modules.length; j++) {
      // Skip wildcard-only entries that already have a specific match
      if (entry.module === '*') continue;
      try {
        var addr = Module.findExportByName(modules[j].name, entry.symbol);
        if (addr) {
          // Check version hints
          var versionNote = '';
          if (entry.versionMin && entry.versionMin > 0) {
            versionNote = ' (expected ≥ M' + entry.versionMin + ')';
          }
          results.push({
            symbol: entry.symbol,
            module: modules[j].name,
            address: addr.toString(),
            versionHint: versionNote,
            notes: entry.notes,
            status: 'found'
          });
          found = true;
          break;
        }
      } catch (e) {
        // Skip modules that throw on findExportByName
      }
    }
    if (!found && entry.module !== '*') {
      results.push({
        symbol: entry.symbol,
        module: entry.module,
        address: null,
        notes: entry.notes,
        status: 'not_found'
      });
    }
  }

  // Wildcard probe: scan all modules for symbols not yet found
  for (var k = 0; k < PROBE_SYMBOLS.length; k++) {
    var wildEntry = PROBE_SYMBOLS[k];
    if (wildEntry.module !== '*') continue;
    var alreadyFound = false;
    for (var r = 0; r < results.length; r++) {
      if (results[r].symbol === wildEntry.symbol && results[r].status === 'found') {
        alreadyFound = true;
        break;
      }
    }
    if (alreadyFound) continue;
    for (var m = 0; m < modules.length; m++) {
      try {
        var waddr = Module.findExportByName(modules[m].name, wildEntry.symbol);
        if (waddr) {
          results.push({
            symbol: wildEntry.symbol,
            module: modules[m].name,
            address: waddr.toString(),
            notes: 'Found via wildcard module scan',
            status: 'found_wildcard'
          });
          break;
        }
      } catch (e) {}
    }
  }

  send(JSON.stringify({
    type: 'mojo-verify-result',
    platform: '${platform}',
    chromiumVersion: ${version || 0},
    channel: '${channel}',
    totalProbed: PROBE_SYMBOLS.length,
    totalFound: results.filter(function(r) { return r.status === 'found' || r.status === 'found_wildcard'; }).length,
    results: results
  }));
}

// Run immediately on script load
probeSymbols();
`;

  const targetProcess = input.targetProcess ?? 'chrome';

  return {
    fridaScript,
    runCommand: `frida -n ${targetProcess} -l verify-mojo.js --runtime=v8`,
    probedSymbols: deduped,
    moduleCount: new Set(deduped.filter((e) => e.module !== '*').map((e) => e.module)).size,
    verified: false,
    note:
      'This is a verification script — it probes exports but does NOT hook or capture ' +
      'live Mojo messages. Use the result to confirm which symbols are available, ' +
      'then pass them to mojo_monitor for live capture. ' +
      'B-class: this DB is manually curated. Chromium internal Mojo C API symbols ' +
      'may change across versions and build configurations. Always verify on the ' +
      'target binary before relying on these entries.',
  };
}

/**
 * Get all known symbols for a given platform, optionally filtered by version.
 */
export function getKnownSymbols(
  platform: 'win32' | 'linux' | 'darwin',
  chromiumVersion?: number,
): ChromiumSymbolEntry[] {
  return SYMBOL_DB.filter((e) => {
    if (e.platform !== platform) return false;
    if (chromiumVersion) {
      if (e.versionMin && chromiumVersion < e.versionMin) return false;
      if (e.versionMax && chromiumVersion > e.versionMax) return false;
    }
    return true;
  });
}
