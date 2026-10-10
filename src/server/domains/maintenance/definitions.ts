import type { Tool } from '@modelcontextprotocol/server';
import { tool } from '@server/registry/tool-builder';

// ── Token Budget ──

export const tokenBudgetTools: Tool[] = [
  tool('get_token_budget_stats', (t) =>
    t.desc('Get token budget usage stats, warnings, and optimization suggestions.').query(),
  ),
  tool('manual_token_cleanup', (t) =>
    t.desc('Clear stale entries and reset counters to free 10-30% of token budget.'),
  ),
  tool('reset_token_budget', (t) =>
    t
      .desc('Hard-reset all token budget counters. Destructive — prefer manual_token_cleanup.')
      .destructive(),
  ),
];

// ── Extensions ──

export const extensionTools: Tool[] = [
  tool('list_extensions', (t) =>
    t
      .desc('List all loaded plugins, workflows, and extension tools.')
      .boolean(
        'includeIntegrity',
        'When true, enrich each extension with package version, entry-file SHA-256 digest, ' +
          'and registry-install provenance (pinned commit). Slower (hashes files).',
      )
      .query(),
  ),
  tool('reload_extensions', (t) =>
    t
      .desc(
        'Reload plugins and workflows from configured directories, and directly register extension tools visible in the current profile. ' +
          'The response includes capabilityFixed — tools that only became available through this reload (previously blocked on a missing plugin).',
      )
      .openWorld(),
  ),
  tool('browse_extension_registry', (t) =>
    t
      .desc('Browse the online extension registry for installable plugins and workflows.')
      .enum('kind', ['plugin', 'workflow', 'all'], 'Filter by extension kind', { default: 'all' })
      .query(),
  ),
  tool('install_extension', (t) =>
    t
      .desc('Install an extension from the remote registry.')
      .string('slug', 'Extension slug from the registry')
      .string('targetDir', 'Target directory override')
      .requiredOpenWorld('slug'),
  ),
];

// ── Cache ──

export const cacheTools: Tool[] = [
  tool('get_cache_stats', (t) =>
    t.desc('Get cache statistics: entries, sizes, hit rates, and cleanup recommendations.').query(),
  ),
  tool('smart_cache_cleanup', (t) =>
    t
      .desc('Evict LRU and stale entries while preserving hot data.')
      .number('targetSize', 'Target size in bytes')
      .array(
        'namespaces',
        { type: 'string' },
        'Restrict eviction to these cache namespaces (by name). Omitted = all caches; empty list = nothing.',
      ),
  ),
  tool('clear_all_caches', (t) =>
    t.desc('Clear all internal caches. Destructive — prefer smart_cache_cleanup.').destructive(),
  ),
];

// ── Sandbox (merged from the former sandbox domain) ──

export const sandboxTools: Tool[] = [
  tool('execute_sandbox_script', (t) =>
    t
      .desc('Execute JavaScript in an isolated sandbox.')
      .string('code', 'JavaScript source code to execute inside the sandbox')
      .string('sessionId', 'Session ID for scratchpad persistence across executions')
      .number('timeoutMs', 'Execution timeout in ms', { default: 1000 })
      .number(
        'memoryLimitBytes',
        'QuickJS heap memory limit in bytes; clamped to configured min/max limits.',
      )
      .array(
        'allowedTools',
        { type: 'string' },
        'Optional MCP tool allowlist for sandbox mcp.call/listTools exposure.',
      )
      .boolean('autoCorrect', 'Retry failed scripts up to 2 times with error context', {
        default: false,
      })
      .boolean('redactOutput', 'Redact secrets from logs, result, and error before returning.', {
        default: true,
      })
      .required('code'),
  ),
];

// ── Shadow-git snapshots ──

export const snapshotTools: Tool[] = [
  tool('snapshot_create', (t) =>
    t
      .desc(
        'Create a shadow-git snapshot of a scan-artifact directory (artifacts, HAR, screenshots, ' +
          'debugger-sessions, ...) so it can be rolled back later. Uses an ISOLATED git object ' +
          'store outside the target directory — the project .git is never touched and no git ' +
          'commit is made. The store keeps full file contents, so snapshots can grow large; ' +
          'snapshot output directories, not source trees.',
      )
      .string(
        'targetDir',
        'Directory to snapshot. Must resolve inside the project root or system temp directories.',
      )
      .string('label', 'Optional human-readable label stored with the snapshot')
      .required('targetDir'),
  ),
  tool('snapshot_list', (t) =>
    t
      .desc('List shadow-git snapshots recorded for a directory, newest first.')
      .string(
        'targetDir',
        'Directory whose snapshots should be listed. Must resolve inside the project root or system temp directories.',
      )
      .required('targetDir')
      .query(),
  ),
  tool('snapshot_restore', (t) =>
    t
      .desc(
        'Restore a directory to a recorded shadow-git snapshot. DESTRUCTIVE: files modified after ' +
          'the snapshot are overwritten, files created after it are DELETED, and files deleted ' +
          'after it are written back (full revert semantics). The isolated store never touches ' +
          'the project .git. Create a fresh snapshot_create first if you may need the current state.',
      )
      .string(
        'targetDir',
        'Directory to restore. Must resolve inside the project root or system temp directories.',
      )
      .string('snapshotId', 'Snapshot id from snapshot_list')
      .required('targetDir', 'snapshotId')
      .destructive(),
  ),
];

// ── Artifacts ──

export const artifactTools: Tool[] = [
  tool('cleanup_artifacts', (t) =>
    t
      .desc('Clean generated artifacts by age and size.')
      .number('retentionDays', 'Override retention window in days')
      .number('maxTotalBytes', 'Override maximum retained bytes')
      .boolean('dryRun', 'Preview removals without deleting')
      .array(
        'categories',
        {
          type: 'string',
          enum: [
            'wasm',
            'traces',
            'profiles',
            'dumps',
            'reports',
            'har',
            'captures',
            'sessions',
            'offloaded',
            'tmp',
          ],
        },
        'Only clean these artifact categories',
      )
      .array(
        'excludeCategories',
        {
          type: 'string',
          enum: [
            'wasm',
            'traces',
            'profiles',
            'dumps',
            'reports',
            'har',
            'captures',
            'sessions',
            'offloaded',
            'tmp',
          ],
        },
        'Do not clean these artifact categories',
      )
      .destructive(),
  ),
  tool('doctor_environment', (t) =>
    t
      .desc('Run environment doctor: dependencies, bridges, platform limits.')
      .boolean('includeBridgeHealth', 'Probe native-bridge / Burp endpoints')
      .readOnly(),
  ),
  tool('maintenance_detect_gpu', (t) =>
    t
      .desc(
        'Detect GPU family from WebGL/WebGPU renderer strings. ' +
          'Classifies into NVIDIA, AMD, Intel, Apple, Mali, Adreno, PowerVR, Vivante, Broadcom, Qualcomm, Microsoft. ' +
          'Pure-TS classifier — no browser needed. Provide at least one of webglRenderer, webgpuDescription, or deviceName.',
      )
      .string(
        'webglRenderer',
        'WebGL RENDERER string (e.g. from gl.getParameter(gl.RENDERER)), typically ANGLE-wrapped on Windows.',
      )
      .string(
        'webgpuDescription',
        'WebGPU adapter.info.description (e.g. "NVIDIA GeForce RTX 4090").',
      )
      .string('deviceName', 'Free-form GPU device name (e.g. "Mali-G78").')
      .readOnly(),
  ),
];
