export type ObfuscationType =
  | 'javascript-obfuscator'
  | 'webpack'
  | 'uglify'
  | 'vm-protection'
  | 'self-modifying'
  | 'invisible-unicode'
  | 'control-flow-flattening'
  | 'string-array-rotation'
  | 'dead-code-injection'
  | 'opaque-predicates'
  | 'jsfuck'
  | 'aaencode'
  | 'jjencode'
  | 'packer'
  | 'eval-obfuscation'
  | 'base64-encoding'
  | 'hex-encoding'
  | 'jscrambler'
  | 'urlencoded'
  | 'custom'
  | 'unknown'
  | 'bundle-unpack'
  | 'unminify'
  | 'jsx-decompile'
  | 'mangle'
  | 'webcrack'
  | 'jsdecode'
  | 'hidden-properties'
  | 'encoded-calls'
  | 'proxy-obfuscation'
  | 'with-obfuscation';

export interface Transformation {
  type: string;
  description: string;
  success: boolean;
}

export interface DeobfuscateOptions {
  code: string;
  aggressive?: boolean;
  preserveLogic?: boolean;
  renameVariables?: boolean;
  inlineFunctions?: boolean;
  unpack?: boolean;
  unminify?: boolean;
  jsx?: boolean;
  mangle?: boolean;
  outputDir?: string;
  forceOutput?: boolean;
  includeModuleCode?: boolean;
  maxBundleModules?: number;
  mappings?: DeobfuscateMappingRule[];
  proApiToken?: string;
  proApiVersion?: string;
  vmObfuscation?: boolean;
  parseHtml?: boolean;
}

export interface DeobfuscateMappingRule {
  path: string;
  pattern: string;
  matchType?: 'includes' | 'regex' | 'exact';
  target?: 'code' | 'path';
}

export interface DeobfuscateSavedArtifact {
  path: string;
  size: number;
  type: 'file';
}

export interface DeobfuscateBundleModuleSummary {
  id: string;
  path: string;
  isEntry: boolean;
  size: number;
  code?: string;
  mappedPathFrom?: string;
}

export interface DeobfuscateBundleSummary {
  type: 'webpack' | 'browserify' | 'vite' | 'rollup' | 'parcel' | (string & {});
  entryId: string;
  moduleCount: number;
  truncated: boolean;
  mappingsApplied?: number;
  modules: DeobfuscateBundleModuleSummary[];
}

export interface DeobfuscateResult {
  code: string;
  readabilityScore: number;
  confidence: number;
  obfuscationType: ObfuscationType[];
  transformations: Transformation[];
  analysis: string;
  bundle?: DeobfuscateBundleSummary;
  savedTo?: string;
  savedArtifacts?: DeobfuscateSavedArtifact[];
  warnings?: string[];
  engine?: 'legacy' | 'webcrack' | 'pro-api' | 'hybrid';
  webcrackApplied?: boolean;
  proApiUsed?: boolean;
  cached?: boolean;
}
