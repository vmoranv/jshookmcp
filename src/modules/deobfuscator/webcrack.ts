import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  DeobfuscateBundleModuleSummary,
  DeobfuscateBundleSummary,
  DeobfuscateMappingRule,
  DeobfuscateOptions,
  DeobfuscateSavedArtifact,
} from '@internal-types/deobfuscator';
import { logger } from '@utils/logger';
import { getSafeOutputRoots } from '@utils/outputPaths';
import { resolveSafeDeletableDir, resolveSafeOutputPath } from '@utils/safeOutput';
import {
  WEBCRACK_JOB_TIMEOUT_MS,
  resolveWebcrackUrl,
  type WebcrackPool,
  type WebcrackWorkerBundle,
} from './webcrack-worker';
import { DEOBF_WEBCRACK_MAX_BUNDLE_MODULES } from '@src/constants/transform';

type WebcrackModuleLike = {
  id: string;
  path: string;
  isEntry: boolean;
  code: string;
};

type WebcrackBundleLike = {
  type: 'webpack' | 'browserify';
  entryId: string;
  modules: Map<string, WebcrackModuleLike>;
};

type WebcrackResultLike = {
  code: string;
  bundle?: WebcrackBundleLike;
  save: (targetPath: string) => Promise<void>;
};

type WebcrackRuntimeOptions = {
  jsx?: boolean;
  unpack?: boolean;
  deobfuscate?: boolean;
  unminify?: boolean;
  mangle?: boolean;
  sandbox?: unknown;
};

type WebcrackModuleImport = {
  webcrack: (code: string, options?: WebcrackRuntimeOptions) => Promise<WebcrackResultLike>;
};

type WebcrackInvocationOptions = Pick<
  DeobfuscateOptions,
  | 'forceOutput'
  | 'includeModuleCode'
  | 'jsx'
  | 'mangle'
  | 'mappings'
  | 'maxBundleModules'
  | 'outputDir'
  | 'unminify'
  | 'unpack'
>;

export interface WebcrackExecutionResult {
  applied: boolean;
  code: string;
  bundle?: DeobfuscateBundleSummary;
  savedTo?: string;
  savedArtifacts?: DeobfuscateSavedArtifact[];
  optionsUsed: Required<Pick<DeobfuscateOptions, 'jsx' | 'mangle' | 'unminify' | 'unpack'>>;
  reason?: string;
}

const DEFAULT_OPTIONS: Required<
  Pick<DeobfuscateOptions, 'jsx' | 'mangle' | 'unminify' | 'unpack'>
> = {
  jsx: true,
  mangle: false,
  unminify: true,
  unpack: true,
};

const MAX_BUNDLE_MODULES = DEOBF_WEBCRACK_MAX_BUNDLE_MODULES;

type MappingMetadata = {
  fromPath: string;
};

function normalizeOptions(
  options: WebcrackInvocationOptions,
): Required<Pick<DeobfuscateOptions, 'jsx' | 'mangle' | 'unminify' | 'unpack'>> {
  return {
    jsx: options.jsx ?? DEFAULT_OPTIONS.jsx,
    mangle: options.mangle ?? DEFAULT_OPTIONS.mangle,
    unminify: options.unminify ?? DEFAULT_OPTIONS.unminify,
    unpack: options.unpack ?? DEFAULT_OPTIONS.unpack,
  };
}

function isSupportedNodeVersion(): boolean {
  const [majorPart = '0', minorPart = '0'] = process.versions.node.split('.');
  const major = Number.parseInt(majorPart, 10);
  const minor = Number.parseInt(minorPart, 10);

  if (!Number.isFinite(major) || !Number.isFinite(minor)) {
    return false;
  }

  if (major === 22) {
    return minor >= 12;
  }

  return major === 24;
}

function matchesRule(module: WebcrackModuleLike, rule: DeobfuscateMappingRule): boolean {
  const target = rule.target === 'path' ? module.path : module.code;
  const matchType = rule.matchType ?? 'includes';

  if (matchType === 'exact') {
    return target === rule.pattern;
  }

  if (matchType === 'regex') {
    try {
      return new RegExp(rule.pattern, 'm').test(target);
    } catch {
      return false;
    }
  }

  return target.includes(rule.pattern);
}

function applyBundleMappings(
  bundle: WebcrackBundleLike,
  mappings: DeobfuscateMappingRule[] | undefined,
): Map<string, MappingMetadata> {
  const remapped = new Map<string, MappingMetadata>();

  if (!mappings || mappings.length === 0) {
    return remapped;
  }

  for (const module of bundle.modules.values()) {
    for (const rule of mappings) {
      if (!rule.path || !rule.pattern) {
        continue;
      }

      if (matchesRule(module, rule)) {
        if (module.path !== rule.path) {
          remapped.set(module.id, { fromPath: module.path });
          module.path = rule.path;
        }
        break;
      }
    }
  }

  return remapped;
}

function summarizeBundle(
  bundle: WebcrackBundleLike,
  options: Pick<DeobfuscateOptions, 'includeModuleCode' | 'maxBundleModules'>,
  remapped: Map<string, MappingMetadata>,
): DeobfuscateBundleSummary {
  const maxBundleModules = options.maxBundleModules ?? MAX_BUNDLE_MODULES;
  const modules = Array.from(bundle.modules.values())
    .toSorted((left, right) => {
      if (left.isEntry !== right.isEntry) {
        return left.isEntry ? -1 : 1;
      }
      return left.path.localeCompare(right.path);
    })
    .slice(0, maxBundleModules)
    .map<DeobfuscateBundleModuleSummary>((module) => ({
      id: module.id,
      path: module.path,
      isEntry: module.isEntry,
      size: module.code.length,
      code: options.includeModuleCode ? module.code : undefined,
      mappedPathFrom: remapped.get(module.id)?.fromPath,
    }));

  return {
    type: bundle.type,
    entryId: bundle.entryId,
    moduleCount: bundle.modules.size,
    truncated: bundle.modules.size > maxBundleModules,
    mappingsApplied: remapped.size,
    modules,
  };
}

async function collectSavedArtifacts(
  rootDir: string,
  currentDir = rootDir,
): Promise<DeobfuscateSavedArtifact[]> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const artifacts: DeobfuscateSavedArtifact[] = [];

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      artifacts.push(...(await collectSavedArtifacts(rootDir, fullPath)));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const metadata = await stat(fullPath);
    artifacts.push({
      path: path.relative(rootDir, fullPath).replace(/\\/g, '/'),
      size: metadata.size,
      type: 'file',
    });
  }

  return artifacts.toSorted((left, right) => left.path.localeCompare(right.path));
}

/**
 * Resolve and validate `outputDir` against the allowed output roots. When the
 * caller asked to clear the directory first, use the destructive guard so an
 * allowed root (or an ancestor of one) can never be removed.
 */
async function resolveSafeOutputDir(outputDir: string, deleteBefore: boolean): Promise<string> {
  const options = {
    allowedRoots: getSafeOutputRoots(),
    allowedRootsDescription: 'project root or system temp directory',
  };
  return deleteBefore
    ? await resolveSafeDeletableDir(outputDir, options)
    : await resolveSafeOutputPath(outputDir, options);
}

/** Rebuild the Map-based bundle shape the mapping/summarize/save helpers expect. */
function deserializeBundle(bundle: WebcrackWorkerBundle): WebcrackBundleLike {
  return {
    type: bundle.type,
    entryId: bundle.entryId,
    modules: new Map(bundle.modules.map((module) => [module.id, { ...module }])),
  };
}

/**
 * Replicate webcrack's `result.save(path)` on the main thread for the worker
 * path, where the `save` method (a function) cannot cross the structured-clone
 * boundary. Writes `<path>/deobfuscated.js`, `<path>/bundle.json` and one file
 * per bundle module — mirroring the `save` layout of webcrack 2.16.0 (the
 * version pinned in package.json). The worker/fallback equivalence test only
 * asserts the `code` output matches; this on-disk layout is not itself diffed
 * against webcrack's own `save` output.
 */
export async function saveWebcrackArtifacts(
  savedTo: string,
  code: string,
  bundle?: WebcrackBundleLike,
): Promise<void> {
  const normalized = path.normalize(savedTo);
  await mkdir(normalized, { recursive: true });
  await writeFile(path.join(normalized, 'deobfuscated.js'), code, 'utf8');

  if (!bundle) return;

  const bundleJson = {
    type: bundle.type,
    entryId: bundle.entryId,
    modules: Array.from(bundle.modules.values(), (module) => ({
      id: module.id,
      path: module.path,
    })),
  };
  await mkdir(normalized, { recursive: true });
  await writeFile(
    path.join(normalized, 'bundle.json'),
    JSON.stringify(bundleJson, null, 2),
    'utf8',
  );

  await Promise.all(
    Array.from(bundle.modules.values(), async (module) => {
      const modulePath = path.normalize(path.join(normalized, module.path));
      const rel = path.relative(normalized, modulePath);
      if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(`detected path traversal: ${module.path}`);
      }
      await mkdir(path.dirname(modulePath), { recursive: true });
      await writeFile(modulePath, module.code, 'utf8');
    }),
  );
}

export async function runWebcrack(
  code: string,
  options: WebcrackInvocationOptions,
  pool?: WebcrackPool,
): Promise<WebcrackExecutionResult> {
  const optionsUsed = normalizeOptions(options);

  if (!isSupportedNodeVersion()) {
    const reason = `webcrack requires Node.js 22.12+ or 24.x; current runtime is ${process.versions.node}`;
    logger.warn(reason);
    return {
      applied: false,
      code,
      optionsUsed,
      reason,
    };
  }

  try {
    // Worker path: run webcrack off the event loop. The main thread only posts
    // `{ code, options }` and receives `{ code, bundle }` (serialized to plain
    // objects) back; mappings, summarization and outputDir saving stay here.
    if (pool) {
      const workerResult = await pool.submit(
        {
          code,
          webcrackUrl: resolveWebcrackUrl(),
          options: {
            jsx: optionsUsed.jsx,
            unpack: optionsUsed.unpack,
            unminify: optionsUsed.unminify,
            mangle: optionsUsed.mangle,
          },
        },
        WEBCRACK_JOB_TIMEOUT_MS,
      );

      const bundleLike = workerResult.bundle ? deserializeBundle(workerResult.bundle) : undefined;
      const remapped = bundleLike ? applyBundleMappings(bundleLike, options.mappings) : new Map();

      let savedTo: string | undefined;
      let savedArtifacts: DeobfuscateSavedArtifact[] | undefined;
      if (typeof options.outputDir === 'string' && options.outputDir.trim().length > 0) {
        savedTo = await resolveSafeOutputDir(options.outputDir, options.forceOutput === true);
        if (options.forceOutput) {
          await rm(savedTo, { recursive: true, force: true });
        }
        await saveWebcrackArtifacts(savedTo, workerResult.code, bundleLike);
        savedArtifacts = await collectSavedArtifacts(savedTo);
      }

      return {
        applied: true,
        code: workerResult.code,
        bundle: bundleLike
          ? summarizeBundle(
              bundleLike,
              {
                includeModuleCode: options.includeModuleCode,
                maxBundleModules: options.maxBundleModules,
              },
              remapped,
            )
          : undefined,
        savedTo,
        savedArtifacts,
        optionsUsed,
      };
    }

    // Fallback path (no pool wired): run webcrack synchronously on the main
    // thread. Kept for direct calls / tests; production callers pass the shared
    // pool from `getWebcrackPool()`.
    const { webcrack } = (await import('webcrack')) as WebcrackModuleImport;
    const result = await webcrack(code, {
      jsx: optionsUsed.jsx,
      unpack: optionsUsed.unpack,
      deobfuscate: true,
      unminify: optionsUsed.unminify,
      mangle: optionsUsed.mangle,
    });

    const remapped = result.bundle
      ? applyBundleMappings(result.bundle, options.mappings)
      : new Map();

    let savedTo: string | undefined;
    let savedArtifacts: DeobfuscateSavedArtifact[] | undefined;
    if (typeof options.outputDir === 'string' && options.outputDir.trim().length > 0) {
      savedTo = await resolveSafeOutputDir(options.outputDir, options.forceOutput === true);

      if (options.forceOutput) {
        await rm(savedTo, { recursive: true, force: true });
      }
      await result.save(savedTo);
      savedArtifacts = await collectSavedArtifacts(savedTo);
    }

    return {
      applied: true,
      code: result.code,
      bundle: result.bundle
        ? summarizeBundle(
            result.bundle,
            {
              includeModuleCode: options.includeModuleCode,
              maxBundleModules: options.maxBundleModules,
            },
            remapped,
          )
        : undefined,
      savedTo,
      savedArtifacts,
      optionsUsed,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.warn('webcrack execution failed, falling back to legacy pipeline', error);
    return {
      applied: false,
      code,
      optionsUsed,
      reason,
    };
  }
}
