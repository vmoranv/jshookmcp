import { describe, expect, it } from 'vitest';
import {
  getObfuscationInfo,
  getSeverityColor,
  generateDeobfuscationReport,
  generateMarkdownReport,
} from '@modules/deobfuscator/DeobfuscationReport';

describe('DeobfuscationReport', () => {
  describe('getObfuscationInfo', () => {
    it('returns info for known obfuscation types', () => {
      const info = getObfuscationInfo('jsfuck');
      expect(info.type).toBe('jsfuck');
      expect(info.severity).toBe('high');
      expect(info.description).toContain('JSFuck');
      expect(info.deobfuscationApproach).toContain('sandbox');
    });

    it('returns unknown info for unknown types', () => {
      const info = getObfuscationInfo('unknown');
      expect(info.type).toBe('unknown');
      expect(info.description).toContain('No specific');
    });

    it('returns critical severity for vm-protection', () => {
      const info = getObfuscationInfo('vm-protection');
      expect(info.severity).toBe('critical');
    });

    it('returns critical severity for jscrambler', () => {
      const info = getObfuscationInfo('jscrambler');
      expect(info.severity).toBe('critical');
    });

    it('returns low severity for bundle-unpack', () => {
      const info = getObfuscationInfo('bundle-unpack');
      expect(info.severity).toBe('low');
    });
  });

  describe('getSeverityColor', () => {
    it('returns correct emoji for each severity', () => {
      expect(getSeverityColor('critical')).toBe('🔴');
      expect(getSeverityColor('high')).toBe('🟠');
      expect(getSeverityColor('medium')).toBe('🟡');
      expect(getSeverityColor('low')).toBe('🟢');
    });
  });

  describe('generateDeobfuscationReport', () => {
    it('generates a text report with all sections', () => {
      const report = generateDeobfuscationReport({
        originalCode: 'const x = 1;',
        deobfuscatedCode: 'const x = 1;',
        obfuscationTypes: ['jsfuck', 'packer'],
        confidence: 0.85,
        readabilityBefore: 30,
        readabilityAfter: 70,
        rounds: 2,
        stepsApplied: 5,
        totalSteps: 8,
        warnings: ['debugger statement removed'],
        bundleFormat: 'webpack',
        fingerprintTool: 'javascript-obfuscator',
      });

      expect(report).toContain('Deobfuscation Report');
      expect(report).toContain('jsfuck');
      expect(report).toContain('packer');
      expect(report).toContain('85.0%');
      expect(report).toContain('webpack');
      expect(report).toContain('javascript-obfuscator');
      expect(report).toContain('debugger statement removed');
    });

    it('handles empty obfuscation types', () => {
      const report = generateDeobfuscationReport({
        originalCode: 'const x = 1;',
        deobfuscatedCode: 'const x = 1;',
        obfuscationTypes: [],
        confidence: 0.5,
        readabilityBefore: 50,
        readabilityAfter: 50,
        rounds: 1,
        stepsApplied: 0,
        totalSteps: 5,
        warnings: [],
      });

      expect(report).toContain('none detected');
    });

    it('handles no warnings', () => {
      const report = generateDeobfuscationReport({
        originalCode: 'const x = 1;',
        deobfuscatedCode: 'const x = 1;',
        obfuscationTypes: [],
        confidence: 0.5,
        readabilityBefore: 50,
        readabilityAfter: 50,
        rounds: 1,
        stepsApplied: 0,
        totalSteps: 5,
        warnings: [],
      });

      expect(report).not.toContain('Warnings');
    });

    it('truncates long warning list', () => {
      const warnings = Array.from({ length: 15 }, (_, i) => `Warning ${i}`);
      const report = generateDeobfuscationReport({
        originalCode: 'const x = 1;',
        deobfuscatedCode: 'const x = 1;',
        obfuscationTypes: [],
        confidence: 0.5,
        readabilityBefore: 50,
        readabilityAfter: 50,
        rounds: 1,
        stepsApplied: 0,
        totalSteps: 5,
        warnings,
      });

      expect(report).toContain('... and 5 more warnings');
    });

    it('shows code preview', () => {
      const code = Array.from({ length: 25 }, (_, i) => `line ${i}`).join('\n');
      const report = generateDeobfuscationReport({
        originalCode: code,
        deobfuscatedCode: code,
        obfuscationTypes: [],
        confidence: 0.5,
        readabilityBefore: 50,
        readabilityAfter: 50,
        rounds: 1,
        stepsApplied: 0,
        totalSteps: 5,
        warnings: [],
      });

      expect(report).toContain('line 0');
      expect(report).toMatch(/\(\d+ more lines\)/);
    });
  });

  describe('generateMarkdownReport', () => {
    it('generates a markdown report with tables', () => {
      const report = generateMarkdownReport({
        originalCode: 'const x = 1;',
        deobfuscatedCode: 'const x = 1;',
        obfuscationTypes: ['webpack', 'uglify'],
        confidence: 0.9,
        readabilityBefore: 20,
        readabilityAfter: 80,
        rounds: 3,
        stepsApplied: 7,
        totalSteps: 10,
        warnings: [],
        bundleFormat: 'webpack',
      });

      expect(report).toContain('## Deobfuscation Summary');
      expect(report).toContain('| Metric | Value |');
      expect(report).toContain('90.0%');
      expect(report).toContain('webpack');
      expect(report).toContain('## Detected Obfuscation Types');
      expect(report).toContain('```javascript');
    });

    it('handles no obfuscation types', () => {
      const report = generateMarkdownReport({
        originalCode: 'const x = 1;',
        deobfuscatedCode: 'const x = 1;',
        obfuscationTypes: [],
        confidence: 0.5,
        readabilityBefore: 50,
        readabilityAfter: 50,
        rounds: 1,
        stepsApplied: 0,
        totalSteps: 5,
        warnings: [],
      });

      expect(report).toContain('## Deobfuscation Summary');
      expect(report).not.toContain('## Detected Obfuscation Types');
    });

    it('includes warnings section when present', () => {
      const report = generateMarkdownReport({
        originalCode: 'const x = 1;',
        deobfuscatedCode: 'const x = 1;',
        obfuscationTypes: [],
        confidence: 0.5,
        readabilityBefore: 50,
        readabilityAfter: 50,
        rounds: 1,
        stepsApplied: 0,
        totalSteps: 5,
        warnings: ['test warning'],
      });

      expect(report).toContain('## Warnings');
      expect(report).toContain('test warning');
    });
  });
});
