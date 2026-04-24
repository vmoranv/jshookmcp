/**
 * Common patterns shared across deobfuscation modules.
 * Centralizes regex patterns used by multiple modules to ensure consistency
 * and reduce duplication.
 */

/**
 * Webpack detection patterns
 */
export const WEBPACK_PATTERNS = {
  require: /__webpack_require__|__webpack_modules__/,
  exports: /__webpack_exports__|__webpack_public_path__/,
  moduleCache: /installedModules\s*=/,
  jsonp: /webpackJsonp\s*\(\s*\w+\s*,\s*\w+\s*,\s*\w+\s*,/,
  mainExport: /module\.exports\s*=\s*__webpack_require__/,
};

/**
 * Rollup detection patterns
 */
export const ROLLUP_PATTERNS = {
  naming: /__rollup_/i,
  esModule: /__esModule\s*[=:]/,
  commonjsWrapper: /createCommonjsModule/,
  bundledComment: /bundled with rollup/i,
};

/**
 * Vite detection patterns
 */
export const VITE_PATTERNS = {
  globals: /__vite/,
  importMeta: /import\.meta\.url/,
  preload: /__vite_preload|ViteRuntimePublicPathModule/,
  instrumentation: /createInstrumentation/,
};

/**
 * Browserify detection patterns
 */
export const BROWSERIFY_PATTERNS = {
  exports: /typeof\s+exports\s*===\s*['"]object['"]/,
  define: /typeof\s+define\s*===\s*['"]function['"]/,
  wrapper: /require\s*\(\s*function\s*\(\s*\)\s*\{[\s\S]{0,100}return\s+req;/s,
  processShim: /__browserify_process/,
};

/**
 * ESBuild detection patterns
 */
export const ESBUILD_PATTERNS = {
  module: /__esmProps|__esmDynamic|__esmModule/,
  exports: /__esExport|__esDestructuring/,
  runtime: /esbuild:importMetaObject/,
};

/**
 * SWC detection patterns
 */
export const SWC_PATTERNS = {
  turbo: /__TURBO__|__RSC__/,
  serialized: /__serialized__/,
  chunks: /__chunk_load|__revoke_imports/,
};

/**
 * Terser detection patterns
 */
export const TERSER_PATTERNS = {
  pureComment: /\/\*[\s\S]*?@__PURE__@[\s\S]*?\*\//i,
  licenseComment: /\/\*[\s\S]*?@license[\s\S]*?terser[\s\S]*?\*\//i,
  iifePattern: /\(\)\s*=>\s*\{return\s+[^;]+;\s*\}/,
};

/**
 * UglifyJS detection patterns
 */
export const UGLIFYJS_PATTERNS = {
  undefinedCheck: /typeof\s+\w+\s*===\s*['"]undefined['"]/,
  defaultObject: /\w+\s*=\s*\w+\s*\|\|\s*\{\}/,
};

/**
 * Obfuscator.io detection patterns
 */
export const OBFUSCATOR_IO_PATTERNS = {
  hexVariable: /_0x[0-9a-f]{4,}\s*=\s*\[/,
  controlFlowFlattening:
    /while\s*\(\s*!?\s*_0x[0-9a-f]+\s*\)\s*\{[\s\S]*?switch\s*\(\s*_0x[0-9a-f]+\s*\)/i,
  stringArrayDeclaration: /var\s+_0x[0-9a-f]+\s*=\s*\["/,
  doubleIndexing: /_0x[0-9a-f]+\[_0x[0-9a-f]+\[\d+\]\]/i,
  specificGlobals: /\$_ithunder|__jsvar|__obfuscator/i,
  debuggerStatement: /debugger;?/i,
};

/**
 * JScrambler detection patterns
 */
export const JSCRAMBLER_PATTERNS = {
  markers: /jsscrambler|_jsr_|__jsf_|_jsf_/i,
  dynamicIdentifiers: /__dynamic_[0-9a-f]+__/,
  prototype: /\$_js_prototype_/,
};

/**
 * JavaScript-obfuscator detection patterns
 */
export const JAVASCRIPT_OBFUSCATOR_PATTERNS = {
  htmlEncoded: /J&#/,
  propertyObfuscation: /window\['_?\w+'\]\s*=|\['_?\w+'\]\s*:\s*function/,
  charCodeBuilding: /String\.fromCharCode\([^)]+\)\s*\+\s*String\.fromCharCode\(/gi,
  licenseComment: /\/\*[\s\S]{20,}@license[\s\S]{20,}\*\//i,
};

/**
 * VM protection detection patterns
 */
export const VM_PROTECTION_PATTERNS = {
  whileTrueSwitch: /while\s*\(\s*true\s*\)\s*\{[\s\S]*?switch\s*\(/i,
  largeNumericArray: /var\s+\w+\s*=\s*\[\s*\d+(?:\s*,\s*\d+){10,}\s*\]/i,
  pcAccess: /\w+\[pc\+\+\]/i,
  stackOps: /stack\.push|stack\.pop/i,
  dispatcher: /dispatcher|interpreter/i,
  pcIncrement: /\bpc\s*\+\+|pc\s*=\s*\w+/i,
};

/**
 * Anti-debug detection patterns
 */
export const ANTI_DEBUG_PATTERNS = {
  debuggerKeyword: /debugger[\s;]/i,
  consoleCheck: /console\[("|')Debug("|')\]/i,
  dateCheck: /Date\.now\(\)\s*-\s*\w+\s*>\s*\d+/i,
  devToolsCheck: /devtools/i,
};

/**
 * Dynamic code execution patterns
 */
export const DYNAMIC_CODE_PATTERNS = {
  eval: /eval\s*\(\s*(.+?)\s*\)/s,
  newFunction: /new\s+Function\s*\(\s*(.+?)\s*\)/s,
  functionConstructor: /Function\s*\(\s*(.+?)\s*\)/s,
  setTimeoutString: /setTimeout\s*\(\s*(?:function|.+\.toString\(\))\s*,\s*\d+\s*\)/s,
  setIntervalString: /setInterval\s*\(\s*(?:function|.+\.toString\(\))\s*,\s*\d+\s*\)/s,
  setImmediate: /setImmediate\s*\(\s*(?:function|.+\.toString\(\))\s*\)/s,
  dynamicImport: /import\s*\(\s*(.+?)\s*\)/s,
};

/**
 * Encode/decode patterns
 */
export const ENCODE_DECODE_PATTERNS = {
  hexEscape: /\\x[0-9a-fA-F]{2}/g,
  unicodeEscape: /\\u[0-9a-fA-F]{4}/g,
  octalEscape: /\\[0-7]{1,3}/g,
  htmlHexEntity: /&#x[0-9a-fA-F]+;/i,
  htmlNumericEntity: /&#\d+;/,
  htmlNamedEntity: /&[a-z]+;/i,
  urlEncoded: /%[0-9A-F]{2}%[0-9A-F]{2}%[0-9A-F]{2}/,
  base64Pattern: /[A-Za-z0-9+/]{20,}={0,2}/,
};

/**
 * Snowpack detection patterns
 */
export const SNOWPACK_PATTERNS = {
  globals: /__snowpack__|__SNOWPACK__/,
  polyfill: /snowpack__polyfill|snowpack__env/,
  paths: /\.snowpack\//,
  plugin: /__snowpack_plugin__/,
  runtime: /createmount|__geturl/,
};

/**
 * FuseBox detection patterns
 */
export const FUSEBOX_PATTERNS = {
  globals: /__fusebox__|__FUSEOBJECT__/,
  paths: /fuse\.直达|fusebox:/,
  runtime: /\$\$ fuses \$\$|\$ fuse\$/,
  comment: /Bundle\s*of\s* FuseBox/,
};

/**
 * RequireJS detection patterns
 */
export const REQUIREJS_PATTERNS = {
  define: /require\s*\(\s*\[[^\]]+\]\s*,\s*function\s*\(/,
  module: /define\s*\(\s*['"][^'"]+['"]\s*,\s*\[/,
  config: /requirejs\.config|require\.config/,
  amd: /\$\$ amd \$ \$|__checkamd/,
};

/**
 * Helper to test if code matches webpack
 */
export function isWebpack(code: string): boolean {
  return Object.values(WEBPACK_PATTERNS).some((p) => p.test(code));
}

/**
 * Helper to test if code matches rollup
 */
export function isRollup(code: string): boolean {
  return Object.values(ROLLUP_PATTERNS).some((p) => p.test(code));
}

/**
 * Helper to test if code matches vite
 */
export function isVite(code: string): boolean {
  return Object.values(VITE_PATTERNS).some((p) => p.test(code));
}

/**
 * Helper to test if code matches browserify
 */
export function isBrowserify(code: string): boolean {
  return Object.values(BROWSERIFY_PATTERNS).some((p) => p.test(code));
}
