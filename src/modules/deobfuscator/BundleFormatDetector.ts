import { logger } from '@utils/logger';

export type BundleFormat = 'webpack' | 'browserify' | 'rollup' | 'vite' | 'parcel' | 'esbuild' | 'swc' | 'systemjs' | 'umd' | 'commonjs' | 'esm' | 'snowpack' | 'fusebox' | 'requirejs' | 'unknown';

export interface BundleDetection {
  format: BundleFormat;
  confidence: number;
  markers: string[];
  entryId: string | null;
  moduleCount: number | null;
}

const FORMAT_PATTERNS: Array<{
  format: BundleFormat;
  patterns: Array<{ regex: RegExp; weight: number; description: string }>;
}> = [
  {
    format: 'webpack',
    patterns: [
      { regex: /__webpack_require__|__webpack_modules__/, weight: 0.5, description: 'webpack require' },
      { regex: /__webpack_exports__|__webpack_public_path__/, weight: 0.4, description: 'webpack exports' },
      { regex: /installedModules\s*=/, weight: 0.3, description: 'webpack module cache' },
      { regex: /webpackJsonp\s*\(\s*\w+\s*,\s*\w+\s*,\s*\w+\s*,/, weight: 0.5, description: 'webpackJsonp call' },
      { regex: /module\.exports\s*=\s*__webpack_require__/, weight: 0.4, description: 'webpack main export' },
    ],
  },
  {
    format: 'rollup',
    patterns: [
      { regex: /__rollup_/, weight: 0.4, description: 'rollup naming' },
      { regex: /__esModule\s*[=:]/, weight: 0.3, description: 'rollup esModule flag' },
      { regex: /createCommonjsModule/, weight: 0.4, description: 'rollup commonjs wrapper' },
      { regex: /bundled with rollup/i, weight: 0.3, description: 'rollup comment' },
    ],
  },
  {
    format: 'vite',
    patterns: [
      { regex: /__vite/, weight: 0.5, description: 'vite globals' },
      { regex: /import\.meta\.url/, weight: 0.3, description: 'vite import.meta' },
      { regex: /__vite_preload|ViteRuntimePublicPathModule/, weight: 0.4, description: 'vite specific' },
      { regex: /createInstrumentation/, weight: 0.3, description: 'vite instrumentation' },
    ],
  },
  {
    format: 'esbuild',
    patterns: [
      { regex: /__esmProps|__esmDynamic|__esmModule/, weight: 0.5, description: 'esbuild module' },
      { regex: /__esExport|__esDestructuring/, weight: 0.4, description: 'esbuild exports' },
      { regex: /esbuild:importMetaObject/, weight: 0.3, description: 'esbuild runtime' },
    ],
  },
  {
    format: 'swc',
    patterns: [
      { regex: /__TURBO__|__RSC__/, weight: 0.4, description: 'turbo/rsc' },
      { regex: /__serialized__/, weight: 0.3, description: 'swc serialization' },
      { regex: /__chunk_load|__revoke_imports/, weight: 0.3, description: 'swc chunks' },
    ],
  },
  {
    format: 'browserify',
    patterns: [
      { regex: /typeof\s+exports\s*===\s*['"]object['"]/, weight: 0.4, description: 'browserify exports' },
      { regex: /typeof\s+define\s*===\s*['"]function['"]/, weight: 0.3, description: 'browserify define' },
      { regex: /require\s*\(function\s*\(\s*\)\s*\{[\s\S]{0,100}return\s+req;/s, weight: 0.5, description: 'browserify wrapper' },
      { regex: /__browserify_process/, weight: 0.4, description: 'browserify process shim' },
    ],
  },
  {
    format: 'parcel',
    patterns: [
      { regex: /__parcel__|__parcel_require__/, weight: 0.5, description: 'parcel globals' },
      { regex: /parcelRequire|parcelExport/, weight: 0.4, description: 'parcel require' },
      { regex: /\.parcelrc/, weight: 0.2, description: 'parcel config ref' },
    ],
  },
  {
    format: 'systemjs',
    patterns: [
      { regex: /System\.register|system_register/, weight: 0.5, description: 'systemjs register' },
      { regex: /System\.import/, weight: 0.3, description: 'systemjs import' },
      { regex: /__system_context__/, weight: 0.4, description: 'systemjs context' },
    ],
  },
  {
    format: 'umd',
    patterns: [
      { regex: /typeof\s+exports\s*===\s*['"]object['"]\s*&&\s*typeof\s+define\s*===\s*['"]function['"]/, weight: 0.6, description: 'umd pattern' },
      { regex: /umdjs|umd library/i, weight: 0.3, description: 'umd comment' },
    ],
  },
  {
    format: 'commonjs',
    patterns: [
      { regex: /module\.exports\s*=/, weight: 0.4, description: 'commonjs export' },
      { regex: /exports\.\w+\s*=/, weight: 0.3, description: 'commonjs named export' },
      { regex: /require\s*\(/, weight: 0.2, description: 'commonjs require' },
    ],
  },
  {
    format: 'esm',
    patterns: [
      { regex: /import\s+.*\s+from\s+['"][^'"]+['"]/, weight: 0.3, description: 'esm import' },
      { regex: /export\s+(default\s+)?(const|let|var|function|class)/, weight: 0.3, description: 'esm export' },
      { regex: /export\s+\{[^}]+\}/, weight: 0.3, description: 'esm named export' },
    ],
  },
  {
    format: 'snowpack',
    patterns: [
      { regex: /__snowpack__|__SNOWPACK__/, weight: 0.5, description: 'snowpack globals' },
      { regex: /snowpack__polyfill|snowpack__env/, weight: 0.4, description: 'snowpack polyfill' },
      { regex: /\.snowpack\//, weight: 0.4, description: 'snowpack paths' },
      { regex: /__snowpack_plugin__/, weight: 0.4, description: 'snowpack plugin' },
      { regex: /createmount|__geturl/, weight: 0.3, description: 'snowpack runtime' },
    ],
  },
  {
    format: 'fusebox',
    patterns: [
      { regex: /__fusebox__|__FUSEOBJECT__/, weight: 0.5, description: 'fusebox globals' },
      { regex: /fuse\.直达|fusebox:/, weight: 0.4, description: 'fusebox paths' },
      { regex: /\$\$ fuses \$\$|\$ fuse\$/, weight: 0.3, description: 'fusebox runtime' },
      { regex: /Bundle\s*of\s* FuseBox/, weight: 0.3, description: 'fusebox comment' },
    ],
  },
  {
    format: 'requirejs',
    patterns: [
      { regex: /require\s*\(\s*\[[^\]]+\]\s*,\s*function\s*\(/, weight: 0.5, description: 'requirejs define' },
      { regex: /define\s*\(\s*['"][^'"]+['"]\s*,\s*\[/, weight: 0.4, description: 'requirejs module' },
      { regex: /requirejs\.config|require\.config/, weight: 0.4, description: 'requirejs config' },
      { regex: /\$\$ amd \$ \$|__checkamd/, weight: 0.3, description: 'requirejs amd' },
    ],
  },
];

export function detectBundleFormat(code: string): BundleDetection {
  const scores = new Map<BundleFormat, { score: number; markers: string[] }>();

  for (const fmt of FORMAT_PATTERNS) {
    scores.set(fmt.format, { score: 0, markers: [] });
  }

  for (const fmt of FORMAT_PATTERNS) {
    const entry = scores.get(fmt.format)!;

    for (const { regex, weight, description } of fmt.patterns) {
      if (regex.test(code)) {
        entry.score += weight;
        entry.markers.push(description);
      }
    }
  }

  let best: { format: BundleFormat; score: number; markers: string[] } | null = null;

  for (const [format, entry] of scores) {
    if (entry.score > 0 && (!best || entry.score > best.score)) {
      best = { format, ...entry };
    }
  }

  if (!best || best.score < 0.3) {
    return { format: 'unknown', confidence: 0, markers: [], entryId: null, moduleCount: null };
  }

  const entryIdMatch = code.match(/(?:entry|main|__entry)\s*[=:]\s*['"]([^'"]+)['"]/i);
  const entryId = entryIdMatch ? entryIdMatch[1] ?? null : null;

  const chunkMatches = code.match(/chunk\d*|module\d+/gi);
  const moduleCount = chunkMatches ? new Set(chunkMatches.map((c) => c.toLowerCase())).size : null;

  logger.info(`Bundle format: ${best.format} (confidence: ${best.score})`);

  return {
    format: best.format,
    confidence: Math.min(best.score, 1.0),
    markers: best.markers,
    entryId,
    moduleCount,
  };
}
