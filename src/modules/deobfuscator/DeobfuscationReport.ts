import type { ObfuscationType } from '@internal-types/deobfuscator';

export interface ObfuscationTypeInfo {
  type: ObfuscationType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  deobfuscationApproach: string;
}

const OBUSCATION_TYPE_DB: Record<ObfuscationType, ObfuscationTypeInfo> = {
  'javascript-obfuscator': {
    type: 'javascript-obfuscator',
    severity: 'medium',
    description: 'Code obfuscated using javascript-obfuscator.io or similar tool',
    deobfuscationApproach: 'String array reconstruction, dead code removal, variable renaming',
  },
  'webpack': {
    type: 'webpack',
    severity: 'low',
    description: 'Code bundled with webpack',
    deobfuscationApproach: 'Module unpacking, require-to-ESM conversion',
  },
  'uglify': {
    type: 'uglify',
    severity: 'low',
    description: 'Code minified with uglify or terser',
    deobfuscationApproach: 'Unminification, identifier restoration',
  },
  'vm-protection': {
    type: 'vm-protection',
    severity: 'critical',
    description: 'Code runs inside a custom virtual machine interpreter',
    deobfuscationApproach: 'VM detection, instruction extraction, interpreter simplification (experimental)',
  },
  'self-modifying': {
    type: 'self-modifying',
    severity: 'high',
    description: 'Code modifies itself at runtime',
    deobfuscationApproach: 'Dynamic analysis, sandbox execution tracing',
  },
  'invisible-unicode': {
    type: 'invisible-unicode',
    severity: 'medium',
    description: 'Code contains invisible Unicode characters (zero-width spaces, etc.)',
    deobfuscationApproach: 'Unicode normalization, invisible character removal',
  },
  'control-flow-flattening': {
    type: 'control-flow-flattening',
    severity: 'medium',
    description: 'Control flow replaced with switch-state-machine pattern',
    deobfuscationApproach: 'Switch-to-if restoration, state machine simplification',
  },
  'string-array-rotation': {
    type: 'string-array-rotation',
    severity: 'low',
    description: 'Strings stored in array and accessed by index',
    deobfuscationApproach: 'Array evaluation, index replacement with literal strings',
  },
  'dead-code-injection': {
    type: 'dead-code-injection',
    severity: 'low',
    description: 'Unused code branches injected to confuse analysis',
    deobfuscationApproach: 'Dead store elimination, unreachable code removal',
  },
  'opaque-predicates': {
    type: 'opaque-predicates',
    severity: 'medium',
    description: 'Conditional branches with unresolvable predicates',
    deobfuscationApproach: 'Predicate evaluation, constant folding, branch simplification',
  },
  'jsfuck': {
    type: 'jsfuck',
    severity: 'high',
    description: 'Code encoded using only JSFuck characters ([]()+!)',
    deobfuscationApproach: 'JSFuck evaluation via sandbox execution',
  },
  'aaencode': {
    type: 'aaencode',
    severity: 'high',
    description: 'Code encoded using Japanese emoticon patterns (゜ωﾟ)',
    deobfuscationApproach: 'AAEncode evaluation via sandbox execution',
  },
  'jjencode': {
    type: 'jjencode',
    severity: 'high',
    description: 'Code encoded using JJEncode dollar-sign patterns ($_$)',
    deobfuscationApproach: 'JJEncode evaluation via sandbox execution',
  },
  'packer': {
    type: 'packer',
    severity: 'medium',
    description: 'Code packed with Dean Edwards Packer or similar',
    deobfuscationApproach: 'Packer unpacker, iterative decoding',
  },
  'eval-obfuscation': {
    type: 'eval-obfuscation',
    severity: 'high',
    description: 'Code uses eval() or similar dynamic execution',
    deobfuscationApproach: 'Eval pattern detection, indirect call tracking',
  },
  'base64-encoding': {
    type: 'base64-encoding',
    severity: 'low',
    description: 'Code contains base64-encoded strings',
    deobfuscationApproach: 'Inline atob decoding, string reconstruction',
  },
  'hex-encoding': {
    type: 'hex-encoding',
    severity: 'low',
    description: 'Code contains hex-encoded strings (\\xNN or \\uNNNN)',
    deobfuscationApproach: 'Hex escape sequence decoding',
  },
  'jscrambler': {
    type: 'jscrambler',
    severity: 'critical',
    description: 'Code obfuscated with JScrambler professional tool',
    deobfuscationApproach: 'Property renaming, string decryption, control flow restoration',
  },
  'urlencoded': {
    type: 'urlencoded',
    severity: 'low',
    description: 'Code contains URL-encoded strings (%XX patterns)',
    deobfuscationApproach: 'decodeURIComponent decoding',
  },
  'custom': {
    type: 'custom',
    severity: 'medium',
    description: 'Custom obfuscation scheme detected',
    deobfuscationApproach: 'Pattern-specific analysis required',
  },
  'unknown': {
    type: 'unknown',
    severity: 'low',
    description: 'No specific obfuscation pattern recognized',
    deobfuscationApproach: 'General deobfuscation passes, manual analysis may be needed',
  },
  'bundle-unpack': {
    type: 'bundle-unpack',
    severity: 'low',
    description: 'Bundle format detected and unpacked',
    deobfuscationApproach: 'Module extraction, dependency resolution',
  },
  'unminify': {
    type: 'unminify',
    severity: 'low',
    description: 'Code was minified and has been unminified',
    deobfuscationApproach: 'Formatting, indentation restoration',
  },
  'jsx-decompile': {
    type: 'jsx-decompile',
    severity: 'low',
    description: 'JSX code was compiled to plain JavaScript',
    deobfuscationApproach: 'JSX restoration, pragma insertion',
  },
  'mangle': {
    type: 'mangle',
    severity: 'low',
    description: 'Variable names were mangled',
    deobfuscationApproach: 'Variable renaming, scope analysis',
  },
  'webcrack': {
    type: 'webcrack',
    severity: 'low',
    description: 'Webcrack deobfuscation engine was applied',
    deobfuscationApproach: 'Already processed by webcrack',
  },
  'jsdecode': {
    type: 'jsdecode',
    severity: 'medium',
    description: 'JSDecode obfuscation pattern detected',
    deobfuscationApproach: 'JSDecode pattern decoding',
  },
  'hidden-properties': {
    type: 'hidden-properties',
    severity: 'medium',
    description: 'Object.defineProperty with hidden/non-enumerable flags',
    deobfuscationApproach: 'Property visibility restoration',
  },
  'encoded-calls': {
    type: 'encoded-calls',
    severity: 'medium',
    description: 'Method calls via bracket notation with encoded strings',
    deobfuscationApproach: 'Bracket-notation call resolution',
  },
  'proxy-obfuscation': {
    type: 'proxy-obfuscation',
    severity: 'high',
    description: 'Proxy objects used to intercept property access',
    deobfuscationApproach: 'Proxy pattern detection, handler extraction',
  },
  'with-obfuscation': {
    type: 'with-obfuscation',
    severity: 'medium',
    description: 'with statement used to obscure variable scope',
    deobfuscationApproach: 'with statement removal, scope chain restoration',
  },
};

export function getObfuscationInfo(type: ObfuscationType): ObfuscationTypeInfo {
  return OBUSCATION_TYPE_DB[type] ?? {
    type,
    severity: 'unknown' as const,
    description: 'No information available for this obfuscation type',
    deobfuscationApproach: 'Manual analysis required',
  };
}

export function getSeverityColor(severity: ObfuscationTypeInfo['severity']): string {
  switch (severity) {
    case 'critical':
      return '🔴';
    case 'high':
      return '🟠';
    case 'medium':
      return '🟡';
    case 'low':
      return '🟢';
  }
}

export function generateDeobfuscationReport(params: {
  originalCode: string;
  deobfuscatedCode: string;
  obfuscationTypes: ObfuscationType[];
  confidence: number;
  readabilityBefore: number;
  readabilityAfter: number;
  rounds: number;
  stepsApplied: number;
  totalSteps: number;
  warnings: string[];
  bundleFormat?: string;
  fingerprintTool?: string;
}): string {
  const {
    originalCode,
    deobfuscatedCode,
    obfuscationTypes,
    confidence,
    readabilityBefore,
    readabilityAfter,
    rounds,
    stepsApplied,
    totalSteps,
    warnings,
    bundleFormat,
    fingerprintTool,
  } = params;

  const lines: string[] = [];
  const width = 70;

  lines.push('═'.repeat(width));
  lines.push('  JSHook MCP — Deobfuscation Report');
  lines.push('═'.repeat(width));
  lines.push('');

  // Summary section
  lines.push('▸ Summary');
  lines.push('─'.repeat(width));
  lines.push(
    `  Obfuscation types: ${obfuscationTypes.length > 0 ? obfuscationTypes.join(', ') : 'none detected'}`,
  );
  if (fingerprintTool) {
    lines.push(`  Detected tool:    ${fingerprintTool}`);
  }
  if (bundleFormat) {
    lines.push(`  Bundle format:    ${bundleFormat}`);
  }
  lines.push(
    `  Confidence:       ${(confidence * 100).toFixed(1)}% ${confidence >= 0.8 ? '✅' : confidence >= 0.5 ? '⚠️' : '❌'}`,
  );
  lines.push('');

  // Size metrics
  lines.push('▸ Size Metrics');
  lines.push('─'.repeat(width));
  const reduction = originalCode.length - deobfuscatedCode.length;
  const reductionPct = originalCode.length > 0 ? ((reduction / originalCode.length) * 100).toFixed(1) : '0.0';
  lines.push(`  Original:   ${originalCode.length.toLocaleString()} bytes`);
  lines.push(`  Final:      ${deobfuscatedCode.length.toLocaleString()} bytes`);
  lines.push(`  Reduction:  ${reductionPct}% (${reduction.toLocaleString()} bytes removed)`);
  lines.push('');

  // Readability
  lines.push('▸ Readability');
  lines.push('─'.repeat(width));
  lines.push(`  Before:     ${readabilityBefore.toFixed(1)}/100`);
  lines.push(`  After:      ${readabilityAfter.toFixed(1)}/100`);
  lines.push(`  Improvement: +${(readabilityAfter - readabilityBefore).toFixed(1)}`);
  lines.push('');

  // Pipeline stats
  lines.push('▸ Pipeline Statistics');
  lines.push('─'.repeat(width));
  lines.push(`  Rounds:          ${rounds}`);
  lines.push(`  Steps applied:   ${stepsApplied}/${totalSteps}`);
  lines.push('');

  // Obfuscation type details
  if (obfuscationTypes.length > 0) {
    lines.push('▸ Obfuscation Type Details');
    lines.push('─'.repeat(width));
    for (const type of obfuscationTypes) {
      const info = getObfuscationInfo(type);
      const color = getSeverityColor(info.severity);
      lines.push(`  ${color} [${info.severity.toUpperCase()}] ${type}`);
      lines.push(`    ${info.description}`);
      lines.push(`    → ${info.deobfuscationApproach}`);
      lines.push('');
    }
  }

  // Warnings
  if (warnings.length > 0) {
    lines.push('▸ Warnings');
    lines.push('─'.repeat(width));
    for (const warning of warnings.slice(0, 10)) {
      lines.push(`  ⚠️  ${warning}`);
    }
    if (warnings.length > 10) {
      lines.push(`  ... and ${warnings.length - 10} more warnings`);
    }
    lines.push('');
  }

  // Code preview (first 20 lines)
  lines.push('▸ Deobfuscated Code Preview');
  lines.push('─'.repeat(width));
  const previewLines = deobfuscatedCode.split('\n').slice(0, 20);
  for (const line of previewLines) {
    lines.push(`  ${line}`);
  }
  if (deobfuscatedCode.split('\n').length > 20) {
    lines.push(`  ... (${deobfuscatedCode.split('\n').length - 20} more lines)`);
  }
  lines.push('');
  lines.push('═'.repeat(width));

  return lines.join('\n');
}

export function generateMarkdownReport(params: {
  originalCode: string;
  deobfuscatedCode: string;
  obfuscationTypes: ObfuscationType[];
  confidence: number;
  readabilityBefore: number;
  readabilityAfter: number;
  rounds: number;
  stepsApplied: number;
  totalSteps: number;
  warnings: string[];
  bundleFormat?: string;
  fingerprintTool?: string;
}): string {
  const {
    originalCode,
    deobfuscatedCode,
    obfuscationTypes,
    confidence,
    readabilityBefore,
    readabilityAfter,
    rounds,
    stepsApplied,
    totalSteps,
    warnings,
    bundleFormat,
    fingerprintTool,
  } = params;

  const sections: string[] = [];

  // Summary table
  sections.push('## Deobfuscation Summary\n');
  sections.push('| Metric | Value |');
  sections.push('|--------|-------|');
  sections.push(`| Confidence | ${(confidence * 100).toFixed(1)}% |`);
  sections.push(`| Original Size | ${originalCode.length.toLocaleString()} bytes |`);
  sections.push(`| Final Size | ${deobfuscatedCode.length.toLocaleString()} bytes |`);
  sections.push(`| Size Reduction | ${((1 - deobfuscatedCode.length / originalCode.length) * 100).toFixed(1)}% |`);
  sections.push(`| Readability | ${readabilityBefore}/100 → ${readabilityAfter}/100 |`);
  sections.push(`| Rounds | ${rounds} |`);
  sections.push(`| Steps Applied | ${stepsApplied}/${totalSteps} |`);
  if (fingerprintTool) {
    sections.push(`| Detected Tool | ${fingerprintTool} |`);
  }
  if (bundleFormat) {
    sections.push(`| Bundle Format | ${bundleFormat} |`);
  }
  sections.push('');

  // Obfuscation types
  if (obfuscationTypes.length > 0) {
    sections.push('## Detected Obfuscation Types\n');
    sections.push('| Type | Severity | Description | Deobfuscation Approach |');
    sections.push('|------|----------|-------------|-----------------------|');
    for (const type of obfuscationTypes) {
      const info = getObfuscationInfo(type);
      sections.push(
        `| \`${type}\` | ${info.severity} | ${info.description} | ${info.deobfuscationApproach} |`,
      );
    }
    sections.push('');
  }

  // Warnings
  if (warnings.length > 0) {
    sections.push('## Warnings\n');
    for (const warning of warnings) {
      sections.push(`- ⚠️ ${warning}`);
    }
    sections.push('');
  }

  // Code preview
  sections.push('## Deobfuscated Code Preview\n');
  sections.push('```javascript');
  const previewLines = deobfuscatedCode.split('\n').slice(0, 50);
  sections.push(previewLines.join('\n'));
  if (deobfuscatedCode.split('\n').length > 50) {
    sections.push(`... (${deobfuscatedCode.split('\n').length - 50} more lines)`);
  }
  sections.push('```\n');

  return sections.join('\n');
}
