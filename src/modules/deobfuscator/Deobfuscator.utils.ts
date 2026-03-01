import type { ObfuscationType } from '../../types/index.js';

export function detectObfuscationType(code: string): ObfuscationType[] {
  const types: ObfuscationType[] = [];

  if (code.includes('_0x') || code.includes('\\x') || /var\s+_0x[a-f0-9]+\s*=/.test(code)) {
    types.push('javascript-obfuscator');
  }

  if (code.includes('__webpack_require__') || code.includes('webpackJsonp')) {
    types.push('webpack');
  }

  if (code.length > 1000 && !code.includes('\n')) {
    types.push('uglify');
  }

  if (code.includes('eval') && code.includes('Function')) {
    types.push('vm-protection');
  }

  if (types.length === 0) {
    types.push('unknown');
  }

  return types;
}

export function calculateReadabilityScore(code: string): number {
  let score = 0;

  if (code.includes('\n')) score += 20;

  const varNames = code.match(/\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g) || [];
  const avgLength = varNames.reduce((sum, name) => sum + name.length, 0) / (varNames.length || 1);
  if (avgLength > 3) score += 30;

  const density = code.replace(/\s/g, '').length / code.length;
  if (density < 0.8) score += 20;

  if (!code.includes('_0x') && !code.includes('\\x')) score += 20;

  return Math.min(score, 100);
}
