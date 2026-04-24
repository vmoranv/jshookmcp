import { logger } from '@utils/logger';

export interface ObfuscationFingerprint {
  tool: string | null;
  version: string | null;
  confidence: number;
  markers: string[];
}

const TOOL_SIGNATURES: Array<{
  name: string;
  patterns: Array<{ pattern: RegExp; weight: number; description: string }>;
}> = [
  {
    name: 'obfuscator.io',
    patterns: [
      {
        pattern: /_0x[0-9a-f]{4,}\s*=\s*\[/,
        weight: 0.3,
        description: 'obfuscator.io hex variable naming',
      },
      {
        pattern: /while\s*\(\s*!?\s*_0x[0-9a-f]+\s*\)\s*\{[\s\S]*?switch\s*\(\s*_0x[0-9a-f]+\s*\)/i,
        weight: 0.4,
        description: 'control flow flattening',
      },
      {
        pattern: /var\s+_0x[0-9a-f]+\s*=\s*\["/,
        weight: 0.2,
        description: 'string array declaration',
      },
      {
        pattern: /_0x[0-9a-f]+\[_0x[0-9a-f]+\[\d+\]\]/i,
        weight: 0.3,
        description: 'double string array indexing',
      },
      {
        pattern: /\$_ithunder|__jsvar|__obfuscator/i,
        weight: 0.3,
        description: 'obfuscator.io specific globals',
      },
      { pattern: /debugger;?/i, weight: 0.1, description: 'debugger statement' },
    ],
  },
  {
    name: 'javascript-obfuscator',
    patterns: [
      { pattern: /J&#/, weight: 0.2, description: 'HTML-encoded JavaScript' },
      {
        pattern: /window\['_?\w+'\]\s*=|\['_?\w+'\]\s*:\s*function/,
        weight: 0.2,
        description: 'object property obfuscation',
      },
      {
        pattern: /String\.fromCharCode\([^)]+\)\s*\+\s*String\.fromCharCode\(/gi,
        weight: 0.2,
        description: 'charCode string building',
      },
      {
        pattern: /\/\*[\s\S]{20,}@license[\s\S]{20,}\*\//i,
        weight: 0.3,
        description: 'license comment',
      },
    ],
  },
  {
    name: 'webpack',
    patterns: [
      {
        pattern: /__webpack_require__|__webpack_modules__/,
        weight: 0.5,
        description: 'webpack require/module globals',
      },
      {
        pattern: /__webpack_exports__|__webpack_public_path__/,
        weight: 0.5,
        description: 'webpack exports',
      },
      { pattern: /installedModules\s*=/, weight: 0.3, description: 'webpack module cache' },
      {
        pattern: /webpackJsonp|webpack_require/,
        weight: 0.5,
        description: 'webpackJsonp callback',
      },
    ],
  },
  {
    name: 'rollup',
    patterns: [
      { pattern: /__rollup_/i, weight: 0.4, description: 'rollup naming prefix' },
      { pattern: /__esModule\s*:\s*!0/, weight: 0.3, description: 'rollup esModule flag' },
      { pattern: /createCommonjsModule/, weight: 0.3, description: 'rollup commonjs wrapper' },
    ],
  },
  {
    name: 'vite',
    patterns: [
      {
        pattern: /__vite|i\.createInstrumentation|__vite_preload/,
        weight: 0.5,
        description: 'vite globals',
      },
      { pattern: /import\.meta\.url/, weight: 0.2, description: 'vite import.meta' },
    ],
  },
  {
    name: 'browserify',
    patterns: [
      {
        pattern: /require\s*\(function\s*\(\s*\)\s*\{[\s\S]*?return\s+req;/s,
        weight: 0.4,
        description: 'browserify wrapper',
      },
      {
        pattern: /typeof\s+exports\s*===\s*['"]object['"]/,
        weight: 0.3,
        description: 'browserify exports check',
      },
      {
        pattern: /typeof\s+define\s*===\s*['"]function['"]/,
        weight: 0.2,
        description: 'browserify define check',
      },
    ],
  },
  {
    name: 'esbuild',
    patterns: [
      {
        pattern: /__esmProps|__esmDynamic|__esmModule/,
        weight: 0.4,
        description: 'esbuild module handling',
      },
      { pattern: /__esExport|__esDestructuring/, weight: 0.3, description: 'esbuild exports' },
    ],
  },
  {
    name: 'swc',
    patterns: [
      { pattern: /__TURBO__|__RSC__/, weight: 0.3, description: 'turbo/rsc markers' },
      { pattern: /__serialized__|__chunk/, weight: 0.2, description: 'swc serialization' },
    ],
  },
  {
    name: 'terser',
    patterns: [
      {
        pattern: /\/\*[\s\S]*?@__PURE__@[\s\S]*?\*\//i,
        weight: 0.3,
        description: 'terser pure annotation',
      },
      {
        pattern: /\/\*[\s\S]*?@license[\s\S]*?terser[\s\S]*?\*\//i,
        weight: 0.4,
        description: 'terser license comment',
      },
      {
        pattern: /\(\)\s*=>\s*\{return\s+[^;]+;\s*\}/,
        weight: 0.2,
        description: 'terser iife pattern',
      },
    ],
  },
  {
    name: 'uglifyjs',
    patterns: [
      {
        pattern: /typeof\s+\w+\s*===\s*['"]undefined['"]/,
        weight: 0.2,
        description: 'uglify undefined check',
      },
      {
        pattern: /\w+\s*=\s*\w+\s*\|\|\s*\{\}/,
        weight: 0.2,
        description: 'uglify default object pattern',
      },
    ],
  },
  {
    name: 'parcel',
    patterns: [
      { pattern: /__parcel__|__parcel_require__/, weight: 0.5, description: 'parcel globals' },
      { pattern: /Parcel\b/, weight: 0.2, description: 'parcel reference' },
    ],
  },
  {
    name: 'jscrambler',
    patterns: [
      {
        pattern: /jsscrambler|_jsr_|__jsf_|_jsf_/i,
        weight: 0.4,
        description: 'jscrambler markers',
      },
      {
        pattern: /__dynamic_[0-9a-f]+__/,
        weight: 0.4,
        description: 'jscrambler dynamic identifiers',
      },
      { pattern: /\$_js_prototype_/, weight: 0.3, description: 'jscrambler prototype obfuscation' },
    ],
  },
];

export function fingerprintObfuscator(code: string): ObfuscationFingerprint {
  const scores = new Map<string, { score: number; markers: string[] }>();

  for (const tool of TOOL_SIGNATURES) {
    scores.set(tool.name, { score: 0, markers: [] });
  }

  for (const tool of TOOL_SIGNATURES) {
    const entry = scores.get(tool.name)!;

    for (const { pattern, weight, description } of tool.patterns) {
      if (pattern.test(code)) {
        entry.score += weight;
        entry.markers.push(description);
      }
    }
  }

  let best: { name: string; score: number; markers: string[] } | null = null;

  for (const [name, entry] of scores) {
    if (entry.score > 0 && (!best || entry.score > best.score)) {
      best = { name, ...entry };
    }
  }

  if (!best || best.score < 0.3) {
    return { tool: null, version: null, confidence: 0, markers: [] };
  }

  logger.info(
    `Obfuscator fingerprint: ${best.name} (score: ${best.score}) markers: ${best.markers.join(', ')}`,
  );

  return {
    tool: best.name,
    version: null,
    confidence: Math.min(best.score, 1.0),
    markers: best.markers,
  };
}
